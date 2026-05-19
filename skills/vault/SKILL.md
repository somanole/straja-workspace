---
name: vault
description: Search markdown knowledge bases, notes, and documentation using Straja Vault. Use when users ask to search notes, find documents, or look up information.
license: Sustainable Use License 1.0
compatibility: Requires straja-vault CLI or MCP server. Install via `npm install -g @straja/vault`.
metadata:
  author: straja
  version: "0.1.0"
allowed-tools: Bash(straja-vault:*), mcp__straja-vault__*
---

# Straja Vault - Secure Document Search

On-device hybrid search and secure document retrieval.

## Status

!`straja-vault status 2>/dev/null || echo "Not installed: npm install -g @straja/vault"`

## MCP: `query`

```json
{
  "searches": [
    { "type": "lex", "query": "CAP theorem consistency" },
    { "type": "vec", "query": "tradeoff between consistency and availability" }
  ],
  "collections": ["docs"],
  "limit": 10
}
```

### Query Types

| Type | Method | Input |
|------|--------|-------|
| `lex` | BM25 | Keywords — exact terms, names, code |
| `vec` | Vector | Question — natural language |
| `hyde` | Vector | Answer — hypothetical result (50-100 words) |
| `expand` | LLM | Auto-expand via local model (max 1 per query) |

### Writing Good Queries

**lex (keyword)**
- 2-5 terms, no filler words
- Exact phrase: `"connection pool"` (quoted)
- Exclude terms: `performance -sports` (minus prefix)
- Code identifiers work: `handleError async`

**vec (semantic)**
- Full natural language question
- Be specific: `"how does the rate limiter handle burst traffic"`
- Include context: `"in the payment service, how are refunds processed"`

**hyde (hypothetical document)**
- Write 50-100 words of what the *answer* looks like
- Use the vocabulary you expect in the result

**expand (auto-expand)**
- Let the local LLM generate lex/vec/hyde variations
- Good when you don't know exact terms
- Max one expand per query

### Combining Types

| Goal | Approach |
|------|----------|
| Know exact terms | `lex` only |
| Don't know vocabulary | `vec` or `expand` |
| Best recall | `lex` + `vec` |
| Complex topic | `lex` + `vec` + `hyde` |

First query gets 2x weight in fusion — put your best guess first.

### Lex Query Syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| `term` | Prefix match | `perf` matches "performance" |
| `"phrase"` | Exact phrase | `"rate limiter"` |
| `-term` | Exclude | `performance -sports` |

Note: `-term` only works in lex queries, not vec/hyde.

### Collection Filtering

```json
{ "collections": ["docs"] }              // Single
{ "collections": ["docs", "notes"] }     // Multiple (OR)
```

Omit to search all collections.

## Other MCP Tools

| Tool | Use |
|------|-----|
| `status` | Collections and health |

## CLI

```bash
straja-vault query "question"              # Auto-expand + rerank
straja-vault query $'lex: X\nvec: Y'       # Structured
straja-vault query $'expand: question'     # Explicit expand
straja-vault search "keywords"             # BM25 only (no LLM)
straja-vault get "#abc123"                 # By docid
```

## HTTP API

```bash
curl -X POST http://localhost:8181/query \
  -H "Content-Type: application/json" \
  -d '{"searches": [{"type": "lex", "query": "test"}]}'
```

## Setup

```bash
npm install -g @straja/vault
straja-vault collection add ~/notes --name notes
straja-vault embed
```
