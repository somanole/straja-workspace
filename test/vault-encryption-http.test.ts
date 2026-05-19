import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

import { startMcpHttpServer, type HttpServerHandle } from "../src/mcp.js";
import type { CollectionConfig } from "../src/collections.js";

type HealthResponse = {
  encryption?: {
    initialized?: boolean;
    unlocked?: boolean;
    storage?: string;
    lockScope?: string;
    keyProvider?: string | null;
    protectedCollections?: string[];
  };
};

describe("vault encryption http flow", () => {
  let handle: HttpServerHandle | null = null;
  let baseUrl = "";
  let dbPath = "";
  let configDir = "";
  let keyStoreDir = "";
  let startupError: NodeJS.ErrnoException | null = null;

  const origIndexPath = process.env.INDEX_PATH;
  const origConfigDir = process.env.VAULT_CONFIG_DIR;
  const origAdminToken = process.env.VAULT_HTTP_ADMIN_TOKEN;
  const origKeyStoreBackend = process.env.STRAJA_VAULT_KEYSTORE_BACKEND;
  const origKeyStoreDir = process.env.STRAJA_VAULT_KEYSTORE_DIR;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `vault-encryption-http-${Date.now()}.sqlite`);
    configDir = await mkdtemp(join(tmpdir(), "vault-encryption-http-config-"));
    keyStoreDir = await mkdtemp(join(tmpdir(), "vault-encryption-http-keystore-"));

    const config: CollectionConfig = { collections: {} };
    await writeFile(join(configDir, "index.yml"), YAML.stringify(config));

    process.env.INDEX_PATH = dbPath;
    process.env.VAULT_CONFIG_DIR = configDir;
    process.env.STRAJA_VAULT_KEYSTORE_BACKEND = "file";
    process.env.STRAJA_VAULT_KEYSTORE_DIR = keyStoreDir;
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
    if (origKeyStoreBackend !== undefined) process.env.STRAJA_VAULT_KEYSTORE_BACKEND = origKeyStoreBackend;
    else delete process.env.STRAJA_VAULT_KEYSTORE_BACKEND;
    if (origKeyStoreDir !== undefined) process.env.STRAJA_VAULT_KEYSTORE_DIR = origKeyStoreDir;
    else delete process.env.STRAJA_VAULT_KEYSTORE_DIR;

    for (const suffix of ["", "-shm", "-wal", ".secrets.json"]) {
      try {
        await unlink(`${dbPath}${suffix}`);
      } catch {
        // Ignore missing files.
      }
    }

    try {
      const configFiles = await readdir(configDir);
      for (const file of configFiles) {
        await unlink(join(configDir, file));
      }
      await rmdir(configDir);
    } catch {
      // Ignore cleanup failures.
    }

    try {
      const keyFiles = await readdir(keyStoreDir);
      for (const file of keyFiles) {
        await unlink(join(keyStoreDir, file));
      }
      await rmdir(keyStoreDir);
    } catch {
      // Ignore cleanup failures.
    }
  });

  test("initializes SQLCipher storage, locks the vault, and unlocks it with the PIN", async () => {
    if (startupError) {
      console.warn(`Skipping vault encryption HTTP test in restricted environment: ${startupError.message}`);
      return;
    }

    const healthBefore = await fetch(`${baseUrl}/health`);
    expect(healthBefore.status).toBe(200);
    const healthBeforeBody = await healthBefore.json() as HealthResponse;
    expect(healthBeforeBody.encryption).toEqual({
      initialized: false,
      unlocked: false,
      storage: "sqlcipher-keychain",
      lockScope: "vault",
      keyProvider: null,
      protectedCollections: [],
    });

    const initResponse = await fetch(`${baseUrl}/security/encryption/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    expect(initResponse.status).toBe(200);
    expect(await initResponse.json()).toMatchObject({
      initialized: true,
      unlocked: true,
      storage: "sqlcipher-keychain",
      keyProvider: "file",
    });

    const browserConfig = JSON.stringify({
      enabled: false,
      headless: true,
      token: "browser-alpha-secret",
    }, null, 2);

    const putResponse = await fetch(`${baseUrl}/raw/_config/browser.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: browserConfig,
    });
    expect(putResponse.status).toBe(200);

    const rawBytes = await readFile(dbPath);
    expect(rawBytes.subarray(0, 16).toString("utf-8")).not.toBe("SQLite format 3\u0000");
    expect(rawBytes.includes(Buffer.from("browser-alpha-secret"))).toBe(false);

    const lockResponse = await fetch(`${baseUrl}/security/encryption/lock`, {
      method: "POST",
    });
    expect(lockResponse.status).toBe(200);
    expect(await lockResponse.json()).toMatchObject({ initialized: true, unlocked: false });

    const healthLocked = await fetch(`${baseUrl}/health`);
    const healthLockedBody = await healthLocked.json() as HealthResponse;
    expect(healthLockedBody.encryption).toMatchObject({
      initialized: true,
      unlocked: false,
      keyProvider: "file",
    });

    const lockedRawResponse = await fetch(`${baseUrl}/raw/_workspace/BOOTSTRAP.md`);
    expect(lockedRawResponse.status).toBe(423);
    await expect(lockedRawResponse.json()).resolves.toMatchObject({ code: "vault_locked" });

    const wrongUnlockResponse = await fetch(`${baseUrl}/security/encryption/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    expect(wrongUnlockResponse.status).toBe(500);

    const unlockResponse = await fetch(`${baseUrl}/security/encryption/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    expect(unlockResponse.status).toBe(200);
    expect(await unlockResponse.json()).toMatchObject({ initialized: true, unlocked: true });

    const rawConfigResponse = await fetch(`${baseUrl}/connections/browser/config`);
    expect(rawConfigResponse.status).toBe(200);
    const rawConfigBody = await rawConfigResponse.json() as { enabled?: boolean; headless?: boolean };
    expect(rawConfigBody).toMatchObject({ enabled: false, headless: true });
  });
});
