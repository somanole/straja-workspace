import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BOOTSTRAP_FILES, seedWorkspaceDefaults } from "../src/workspace-defaults.js";

type StoredDoc = {
  id: number;
  hash: string;
  title: string;
  content: string;
};

function createMockStore() {
  let nextId = 1;
  const docs = new Map<string, StoredDoc>();
  const contentByHash = new Map<string, string>();

  const keyFor = (collection: string, path: string) => `${collection}:${path}`;

  return {
    docs,
    findActiveDocument(collection: string, path: string) {
      const entry = docs.get(keyFor(collection, path));
      return entry ? { id: entry.id, hash: entry.hash, title: entry.title } : null;
    },
    getDocumentWithContent(collection: string, path: string) {
      const entry = docs.get(keyFor(collection, path));
      return entry
        ? { id: entry.id, hash: entry.hash, title: entry.title, content: entry.content }
        : null;
    },
    insertContent(hash: string, content: string) {
      contentByHash.set(hash, content);
    },
    insertDocument(collection: string, path: string, title: string, hash: string) {
      docs.set(keyFor(collection, path), {
        id: nextId++,
        hash,
        title,
        content: contentByHash.get(hash) ?? "",
      });
    },
    updateDocument(documentId: number, title: string, hash: string) {
      for (const [key, entry] of docs.entries()) {
        if (entry.id !== documentId) {
          continue;
        }
        docs.set(key, {
          ...entry,
          title,
          hash,
          content: contentByHash.get(hash) ?? "",
        });
        return;
      }
    },
  };
}

describe("workspace defaults", () => {
  const originalTemplatesDir = process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR;
  const originalAppTemplatesDir = process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR;

  afterEach(() => {
    if (originalTemplatesDir === undefined) {
      delete process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR;
    } else {
      process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR = originalTemplatesDir;
    }
    if (originalAppTemplatesDir === undefined) {
      delete process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR;
    } else {
      process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR = originalAppTemplatesDir;
    }
  });

  it("seeds bootstrap files into _bootstrap and _workspace", async () => {
    const templatesDir = mkdtempSync(join(tmpdir(), "workspace-defaults-"));
    mkdirSync(templatesDir, { recursive: true });
    for (const filename of DEFAULT_BOOTSTRAP_FILES) {
      writeFileSync(join(templatesDir, filename), `# ${filename}\n`, "utf-8");
    }
    process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR = templatesDir;

    const store = createMockStore();
    await seedWorkspaceDefaults(store);

    for (const filename of DEFAULT_BOOTSTRAP_FILES) {
      expect(store.getDocumentWithContent("_bootstrap", filename)?.content).toBe(`# ${filename}\n`);
      expect(store.getDocumentWithContent("_workspace", filename)?.content).toBe(`# ${filename}\n`);
    }
    expect(store.getDocumentWithContent("_memory", "MEMORY.md")?.content).toContain(
      "Use this file for durable facts worth recalling across sessions.",
    );
  });

  it("seeds shared Google OAuth client config into _config when a template is provided", async () => {
    const templatesDir = mkdtempSync(join(tmpdir(), "workspace-defaults-bootstrap-"));
    mkdirSync(templatesDir, { recursive: true });
    for (const filename of DEFAULT_BOOTSTRAP_FILES) {
      writeFileSync(join(templatesDir, filename), `# ${filename}\n`, "utf-8");
    }
    process.env.STRAJA_BOOTSTRAP_TEMPLATES_DIR = templatesDir;

    const appTemplatesDir = mkdtempSync(join(tmpdir(), "workspace-defaults-app-"));
    mkdirSync(appTemplatesDir, { recursive: true });
    writeFileSync(
      join(appTemplatesDir, "google-oauth.json"),
      `${JSON.stringify(
        {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    process.env.STRAJA_APP_CONFIG_TEMPLATES_DIR = appTemplatesDir;

    const store = createMockStore();
    await seedWorkspaceDefaults(store);

    expect(store.getDocumentWithContent("_config", "google-oauth.json")?.content).toBe(
      `${JSON.stringify(
        {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
        null,
        2,
      )}\n`,
    );
  });
});
