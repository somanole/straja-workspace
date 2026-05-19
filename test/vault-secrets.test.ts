import { afterEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  destroyVaultEncryption,
  getVaultEncryptionStatus,
  initializeVaultEncryption,
  isVaultLocked,
  lockVaultEncryption,
  resolveVaultDatabaseEncryption,
  unlockVaultEncryption,
} from "../src/vault-secrets.js";

const cleanupPaths: string[] = [];
const origKeyStoreBackend = process.env.STRAJA_VAULT_KEYSTORE_BACKEND;
const origKeyStoreDir = process.env.STRAJA_VAULT_KEYSTORE_DIR;

afterEach(async () => {
  await Promise.allSettled(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  if (origKeyStoreBackend !== undefined) process.env.STRAJA_VAULT_KEYSTORE_BACKEND = origKeyStoreBackend;
  else delete process.env.STRAJA_VAULT_KEYSTORE_BACKEND;
  if (origKeyStoreDir !== undefined) process.env.STRAJA_VAULT_KEYSTORE_DIR = origKeyStoreDir;
  else delete process.env.STRAJA_VAULT_KEYSTORE_DIR;
});

async function createTempDbPath(name: string): Promise<{ dbPath: string; keyStoreDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vault-secrets-test-"));
  const keyStoreDir = await mkdtemp(join(tmpdir(), "vault-keystore-test-"));
  cleanupPaths.push(dir, keyStoreDir);
  return { dbPath: join(dir, `${name}.sqlite`), keyStoreDir };
}

describe("vault secrets", () => {
  test("initializes metadata, stores the db key reference, and enforces PIN lock state", async () => {
    const { dbPath, keyStoreDir } = await createTempDbPath("roundtrip");
    process.env.STRAJA_VAULT_KEYSTORE_BACKEND = "file";
    process.env.STRAJA_VAULT_KEYSTORE_DIR = keyStoreDir;

    expect(getVaultEncryptionStatus(dbPath)).toEqual({
      initialized: false,
      unlocked: false,
      storage: "sqlcipher-keychain",
      lockScope: "vault",
      keyProvider: null,
      protectedCollections: [],
    });

    const initialized = initializeVaultEncryption(dbPath, "123456");
    expect(initialized).toEqual({
      initialized: true,
      unlocked: true,
      storage: "sqlcipher-keychain",
      lockScope: "vault",
      keyProvider: "file",
      protectedCollections: [],
    });

    const metadata = JSON.parse(await readFile(`${dbPath}.secrets.json`, "utf-8")) as {
      pin?: { format?: string };
      database?: { keyRef?: { backend?: string; path?: string } };
    };
    expect(metadata.pin?.format).toBe("6-digit");
    expect(metadata.database?.keyRef?.backend).toBe("file");
    expect(metadata.database?.keyRef?.path && existsSync(metadata.database.keyRef.path)).toBe(true);

    const encryption = resolveVaultDatabaseEncryption(dbPath);
    expect(encryption).toMatchObject({
      provider: "sqlcipher",
      cipher: "sqlcipher",
      legacy: 4,
    });
    expect(encryption?.key).toHaveLength(64);

    expect(isVaultLocked(dbPath)).toBe(false);
    const locked = lockVaultEncryption(dbPath);
    expect(locked.unlocked).toBe(false);
    expect(isVaultLocked(dbPath)).toBe(true);

    expect(() => unlockVaultEncryption(dbPath, "000000")).toThrow("Incorrect PIN.");
    const unlocked = unlockVaultEncryption(dbPath, "123456");
    expect(unlocked.unlocked).toBe(true);
    expect(isVaultLocked(dbPath)).toBe(false);
  });

  test("destroyVaultEncryption removes metadata and the stored db key", async () => {
    const { dbPath, keyStoreDir } = await createTempDbPath("destroy");
    process.env.STRAJA_VAULT_KEYSTORE_BACKEND = "file";
    process.env.STRAJA_VAULT_KEYSTORE_DIR = keyStoreDir;

    initializeVaultEncryption(dbPath, "654321");
    const metadata = JSON.parse(await readFile(`${dbPath}.secrets.json`, "utf-8")) as {
      database: { keyRef: { path: string } };
    };
    expect(existsSync(metadata.database.keyRef.path)).toBe(true);

    destroyVaultEncryption(dbPath);

    expect(existsSync(`${dbPath}.secrets.json`)).toBe(false);
    expect(existsSync(metadata.database.keyRef.path)).toBe(false);
    expect(resolveVaultDatabaseEncryption(dbPath)).toBeNull();
  });
});
