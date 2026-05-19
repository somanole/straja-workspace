import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { decodeBrowserUploadBlobEnvelope, encodeBrowserUploadBlobEnvelope } from "../src/browser-upload-staging.js";
import {
  createSession,
  createSessionId,
  getSession,
  getFinishedSession,
  appendOutput,
  drainSession,
  markBackgrounded,
  markExited,
  killSession,
  deleteSession,
  listRunningSessions,
  listFinishedSessions,
  listAllSessions,
  resetRegistryForTests,
  captureFileDiffs,
  type StoreForDiff,
  type VaultExecSession,
} from "../src/exec-registry.js";
import {
  materializeStoredWorkspaceDocument,
  serializeWorkspaceFileForStore,
} from "../src/exec-workspace-files.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function createMockStore(): StoreForDiff & {
  inserted: Array<{ hash: string; content: string }>;
  documents: Array<{ collection: string; path: string; hash: string }>;
  updated: Array<{ id: number; hash: string }>;
  deactivated: Array<{ collection: string; path: string }>;
} {
  const inserted: Array<{ hash: string; content: string }> = [];
  const documents: Array<{ collection: string; path: string; hash: string }> = [];
  const updated: Array<{ id: number; hash: string }> = [];
  const deactivated: Array<{ collection: string; path: string }> = [];

  return {
    inserted,
    documents,
    updated,
    deactivated,
    insertContent(hash: string, content: string, _createdAt: string) {
      inserted.push({ hash, content });
    },
    insertDocument(collectionName: string, path: string, _title: string, hash: string, _createdAt: string, _modifiedAt: string) {
      documents.push({ collection: collectionName, path, hash });
    },
    findActiveDocument(_collectionName: string, _path: string) {
      return { id: 1, hash: "old-hash", title: "test" };
    },
    updateDocument(documentId: number, _title: string, hash: string, _modifiedAt: string) {
      updated.push({ id: documentId, hash });
    },
    deactivateDocument(collectionName: string, path: string) {
      deactivated.push({ collection: collectionName, path });
    },
  };
}

beforeEach(async () => {
  resetRegistryForTests();
  tempDir = await mkdtemp(join(tmpdir(), "vault-exec-registry-test-"));
});

afterEach(async () => {
  resetRegistryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

describe("createSessionId", () => {
  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createSessionId());
    }
    expect(ids.size).toBe(100);
  });

  test("returns a short string", () => {
    const id = createSessionId();
    expect(id.length).toBeGreaterThanOrEqual(6);
    expect(id.length).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

describe("createSession", () => {
  test("creates a session with correct properties", () => {
    const child = spawn("sleep", ["100"]);
    const session = createSession({
      id: createSessionId(),
      command: "sleep",
      args: ["100"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    expect(session.command).toBe("sleep");
    expect(session.args).toEqual(["100"]);
    expect(session.exited).toBe(false);
    expect(session.backgrounded).toBe(false);
    expect(session.pid).toBeDefined();
    expect(getSession(session.id)).toBe(session);

    child.kill("SIGKILL");
  });

  test("session appears in running list", () => {
    const child = spawn("sleep", ["100"]);
    createSession({
      id: createSessionId(),
      command: "sleep",
      args: ["100"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    expect(listRunningSessions().length).toBe(1);
    child.kill("SIGKILL");
  });
});

// ---------------------------------------------------------------------------
// Output buffering
// ---------------------------------------------------------------------------

describe("appendOutput", () => {
  test("buffers stdout", () => {
    const child = spawn("sleep", ["100"]);
    const session = createSession({
      id: createSessionId(),
      command: "test",
      args: [],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    appendOutput(session, "stdout", "hello ");
    appendOutput(session, "stdout", "world");
    expect(session.aggregated).toBe("hello world");
    expect(session.tail).toBe("hello world");

    child.kill("SIGKILL");
  });

  test("buffers stderr separately", () => {
    const child = spawn("sleep", ["100"]);
    const session = createSession({
      id: createSessionId(),
      command: "test",
      args: [],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    appendOutput(session, "stdout", "out");
    appendOutput(session, "stderr", "err");

    const drained = drainSession(session);
    expect(drained.stdout).toBe("out");
    expect(drained.stderr).toBe("err");

    child.kill("SIGKILL");
  });
});

// ---------------------------------------------------------------------------
// drainSession
// ---------------------------------------------------------------------------

describe("drainSession", () => {
  test("returns and clears pending buffers", () => {
    const child = spawn("sleep", ["100"]);
    const session = createSession({
      id: createSessionId(),
      command: "test",
      args: [],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    appendOutput(session, "stdout", "data1");
    appendOutput(session, "stderr", "err1");

    const first = drainSession(session);
    expect(first.stdout).toBe("data1");
    expect(first.stderr).toBe("err1");

    // Second drain should be empty
    const second = drainSession(session);
    expect(second.stdout).toBe("");
    expect(second.stderr).toBe("");

    child.kill("SIGKILL");
  });
});

// ---------------------------------------------------------------------------
// markExited and file diff capture
// ---------------------------------------------------------------------------

describe("markExited", () => {
  test("moves session to finished with correct status", async () => {
    const child = spawn("echo", ["test"]);
    const sessionId = createSessionId();
    const session = createSession({
      id: sessionId,
      command: "echo",
      args: ["test"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });
    markBackgrounded(session);

    const store = createMockStore();
    await markExited(session, 0, null, store);

    expect(getSession(sessionId)).toBeUndefined();
    const finished = getFinishedSession(sessionId);
    expect(finished).toBeDefined();
    expect(finished!.status).toBe("completed");
    expect(finished!.exitCode).toBe(0);
  });

  test("failed status for non-zero exit", async () => {
    const child = spawn("echo", ["test"]);
    const sessionId = createSessionId();
    const session = createSession({
      id: sessionId,
      command: "test",
      args: [],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });
    markBackgrounded(session);

    const store = createMockStore();
    await markExited(session, 1, null, store);

    const finished = getFinishedSession(sessionId);
    expect(finished!.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// captureFileDiffs
// ---------------------------------------------------------------------------

describe("captureFileDiffs", () => {
  test("detects created files", async () => {
    // Create a file in tempDir that wasn't in originalHashes
    await writeFile(join(tempDir, "new-file.txt"), "new content");

    const store = createMockStore();
    const session = {
      tempDir,
      collection: "_workspace",
      originalHashes: new Map<string, string>(),
    } as unknown as VaultExecSession;

    const changes = await captureFileDiffs(session, store);
    expect(changes).toContainEqual({ path: "new-file.txt", action: "created" });
    expect(store.documents.length).toBeGreaterThanOrEqual(1);
  });

  test("detects deleted files", async () => {
    // originalHashes has a file that doesn't exist in tempDir
    const originalHashes = new Map([["deleted.txt", "abc123"]]);

    const store = createMockStore();
    const session = {
      tempDir,
      collection: "_workspace",
      originalHashes,
    } as unknown as VaultExecSession;

    const changes = await captureFileDiffs(session, store);
    expect(changes).toContainEqual({ path: "deleted.txt", action: "deleted" });
    expect(store.deactivated.length).toBe(1);
  });

  test("detects modified files", async () => {
    // Write a file with different content from its original hash
    await writeFile(join(tempDir, "modified.txt"), "new content");
    const originalHashes = new Map([["modified.txt", "different-hash"]]);

    const store = createMockStore();
    const session = {
      tempDir,
      collection: "_workspace",
      originalHashes,
    } as unknown as VaultExecSession;

    const changes = await captureFileDiffs(session, store);
    expect(changes).toContainEqual({ path: "modified.txt", action: "modified" });
    expect(store.updated.length).toBe(1);
  });

  test("ignores unchanged files", async () => {
    // We need the actual hash — write the file and compute hash
    const { hashContent } = await import("../src/store.js");
    const content = "unchanged content";
    const hash = await hashContent(content);
    await writeFile(join(tempDir, "same.txt"), content);

    const originalHashes = new Map([["same.txt", hash]]);
    const store = createMockStore();
    const session = {
      tempDir,
      collection: "_workspace",
      originalHashes,
    } as unknown as VaultExecSession;

    const changes = await captureFileDiffs(session, store);
    expect(changes).toEqual([]);
  });

  test("captures created binary files as blob envelopes", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80, 0x41]);
    await writeFile(join(tempDir, "report.docx"), bytes);

    const store = createMockStore();
    const session = {
      tempDir,
      collection: "_workspace",
      originalHashes: new Map<string, string>(),
    } as unknown as VaultExecSession;

    const changes = await captureFileDiffs(session, store);
    expect(changes).toContainEqual({ path: "report.docx", action: "created" });
    expect(store.inserted).toHaveLength(1);

    const stored = decodeBrowserUploadBlobEnvelope(store.inserted[0]!.content);
    expect(stored).not.toBeNull();
    expect(stored!.bytes.equals(bytes)).toBe(true);
  });
});

describe("exec workspace file helpers", () => {
  test("materializes binary envelopes back into original bytes", () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x80, 0x00, 0x7f]);
    const envelope = encodeBrowserUploadBlobEnvelope(bytes, {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      originalName: "report.docx",
    });

    const materialized = materializeStoredWorkspaceDocument(envelope);
    expect(materialized.bytes.equals(bytes)).toBe(true);
  });

  test("serializes binary files as blob envelopes", () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x80, 0x00, 0x7f]);
    const serialized = serializeWorkspaceFileForStore("nested/report.docx", bytes);
    const blob = decodeBrowserUploadBlobEnvelope(serialized.content);

    expect(blob).not.toBeNull();
    expect(blob!.bytes.equals(bytes)).toBe(true);
    expect(blob!.originalName).toBe("report.docx");
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe("deleteSession", () => {
  test("removes running session", () => {
    const child = spawn("sleep", ["100"]);
    const sessionId = createSessionId();
    createSession({
      id: sessionId,
      command: "sleep",
      args: ["100"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child,
      stdin: undefined,
    });

    expect(deleteSession(sessionId)).toBe(true);
    expect(getSession(sessionId)).toBeUndefined();
  });

  test("returns false for unknown session", () => {
    expect(deleteSession("nonexistent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listAllSessions
// ---------------------------------------------------------------------------

describe("listAllSessions", () => {
  test("returns both running and finished sessions", async () => {
    const child1 = spawn("sleep", ["100"]);
    const id1 = createSessionId();
    createSession({
      id: id1,
      command: "sleep",
      args: ["100"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child: child1,
      stdin: undefined,
    });

    const child2 = spawn("echo", ["done"]);
    const id2 = createSessionId();
    const session2 = createSession({
      id: id2,
      command: "echo",
      args: ["done"],
      cwd: ".",
      tempDir,
      collection: "_workspace",
      originalHashes: new Map(),
      child: child2,
      stdin: undefined,
    });
    markBackgrounded(session2);
    await markExited(session2, 0, null, createMockStore());

    const all = listAllSessions();
    expect(all.length).toBe(2);
    expect(all.some((e) => e.type === "running")).toBe(true);
    expect(all.some((e) => e.type === "finished")).toBe(true);

    child1.kill("SIGKILL");
  });
});
