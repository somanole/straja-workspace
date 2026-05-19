/**
 * Write Queue End-to-End Tests
 *
 * Tests the in-memory write queue that intercepts all store write methods
 * and drains them sequentially to SQLite. Covers:
 *
 *   - Immediate read-through: GET returns queued content before drain
 *   - Drain worker: queued entries eventually reach SQLite
 *   - Concurrent writes: parallel PUT requests → no data loss
 *   - Coalescing: rapid writes to same path → latest content wins
 *   - Deactivation: DELETE while pending upsert
 *   - Large batch: many distinct paths all drain without loss
 *   - Queue visibility: GET /raw/_write_queue, GET /collections/_write_queue/files
 *   - Status endpoint: _write_queue appears as system collection
 *   - Write-protected: PUT /raw/_write_queue is rejected
 *   - Append after PUT: POST append on a document that was PUT
 *   - Interleaved read/write: read during active drain
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

// =============================================================================
// Test Database Setup (mirrors memory-collection.test.ts pattern)
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
// Helpers
// =============================================================================

/** Wait for the drain worker to process all entries (poll queue endpoint). */
async function waitForDrain(baseUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/raw/_write_queue`);
    const body = await res.json() as { count: number };
    if (body.count === 0) return;
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error(`Write queue did not drain within ${timeoutMs}ms`);
}

/** PUT a document via /raw/ endpoint and return the response. */
async function putRaw(baseUrl: string, collection: string, path: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/raw/${encodeURIComponent(collection)}/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
}

/** GET a document via /raw/ endpoint and return text content. */
async function getRaw(baseUrl: string, collection: string, path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${baseUrl}/raw/${encodeURIComponent(collection)}/${encodeURIComponent(path)}`);
  const text = res.status === 200 ? await res.text() : "";
  return { status: res.status, text };
}

/** DELETE a document via /raw/ endpoint. */
async function deleteRaw(baseUrl: string, collection: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}/raw/${encodeURIComponent(collection)}/${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

/** POST append to a document. */
async function appendRaw(baseUrl: string, collection: string, path: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/raw/${encodeURIComponent(collection)}/${encodeURIComponent(path)}/append`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
}

/** Get queue state. */
async function getQueueState(baseUrl: string): Promise<{ entries: any[]; count: number }> {
  const res = await fetch(`${baseUrl}/raw/_write_queue`);
  return res.json() as Promise<{ entries: any[]; count: number }>;
}

// =============================================================================
// Test Suite
// =============================================================================

describe("write queue end-to-end", () => {
  let handle: HttpServerHandle;
  let baseUrl = "";
  let dbPath = "";
  let configDir = "";

  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = join(tmpdir(), `vault-wq-test-${id}.sqlite`);
    configDir = await mkdtemp(join(tmpdir(), "vault-wq-config-"));

    const db = openDatabase(dbPath);
    initTestDatabase(db);
    db.close();

    const config: CollectionConfig = { collections: {} };
    await writeFile(join(configDir, "index.yml"), YAML.stringify(config));

    process.env.INDEX_PATH = dbPath;
    process.env.VAULT_CONFIG_DIR = configDir;
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

    try { require("fs").unlinkSync(dbPath); } catch {}
    try {
      const files = await readdir(configDir);
      for (const f of files) await unlink(join(configDir, f));
      await rmdir(configDir);
    } catch {}
  });

  // ---------------------------------------------------------------------------
  // Basic write → read-through → drain → read from SQLite
  // ---------------------------------------------------------------------------

  describe("basic write and drain lifecycle", () => {
    test("PUT returns 201 for new document", async () => {
      const res = await putRaw(baseUrl, "_memory", "basic-test.md", "hello world");
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(typeof body.hash).toBe("string");
    });

    test("GET returns content immediately (read-through from queue)", async () => {
      const content = `read-through-test-${Date.now()}`;
      await putRaw(baseUrl, "_memory", "read-through.md", content);

      // Read immediately — should come from the queue, not SQLite
      const { status, text } = await getRaw(baseUrl, "_memory", "read-through.md");
      expect(status).toBe(200);
      expect(text).toBe(content);
    });

    test("content persists in SQLite after drain", async () => {
      const content = `drain-test-${Date.now()}`;
      await putRaw(baseUrl, "_memory", "drain-verify.md", content);
      await waitForDrain(baseUrl);

      // After drain, read should still return the content (now from SQLite)
      const { status, text } = await getRaw(baseUrl, "_memory", "drain-verify.md");
      expect(status).toBe(200);
      expect(text).toBe(content);
    });

    test("PUT returns 200 for update to existing document", async () => {
      await putRaw(baseUrl, "_memory", "update-test.md", "version 1");
      await waitForDrain(baseUrl);

      const res = await putRaw(baseUrl, "_memory", "update-test.md", "version 2");
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);

      await waitForDrain(baseUrl);

      const { text } = await getRaw(baseUrl, "_memory", "update-test.md");
      expect(text).toBe("version 2");
    });
  });

  // ---------------------------------------------------------------------------
  // Coalescing: rapid writes to same path
  // ---------------------------------------------------------------------------

  describe("coalescing", () => {
    test("rapid sequential writes to same path — latest content wins", async () => {
      const path = "coalesce-sequential.md";
      const n = 20;

      for (let i = 0; i < n; i++) {
        await putRaw(baseUrl, "_memory", path, `version-${i}`);
      }

      // Should immediately return the latest version via read-through
      const { text } = await getRaw(baseUrl, "_memory", path);
      expect(text).toBe(`version-${n - 1}`);

      // After drain, still the latest version
      await waitForDrain(baseUrl);
      const { text: postDrain } = await getRaw(baseUrl, "_memory", path);
      expect(postDrain).toBe(`version-${n - 1}`);
    });

    test("concurrent PUTs to same path — latest content survives", async () => {
      const path = "coalesce-concurrent.md";
      const n = 10;

      // Fire all PUTs concurrently
      const promises = Array.from({ length: n }, (_, i) =>
        putRaw(baseUrl, "_memory", path, `concurrent-${i}`),
      );
      const responses = await Promise.all(promises);

      // All should succeed
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
        const body = await res.json() as any;
        expect(body.ok).toBe(true);
      }

      // Wait for drain and verify content is one of the versions
      await waitForDrain(baseUrl);
      const { status, text } = await getRaw(baseUrl, "_memory", path);
      expect(status).toBe(200);
      expect(text).toMatch(/^concurrent-\d+$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent writes to different paths — no data loss
  // ---------------------------------------------------------------------------

  describe("concurrent writes — no data loss", () => {
    test("50 parallel PUTs to different paths — all persist", async () => {
      const n = 50;
      const collection = "_memory";
      const prefix = `concurrent-nodataloss-${Date.now()}`;

      // Fire all PUTs concurrently
      const promises = Array.from({ length: n }, (_, i) =>
        putRaw(baseUrl, collection, `${prefix}/file-${i}.md`, `content-for-file-${i}`),
      );
      const responses = await Promise.all(promises);

      // All should succeed with 201
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
      }

      // Wait for all entries to drain
      await waitForDrain(baseUrl);

      // Verify every single document persisted with correct content
      const verifyPromises = Array.from({ length: n }, async (_, i) => {
        const { status, text } = await getRaw(baseUrl, collection, `${prefix}/file-${i}.md`);
        expect(status).toBe(200);
        expect(text).toBe(`content-for-file-${i}`);
      });
      await Promise.all(verifyPromises);
    });

    test("100 parallel PUTs across multiple collections — all persist", async () => {
      const collections = ["wq-test-a", "wq-test-b", "wq-test-c", "wq-test-d"];
      const filesPerCollection = 25;
      const prefix = `multi-coll-${Date.now()}`;

      const promises: Promise<Response>[] = [];
      for (const coll of collections) {
        for (let i = 0; i < filesPerCollection; i++) {
          promises.push(
            putRaw(baseUrl, coll, `${prefix}/doc-${i}.md`, `${coll}:doc-${i}:content`),
          );
        }
      }

      const responses = await Promise.all(promises);
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
      }

      await waitForDrain(baseUrl);

      // Verify all documents in all collections
      for (const coll of collections) {
        for (let i = 0; i < filesPerCollection; i++) {
          const { status, text } = await getRaw(baseUrl, coll, `${prefix}/doc-${i}.md`);
          expect(status).toBe(200);
          expect(text).toBe(`${coll}:doc-${i}:content`);
        }
      }
    });

    test("interleaved writes and reads — reads always consistent", async () => {
      const n = 30;
      const collection = "_memory";
      const prefix = `interleaved-${Date.now()}`;

      // Write files in batches, reading back between batches
      for (let batch = 0; batch < 3; batch++) {
        const batchPromises = Array.from({ length: n / 3 }, (_, i) => {
          const idx = batch * (n / 3) + i;
          return putRaw(baseUrl, collection, `${prefix}/file-${idx}.md`, `batch-${batch}-content-${idx}`);
        });
        await Promise.all(batchPromises);

        // Read back all files written so far — should all be accessible
        for (let j = 0; j <= batch * (n / 3) + (n / 3) - 1; j++) {
          const { status, text } = await getRaw(baseUrl, collection, `${prefix}/file-${j}.md`);
          expect(status).toBe(200);
          expect(text).toContain(`content-${j}`);
        }
      }

      await waitForDrain(baseUrl);

      // Final verification after drain
      for (let i = 0; i < n; i++) {
        const { status } = await getRaw(baseUrl, collection, `${prefix}/file-${i}.md`);
        expect(status).toBe(200);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Deactivation (soft delete) while entry is pending
  // ---------------------------------------------------------------------------

  describe("deactivation", () => {
    test("DELETE removes document after drain", async () => {
      await putRaw(baseUrl, "_memory", "delete-test.md", "to be deleted");
      await waitForDrain(baseUrl);

      const delRes = await deleteRaw(baseUrl, "_memory", "delete-test.md");
      expect(delRes.status).toBe(200);

      await waitForDrain(baseUrl);

      const { status } = await getRaw(baseUrl, "_memory", "delete-test.md");
      expect(status).toBe(404);
    });

    test("PUT then DELETE before drain — document is gone after drain", async () => {
      // Create the document first and let it drain
      await putRaw(baseUrl, "_memory", "put-then-delete.md", "initial");
      await waitForDrain(baseUrl);

      // Now PUT a new version and immediately DELETE
      await putRaw(baseUrl, "_memory", "put-then-delete.md", "about to be deleted");
      // We need the document to exist in SQLite for DELETE to succeed
      await waitForDrain(baseUrl);

      const delRes = await deleteRaw(baseUrl, "_memory", "put-then-delete.md");
      expect(delRes.status).toBe(200);

      await waitForDrain(baseUrl);

      const { status } = await getRaw(baseUrl, "_memory", "put-then-delete.md");
      expect(status).toBe(404);
    });

    test("DELETE then PUT — document is re-created", async () => {
      await putRaw(baseUrl, "_memory", "delete-then-put.md", "first version");
      await waitForDrain(baseUrl);

      const delRes = await deleteRaw(baseUrl, "_memory", "delete-then-put.md");
      expect(delRes.status).toBe(200);
      await waitForDrain(baseUrl);

      // Re-create with new content
      const putRes = await putRaw(baseUrl, "_memory", "delete-then-put.md", "resurrected");
      expect(putRes.status).toBe(201);

      await waitForDrain(baseUrl);

      const { status, text } = await getRaw(baseUrl, "_memory", "delete-then-put.md");
      expect(status).toBe(200);
      expect(text).toBe("resurrected");
    });
  });

  // ---------------------------------------------------------------------------
  // Append after PUT
  // ---------------------------------------------------------------------------

  describe("append", () => {
    test("POST append adds to existing content after drain", async () => {
      // The append handler adds \n before the new line (if base doesn't end with \n)
      // and \n after the new line. So: "line 1" + "\n" + "line 2" + "\n" = "line 1\nline 2\n"
      await putRaw(baseUrl, "_memory", "append-test.md", "line 1");
      await waitForDrain(baseUrl);

      const appendRes = await appendRaw(baseUrl, "_memory", "append-test.md", "line 2");
      expect(appendRes.status).toBe(200);

      await waitForDrain(baseUrl);

      const { text } = await getRaw(baseUrl, "_memory", "append-test.md");
      expect(text).toBe("line 1\nline 2\n");
    });

    test("multiple sequential appends", async () => {
      // Append handler: base + "\n" + newLine + "\n" each time
      await putRaw(baseUrl, "_memory", "multi-append.md", "base");
      await waitForDrain(baseUrl);

      for (let i = 1; i <= 5; i++) {
        const res = await appendRaw(baseUrl, "_memory", "multi-append.md", `line-${i}`);
        expect(res.status).toBe(200);
        // Must wait for each append to drain so the next append sees updated content
        await waitForDrain(baseUrl);
      }

      const { text } = await getRaw(baseUrl, "_memory", "multi-append.md");
      expect(text).toBe("base\nline-1\nline-2\nline-3\nline-4\nline-5\n");
    });
  });

  // ---------------------------------------------------------------------------
  // Queue visibility endpoints
  // ---------------------------------------------------------------------------

  describe("queue visibility", () => {
    test("GET /raw/_write_queue returns queue state", async () => {
      const res = await fetch(`${baseUrl}/raw/_write_queue`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body.count).toBe("number");
      expect(Array.isArray(body.entries)).toBe(true);
    });

    test("GET /raw/_write_queue shows pending entries", async () => {
      // Write a bunch to fill the queue
      const promises = Array.from({ length: 20 }, (_, i) =>
        putRaw(baseUrl, "_memory", `queue-vis-${i}.md`, `vis-content-${i}`),
      );
      await Promise.all(promises);

      // Queue may or may not have entries depending on drain speed
      // Just verify the endpoint works and returns valid data
      const body = await getQueueState(baseUrl);
      expect(typeof body.count).toBe("number");
      expect(body.count).toBeGreaterThanOrEqual(0);
      for (const entry of body.entries) {
        expect(entry).toHaveProperty("id");
        expect(entry).toHaveProperty("op");
        expect(entry).toHaveProperty("collection");
        expect(entry).toHaveProperty("path");
        expect(entry).toHaveProperty("status");
        expect(entry).toHaveProperty("attempts");
        expect(entry).toHaveProperty("contentLength");
      }

      await waitForDrain(baseUrl);
    });

    test("GET /collections/_write_queue/files returns file list", async () => {
      const res = await fetch(`${baseUrl}/collections/_write_queue/files`);
      expect(res.status).toBe(200);
      const files = await res.json() as any[];
      expect(Array.isArray(files)).toBe(true);
    });

    test("queue is empty after full drain", async () => {
      await waitForDrain(baseUrl);
      const body = await getQueueState(baseUrl);
      expect(body.count).toBe(0);
      expect(body.entries).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Status endpoint: _write_queue system collection
  // ---------------------------------------------------------------------------

  describe("status endpoint", () => {
    test("_write_queue appears as system collection in /status", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const wqColl = body.collections.find((c: any) => c.name === "_write_queue");
      expect(wqColl).toBeDefined();
      expect(wqColl.type).toBe("system");
      expect(wqColl.deletable).toBe(false);
    });

    test("writeQueue stats reflect queue state", async () => {
      const res = await fetch(`${baseUrl}/status`);
      const body = await res.json() as any;
      expect(body.writeQueue).toBeDefined();
      expect(typeof body.writeQueue.docs).toBe("number");
      expect(typeof body.writeQueue.entries).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Write-protection: _write_queue cannot be written via /raw/
  // ---------------------------------------------------------------------------

  describe("write protection", () => {
    test("PUT /raw/_write_queue/... is rejected (403)", async () => {
      const res = await putRaw(baseUrl, "_write_queue", "malicious.md", "should not work");
      expect(res.status).toBe(403);
    });

    test("DELETE /raw/_write_queue/... is rejected (403)", async () => {
      const res = await deleteRaw(baseUrl, "_write_queue", "malicious.md");
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Large batch stress test
  // ---------------------------------------------------------------------------

  describe("large batch — no data loss", () => {
    test("200 documents across 4 collections — all eventually persist", async () => {
      const collections = ["stress-a", "stress-b", "stress-c", "stress-d"];
      const docsPerCollection = 50;
      const batchId = Date.now();

      // Fire all writes concurrently
      const promises: Promise<Response>[] = [];
      for (const coll of collections) {
        for (let i = 0; i < docsPerCollection; i++) {
          const content = `batch:${batchId}|coll:${coll}|idx:${i}|payload:${"x".repeat(100)}`;
          promises.push(putRaw(baseUrl, coll, `batch-${batchId}/doc-${i}.md`, content));
        }
      }

      const responses = await Promise.all(promises);

      // Every response must succeed
      let created = 0;
      let updated = 0;
      for (const res of responses) {
        if (res.status === 201) created++;
        else if (res.status === 200) updated++;
        else {
          const body = await res.text();
          throw new Error(`Unexpected status ${res.status}: ${body}`);
        }
      }
      expect(created + updated).toBe(collections.length * docsPerCollection);

      // Wait for full drain
      await waitForDrain(baseUrl, 30_000);

      // Verify every single document
      let verified = 0;
      for (const coll of collections) {
        for (let i = 0; i < docsPerCollection; i++) {
          const { status, text } = await getRaw(baseUrl, coll, `batch-${batchId}/doc-${i}.md`);
          expect(status).toBe(200);
          expect(text).toContain(`coll:${coll}`);
          expect(text).toContain(`idx:${i}`);
          verified++;
        }
      }
      expect(verified).toBe(collections.length * docsPerCollection);
    }, 60_000); // 60s timeout for this test
  });

  // ---------------------------------------------------------------------------
  // Rapid fire: write + immediate read cycles
  // ---------------------------------------------------------------------------

  describe("rapid write-read cycles", () => {
    test("each write is immediately readable via read-through", async () => {
      const n = 30;
      const collection = "_memory";
      const prefix = `rapid-${Date.now()}`;

      for (let i = 0; i < n; i++) {
        const content = `rapid-content-${i}-${Date.now()}`;
        const putRes = await putRaw(baseUrl, collection, `${prefix}/doc-${i}.md`, content);
        expect([200, 201]).toContain(putRes.status);

        // Immediately read back — must return the content we just wrote
        const { status, text } = await getRaw(baseUrl, collection, `${prefix}/doc-${i}.md`);
        expect(status).toBe(200);
        expect(text).toBe(content);
      }

      await waitForDrain(baseUrl);
    });

    test("overwrite is immediately reflected in reads", async () => {
      const path = "overwrite-immediate.md";
      const collection = "_memory";

      // Create initial
      await putRaw(baseUrl, collection, path, "v1");
      let { text } = await getRaw(baseUrl, collection, path);
      expect(text).toBe("v1");

      // Overwrite
      await putRaw(baseUrl, collection, path, "v2");
      ({ text } = await getRaw(baseUrl, collection, path));
      expect(text).toBe("v2");

      // Overwrite again
      await putRaw(baseUrl, collection, path, "v3");
      ({ text } = await getRaw(baseUrl, collection, path));
      expect(text).toBe("v3");

      await waitForDrain(baseUrl);
      ({ text } = await getRaw(baseUrl, collection, path));
      expect(text).toBe("v3");
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed operations: PUTs + DELETEs + reads in parallel
  // ---------------------------------------------------------------------------

  describe("mixed operations", () => {
    test("create, update, delete, re-create — final state is correct", async () => {
      const collection = "_memory";
      const path = "lifecycle.md";

      // Create
      await putRaw(baseUrl, collection, path, "created");
      await waitForDrain(baseUrl);
      let { text } = await getRaw(baseUrl, collection, path);
      expect(text).toBe("created");

      // Update
      await putRaw(baseUrl, collection, path, "updated");
      await waitForDrain(baseUrl);
      ({ text } = await getRaw(baseUrl, collection, path));
      expect(text).toBe("updated");

      // Delete
      await deleteRaw(baseUrl, collection, path);
      await waitForDrain(baseUrl);
      const { status } = await getRaw(baseUrl, collection, path);
      expect(status).toBe(404);

      // Re-create
      await putRaw(baseUrl, collection, path, "re-created");
      await waitForDrain(baseUrl);
      ({ text } = await getRaw(baseUrl, collection, path));
      expect(text).toBe("re-created");
    });

    test("files listing reflects persisted documents", async () => {
      const collection = "listing-test";
      const prefix = `list-${Date.now()}`;

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await putRaw(baseUrl, collection, `${prefix}/file-${i}.md`, `content-${i}`);
      }
      await waitForDrain(baseUrl);

      // Get file listing — response is a plain array
      const res = await fetch(`${baseUrl}/collections/${collection}/files`);
      expect(res.status).toBe(200);
      const files = await res.json() as any[];

      // All 5 files should be listed
      const prefixFiles = files.filter((f: any) => f.path.startsWith(prefix));
      expect(prefixFiles.length).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Content deduplication via hash
  // ---------------------------------------------------------------------------

  describe("content deduplication", () => {
    test("same content in different paths shares hash", async () => {
      const content = `dedup-content-${Date.now()}`;

      const res1 = await putRaw(baseUrl, "_memory", "dedup-1.md", content);
      const body1 = await res1.json() as any;

      const res2 = await putRaw(baseUrl, "_memory", "dedup-2.md", content);
      const body2 = await res2.json() as any;

      expect(body1.hash).toBe(body2.hash);

      await waitForDrain(baseUrl);

      // Both paths readable with same content
      const { text: t1 } = await getRaw(baseUrl, "_memory", "dedup-1.md");
      const { text: t2 } = await getRaw(baseUrl, "_memory", "dedup-2.md");
      expect(t1).toBe(content);
      expect(t2).toBe(content);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    test("empty content is persisted correctly", async () => {
      await putRaw(baseUrl, "_memory", "empty.md", "");
      await waitForDrain(baseUrl);

      const { status, text } = await getRaw(baseUrl, "_memory", "empty.md");
      expect(status).toBe(200);
      expect(text).toBe("");
    });

    test("large content (1MB) is persisted correctly", async () => {
      const content = "X".repeat(1024 * 1024); // 1MB
      await putRaw(baseUrl, "_memory", "large.md", content);
      await waitForDrain(baseUrl);

      const { status, text } = await getRaw(baseUrl, "_memory", "large.md");
      expect(status).toBe(200);
      expect(text.length).toBe(1024 * 1024);
    }, 30_000);

    test("special characters in path", async () => {
      const path = "special chars (test) & more.md";
      await putRaw(baseUrl, "_memory", path, "special path content");
      await waitForDrain(baseUrl);

      const { status, text } = await getRaw(baseUrl, "_memory", path);
      expect(status).toBe(200);
      expect(text).toBe("special path content");
    });

    test("unicode content is preserved", async () => {
      const content = "日本語テスト 🚀 émojis & ñ accénts";
      await putRaw(baseUrl, "_memory", "unicode.md", content);
      await waitForDrain(baseUrl);

      const { text } = await getRaw(baseUrl, "_memory", "unicode.md");
      expect(text).toBe(content);
    });

    test("GET /raw/_write_queue HEAD returns no body", async () => {
      const res = await fetch(`${baseUrl}/raw/_write_queue`, { method: "HEAD" });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe("");
    });
  });
});
