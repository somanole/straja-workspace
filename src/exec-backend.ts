/**
 * Execution Backend — Pluggable sandboxed command execution for Straja Vault
 *
 * The vault orchestrates execution: materializes workspace files → spawns
 * sandboxed command → captures output. The backend interface allows swapping
 * the sandbox engine (nono, Docker, remote, etc.) without changing the vault.
 *
 * NO FALLBACKS. If the configured backend is not available, execution fails.
 * This is a security boundary — never silently degrade to unsandboxed execution.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExecOptions {
  /** The command to execute (e.g., "python3", "node", "sh") */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Absolute path to the working directory (the materialized temp dir) */
  cwd: string;
  /** Timeout in milliseconds */
  timeout: number;
  /** Maximum output size in bytes for stdout/stderr (default: 1MB) */
  maxOutputSize: number;
  /** Optional environment variables to pass to the command */
  env?: Record<string, string>;
  /** When true, don't apply --net-block (used for repo-backed SE execution via proxy). */
  allowNetwork?: boolean;
  /** Extra files to allow read access to inside the sandbox (e.g. GIT_ASKPASS scripts). */
  extraReadFiles?: string[];
}

export interface ExecResult {
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Captured stdout (may be truncated to maxOutputSize) */
  stdout: string;
  /** Captured stderr (may be truncated to maxOutputSize) */
  stderr: string;
  /** Whether the process was killed due to timeout */
  timedOut: boolean;
}

export interface SpawnOptions {
  /** The command to execute */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Absolute path to the working directory */
  cwd: string;
  /** Stdin mode: "ignore" discards stdin, "pipe" allows writing to child stdin */
  stdinMode?: "ignore" | "pipe";
  /** Optional environment variables */
  env?: Record<string, string>;
  /** When true, don't apply --net-block (used for repo-backed SE execution via proxy). */
  allowNetwork?: boolean;
  /** Extra files to allow read access to inside the sandbox (e.g. GIT_ASKPASS scripts). */
  extraReadFiles?: string[];
}

export interface SpawnResult {
  /** The spawned child process */
  child: import("node:child_process").ChildProcess;
  /** Writable stdin stream (only if stdinMode was "pipe") */
  stdin: import("node:stream").Writable | undefined;
  /** Process ID */
  pid: number;
}

export interface ExecBackend {
  /** Human-readable backend name */
  readonly name: string;
  /** Check if this backend is available on the system */
  available(): boolean;
  /** Execute a command in the sandbox and wait for completion. */
  execute(opts: ExecOptions): Promise<ExecResult>;
  /** Spawn a command in the sandbox without waiting. Returns the child process handle.
   *  Caller is responsible for output buffering, timeout, and cleanup. */
  spawnProcess(opts: SpawnOptions): SpawnResult;
}

// ---------------------------------------------------------------------------
// Runtime tool paths — read-only access for version managers (pyenv, nvm, etc.)
// ---------------------------------------------------------------------------

/**
 * Auto-detect runtime version manager directories that should be readable
 * inside the sandbox. These contain interpreters and standard libraries —
 * not secrets. Write access is still blocked (sandbox only allows writes
 * to the materialized temp dir).
 *
 * Configurable via VAULT_EXEC_ALLOW_PATHS env var (colon-separated).
 */
/** Path to the vault's own node_modules (for exec sandbox access). */
const VAULT_NODE_MODULES = resolve(__dirname, "..", "node_modules");

function detectRuntimePaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  // User-configured additional paths (colon-separated, like PATH)
  if (process.env.VAULT_EXEC_ALLOW_PATHS) {
    for (const p of process.env.VAULT_EXEC_ALLOW_PATHS.split(":")) {
      const trimmed = p.trim();
      if (trimmed && existsSync(trimmed)) {
        paths.push(trimmed);
      }
    }
  }

  // Vault's node_modules — gives exec sessions access to vault-installed
  // libraries (xlsx, etc.) for data processing.
  if (existsSync(VAULT_NODE_MODULES)) {
    paths.push(VAULT_NODE_MODULES);
  }

  // Auto-detect common runtime version managers
  const candidates = [
    resolve(home, ".pyenv"),     // Python (pyenv)
    resolve(home, ".nvm"),       // Node.js (nvm)
    resolve(home, ".rustup"),    // Rust (rustup)
    resolve(home, ".cargo"),     // Rust (cargo binaries)
    resolve(home, ".rbenv"),     // Ruby (rbenv)
    resolve(home, ".goenv"),     // Go (goenv)
    resolve(home, ".volta"),     // Node.js (volta)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && !paths.includes(candidate)) {
      paths.push(candidate);
    }
  }

  return paths;
}

/**
 * Build the environment for exec child processes.
 * Merges process.env + caller overrides + NODE_PATH for vault libraries.
 */
function buildExecEnv(callerEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...callerEnv };

  // Ensure NODE_PATH includes the vault's node_modules so require('xlsx') etc. works
  if (existsSync(VAULT_NODE_MODULES)) {
    const existing = env.NODE_PATH || "";
    const parts = existing ? existing.split(":") : [];
    if (!parts.includes(VAULT_NODE_MODULES)) {
      parts.unshift(VAULT_NODE_MODULES);
    }
    env.NODE_PATH = parts.join(":");
  }

  return env;
}

// ---------------------------------------------------------------------------
// Nono Backend — Kernel-enforced sandboxing via Seatbelt (macOS) / Landlock (Linux)
// ---------------------------------------------------------------------------

export class NonoBackend implements ExecBackend {
  readonly name = "nono";

  private _nonoBin: string | null | undefined = undefined;
  private _runtimePaths: string[] | undefined = undefined;

  /** Resolve the nono binary path, caching the result. */
  private resolveNonoBin(): string | null {
    if (this._nonoBin !== undefined) return this._nonoBin;

    // 1. Try `which` (uses current PATH)
    try {
      const result = execFileSync("which", ["nono"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (result) {
        this._nonoBin = result;
        return this._nonoBin;
      }
    } catch {
      // `which` failed — try well-known installation paths
    }

    // 2. Check well-known installation paths (Cargo, Homebrew, /usr/local)
    const candidates = [
      resolve(homedir(), ".cargo", "bin", "nono"),
      "/usr/local/bin/nono",
      "/opt/homebrew/bin/nono",
    ];
    // Also check CARGO_HOME if set
    if (process.env.CARGO_HOME) {
      candidates.unshift(resolve(process.env.CARGO_HOME, "bin", "nono"));
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        this._nonoBin = candidate;
        return this._nonoBin;
      }
    }

    this._nonoBin = null;
    return this._nonoBin;
  }

  available(): boolean {
    return this.resolveNonoBin() !== null;
  }

  async execute(opts: ExecOptions): Promise<ExecResult> {
    const nonoBin = this.resolveNonoBin();
    if (!nonoBin) {
      throw new Error(
        "[vault-exec] nono binary not found. Install nono for sandboxed execution. " +
        "See: https://github.com/lhinds/nono"
      );
    }

    // Detect runtime paths once and cache
    if (this._runtimePaths === undefined) {
      this._runtimePaths = detectRuntimePaths();
    }

    // Build nono args:
    //   nono run --silent --allow <cwd> --allow <runtime>... [--net-block] --allow-cwd -- <command> [args...]
    const nonoArgs: string[] = [
      "run",
      "--silent",
      "--allow", opts.cwd,
      "--allow-cwd",
    ];
    // Allow access to user config/cache paths needed by common dev tools
    // nono requires --read-file for files, --allow for directories
    const homeReadFiles = [
      resolve(homedir(), ".gitconfig"),  // git config
      resolve(homedir(), ".profile"),    // login shell profile
      resolve(homedir(), ".bashrc"),     // bash config
      resolve(homedir(), ".zshrc"),      // zsh config
      resolve(homedir(), ".bash_profile"), // bash login profile
    ];
    const homeDirs = [
      resolve(homedir(), ".npm"),        // npm cache
      resolve(homedir(), ".cargo"),      // cargo/rust
    ];
    for (const f of homeReadFiles) {
      if (existsSync(f)) {
        nonoArgs.push("--read-file", f);
      }
    }
    for (const d of homeDirs) {
      if (existsSync(d)) {
        nonoArgs.push("--allow", d);
      }
    }
    // Grant read-only access to runtime version managers (pyenv, nvm, etc.)
    for (const runtimePath of this._runtimePaths) {
      nonoArgs.push("--allow", runtimePath);
    }
    // Extra read-only files (e.g. GIT_ASKPASS scripts in temp dirs)
    if (opts.extraReadFiles) {
      for (const f of opts.extraReadFiles) {
        if (existsSync(f)) {
          nonoArgs.push("--allow-file", f);
        }
      }
    }
    // Network blocked unless explicitly allowed (repo-backed SE agent execution).
    if (!opts.allowNetwork) {
      nonoArgs.push("--net-block");
    }
    nonoArgs.push("--", opts.command, ...opts.args);

    return new Promise<ExecResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killed = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const child = spawn(nonoBin, nonoArgs, {
        cwd: opts.cwd,
        env: buildExecEnv(opts.env),
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < opts.maxOutputSize) {
          stdout += chunk.toString();
          if (stdout.length > opts.maxOutputSize) {
            stdout = stdout.slice(0, opts.maxOutputSize) + "\n[output truncated]";
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < opts.maxOutputSize) {
          stderr += chunk.toString();
          if (stderr.length > opts.maxOutputSize) {
            stderr = stderr.slice(0, opts.maxOutputSize) + "\n[output truncated]";
          }
        }
      });

      // Timeout: SIGTERM first, then SIGKILL after 5s grace period
      if (opts.timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          if (!killed) {
            child.kill("SIGTERM");
            setTimeout(() => {
              if (!killed) {
                child.kill("SIGKILL");
              }
            }, 5000);
          }
        }, opts.timeout);
      }

      child.on("close", (code) => {
        killed = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          timedOut,
        });
      });

      child.on("error", (err) => {
        killed = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + `\n[spawn error] ${String(err)}`,
          timedOut: false,
        });
      });
    });
  }

  /**
   * Spawn a sandboxed process without waiting for completion.
   * Returns the child process handle immediately. The caller is responsible
   * for output buffering, timeout management, and cleanup.
   *
   * Used by the exec-registry for background/interactive sessions.
   */
  spawnProcess(opts: SpawnOptions): SpawnResult {
    const nonoBin = this.resolveNonoBin();
    if (!nonoBin) {
      throw new Error(
        "[vault-exec] nono binary not found. Install nono for sandboxed execution. " +
        "See: https://github.com/lhinds/nono"
      );
    }

    // Detect runtime paths once and cache
    if (this._runtimePaths === undefined) {
      this._runtimePaths = detectRuntimePaths();
    }

    // Build nono args (same as execute())
    const nonoArgs: string[] = [
      "run",
      "--silent",
      "--allow", opts.cwd,
      "--allow-cwd",
    ];
    // Allow access to user config/cache paths needed by common dev tools
    const homeReadFiles2 = [
      resolve(homedir(), ".gitconfig"),  // git config
      resolve(homedir(), ".profile"),    // login shell profile
      resolve(homedir(), ".bashrc"),     // bash config
      resolve(homedir(), ".zshrc"),      // zsh config
      resolve(homedir(), ".bash_profile"), // bash login profile
    ];
    const homeDirs2 = [
      resolve(homedir(), ".npm"),
      resolve(homedir(), ".cargo"),
    ];
    for (const f of homeReadFiles2) {
      if (existsSync(f)) {
        nonoArgs.push("--read-file", f);
      }
    }
    for (const d of homeDirs2) {
      if (existsSync(d)) {
        nonoArgs.push("--allow", d);
      }
    }
    for (const runtimePath of this._runtimePaths) {
      nonoArgs.push("--allow", runtimePath);
    }
    // Extra read-only files (e.g. GIT_ASKPASS scripts in temp dirs)
    if (opts.extraReadFiles) {
      for (const f of opts.extraReadFiles) {
        if (existsSync(f)) {
          nonoArgs.push("--allow-file", f);
        }
      }
    }
    // Network blocked unless explicitly allowed (repo-backed SE agent execution).
    if (!opts.allowNetwork) {
      nonoArgs.push("--net-block");
    }
    nonoArgs.push("--", opts.command, ...opts.args);

    const stdinMode = opts.stdinMode ?? "ignore";

    // Validate cwd exists — spawn throws misleading ENOENT (looks like
    // binary not found) when cwd doesn't exist.
    if (!existsSync(opts.cwd)) {
      throw new Error(`[vault-exec] Working directory does not exist: ${opts.cwd}`);
    }

    const child = spawn(nonoBin, nonoArgs, {
      cwd: opts.cwd,
      env: buildExecEnv(opts.env),
      stdio: [stdinMode === "pipe" ? "pipe" : "ignore", "pipe", "pipe"],
    });

    // Attach a no-op error handler immediately to prevent unhandled 'error'
    // events (e.g. ENOENT) from crashing the process. Callers are expected
    // to attach their own handler; this just prevents the fatal throw.
    child.on("error", () => {});

    if (!child.pid) {
      throw new Error("[vault-exec] Failed to spawn process — no PID assigned");
    }

    return {
      child,
      stdin: stdinMode === "pipe" ? (child.stdin ?? undefined) : undefined,
      pid: child.pid,
    };
  }
}

// ---------------------------------------------------------------------------
// Backend Resolution
// ---------------------------------------------------------------------------

const backendInstances = new Map<string, ExecBackend>();

/**
 * Resolve the execution backend. Returns a NonoBackend.
 * Throws if the backend is not available — no fallbacks.
 *
 * @param preference - Backend name. Currently only "nono" is supported.
 *                     Defaults to VAULT_EXEC_BACKEND env var, or "nono".
 */
export function resolveBackend(
  preference?: string,
): ExecBackend {
  const name = preference || process.env.VAULT_EXEC_BACKEND || "nono";

  // Return cached instance if available
  const cached = backendInstances.get(name);
  if (cached) return cached;

  let backend: ExecBackend;
  switch (name) {
    case "nono":
      backend = new NonoBackend();
      break;
    default:
      throw new Error(`[vault-exec] Unknown execution backend: "${name}". Only "nono" is supported.`);
  }

  if (!backend.available()) {
    throw new Error(
      `[vault-exec] Execution backend "${name}" is not available. ` +
      `Install nono: cd /path/to/nono && make install`
    );
  }

  backendInstances.set(name, backend);
  return backend;
}
