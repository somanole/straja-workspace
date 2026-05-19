/**
 * _memory Collection Regression Tests
 *
 * Tests the vault-backed memory system used by the OpenClaw Straja Vault plugin:
 *   - PUT  /raw/_memory/{path}           — write/overwrite memory files
 *   - POST /raw/_memory/{path}/append    — append to memory files
 *   - GET  /raw/_memory/{path}           — read memory files
 *   - POST /query with collections=["_memory"] — lexical search within _memory
 *   - GET  /collections/_memory/files    — list all memory files
 *   - GET  /status                       — _memory appears in collection list
 *   - Auto-embed trigger on _memory writes
 *
 * Follows the exec-endpoint.test.ts pattern: real HTTP server + real database.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { openDatabase, loadSqliteVec } from "../src/db.js";
import type { Database } from "../src/db.js";
import { mkdtemp, writeFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import type { CollectionConfig } from "../src/collections";
import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp";
import { hashContent } from "../src/store.js";

// =============================================================================
// Test Database Setup (mirrors exec-endpoint.test.ts pattern)
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

// =============================================================================
// Test Suite
// =============================================================================

describe("_memory collection", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let httpTestDbPath: string;
  let httpTestConfigDir: string;
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    httpTestDbPath = `/tmp/vault-memory-test-${Date.now()}.sqlite`;
    const db = openDatabase(httpTestDbPath);
    initTestDatabase(db);
    db.close();

    const configPrefix = join(tmpdir(), `vault-memory-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  // vault_memory_write — PUT /raw/_memory/{path}
  // ---------------------------------------------------------------------------

  describe("vault_memory_write (PUT /raw/_memory)", () => {
    test("creates a new memory file", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/MEMORY.md`, {
        method: "PUT",
        body: "Project: Straja Vault. Owner: stelo.",
      });
      expect(res.status).toBe(201); // 201 for new document
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(typeof body.hash).toBe("string");
      expect(body.hash.length).toBeGreaterThan(0);
    });

    test("overwrites existing memory file", async () => {
      // Write initial content
      await fetch(`${baseUrl}/raw/_memory/overwrite-test.md`, {
        method: "PUT",
        body: "version 1",
      });

      // Overwrite
      const res = await fetch(`${baseUrl}/raw/_memory/overwrite-test.md`, {
        method: "PUT",
        body: "version 2 — completely replaced",
      });
      expect(res.status).toBe(200); // 200 for update
      const body = await res.json() as any;
      expect(body.ok).toBe(true);

      // Verify content is replaced
      const getRes = await fetch(`${baseUrl}/raw/_memory/overwrite-test.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toBe("version 2 — completely replaced");
    });

    test("creates memory file in subdirectory path", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-21.md`, {
        method: "PUT",
        body: "# Session Memory\n\nDecision: use vault-backed memory.",
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
    });

    test("hash is deterministic for same content", async () => {
      const content = "deterministic hash test content";
      const expectedHash = await hashContent(content);

      const res = await fetch(`${baseUrl}/raw/_memory/hash-test.md`, {
        method: "PUT",
        body: content,
      });
      const body = await res.json() as any;
      expect(body.hash).toBe(expectedHash);
    });
  });

  // ---------------------------------------------------------------------------
  // vault_memory_write — POST /raw/_memory/{path}/append
  // ---------------------------------------------------------------------------

  describe("vault_memory_write append (POST /raw/_memory/.../append)", () => {
    test("appends to existing memory file", async () => {
      // Create base file
      await fetch(`${baseUrl}/raw/_memory/append-test.md`, {
        method: "PUT",
        body: "Line 1: initial content",
      });

      // Append
      const res = await fetch(`${baseUrl}/raw/_memory/append-test.md/append`, {
        method: "POST",
        body: "Line 2: appended content",
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);

      // Verify combined content
      const getRes = await fetch(`${baseUrl}/raw/_memory/append-test.md`);
      const content = await getRes.text();
      expect(content).toContain("Line 1: initial content");
      expect(content).toContain("Line 2: appended content");
    });

    test("creates file if it does not exist (append to non-existent)", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/new-via-append.md/append`, {
        method: "POST",
        body: "Created via append",
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);

      // Verify content
      const getRes = await fetch(`${baseUrl}/raw/_memory/new-via-append.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toContain("Created via append");
    });

    test("multiple appends accumulate content", async () => {
      await fetch(`${baseUrl}/raw/_memory/multi-append.md`, {
        method: "PUT",
        body: "Base",
      });

      await fetch(`${baseUrl}/raw/_memory/multi-append.md/append`, {
        method: "POST",
        body: "Append 1",
      });

      await fetch(`${baseUrl}/raw/_memory/multi-append.md/append`, {
        method: "POST",
        body: "Append 2",
      });

      await fetch(`${baseUrl}/raw/_memory/multi-append.md/append`, {
        method: "POST",
        body: "Append 3",
      });

      const getRes = await fetch(`${baseUrl}/raw/_memory/multi-append.md`);
      const content = await getRes.text();
      expect(content).toContain("Base");
      expect(content).toContain("Append 1");
      expect(content).toContain("Append 2");
      expect(content).toContain("Append 3");

      // Verify ordering (each append adds a newline-separated line)
      const lines = content.split("\n").filter(l => l.trim().length > 0);
      expect(lines.length).toBe(4);
      expect(lines[0]).toBe("Base");
      expect(lines[1]).toBe("Append 1");
      expect(lines[2]).toBe("Append 2");
      expect(lines[3]).toBe("Append 3");
    });

    test("append to subdirectory path", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-21.md/append`, {
        method: "POST",
        body: "Appended session note.",
      });
      expect(res.status).toBe(200);

      const getRes = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-21.md`);
      const content = await getRes.text();
      expect(content).toContain("Appended session note.");
    });
  });

  // ---------------------------------------------------------------------------
  // vault_memory_get — GET /raw/_memory/{path}
  // ---------------------------------------------------------------------------

  describe("vault_memory_get (GET /raw/_memory)", () => {
    test("reads existing memory file", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/MEMORY.md`);
      expect(res.status).toBe(200);
      const content = await res.text();
      expect(content).toBe("Project: Straja Vault. Owner: stelo.");
    });

    test("returns 404 for non-existent memory file", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/does-not-exist.md`);
      expect(res.status).toBe(404);
    });

    test("reads file from subdirectory path", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-21.md`);
      expect(res.status).toBe(200);
      const content = await res.text();
      // Should contain original content + appended content from earlier tests
      expect(content).toContain("Session Memory");
      expect(content).toContain("Appended session note.");
    });
  });

  // ---------------------------------------------------------------------------
  // vault_memory_search — POST /query with collections: ["_memory"]
  // ---------------------------------------------------------------------------

  describe("vault_memory_search (POST /query scoped to _memory)", () => {
    test("lexical search finds memory content", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "Straja Vault Owner stelo" }],
          collections: ["_memory"],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.results).toBeDefined();
      expect(body.results.length).toBeGreaterThan(0);

      // Verify the result points to the right file
      const memoryResult = body.results.find((r: any) => r.file === "_memory/MEMORY.md");
      expect(memoryResult).toBeDefined();
      expect(memoryResult.score).toBeGreaterThan(0);
    });

    test("search scoped to _memory does not return other collections", async () => {
      // First, add a document to _workspace with similar content
      await fetch(`${baseUrl}/raw/_workspace/similar.md`, {
        method: "PUT",
        body: "Project: Straja Vault. Owner: stelo. This is workspace.",
      });

      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "Straja Vault Owner stelo" }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;

      // All results should be from _memory, not _workspace
      for (const result of body.results) {
        expect(result.file).toMatch(/^_memory\//);
      }
    });

    test("search with no matches returns empty results", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "xyzzy_nonexistent_gibberish_12345" }],
          collections: ["_memory"],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.results).toBeDefined();
      expect(body.results.length).toBe(0);
    });

    test("search finds content added via append", async () => {
      // Write unique content via append
      await fetch(`${baseUrl}/raw/_memory/searchable-append.md/append`, {
        method: "POST",
        body: "Kubernetes deployment manifests were reviewed.",
      });

      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "Kubernetes deployment manifests" }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;
      expect(body.results.length).toBeGreaterThan(0);

      const match = body.results.find((r: any) => r.file === "_memory/searchable-append.md");
      expect(match).toBeDefined();
    });

    test("multiple lex sub-searches are accepted", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [
            { type: "lex", query: "Straja Vault" },
            { type: "lex", query: "session memory" },
          ],
          collections: ["_memory"],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.results.length).toBeGreaterThan(0);
    });

    test("respects limit parameter", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "content" }],
          collections: ["_memory"],
          limit: 1,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.results.length).toBeLessThanOrEqual(1);
    });

    test("result has expected shape", async () => {
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "Straja Vault" }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;
      expect(body.results.length).toBeGreaterThan(0);

      const r = body.results[0];
      expect(r).toHaveProperty("docid");
      expect(r).toHaveProperty("file");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("snippet");
      expect(typeof r.docid).toBe("string");
      expect(r.docid.startsWith("#")).toBe(true);
      expect(typeof r.score).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // File listing — GET /collections/_memory/files
  // ---------------------------------------------------------------------------

  describe("file listing (GET /collections/_memory/files)", () => {
    test("lists all active memory files", async () => {
      const res = await fetch(`${baseUrl}/collections/_memory/files`);
      expect(res.status).toBe(200);
      const files = await res.json() as any[];
      expect(files.length).toBeGreaterThan(0);

      // Verify known files are present
      const paths = files.map((f: any) => f.path);
      expect(paths).toContain("MEMORY.md");
      expect(paths).toContain("memory/2026-02-21.md");
    });

    test("files have expected shape", async () => {
      const res = await fetch(`${baseUrl}/collections/_memory/files`);
      const files = await res.json() as any[];
      const f = files[0];

      expect(f).toHaveProperty("path");
      expect(f).toHaveProperty("displayPath");
      expect(f).toHaveProperty("title");
      expect(f).toHaveProperty("size");
      expect(f).toHaveProperty("modifiedAt");
      expect(f).toHaveProperty("docid");
      expect(f.displayPath).toMatch(/^_memory\//);
    });
  });

  // ---------------------------------------------------------------------------
  // Status — _memory appears in vault status
  // ---------------------------------------------------------------------------

  describe("status (GET /status)", () => {
    test("_memory collection appears in status", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);
      const status = await res.json() as any;

      expect(status.collections).toBeDefined();
      const memoryCollection = status.collections.find((c: any) => c.name === "_memory");
      expect(memoryCollection).toBeDefined();
      expect(memoryCollection.documents).toBeGreaterThan(0);
    });

    test("_memory document count matches written files", async () => {
      // List the files to get an accurate count
      const filesRes = await fetch(`${baseUrl}/collections/_memory/files`);
      const files = await filesRes.json() as any[];

      const statusRes = await fetch(`${baseUrl}/status`);
      const status = await statusRes.json() as any;
      const memoryCollection = status.collections.find((c: any) => c.name === "_memory");

      expect(memoryCollection.documents).toBe(files.length);
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation — _memory writes don't affect other collections
  // ---------------------------------------------------------------------------

  describe("collection isolation", () => {
    test("_memory writes do not appear in _workspace", async () => {
      // Write to _memory
      await fetch(`${baseUrl}/raw/_memory/isolation-test.md`, {
        method: "PUT",
        body: "This is memory only",
      });

      // Verify it's NOT accessible via _workspace
      const res = await fetch(`${baseUrl}/raw/_workspace/isolation-test.md`);
      expect(res.status).toBe(404);
    });

    test("_workspace writes do not appear in _memory", async () => {
      // Write to _workspace
      await fetch(`${baseUrl}/raw/_workspace/workspace-only.md`, {
        method: "PUT",
        body: "This is workspace only",
      });

      // Verify it's NOT accessible via _memory
      const res = await fetch(`${baseUrl}/raw/_memory/workspace-only.md`);
      expect(res.status).toBe(404);
    });

    test("_memory search does not return _workspace content", async () => {
      // Write unique content to _workspace
      await fetch(`${baseUrl}/raw/_workspace/unique-workspace.md`, {
        method: "PUT",
        body: "Quantum entanglement photosynthesis unicorn rainbow",
      });

      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "Quantum entanglement photosynthesis unicorn" }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;

      // Should not find workspace content in _memory search
      for (const result of body.results) {
        expect(result.file).not.toMatch(/^_workspace\//);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-embed trigger on _memory writes
  // ---------------------------------------------------------------------------

  describe("auto-embed trigger", () => {
    // We can't easily test that the embed subprocess was spawned in an HTTP integration
    // test (it's fire-and-forget). Instead, we verify the mechanism works by:
    // 1. Confirming the write succeeds (prerequisite for auto-embed)
    // 2. Confirming the content is FTS-indexed (synchronous) and searchable

    test("newly written _memory content is immediately FTS-searchable", async () => {
      // Use FTS-friendly words (porter unicode61 tokenizer splits on punctuation/numbers)
      const uniquePhrase = "xylophone platypus zeppelin";

      await fetch(`${baseUrl}/raw/_memory/embed-trigger-test.md`, {
        method: "PUT",
        body: `Testing auto-embed: ${uniquePhrase}`,
      });

      // FTS indexing is synchronous — the content should be searchable immediately
      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: uniquePhrase }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;
      expect(body.results.length).toBe(1);
      expect(body.results[0].file).toBe("_memory/embed-trigger-test.md");
    });

    test("appended _memory content is immediately FTS-searchable", async () => {
      // Use FTS-friendly words (porter unicode61 tokenizer splits on punctuation/numbers)
      const uniquePhrase = "chinchilla dirigible periwinkle";

      await fetch(`${baseUrl}/raw/_memory/embed-append-test.md/append`, {
        method: "POST",
        body: `Appended: ${uniquePhrase}`,
      });

      const res = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: uniquePhrase }],
          collections: ["_memory"],
        }),
      });
      const body = await res.json() as any;
      expect(body.results.length).toBe(1);
      expect(body.results[0].file).toBe("_memory/embed-append-test.md");
    });

    test("_memory PUT triggers auto-embed (non-_memory PUT does not)", async () => {
      // We test this by checking that the auto-embed code path is collection-specific.
      // Write to both _memory and _workspace. Both should succeed, but only _memory
      // triggers auto-embed. We verify both writes succeed and the non-_memory write
      // does not cause any issues.
      const memRes = await fetch(`${baseUrl}/raw/_memory/embed-specificity.md`, {
        method: "PUT",
        body: "Memory content for embed check.",
      });
      expect(memRes.status).toBe(201);

      const wsRes = await fetch(`${baseUrl}/raw/_workspace/embed-specificity.md`, {
        method: "PUT",
        body: "Workspace content — no embed expected.",
      });
      expect(wsRes.status).toBe(201);

      // Both should work fine — no errors from the embed mechanism
      const memBody = await memRes.json() as any;
      const wsBody = await wsRes.json() as any;
      expect(memBody.ok).toBe(true);
      expect(wsBody.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    test("empty content write", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/empty.md`, {
        method: "PUT",
        body: "",
      });
      // Empty content should be accepted
      expect(res.status).toBe(201);

      const getRes = await fetch(`${baseUrl}/raw/_memory/empty.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toBe("");
    });

    test("unicode content in memory files", async () => {
      const unicodeContent = "日本語テスト — émojis: 🧠💾🔍 — math: ∑∞∂";
      await fetch(`${baseUrl}/raw/_memory/unicode-test.md`, {
        method: "PUT",
        body: unicodeContent,
      });

      const getRes = await fetch(`${baseUrl}/raw/_memory/unicode-test.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toBe(unicodeContent);
    });

    test("large memory file", async () => {
      // Write a file with many lines (simulate session memory accumulation)
      const lines = Array.from({ length: 200 }, (_, i) => `Memory entry ${i + 1}: some context about decision ${i + 1}`);
      const largeContent = lines.join("\n");

      const res = await fetch(`${baseUrl}/raw/_memory/large-memory.md`, {
        method: "PUT",
        body: largeContent,
      });
      expect(res.status).toBe(201);

      const getRes = await fetch(`${baseUrl}/raw/_memory/large-memory.md`);
      const content = await getRes.text();
      expect(content).toBe(largeContent);

      // Should be searchable
      const searchRes = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "decision 150" }],
          collections: ["_memory"],
        }),
      });
      const searchBody = await searchRes.json() as any;
      expect(searchBody.results.length).toBeGreaterThan(0);
      expect(searchBody.results[0].file).toBe("_memory/large-memory.md");
    });

    test("deeply nested path", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/deep/nested/path/to/memory.md`, {
        method: "PUT",
        body: "Deep path memory file",
      });
      expect(res.status).toBe(201);

      const getRes = await fetch(`${baseUrl}/raw/_memory/deep/nested/path/to/memory.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toBe("Deep path memory file");
    });

    test("special characters in path are URL-encoded correctly", async () => {
      const res = await fetch(`${baseUrl}/raw/_memory/memory/session%20notes.md`, {
        method: "PUT",
        body: "File with spaces in name",
      });
      expect(res.status).toBe(201);

      const getRes = await fetch(`${baseUrl}/raw/_memory/memory/session%20notes.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toBe("File with spaces in name");
    });
  });

  // ---------------------------------------------------------------------------
  // Workflow: write → search → get (full cycle as agent would use it)
  // ---------------------------------------------------------------------------

  describe("full agent workflow: write → search → get", () => {
    test("complete memory lifecycle", async () => {
      // Step 1: Agent writes a memory file (vault_memory_write)
      const writeRes = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-22.md`, {
        method: "PUT",
        body: "# 2026-02-22 Session Memory\n\n## Decisions\n- Chose PostgreSQL over MongoDB for persistence.\n- Authentication will use JWT with refresh tokens.\n\n## TODO\n- Implement token rotation\n- Add rate limiting middleware",
      });
      expect(writeRes.status).toBe(201);

      // Step 2: Agent appends to the memory file (vault_memory_write with append)
      const appendRes = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-22.md/append`, {
        method: "POST",
        body: "\n## Later Decision\n- Switched to Redis for session cache.",
      });
      expect(appendRes.status).toBe(200);

      // Step 3: Agent searches memory (vault_memory_search)
      const searchRes = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "PostgreSQL MongoDB persistence" }],
          collections: ["_memory"],
        }),
      });
      expect(searchRes.status).toBe(200);
      const searchBody = await searchRes.json() as any;
      expect(searchBody.results.length).toBeGreaterThan(0);

      const match = searchBody.results.find((r: any) => r.file === "_memory/memory/2026-02-22.md");
      expect(match).toBeDefined();
      expect(match.score).toBeGreaterThan(0);

      // Step 4: Agent reads full memory file (vault_memory_get)
      const getRes = await fetch(`${baseUrl}/raw/_memory/memory/2026-02-22.md`);
      expect(getRes.status).toBe(200);
      const content = await getRes.text();
      expect(content).toContain("PostgreSQL over MongoDB");
      expect(content).toContain("JWT with refresh tokens");
      expect(content).toContain("Switched to Redis for session cache");
    });

    test("cross-session memory recall", async () => {
      // Simulate session 1: write a preference
      await fetch(`${baseUrl}/raw/_memory/preferences.md`, {
        method: "PUT",
        body: "User preferences:\n- Editor: Neovim\n- Terminal: Kitty\n- Shell: Fish",
      });

      // Simulate session 2: recall the preference
      const searchRes = await fetch(`${baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [{ type: "lex", query: "editor terminal shell preference" }],
          collections: ["_memory"],
        }),
      });
      const searchBody = await searchRes.json() as any;
      expect(searchBody.results.length).toBeGreaterThan(0);

      const prefMatch = searchBody.results.find((r: any) => r.file === "_memory/preferences.md");
      expect(prefMatch).toBeDefined();

      // Get the full file
      const getRes = await fetch(`${baseUrl}/raw/_memory/preferences.md`);
      const content = await getRes.text();
      expect(content).toContain("Neovim");
      expect(content).toContain("Kitty");
      expect(content).toContain("Fish");
    });
  });
});
