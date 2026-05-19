import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NonoBackend, resolveBackend, type ExecOptions } from "../src/exec-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nonoAvailable = new NonoBackend().available();

let tempDir: string;

function defaultOpts(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    command: "echo",
    args: ["hello"],
    cwd: tempDir,
    timeout: 30_000,
    allowNetwork: false,
    maxOutputSize: 1_048_576,
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "vault-exec-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// NonoBackend.available()
// ---------------------------------------------------------------------------

describe("NonoBackend.available()", () => {
  test.skipIf(!nonoAvailable)("returns true when nono is installed", () => {
    const backend = new NonoBackend();
    expect(backend.available()).toBe(true);
  });

  test("returns false when nono binary cache is null", () => {
    // Simulate nono not being found by directly setting the cache
    const backend = new NonoBackend();
    (backend as any)._nonoBin = null; // Pretend resolution already ran and failed
    expect(backend.available()).toBe(false);
  });

  test.skipIf(!nonoAvailable)("caches the resolved binary path", () => {
    const backend = new NonoBackend();
    // First call resolves
    const firstResult = backend.available();
    expect(firstResult).toBe(true);
    // The resolved path should be cached
    expect((backend as any)._nonoBin).toBeTruthy();
    // Second call uses cache (doesn't re-resolve)
    expect(backend.available()).toBe(true);
    expect((backend as any)._nonoBin).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// NonoBackend.execute()
// ---------------------------------------------------------------------------

describe.skipIf(!nonoAvailable)("NonoBackend.execute()", () => {
  test("runs a simple command and captures stdout", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "echo",
      args: ["hello from nono"],
    }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello from nono");
    expect(result.timedOut).toBe(false);
  });

  test("captures stderr", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", "echo error-msg >&2"],
    }));

    expect(result.stderr.trim()).toBe("error-msg");
  });

  test("returns non-zero exit code", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", "exit 42"],
    }));

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  test("can read files in the allowed directory", async () => {
    await writeFile(join(tempDir, "input.txt"), "vault content");

    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "cat",
      args: ["input.txt"],
    }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("vault content");
  });

  test("can write files in the allowed directory", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", "echo created > output.txt"],
    }));

    expect(result.exitCode).toBe(0);
    const content = await readFile(join(tempDir, "output.txt"), "utf-8");
    expect(content.trim()).toBe("created");
  });

  test("cannot read sensitive user files (sandbox deny policy)", async () => {
    // nono's default policy blocks sensitive paths like ~/.ssh, ~/.gnupg, ~/.aws
    // Note: cross-/tmp isolation is not enforced on macOS Seatbelt (system paths include /private/tmp)
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "ls",
      args: [join(process.env.HOME || "/Users/stelo", ".ssh")],
    }));

    // Should fail — nono's deny policy blocks ~/.ssh
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Operation not permitted");
  });

  test("cannot write to user home directory", async () => {
    const home = process.env.HOME || "/Users/stelo";
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", `echo hacked > ${join(home, ".vault-exec-test-pwned")}`],
    }));

    // Sandbox should block writes to home dir
    expect(result.exitCode).not.toBe(0);
  });

  test("handles subdirectory creation within allowed directory", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", "mkdir -p sub/dir && echo nested > sub/dir/file.txt"],
    }));

    expect(result.exitCode).toBe(0);
    const content = await readFile(join(tempDir, "sub", "dir", "file.txt"), "utf-8");
    expect(content.trim()).toBe("nested");
  });
});

// ---------------------------------------------------------------------------
// Timeout enforcement
// ---------------------------------------------------------------------------

describe.skipIf(!nonoAvailable)("NonoBackend timeout", () => {
  test("kills command that exceeds timeout", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sleep",
      args: ["60"],
      timeout: 1000, // 1 second
    }));

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

describe.skipIf(!nonoAvailable)("NonoBackend output truncation", () => {
  test("truncates stdout when exceeding maxOutputSize", async () => {
    const backend = new NonoBackend();
    const result = await backend.execute(defaultOpts({
      command: "sh",
      args: ["-c", "yes 'aaaaaaaaaa' | head -10000"],
      maxOutputSize: 1000,
    }));

    expect(result.stdout.length).toBeLessThanOrEqual(1100); // Allow some slack for "[output truncated]"
    expect(result.stdout).toContain("[output truncated]");
  });
});

// ---------------------------------------------------------------------------
// resolveBackend()
// ---------------------------------------------------------------------------

describe("resolveBackend()", () => {
  test.skipIf(!nonoAvailable)("returns NonoBackend when nono is available", () => {
    const backend = resolveBackend("nono");
    expect(backend.name).toBe("nono");
    expect(backend.available()).toBe(true);
  });

  test("throws for unknown backend name", () => {
    expect(() => resolveBackend("docker")).toThrow("Unknown execution backend");
  });

  test.skipIf(!nonoAvailable)("defaults to nono", () => {
    const backend = resolveBackend();
    expect(backend.name).toBe("nono");
  });
});
