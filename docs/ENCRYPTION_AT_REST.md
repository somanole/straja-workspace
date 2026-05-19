# Encryption At Rest Design

This document defines the intended encryption-at-rest architecture for `straja-vault`.

It is written to support the first external alpha where:

- setup is UI-first
- a 6-digit PIN is the user-facing unlock mechanism
- alpha can start from a fresh vault with no production migration requirement

## Status

Current state:

- `straja-vault` does **not** encrypt its database at rest today
- `content.doc` is stored in plaintext in SQLite
- FTS indexes are built directly from plaintext content
- vectors are stored in plaintext-compatible form in SQLite side tables
- system collections and config documents are also stored in plaintext

This means encryption at rest is a storage architecture change, not a local patch.

## Core Constraint

The current storage model assumes plaintext data is available inside SQLite:

- `content.doc` holds raw content
- `documents_fts` indexes plaintext `body`
- retrieval joins `documents` to `content`
- vector embedding jobs pull plaintext from `content`
- many code paths assume `getDocumentWithContent()` returns readable content

Because of that, application-layer "encrypt the `doc` column" is the wrong design for the current product.

It would break or complicate:

- FTS
- indexing
- hybrid search
- vector embedding
- content retrieval
- migrations
- write queue behavior

## Architectural Decision

For full vault encryption at rest, the correct long-term design is:

- **database-layer encryption**, not selective application-layer document encryption

In practice, that means an encrypted SQLite backend such as SQLCipher or an equivalent SQLite encryption layer compatible with the product's required extensions.

## Why Database-Layer Encryption

Database-layer encryption preserves the current mental model:

- SQLite still stores relational data
- FTS still works normally after unlock
- vector tables still work normally after unlock
- existing store APIs remain mostly intact
- the app unlocks once, then operates as it does today

This is much safer than trying to encrypt some rows/collections manually while leaving search indexes and metadata partially exposed.

## Non-Goal

This design is **not**:

- "use a 6-digit PIN directly as the SQLite key"
- "encrypt only `_config`"
- "encrypt secrets but leave content plaintext"
- "ship OS disk encryption and call it product encryption"

Those do not satisfy the product goal.

## User-Facing Unlock Model

The user-facing unlock factor is a **6-digit PIN**.

But that PIN must **not** be the only cryptographic secret protecting the database.

## Security Constraint: 6-Digit PIN

A 6-digit PIN has only 1,000,000 combinations.

That is not enough entropy to directly protect an offline-copyable database file by itself.

So the defensible model is:

- the vault is encrypted with a strong random key
- the user unlocks access to that key with a 6-digit PIN

## Key Hierarchy

Recommended key model:

1. Generate a random 256-bit `vaultMasterKey` at first initialization.
2. Generate a random `dbKey` if the chosen DB encryption backend requires a distinct DB key.
3. Encrypt or derive the DB from that high-entropy key material.
4. Store only a **wrapped** form of the key material on disk.
5. Use the 6-digit PIN only to unwrap the stored key material.

Recommended practical simplification:

- a single random 256-bit `vaultMasterKey`
- used directly as the database encryption key if backend supports it
- wrapped with a PIN-derived key for storage

## Key Wrapping

The wrapped key record should store:

- KDF type
- KDF parameters
- random salt
- wrapped key ciphertext
- authentication tag / AEAD metadata
- schema version
- creation timestamp

The wrapped key record should **not** live inside the encrypted DB itself, because the DB cannot be opened until the key is recovered.

It should live in a small app-local metadata file.

## KDF Choice

Preferred:

- Argon2id

Minimum fallback if implementation constraints force it:

- scrypt

Requirements:

- per-install random salt
- calibrated runtime
- memory-hard settings
- versioned params for future upgrades

The KDF should be strong enough that brute-forcing a 6-digit PIN is materially slowed, even though the entropy ceiling remains limited.

## Optional Platform Binding

Platform binding can improve the story later, but should not be required for alpha.

Examples:

- macOS Keychain
- Secure Enclave-backed wrapping
- OS-managed machine secret

Good future model:

- PIN + machine-local secure storage together protect unwrap flow

But alpha should not block on this if it delays shipping too much.

## Database Unlock Flow

At startup:

1. App starts.
2. User sees unlock screen.
3. User enters 6-digit PIN.
4. Vault loads wrapped-key metadata.
5. Vault derives unwrap key from PIN + salt.
6. Vault unwraps `vaultMasterKey`.
7. Vault opens encrypted DB with that key.
8. If unlock succeeds, normal runtime begins.

After unlock, the product should behave as closely as possible to the current plaintext runtime.

## First-Run Initialization Flow

On first launch:

1. Detect no existing vault DB.
2. Prompt user to create and confirm 6-digit PIN.
3. Generate random `vaultMasterKey`.
4. Create wrapped-key metadata from PIN-derived key.
5. Create encrypted DB using `vaultMasterKey`.
6. Initialize schema.
7. Initialize required system collections.
8. Seed `_bootstrap`.
9. Mirror `_bootstrap` files into `_workspace`.

## Alpha Scope

For the first external alpha, migration of existing plaintext vaults is **not required**.

That means the initial implementation can assume:

- first launch starts from a fresh vault
- encrypted initialization happens before any real user data exists
- test/dev plaintext vaults do not need to be upgraded yet

This reduces implementation risk and is the correct first milestone.

## Existing Vault Migration

Existing plaintext vault migration should still be designed for later, but it is out of scope for the first alpha.

When needed, the correct path is a **copy migration**, not "flip a flag on the existing DB".

## Migration Strategy

For an existing plaintext vault:

1. Detect plaintext vault format / absence of encryption metadata.
2. Offer upgrade flow in UI.
3. Ask user to create and confirm 6-digit PIN.
4. Generate `vaultMasterKey`.
5. Create a new encrypted target DB beside the old DB.
6. Open old plaintext DB read-only.
7. Create schema in encrypted DB.
8. Copy all required tables/data into encrypted DB.
9. Rebuild or validate FTS/vector state as needed.
10. Verify row counts and key invariants.
11. Rename old DB to backup.
12. Atomically replace active DB path with encrypted DB.
13. Persist wrapped-key metadata.

This gives a reversible migration path and avoids partially encrypted states.

## Migration Scope

The migration must carry over:

- `content`
- `documents`
- `llm_cache` if intentionally retained
- `content_vectors`
- `vectors_vec`
- FTS state or a deterministic FTS rebuild
- all system collections
- `_config` documents
- `_audit`
- raw-only collections

If copying FTS/vector internal tables is risky across engines, the safer option is:

- copy logical tables
- rebuild FTS
- keep vectors if backend-compatible, otherwise rebuild them

The exact behavior depends on the final encrypted SQLite backend.

## Recommended Migration Safety Checks

After migration, verify:

- total `documents` count matches
- total `content` row count matches
- per-collection active document counts match
- sampled hash/content integrity checks pass
- required system collections exist
- `_bootstrap` and `_workspace` bootstrap files are present
- DB opens only with the wrapped key

## Change PIN

Changing the PIN should **not** re-encrypt the entire database.

Instead:

1. unlock current wrapped key with old PIN
2. derive new unwrap key from new PIN
3. re-wrap the same `vaultMasterKey`
4. replace wrapped-key metadata atomically

This keeps PIN rotation cheap and safe.

## Lost PIN

If the PIN is the only user-controlled unlock factor and no recovery flow exists:

- lost PIN means vault cannot be unlocked

That is acceptable only if communicated clearly.

If recovery is desired later, it must be a real cryptographic recovery flow, not a bypass.

## Why Not Application-Layer Collection Encryption

Encrypting only selected collections at the app layer is insufficient for the product goal.

Problems:

- FTS would still reveal plaintext terms unless separately encrypted
- metadata leaks remain large
- vector indexes still expose derived content structure
- many code paths would require collection-by-collection exceptions
- write queue, raw APIs, and indexing would become far more complex

Selective encryption may still make sense for extra-hardening on top of DB encryption, but it should not be the primary at-rest design.

## Runtime Side Effects To Audit

Even with encrypted DBs, at-rest protection is weakened if plaintext leaks elsewhere.

The implementation must audit:

- SQLite sidecar files: WAL, SHM, temp DB artifacts
- execution temp dirs
- browser upload temp files
- screenshot/pdf artifact temp files
- logs
- crash dumps
- prompt debug outputs
- exported/downloaded artifacts

Encryption-at-rest for the DB is necessary but not sufficient.

## Implementation Direction

The implementation should proceed in this order:

1. choose encrypted SQLite backend compatible with current feature set
2. prove compatibility with:
   - FTS5
   - sqlite-vec
   - better-sqlite3-equivalent workflow or replacement
3. implement wrapped-key metadata
4. implement unlock/init flow
5. implement new-vault initialization
6. audit temp/plaintext side effects
7. implement plaintext-to-encrypted migration later if still needed

## Recommended Technical Direction

Current recommendation:

- treat SQLCipher-or-equivalent DB encryption as the target architecture
- keep the 6-digit PIN as unlock UI only
- use a random high-entropy master key under the hood
- migrate existing vaults through a copy process

## Explicit Answer: Can Existing Vaults Be Encrypted?

Yes, later.

But for the current alpha, you do not need to solve migration first.

The first milestone should be:

- fresh encrypted vault creation
- unlock flow
- normal runtime behavior after unlock

Migration can be added afterward if and when real user data exists that needs preservation.
