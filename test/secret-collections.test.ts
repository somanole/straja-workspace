import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

import { openDatabase } from "../src/db.js";
import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp.js";
import type { CollectionConfig } from "../src/collections.js";
import {
  findDocument,
  findDocuments,
  getHashesForEmbedding,
  getHashesNeedingEmbedding,
  getStatus,
  searchFTS,
} from "../src/store.js";

describe("secret collections", () => {
  let handle: HttpServerHandle | null = null;
  let baseUrl: string;
  let dbPath: string;
  let configDir: string;
  let startupError: NodeJS.ErrnoException | null = null;
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `vault-secret-collections-${Date.now()}.sqlite`);
    configDir = await mkdtemp(join(tmpdir(), "vault-secret-config-"));

    const config: CollectionConfig = { collections: {} };
    await writeFile(join(configDir, "index.yml"), YAML.stringify(config));

    process.env.INDEX_PATH = dbPath;
    process.env.VAULT_CONFIG_DIR = configDir;
    delete process.env.VAULT_HTTP_ADMIN_TOKEN;

    try {
      handle = await startMcpHttpServer(0, { quiet: true });
      baseUrl = `http://localhost:${handle.port}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EPERM" && err?.syscall === "listen") {
        startupError = err;
        return;
      }
      throw error;
    }
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }

    if (origIndexPath !== undefined) process.env.INDEX_PATH = origIndexPath;
    else delete process.env.INDEX_PATH;
    if (origConfigDir !== undefined) process.env.VAULT_CONFIG_DIR = origConfigDir;
    else delete process.env.VAULT_CONFIG_DIR;
    if (origAdminToken !== undefined) process.env.VAULT_HTTP_ADMIN_TOKEN = origAdminToken;
    else delete process.env.VAULT_HTTP_ADMIN_TOKEN;

    try {
      await unlink(dbPath);
    } catch {
      // Ignore missing test db.
    }

    try {
      const files = await readdir(configDir);
      for (const file of files) {
        await unlink(join(configDir, file));
      }
      await rmdir(configDir);
    } catch {
      // Ignore cleanup failures.
    }
  });

  test("credentials, auth profiles, and config docs stay out of search, browse, and embedding", async () => {
    if (startupError) {
      console.warn(`Skipping HTTP secret collection test in restricted environment: ${startupError.message}`);
      return;
    }

    const publicPath = "team-roadmap.md";
    const credentialPath = "telegram-allowFrom.json";
    const authProfilePath = "auth-profiles.json";
    const configPath = "browser.json";

    const publicBody = "Roadmap alpha milestone for vault search policy.";
    const credentialBody = JSON.stringify({ secret: "pairing-alpha-secret" }, null, 2);
    const authProfileBody = JSON.stringify({ profiles: { default: { token: "auth-profile-alpha-secret" } } }, null, 2);
    const configBody = JSON.stringify({ browserToken: "config-alpha-secret" }, null, 2);
    const agentId = "straja";

    const agentConfigResponse = await fetch(`${baseUrl}/connections/agents/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: agentId,
        name: "Straja",
        type: "openclaw",
        gatewayUrl: "http://localhost:18790",
        token: "hooks-token",
        hooksPath: "/hooks/agent",
        enabled: true,
        notifications: { gmail: true, gcalendar: true },
      }),
    });
    expect(agentConfigResponse.ok).toBe(true);

    const pairResponse = await fetch(`${baseUrl}/connections/agents/${agentId}/vault-access/token`, {
      method: "POST",
    });
    expect(pairResponse.ok).toBe(true);
    const pairBody = await pairResponse.json() as { token: string };
    const secretHeaders = { Authorization: `Bearer ${pairBody.token}` };

    const writes = [
      fetch(`${baseUrl}/raw/docs/${encodeURIComponent(publicPath)}`, { method: "PUT", body: publicBody }),
      fetch(`${baseUrl}/raw/_credentials/${encodeURIComponent(credentialPath)}`, {
        method: "PUT",
        headers: secretHeaders,
        body: credentialBody,
      }),
      fetch(`${baseUrl}/raw/_auth_profiles/${encodeURIComponent(authProfilePath)}`, {
        method: "PUT",
        headers: secretHeaders,
        body: authProfileBody,
      }),
      fetch(`${baseUrl}/raw/_config/${encodeURIComponent(configPath)}`, { method: "PUT", body: configBody }),
    ];
    const responses = await Promise.all(writes);
    for (const response of responses) {
      expect(response.ok).toBe(true);
    }

    const db = openDatabase(dbPath);
    try {
      const ftsRows = db.prepare(`
        SELECT filepath
        FROM documents_fts
        WHERE filepath IN (?, ?, ?, ?)
        ORDER BY filepath
      `).all(
        `docs/${publicPath}`,
        `_credentials/${credentialPath}`,
        `_auth_profiles/${authProfilePath}`,
        `_config/${configPath}`,
      ) as Array<{ filepath: string }>;
      expect(ftsRows.map(row => row.filepath)).toEqual([`docs/${publicPath}`]);

      expect(getHashesNeedingEmbedding(db)).toBe(1);
      expect(getHashesForEmbedding(db).map(row => row.path)).toEqual([publicPath]);

      expect(searchFTS(db, "pairing-alpha-secret").length).toBe(0);
      expect(searchFTS(db, "auth-profile-alpha-secret").length).toBe(0);
      expect(searchFTS(db, "config-alpha-secret").length).toBe(0);
      expect(searchFTS(db, "roadmap alpha", 10).map(row => row.displayPath)).toContain(`docs/${publicPath}`);
      expect(searchFTS(db, "roadmap alpha", 10, "_credentials")).toEqual([]);

      expect(findDocument(db, `vault://_credentials/${credentialPath}`)).toMatchObject({ error: "not_found" });
      expect(findDocument(db, `vault://_auth_profiles/${authProfilePath}`)).toMatchObject({ error: "not_found" });
      expect(findDocument(db, `vault://_config/${configPath}`)).toMatchObject({ error: "not_found" });
      expect(findDocuments(db, `vault://_credentials/${credentialPath}`).docs).toEqual([]);

      const status = getStatus(db);
      expect(status.collections.map(collection => collection.name)).toEqual(["docs"]);
      expect(status.totalDocuments).toBe(1);
    } finally {
      db.close();
    }

    const scopedSearchResponse = await fetch(`${baseUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searches: [{ type: "lex", query: "roadmap alpha" }],
        collections: ["_credentials"],
      }),
    });
    expect(scopedSearchResponse.ok).toBe(true);
    const scopedSearchBody = await scopedSearchResponse.json() as { results: unknown[] };
    expect(scopedSearchBody.results).toEqual([]);

    const collectionListResponse = await fetch(`${baseUrl}/collections/_credentials/files`);
    expect(collectionListResponse.status).toBe(404);

    const rawCredentialsUnauthorizedResponse = await fetch(`${baseUrl}/raw/_credentials/${encodeURIComponent(credentialPath)}`);
    expect(rawCredentialsUnauthorizedResponse.status).toBe(401);

    const rawCredentialsResponse = await fetch(`${baseUrl}/raw/_credentials/${encodeURIComponent(credentialPath)}`, {
      headers: secretHeaders,
    });
    expect(rawCredentialsResponse.status).toBe(200);
    expect(await rawCredentialsResponse.text()).toContain("pairing-alpha-secret");

    const rawAuthProfilesUnauthorizedResponse = await fetch(`${baseUrl}/raw/_auth_profiles/${encodeURIComponent(authProfilePath)}`);
    expect(rawAuthProfilesUnauthorizedResponse.status).toBe(401);

    const rawAuthProfilesResponse = await fetch(`${baseUrl}/raw/_auth_profiles/${encodeURIComponent(authProfilePath)}`, {
      headers: secretHeaders,
    });
    expect(rawAuthProfilesResponse.status).toBe(200);
    expect(await rawAuthProfilesResponse.text()).toContain("auth-profile-alpha-secret");

    const auditUnauthorizedResponse = await fetch(`${baseUrl}/audit/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "memory",
        entry: { timestamp: new Date().toISOString(), action: "test" },
      }),
    });
    expect(auditUnauthorizedResponse.status).toBe(401);

    const auditAuthorizedResponse = await fetch(`${baseUrl}/audit/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...secretHeaders },
      body: JSON.stringify({
        category: "memory",
        entry: { timestamp: new Date().toISOString(), action: "test" },
      }),
    });
    expect(auditAuthorizedResponse.status).toBe(200);

    const rawConfigResponse = await fetch(`${baseUrl}/raw/_config/${encodeURIComponent(configPath)}`);
    expect(rawConfigResponse.status).toBe(404);
  });
});
