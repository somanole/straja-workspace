# SQLCipher Spike

This branch moves `straja-vault` to SQLCipher-compatible encrypted SQLite on Node.

## Current scope

- Node runtime only
- Uses `better-sqlite3-multiple-ciphers` in SQLCipher compatibility mode
- DB key stored via key store backend
- 6-digit PIN used as the Vault lock/unlock gate
- Current default test backend can use a file key store; production on macOS uses Keychain

The database file is encrypted at rest. The Vault lock state is enforced at the
HTTP route layer.

## Install

```bash
cd /Users/stelo/straja-work-suite/straja-vault
npm install
```

## Run with the file key store backend

```bash
cd /Users/stelo/straja-work-suite/straja-vault
STRAJA_VAULT_KEYSTORE_BACKEND=file \
STRAJA_VAULT_KEYSTORE_DIR=/tmp/straja-keystore \
INDEX_PATH=/tmp/straja-sqlcipher-test.sqlite \
npm run vault -- mcp --http --port 8181
```

Then open the UI and create the 6-digit PIN from the Vault encryption screen.

## Verify on disk

The database file should no longer start with the plaintext SQLite header:

```bash
xxd -l 32 /tmp/straja-sqlcipher-test.sqlite
```

You should not see:

```text
SQLite format 3
```

Opening the DB without the stored DB key, or with the wrong key, should fail.

## Current limitations

- Bun path is not supported for encrypted DB mode
- Locking currently gates Vault routes rather than unmounting the DB process-wide
- MCP stdio should be treated as unavailable while locked
