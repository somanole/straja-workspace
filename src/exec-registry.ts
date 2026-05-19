/**
 * Server-side process registry for vault_exec background sessions.
 *
 * Manages the lifecycle of long-running sandboxed processes:
 * spawn → running → exited → file-diffs-captured → cleaned up.
 *
 * Modeled after openclaw/src/agents/bash-process-registry.ts but adapted
 * for the vault's HTTP-based execution model with materialized workspaces.
 */

import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { serializeWorkspaceFileForStore } from "./exec-workspace-files.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TEMP_DIR_GRACE_MS = 5 * 60 * 1000; // 5 min after exit before cleanup
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;
const DEFAULT_TAIL_CHARS = 2000;
const MAX_CONCURRENT_SESSIONS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

/**
 * Minimal subset of the Store interface needed for file diff capture.
 * Avoids importing the full Store type and its Database dependency.
 */
export type StoreForDiff = {
  insertContent: (hash: string, content: string, createdAt: string) => void;
  insertDocument: (
    collectionName: string,
    path: string,
    title: string,
    hash: string,
    createdAt: string,
    modifiedAt: string,
  ) => void;
  findActiveDocument: (
    collectionName: string,
    path: string,
  ) => { id: number; hash: string; title: string } | null;
  updateDocument: (
    documentId: number,
    title: string,
    hash: string,
    modifiedAt: string,
  ) => void;
  deactivateDocument: (collectionName: string, path: string) => void;
};

export interface VaultExecSession {
  id: string;
  command: string;
  args: string[];
  cwd: string; // relative to workspace root (or "." for root)
  tempDir: string; // absolute path to materialized workspace
  collection: string; // vault collection, usually "_workspace"
  originalHashes: Map<string, string>; // relPath → materialized file-content hash, for diff capture
  child: ChildProcess | undefined;
  stdin: Writable | undefined;
  pid: number | undefined;
  startedAt: number;
  maxOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  truncated: boolean;
  timedOut: boolean;
  backgrounded: boolean;
  filesChanged: Array<{ path: string; action: "created" | "modified" | "deleted" }> | null;
  /** Timestamp when process exited — used for grace period before temp dir cleanup */
  exitedAt: number | null;
  /** Repo-backed sessions (SE agent) skip diff capture and temp dir cleanup. */
  repoBacked?: boolean;
}

export interface VaultFinishedSession {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  endedAt: number;
  status: ProcessStatus;
  exitCode: number | null;
  exitSignal: string | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  timedOut: boolean;
  filesChanged: Array<{ path: string; action: "created" | "modified" | "deleted" }>;
  /** Absolute path — kept alive for grace period, then cleaned up */
  tempDir: string | null;
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const runningSessions = new Map<string, VaultExecSession>();
const finishedSessions = new Map<string, VaultFinishedSession>();
let sweeper: ReturnType<typeof setInterval> | null = null;
let jobTtlMs = DEFAULT_JOB_TTL_MS;

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 6;

function randomSlug(): string {
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return slug;
}

function isSessionIdTaken(id: string): boolean {
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionId(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = randomSlug();
    if (!isSessionIdTaken(id)) {
      return id;
    }
  }
  // Fallback: add timestamp suffix
  return `${randomSlug()}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createSession(opts: {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  tempDir: string;
  collection: string;
  originalHashes: Map<string, string>;
  child: ChildProcess;
  stdin: Writable | undefined;
  repoBacked?: boolean;
}): VaultExecSession {
  if (runningSessions.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error(
      `Max concurrent sessions (${MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Kill or wait for existing sessions to complete.`,
    );
  }

  const session: VaultExecSession = {
    id: opts.id,
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    tempDir: opts.tempDir,
    collection: opts.collection,
    originalHashes: opts.originalHashes,
    child: opts.child,
    stdin: opts.stdin,
    pid: opts.child.pid,
    startedAt: Date.now(),
    maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exitCode: null,
    exitSignal: null,
    exited: false,
    truncated: false,
    timedOut: false,
    backgrounded: false,
    filesChanged: null,
    exitedAt: null,
    repoBacked: opts.repoBacked ?? false,
  };

  runningSessions.set(session.id, session);
  startSweeper();
  return session;
}

export function getSession(id: string): VaultExecSession | undefined {
  return runningSessions.get(id);
}

export function getFinishedSession(id: string): VaultFinishedSession | undefined {
  return finishedSessions.get(id);
}

export function getAnySession(
  id: string,
): { session: VaultExecSession; finished: false } | { session: VaultFinishedSession; finished: true } | undefined {
  const running = runningSessions.get(id);
  if (running) return { session: running, finished: false };
  const finished = finishedSessions.get(id);
  if (finished) return { session: finished, finished: true };
  return undefined;
}

export function deleteSession(id: string): boolean {
  const running = runningSessions.get(id);
  if (running) {
    // Kill if still running
    killSession(running);
    runningSessions.delete(id);
    // Schedule temp dir cleanup
    scheduleCleanup(running.tempDir);
    return true;
  }
  const finished = finishedSessions.get(id);
  if (finished) {
    finishedSessions.delete(id);
    if (finished.tempDir) {
      scheduleCleanup(finished.tempDir);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Output buffering (same logic as native bash-process-registry)
// ---------------------------------------------------------------------------

export function appendOutput(
  session: VaultExecSession,
  stream: "stdout" | "stderr",
  chunk: string,
): void {
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferCharsKey = stream === "stdout" ? "pendingStdoutChars" : "pendingStderrChars";
  const pendingCap = Math.min(DEFAULT_PENDING_OUTPUT_CHARS, session.maxOutputChars);

  buffer.push(chunk);
  let pendingChars = session[bufferCharsKey] + chunk.length;

  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }

  session[bufferCharsKey] = pendingChars;

  // Update aggregated output (ring buffer)
  const newAggregated = session.aggregated + chunk;
  if (newAggregated.length > session.maxOutputChars) {
    session.aggregated = newAggregated.slice(newAggregated.length - session.maxOutputChars);
    session.truncated = true;
  } else {
    session.aggregated = newAggregated;
  }

  session.tail = tail(session.aggregated, DEFAULT_TAIL_CHARS);
}

export function drainSession(session: VaultExecSession): { stdout: string; stderr: string } {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function markBackgrounded(session: VaultExecSession): void {
  session.backgrounded = true;
}

export async function markExited(
  session: VaultExecSession,
  exitCode: number | null,
  exitSignal: string | null,
  store: StoreForDiff,
): Promise<void> {
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.exitedAt = Date.now();
  session.tail = tail(session.aggregated, DEFAULT_TAIL_CHARS);

  // Capture file diffs before moving to finished (skip for repo-backed sessions)
  if (session.repoBacked) {
    session.filesChanged = [];
  } else {
    try {
      session.filesChanged = await captureFileDiffs(session, store);
    } catch (err) {
      session.filesChanged = [];
      // Log but don't throw — process still completed
      console.error(`[exec-registry] Failed to capture file diffs for ${session.id}: ${err}`);
    }
  }

  moveToFinished(session);
}

function moveToFinished(session: VaultExecSession): void {
  runningSessions.delete(session.id);

  // Clean up child process handles
  if (session.child) {
    session.child.stdin?.destroy?.();
    session.child.stdout?.destroy?.();
    session.child.stderr?.destroy?.();
    session.child.removeAllListeners();
    session.child = undefined;
  }
  if (session.stdin) {
    try {
      session.stdin.destroy?.();
    } catch {
      /* ignore */
    }
    session.stdin = undefined;
  }

  const status: ProcessStatus = session.timedOut
    ? "killed"
    : session.exitCode === 0
      ? "completed"
      : "failed";

  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    startedAt: session.startedAt,
    endedAt: session.exitedAt ?? Date.now(),
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    timedOut: session.timedOut,
    filesChanged: session.filesChanged ?? [],
    tempDir: session.tempDir, // keep alive for grace period
  });

  // Schedule temp dir cleanup after grace period (skip for repo-backed — never delete the real repo)
  if (!session.repoBacked) {
    setTimeout(() => {
      const finished = finishedSessions.get(session.id);
      if (finished?.tempDir) {
        cleanupTempDir(finished.tempDir).then(() => {
          finished.tempDir = null;
        });
      }
    }, TEMP_DIR_GRACE_MS).unref?.();
  }
}

export function killSession(session: VaultExecSession): void {
  if (session.exited || !session.child) return;

  try {
    session.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  // Force kill after 5s grace
  const child = session.child;
  setTimeout(() => {
    if (!session.exited && child) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 5000).unref?.();
}

// ---------------------------------------------------------------------------
// File diff capture (extracted from mcp.ts POST /exec)
// ---------------------------------------------------------------------------

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function captureFileDiffs(
  session: VaultExecSession,
  store: StoreForDiff,
): Promise<Array<{ path: string; action: "created" | "modified" | "deleted" }>> {
  const filesChanged: Array<{ path: string; action: "created" | "modified" | "deleted" }> = [];
  const now = new Date().toISOString();
  const { tempDir, collection, originalHashes } = session;

  // Walk the temp dir to find all files after execution
  const allFiles = await walkDir(tempDir);
  const seenPaths = new Set<string>();

  for (const fullPath of allFiles) {
    const relPath = relative(tempDir, fullPath);
    seenPaths.add(relPath);
    const bytes = await readFile(fullPath);
    const serialized = serializeWorkspaceFileForStore(relPath, bytes);
    const newHash = serialized.contentHash;

    if (originalHashes.has(relPath)) {
      // Existing file — check if modified
      if (newHash !== originalHashes.get(relPath)) {
        store.insertContent(serialized.storeHash, serialized.content, now);
        const existing = store.findActiveDocument(collection, relPath);
        if (existing) {
          store.updateDocument(existing.id, existing.title, serialized.storeHash, now);
        }
        filesChanged.push({ path: relPath, action: "modified" });
      }
    } else {
      // New file created by the command
      store.insertContent(serialized.storeHash, serialized.content, now);
      store.insertDocument(collection, relPath, relPath, serialized.storeHash, now, now);
      filesChanged.push({ path: relPath, action: "created" });
    }
  }

  // Check for deleted files
  for (const [origPath] of originalHashes) {
    if (!seenPaths.has(origPath)) {
      store.deactivateDocument(collection, origPath);
      filesChanged.push({ path: origPath, action: "deleted" });
    }
  }

  return filesChanged;
}

// ---------------------------------------------------------------------------
// Temp dir cleanup
// ---------------------------------------------------------------------------

export async function cleanupTempDir(tempDir: string): Promise<void> {
  // Safety: never delete directories outside of OS temp dir
  const { tmpdir } = await import("node:os");
  if (!tempDir.startsWith(tmpdir())) {
    console.error(`[exec-registry] ⚠ REFUSING to delete non-temp dir: ${tempDir}`);
    return;
  }
  try {
    await rm(tempDir, { recursive: true, force: true });
    // Verify removal
    try {
      await stat(tempDir);
      console.error(`[exec-registry] ⚠ temp dir still exists after rm: ${tempDir}`);
    } catch {
      // Good — directory is gone
    }
  } catch (err) {
    console.error(`[exec-registry] ⚠ cleanup failed for ${tempDir}: ${err}`);
  }
}

/** Clean up orphaned temp dirs from previous vault server runs */
export async function cleanupOrphanedTempDirs(): Promise<void> {
  const { tmpdir } = await import("node:os");
  const tmpBase = tmpdir();
  try {
    const entries = await readdir(tmpBase, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("vault-exec-")) {
        const fullPath = join(tmpBase, entry.name);
        // Only clean if not in use by any current session
        const inUse = [...runningSessions.values(), ...finishedSessions.values()].some(
          (s) => {
            const dir = "tempDir" in s ? s.tempDir : null;
            return dir === fullPath;
          },
        );
        if (!inUse) {
          await cleanupTempDir(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors reading tmpdir
  }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export function listRunningSessions(): VaultExecSession[] {
  return Array.from(runningSessions.values());
}

export function listFinishedSessions(): VaultFinishedSession[] {
  return Array.from(finishedSessions.values());
}

export function listAllSessions(): Array<
  | { type: "running"; session: VaultExecSession }
  | { type: "finished"; session: VaultFinishedSession }
> {
  const all: Array<
    | { type: "running"; session: VaultExecSession }
    | { type: "finished"; session: VaultFinishedSession }
  > = [];
  for (const session of runningSessions.values()) {
    all.push({ type: "running", session });
  }
  for (const session of finishedSessions.values()) {
    all.push({ type: "finished", session });
  }
  return all;
}

// ---------------------------------------------------------------------------
// Sweeper — TTL-based cleanup of finished sessions
// ---------------------------------------------------------------------------

function pruneFinishedSessions(): void {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      if (session.tempDir && session.tempDir.includes("vault-exec-")) {
        // Safety: only clean up actual temp dirs (vault-exec-*), never persistent dirs
        cleanupTempDir(session.tempDir).catch(() => {});
      }
      finishedSessions.delete(id);
    }
  }
}

function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  // @ts-ignore — unref() may not exist in all environments
  sweeper.unref?.();
}

function stopSweeper(): void {
  if (!sweeper) return;
  clearInterval(sweeper);
  sweeper = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tail(text: string, max = DEFAULT_TAIL_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number): number {
  if (pendingChars <= cap) return pendingChars;

  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }

  while (buffer.length > 0 && pendingChars - (buffer[0]?.length ?? 0) >= cap) {
    pendingChars -= buffer[0]!.length;
    buffer.shift();
  }

  if (buffer.length > 0 && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0]!.slice(overflow);
    pendingChars = cap;
  }

  return pendingChars;
}

function scheduleCleanup(tempDir: string): void {
  // Immediate cleanup for deleted sessions
  cleanupTempDir(tempDir).catch(() => {});
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

export function resetRegistryForTests(): void {
  // Kill all running sessions
  for (const session of runningSessions.values()) {
    killSession(session);
  }
  runningSessions.clear();
  finishedSessions.clear();
  stopSweeper();
}

export { MAX_CONCURRENT_SESSIONS, DEFAULT_MAX_OUTPUT_CHARS, DEFAULT_PENDING_OUTPUT_CHARS };
