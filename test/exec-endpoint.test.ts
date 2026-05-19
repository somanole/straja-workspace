/**
 * POST /exec Endpoint Integration Tests
 *
 * Tests the full execution flow: materialization → sandboxed execution → file capture → cleanup.
 * Uses a real test database and HTTP server (follows mcp.test.ts HTTP transport pattern).
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { openDatabase, loadSqliteVec } from "../src/db.js";
import type { Database } from "../src/db.js";
import { mkdtemp, writeFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import type { CollectionConfig } from "../src/collections";
import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp";
import { hashContent } from "../src/store.js";
import { NonoBackend } from "../src/exec-backend.js";

const nonoAvailable = new NonoBackend().available();

// =============================================================================
// Test Database Setup (mirrors mcp.test.ts pattern)
// =============================================================================

function initTestDatabase(db: Database): void {
  loadSqliteVec(db);
  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      hash TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (hash) REFERENCES content(hash) ON DELETE CASCADE,
      UNIQUE(collection, path)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection, active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(hash)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      hash TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_vectors (
      hash TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      pos INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      embedded_at TEXT NOT NULL,
      PRIMARY KEY (hash, seq)
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      filepath, title, body,
      tokenize='porter unicode61'
    )
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents
    WHEN new.active = 1
    BEGIN
      INSERT INTO documents_fts(rowid, filepath, title, body)
      SELECT
        new.id,
        new.collection || '/' || new.path,
        new.title,
        (SELECT doc FROM content WHERE hash = new.hash)
      WHERE new.active = 1;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      DELETE FROM documents_fts WHERE rowid = old.id;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents
    BEGIN
      DELETE FROM documents_fts WHERE rowid = old.id AND new.active = 0;
      INSERT OR REPLACE INTO documents_fts(rowid, filepath, title, body)
      SELECT
        new.id,
        new.collection || '/' || new.path,
        new.title,
        (SELECT doc FROM content WHERE hash = new.hash)
      WHERE new.active = 1;
    END
  `);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vectors_vec USING vec0(hash_seq TEXT PRIMARY KEY, embedding float[768] distance_metric=cosine)`);

  // Create path_contexts table for test compatibility
  db.exec(`
    CREATE TABLE IF NOT EXISTS path_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT,
      path TEXT,
      context TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

async function seedWorkspaceFiles(db: Database): Promise<void> {
  const now = new Date().toISOString();
  const files: { path: string; content: string }[] = [
    { path: "hello.py", content: 'print("hello from vault")' },
    { path: "data/input.txt", content: "line1\nline2\nline3" },
    { path: "src/main.ts", content: 'console.log("hello");\n' },
  ];

  for (const file of files) {
    const hash = await hashContent(file.content);
    db.prepare(`INSERT OR IGNORE INTO content (hash, doc, created_at) VALUES (?, ?, ?)`).run(hash, file.content, now);
    db.prepare(`INSERT INTO documents (collection, path, title, hash, created_at, modified_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
      "_workspace", file.path, file.path, hash, now, now
    );
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(!nonoAvailable)("POST /exec endpoint", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let httpTestDbPath: string;
  let httpTestConfigDir: string;
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    // Create isolated test database with workspace files
    httpTestDbPath = `/tmp/vault-exec-test-${Date.now()}.sqlite`;
    const db = openDatabase(httpTestDbPath);
    initTestDatabase(db);
    await seedWorkspaceFiles(db);
    db.close();

    // Create isolated YAML config (minimal — no collections needed)
    const configPrefix = join(tmpdir(), `vault-exec-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    httpTestConfigDir = await mkdtemp(configPrefix);
    const testConfig: CollectionConfig = { collections: {} };
    await writeFile(join(httpTestConfigDir, "index.yml"), YAML.stringify(testConfig));

    process.env.INDEX_PATH = httpTestDbPath;
    process.env.VAULT_CONFIG_DIR = httpTestConfigDir;
    delete process.env.VAULT_HTTP_ADMIN_TOKEN;

    handle = await startMcpHttpServer(0, { quiet: true });
    baseUrl = `http://localhost:${handle.port}`;
  });

  afterAll(async () => {
    await handle.stop();

    if (origIndexPath !== undefined) process.env.INDEX_PATH = origIndexPath;
    else delete process.env.INDEX_PATH;
    if (origConfigDir !== undefined) process.env.VAULT_CONFIG_DIR = origConfigDir;
    else delete process.env.VAULT_CONFIG_DIR;
    if (origAdminToken !== undefined) process.env.VAULT_HTTP_ADMIN_TOKEN = origAdminToken;
    else delete process.env.VAULT_HTTP_ADMIN_TOKEN;

    try { require("fs").unlinkSync(httpTestDbPath); } catch {}
    try {
      const files = await readdir(httpTestConfigDir);
      for (const f of files) await unlink(join(httpTestConfigDir, f));
      await rmdir(httpTestConfigDir);
    } catch {}
  });

  // ---------------------------------------------------------------------------
  // Basic execution
  // ---------------------------------------------------------------------------

  test("executes a simple command and captures stdout", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "echo", args: ["hello from exec"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe("hello from exec");
    expect(body.timedOut).toBe(false);
    expect(body.backend).toBe("nono");
  });

  test("captures stderr", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "sh", args: ["-c", "echo error-output >&2"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.stderr.trim()).toBe("error-output");
  });

  test("returns non-zero exit code", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "sh", args: ["-c", "exit 42"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(42);
    expect(body.timedOut).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Materialization — workspace files available during execution
  // ---------------------------------------------------------------------------

  test("materializes workspace files for the command to read", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat", args: ["hello.py"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe('print("hello from vault")');
  });

  test("materializes files in subdirectories", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat", args: ["data/input.txt"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe("line1\nline2\nline3");
  });

  test("lists all materialized files", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "sh", args: ["-c", "find . -type f | sort"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    const files = body.stdout.trim().split("\n").sort();
    expect(files).toContain("./data/input.txt");
    expect(files).toContain("./hello.py");
    expect(files).toContain("./src/main.ts");
  });

  // ---------------------------------------------------------------------------
  // File capture — new, modified, deleted files
  // ---------------------------------------------------------------------------

  test("captures new file created by command", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sh",
        args: ["-c", "echo 'new file content' > output.txt"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "output.txt", action: "created" }),
      ])
    );

    // Verify the file is now in the vault
    const rawRes = await fetch(`${baseUrl}/raw/_workspace/output.txt`);
    expect(rawRes.status).toBe(200);
    const content = await rawRes.text();
    expect(content.trim()).toBe("new file content");
  });

  test("captures modified file", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sh",
        args: ["-c", "echo 'modified content' > hello.py"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "hello.py", action: "modified" }),
      ])
    );

    // Verify the vault has the updated content
    const rawRes = await fetch(`${baseUrl}/raw/_workspace/hello.py`);
    expect(rawRes.status).toBe(200);
    const content = await rawRes.text();
    expect(content.trim()).toBe("modified content");
  });

  test("detects deleted file", async () => {
    // First, create a file in the workspace to delete
    await fetch(`${baseUrl}/raw/_workspace/to-delete.txt`, {
      method: "PUT",
      body: "delete me",
    });

    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sh",
        args: ["-c", "rm to-delete.txt"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "to-delete.txt", action: "deleted" }),
      ])
    );

    // Verify the file is deactivated in the vault
    const rawRes = await fetch(`${baseUrl}/raw/_workspace/to-delete.txt`);
    expect(rawRes.status).toBe(404);
  });

  test("captures file in new subdirectory", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sh",
        args: ["-c", "mkdir -p new/nested && echo 'deep' > new/nested/deep.txt"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "new/nested/deep.txt", action: "created" }),
      ])
    );
  });

  test("reports no changes when command only reads", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat", args: ["src/main.ts"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Timeout enforcement
  // ---------------------------------------------------------------------------

  test("kills command that exceeds timeout", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sleep",
        args: ["60"],
        timeout: 1, // 1 second
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.timedOut).toBe(true);
    expect(body.exitCode).not.toBe(0);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  test("returns 400 when command is missing", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["hello"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("command");
  });

  test("returns 400 for invalid JSON body", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Empty workspace
  // ---------------------------------------------------------------------------

  test("works with empty workspace (custom collection)", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "sh",
        args: ["-c", "echo 'created in empty' > new-file.txt"],
        collection: "_empty_test",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.filesChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "new-file.txt", action: "created" }),
      ])
    );

    // Verify the file was captured into the custom collection
    const rawRes = await fetch(`${baseUrl}/raw/_empty_test/new-file.txt`);
    expect(rawRes.status).toBe(200);
    const content = await rawRes.text();
    expect(content.trim()).toBe("created in empty");
  });

  // ---------------------------------------------------------------------------
  // cwd parameter
  // ---------------------------------------------------------------------------

  test("respects cwd parameter within workspace", async () => {
    const res = await fetch(`${baseUrl}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "cat",
        args: ["input.txt"],
        cwd: "data",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.exitCode).toBe(0);
    expect(body.stdout.trim()).toBe("line1\nline2\nline3");
  });
});
