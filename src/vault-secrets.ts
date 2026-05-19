import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { DatabaseEncryptionOptions } from "./db.js";

const ENCRYPTION_METADATA_VERSION = 2;
const ENCRYPTION_METADATA_SUFFIX = ".secrets.json";
const PIN_PATTERN = /^\d{6}$/;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const DEFAULT_SQLCIPHER_LEGACY = 4;
const KEYCHAIN_SERVICE = "ai.straja.workspace.vault.db";

type KeyStoreRef =
  | {
      backend: "macos-keychain";
      service: string;
      account: string;
    }
  | {
      backend: "file";
      path: string;
    };

type EncryptionMetadata = {
  version: number;
  createdAt: string;
  mode: "sqlcipher-keychain";
  pin: {
    format: "6-digit";
    kdf: "scrypt";
    salt: string;
    n: number;
    r: number;
    p: number;
    verifier: string;
  };
  database: {
    provider: "sqlcipher";
    cipher: "sqlcipher";
    legacy: number;
    keyRef: KeyStoreRef;
  };
};

type SessionState = {
  unlockedAt: string;
};

export type VaultEncryptionStatus = {
  initialized: boolean;
  unlocked: boolean;
  storage: "sqlcipher-keychain";
  lockScope: "vault";
  keyProvider: "macos-keychain" | "file" | null;
  protectedCollections: string[];
};

const unlockedSessions = new Map<string, SessionState>();

function getMetadataPath(dbPath: string): string {
  return `${dbPath}${ENCRYPTION_METADATA_SUFFIX}`;
}

function ensureValidPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error("PIN must be exactly 6 digits.");
  }
}

function parseMetadata(dbPath: string): EncryptionMetadata | null {
  const metadataPath = getMetadataPath(dbPath);
  if (!existsSync(metadataPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf-8")) as Partial<EncryptionMetadata>;
  if (parsed.version !== ENCRYPTION_METADATA_VERSION) {
    return null;
  }
  if (
    !parsed.pin?.salt ||
    !parsed.pin?.verifier ||
    !parsed.database?.provider ||
    !parsed.database?.keyRef
  ) {
    throw new Error("Vault encryption metadata is incomplete.");
  }
  return parsed as EncryptionMetadata;
}

function writeMetadata(dbPath: string, metadata: EncryptionMetadata): void {
  writeFileSync(getMetadataPath(dbPath), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function derivePinVerifier(pin: string, salt: Buffer, metadata?: EncryptionMetadata["pin"]): Buffer {
  return scryptSync(pin, salt, 32, {
    N: metadata?.n ?? SCRYPT_N,
    r: metadata?.r ?? SCRYPT_R,
    p: metadata?.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

function verifyPin(metadata: EncryptionMetadata, pin: string): void {
  ensureValidPin(pin);
  const salt = Buffer.from(metadata.pin.salt, "base64");
  const actual = derivePinVerifier(pin, salt, metadata.pin);
  const expected = Buffer.from(metadata.pin.verifier, "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Incorrect PIN.");
  }
}

function getDbKeyAccount(dbPath: string): string {
  return createHash("sha256").update(dbPath).digest("hex");
}

function getFileKeyStoreRef(dbPath: string): KeyStoreRef {
  const keyDir = process.env.STRAJA_VAULT_KEYSTORE_DIR?.trim();
  if (!keyDir) {
    throw new Error("STRAJA_VAULT_KEYSTORE_DIR is required when using the file key store backend.");
  }
  return {
    backend: "file",
    path: join(keyDir, `${getDbKeyAccount(dbPath)}.key`),
  };
}

function getDefaultKeyStoreRef(dbPath: string): KeyStoreRef {
  if (process.env.STRAJA_VAULT_KEYSTORE_BACKEND === "file") {
    return getFileKeyStoreRef(dbPath);
  }
  return {
    backend: "macos-keychain",
    service: KEYCHAIN_SERVICE,
    account: getDbKeyAccount(dbPath),
  };
}

function storeDbKey(keyRef: KeyStoreRef, dbKey: string): void {
  if (keyRef.backend === "file") {
    mkdirSync(dirname(keyRef.path), { recursive: true });
    writeFileSync(keyRef.path, `${dbKey}\n`, { encoding: "utf-8", mode: 0o600 });
    return;
  }
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-a",
    keyRef.account,
    "-s",
    keyRef.service,
    "-w",
    dbKey,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function loadDbKey(keyRef: KeyStoreRef): string {
  if (keyRef.backend === "file") {
    return readFileSync(keyRef.path, "utf-8").trim();
  }
  return execFileSync("security", [
    "find-generic-password",
    "-a",
    keyRef.account,
    "-s",
    keyRef.service,
    "-w",
  ], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function deleteDbKey(keyRef: KeyStoreRef): void {
  if (keyRef.backend === "file") {
    if (existsSync(keyRef.path)) {
      unlinkSync(keyRef.path);
    }
    return;
  }
  try {
    execFileSync("security", [
      "delete-generic-password",
      "-a",
      keyRef.account,
      "-s",
      keyRef.service,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Ignore missing keychain items.
  }
}

export function getVaultEncryptionStatus(dbPath: string): VaultEncryptionStatus {
  const metadata = parseMetadata(dbPath);
  return {
    initialized: metadata !== null,
    unlocked: metadata !== null && unlockedSessions.has(dbPath),
    storage: "sqlcipher-keychain",
    lockScope: "vault",
    keyProvider: metadata?.database.keyRef.backend ?? null,
    protectedCollections: [],
  };
}

export function isVaultLocked(dbPath: string): boolean {
  const metadata = parseMetadata(dbPath);
  return metadata !== null && !unlockedSessions.has(dbPath);
}

export function initializeVaultEncryption(dbPath: string, pin: string): VaultEncryptionStatus {
  ensureValidPin(pin);
  if (parseMetadata(dbPath)) {
    throw new Error("Vault encryption has already been initialized.");
  }

  const keyRef = getDefaultKeyStoreRef(dbPath);
  const dbKey = randomBytes(32).toString("hex");
  const salt = randomBytes(16);
  const verifier = derivePinVerifier(pin, salt);

  storeDbKey(keyRef, dbKey);

  try {
    const metadata: EncryptionMetadata = {
      version: ENCRYPTION_METADATA_VERSION,
      createdAt: new Date().toISOString(),
      mode: "sqlcipher-keychain",
      pin: {
        format: "6-digit",
        kdf: "scrypt",
        salt: salt.toString("base64"),
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        verifier: verifier.toString("base64"),
      },
      database: {
        provider: "sqlcipher",
        cipher: "sqlcipher",
        legacy: DEFAULT_SQLCIPHER_LEGACY,
        keyRef,
      },
    };
    writeMetadata(dbPath, metadata);
    unlockedSessions.set(dbPath, { unlockedAt: new Date().toISOString() });
    return getVaultEncryptionStatus(dbPath);
  } catch (error) {
    deleteDbKey(keyRef);
    throw error;
  }
}

export function unlockVaultEncryption(dbPath: string, pin: string): VaultEncryptionStatus {
  const metadata = parseMetadata(dbPath);
  if (!metadata) {
    throw new Error("Vault encryption has not been initialized.");
  }
  verifyPin(metadata, pin);
  // Ensure the DB key still exists before reporting success.
  loadDbKey(metadata.database.keyRef);
  unlockedSessions.set(dbPath, { unlockedAt: new Date().toISOString() });
  return getVaultEncryptionStatus(dbPath);
}

export function lockVaultEncryption(dbPath: string): VaultEncryptionStatus {
  unlockedSessions.delete(dbPath);
  return getVaultEncryptionStatus(dbPath);
}

export function destroyVaultEncryption(dbPath: string): void {
  const metadata = parseMetadata(dbPath);
  if (metadata) {
    deleteDbKey(metadata.database.keyRef);
    const metadataPath = getMetadataPath(dbPath);
    if (existsSync(metadataPath)) {
      unlinkSync(metadataPath);
    }
  }
  unlockedSessions.delete(dbPath);
}

export function resolveVaultDatabaseEncryption(dbPath: string): DatabaseEncryptionOptions | null {
  const metadata = parseMetadata(dbPath);
  if (!metadata) {
    return null;
  }
  return {
    provider: "sqlcipher",
    key: loadDbKey(metadata.database.keyRef),
    cipher: metadata.database.cipher,
    legacy: metadata.database.legacy,
  };
}
