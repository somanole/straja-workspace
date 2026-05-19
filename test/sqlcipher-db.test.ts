import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  encryptDatabaseAtRest,
  getDatabaseOpenMode,
  isSqlCipherSupported,
  openDatabase,
  resolveDatabaseEncryptionFromEnv,
} from "../src/db.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createTempDbPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-sqlcipher-test-"));
  cleanupPaths.push(dir);
  return join(dir, `${name}.sqlite`);
}

describe("sqlcipher database mode", () => {
  test("resolves sqlcipher config from env", () => {
    expect(resolveDatabaseEncryptionFromEnv({})).toBeNull();

    expect(resolveDatabaseEncryptionFromEnv({
      STRAJA_SQLCIPHER_KEY: "alpha-secret",
      STRAJA_SQLCIPHER_LEGACY: "3",
    } as NodeJS.ProcessEnv)).toEqual({
      provider: "sqlcipher",
      key: "alpha-secret",
      cipher: "sqlcipher",
      legacy: 3,
    });

    expect(getDatabaseOpenMode({
      encryption: {
        provider: "sqlcipher",
        key: "beta-secret",
      },
    })).toBe("sqlcipher");
  });

  test("opens encrypted databases only with the correct key", async () => {
    if (!isSqlCipherSupported()) {
      console.warn(
        "Skipping SQLCipher DB test because better-sqlite3-multiple-ciphers is not installed.",
      );
      return;
    }

    const dbPath = await createTempDbPath("encrypted");
    const encryption = {
      provider: "sqlcipher" as const,
      key: "correct horse battery staple",
      legacy: 4,
    };

    {
      const db = openDatabase(dbPath, { encryption });
      try {
        db.exec("CREATE TABLE secure_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
        db.prepare("INSERT INTO secure_notes (body) VALUES (?)").run("vault secret");
      } finally {
        db.close();
      }
    }

    expect(existsSync(dbPath)).toBe(true);
    const rawBytes = await readFile(dbPath);
    expect(rawBytes.subarray(0, 16).toString("utf-8")).not.toBe("SQLite format 3\u0000");
    expect(rawBytes.includes(Buffer.from("vault secret"))).toBe(false);

    {
      const reopened = openDatabase(dbPath, { encryption });
      try {
        const row = reopened.prepare("SELECT body FROM secure_notes LIMIT 1").get() as { body: string };
        expect(row.body).toBe("vault secret");
      } finally {
        reopened.close();
      }
    }

    {
      const plainDb = openDatabase(dbPath);
      try {
        expect(() => plainDb.prepare("SELECT body FROM secure_notes LIMIT 1").get()).toThrow();
      } finally {
        plainDb.close();
      }
    }
    expect(() =>
      openDatabase(dbPath, {
        encryption: {
          provider: "sqlcipher",
          key: "definitely-wrong",
          legacy: 4,
        },
      })
    ).toThrow();
  });

  test("rekeys a live WAL database into encrypted SQLCipher storage", async () => {
    if (!isSqlCipherSupported()) {
      console.warn(
        "Skipping SQLCipher DB test because better-sqlite3-multiple-ciphers is not installed.",
      );
      return;
    }

    const dbPath = await createTempDbPath("rekey-wal");
    const encryption = {
      provider: "sqlcipher" as const,
      key: "wal-safe-secret",
      legacy: 4,
    };

    {
      const db = openDatabase(dbPath);
      try {
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("CREATE TABLE wal_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
        db.prepare("INSERT INTO wal_notes (body) VALUES (?)").run("hello from wal");
        encryptDatabaseAtRest(db, encryption);
        const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
        expect(journalMode.journal_mode.toLowerCase()).toBe("wal");
      } finally {
        db.close();
      }
    }

    const rawBytes = await readFile(dbPath);
    expect(rawBytes.subarray(0, 16).toString("utf-8")).not.toBe("SQLite format 3\u0000");

    {
      const reopened = openDatabase(dbPath, { encryption });
      try {
        const row = reopened.prepare("SELECT body FROM wal_notes LIMIT 1").get() as { body: string };
        expect(row.body).toBe("hello from wal");
      } finally {
        reopened.close();
      }
    }
  });
});
