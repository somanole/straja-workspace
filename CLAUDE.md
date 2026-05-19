# Straja Runtime -- Browser & Execution Security Model

This document defines the minimum security guarantees for Straja Vault
browser and execution capabilities.

The guiding principle:

Vault is the boundary.\
Agents are untrusted.\
Browsing and execution are powerful but must be governed.

------------------------------------------------------------------------

# Threat Model

Primary risks:

1.  Data exfiltration (egress)
    -   Uploading vault files to attacker-controlled sites
    -   Posting sensitive text (API keys, secrets, private emails)
    -   Copy/paste leaks into web forms
    -   Silent background uploads
2.  Prompt injection via web content
    -   Malicious pages instructing the agent to reveal secrets
    -   Cross-domain redirection to attacker sites
3.  Browser state abuse
    -   Persistent cookies used across tasks
    -   Account takeover via automated actions
4.  Runtime escape
    -   Browser code execution abuse
    -   Access to host filesystem
    -   Unrestricted navigation

------------------------------------------------------------------------

# Core Security Principles

1.  Fail closed\
    If policy is unclear → block.

2.  Vault mediates everything\
    Agent never directly talks to:

    -   Playwright
    -   Filesystem
    -   Network execution backend

3.  Least privilege

    -   Domains scoped
    -   Sessions scoped
    -   Uploads scoped
    -   Memory scoped

4.  Explicit egress control\
    Ingress (reading) is not symmetric with egress
    (writing/posting/uploading).

------------------------------------------------------------------------

# Browser Hardening Requirements

## 1. Domain Allowlist (Mandatory)

Each browser session must define:

-   Allowed domains (exact or wildcard)
-   Optional path restrictions

Default: - Cross-domain navigation blocked. - Redirects to new domain
require explicit approval.

------------------------------------------------------------------------

## 2. Upload Control (Critical)

Default: uploads disabled.

If enabled:

-   Only Vault object IDs may be uploaded.
-   Agent cannot specify arbitrary local paths.
-   Vault materializes object into temp file.
-   File chooser attached by Vault.
-   Temp file deleted immediately after.

Never allow: - Direct path uploads - Upload from host filesystem -
Upload from persistent profile directories

------------------------------------------------------------------------

## 3. Text Egress Guard

Before:

-   Form submit
-   Click on "Post / Send / Publish / Submit / Pay"
-   Large paste into input fields

Vault must:

-   Run StrajaGuard checks on outgoing content.
-   Detect:
    -   High entropy tokens
    -   API keys
    -   Emails / phone / IBAN
    -   Vault document markers
-   Block or require approval when triggered.

------------------------------------------------------------------------

## 4. Dangerous Tool Gating

These capabilities must be gated:

-   browser_evaluate
-   browser_run_code
-   arbitrary JS execution

Default: disabled.

If enabled: - Log every invocation - Limit payload size - Require
explicit capability flag - Optional approval per call

------------------------------------------------------------------------

## 5. Session Isolation

-   No shared global browser profile.
-   Per-connection profile directories.
-   Vault-managed lifecycle.
-   Ability to revoke / reset session.

Future: - Encrypted profile storage.

------------------------------------------------------------------------

## 6. Process Boundary

Playwright must not run in-process with Vault long term.

Target:

Vault → browserd (separate process) → Playwright

-   Local socket only.
-   Restricted environment.
-   Killable independently.

------------------------------------------------------------------------

## 7. Audit & Activation Events

Vault must log:

-   Domain + URL
-   Action type (navigate, click, type, upload)
-   Policy result (allowed / blocked / approved)
-   Vault object IDs used for uploads
-   Guard hits
-   Session start/stop

Audit logs must never contain raw sensitive document content.

------------------------------------------------------------------------

# Execution Security (Exec + Process)

Already implemented:

-   Network disabled by default.
-   Workspace-only filesystem.
-   No host filesystem access.
-   No fallback execution.

Remaining requirements:

-   Remove server-side allowNetwork override completely.
-   Limit concurrent sessions.
-   Add execution time limits.
-   Add max output size caps.
-   Optional CPU / memory constraints.

------------------------------------------------------------------------

# Egress Risk Matrix

  Action Type        Risk Level   Default Policy
  ------------------ ------------ ----------------------------
  Navigate           Medium       Allow (allowlist enforced)
  Read page          Low          Allow
  Screenshot         Low          Allow
  Download           Medium       Allow (into Vault only)
  Type small text    Medium       Guarded
  Paste large text   High         Approval required
  Upload file        Critical     Deny by default
  Purchase action    Critical     Approval required
  Post message       High         Approval required

------------------------------------------------------------------------

# Phase 0 Minimum Hardening (Must Implement Next)

1.  Domain allowlist enforcement\
2.  Upload restricted to Vault object IDs only\
3.  Text egress guard before submit/post\
4.  Remove or hard-gate browser_evaluate\
5.  Remove allowNetwork override entirely

------------------------------------------------------------------------

# Future Enhancements

-   Encrypted SQLite at rest
-   Encrypted browser profiles
-   Per-domain OAuth token vault
-   Session "locked" state
-   Zero-trust browser sandboxing (containerized)
-   Behavioral anomaly detection

------------------------------------------------------------------------

# Product Positioning

Straja Runtime is not:

-   A browser automation toy
-   A generic headless browser

It is:

A controlled execution and browsing environment for AI agents, with
strict boundaries between memory, execution, and external communication.


## Commands

```sh
straja-vault collection add . --name <n>   # Create/index collection
straja-vault collection list               # List all collections with details
straja-vault collection remove <name>      # Remove a collection by name
straja-vault collection rename <old> <new> # Rename a collection
straja-vault ls [collection[/path]]        # List collections or files in a collection
straja-vault context add [path] "text"     # Add context for path (defaults to current dir)
straja-vault context list                  # List all contexts
straja-vault context check                 # Check for collections/paths missing context
straja-vault context rm <path>             # Remove context
straja-vault get <file>                    # Get document by path or docid (#abc123)
straja-vault multi-get <pattern>           # Get multiple docs by glob or comma-separated list
straja-vault status                        # Show index status and collections
straja-vault update [--pull]               # Re-index all collections (--pull: git pull first)
straja-vault embed                         # Generate vector embeddings (uses node-llama-cpp)
straja-vault query <query>                 # Search with query expansion + reranking (recommended)
straja-vault search <query>                # Full-text keyword search (BM25, no LLM)
straja-vault vsearch <query>               # Vector similarity search (no reranking)
straja-vault mcp                           # Start MCP server (stdio transport)
straja-vault mcp --http [--port N]         # Start MCP server (HTTP, default port 8181)
straja-vault mcp --http --daemon           # Start as background daemon
straja-vault mcp stop                      # Stop background MCP daemon
```

## Collection Management

```sh
# List all collections
straja-vault collection list

# Create a collection with explicit name
straja-vault collection add ~/Documents/notes --name mynotes --mask '**/*.md'

# Remove a collection
straja-vault collection remove mynotes

# Rename a collection
straja-vault collection rename mynotes my-notes

# List all files in a collection
straja-vault ls mynotes

# List files with a path prefix
straja-vault ls journals/2025
straja-vault ls vault://journals/2025
```

## Context Management

```sh
# Add context to current directory (auto-detects collection)
straja-vault context add "Description of these files"

# Add context to a specific path
straja-vault context add /subfolder "Description for subfolder"

# Add global context to all collections (system message)
straja-vault context add / "Always include this context"

# Add context using virtual paths
straja-vault context add vault://journals/ "Context for entire journals collection"
straja-vault context add vault://journals/2024 "Journal entries from 2024"

# List all contexts
straja-vault context list

# Check for collections or paths without context
straja-vault context check

# Remove context
straja-vault context rm vault://journals/2024
straja-vault context rm /  # Remove global context
```

## Document IDs (docid)

Each document has a unique short ID (docid) - the first 6 characters of its content hash.
Docids are shown in search results as `#abc123` and can be used with `get` and `multi-get`:

```sh
# Search returns docid in results
straja-vault search "query" --json
# Output: [{"docid": "#abc123", "score": 0.85, "file": "docs/readme.md", ...}]

# Get document by docid
straja-vault get "#abc123"
straja-vault get abc123              # Leading # is optional

# Docids also work in multi-get comma-separated lists
straja-vault multi-get "#abc123, #def456"
```

## Options

```sh
# Search & retrieval
-c, --collection <name>  # Restrict search to a collection (matches pwd suffix)
-n <num>                 # Number of results
--all                    # Return all matches
--min-score <num>        # Minimum score threshold
--full                   # Show full document content
--line-numbers           # Add line numbers to output

# Multi-get specific
-l <num>                 # Maximum lines per file
--max-bytes <num>        # Skip files larger than this (default 10KB)

# Output formats (search and multi-get)
--json, --csv, --md, --xml, --files
```

## Development

```sh
tsx src/vault.ts <command>   # Run from source
npm run build                # Compile TypeScript to dist/
npm test                     # Run all tests
```

## Tests

All tests live in `test/`. Run everything:

```sh
npx vitest run --reporter=verbose test/
```

## Architecture

- SQLite FTS5 for full-text search (BM25)
- sqlite-vec for vector similarity search
- node-llama-cpp for embeddings (EmbeddingGemma-300M), reranking (Qwen3-Reranker-0.6B), and query expansion (Qwen3-1.7B)
- Reciprocal Rank Fusion (RRF) for combining results
- Smart chunking: 900 tokens/chunk with 15% overlap, prefers markdown headings as boundaries
- Config: `~/.config/straja-vault/index.yml`
- Index: `~/.cache/straja-vault/index.sqlite`

## Important: Do NOT run automatically

- Never run `straja-vault collection add`, `straja-vault embed`, or `straja-vault update` automatically
- Never modify the SQLite database directly
- Write out example commands for the user to run manually

## Do NOT compile

- Never run `bun build --compile` - it overwrites the shell wrapper and breaks sqlite-vec
- The `straja-vault` file is a shell script that runs compiled JS from `dist/` - do not replace it
- `npm run build` compiles TypeScript to `dist/` via `tsc -p tsconfig.build.json`

## Releasing

Use `/release <version>` to cut a release. Full changelog standards,
release workflow, and git hook setup are documented in the
[release skill](skills/release/SKILL.md).

Key points:
- Add changelog entries under `## [Unreleased]` **as you make changes**
- The release script renames `[Unreleased]` → `[X.Y.Z] - date` at release time
- Credit external PRs with `#NNN (thanks @username)`
