import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp.js";
import type { CollectionConfig } from "../src/collections.js";

describe("HTTP admin auth", () => {
  let handle: HttpServerHandle | null = null;
  let baseUrl = "";
  let dbPath = "";
  let configDir = "";
  let startupError: NodeJS.ErrnoException | null = null;

  const adminToken = "vault-admin-test-token";
  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `vault-http-admin-auth-${Date.now()}.sqlite`);
    configDir = await mkdtemp(join(tmpdir(), "vault-http-admin-config-"));

    const config: CollectionConfig = { collections: {} };
    await writeFile(join(configDir, "index.yml"), YAML.stringify(config));

    process.env.INDEX_PATH = dbPath;
    process.env.VAULT_CONFIG_DIR = configDir;
    process.env.VAULT_HTTP_ADMIN_TOKEN = adminToken;

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

  test("health stays public while admin routes require auth", async () => {
    if (startupError) {
      console.warn(`Skipping HTTP admin auth test in restricted environment: ${startupError.message}`);
      return;
    }

    const healthResponse = await fetch(`${baseUrl}/health`);
    expect(healthResponse.status).toBe(200);
    const healthBody = await healthResponse.json() as {
      httpAuth?: { adminRequired?: boolean };
    };
    expect(healthBody.httpAuth?.adminRequired).toBe(true);

    const unauthorizedStatus = await fetch(`${baseUrl}/status`);
    expect(unauthorizedStatus.status).toBe(401);

    const wrongTokenStatus = await fetch(`${baseUrl}/status`, {
      headers: {
        Authorization: "Bearer wrong-token",
      },
    });
    expect(wrongTokenStatus.status).toBe(401);

    const authorizedStatus = await fetch(`${baseUrl}/status`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(authorizedStatus.status).toBe(200);

    const publicShellResponse = await fetch(`${baseUrl}/connections`);
    expect([200, 404]).toContain(publicShellResponse.status);

    const unknownRouteResponse = await fetch(`${baseUrl}/totally-new-route`);
    expect(unknownRouteResponse.status).toBe(401);
  });

  test("paired agent token still works for agent-scoped routes when admin auth is enabled", async () => {
    if (startupError) {
      console.warn(`Skipping HTTP admin auth test in restricted environment: ${startupError.message}`);
      return;
    }

    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };

    const agentConfigResponse = await fetch(`${baseUrl}/connections/agents/config`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "straja",
        name: "Straja",
        type: "openclaw",
        gatewayUrl: "http://localhost:18790",
        token: "hooks-token",
        hooksPath: "/hooks/agent",
        enabled: true,
        notifications: { gmail: true, gcalendar: true },
      }),
    });
    expect(agentConfigResponse.status).toBe(200);

    const pairResponse = await fetch(`${baseUrl}/connections/agents/straja/vault-access/token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(pairResponse.status).toBe(200);
    const pairBody = await pairResponse.json() as { token: string };

    const agentStatusResponse = await fetch(`${baseUrl}/status`, {
      headers: {
        Authorization: `Bearer ${pairBody.token}`,
      },
    });
    expect(agentStatusResponse.status).toBe(200);

    const adminOnlyResponse = await fetch(`${baseUrl}/connections/agents/status`, {
      headers: {
        Authorization: `Bearer ${pairBody.token}`,
      },
    });
    expect(adminOnlyResponse.status).toBe(401);
  });

  test("paired agent token can read and write ephemeral media when admin auth is enabled", async () => {
    if (startupError) {
      console.warn(`Skipping HTTP admin auth test in restricted environment: ${startupError.message}`);
      return;
    }

    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };

    const agentConfigResponse = await fetch(`${baseUrl}/connections/agents/config`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "media-agent",
        name: "Media Agent",
        type: "openclaw",
        gatewayUrl: "http://localhost:18791",
        token: "hooks-token",
        hooksPath: "/hooks/agent",
        enabled: true,
        notifications: { gmail: true, gcalendar: true },
      }),
    });
    expect(agentConfigResponse.status).toBe(200);

    const pairResponse = await fetch(`${baseUrl}/connections/agents/media-agent/vault-access/token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(pairResponse.status).toBe(200);
    const pairBody = await pairResponse.json() as { token: string };

    const mediaPayload = Buffer.from("test-media-payload");
    const mediaPostResponse = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pairBody.token}`,
        "Content-Type": "application/octet-stream",
        "X-Original-Name": "example.txt",
      },
      body: mediaPayload,
    });
    expect(mediaPostResponse.status).toBe(200);
    const mediaPostBody = await mediaPostResponse.json() as { path: string; url: string };
    expect(mediaPostBody.path).toBeTruthy();
    expect(mediaPostBody.url).toContain(`/media/${mediaPostBody.path}`);

    const mediaGetResponse = await fetch(`${baseUrl}/media/${encodeURIComponent(mediaPostBody.path)}`, {
      headers: {
        Authorization: `Bearer ${pairBody.token}`,
      },
    });
    expect(mediaGetResponse.status).toBe(200);
    expect(Buffer.from(await mediaGetResponse.arrayBuffer())).toEqual(mediaPayload);

    const mediaDeleteResponse = await fetch(`${baseUrl}/media/${encodeURIComponent(mediaPostBody.path)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${pairBody.token}`,
      },
    });
    expect(mediaDeleteResponse.status).toBe(204);
  });
});
