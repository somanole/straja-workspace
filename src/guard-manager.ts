/**
 * Guard Manager — Process lifecycle management for Straja Guard (gateway).
 *
 * Manages the Guard binary as a child process: start, stop, restart, status.
 * Stores guard configuration in the vault's `_config` collection under
 * `guard.json`.
 *
 * Modeled after the agent process management pattern in mcp.ts.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import type { Store } from "./store.js";
import { checkGuardHealth, type GuardHealthStatus } from "./guard-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardConfig {
  /** Path to the guard binary (e.g., /path/to/straja or straja) */
  binaryPath: string;
  /** Path to guard config file (straja.yaml) */
  configPath: string;
  /** Guard listen address (default: 127.0.0.1:8080) */
  listenAddr: string;
  /** Guard console URL */
  consoleUrl: string;
  /** Whether guard should auto-start with the workspace */
  autoStart: boolean;
  /** Webhook URL for activation events (points back to vault) */
  activationWebhookUrl: string;
}

export interface GuardStatus {
  running: boolean;
  pid: number | null;
  listenAddr: string;
  consoleUrl: string;
  health: GuardHealthStatus | null;
  uptime: number | null; // seconds
  config: GuardConfig | null;
  lastError: string | null;
  externallyManaged: boolean;
  controlMode: "managed" | "external_restartable" | "external_readonly";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let guardProcess: ChildProcess | null = null;
let guardStartedAt: number | null = null;
let lastError: string | null = null;
let currentConfig: GuardConfig | null = null;

interface ExternalGuardControl {
  binaryPath: string;
  configPath: string;
  cwd: string;
  pidFile: string;
  logPath: string | null;
  listenAddr: string;
  consoleUrl: string;
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

const CONFIG_KEY = "guard.json";

function loadGuardConfig(store: Store): GuardConfig | null {
  try {
    const doc = store.getDocumentWithContent("_config", CONFIG_KEY);
    if (doc?.content) {
      return JSON.parse(doc.content) as GuardConfig;
    }
  } catch {
    // Config not found or invalid
  }
  return null;
}

function saveGuardConfig(store: Store, config: GuardConfig): void {
  const content = JSON.stringify(config, null, 2);
  const now = new Date().toISOString();
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  store.insertContent(hash, content, now);
  const existing = store.getDocumentWithContent("_config", CONFIG_KEY);
  if (existing) {
    store.updateDocument(existing.id, CONFIG_KEY, hash, now);
  } else {
    store.insertDocument("_config", CONFIG_KEY, CONFIG_KEY, hash, now, now);
  }
}

// ---------------------------------------------------------------------------
// Process Management
// ---------------------------------------------------------------------------

function isRunning(): boolean {
  if (!guardProcess || guardProcess.killed) return false;
  try {
    // Check if process is alive
    process.kill(guardProcess.pid!, 0);
    return true;
  } catch {
    return false;
  }
}

function getExternalGuardUrl(): string | null {
  const guardUrl = process.env.STRAJA_GUARD_URL?.trim();
  return guardUrl ? guardUrl : null;
}

function isExternallyManaged(): boolean {
  return getExternalGuardUrl() !== null;
}

function getExternalGuardControl(): ExternalGuardControl | null {
  const binaryPath = process.env.STRAJA_GUARD_PATH?.trim();
  const configPath = process.env.STRAJA_GUARD_CONFIG_PATH?.trim();
  const cwd = process.env.STRAJA_GUARD_CWD?.trim();
  const pidFile = process.env.STRAJA_GUARD_PID_FILE?.trim();
  if (!binaryPath || !configPath || !cwd || !pidFile) {
    return null;
  }
  const listenAddr = process.env.STRAJA_GUARD_LISTEN_ADDR?.trim() || "127.0.0.1:8080";
  const consoleUrl = process.env.STRAJA_GUARD_CONSOLE_URL?.trim() || `http://${listenAddr}/console/`;
  const logPath = process.env.STRAJA_GUARD_LOG_PATH?.trim() || null;
  return {
    binaryPath,
    configPath,
    cwd,
    pidFile,
    logPath,
    listenAddr,
    consoleUrl,
  };
}

function getControlMode(): GuardStatus["controlMode"] {
  const externalControl = getExternalGuardControl();
  if (externalControl) {
    return "external_restartable";
  }
  if (isExternallyManaged()) {
    return "external_readonly";
  }
  return "managed";
}

function buildExternalGuardConfig(control: ExternalGuardControl): GuardConfig {
  const autoStartEnv = process.env.STRAJA_GUARD_AUTO_START?.trim().toLowerCase();
  const autoStart = autoStartEnv
    ? autoStartEnv === "1" || autoStartEnv === "true" || autoStartEnv === "yes" || autoStartEnv === "on"
    : false;
  return {
    binaryPath: control.binaryPath,
    configPath: control.configPath,
    listenAddr: control.listenAddr,
    consoleUrl: control.consoleUrl,
    autoStart,
    activationWebhookUrl: `http://127.0.0.1:${process.env.PORT || "8181"}/connections/guard/activation`,
  };
}

function readExternalGuardPid(control: ExternalGuardControl): number | null {
  try {
    const raw = readFileSync(control.pidFile, "utf-8").trim();
    if (!raw) {
      return null;
    }
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearExternalGuardPid(control: ExternalGuardControl): void {
  try {
    rmSync(control.pidFile, { force: true });
  } catch {
    // Ignore stale pidfile cleanup failures.
  }
}

function externalGuardError(action: "start" | "stop" | "restart"): { ok: false; error: string } {
  const guardUrl = getExternalGuardUrl();
  const target = guardUrl ? ` (${guardUrl})` : "";
  return {
    ok: false,
    error: `Guard is externally managed via STRAJA_GUARD_URL${target}. Use the dev stack to ${action} it.`,
  };
}

function persistRunningConfig(store: Store, config: GuardConfig): void {
  currentConfig = config;
  saveGuardConfig(store, config);
}

function resolveBundledGuardTrustKey(binaryPath?: string | null): string {
  const envKey = process.env.STRAJA_TRUST_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const candidateRoots: string[] = [];
  const pathCandidates = [
    binaryPath?.trim(),
    process.env.STRAJA_GUARD_PATH?.trim(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const value of pathCandidates) {
    if (value.includes("/")) {
      candidateRoots.push(resolve(dirname(value), "..", ".."));
    }
  }

  const appDataDir = process.env.STRAJA_WORKSPACE_APP_DATA_DIR?.trim();
  if (appDataDir) {
    candidateRoots.push(join(appDataDir, "runtime", "StrajaWorkspaceAlpha"));
  }

  for (const runtimeBundleRoot of candidateRoots) {
    const trustEnvPath = join(runtimeBundleRoot, "templates", "guard", "trust.env");
    if (!existsSync(trustEnvPath)) {
      continue;
    }
    try {
      const content = readFileSync(trustEnvPath, "utf-8");
      const match = content.match(/^STRAJA_TRUST_KEY=(.+)$/m);
      const key = match?.[1]?.trim();
      if (key) {
        return key;
      }
    } catch {
      // Fall through to the next candidate root.
    }
  }

  return "";
}

const GUARD_STARTUP_HEALTH_TIMEOUT_MS = 60_000;

async function waitForGuardUrl(
  guardUrl: string,
  timeoutMs = GUARD_STARTUP_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await checkGuardHealth(guardUrl);
    if (health?.healthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startExternalGuard(store: Store, control: ExternalGuardControl): Promise<{ ok: boolean; error?: string }> {
  const existingPid = readExternalGuardPid(control);
  if (isPidRunning(existingPid)) {
    const config = buildExternalGuardConfig(control);
    persistRunningConfig(store, config);
    return { ok: true };
  }

  clearExternalGuardPid(control);
  const guardTrustKey = resolveBundledGuardTrustKey(control.binaryPath);
  const env = {
    ...process.env,
    STRAJA_LISTEN_ADDR: control.listenAddr,
    ...(guardTrustKey ? { STRAJA_TRUST_KEY: guardTrustKey } : {}),
  };

  let stdio: any = "ignore";
  let logFd: number | null = null;
  if (control.logPath) {
    logFd = openSync(control.logPath, "a");
    stdio = ["ignore", logFd, logFd];
  }

  try {
    const child = spawn(control.binaryPath, ["--config", control.configPath], {
      cwd: control.cwd,
      env,
      detached: true,
      stdio,
    });
    if (logFd !== null) {
      closeSync(logFd);
    }
    if (!child.pid) {
      throw new Error("Guard process did not return a PID");
    }
    child.unref();
    writeFileSync(control.pidFile, `${child.pid}\n`, "utf-8");
    guardProcess = child;
    guardStartedAt = Date.now();
    lastError = null;

    const config = buildExternalGuardConfig(control);
    persistRunningConfig(store, config);

    const guardUrl = getExternalGuardUrl() ?? `http://${control.listenAddr}`;
    const ready = await waitForGuardUrl(guardUrl);
    if (!ready) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // Ignore if the child already exited.
      }
      clearExternalGuardPid(control);
      guardProcess = null;
      guardStartedAt = null;
      lastError = "Guard process started but did not become healthy";
      return { ok: false, error: lastError };
    }

    return { ok: true };
  } catch (err) {
    if (logFd !== null) {
      closeSync(logFd);
    }
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    clearExternalGuardPid(control);
    return { ok: false, error: msg };
  }
}

async function stopExternalGuard(control: ExternalGuardControl): Promise<{ ok: boolean; alreadyStopped?: boolean; error?: string }> {
  const pid = readExternalGuardPid(control);
  if (!isPidRunning(pid)) {
    clearExternalGuardPid(control);
    guardProcess = null;
    guardStartedAt = null;
    return { ok: true, alreadyStopped: true };
  }

  try {
    process.kill(pid!, "SIGTERM");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!isPidRunning(pid)) {
        clearExternalGuardPid(control);
        guardProcess = null;
        guardStartedAt = null;
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    process.kill(pid!, "SIGKILL");
    clearExternalGuardPid(control);
    guardProcess = null;
    guardStartedAt = null;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function startGuard(
  store: Store,
  configOverride?: Partial<GuardConfig>,
): Promise<{ ok: boolean; error?: string }> {
  const externalControl = getExternalGuardControl();
  if (isExternallyManaged() && !externalControl) {
    return externalGuardError("start");
  }
  if (externalControl) {
    return startExternalGuard(store, externalControl);
  }

  if (isRunning()) {
    return { ok: true }; // Already running
  }

  // Load or create config
  let config = loadGuardConfig(store);
  if (!config) {
    // Try to detect guard binary from environment or well-known paths
    const binaryPath = process.env.STRAJA_GUARD_PATH || "straja";
    const configDir = process.env.STRAJA_GUARD_CONFIG_DIR || join(process.cwd(), ".straja-guard");
    const configPath = join(configDir, "straja.yaml");
    const vaultPort = process.env.PORT || "8181";

    config = {
      binaryPath,
      configPath,
      listenAddr: "127.0.0.1:8080",
      consoleUrl: "http://127.0.0.1:8080/console/",
      autoStart: false,
      activationWebhookUrl: `http://127.0.0.1:${vaultPort}/connections/guard/activation`,
    };
  }

  if (configOverride) {
    config = { ...config, ...configOverride };
  }

  // Verify binary exists (if absolute path)
  if (config.binaryPath.includes("/") && !existsSync(config.binaryPath)) {
    const err = `Guard binary not found at ${config.binaryPath}`;
    lastError = err;
    return { ok: false, error: err };
  }

  // Ensure config directory exists
  const configDir = dirname(config.configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Generate straja.yaml if it doesn't exist
  if (!existsSync(config.configPath)) {
    generateDefaultConfig(config);
  }

  try {
    const guardTrustKey = resolveBundledGuardTrustKey(config.binaryPath);
    const env = {
      ...process.env,
      STRAJA_LISTEN_ADDR: config.listenAddr,
      ...(guardTrustKey ? { STRAJA_TRUST_KEY: guardTrustKey } : {}),
    };

    guardProcess = spawn(config.binaryPath, ["--config", config.configPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    guardStartedAt = Date.now();
    lastError = null;
    persistRunningConfig(store, config);

    // Capture stderr for error reporting
    let stderrBuf = "";
    guardProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      // Keep last 4KB
      if (stderrBuf.length > 4096) {
        stderrBuf = stderrBuf.slice(-4096);
      }
    });

    guardProcess.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      lastError = `Guard process exited: ${reason}`;
      if (stderrBuf.trim()) {
        lastError += ` — ${stderrBuf.trim().split("\n").pop()}`;
      }
      guardProcess = null;
      guardStartedAt = null;
    });

    guardProcess.on("error", (err) => {
      lastError = `Guard process error: ${err.message}`;
      guardProcess = null;
      guardStartedAt = null;
    });

    // Wait briefly for process to start (or fail immediately)
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!isRunning()) {
      return { ok: false, error: lastError || "Guard process failed to start" };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    return { ok: false, error: msg };
  }
}

export async function stopGuard(): Promise<{ ok: boolean; alreadyStopped?: boolean; error?: string }> {
  const externalControl = getExternalGuardControl();
  if (isExternallyManaged() && !externalControl) {
    return externalGuardError("stop");
  }
  if (externalControl) {
    return stopExternalGuard(externalControl);
  }

  if (!isRunning()) {
    guardProcess = null;
    guardStartedAt = null;
    return { ok: true, alreadyStopped: true };
  }

  try {
    guardProcess!.kill("SIGTERM");

    // Wait up to 5s for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (isRunning()) {
          guardProcess?.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      guardProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    guardProcess = null;
    guardStartedAt = null;
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
}

export async function restartGuard(store: Store): Promise<{ ok: boolean; error?: string }> {
  const externalControl = getExternalGuardControl();
  if (isExternallyManaged() && !externalControl) {
    return externalGuardError("restart");
  }
  if (externalControl) {
    const stopped = await stopExternalGuard(externalControl);
    if (!stopped.ok) {
      return { ok: false, error: stopped.error };
    }
    return startExternalGuard(store, externalControl);
  }

  await stopGuard();
  return startGuard(store);
}

export async function getGuardStatus(): Promise<GuardStatus> {
  const managedRunning = isRunning();
  const externalControl = getExternalGuardControl();
  const externalPid = externalControl ? readExternalGuardPid(externalControl) : null;
  const envGuardUrl = getExternalGuardUrl();
  const guardUrl = envGuardUrl
    || (externalControl ? `http://${externalControl.listenAddr}` : null)
    || (currentConfig ? `http://${currentConfig.listenAddr}` : null)
    || "http://127.0.0.1:8080";

  // Always probe the health endpoint — Guard may be running externally
  // (started by dev.sh, workspace launcher, or standalone).
  const health = await checkGuardHealth(guardUrl);
  const externallyRunning = !managedRunning && health !== null && health.healthy;
  const running = managedRunning || externallyRunning;
  const controlMode = getControlMode();

  const listenAddr = envGuardUrl
    ? new URL(envGuardUrl).host
    : externalControl?.listenAddr ?? currentConfig?.listenAddr ?? "127.0.0.1:8080";

  return {
    running,
    pid: guardProcess?.pid ?? externalPid ?? null,
    listenAddr,
    consoleUrl: currentConfig?.consoleUrl ?? `${guardUrl}/console/`,
    health,
    uptime: guardStartedAt ? Math.floor((Date.now() - guardStartedAt) / 1000) : null,
    config: currentConfig ?? (externalControl ? buildExternalGuardConfig(externalControl) : null),
    lastError,
    externallyManaged: Boolean(envGuardUrl || externalControl),
    controlMode,
  };
}

export function getGuardConfig(store: Store): GuardConfig | null {
  return currentConfig ?? loadGuardConfig(store);
}

export function updateGuardConfig(store: Store, updates: Partial<GuardConfig>): GuardConfig {
  const existing = currentConfig ?? loadGuardConfig(store) ?? {
    binaryPath: process.env.STRAJA_GUARD_PATH || "straja",
    configPath: "",
    listenAddr: "127.0.0.1:8080",
    consoleUrl: "http://127.0.0.1:8080/console/",
    autoStart: false,
    activationWebhookUrl: `http://127.0.0.1:${process.env.PORT || "8181"}/connections/guard/activation`,
  };

  const updated = { ...existing, ...updates };
  saveGuardConfig(store, updated);
  currentConfig = updated;
  return updated;
}

// ---------------------------------------------------------------------------
// Config File Generation
// ---------------------------------------------------------------------------

function generateDefaultConfig(config: GuardConfig): void {
  const yaml = `# Straja Guard configuration (auto-generated by Straja Workspace)
# See https://straja.ai/docs/configuration.html for full reference.

server:
  listen_addr: "${config.listenAddr}"
  read_timeout: 30s
  write_timeout: 60s

# Provider credentials — set via environment variables
providers:
  - id: openai_default
    type: openai
    api_key_env: OPENAI_API_KEY

  - id: claude_default
    type: claude
    api_key_env: ANTHROPIC_API_KEY

projects:
  - id: workspace
    provider: openai_default
    api_keys:
      - "sk-straja-workspace-local"

logging:
  level: info

activation:
  enabled: true
  sinks:
    - type: webhook
      url: "${config.activationWebhookUrl}"
      timeout: 5s
      retry_count: 2

policy:
  prompt_injection:
    action: block
  jailbreak:
    action: block
  pii:
    action: redact
  secrets:
    action: block
  data_exfil:
    action: block
`;

  const dir = dirname(config.configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(config.configPath, yaml, "utf-8");
}
