/**
 * db.ts - Cross-runtime SQLite compatibility layer
 *
 * Default path:
 * - Bun: bun:sqlite
 * - Node: better-sqlite3
 *
 * Optional encrypted path:
 * - Node only: better-sqlite3-multiple-ciphers in SQLCipher compatibility mode
 *
 * The encrypted backend is intentionally opt-in so existing plaintext workflows
 * keep working until the app-level unlock flow is migrated to DB-at-rest
 * encryption.
 */

export const isBun = typeof globalThis.Bun !== "undefined";

let _Database: any;
let _CipherDatabase: any | null = null;
let _sqliteVecLoad: (db: any) => void;

if (isBun) {
  const bunSqlite = "bun:" + "sqlite";
  _Database = (await import(/* @vite-ignore */ bunSqlite)).Database;
  const { getLoadablePath } = await import("sqlite-vec");
  _sqliteVecLoad = (db: any) => db.loadExtension(getLoadablePath());
} else {
  _Database = (await import("better-sqlite3")).default;
  try {
    const cipherSqlite = "better-sqlite3-multiple-ciphers";
    _CipherDatabase = (await import(/* @vite-ignore */ cipherSqlite)).default;
  } catch {
    _CipherDatabase = null;
  }
  const sqliteVec = await import("sqlite-vec");
  _sqliteVecLoad = (db: any) => sqliteVec.load(db);
}

type DatabaseOpenMode = "plain" | "sqlcipher";

export type DatabaseEncryptionOptions = {
  provider: "sqlcipher";
  key: string;
  cipher?: "sqlcipher";
  legacy?: number;
};

export type DatabaseOpenOptions = {
  encryption?: DatabaseEncryptionOptions | null;
};

function createPlainDatabase(path: string): Database {
  if (!isBun && _CipherDatabase) {
    return new _CipherDatabase(path) as Database;
  }
  return new _Database(path) as Database;
}

function quoteSqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeSqlCipherLegacy(value: string | undefined): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 4;
  }
  return parsed;
}

export function resolveDatabaseEncryptionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseEncryptionOptions | null {
  const key = env.STRAJA_SQLCIPHER_KEY?.trim();
  if (!key) {
    return null;
  }
  return {
    provider: "sqlcipher",
    key,
    cipher: "sqlcipher",
    legacy: normalizeSqlCipherLegacy(env.STRAJA_SQLCIPHER_LEGACY),
  };
}

export function isSqlCipherSupported(): boolean {
  return !isBun && _CipherDatabase !== null;
}

export function getDatabaseOpenMode(
  options?: DatabaseOpenOptions,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseOpenMode {
  return options?.encryption ?? resolveDatabaseEncryptionFromEnv(env) ? "sqlcipher" : "plain";
}

function applySqlCipherPragmas(db: Database, options: DatabaseEncryptionOptions): void {
  if (typeof db.pragma !== "function") {
    throw new Error("SQLCipher backend requires pragma support.");
  }
  const cipherName = options.cipher ?? "sqlcipher";
  db.pragma(`cipher = ${quoteSqlString(cipherName)}`);
  db.pragma(`legacy = ${options.legacy ?? 4}`);
  db.pragma(`key = ${quoteSqlString(options.key)}`);
  // Force page decryption immediately so missing/wrong keys fail at open time.
  db.prepare("SELECT count(*) as count FROM sqlite_master").get();
}

/**
 * Open a SQLite database.
 *
 * Plain mode works with both Bun and Node.
 * SQLCipher mode is available only on Node when the
 * better-sqlite3-multiple-ciphers dependency is installed.
 */
export function openDatabase(path: string, options?: DatabaseOpenOptions): Database {
  const encryption = options?.encryption ?? resolveDatabaseEncryptionFromEnv();
  if (!encryption) {
    return createPlainDatabase(path);
  }
  if (isBun) {
    throw new Error("SQLCipher mode is not supported under Bun. Run straja-vault with Node.");
  }
  if (encryption.provider !== "sqlcipher") {
    throw new Error(`Unsupported database encryption provider: ${encryption.provider}`);
  }
  if (!_CipherDatabase) {
    throw new Error(
      "SQLCipher mode requires the 'better-sqlite3-multiple-ciphers' package to be installed.",
    );
  }
  const db = new _CipherDatabase(path) as Database;
  applySqlCipherPragmas(db, encryption);
  return db;
}

export function encryptDatabaseAtRest(db: Database, options: DatabaseEncryptionOptions): void {
  if (isBun) {
    throw new Error("SQLCipher rekey is not supported under Bun.");
  }
  if (typeof db.pragma !== "function") {
    throw new Error("SQLCipher rekey requires pragma support.");
  }
  const currentJournalModeRaw = db.pragma("journal_mode", { simple: true });
  const currentJournalMode = String(currentJournalModeRaw ?? "").trim().toLowerCase();
  const restoreWal = currentJournalMode === "wal";
  if (restoreWal) {
    db.exec("PRAGMA wal_checkpoint(FULL)");
    db.exec("PRAGMA journal_mode = DELETE");
  }
  const cipherName = options.cipher ?? "sqlcipher";
  try {
    db.pragma(`cipher = ${quoteSqlString(cipherName)}`);
    db.pragma(`legacy = ${options.legacy ?? 4}`);
    db.pragma(`rekey = ${quoteSqlString(options.key)}`);
    db.prepare("SELECT count(*) as count FROM sqlite_master").get();
  } finally {
    if (restoreWal) {
      db.exec("PRAGMA journal_mode = WAL");
    }
  }
}

/**
 * Common subset of the Database interface used throughout Straja Vault.
 */
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  loadExtension(path: string): void;
  close(): void;
  pragma?(sql: string, options?: { simple?: boolean }): any;
}

export interface Statement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

/**
 * Load the sqlite-vec extension into a database.
 */
export function loadSqliteVec(db: Database): void {
  _sqliteVecLoad(db);
}
