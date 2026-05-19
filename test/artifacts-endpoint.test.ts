/**
 * artifacts-endpoint.test.ts — Integration tests for the artifact REST endpoints
 * and the editable collection.
 *
 * Spins up a real HTTP server + real database (following memory-collection.test.ts pattern).
 *
 * Tests: write artifact, list artifacts, download, PPTX build, and ticket-based URLs.
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

// ---------------------------------------------------------------------------
// Database setup (mirrors memory-collection.test.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid presentation spec JSON */
function minimalSpecJson(): string {
  return JSON.stringify({
    title: "Test Deck",
    slides: [
      { type: "title", title: "Hello", subtitle: "World" },
      { type: "bullets", title: "Points", bullets: ["Alpha", "Beta"] },
    ],
  });
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7FoAAAAASUVORK5CYII=";

function imageSpecJson(imagePath: string): string {
  return JSON.stringify({
    title: "Image Deck",
    slides: [
      {
        type: "image",
        title: "Hero",
        image: {
          data: imagePath,
          caption: "Embedded hero",
        },
      },
    ],
  });
}

function missingImageSpecJson(imagePath: string): string {
  return JSON.stringify({
    title: "Missing Image Deck",
    slides: [
      {
        type: "image",
        title: "Broken Hero",
        image: {
          data: imagePath,
          caption: "Missing hero",
        },
      },
    ],
  });
}

function hasEmbeddedImage(buffer: Buffer): boolean {
  return /ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|bmp|svg)/i.test(buffer.toString("latin1"));
}

async function issueDownloadUrl(baseUrl: string, path: string, collection = "_editable"): Promise<string> {
  const res = await fetch(`${baseUrl}/artifacts/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, path }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  return body.url;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("artifact endpoints", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let httpTestDbPath: string;
  let httpTestConfigDir: string;
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    httpTestDbPath = `/tmp/vault-artifacts-test-${Date.now()}.sqlite`;
    const db = openDatabase(httpTestDbPath);
    initTestDatabase(db);
    db.close();

    const configPrefix = join(tmpdir(), `vault-artifacts-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  // -------------------------------------------------------------------------
  // GET /artifacts — list (empty at start)
  // -------------------------------------------------------------------------

  describe("GET /artifacts", () => {
    test("returns empty list initially", async () => {
      const res = await fetch(`${baseUrl}/artifacts`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.items).toBeDefined();
      expect(body.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Write artifacts via PUT /raw/editable/{path}
  // -------------------------------------------------------------------------

  describe("write artifacts via /raw/editable", () => {
    test("write a text artifact (spec.json)", async () => {
      const spec = minimalSpecJson();
      const res = await fetch(`${baseUrl}/raw/editable/presentations/demo/spec.json`, {
        method: "PUT",
        body: spec,
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
    });

    test("read back the text artifact", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/presentations/demo/spec.json`);
      expect(res.status).toBe(200);
      const content = await res.text();
      const parsed = JSON.parse(content);
      expect(parsed.title).toBe("Test Deck");
      expect(parsed.slides).toHaveLength(2);
    });

    test("write a loose text file", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/notes.md`, {
        method: "PUT",
        body: "# Notes\n\nSome content.",
      });
      expect(res.status).toBe(201);
    });

    test("write a binary image artifact for presentation slides", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/presentations/image-demo/hero.png`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Mime-Type": "image/png",
        },
        body: Buffer.from(TINY_PNG_BASE64, "base64"),
      });
      expect(res.status).toBe(201);
    });

    test("read back the binary image artifact as raw bytes", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/presentations/image-demo/hero.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");

      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.equals(Buffer.from(TINY_PNG_BASE64, "base64"))).toBe(true);
    });

    test("write an image presentation spec that references a vault artifact", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/presentations/image-demo/spec.json`, {
        method: "PUT",
        body: imageSpecJson("presentations/image-demo/hero.png"),
      });
      expect(res.status).toBe(201);
    });

    test("write a spec with a missing image reference", async () => {
      const res = await fetch(`${baseUrl}/raw/editable/presentations/missing-image/spec.json`, {
        method: "PUT",
        body: missingImageSpecJson("presentations/missing-image/hero.png"),
      });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // GET /artifacts — list with items
  // -------------------------------------------------------------------------

  describe("GET /artifacts (after writes)", () => {
    test("lists all artifacts", async () => {
      const res = await fetch(`${baseUrl}/artifacts`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.items.length).toBeGreaterThanOrEqual(2);

      const paths = body.items.map((i: any) => i.path);
      expect(paths).toContain("presentations/demo/spec.json");
      expect(paths).toContain("notes.md");
    });

    test("items have expected shape", async () => {
      const res = await fetch(`${baseUrl}/artifacts`);
      const body = await res.json() as any;
      const item = body.items[0];

      expect(item).toHaveProperty("path");
      expect(item).toHaveProperty("modifiedAt");
      expect(item).toHaveProperty("size");
      expect(item).toHaveProperty("mimeType");
      expect(item).toHaveProperty("isBinary");
      expect(typeof item.size).toBe("number");
    });

    test("prefix filter works", async () => {
      const res = await fetch(`${baseUrl}/artifacts?prefix=presentations/`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      for (const item of body.items) {
        expect(item.path).toMatch(/^presentations\//);
      }
    });

    test("prefix filter with no matches returns empty", async () => {
      const res = await fetch(`${baseUrl}/artifacts?prefix=nonexistent/`);
      const body = await res.json() as any;
      expect(body.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /artifacts/download — ticketed artifact downloads
  // -------------------------------------------------------------------------

  describe("GET /artifacts/download", () => {
    test("downloads text artifact with a valid ticket", async () => {
      const url = await issueDownloadUrl(baseUrl, "notes.md");
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");

      const text = await res.text();
      expect(text).toContain("# Notes");
    });

    test("returns 400 when path is missing", async () => {
      const res = await fetch(`${baseUrl}/artifacts/download`);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("path");
    });

    test("returns 400 when token is missing", async () => {
      const res = await fetch(`${baseUrl}/artifacts/download?path=notes.md`);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("token");
    });

    test("returns 404 for hidden collections", async () => {
      const res = await fetch(
        `${baseUrl}/artifacts/download?collection=${encodeURIComponent("_config")}&path=gmail.json&token=${"a".repeat(64)}`,
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /artifacts/build — PPTX generation
  // -------------------------------------------------------------------------

  describe("POST /artifacts/build", () => {
    test("builds PPTX from existing spec", async () => {
      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "demo" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.pptxPath).toBe("presentations/demo/build/demo.pptx");
      expect(body.slides).toBe(2);
      expect(body.size).toBeGreaterThan(0);
    });

    test("built PPTX appears in artifact list", async () => {
      const res = await fetch(`${baseUrl}/artifacts?prefix=presentations/demo/build/`);
      const body = await res.json() as any;
      expect(body.items.length).toBe(1);
      expect(body.items[0].path).toBe("presentations/demo/build/demo.pptx");
      expect(body.items[0].isBinary).toBe(true);
    });

    test("built PPTX is downloadable with valid ZIP magic bytes", async () => {
      const url = await issueDownloadUrl(baseUrl, "presentations/demo/build/demo.pptx");
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("presentationml");
      expect(res.headers.get("content-disposition")).toContain("demo.pptx");

      const buffer = Buffer.from(await res.arrayBuffer());
      // PPTX is a ZIP file — magic bytes PK
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    });

    test("builds PPTX with embedded media for vault-backed image slides", async () => {
      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "image-demo" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.pptxPath).toBe("presentations/image-demo/build/image-demo.pptx");
    });

    test("image-backed PPTX download contains media entries", async () => {
      const url = await issueDownloadUrl(baseUrl, "presentations/image-demo/build/image-demo.pptx");
      const res = await fetch(url);
      expect(res.status).toBe(200);

      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
      expect(hasEmbeddedImage(buffer)).toBe(true);
    });

    test("returns 404 when spec does not exist", async () => {
      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "nonexistent" }),
      });
      expect(res.status).toBe(404);
    });

    test("returns 400 for invalid spec JSON", async () => {
      // Write invalid JSON
      await fetch(`${baseUrl}/raw/editable/presentations/bad-json/spec.json`, {
        method: "PUT",
        body: "not valid json {{{",
      });

      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad-json" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Invalid JSON");
    });

    test("returns 400 for invalid spec schema", async () => {
      // Write valid JSON but invalid spec (missing slides)
      await fetch(`${baseUrl}/raw/editable/presentations/bad-spec/spec.json`, {
        method: "PUT",
        body: JSON.stringify({ title: "Missing slides" }),
      });

      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad-spec" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Invalid presentation spec");
    });

    test("returns 400 when an image slide references an unresolved asset", async () => {
      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "missing-image" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Presentation image resolution failed");
      expect(body.error).toContain("editable/presentations/missing-image/hero.png");
    });

    test("returns 400 when name is missing", async () => {
      const res = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test("rebuild overwrites existing PPTX", async () => {
      // Get initial size
      const list1 = await fetch(`${baseUrl}/artifacts?prefix=presentations/demo/build/`);
      const items1 = (await list1.json() as any).items;
      const size1 = items1[0].size;

      // Update spec with more slides
      const biggerSpec = JSON.stringify({
        title: "Updated Deck",
        slides: [
          { type: "title", title: "New Title" },
          { type: "bullets", title: "More", bullets: ["A", "B", "C", "D", "E"] },
          { type: "table", title: "Data", table: { headers: ["X", "Y"], rows: [["1", "2"]] } },
        ],
      });
      await fetch(`${baseUrl}/raw/editable/presentations/demo/spec.json`, {
        method: "PUT",
        body: biggerSpec,
      });

      // Rebuild
      const buildRes = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "demo" }),
      });
      expect(buildRes.status).toBe(200);
      const buildBody = await buildRes.json() as any;
      expect(buildBody.slides).toBe(3);

      // Should still have exactly 1 PPTX (overwritten, not duplicated)
      const list2 = await fetch(`${baseUrl}/artifacts?prefix=presentations/demo/build/`);
      const items2 = (await list2.json() as any).items;
      expect(items2).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // POST /artifacts/url — ticket-based download URLs
  // -------------------------------------------------------------------------

  describe("POST /artifacts/url", () => {
    test("issues a download URL for existing artifact", async () => {
      const res = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "notes.md" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;

      expect(body.url).toBeDefined();
      expect(body.url).toContain("/artifacts/download");
      expect(body.url).toContain("token=");
      expect(body.url).toContain("path=");
      expect(body.expiresAtMs).toBeGreaterThan(Date.now());
    });

    test("issued URL is usable for download", async () => {
      // Get ticket URL
      const urlRes = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "notes.md" }),
      });
      const { url } = await urlRes.json() as any;

      // Use it
      const dlRes = await fetch(url);
      expect(dlRes.status).toBe(200);
      const text = await dlRes.text();
      expect(text).toContain("# Notes");
    });

    test("ticket for PPTX artifact works", async () => {
      const urlRes = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "presentations/demo/build/demo.pptx" }),
      });
      expect(urlRes.status).toBe(200);
      const { url } = await urlRes.json() as any;

      const dlRes = await fetch(url);
      expect(dlRes.status).toBe(200);
      const buffer = Buffer.from(await dlRes.arrayBuffer());
      expect(buffer[0]).toBe(0x50); // PK
      expect(buffer[1]).toBe(0x4b);
    });

    test("returns 404 for non-existent artifact", async () => {
      const res = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "does/not/exist.txt" }),
      });
      expect(res.status).toBe(404);
    });

    test("returns 400 when path is missing", async () => {
      const res = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test("invalid token is rejected", async () => {
      const res = await fetch(
        `${baseUrl}/artifacts/download?path=notes.md&token=` + "a".repeat(64),
      );
      // Should fail — the token is not valid
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test("ticket can be reused within TTL window", async () => {
      const urlRes = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "notes.md" }),
      });
      const { url } = await urlRes.json() as any;

      // First use
      const dl1 = await fetch(url);
      expect(dl1.status).toBe(200);
      await dl1.arrayBuffer();

      // Second use — should also succeed (tickets are time-limited, not single-use)
      const dl2 = await fetch(url);
      expect(dl2.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Full workflow: write spec → build → download → get URL
  // -------------------------------------------------------------------------

  describe("full workflow", () => {
    test("write spec → build PPTX → list → download → get URL", async () => {
      const pName = "workflow-test";
      const spec = JSON.stringify({
        title: "Workflow Test",
        author: "CI",
        slides: [
          { type: "title", title: "Start" },
          { type: "bullets", title: "Items", bullets: ["One", "Two", "Three"] },
          {
            type: "two_col",
            title: "Compare",
            left: { title: "A", bullets: ["a1"] },
            right: { title: "B", bullets: ["b1"] },
          },
        ],
      });

      // 1. Write spec
      const writeRes = await fetch(`${baseUrl}/raw/editable/presentations/${pName}/spec.json`, {
        method: "PUT",
        body: spec,
      });
      expect(writeRes.status).toBe(201);

      // 2. Build PPTX
      const buildRes = await fetch(`${baseUrl}/artifacts/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pName }),
      });
      expect(buildRes.status).toBe(200);
      const buildBody = await buildRes.json() as any;
      expect(buildBody.ok).toBe(true);
      expect(buildBody.slides).toBe(3);

      // 3. List — should contain both spec and PPTX
      const listRes = await fetch(`${baseUrl}/artifacts?prefix=presentations/${pName}/`);
      const listBody = await listRes.json() as any;
      expect(listBody.items.length).toBe(2);
      const paths = listBody.items.map((i: any) => i.path);
      expect(paths).toContain(`presentations/${pName}/spec.json`);
      expect(paths).toContain(`presentations/${pName}/build/${pName}.pptx`);

      // 4. Download PPTX directly
      const downloadUrl = await issueDownloadUrl(
        baseUrl,
        `presentations/${pName}/build/${pName}.pptx`,
      );
      const dlRes = await fetch(downloadUrl);
      expect(dlRes.status).toBe(200);
      const pptxBuffer = Buffer.from(await dlRes.arrayBuffer());
      expect(pptxBuffer[0]).toBe(0x50);
      expect(pptxBuffer.length).toBeGreaterThan(1000);

      // 5. Get ticket URL (for agent-side Telegram delivery)
      const urlRes = await fetch(`${baseUrl}/artifacts/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `presentations/${pName}/build/${pName}.pptx` }),
      });
      expect(urlRes.status).toBe(200);
      const { url } = await urlRes.json() as any;
      expect(url).toContain("token=");

      // 6. Download via ticket URL
      const ticketDl = await fetch(url);
      expect(ticketDl.status).toBe(200);
      const ticketBuffer = Buffer.from(await ticketDl.arrayBuffer());
      expect(ticketBuffer[0]).toBe(0x50);
      expect(ticketBuffer.length).toBe(pptxBuffer.length);
    });
  });
});
