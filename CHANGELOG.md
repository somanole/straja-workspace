# Changelog

All notable changes to Straja Vault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-19

Initial Straja Vault release. On-device hybrid search and secure document retrieval
with BM25, vector search, and LLM reranking.

### Added
- BM25 full-text search via SQLite FTS5
- Vector similarity search via sqlite-vec
- Hybrid retrieval pipeline with Reciprocal Rank Fusion (RRF)
- LLM reranking with Qwen3-Reranker-0.6B (node-llama-cpp / GGUF)
- LLM query expansion with Qwen3-1.7B fine-tuned model
- Embeddings via EmbeddingGemma-300M (384-dim)
- Collection management: `collection add/list/remove/rename`
- Context system: hierarchical path-prefix context inheritance
- Virtual URI scheme: `vault://collection/path`
- MCP server (stdio and HTTP transports) with `query` and `status` tools
- CLI: `straja-vault search`, `query`, `vsearch`, `embed`, `update`, `get`, `multi-get`, `ls`, `status`
- Smart chunking: 900 tokens/chunk with 15% overlap, markdown-heading-aware boundaries
- Daemon mode: `straja-vault mcp --http --daemon` with PID-file lifecycle management
- Config at `~/.config/straja-vault/index.yml`, index at `~/.cache/straja-vault/index.sqlite`
