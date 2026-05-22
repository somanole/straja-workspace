/**
 * Straja Vault MCP Server - Model Context Protocol server
 *
 * Exposes Straja Vault search and document retrieval as MCP tools and resources.
 * Documents are accessible via vault:// URIs.
 *
 * Follows MCP spec 2025-06-18 for proper response types.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "url";
import { dirname, resolve, join, relative, basename, isAbsolute } from "node:path";
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, stat, access, cp } from "node:fs/promises";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { resolveBackend } from "./exec-backend.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport }
  from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  createStore,
  extractSnippet,
  addLineNumbers,
  structuredSearch,
  chunkDocument,
  DEFAULT_MULTI_GET_MAX_BYTES,
  removeCollection,
  getStatus,
  hashContent,
  isEmbeddingExcludedCollection,
  isExternallyVisibleCollection,
  isHiddenCollection,
  isSystemCollection,
  isWriteProtectedCollection,
  isIndexPath,
  getBasePath,
  INDEX_SEPARATOR,
  cleanupOrphanedVectors,
  cleanupOrphanedContent,
  deleteInactiveDocuments,
  deleteLLMCache,
  vacuumDatabase,
  getHealthStats,
  getDefaultDbPath,
} from "./store.js";
import type { Store, StructuredSubSearch } from "./store.js";
import { appendAuditEntry, getAudit as getAuditGeneric, AUDIT_CATEGORIES, type AuditCategory } from "./audit.js";
import { ingestGuardActivation, type GuardActivationEvent } from "./guard-client.js";
import { startGuard, stopGuard, restartGuard, getGuardStatus, getGuardConfig, updateGuardConfig } from "./guard-manager.js";
import { getCollection, getGlobalContext, addCollection, renameCollection as renameYamlCollection, removeCollection as removeYamlCollection } from "./collections.js";
import {
  DEFAULT_ANSWER_MODEL_URI,
  DEFAULT_EMBED_MODEL_URI,
  DEFAULT_GENERATE_MODEL_URI,
  DEFAULT_MODEL_CACHE_DIR,
  DEFAULT_RERANK_MODEL_URI,
  disposeDefaultLlamaCpp,
  getDefaultLlamaCpp,
  withLLMSession,
} from "./llm.js";
import { applyOpenClawOptimizationSetting } from "./openclaw-orchestration-config.js";
import {
  applyOfficialUsagePricingDefaults,
  getOfficialUsagePricingModels,
  listConfiguredUsagePricingModels,
  readUsagePricingBenchmarkRef,
  upsertUsagePricingModelCost,
  type OpenClawUsagePricingCost,
} from "./openclaw-usage-pricing-config.js";
import {
  encodeBrowserUploadBlobEnvelope,
  decodeBrowserUploadBlobEnvelope,
  normalizeBrowserUploadStagePath,
} from "./browser-upload-staging.js";
import { materializeStoredWorkspaceDocument } from "./exec-workspace-files.js";
import {
  hasClientCredentials,
  generateAuthUrl,
  exchangeCode,
  syncGmail as runGmailSync,
  createDraft,
  updateDraft,
  type GmailConfig,
  type DraftRequest,
  type ImportedEmailSummary,
} from "./gmail.js";
import {
  hasDriveCredentials,
  generateDriveAuthUrl,
  exchangeDriveCode,
  syncDrive as runDriveSync,
  browseDrive,
  importDriveFiles,
  type DriveConfig,
} from "./gdrive.js";
import {
  hasCalendarCredentials,
  generateCalendarAuthUrl,
  exchangeCalendarCode,
  syncCalendar as runCalendarSync,
  listCalendars,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type CalendarConfig,
  type EventRequest,
  type ImportedEventSummary,
} from "./gcalendar.js";
import {
  hasContactsCredentials,
  generateContactsAuthUrl,
  exchangeContactsCode,
  syncContacts as runContactsSync,
  type ContactsConfig,
} from "./gcontacts.js";
import {
  hasClientCredentials as hasGitHubClientCredentials,
  generateAuthUrl as generateGitHubAuthUrl,
  exchangeCode as exchangeGitHubCode,
  syncGitHubRepos as runGitHubSync,
  listUserRepos as listGitHubUserRepos,
  createIssue as createGitHubIssue,
  listIssues as listGitHubIssues,
  createBranch as createGitHubBranch,
  createPullRequest as createGitHubPR,
  listPullRequests as listGitHubPRs,
  pushWorkspaceChanges as pushGitHubChanges,
  isGitHubAuthError,
  clearGitHubAuthError,
  markGitHubAuthError,
  type GitHubConfig,
} from "./github.js";
import {
  parseGitHubOAuthClientConfig,
  setGitHubOAuthClientConfig,
} from "./github-oauth-config.js";
import {
  ALL_KNOWN_TOOLS,
  CHIEF_OF_STAFF_DENYLIST,
  USER_FACING_TOOL_GROUPS,
} from "./tool-catalog.js";
import {
  createOpenAICodexOAuthSession,
  exchangeOpenAICodexAuthorizationCode,
  OPENAI_CODEX_CALLBACK_ORIGIN,
  OPENAI_CODEX_REDIRECT_URI,
  type OpenAICodexOAuthSession,
} from "./openai-codex-oauth.js";
import {
  startBrowserService,
  stopBrowserService,
  setConfig as setBrowserConfig,
  getStatus as getBrowserStatus,
  isRunning as isBrowserRunning,
  callTool as callBrowserTool,
  listTools as listBrowserTools,
  type BrowserConfig,
} from "./browser.js";
import {
  BrowserSecurityController,
  EXPOSED_PLAYWRIGHT_BROWSER_TOOL_SET,
  type BrowserToolCallResult,
} from "./browser-security.js";
import type { BrowserPolicy } from "./browser-policy.js";
import { PresentationSpecSchema, buildPptxBuffer } from "./presentations.js";
import { agentGatewayRpc } from "./agent-gateway-client.js";
import { buildReportPdfBuffer, ReportSpecSchema } from "./reports.js";
import {
  normalizeMimeType,
  resolvePresentationImages,
  resolveReportImages,
} from "./presentation-image-resolver.js";
import {
  WebSearchController,
  WebSearchValidationError,
  WebSearchBlockedError,
} from "./web-search.js";
import {
  WebFetchController,
  WebFetchValidationError,
  WebFetchSsrfBlockedError,
  WebFetchBlockedError,
} from "./web-fetch.js";
import {
  encryptDatabaseAtRest,
} from "./db.js";
import {
  destroyVaultEncryption,
  getVaultEncryptionStatus,
  initializeVaultEncryption,
  isVaultLocked,
  resolveVaultDatabaseEncryption,
  lockVaultEncryption,
  unlockVaultEncryption,
} from "./vault-secrets.js";
import { seedWorkspaceDefaults } from "./workspace-defaults.js";
import {
  parseGoogleOAuthClientConfig,
  setGoogleOAuthClientConfig,
} from "./google-oauth-config.js";
import {
  isRetryableScheduleReconcileError,
  reconcileScheduledEntries,
  upsertScheduledCronJob,
} from "./scheduled-cron-sync.js";
import {
  buildEvalCaseDraftFromTrace,
  createEvalCase,
  createEvalRun,
  createEvalSuite,
  deleteEvalCase,
  duplicateBuiltinSuite,
  evaluateTraceAssertions,
  finalizeEvalRun,
  findTraceBySessionKey,
  getEvalSuiteDetail,
  listEvalCaseResults,
  listEvalSuites,
  persistEvalCaseResult,
  readCase,
  readEvalRun,
  readOrchestrationTrace,
  readSuite,
  updateEvalCase,
  type EvalAssertion,
  type EvalCase,
  type EvalCaseResult,
  type EvalCaseStatus,
  type EvalExecutionPayload,
  type EvalMode,
  type EvalRun,
  type EvalSuite,
} from "./evals.js";

// =============================================================================
// Types for structured content
// =============================================================================

type SearchResultItem = {
  docid: string;  // Short docid (#abc123) for quick reference
  file: string;
  title: string;
  score: number;
  context: string | null;
  snippet: string;
};

type StatusResult = {
  totalDocuments: number;
  needsEmbedding: number;
  hasVectorIndex: boolean;
  collections: {
    name: string;
    path: string;
    pattern: string;
    documents: number;
    lastUpdated: string;
  }[];
};

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Encode a path for use in vault:// URIs.
 * Encodes special characters but preserves forward slashes for readability.
 */
function encodeQmdPath(path: string): string {
  // Encode each path segment separately to preserve slashes
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Format search results as human-readable text summary
 */
function formatSearchSummary(results: SearchResultItem[], query: string): string {
  if (results.length === 0) {
    return `No results found for "${query}"`;
  }
  const lines = [`Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}":\n`];
  for (const r of results) {
    lines.push(`${r.docid} ${Math.round(r.score * 100)}% ${r.file} - ${r.title}`);
  }
  return lines.join('\n');
}

function resolveWebUiRedirectLocation(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredOrigin = process.env.STRAJA_UI_ORIGIN?.trim();
  if (!configuredOrigin) return normalizedPath;
  try {
    const base = configuredOrigin.endsWith("/") ? configuredOrigin : `${configuredOrigin}/`;
    return new URL(normalizedPath, base).toString();
  } catch {
    return normalizedPath;
  }
}

// =============================================================================
// MCP Server
// =============================================================================

/**
 * Build dynamic server instructions from actual index state.
 * Injected into the LLM's system prompt via MCP initialize response —
 * gives the LLM immediate context about what's searchable without a tool call.
 */
function buildInstructions(store: Store): string {
  const status = store.getStatus();
  const lines: string[] = [];

  // --- What is this? ---
  const globalCtx = getGlobalContext();
  lines.push(`Straja Vault is your local secure search engine over ${status.totalDocuments} markdown documents.`);
  if (globalCtx) lines.push(`Context: ${globalCtx}`);

  // --- What's searchable? ---
  if (status.collections.length > 0) {
    lines.push("");
    lines.push("Collections (scope with `collection` parameter):");
    for (const col of status.collections) {
      const collConfig = getCollection(col.name);
      const rootCtx = collConfig?.context?.[""] || collConfig?.context?.["/"];
      const desc = rootCtx ? ` — ${rootCtx}` : "";
      lines.push(`  - "${col.name}" (${col.documents} docs)${desc}`);
    }
  }

  // --- Capability gaps ---
  if (!status.hasVectorIndex) {
    lines.push("");
    lines.push("Note: No vector embeddings yet. Run `straja-vault embed` to enable semantic search (vec/hyde).");
  } else if (status.needsEmbedding > 0) {
    lines.push("");
    lines.push(`Note: ${status.needsEmbedding} documents need embedding. Run \`straja-vault embed\` to update.`);
  }

  // --- Search tool ---
  lines.push("");
  lines.push("Search: Use `query` with sub-queries (lex/vec/hyde/expand):");
  lines.push("  - type:'lex' — BM25 keyword search (exact terms, fast)");
  lines.push("  - type:'vec' — semantic vector search (meaning-based)");
  lines.push("  - type:'hyde' — hypothetical document (write what the answer looks like)");
  lines.push("");
  lines.push("Examples:");
  lines.push("  Quick keyword lookup: [{type:'lex', query:'error handling'}]");
  lines.push("  Semantic search: [{type:'vec', query:'how to handle errors gracefully'}]");
  lines.push("  Best results: [{type:'lex', query:'error'}, {type:'vec', query:'error handling best practices'}]");

  // --- Retrieval workflow ---
  lines.push("");
  lines.push("Retrieval:");
  lines.push("  - `get` — single document by path or docid (#abc123). Supports line offset (`file.md:100`).");
  lines.push("  - `multi_get` — batch retrieve by glob (`journals/2025-05*.md`) or comma-separated list.");

  // --- Non-obvious things that prevent mistakes ---
  lines.push("");
  lines.push("Tips:");
  lines.push("  - ALWAYS search the vault before saying you don't have information. User knowledge, preferences, and context may be stored in notes, documents, or any collection — not just memory.");
  lines.push("  - File paths in results are relative to their collection.");
  lines.push("  - Use `minScore: 0.5` to filter low-confidence results.");
  lines.push("  - Results include a `context` field describing the content type.");

  return lines.join("\n");
}

/**
 * Create an MCP server with all Straja Vault tools, resources, and prompts registered.
 * Shared by both stdio and HTTP transports.
 */
function normalizeDomainApproval(value: unknown): "once" | "always" | "remove" | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase().trim();
  if (v === "once" || v === "allow-once" || v === "approve-once") return "once";
  if (v === "always" || v === "allow-always" || v === "approve-always") return "always";
  if (v === "remove" || v === "revoke" || v === "delete") return "remove";
  return undefined;
}

function createMcpServer(store: Store): McpServer {
  const browserSecurity = new BrowserSecurityController(store, callBrowserTool, listBrowserTools);
  const webSearch = new WebSearchController(store);
  const webFetch = new WebFetchController(store);
  const server = new McpServer(
    { name: "straja-vault", version: "0.1.0" },
    { instructions: buildInstructions(store) },
  );

  // ---------------------------------------------------------------------------
  // Resource: vault://{path} - read-only access to documents by path
  // Note: No list() - documents are discovered via search tools
  // ---------------------------------------------------------------------------

  server.registerResource(
    "document",
    new ResourceTemplate("vault://{+path}", { list: undefined }),
    {
      title: "Vault Document",
      description: "A document from your Straja Vault knowledge base. Use search tools to discover documents.",
      mimeType: "text/markdown",
    },
    async (uri, { path }) => {
      // Decode URL-encoded path (MCP clients send encoded URIs)
      const pathStr = Array.isArray(path) ? path.join('/') : (path || '');
      const decodedPath = decodeURIComponent(pathStr);

      const result = store.findDocument(`vault://${decodedPath}`, { includeBody: true });
      if ("error" in result) {
        return { contents: [{ uri: uri.href, text: `Document not found: ${decodedPath}` }] };
      }

      const body = result.body ?? store.getDocumentBody(result) ?? "";
      let text = addLineNumbers(body);
      if (result.context) {
        text = `<!-- Context: ${result.context} -->\n\n` + text;
      }

      return {
        contents: [{
          uri: uri.href,
          name: result.displayPath,
          title: result.title,
          mimeType: "text/markdown",
          text,
        }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: query (Primary search tool)
  // ---------------------------------------------------------------------------

  const subSearchSchema = z.object({
    type: z.enum(['lex', 'vec', 'hyde', 'expand']).describe(
      "lex = BM25 keywords (supports \"phrase\" and -negation), " +
      "vec = semantic question, hyde = hypothetical answer passage, " +
      "expand = auto-expand via LLM (max 1 per query)"
    ),
    query: z.string().describe(
      "The query text. For lex: use keywords, \"quoted phrases\", and -negation. " +
      "For vec: natural language question. For hyde: 50-100 word answer passage."
    ),
  });

  server.registerTool(
    "query",
    {
      title: "Query",
      description: `Search the knowledge base using a query document — one or more typed sub-queries combined for best recall.

## Query Types

**lex** — BM25 keyword search. Fast, exact, no LLM needed.
Full lex syntax:
- \`term\` — prefix match ("perf" matches "performance")
- \`"exact phrase"\` — phrase must appear verbatim
- \`-term\` or \`-"phrase"\` — exclude documents containing this

Good lex examples:
- \`"connection pool" timeout -redis\`
- \`"machine learning" -sports -athlete\`
- \`handleError async typescript\`

**vec** — Semantic vector search. Write a natural language question. Finds documents by meaning, not exact words.
- \`how does the rate limiter handle burst traffic?\`
- \`what is the tradeoff between consistency and availability?\`

**hyde** — Hypothetical document. Write 50-100 words that look like the answer. Often the most powerful for nuanced topics.
- \`The rate limiter uses a token bucket algorithm. When a client exceeds 100 req/min, subsequent requests return 429 until the window resets.\`

**expand** — Auto-expand via local LLM. Generates lex+vec+hyde variations automatically. Max one per query. Useful when you don't know the exact terms.

## Strategy

Combine types for best results. First sub-query gets 2× weight — put your strongest signal first.

| Goal | Approach |
|------|----------|
| Know exact term/name | \`lex\` only |
| Concept search | \`vec\` only |
| Best recall | \`lex\` + \`vec\` |
| Complex/nuanced | \`lex\` + \`vec\` + \`hyde\` |
| Unknown vocabulary | \`expand\` |

## Examples

Simple lookup:
\`\`\`json
[{ "type": "lex", "query": "CAP theorem" }]
\`\`\`

Best recall on a technical topic:
\`\`\`json
[
  { "type": "lex", "query": "\\"connection pool\\" timeout -redis" },
  { "type": "vec", "query": "why do database connections time out under load" },
  { "type": "hyde", "query": "Connection pool exhaustion occurs when all connections are in use and new requests must wait. This typically happens under high concurrency when queries run longer than expected." }
]
\`\`\`

Intent-aware lex (C++ performance, not sports):
\`\`\`json
[
  { "type": "lex", "query": "\\"C++ performance\\" optimization -sports -athlete" },
  { "type": "vec", "query": "how to optimize C++ program performance" }
]
\`\`\``,
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        searches: z.array(subSearchSchema).min(1).max(10).describe(
          "Sub-queries to execute. First gets 2x weight. Max one expand: per query."
        ),
        limit: z.number().optional().default(10).describe("Max results (default: 10)"),
        minScore: z.number().optional().default(0).describe("Min relevance 0-1 (default: 0)"),
        collections: z.array(z.string()).optional().describe("Filter to collections (OR match)"),
      },
    },
    async ({ searches, limit, minScore, collections }) => {
      // Map to internal format
      const subSearches: StructuredSubSearch[] = searches.map(s => ({
        type: s.type,
        query: s.query,
      }));

      // Use specified collections or search all; always exclude hidden/secret collections.
      const effectiveCollections = collections
        ? collections.filter(isExternallyVisibleCollection)
        : undefined;

      const results = await structuredSearch(store, subSearches, {
        collections: effectiveCollections,
        limit,
        minScore,
      });

      // Use first lex or vec query for snippet extraction
      const primaryQuery = searches.find(s => s.type === 'lex')?.query
        || searches.find(s => s.type === 'vec')?.query
        || searches[0]?.query || "";

      const filtered: SearchResultItem[] = results.map(r => {
        const { line, snippet } = extractSnippet(r.bestChunk, primaryQuery, 300);
        return {
          docid: `#${r.docid}`,
          file: r.displayPath,
          title: r.title,
          score: Math.round(r.score * 100) / 100,
          context: r.context,
          snippet: addLineNumbers(snippet, line),
        };
      });

      return {
        content: [{ type: "text", text: formatSearchSummary(filtered, primaryQuery) }],
        structuredContent: { results: filtered },
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: vault_get (Retrieve document)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get",
    {
      title: "Get Document",
      description: "Retrieve the full content of a document by its file path or docid. Use paths or docids (#abc123) from search results. Suggests similar files if not found.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        file: z.string().describe("File path or docid from search results (e.g., 'pages/meeting.md', '#abc123', or 'pages/meeting.md:100' to start at line 100)"),
        fromLine: z.number().optional().describe("Start from this line number (1-indexed)"),
        maxLines: z.number().optional().describe("Maximum number of lines to return"),
        lineNumbers: z.boolean().optional().default(false).describe("Add line numbers to output (format: 'N: content')"),
      },
    },
    async ({ file, fromLine, maxLines, lineNumbers }) => {
      // Support :line suffix in `file` (e.g. "foo.md:120") when fromLine isn't provided
      let parsedFromLine = fromLine;
      let lookup = file;
      const colonMatch = lookup.match(/:(\d+)$/);
      if (colonMatch && colonMatch[1] && parsedFromLine === undefined) {
        parsedFromLine = parseInt(colonMatch[1], 10);
        lookup = lookup.slice(0, -colonMatch[0].length);
      }

      const result = store.findDocument(lookup, { includeBody: false });

      if ("error" in result) {
        let msg = `Document not found: ${file}`;
        if (result.similarFiles.length > 0) {
          msg += `\n\nDid you mean one of these?\n${result.similarFiles.map(s => `  - ${s}`).join('\n')}`;
        }
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }

      const body = store.getDocumentBody(result, parsedFromLine, maxLines) ?? "";
      let text = body;
      if (lineNumbers) {
        const startLine = parsedFromLine || 1;
        text = addLineNumbers(text, startLine);
      }
      if (result.context) {
        text = `<!-- Context: ${result.context} -->\n\n` + text;
      }

      return {
        content: [{
          type: "resource",
          resource: {
            uri: `vault://${encodeQmdPath(result.displayPath)}`,
            name: result.displayPath,
            title: result.title,
            mimeType: "text/markdown",
            text,
          },
        }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: vault_multi_get (Retrieve multiple documents)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "multi_get",
    {
      title: "Multi-Get Documents",
      description: "Retrieve multiple documents by glob pattern (e.g., 'journals/2025-05*.md') or comma-separated list. Skips files larger than maxBytes.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        pattern: z.string().describe("Glob pattern or comma-separated list of file paths"),
        maxLines: z.number().optional().describe("Maximum lines per file"),
        maxBytes: z.number().optional().default(10240).describe("Skip files larger than this (default: 10240 = 10KB)"),
        lineNumbers: z.boolean().optional().default(false).describe("Add line numbers to output (format: 'N: content')"),
      },
    },
    async ({ pattern, maxLines, maxBytes, lineNumbers }) => {
      const { docs, errors } = store.findDocuments(pattern, { includeBody: true, maxBytes: maxBytes || DEFAULT_MULTI_GET_MAX_BYTES });

      if (docs.length === 0 && errors.length === 0) {
        return {
          content: [{ type: "text", text: `No files matched pattern: ${pattern}` }],
          isError: true,
        };
      }

      const content: ({ type: "text"; text: string } | { type: "resource"; resource: { uri: string; name: string; title?: string; mimeType: string; text: string } })[] = [];

      if (errors.length > 0) {
        content.push({ type: "text", text: `Errors:\n${errors.join('\n')}` });
      }

      for (const result of docs) {
        if (result.skipped) {
          content.push({
            type: "text",
            text: `[SKIPPED: ${result.doc.displayPath} - ${result.skipReason}. Use 'vault_get' with file="${result.doc.displayPath}" to retrieve.]`,
          });
          continue;
        }

        let text = result.doc.body || "";
        if (maxLines !== undefined) {
          const lines = text.split("\n");
          text = lines.slice(0, maxLines).join("\n");
          if (lines.length > maxLines) {
            text += `\n\n[... truncated ${lines.length - maxLines} more lines]`;
          }
        }
        if (lineNumbers) {
          text = addLineNumbers(text);
        }
        if (result.doc.context) {
          text = `<!-- Context: ${result.doc.context} -->\n\n` + text;
        }

        content.push({
          type: "resource",
          resource: {
            uri: `vault://${encodeQmdPath(result.doc.displayPath)}`,
            name: result.doc.displayPath,
            title: result.doc.title,
            mimeType: "text/markdown",
            text,
          },
        });
      }

      return { content };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: vault_status (Index status)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "status",
    {
      title: "Index Status",
      description: "Show the status of the Straja Vault index: collections, document counts, and health information.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const status: StatusResult = store.getStatus();

      const summary = [
        `Straja Vault Index Status:`,
        `  Total documents: ${status.totalDocuments}`,
        `  Needs embedding: ${status.needsEmbedding}`,
        `  Vector index: ${status.hasVectorIndex ? 'yes' : 'no'}`,
        `  Collections: ${status.collections.length}`,
      ];

      for (const col of status.collections) {
        summary.push(`    - ${col.path} (${col.documents} docs)`);
      }

      return {
        content: [{ type: "text", text: summary.join('\n') }],
        structuredContent: status,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: memory_write (Write to persistent memory)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "memory_write",
    {
      title: "Write Memory",
      description: `Write or append to the persistent memory store (_memory collection). Memory is auto-embedded for semantic search.

Use this to remember facts, preferences, decisions, or any knowledge that should persist across conversations.

Examples:
- path: "notes/project-x.md", content: "# Project X\\nKey decision: use PostgreSQL"
- path: "preferences.md", content: "Prefers concise answers", append: true`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        path: z.string().describe("File path within _memory (e.g., 'notes/2025-02-23.md', 'preferences.md')"),
        content: z.string().describe("The content to write or append"),
        append: z.boolean().optional().default(false).describe("If true, append to existing file instead of replacing"),
      },
    },
    async ({ path, content, append }) => {
      const collName = "_memory";
      const now = new Date().toISOString();

      if (append) {
        // Append mode: read existing content, concatenate, write back
        const existing = store.getDocumentWithContent(collName, path);
        const existingContent = existing?.content ?? "";
        const updated = existingContent
          ? existingContent + (existingContent.endsWith("\n") ? "" : "\n") + content + "\n"
          : content + "\n";

        const hash = await hashContent(updated);
        store.insertContent(hash, updated, now);

        if (existing) {
          store.updateDocument(existing.id, existing.title, hash, now);
        } else {
          store.insertDocument(collName, path, path, hash, now, now);
        }
      } else {
        // Write/replace mode
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);

        const existing = store.findActiveDocument(collName, path);
        if (existing) {
          store.updateDocument(existing.id, existing.title, hash, now);
        } else {
          store.insertDocument(collName, path, path, hash, now, now);
        }
      }

      // Auto-embed (debounced — one subprocess after writes settle)
      scheduleAutoEmbed(store.dbPath, { trigger: "memory-write" });

      // Audit: memory write
      appendAuditEntry(store, "memory", {
        timestamp: now,
        toolName: "memory_write",
        action: append ? "append" : "write",
        path,
        verdict: "allowed",
        reason: `${append ? "Appended to" : "Wrote"} _memory/${path}`,
        contentLength: content.length,
        severity: "low",
      }).catch(() => {});

      return {
        content: [{ type: "text", text: `${append ? "Appended to" : "Wrote"} _memory/${path}` }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Agent collection tools — create, write, list
  // ---------------------------------------------------------------------------

  const AGENT_META_PATH = "_meta.json";

  function sanitizeCollectionName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100);
  }

  function isAgentCollection(collName: string): boolean {
    const doc = store.getDocumentWithContent(collName, AGENT_META_PATH);
    if (!doc?.content) return false;
    try {
      const meta = JSON.parse(doc.content);
      return meta?.source === "agent";
    } catch {
      return false;
    }
  }

  server.registerTool(
    "vault_agent_collection_create",
    {
      title: "Create Agent Collection",
      description: `Create a new agent-managed collection in the vault. Use this to organise content by topic, person, or project.

The collection is stored in the vault database (no filesystem path needed). Both you and the user can add notes and files to it later.

Examples:
- name: "John Doe", description: "Piano student, beginner level"
- name: "Project Alpha", description: "Research notes for Project Alpha"`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().min(1).max(100).describe("Human-readable name (e.g., 'John Doe', 'Project Alpha'). Will be sanitized to a URL-safe slug."),
        description: z.string().optional().describe("Short description of the collection's purpose"),
      },
    },
    async ({ name, description }) => {
      const collName = sanitizeCollectionName(name);
      if (!collName) {
        return { content: [{ type: "text", text: "Error: name is empty after sanitization." }], isError: true };
      }
      if (collName.startsWith("_")) {
        return { content: [{ type: "text", text: `Error: collection name cannot start with underscore (reserved for system).` }], isError: true };
      }
      if (getCollection(collName)) {
        return { content: [{ type: "text", text: `Error: a user collection named "${collName}" already exists.` }], isError: true };
      }
      const existingMeta = store.findActiveDocument(collName, AGENT_META_PATH);
      if (existingMeta) {
        return { content: [{ type: "text", text: `Error: agent collection "${collName}" already exists.` }], isError: true };
      }

      const now = new Date().toISOString();
      const meta = JSON.stringify({ source: "agent", name, description: description ?? "", createdAt: now });
      const hash = await hashContent(meta);
      store.insertContent(hash, meta, now);
      store.insertDocument(collName, AGENT_META_PATH, name, hash, now, now);

      // Auto-embed (debounced — one subprocess after writes settle)
      scheduleAutoEmbed(store.dbPath, { trigger: "agent-collection-create" });

      appendAuditEntry(store, "collections", {
        timestamp: now,
        toolName: "vault_agent_collection_create",
        action: "create",
        path: collName,
        verdict: "allowed",
        reason: `Created agent collection "${collName}"`,
        severity: "low",
      }).catch(() => {});

      return {
        content: [{ type: "text", text: `Created agent collection "${collName}"${description ? ` — ${description}` : ""}` }],
      };
    }
  );

  server.registerTool(
    "vault_agent_collection_write",
    {
      title: "Write to Agent Collection",
      description: `Write or append content to an agent-managed collection. Only works on collections created with vault_agent_collection_create.

Use this to add notes, session logs, or any text content to a collection.

Examples:
- collection: "john-doe", path: "sessions/2025-03-10.md", content: "# Session Notes\\nWorked on scales today."
- collection: "john-doe", path: "progress.md", content: "Completed Module 3", append: true`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        collection: z.string().describe("Agent collection name (as returned by vault_agent_collection_create or vault_agent_collection_list)"),
        path: z.string().describe("Document path within the collection (e.g., 'sessions/2025-03-10.md', 'notes.md')"),
        content: z.string().describe("The content to write or append"),
        title: z.string().optional().describe("Document title (defaults to path)"),
        append: z.boolean().optional().default(false).describe("If true, append to existing document instead of replacing"),
      },
    },
    async ({ collection, path: docPath, content, title, append }) => {
      const collName = sanitizeCollectionName(collection);
      if (!collName) {
        return { content: [{ type: "text", text: "Error: invalid collection name." }], isError: true };
      }
      if (docPath === AGENT_META_PATH) {
        return { content: [{ type: "text", text: "Error: cannot write to reserved path _meta.json." }], isError: true };
      }
      if (!isAgentCollection(collName)) {
        return { content: [{ type: "text", text: `Error: "${collName}" is not an agent collection. Create it first with vault_agent_collection_create.` }], isError: true };
      }

      const docTitle = title?.trim() || docPath;
      const now = new Date().toISOString();

      if (append) {
        const existing = store.getDocumentWithContent(collName, docPath);
        const existingContent = existing?.content ?? "";
        const updated = existingContent
          ? existingContent + (existingContent.endsWith("\n") ? "" : "\n") + content + "\n"
          : content + "\n";

        const hash = await hashContent(updated);
        store.insertContent(hash, updated, now);

        if (existing) {
          store.updateDocument(existing.id, docTitle, hash, now);
        } else {
          store.insertDocument(collName, docPath, docTitle, hash, now, now);
        }
      } else {
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);

        const existing = store.findActiveDocument(collName, docPath);
        if (existing) {
          store.updateDocument(existing.id, docTitle, hash, now);
        } else {
          store.insertDocument(collName, docPath, docTitle, hash, now, now);
        }
      }

      // Auto-embed (debounced — one subprocess after writes settle)
      scheduleAutoEmbed(store.dbPath, { trigger: "agent-collection-write" });

      appendAuditEntry(store, "collections", {
        timestamp: now,
        toolName: "vault_agent_collection_write",
        action: append ? "append" : "write",
        path: `${collName}/${docPath}`,
        verdict: "allowed",
        reason: `${append ? "Appended to" : "Wrote"} ${collName}/${docPath}`,
        contentLength: content.length,
        severity: "low",
      }).catch(() => {});

      return {
        content: [{ type: "text", text: `${append ? "Appended to" : "Wrote"} ${collName}/${docPath}` }],
      };
    }
  );

  server.registerTool(
    "vault_collection_write",
    {
      title: "Write to Vault Collection",
      description: `Write or append content to any writable Vault collection path.

Use this for normal user collections like elevi, crm, or project registries.
For spreadsheet-backed files, prefer vault_spreadsheet_update instead.

Examples:
- collection: "elevi", path: "Iuliana Manole/2026-03-23-mesaj-parinte.md", content: "# Mesaj părinte\\n..."
- collection: "crm", path: "leads/2026-03-23.md", content: "New lead", append: true`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        collection: z.string().describe("Writable collection name (for example 'elevi' or 'crm')"),
        path: z.string().describe("Document path within the collection"),
        content: z.string().describe("The content to write or append"),
        title: z.string().optional().describe("Document title (defaults to path)"),
        append: z.boolean().optional().default(false).describe("If true, append to existing document instead of replacing"),
      },
    },
    async ({ collection, path: docPath, content, title, append }) => {
      const collName = String(collection ?? "").trim();
      if (!collName) {
        return { content: [{ type: "text", text: "Error: collection is required." }], isError: true };
      }
      if (!docPath?.trim()) {
        return { content: [{ type: "text", text: "Error: path is required." }], isError: true };
      }
      if (!content) {
        return { content: [{ type: "text", text: "Error: content is required." }], isError: true };
      }
      if (isWriteProtectedCollection(collName)) {
        return { content: [{ type: "text", text: `Error: writes are not allowed to collection "${collName}".` }], isError: true };
      }

      const docTitle = title?.trim() || docPath;
      const now = new Date().toISOString();

      if (append) {
        const existing = store.getDocumentWithContent(collName, docPath);
        const existingContent = existing?.content ?? "";
        const updated = existingContent
          ? existingContent + (existingContent.endsWith("\n") ? "" : "\n") + content + "\n"
          : content + "\n";

        const hash = await hashContent(updated);
        store.insertContent(hash, updated, now);

        if (existing) {
          store.updateDocument(existing.id, docTitle, hash, now);
        } else {
          store.insertDocument(collName, docPath, docTitle, hash, now, now);
        }
      } else {
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);

        const existing = store.findActiveDocument(collName, docPath);
        if (existing) {
          store.updateDocument(existing.id, docTitle, hash, now);
        } else {
          store.insertDocument(collName, docPath, docTitle, hash, now, now);
        }
      }

      scheduleAutoEmbed(store.dbPath, { trigger: "collection-write" });

      appendAuditEntry(store, "collections", {
        timestamp: now,
        toolName: "vault_collection_write",
        action: append ? "append" : "write",
        path: `${collName}/${docPath}`,
        verdict: "allowed",
        reason: `${append ? "Appended to" : "Wrote"} ${collName}/${docPath}`,
        contentLength: content.length,
        severity: "low",
      }).catch(() => {});

      return {
        content: [{ type: "text", text: `${append ? "Appended to" : "Wrote"} ${collName}/${docPath}` }],
      };
    }
  );

  server.registerTool(
    "vault_agent_collection_list",
    {
      title: "List Agent Collections",
      description: "List all agent-managed collections with their document counts and descriptions.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      // Find all _meta.json docs across all collections
      const metaDocs = store.db
        .prepare(
          `SELECT d.collection, c.doc as content
           FROM documents d
           JOIN content c ON c.hash = d.hash
           WHERE d.path = ? AND d.active = 1`
        )
        .all(AGENT_META_PATH) as Array<{ collection: string; content: string }>;

      const collections: Array<{
        name: string;
        description: string;
        documents: number;
        createdAt: string;
      }> = [];

      for (const row of metaDocs) {
        try {
          const meta = JSON.parse(row.content);
          if (meta?.source !== "agent") continue;

          const countRow = store.db
            .prepare(
              `SELECT COUNT(*) as cnt FROM documents WHERE collection = ? AND path != ? AND active = 1`
            )
            .get(row.collection, AGENT_META_PATH) as { cnt: number } | undefined;

          collections.push({
            name: row.collection,
            description: meta.description ?? "",
            documents: countRow?.cnt ?? 0,
            createdAt: meta.createdAt ?? "",
          });
        } catch {
          // skip malformed _meta.json
        }
      }

      if (collections.length === 0) {
        return {
          content: [{ type: "text", text: "No agent collections found. Create one with vault_agent_collection_create." }],
        };
      }

      const lines = collections.map(
        (c) => `- "${c.name}" (${c.documents} docs)${c.description ? ` — ${c.description}` : ""}`
      );

      return {
        content: [{ type: "text", text: `Agent collections:\n${lines.join("\n")}` }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Notes tool — create notes in the _notes collection
  // ---------------------------------------------------------------------------

  server.registerTool(
    "vault_note_create",
    {
      title: "Create Note",
      description: `Create a note in the vault's _notes collection. Use this whenever the user asks to create, save, or jot down a note.

The note is stored as a markdown file in the _notes collection and is automatically embedded for semantic search.

Examples:
- title: "Meeting with John", content: "Discussed project timeline..."
- title: "Shopping list", content: "- Milk\\n- Eggs\\n- Bread"`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        title: z.string().min(1).describe("Note title"),
        content: z.string().min(1).describe("Note content (markdown supported)"),
      },
    },
    async ({ title, content }) => {
      await ensureNotesCollection(store);
      const ts_stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const path = `${slugify(title)}-${ts_stamp}.md`;
      const { size } = await writeNote(store, path, content, title);

      // Auto-embed (debounced — one subprocess after writes settle)
      scheduleAutoEmbed(store.dbPath, { trigger: "note-create-tool" });

      return {
        content: [{ type: "text", text: `Created note "${title}" (${path}, ${size} bytes) in _notes collection.` }],
      };
    }
  );

  server.registerTool(
    "vault_note_update",
    {
      title: "Update Note",
      description: `Update an existing note in the vault's _notes collection. Use this when the user asks to edit, update, or modify a note they already have.

You must provide the exact path of the note (e.g. "shopping-list-20260311143022.md") which you can find by searching the vault.

Examples:
- path: "shopping-list-20260311143022.md", title: "Shopping list", content: "- Milk\\n- Eggs\\n- Bread\\n- Butter"`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        path: z.string().min(1).describe("The note's file path in the _notes collection (e.g. 'shopping-list-20260311143022.md')"),
        title: z.string().min(1).describe("Updated note title"),
        content: z.string().min(1).describe("Updated note content (markdown supported)"),
      },
    },
    async ({ path, title, content }) => {
      const existing = store.findActiveDocument(NOTES_COLLECTION, path);
      if (!existing) {
        return {
          content: [{ type: "text", text: `Error: note not found at path "${path}" in _notes collection.` }],
          isError: true,
        };
      }
      const { size } = await writeNote(store, path, content, title);

      // Auto-embed (debounced — one subprocess after writes settle)
      scheduleAutoEmbed(store.dbPath, { trigger: "note-update-tool" });

      return {
        content: [{ type: "text", text: `Updated note "${title}" (${path}, ${size} bytes) in _notes collection.` }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Artifact tools — write, build presentations, get download URLs
  // ---------------------------------------------------------------------------

  server.registerTool(
    "vault_artifact_write",
    {
      title: "Write Artifact",
      description: `Write content to the editable artifacts collection. Supports text files (JSON, markdown) and binary files (via base64 encoding).

Use this to store presentation specs, generated files, or other agent-produced artifacts. When storing images for presentations, use base64 encoding plus the correct mimeType, then reference that vault path from the presentation spec.

Path conventions:
- presentations/<name>/spec.json for presentation specs
- reports/<name>/spec.json for report specs

Examples:
- path: "presentations/q1-report/spec.json", content: '{"title":"Q1 Report",...}', encoding: "utf8"
- path: "reports/board-memo/spec.json", content: '{"title":"Board Memo",...}', encoding: "utf8"
- path: "data/chart.png", content: "<base64>", encoding: "base64", mimeType: "image/png"`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        path: z.string().describe("Relative path within editable collection (e.g., 'presentations/q1-report/spec.json')"),
        content: z.string().describe("Content to write (text or base64-encoded binary)"),
        encoding: z.enum(["utf8", "base64"]).optional().default("utf8")
          .describe("Content encoding: 'utf8' for text files, 'base64' for binary files"),
        mimeType: z.string().optional().describe("MIME type for binary content (e.g., 'image/png')"),
      },
    },
    async ({ path: filePath, content, encoding, mimeType }) => {
      try {
        const safePath = normalizeEditableArtifactPath(filePath);
        let writeContent: string | Buffer;
        if (encoding === "base64") {
          writeContent = Buffer.from(content, "base64");
        } else {
          writeContent = content;
        }
        const { size } = await writeArtifact(store, safePath, writeContent, {
          mimeType: mimeType || undefined,
          originalName: safePath.split("/").pop(),
        });
        return {
          content: [{ type: "text", text: `Wrote ${EDITABLE_COLLECTION}/${safePath} (${size} bytes)` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error writing artifact: ${err?.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "vault_presentation_build",
    {
      title: "Build Presentation",
      description: `Generate a PPTX file from a presentation spec stored in the editable collection.

The spec must exist at editable/presentations/<name>/spec.json. The generated PPTX will be stored at editable/presentations/<name>/build/<name>.pptx.

Spec format: { title, subtitle?, author?, theme?: { primaryColor?, secondaryColor?, fontFace?, fontSize? }, slides: [{ type: "title"|"bullets"|"two_col"|"image"|"table", title?, subtitle?, bullets?, left?, right?, image?, table?, notes? }] }

For image slides, prefer existing vault images first. If none exist, fetch or generate an image, store it as an artifact, and reference that saved vault path. Do not create image slides without a resolvable image.data value; the build will fail if an image cannot be embedded into the PPTX.

Example:
  name: "quarterly-review"
  → reads editable/presentations/quarterly-review/spec.json
  → writes editable/presentations/quarterly-review/build/quarterly-review.pptx`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().describe("Presentation folder name under presentations/ (e.g., 'quarterly-review')"),
      },
    },
    async ({ name }) => {
      try {
        const specPath = `presentations/${name}/spec.json`;
        const specDoc = getEditableArtifactDocument(store, specPath);
        if (!specDoc) {
          return {
            content: [{ type: "text", text: `Spec not found: ${EDITABLE_COLLECTION}/${specPath}` }],
            isError: true,
          };
        }

        let specData: unknown;
        try {
          specData = JSON.parse(specDoc.doc.content);
        } catch {
          return {
            content: [{ type: "text", text: `Invalid JSON in spec: ${specPath}` }],
            isError: true,
          };
        }

        const parseResult = PresentationSpecSchema.safeParse(specData);
        if (!parseResult.success) {
          const issues = parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
          return {
            content: [{ type: "text", text: `Invalid presentation spec: ${issues}` }],
            isError: true,
          };
        }

        const imageIssues = await resolvePresentationImages(store, parseResult.data);
        if (imageIssues.length > 0) {
          return {
            content: [{ type: "text", text: `Presentation image resolution failed: ${imageIssues.join("; ")}` }],
            isError: true,
          };
        }

        const pptxBuffer = await buildPptxBuffer(parseResult.data);
        const outputPath = `presentations/${name}/build/${name}.pptx`;
        const { size } = await writeArtifact(store, outputPath, pptxBuffer, {
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          originalName: `${name}.pptx`,
        });

        return {
          content: [{
            type: "text",
            text: `Built presentation: ${EDITABLE_COLLECTION}/${outputPath} (${size} bytes, ${parseResult.data.slides.length} slides)`,
          }],
          structuredContent: { pptxPath: outputPath, size, slides: parseResult.data.slides.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Build failed: ${err?.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "vault_report_build",
    {
      title: "Build Report",
      description: `Generate a PDF report from a report spec stored in the editable collection.

The spec must exist at editable/reports/<name>/spec.json. The generated PDF will be stored at editable/reports/<name>/build/<name>.pdf.

Spec format: {
  title, subtitle?, author?, date?, summary?, closingNote?,
  hero?: { data, caption?, alt? },
  theme?: { accentColor?, accentSoftColor?, pageColor?, surfaceColor?, inkColor?, mutedColor?, headingFont?, bodyFont? },
  sections: [{
    heading, kicker?, summary?,
    blocks: [
      { type: "paragraph", text },
      { type: "bullets", items: [...] },
      { type: "metrics", items: [{ label, value, note? }, ...] },
      { type: "quote", text, attribution? },
      { type: "table", caption?, headers: [...], rows: [[...], ...] },
      { type: "image", image: { data, caption?, alt? } },
      { type: "callout", tone?: "info"|"success"|"warning", title?, text }
    ]
  }]
}

Every text field in the spec should be report content relevant to the topic. Do not include assistant framing or follow-up chatter like "I made...", "If you want, I can...", or "Let me know...". Any optional next step belongs in the separate chat reply, not inside the report.

For written deliverables such as memos, summaries, research briefs, weekly updates, one-pagers, and analyses, prefer a report over raw chat text. For image blocks, prefer existing vault images first. Otherwise fetch, generate, or capture the image, store it as an artifact, and reference that saved vault path.`,
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().describe("Report folder name under reports/ (e.g., 'weekly-update')"),
      },
    },
    async ({ name }) => {
      try {
        const specPath = `reports/${name}/spec.json`;
        const specDoc = getEditableArtifactDocument(store, specPath);
        if (!specDoc) {
          return {
            content: [{ type: "text", text: `Spec not found: ${EDITABLE_COLLECTION}/${specPath}` }],
            isError: true,
          };
        }

        let specData: unknown;
        try {
          specData = JSON.parse(specDoc.doc.content);
        } catch {
          return {
            content: [{ type: "text", text: `Invalid JSON in spec: ${specPath}` }],
            isError: true,
          };
        }

        const parseResult = ReportSpecSchema.safeParse(specData);
        if (!parseResult.success) {
          const issues = parseResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          return {
            content: [{ type: "text", text: `Invalid report spec: ${issues}` }],
            isError: true,
          };
        }

        const imageIssues = await resolveReportImages(store, parseResult.data);
        if (imageIssues.length > 0) {
          return {
            content: [{ type: "text", text: `Report image resolution failed: ${imageIssues.join("; ")}` }],
            isError: true,
          };
        }

        const pdfBuffer = await buildReportPdfBuffer(parseResult.data);
        const outputPath = `reports/${name}/build/${name}.pdf`;
        const { size } = await writeArtifact(store, outputPath, pdfBuffer, {
          mimeType: "application/pdf",
          originalName: `${name}.pdf`,
        });

        return {
          content: [{
            type: "text",
            text: `Built report: ${EDITABLE_COLLECTION}/${outputPath} (${size} bytes, ${parseResult.data.sections.length} sections)`,
          }],
          structuredContent: { pdfPath: outputPath, size, sections: parseResult.data.sections.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Report build failed: ${err?.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "vault_artifact_list",
    {
      title: "List Artifacts",
      description: `List artifacts in the editable collection, optionally filtered by path prefix.

Examples:
- prefix: "presentations/" → list all presentations
- prefix: "presentations/q1-report/" → list files in a specific presentation`,
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        prefix: z.string().optional().default("").describe("Path prefix filter (e.g., 'presentations/')"),
      },
    },
    async ({ prefix }) => {
      const normalizedPrefix = normalizeEditableArtifactPrefix(prefix);
      const legacyPrefix = normalizedPrefix ? `editable/${normalizedPrefix}` : "";
      const legacyUnderscorePrefix = normalizedPrefix ? `_editable/${normalizedPrefix}` : "";
      const rows = store.db.prepare(`
        SELECT d.path, d.title, d.modified_at, c.doc
        FROM documents d
        JOIN content c ON c.hash = d.hash
        WHERE d.collection = ? AND d.active = 1
          AND (
            ? = '' OR
            d.path LIKE ? || '%' OR
            d.path LIKE ? || '%' OR
            d.path LIKE ? || '%'
          )
        ORDER BY d.modified_at DESC
      `).all(
        EDITABLE_COLLECTION,
        normalizedPrefix,
        normalizedPrefix,
        legacyPrefix,
        legacyUnderscorePrefix,
      ) as Array<{
        path: string; title: string; modified_at: string; doc: string;
      }>;

      const persistedItems = rows.map((row) => {
        const blob = decodeBrowserUploadBlobEnvelope(row.doc);
        return {
          path: stripEditableArtifactPrefix(row.path),
          modifiedAt: row.modified_at,
          size: blob ? blob.byteLength : Buffer.byteLength(row.doc, "utf-8"),
          mimeType: blob?.mimeType ?? "text/plain",
          isBinary: !!blob,
        };
      });

      const queuedItems = Array.from(_pendingEditableArtifactWrites.values())
        .map((entry) => {
          const blob = decodeBrowserUploadBlobEnvelope(entry.content);
          return {
            path: stripEditableArtifactPrefix(entry.path),
            modifiedAt: new Date(entry.enqueuedAt).toISOString(),
            size: blob ? blob.byteLength : Buffer.byteLength(entry.content, "utf-8"),
            mimeType: blob?.mimeType ?? "text/plain",
            isBinary: !!blob,
          };
        })
        .filter((item) => !normalizedPrefix || item.path.startsWith(normalizedPrefix));

      const dedupedItems = new Map<string, {
        path: string;
        modifiedAt: string;
        size: number;
        mimeType: string;
        isBinary: boolean;
      }>();
      for (const item of [...persistedItems, ...queuedItems]) {
        const existing = dedupedItems.get(item.path);
        if (!existing || Date.parse(item.modifiedAt) >= Date.parse(existing.modifiedAt)) {
          dedupedItems.set(item.path, item);
        }
      }

      const items = Array.from(dedupedItems.values()).sort(
        (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt),
      );

      if (items.length === 0) {
        return {
          content: [{ type: "text", text: normalizedPrefix ? `No artifacts matching prefix: ${normalizedPrefix}` : "No artifacts in editable collection" }],
        };
      }

      const summary = items.map(i =>
        `  ${i.path} (${i.isBinary ? i.mimeType : "text"}, ${i.size} bytes, ${i.modifiedAt})`
      ).join("\n");

      return {
        content: [{ type: "text", text: `Artifacts (${items.length}):\n${summary}` }],
        structuredContent: { items },
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Browser tools — proxy to @playwright/mcp server
  // ---------------------------------------------------------------------------

  const browserToolDefs: Array<{
    vaultName: string;
    pwName: string;
    description: string;
    schema: Record<string, z.ZodType>;
  }> = [
    {
      vaultName: "vault_browser_navigate",
      pwName: "browser_navigate",
      description: "Navigate browser to a URL",
      schema: {
        url: z.string().describe("The URL to navigate to"),
        domainApproval: z.string().optional().describe('Domain approval after user consent: "once" for one-time access, "always" to add to allow list permanently.'),
      },
    },
    {
      vaultName: "vault_browser_snapshot",
      pwName: "browser_snapshot",
      description: "Get the accessibility tree of the current page for LLM-friendly content extraction",
      schema: {},
    },
    {
      vaultName: "vault_browser_click",
      pwName: "browser_click",
      description: "Click an element on the page by accessibility reference",
      schema: {
        element: z.string().describe("Accessibility snapshot reference (e.g. 'Submit button')"),
        ref: z.string().describe("Exact reference from accessibility snapshot").optional(),
        postApproval: z.string().optional().describe('Post/submit approval after user consent: "once" for one-time posting, "always" to enable posting permanently on this domain.'),
      },
    },
    {
      vaultName: "vault_browser_type",
      pwName: "browser_type",
      description: "Type text into an editable element",
      schema: {
        element: z.string().describe("Accessibility snapshot reference to the editable element"),
        ref: z.string().describe("Exact reference from accessibility snapshot").optional(),
        text: z.string().describe("Text to type"),
        submit: z.boolean().describe("Press Enter after typing").optional(),
        postApproval: z.string().optional().describe('Post/submit approval after user consent: "once" for one-time posting, "always" to enable posting permanently on this domain.'),
      },
    },
    {
      vaultName: "vault_browser_fill",
      pwName: "browser_fill",
      description: "Clear and fill a form field with new value",
      schema: {
        element: z.string().describe("Accessibility snapshot reference to the form field"),
        ref: z.string().describe("Exact reference from accessibility snapshot").optional(),
        value: z.string().describe("Value to fill"),
        postApproval: z.string().optional().describe('Post/submit approval after user consent: "once" for one-time posting, "always" to enable posting permanently on this domain.'),
      },
    },
    {
      vaultName: "vault_browser_select",
      pwName: "browser_select_option",
      description: "Select an option from a dropdown",
      schema: {
        element: z.string().describe("Accessibility snapshot reference to the select element"),
        ref: z.string().describe("Exact reference from accessibility snapshot").optional(),
        values: z.array(z.string()).describe("Values to select"),
      },
    },
    {
      vaultName: "vault_browser_hover",
      pwName: "browser_hover",
      description: "Hover over an element on the page",
      schema: {
        element: z.string().describe("Accessibility snapshot reference to hover over"),
        ref: z.string().describe("Exact reference from accessibility snapshot").optional(),
      },
    },
    {
      vaultName: "vault_browser_press_key",
      pwName: "browser_press_key",
      description: "Press a keyboard key or combination (e.g. Enter, Escape, Control+c)",
      schema: {
        key: z.string().describe("Key or key combination to press"),
        postApproval: z.string().optional().describe('Post/submit approval after user consent: "once" for one-time posting, "always" to enable posting permanently on this domain.'),
      },
    },
    {
      vaultName: "vault_browser_screenshot",
      pwName: "browser_take_screenshot",
      description: "Take a screenshot of the current page",
      schema: {},
    },
    {
      vaultName: "vault_browser_tab_list",
      pwName: "browser_tab_list",
      description: "List all open browser tabs",
      schema: {},
    },
    {
      vaultName: "vault_browser_tab_new",
      pwName: "browser_tab_new",
      description: "Open a new browser tab",
      schema: {
        url: z.string().describe("URL to open in the new tab").optional(),
        domainApproval: z.string().optional().describe('Domain approval after user consent: "once" for one-time access, "always" to add to allow list permanently.'),
      },
    },
    {
      vaultName: "vault_browser_tab_close",
      pwName: "browser_tab_close",
      description: "Close a browser tab",
      schema: {
        index: z.number().describe("Tab index to close").optional(),
      },
    },
    {
      vaultName: "vault_browser_tabs",
      pwName: "browser_tabs",
      description: "Manage tabs (list, new, close, select)",
      schema: {
        action: z.enum(["list", "new", "close", "select"]).describe("Tabs action to perform"),
        index: z.number().describe("Tab index for close/select").optional(),
      },
    },
    {
      vaultName: "vault_browser_console",
      pwName: "browser_console_messages",
      description: "Get browser console messages",
      schema: {},
    },
    {
      vaultName: "vault_browser_wait",
      pwName: "browser_wait_for",
      description: "Wait for text to appear or disappear on the page",
      schema: {
        text: z.string().describe("Text to wait for"),
        textGone: z.string().describe("Text to wait for disappearance").optional(),
        timeout: z.number().describe("Timeout in milliseconds").optional(),
      },
    },
    {
      vaultName: "vault_browser_pdf",
      pwName: "browser_pdf_save",
      description: "Save current page as PDF",
      schema: {
        filename: z.string().describe("Optional output filename").optional(),
      },
    },
    {
      vaultName: "vault_browser_dialog",
      pwName: "browser_handle_dialog",
      description: "Accept or dismiss the active browser dialog",
      schema: {
        accept: z.boolean().describe("Whether to accept the dialog"),
        promptText: z.string().describe("Prompt text for prompt dialogs").optional(),
      },
    },
  ];

  for (const def of browserToolDefs) {
    server.registerTool(
      def.vaultName,
      {
        title: def.vaultName,
        description: def.description + " (requires browser service to be running)",
        inputSchema: def.schema,
      },
      async (args) => {
        if (!isBrowserRunning()) {
          return {
            content: [{ type: "text" as const, text: "Browser service is not running. Start it first via the vault web UI or POST /connections/browser/start." }],
            isError: true,
          };
        }
        try {
          const { domainApproval: rawApproval, postApproval: rawPostApproval, ...toolArgs } = args as Record<string, unknown>;
          const rawDecision = normalizeDomainApproval(rawApproval);
          const domainApproval = rawDecision === "remove" ? undefined : rawDecision;
          const rawPostDecision = normalizeDomainApproval(rawPostApproval);
          const postApproval = rawPostDecision === "remove" ? undefined : rawPostDecision;
          const context = (domainApproval || postApproval) ? { ...(domainApproval && { domainApproval }), ...(postApproval && { postApproval }) } : undefined;
          const result = await browserSecurity.callExposedTool(def.pwName, toolArgs, context);
          return result as any;
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Browser tool error: ${err?.message || "Unknown error"}` }],
            isError: true,
          };
        }
      },
    );
  }

  server.registerTool(
    "vault_web_search_duckduckgo",
    {
      title: "vault_web_search_duckduckgo",
      description:
        "Search the public web with DuckDuckGo via the vault. " +
        "Returns structured result titles, URLs, and snippets, and records an immutable audit entry.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().min(1).max(10).optional().describe("Maximum number of results to return (default: 5)"),
      },
    },
    async (args) => {
      try {
        const result = await webSearch.searchDuckDuckGo(
          String((args as any).query ?? ""),
          typeof (args as any).limit === "number" ? (args as any).limit : undefined,
        );
        if (result.results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `DuckDuckGo returned no results for "${result.query}".` }],
            structuredContent: result,
          };
        }
        const summary = result.results.map((item, index) => {
          const lines = [`${index + 1}. ${item.title}`, `   ${item.url}`];
          if (item.snippet) lines.push(`   ${item.snippet}`);
          return lines.join("\n");
        }).join("\n\n");
        return {
          content: [{
            type: "text" as const,
            text: `DuckDuckGo results for "${result.query}":\n\n${summary}`,
          }],
          structuredContent: result,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `DuckDuckGo search error: ${err?.message || "Unknown error"}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "vault_web_fetch",
    {
      title: "vault_web_fetch",
      description:
        "Fetch and extract readable content from a URL (HTML → markdown/text) via the vault. " +
        "Use for lightweight page access without browser automation.",
      inputSchema: {
        url: z.string().describe("HTTP or HTTPS URL to fetch."),
        extractMode: z.enum(["markdown", "text"]).optional().describe('Extraction mode ("markdown" or "text"). Default: "markdown".'),
        maxChars: z.number().min(100).optional().describe("Maximum characters to return (truncates when exceeded). Default: 50000."),
        domainApproval: z.string().optional().describe('Domain approval after user consent: "once" for one-time access, "always" to add to allow list permanently.'),
      },
    },
    async (args) => {
      try {
        const a = args as { url?: string; extractMode?: string; maxChars?: number; domainApproval?: string };
        const result = await webFetch.fetch({
          url: String(a.url ?? ""),
          extractMode: a.extractMode === "text" ? "text" : "markdown",
          maxChars: typeof a.maxChars === "number" ? a.maxChars : undefined,
          domainApproval: (() => { const d = normalizeDomainApproval(a.domainApproval); return d === "remove" ? undefined : d; })(),
        });
        const header = result.title
          ? `# ${result.title}\n\nSource: ${result.finalUrl}\n\n`
          : `Source: ${result.finalUrl}\n\n`;
        return {
          content: [{
            type: "text" as const,
            text: `${header}${result.text}`,
          }],
          structuredContent: result,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Web fetch error: ${err?.message || "Unknown error"}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Domain approval tool — allows the agent to approve a domain after user consent
  // ---------------------------------------------------------------------------

  server.registerTool(
    "vault_approve_domain",
    {
      title: "vault_approve_domain",
      description:
        "Manage domain access for web fetch, browser navigation, and form submissions. " +
        "Call with 'once' or 'always' when a fetch/navigation/submit is blocked and the user approves. " +
        'Call with "remove" to revoke. Use capability to target "navigate" (domain allowlist), "post" (form submissions), or "all".',
      inputSchema: {
        domain: z.string().describe("The domain to approve or remove (e.g. bbc.com)"),
        scope: z.string().optional().describe('Scope: "web-fetch", "browser", or "all" (default: "all")'),
        decision: z.string().describe('Decision: "once" for one-time access, "always" to add permanently, "remove" to revoke'),
        capability: z.string().optional().describe('What to approve: "navigate" (domain allowlist, default), "post" (form submissions / egress), or "all" (both)'),
      },
    },
    async (args) => {
      const a = args as { domain?: string; scope?: string; decision?: string; capability?: string };
      const domain = (a.domain ?? "").trim().toLowerCase();
      if (!domain) {
        return { content: [{ type: "text" as const, text: "Error: domain is required" }], isError: true };
      }

      const decision = normalizeDomainApproval(a.decision);
      if (!decision) {
        return { content: [{ type: "text" as const, text: 'Error: decision must be "once", "always", or "remove"' }], isError: true };
      }

      const scope = (a.scope ?? "all").toLowerCase().trim();
      const capability = (a.capability ?? "navigate").toLowerCase().trim();
      const applyWebFetch = scope === "all" || scope === "web-fetch";
      const applyBrowser = scope === "all" || scope === "browser";
      const applyNavigate = capability === "navigate" || capability === "all";
      const applyPost = capability === "post" || capability === "all";

      const results: string[] = [];

      if (decision === "once") {
        if (applyNavigate) {
          if (applyWebFetch) webFetch.approveOnce(domain);
          if (applyBrowser) browserSecurity.approveOnce(domain);
          results.push("navigation");
        }
        if (applyPost && applyBrowser) {
          browserSecurity.postApproveOnce(domain);
          results.push("posting");
        }
        return {
          content: [{ type: "text" as const, text: `Domain ${domain} approved for one-time ${results.join(" and ")} access. Retry now.` }],
        };
      }

      if (decision === "remove") {
        const normalized = domain.toLowerCase().replace(/\.+$/, "");
        if (applyNavigate) {
          if (applyWebFetch) {
            const fp = webFetch.getPolicy();
            const filtered = fp.allowedDomains.filter(
              (r) => r.domain.toLowerCase().replace(/\.+$/, "") !== normalized,
            );
            if (filtered.length < fp.allowedDomains.length) {
              await webFetch.updatePolicy({ allowedDomains: filtered });
              results.push("web-fetch domain allow list");
            }
          }
          if (applyBrowser) {
            const bp = browserSecurity.getPolicy();
            const filtered = bp.allowedDomains.filter(
              (r) => r.domain.toLowerCase().replace(/\.+$/, "") !== normalized,
            );
            if (filtered.length < bp.allowedDomains.length) {
              await browserSecurity.patchPolicy({ allowedDomains: filtered });
              results.push("browser domain allow list");
            }
          }
        }
        if (applyPost && applyBrowser) {
          const removed = await browserSecurity.removeEgressRule(domain);
          if (removed) results.push("browser egress rules");
        }
        const msg = results.length > 0
          ? `Domain ${domain} removed from ${results.join(" and ")}.`
          : `Domain ${domain} was not found on any allow list or egress rule.`;
        return { content: [{ type: "text" as const, text: msg }] };
      }

      // "always" — add permanently
      if (applyNavigate) {
        if (applyWebFetch) {
          await webFetch.updatePolicy({
            allowedDomains: [
              ...webFetch.getPolicy().allowedDomains,
              { domain, includeSubdomains: true },
            ],
          });
          results.push("web-fetch allow list");
        }
        if (applyBrowser) {
          const bp = browserSecurity.getPolicy();
          await browserSecurity.patchPolicy({
            allowedDomains: [
              ...bp.allowedDomains,
              { domain, includeSubdomains: true },
            ],
          });
          results.push("browser allow list");
        }
      }
      if (applyPost && applyBrowser) {
        await browserSecurity.addEgressRule(domain);
        results.push("browser egress rules (posting enabled)");
      }
      return {
        content: [{ type: "text" as const, text: `Domain ${domain} added permanently to ${results.join(" and ")}. Retry now.` }],
      };
    },
  );

  server.registerTool(
    "vault_stage_media_upload",
    {
      title: "vault_stage_media_upload",
      description:
        "Stage inbound vault media (such as a Telegram image saved under /media) into '_uploads' so it can be used with browser upload tools.",
      inputSchema: {
        mediaUrl: z.string().optional().describe("Vault media URL to stage (for example http://127.0.0.1:8181/media/<id>)."),
        mediaPath: z.string().optional().describe("Vault media reference to stage (for example '_media/<id>' or '/media/<id>')."),
        path: z.string().optional().describe("Optional target path inside '_uploads'. If omitted, a safe inbound path is generated automatically."),
        overwrite: z.boolean().optional().describe("Overwrite an existing staged upload file if true."),
      },
    },
    async (args) => {
      const payload = {
        mediaUrl: typeof (args as any).mediaUrl === "string" ? String((args as any).mediaUrl) : undefined,
        mediaPath: typeof (args as any).mediaPath === "string" ? String((args as any).mediaPath) : undefined,
        path: typeof (args as any).path === "string" ? String((args as any).path) : undefined,
        overwrite: (args as any).overwrite === true,
      };
      try {
        const result = await stageBrowserUploadFromVaultMedia(store, payload);
        return {
          content: [
            {
              type: "text" as const,
              text: `Staged media to ${result.collection}/${result.path} (${result.size} bytes).`,
            },
          ],
          structuredContent: result as any,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Stage media upload error: ${err?.message || "Unknown error"}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "vault_browser_upload",
    {
      title: "vault_browser_upload",
      description:
        "Upload a file to the browser from a Vault collection (never from host filesystem paths). " +
        "Can also auto-stage a vault /media URL into '_uploads' before uploading.",
      inputSchema: {
        collection: z.string().optional().describe("Vault collection name (default upload boundary is '_uploads')."),
        path: z.string().optional().describe("Relative path inside the Vault collection."),
        mediaUrl: z.string().optional().describe("Optional vault media URL (for example from inbound Telegram media)."),
        mediaPath: z.string().optional().describe("Optional vault media reference (for example '_media/<id>' or '/media/<id>')."),
        stagePath: z.string().optional().describe("Optional target path inside '_uploads' when staging from media."),
        overwrite: z.boolean().optional().describe("When staging from media, overwrite an existing staged file if true."),
      },
    },
    async (args) => {
      if (!isBrowserRunning()) {
        return {
          content: [{ type: "text" as const, text: "Browser service is not running. Start it first via the vault web UI or POST /connections/browser/start." }],
          isError: true,
        };
      }
      try {
        let collection = typeof (args as any).collection === "string" ? String((args as any).collection).trim() : "";
        let path = typeof (args as any).path === "string" ? String((args as any).path).trim() : "";
        if ((!collection || !path) && (typeof (args as any).mediaUrl === "string" || typeof (args as any).mediaPath === "string")) {
          const staged = await stageBrowserUploadFromVaultMedia(store, {
            mediaUrl: typeof (args as any).mediaUrl === "string" ? String((args as any).mediaUrl) : undefined,
            mediaPath: typeof (args as any).mediaPath === "string" ? String((args as any).mediaPath) : undefined,
            path: typeof (args as any).stagePath === "string" ? String((args as any).stagePath) : undefined,
            overwrite: (args as any).overwrite === true,
          });
          collection = staged.collection;
          path = staged.path;
        }
        const result = await browserSecurity.vaultUpload({
          collection,
          path,
        });
        return result as any;
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Browser upload error: ${err?.message || "Unknown error"}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// =============================================================================
// Transport: stdio (default)
// =============================================================================

export async function startMcpServer(): Promise<void> {
  const dbPath = process.env.INDEX_PATH || getDefaultDbPath();
  if (isVaultLocked(dbPath)) {
    throw new Error("Vault is locked. Unlock it through the HTTP UI before starting the MCP stdio server.");
  }
  const store = createStore();
  migrateSystemCollectionNames(store);
  await ensureSystemBrowserRawCollections(store);
  const server = createMcpServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// =============================================================================
// Subprocess helper for write operations
// =============================================================================

/**
 * Resolve the vault CLI entry point. When running from compiled dist/, use vault.js
 * directly with node. When running from source via tsx, use vault.ts with tsx.
 */
function resolveVaultCli(): { exe: string; script: string } {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const compiledPath = resolve(thisDir, "vault.js");
  const sourcePath = resolve(thisDir, "vault.ts");

  // Check if we're running from compiled code (vault.js exists alongside mcp.js)
  if (existsSync(compiledPath)) {
    return { exe: process.execPath, script: compiledPath };
  }

  // Running from source — use tsx
  const tsxPath = resolve(thisDir, "../node_modules/.bin/tsx");
  return { exe: tsxPath, script: sourcePath };
}

function buildVaultSubprocessEnv(dbPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, INDEX_PATH: dbPath };
  const encryption = resolveVaultDatabaseEncryption(dbPath);
  if (encryption?.key) {
    env.STRAJA_SQLCIPHER_KEY = encryption.key;
    env.STRAJA_SQLCIPHER_LEGACY = String(encryption.legacy ?? 4);
  }
  return env;
}

// ---------------------------------------------------------------------------
// Debounced auto-embed scheduler
// ---------------------------------------------------------------------------
// Instead of spawning a full `straja-vault embed` process on every write,
// we debounce: schedule one embed run after a quiet period. If another write
// arrives before the timer fires, the timer resets. This prevents multiple
// concurrent embed processes from saturating the GPU and starving the HTTP
// server. The subprocess runs at low CPU priority via `nice`.
// ---------------------------------------------------------------------------

type AutoEmbedAdmissionResult = {
  ok: boolean;
  reason?: string;
  retryMs?: number;
};

type AutoEmbedStatus = {
  running: boolean;
  scheduled: boolean;
  dirty: boolean;
  lastTrigger: string | null;
  pendingTrigger: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  lastOutput: string;
  scheduledFor: string | null;
  requestedAt: string | null;
  lastDeferredAt: string | null;
  lastDeferredReason: string | null;
};

let _embedTimer: ReturnType<typeof setTimeout> | undefined;
let _lastAgentActivity = 0; // timestamp of last agent hook/MCP tool call
let _autoEmbedLog: ((message: string) => void) | null = null;
let _autoEmbedAdmissionCheck: (() => AutoEmbedAdmissionResult) | null = null;
const _autoEmbedState: AutoEmbedStatus & {
  pendingForce: boolean;
  runStartedAtMs: number | null;
} = {
  running: false,
  scheduled: false,
  dirty: false,
  lastTrigger: null,
  pendingTrigger: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastExitCode: null,
  lastError: null,
  lastOutput: "",
  scheduledFor: null,
  requestedAt: null,
  lastDeferredAt: null,
  lastDeferredReason: null,
  pendingForce: false,
  runStartedAtMs: null,
};
const EMBED_DEBOUNCE_MS = 120_000;       // wait 2 min after last write
const EMBED_AGENT_QUIET_MS = 60_000;     // skip embed if agent was active within 60s
const EMBED_RETRY_MS = 30_000;           // retry check after 30s if agent is busy
const _pendingEditableArtifactWrites = new Map<string, {
  path: string;
  content: string;
  enqueuedAt: number;
}>();

function markAgentActivity(): void {
  _lastAgentActivity = Date.now();
}

function configureAutoEmbedRuntime(params: {
  log?: (message: string) => void;
  getAdmission?: () => AutoEmbedAdmissionResult;
}): void {
  _autoEmbedLog = params.log ?? null;
  _autoEmbedAdmissionCheck = params.getAdmission ?? null;
}

function getAutoEmbedStatus(): AutoEmbedStatus {
  return {
    running: _autoEmbedState.running,
    scheduled: _autoEmbedState.scheduled,
    dirty: _autoEmbedState.dirty,
    lastTrigger: _autoEmbedState.lastTrigger,
    pendingTrigger: _autoEmbedState.pendingTrigger,
    lastStartedAt: _autoEmbedState.lastStartedAt,
    lastFinishedAt: _autoEmbedState.lastFinishedAt,
    lastDurationMs: _autoEmbedState.lastDurationMs,
    lastExitCode: _autoEmbedState.lastExitCode,
    lastError: _autoEmbedState.lastError,
    lastOutput: _autoEmbedState.lastOutput,
    scheduledFor: _autoEmbedState.scheduledFor,
    requestedAt: _autoEmbedState.requestedAt,
    lastDeferredAt: _autoEmbedState.lastDeferredAt,
    lastDeferredReason: _autoEmbedState.lastDeferredReason,
  };
}

function isAutoEmbedActive(): boolean {
  return _autoEmbedState.running;
}

function logAutoEmbed(message: string): void {
  if (_autoEmbedLog) {
    _autoEmbedLog(message);
    return;
  }
  process.stderr.write(`[auto-embed] ${message}\n`);
}

async function runEmbedSubcommand(
  dbPath: string,
  params: { force?: boolean },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = buildVaultSubprocessEnv(dbPath);
  const { exe, script } = resolveVaultCli();
  const isUnix = process.platform === "darwin" || process.platform === "linux";
  const cmd = isUnix ? "nice" : exe;
  const args = params.force
    ? ["embed", "--force"]
    : ["embed"];
  const spawnArgs = isUnix ? ["-n", "19", exe, script, ...args] : [script, ...args];
  if (isUnix) {
    env.GGML_METAL_DISABLE = "1";
  }
  return new Promise((resolveP) => {
    const child = nodeSpawn(cmd, spawnArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolveP({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolveP({ exitCode: 1, stdout, stderr: String(err) }));
  });
}

function clearAutoEmbedTimer(): void {
  if (_embedTimer) {
    clearTimeout(_embedTimer);
    _embedTimer = undefined;
  }
  _autoEmbedState.scheduled = false;
  _autoEmbedState.scheduledFor = null;
}

function startAutoEmbedRun(
  dbPath: string,
  params: { force?: boolean; trigger?: string; source: "auto" | "manual" },
): void {
  clearAutoEmbedTimer();
  _autoEmbedState.running = true;
  _autoEmbedState.pendingForce = false;
  _autoEmbedState.lastTrigger = params.trigger ?? params.source;
  _autoEmbedState.pendingTrigger = null;
  _autoEmbedState.lastStartedAt = new Date().toISOString();
  _autoEmbedState.runStartedAtMs = Date.now();
  _autoEmbedState.lastDeferredAt = null;
  _autoEmbedState.lastDeferredReason = null;
  _autoEmbedState.lastError = null;
  _autoEmbedState.lastExitCode = null;
  _autoEmbedState.lastOutput = "";

  void runEmbedSubcommand(dbPath, { force: params.force })
    .then((result) => {
      _autoEmbedState.lastExitCode = result.exitCode;
      _autoEmbedState.lastOutput = result.stdout.trim();
      if (result.exitCode !== 0) {
        const errorText = (result.stderr || result.stdout || "Embedding failed").trim();
        _autoEmbedState.lastError = errorText;
        logAutoEmbed(`${params.source} trigger ${params.trigger ?? "embed"} FAILED: ${errorText}`);
      } else {
        logAutoEmbed(`${params.source} trigger ${params.trigger ?? "embed"} done: ${result.stdout.trim()}`);
      }
    })
    .catch((err) => {
      const errorText = err instanceof Error ? err.message : String(err);
      _autoEmbedState.lastExitCode = 1;
      _autoEmbedState.lastError = errorText;
      logAutoEmbed(`${params.source} trigger ${params.trigger ?? "embed"} error: ${errorText}`);
    })
    .finally(() => {
      _autoEmbedState.running = false;
      _autoEmbedState.lastFinishedAt = new Date().toISOString();
      _autoEmbedState.lastDurationMs =
        _autoEmbedState.runStartedAtMs == null
          ? null
          : Date.now() - _autoEmbedState.runStartedAtMs;
      _autoEmbedState.runStartedAtMs = null;
      if (_autoEmbedState.dirty) {
        _autoEmbedState.dirty = false;
        scheduleAutoEmbed(dbPath, {
          trigger: "dirty-rerun",
          delayMs: EMBED_RETRY_MS,
        });
      }
    });
}

function scheduleAutoEmbed(
  dbPath: string,
  opts: { force?: boolean; trigger?: string; delayMs?: number } = {},
): void {
  const trigger = opts.trigger?.trim() || "auto";
  _autoEmbedState.requestedAt = new Date().toISOString();
  _autoEmbedState.pendingTrigger = trigger;
  _autoEmbedState.pendingForce = _autoEmbedState.pendingForce || !!opts.force;

  if (_autoEmbedState.running) {
    _autoEmbedState.dirty = true;
    return;
  }

  clearAutoEmbedTimer();
  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? EMBED_DEBOUNCE_MS));
  _autoEmbedState.scheduled = true;
  _autoEmbedState.scheduledFor = new Date(Date.now() + delayMs).toISOString();
  _embedTimer = setTimeout(() => {
    _embedTimer = undefined;
    _autoEmbedState.scheduled = false;
    _autoEmbedState.scheduledFor = null;

    if (_autoEmbedState.running) {
      _autoEmbedState.dirty = true;
      return;
    }

    const sinceLast = Date.now() - _lastAgentActivity;
    if (sinceLast < EMBED_AGENT_QUIET_MS) {
      _autoEmbedState.lastDeferredAt = new Date().toISOString();
      _autoEmbedState.lastDeferredReason = `agent active ${sinceLast}ms ago`;
      scheduleAutoEmbed(dbPath, {
        trigger,
        delayMs: EMBED_RETRY_MS,
      });
      return;
    }

    const admission = _autoEmbedAdmissionCheck?.() ?? { ok: true };
    if (!admission.ok) {
      _autoEmbedState.lastDeferredAt = new Date().toISOString();
      _autoEmbedState.lastDeferredReason = admission.reason ?? "busy";
      scheduleAutoEmbed(dbPath, {
        trigger,
        delayMs: Math.max(1_000, Math.floor(admission.retryMs ?? EMBED_RETRY_MS)),
      });
      return;
    }

    startAutoEmbedRun(dbPath, {
      force: _autoEmbedState.pendingForce,
      trigger,
      source: "auto",
    });
  }, delayMs);

  _embedTimer.unref?.();
}

function startAutoEmbedNow(
  dbPath: string,
  opts: { force?: boolean; trigger?: string } = {},
): boolean {
  if (_autoEmbedState.running) {
    return false;
  }
  _autoEmbedState.requestedAt = new Date().toISOString();
  _autoEmbedState.pendingTrigger = opts.trigger?.trim() || "manual";
  _autoEmbedState.pendingForce = !!opts.force;
  startAutoEmbedRun(dbPath, {
    force: opts.force,
    trigger: _autoEmbedState.pendingTrigger,
    source: "manual",
  });
  return true;
}

/**
 * Run a vault CLI subcommand as a subprocess, capturing stdout/stderr.
 * Used by HTTP write routes to delegate heavy indexing to the CLI.
 */
async function runSubcommand(
  vaultJs: string,
  args: string[],
  dbPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const env = buildVaultSubprocessEnv(dbPath);
    const { exe, script } = resolveVaultCli();
    const child = nodeSpawn(exe, [script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolveP({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolveP({ exitCode: 1, stdout, stderr: String(err) }));
  });
}

const BROWSER_UPLOAD_COLLECTION = "_uploads";
const BROWSER_SCREENSHOT_COLLECTION = "_screenshots";
const SYSTEM_UPLOADS_VIRTUAL_DIRNAME = ".uploads.virtual";
const SYSTEM_SCREENSHOTS_VIRTUAL_DIRNAME = ".screenshots.virtual";
const BROWSER_SCREENSHOT_TICKET_TTL_MS = 10 * 60 * 1000;
const BROWSER_SCREENSHOT_TICKET_MAX_ENTRIES = 4096;
const BROWSER_SCREENSHOT_FETCH_ROUTE_RE =
  /^\/connections\/browser\/screenshots\/file\/([A-Za-z0-9_-]{16,128})$/;
const SYSTEM_BROWSER_RAW_COLLECTIONS = new Set<string>([
  BROWSER_UPLOAD_COLLECTION,
  BROWSER_SCREENSHOT_COLLECTION,
]);

// ---------------------------------------------------------------------------
// Editable artifacts collection (agent-writable, visible in UI)
// ---------------------------------------------------------------------------
const EDITABLE_COLLECTION = "_editable";
const SYSTEM_EDITABLE_VIRTUAL_DIRNAME = ".editable.virtual";

// ---------------------------------------------------------------------------
// Notes collection (user-created quick context notes, stored in DB)
// ---------------------------------------------------------------------------
const NOTES_COLLECTION = "_notes";
const SYSTEM_NOTES_VIRTUAL_DIRNAME = ".notes.virtual";
const LEGACY_ROW_ENCRYPTION_PREFIX = "straja-sec-v1:";
const ARTIFACT_TICKET_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ARTIFACT_TICKET_MAX_ENTRIES = 1024;
const MAX_HTTP_JSON_BODY_BYTES = 5 * 1024 * 1024;
const MAX_HTTP_RAW_BODY_BYTES = 50 * 1024 * 1024;

type ArtifactTicketManager = {
  issue: (params: { collection: string; path: string }) => { token: string; expiresAtMs: number };
  resolve: (params: { collection: string; path: string; token: string }) =>
    | { ok: true; collection: string; path: string }
    | { ok: false; status: 400 | 403 | 404; error: string };
};

function createArtifactTicketManager(): ArtifactTicketManager {
  const key = randomBytes(32);
  const tickets = new Map<string, { collection: string; path: string; expiresAtMs: number }>();

  const sign = (collection: string, path: string) =>
    createHmac("sha256", key).update(`${collection}\0${path}`).digest("hex");

  const prune = (nowMs: number) => {
    for (const [token, record] of tickets) {
      if (record.expiresAtMs <= nowMs) tickets.delete(token);
    }
    while (tickets.size > ARTIFACT_TICKET_MAX_ENTRIES) {
      const oldest = tickets.keys().next().value;
      if (!oldest) break;
      tickets.delete(oldest);
    }
  };

  return {
    issue: ({ collection, path }) => {
      const nowMs = Date.now();
      prune(nowMs);
      const nonce = randomBytes(8).toString("hex");
      const token = sign(collection, `${path}\0${nonce}`);
      const expiresAtMs = nowMs + ARTIFACT_TICKET_TTL_MS;
      tickets.set(token, { collection, path, expiresAtMs });
      return { token, expiresAtMs };
    },
    resolve: ({ collection, path, token }) => {
      if (!/^[A-Fa-f0-9]{64}$/.test(token)) {
        return { ok: false as const, status: 400 as const, error: "Invalid artifact token" };
      }
      const nowMs = Date.now();
      prune(nowMs);
      const record = tickets.get(token);
      if (!record) {
        return { ok: false as const, status: 404 as const, error: "Artifact ticket not found or expired" };
      }
      if (record.expiresAtMs <= nowMs) {
        tickets.delete(token);
        return { ok: false as const, status: 404 as const, error: "Artifact ticket expired" };
      }
      if (record.collection !== collection || record.path !== path) {
        return { ok: false as const, status: 403 as const, error: "Artifact token scope mismatch" };
      }
      return { ok: true as const, collection: record.collection, path: record.path };
    },
  };
}

type BrowserScreenshotTicketRecord = {
  screenshotPath: string;
  expiresAtMs: number;
};

type BrowserScreenshotTicketManager = {
  issue: (screenshotPath: string) => { id: string; token: string; expiresAtMs: number };
  resolve: (params: { id: string; token: string }) =>
    | { ok: true; screenshotPath: string }
    | { ok: false; status: 400 | 403 | 404; error: string };
};

function createBrowserScreenshotTicketManager(): BrowserScreenshotTicketManager {
  const key = randomBytes(32);
  const tickets = new Map<string, BrowserScreenshotTicketRecord>();

  const sign = (id: string, screenshotPath: string) =>
    createHmac("sha256", key)
      .update(id)
      .update("\0")
      .update(screenshotPath)
      .digest("hex");

  const prune = (nowMs: number) => {
    for (const [id, record] of tickets) {
      if (record.expiresAtMs <= nowMs) {
        tickets.delete(id);
      }
    }
    while (tickets.size > BROWSER_SCREENSHOT_TICKET_MAX_ENTRIES) {
      const oldest = tickets.keys().next().value;
      if (!oldest) break;
      tickets.delete(oldest);
    }
  };

  return {
    issue: (screenshotPath) => {
      const nowMs = Date.now();
      prune(nowMs);
      let id = "";
      do {
        id = randomBytes(16).toString("base64url");
      } while (tickets.has(id));
      const expiresAtMs = nowMs + BROWSER_SCREENSHOT_TICKET_TTL_MS;
      tickets.set(id, { screenshotPath, expiresAtMs });
      return { id, token: sign(id, screenshotPath), expiresAtMs };
    },
    resolve: ({ id, token }) => {
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
        return { ok: false as const, status: 400 as const, error: "Invalid screenshot id" };
      }
      if (!/^[A-Fa-f0-9]{64}$/.test(token)) {
        return { ok: false as const, status: 400 as const, error: "Invalid screenshot token" };
      }
      const nowMs = Date.now();
      prune(nowMs);
      const record = tickets.get(id);
      if (!record) {
        return { ok: false as const, status: 404 as const, error: "Screenshot ticket not found" };
      }
      if (record.expiresAtMs <= nowMs) {
        tickets.delete(id);
        return { ok: false as const, status: 404 as const, error: "Screenshot ticket expired" };
      }
      const expectedToken = sign(id, record.screenshotPath);
      const providedBuf = Buffer.from(token, "hex");
      const expectedBuf = Buffer.from(expectedToken, "hex");
      if (providedBuf.byteLength !== expectedBuf.byteLength || !timingSafeEqual(providedBuf, expectedBuf)) {
        return { ok: false as const, status: 403 as const, error: "Invalid screenshot token" };
      }
      return { ok: true as const, screenshotPath: record.screenshotPath };
    },
  };
}

function isReservedBrowserUploadCollection(name: string): boolean {
  return name === BROWSER_UPLOAD_COLLECTION;
}

function isSystemBrowserRawCollection(name: string): boolean {
  return SYSTEM_BROWSER_RAW_COLLECTIONS.has(name);
}

function rejectReservedBrowserUploadCollection(nodeRes: ServerResponse, collName: string): true {
  nodeRes.writeHead(403, { "Content-Type": "application/json" });
  nodeRes.end(JSON.stringify({
    error: `Collection '${collName}' is system-managed and cannot be created or modified via this route`,
  }));
  return true;
}

function rejectSystemBrowserRawCollection(nodeRes: ServerResponse, collName: string): true {
  return rejectReservedBrowserUploadCollection(nodeRes, collName);
}

// ---------------------------------------------------------------------------
// Migration: rename legacy un-prefixed system collections to _-prefixed names
// ---------------------------------------------------------------------------
const COLLECTION_RENAMES: [string, string][] = [
  ["uploads", "_uploads"],
  ["screenshots", "_screenshots"],
  ["editable", "_editable"],
  ["gmail", "_gmail"],
  ["gdrive", "_gdrive"],
  ["calendar", "_calendar"],
  ["contacts", "_contacts"],
];
const COLLECTION_RENAME_MAP = new Map<string, string>(COLLECTION_RENAMES);

function canonicalizeLegacySystemCollectionName(name: string): string {
  return COLLECTION_RENAME_MAP.get(name) ?? name;
}

function migrateSystemCollectionNames(store: Store, log?: (msg: string) => void): void {
  for (const [oldName, newName] of COLLECTION_RENAMES) {
    // Check if there are any documents to migrate
    const oldCount = (store.db.prepare(
      `SELECT COUNT(*) as c FROM documents WHERE collection = ?`
    ).get(oldName) as { c: number }).c;
    if (oldCount === 0) {
      // Still clean up stale YAML entry if it exists
      try {
        if (getCollection(oldName)) {
          if (getCollection(newName)) { removeYamlCollection(oldName); }
          else { renameYamlCollection(oldName, newName); }
        }
      } catch { /* ignore */ }
      continue;
    }

    // Remove duplicates: if a path already exists in the new collection, delete the OLD row
    // (the new collection has the fresher data from a sync that ran after the code change)
    const dupes = store.db.prepare(
      `DELETE FROM documents WHERE collection = ? AND path IN (
        SELECT path FROM documents WHERE collection = ?
      )`
    ).run(oldName, newName);
    if (dupes.changes > 0) {
      log?.(`removed ${dupes.changes} stale duplicates from "${oldName}" (already in "${newName}")`);
    }

    // Now rename the remaining old-name documents
    const result = store.db.prepare(
      `UPDATE documents SET collection = ? WHERE collection = ?`
    ).run(newName, oldName);
    if (result.changes > 0) {
      log?.(`migrated ${result.changes} documents: "${oldName}" → "${newName}"`);
    }

    // Rename YAML collection config entry (if it exists)
    try {
      const existing = getCollection(oldName);
      if (existing) {
        if (getCollection(newName)) {
          removeYamlCollection(oldName);
        } else {
          renameYamlCollection(oldName, newName);
        }
        log?.(`renamed YAML collection: "${oldName}" → "${newName}"`);
      }
    } catch {
      try { removeYamlCollection(oldName); } catch { /* ignore */ }
    }
  }
}

async function ensureSystemBrowserUploadCollection(store: Store, log?: (msg: string) => void): Promise<void> {
  const existing = getCollection(BROWSER_UPLOAD_COLLECTION);
  if (existing) return;

  // Metadata-only path for the system collection. Upload file bytes are stored in the SQLite DB,
  // not in this directory; only temporary files are materialized during actual browser upload.
  const virtualPath = join(dirname(store.dbPath), SYSTEM_UPLOADS_VIRTUAL_DIRNAME);
  addCollection(BROWSER_UPLOAD_COLLECTION, virtualPath, "**/*");
  log?.(`system collection ready: ${BROWSER_UPLOAD_COLLECTION} (db-only raw storage)`);
}

async function ensureSystemBrowserScreenshotCollection(store: Store, log?: (msg: string) => void): Promise<void> {
  const existing = getCollection(BROWSER_SCREENSHOT_COLLECTION);
  if (existing) return;

  const virtualPath = join(dirname(store.dbPath), SYSTEM_SCREENSHOTS_VIRTUAL_DIRNAME);
  addCollection(BROWSER_SCREENSHOT_COLLECTION, virtualPath, "**/*");
  log?.(`system collection ready: ${BROWSER_SCREENSHOT_COLLECTION} (db-only raw storage)`);
}

async function ensureSystemBrowserRawCollections(store: Store, log?: (msg: string) => void): Promise<void> {
  await ensureSystemBrowserUploadCollection(store, log);
  await ensureSystemBrowserScreenshotCollection(store, log);
}

async function ensureEditableCollection(store: Store, log?: (msg: string) => void): Promise<void> {
  const existing = getCollection(EDITABLE_COLLECTION);
  if (existing) return;
  const virtualPath = join(dirname(store.dbPath), SYSTEM_EDITABLE_VIRTUAL_DIRNAME);
  addCollection(EDITABLE_COLLECTION, virtualPath, "**/*");
  log?.(`system collection ready: ${EDITABLE_COLLECTION} (db-only artifact storage)`);
}

/** Write binary or text content to the editable collection. */
async function writeArtifact(
  store: Store,
  path: string,
  content: string | Buffer,
  opts?: { mimeType?: string; originalName?: string },
): Promise<{ hash: string; size: number }> {
  const canonicalPath = normalizeEditableArtifactPath(path);
  const now = new Date().toISOString();
  let storeContent: string;
  let size: number;

  if (Buffer.isBuffer(content)) {
    storeContent = encodeBrowserUploadBlobEnvelope(content, {
      mimeType: opts?.mimeType ?? "application/octet-stream",
      originalName: opts?.originalName ?? path.split("/").pop(),
    });
    size = content.byteLength;
  } else {
    storeContent = content;
    size = Buffer.byteLength(content, "utf-8");
  }

  const hash = await hashContent(storeContent);
  store.insertContent(hash, storeContent, now);
  const existing = getEditableArtifactDocument(store, canonicalPath);
  if (existing) {
    store.updateDocument(existing.doc.id, existing.doc.title, hash, now);
  } else {
    store.insertDocument(EDITABLE_COLLECTION, canonicalPath, canonicalPath, hash, now, now);
  }
  return { hash, size };
}

function stripEditableArtifactPrefix(path: string): string {
  return path.replace(/^(?:_?editable)\//i, "");
}

function normalizeEditableArtifactPath(input: string): string {
  return stripEditableArtifactPrefix(normalizeBrowserUploadStagePath(input));
}

function normalizeEditableArtifactPrefix(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  return normalizeEditableArtifactPath(trimmed);
}

function getEditableArtifactCandidatePaths(path: string): string[] {
  const canonicalPath = normalizeEditableArtifactPath(path);
  return Array.from(new Set([
    canonicalPath,
    `editable/${canonicalPath}`,
    `_editable/${canonicalPath}`,
  ]));
}

function getEditableArtifactDocument(
  store: Store,
  path: string,
): { path: string; doc: { id: number; hash: string; title: string; content: string } } | null {
  for (const candidatePath of getEditableArtifactCandidatePaths(path)) {
    const doc = store.getDocumentWithContent(EDITABLE_COLLECTION, candidatePath);
    if (doc) {
      return { path: candidatePath, doc };
    }
  }
  return null;
}

function getExternallyVisibleArtifactDocument(
  store: Store,
  collection: string,
  path: string,
): { collection: string; path: string; doc: { id: number; hash: string; title: string; content: string } } | null {
  const canonicalCollection = canonicalizeLegacySystemCollectionName(collection);
  if (canonicalCollection === EDITABLE_COLLECTION) {
    const resolved = getEditableArtifactDocument(store, path);
    return resolved ? { collection: canonicalCollection, path: resolved.path, doc: resolved.doc } : null;
  }
  const doc = store.getDocumentWithContent(canonicalCollection, path);
  return doc ? { collection: canonicalCollection, path, doc } : null;
}

async function ensureNotesCollection(store: Store, log?: (msg: string) => void): Promise<void> {
  const existing = getCollection(NOTES_COLLECTION);
  if (existing) return;
  const virtualPath = join(dirname(store.dbPath), SYSTEM_NOTES_VIRTUAL_DIRNAME);
  addCollection(NOTES_COLLECTION, virtualPath, "**/*.md");
  log?.(`system collection ready: ${NOTES_COLLECTION} (db-only note storage)`);
}

/** Write a plain-text note to the _notes collection. */
async function writeNote(
  store: Store,
  path: string,
  content: string,
  title: string,
): Promise<{ hash: string; size: number }> {
  const now = new Date().toISOString();
  const hash = await hashContent(content);
  store.insertContent(hash, content, now);
  const existing = store.findActiveDocument(NOTES_COLLECTION, path);
  if (existing) {
    store.updateDocument(existing.id, title, hash, now);
  } else {
    store.insertDocument(NOTES_COLLECTION, path, title, hash, now, now);
  }
  return { hash, size: Buffer.byteLength(content, "utf-8") };
}

/** Write a note to an arbitrary collection. */
async function writeNoteToCollection(
  store: Store,
  collection: string,
  path: string,
  content: string,
  title: string,
): Promise<{ hash: string; size: number }> {
  const now = new Date().toISOString();
  const hash = await hashContent(content);
  store.insertContent(hash, content, now);
  const existing = store.findActiveDocument(collection, path);
  if (existing) {
    store.updateDocument(existing.id, title, hash, now);
  } else {
    store.insertDocument(collection, path, title, hash, now, now);
  }
  return { hash, size: Buffer.byteLength(content, "utf-8") };
}

type SpreadsheetRow = Record<string, unknown>;
type SpreadsheetDocResolution = {
  path: string;
  title: string;
  content: string;
  id: number;
};

function normalizeSpreadsheetPathInput(path: string): string {
  return String(path ?? "").trim().replace(/^\/+/, "");
}

function spreadsheetPathCandidates(path: string): string[] {
  const normalized = normalizeSpreadsheetPathInput(path);
  if (!normalized) return [];
  const candidates = new Set<string>([normalized]);
  if (!normalized.toLowerCase().endsWith(".json")) {
    candidates.add(`${normalized}.json`);
  }
  if (/\.(xlsx|xls|csv)$/i.test(normalized)) {
    candidates.add(normalized.replace(/\.(xlsx|xls|csv)$/i, ".json"));
  }
  return Array.from(candidates);
}

function spreadsheetTitleCandidates(path: string): string[] {
  const normalized = normalizeSpreadsheetPathInput(path);
  if (!normalized) return [];
  const stripped = normalized
    .replace(/\.json$/i, "")
    .replace(/\.(xlsx|xls|csv)$/i, "");
  return Array.from(new Set([normalized, stripped].map((entry) => entry.trim()).filter(Boolean)));
}

function slugifySpreadsheetSheetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function extractSpreadsheetSheetSlug(path: string): string | undefined {
  const match = path.match(/#sheet-([a-z0-9-]+)$/i);
  return match?.[1]?.toLowerCase();
}

function parseSpreadsheetDocumentContent(content: string): {
  rows: SpreadsheetRow[];
  wrapper: Record<string, unknown> | null;
  sourceAsset?: string;
} {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return {
      rows: parsed.filter((entry): entry is SpreadsheetRow => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)),
      wrapper: null,
    };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const wrapper = parsed as Record<string, unknown>;
    const data = Array.isArray(wrapper.data) ? wrapper.data : null;
    if (!data) {
      throw new Error("Spreadsheet document does not contain a data array");
    }
    return {
      rows: data.filter((entry): entry is SpreadsheetRow => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)),
      wrapper,
      sourceAsset: typeof wrapper._source_asset === "string" && wrapper._source_asset.trim()
        ? wrapper._source_asset.trim()
        : undefined,
    };
  }
  throw new Error("Spreadsheet document content is not a JSON array or wrapped sheet object");
}

function serializeSpreadsheetDocumentContent(
  wrapper: Record<string, unknown> | null,
  rows: SpreadsheetRow[],
): string {
  if (!wrapper) {
    return JSON.stringify(rows, null, 2);
  }
  return JSON.stringify({ ...wrapper, data: rows }, null, 2);
}

function spreadsheetColumns(rows: SpreadsheetRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) seen.add(key);
    }
  }
  return Array.from(seen);
}

function normalizeSpreadsheetMatchValue(value: unknown, mode: string): string {
  const text = String(value ?? "");
  switch (mode) {
    case "digits":
      return text.replace(/\D+/g, "");
    case "casefold":
      return text.trim().toLowerCase();
    case "trimmed":
      return text.trim();
    default:
      return text;
  }
}

function phoneMatchVariants(value: unknown): string[] {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits.length < 7) {
    return [];
  }
  const variants = new Set<string>([digits]);
  if (digits.startsWith("00") && digits.length > 9) {
    variants.add(digits.slice(2));
  }
  if (digits.startsWith("0") && digits.length > 8) {
    variants.add(digits.slice(1));
  }
  return Array.from(variants).filter((entry) => entry.length >= 7);
}

function spreadsheetMatchValuesEqual(left: unknown, right: unknown, mode: string): boolean {
  if (mode === "phone") {
    const leftVariants = phoneMatchVariants(left);
    const rightVariants = phoneMatchVariants(right);
    if (leftVariants.length === 0 || rightVariants.length === 0) {
      return false;
    }
    for (const leftValue of leftVariants) {
      for (const rightValue of rightVariants) {
        if (leftValue === rightValue) {
          return true;
        }
        const [shorter, longer] =
          leftValue.length <= rightValue.length
            ? [leftValue, rightValue]
            : [rightValue, leftValue];
        if (shorter.length >= 7 && longer.endsWith(shorter)) {
          return true;
        }
      }
    }
    return false;
  }
  return normalizeSpreadsheetMatchValue(left, mode) === normalizeSpreadsheetMatchValue(right, mode);
}

function resolveSpreadsheetMatchColumns(
  rows: SpreadsheetRow[],
  columns?: string[],
): string[] {
  if (Array.isArray(columns) && columns.length > 0) {
    return columns.map((entry) => String(entry)).filter(Boolean);
  }
  return spreadsheetColumns(rows);
}

function resolveSpreadsheetDocument(
  store: Store,
  collection: string,
  path: string,
): SpreadsheetDocResolution | null {
  for (const candidate of spreadsheetPathCandidates(path)) {
    const doc = store.getDocumentWithContent(collection, candidate);
    if (doc) {
      return { path: candidate, title: doc.title || candidate, content: doc.content, id: doc.id };
    }
  }

  const loweredCandidates = spreadsheetTitleCandidates(path).map((entry) => entry.toLowerCase());
  for (const lowered of loweredCandidates) {
    const row = store.db.prepare(`
      SELECT d.id, d.path, d.title, c.doc AS content
      FROM documents d
      JOIN content c ON c.hash = d.hash
      WHERE d.collection = ? AND d.active = 1 AND LOWER(COALESCE(d.title, '')) = ?
      ORDER BY d.modified_at DESC
      LIMIT 1
    `).get(collection, lowered) as { id: number; path: string; title: string; content: string } | undefined;
    if (row) {
      return { path: row.path, title: row.title || row.path, content: row.content, id: row.id };
    }
  }

  return null;
}

async function regenerateSpreadsheetSourceAsset(params: {
  store: Store;
  sourceAsset: string;
  rows: SpreadsheetRow[];
  docPath: string;
}): Promise<{ updated: boolean; path?: string }> {
  const { store, sourceAsset, rows, docPath } = params;
  if (!sourceAsset) return { updated: false };

  const XLSX = await import("xlsx");
  const existingAsset = getEditableArtifactDocument(store, sourceAsset);
  const lowerAsset = sourceAsset.toLowerCase();
  const targetSheetSlug = extractSpreadsheetSheetSlug(docPath);

  if (lowerAsset.endsWith(".csv")) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    await writeArtifact(store, sourceAsset, csv, {
      mimeType: "text/csv",
      originalName: basename(sourceAsset),
    });
    return { updated: true, path: normalizeEditableArtifactPath(sourceAsset) };
  }

  let workbook: any;
  if (existingAsset) {
    try {
      const blob = decodeBrowserUploadBlobEnvelope(existingAsset.doc.content);
      if (blob) {
        workbook = XLSX.read(Buffer.from(blob.bytes), { type: "buffer" });
      }
    } catch {
      workbook = undefined;
    }
  }
  if (!workbook) {
    workbook = XLSX.utils.book_new();
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  let targetSheetName = workbook.SheetNames?.[0] || "Sheet1";
  if (targetSheetSlug && Array.isArray(workbook.SheetNames) && workbook.SheetNames.length > 0) {
    const matchedSheet = workbook.SheetNames.find(
      (name: string) => slugifySpreadsheetSheetName(name) === targetSheetSlug,
    );
    if (matchedSheet) {
      targetSheetName = matchedSheet;
    }
  }

  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(workbook, ws, targetSheetName);
  } else if (workbook.Sheets?.[targetSheetName]) {
    workbook.Sheets[targetSheetName] = ws;
  } else {
    XLSX.utils.book_append_sheet(workbook, ws, targetSheetName);
  }

  const bookType = lowerAsset.endsWith(".xls") ? "xls" : "xlsx";
  const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType }) as Buffer);
  await writeArtifact(store, sourceAsset, buffer, {
    mimeType:
      bookType === "xls"
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    originalName: basename(sourceAsset),
  });
  return { updated: true, path: normalizeEditableArtifactPath(sourceAsset) };
}

/** Generate a slug from a title for note filenames. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";
}

async function importFilesToSystemRawCollection(
  store: Store,
  collectionName: string,
  paths: string[],
): Promise<{ imported: number; overwritten: number; bytesTotal: number }> {
  const coll = getCollection(collectionName);
  if (!coll) {
    throw new Error(`Collection not found: ${collectionName}`);
  }

  const collRoot = resolve(coll.path);
  const now = new Date().toISOString();
  let imported = 0;
  let overwritten = 0;
  let bytesTotal = 0;

  for (const rawPath of paths) {
    const sourceCandidate = String(rawPath);
    const resolvedSource = isAbsolute(sourceCandidate)
      ? resolve(sourceCandidate)
      : resolve(collRoot, sourceCandidate);

    const sourceStat = await stat(resolvedSource).catch(() => null);
    if (!sourceStat || !sourceStat.isFile()) {
      throw new Error(`File not found: ${rawPath}`);
    }

    const relFromRoot = relative(collRoot, resolvedSource);
    const insideRoot =
      relFromRoot !== "" &&
      !relFromRoot.startsWith("..") &&
      !isAbsolute(relFromRoot);

    // Preserve relative path only when the selected file already lives under the collection root.
    // Otherwise use basename and store bytes directly in SQLite (no persistent file copy).
    const docPath = normalizeBrowserUploadStagePath(
      (insideRoot ? relFromRoot : basename(resolvedSource)).replace(/\\/g, "/")
    );
    const bytes = await readFile(resolvedSource);
    bytesTotal += bytes.byteLength;

    const envelope = encodeBrowserUploadBlobEnvelope(bytes, {
      originalName: basename(resolvedSource),
    });
    const hash = await hashContent(envelope);
    store.insertContent(hash, envelope, now);

    const existing = store.findActiveDocument(collectionName, docPath);
    if (existing) {
      overwritten += 1;
      store.updateDocument(existing.id, existing.title || docPath, hash, now);
    } else {
      imported += 1;
      store.insertDocument(collectionName, docPath, docPath, hash, now, now);
    }
  }

  return { imported, overwritten, bytesTotal };
}

function parseBrowserImageData(
  data: string,
  declaredMimeType?: string,
): { bytes: Buffer; mimeType: string | undefined } | null {
  let payload = data.trim();
  let mimeType = typeof declaredMimeType === "string" && declaredMimeType.trim()
    ? declaredMimeType.trim()
    : undefined;

  const dataUrlMatch = payload.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    mimeType = mimeType ?? dataUrlMatch[1]?.trim();
    payload = dataUrlMatch[2] ?? "";
  }

  const compact = payload.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.byteLength === 0) return null;
  return { bytes, mimeType };
}

function extractBrowserScreenshotBytes(result: BrowserToolCallResult): { bytes: Buffer; mimeType?: string } | null {
  const items = Array.isArray(result?.content) ? result.content : [];
  for (const item of items) {
    if (!item || item.type !== "image" || typeof item.data !== "string") continue;
    const parsed = parseBrowserImageData(item.data, item.mimeType);
    if (!parsed) continue;
    return { bytes: parsed.bytes, ...(parsed.mimeType ? { mimeType: parsed.mimeType } : {}) };
  }
  return null;
}

function screenshotFileExtension(mimeType?: string): string {
  const mime = (mimeType || "").toLowerCase();
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".png";
}

async function saveSystemRawCollectionDocument(
  store: Store,
  collectionName: string,
  path: string,
  bytes: Uint8Array,
  opts?: { mimeType?: string; originalName?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const envelope = encodeBrowserUploadBlobEnvelope(bytes, {
    mimeType: opts?.mimeType,
    originalName: opts?.originalName,
  });
  const hash = await hashContent(envelope);
  store.insertContent(hash, envelope, now);

  const existing = store.findActiveDocument(collectionName, path);
  if (existing) {
    store.updateDocument(existing.id, existing.title || path, hash, now);
  } else {
    store.insertDocument(collectionName, path, path, hash, now, now);
  }
}

function extractVaultMediaDocPath(input: string): string | null {
  const value = String(input ?? "").trim();
  if (!value) return null;
  if (value.startsWith("_media/")) {
    return value.slice("_media/".length);
  }
  if (value.startsWith("/media/")) {
    return decodeURIComponent(value.slice("/media/".length));
  }
  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith("/media/")) {
      return decodeURIComponent(parsed.pathname.slice("/media/".length));
    }
  } catch {
    // Fall through to raw path handling below.
  }
  if (!value.includes("/") && !value.includes("\0")) {
    return value;
  }
  return null;
}

type StageBrowserUploadFromMediaParams = {
  mediaUrl?: string;
  mediaPath?: string;
  path?: string;
  overwrite?: boolean;
};

type StagedBrowserUpload = {
  ok: true;
  collection: typeof BROWSER_UPLOAD_COLLECTION;
  path: string;
  size: number;
  mimeType: string | null;
  originalName: string | null;
  sourceCollection: "_media";
  sourcePath: string;
  overwritten: boolean;
};

async function stageBrowserUploadFromVaultMedia(
  store: Store,
  params: StageBrowserUploadFromMediaParams,
): Promise<StagedBrowserUpload> {
  const sourceRef = typeof params.mediaUrl === "string" && params.mediaUrl.trim()
    ? params.mediaUrl.trim()
    : typeof params.mediaPath === "string" && params.mediaPath.trim()
      ? params.mediaPath.trim()
      : "";
  if (!sourceRef) {
    throw new Error("mediaUrl or mediaPath is required");
  }

  const sourcePath = extractVaultMediaDocPath(sourceRef);
  if (!sourcePath) {
    throw new Error("mediaUrl/mediaPath must reference a vault /media item");
  }

  const mediaDoc = store.getDocumentWithContent("_media", sourcePath);
  if (!mediaDoc) {
    throw new Error(`Vault media not found: ${sourcePath}`);
  }
  const blob = decodeBrowserUploadBlobEnvelope(mediaDoc.content);
  if (!blob) {
    throw new Error("Vault media could not be decoded");
  }

  const now = new Date();
  const generatedName = (() => {
    const preferred = basename(blob.originalName || sourcePath || "upload.bin");
    const safeBase = preferred.replace(/^\/+/, "");
    const dateDir = now.toISOString().slice(0, 10);
    return `${dateDir}/inbound-${randomUUID().slice(0, 8)}-${safeBase}`;
  })();
  const stagedPath = normalizeBrowserUploadStagePath(
    typeof params.path === "string" && params.path.trim() ? params.path.trim() : generatedName,
  );
  const existing = store.findActiveDocument(BROWSER_UPLOAD_COLLECTION, stagedPath);
  if (existing && params.overwrite !== true) {
    throw new Error(`File already exists in uploads: ${stagedPath}`);
  }

  await ensureSystemBrowserUploadCollection(store);
  await saveSystemRawCollectionDocument(
    store,
    BROWSER_UPLOAD_COLLECTION,
    stagedPath,
    blob.bytes,
    {
      mimeType: blob.mimeType,
      originalName: blob.originalName || basename(stagedPath),
    },
  );

  return {
    ok: true,
    collection: BROWSER_UPLOAD_COLLECTION,
    path: stagedPath,
    size: blob.byteLength,
    mimeType: blob.mimeType ?? null,
    originalName: blob.originalName ?? null,
    sourceCollection: "_media",
    sourcePath,
    overwritten: Boolean(existing),
  };
}

async function persistBrowserScreenshotAndDecorateResult(
  store: Store,
  result: BrowserToolCallResult,
  port: number,
  screenshotTickets: BrowserScreenshotTicketManager,
): Promise<BrowserToolCallResult> {
  const screenshot = extractBrowserScreenshotBytes(result);
  if (!screenshot) return result;

  await ensureSystemBrowserScreenshotCollection(store);

  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timestampToken = now.toISOString().replace(/[:.]/g, "-");
  const ext = screenshotFileExtension(screenshot.mimeType);
  const screenshotPath = normalizeBrowserUploadStagePath(
    `${dateDir}/${timestampToken}-${randomUUID().slice(0, 8)}${ext}`
  );
  await saveSystemRawCollectionDocument(store, BROWSER_SCREENSHOT_COLLECTION, screenshotPath, screenshot.bytes, {
    mimeType: screenshot.mimeType,
    originalName: basename(screenshotPath),
  });

  const ticket = screenshotTickets.issue(screenshotPath);
  const mediaUrl =
    `http://127.0.0.1:${port}/connections/browser/screenshots/file/${encodeURIComponent(ticket.id)}` +
    `?token=${encodeURIComponent(ticket.token)}`;
  const noteText = [
    `MEDIA:${mediaUrl}`,
    `Screenshot saved to ${BROWSER_SCREENSHOT_COLLECTION}/${screenshotPath}`,
  ].join("\n");

  const content = Array.isArray(result.content) ? [...result.content] : [];
  content.push({ type: "text", text: noteText });

  const decorated: BrowserToolCallResult = { ...result, content };
  const details =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? { ...(result.details as Record<string, unknown>) }
      : {};
  details.path = mediaUrl;
  details.vaultPath = `${BROWSER_SCREENSHOT_COLLECTION}/${screenshotPath}`;
  decorated.details = details;
  return decorated;
}

/**
 * Extract a file path from a Playwright MCP result text that contains a
 * markdown link ending in `.pdf`, e.g. `- [Page as pdf](/tmp/.../page-123.pdf)`.
 * Returns the resolved absolute path or null if not found.
 */
function extractPdfPathFromResult(result: BrowserToolCallResult): string | null {
  const items = Array.isArray(result?.content) ? result.content : [];
  for (const item of items) {
    if (!item || item.type !== "text" || typeof item.text !== "string") continue;
    const match = item.text.match(/\[.*?\]\((.+?\.pdf)\)/i);
    if (match?.[1]) {
      // Resolve relative paths (Playwright may return ../../../../var/... style paths)
      return resolve(match[1]);
    }
  }
  return null;
}

/**
 * PDF storage directory — on the filesystem alongside the vault DB,
 * NOT inside SQLite. PDFs can be 10-100MB which is too large for blob envelopes.
 */
function browserPdfDir(store: Store): string {
  return join(dirname(store.dbPath), ".browser-pdfs");
}

/**
 * Persist a browser-generated PDF to the filesystem and return a decorated
 * result with a ticketed download URL. Unlike screenshots (which are small and
 * stored in SQLite blob envelopes), PDFs are stored as files on disk because
 * they can be very large (image-heavy pages with backgrounds can exceed 100MB).
 *
 * Ticket paths for PDFs are prefixed with `fs:` so the download endpoint can
 * distinguish them from SQLite-backed screenshot paths.
 */
async function persistBrowserPdfAndDecorateResult(
  store: Store,
  result: BrowserToolCallResult,
  port: number,
  screenshotTickets: BrowserScreenshotTicketManager,
): Promise<BrowserToolCallResult> {
  const pdfFilePath = extractPdfPathFromResult(result);
  if (!pdfFilePath) return result;

  // Verify the source file exists
  try {
    await access(pdfFilePath);
  } catch {
    throw new Error(`PDF file not found at Playwright output: ${pdfFilePath}`);
  }

  // Move PDF to vault-managed directory on the filesystem
  const pdfDir = browserPdfDir(store);
  await mkdir(pdfDir, { recursive: true });

  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timestampToken = now.toISOString().replace(/[:.]/g, "-");
  const pdfFileName = `${timestampToken}-${randomUUID().slice(0, 8)}.pdf`;
  const dateDirPath = join(pdfDir, dateDir);
  await mkdir(dateDirPath, { recursive: true });
  const destPath = join(dateDirPath, pdfFileName);

  // Copy then delete (rename may fail across filesystems)
  const pdfBytes = await readFile(pdfFilePath);
  await writeFile(destPath, pdfBytes);

  // Delete the temp file — the PDF now lives in the vault's managed directory
  try {
    await rm(pdfFilePath, { force: true });
  } catch {
    // Ignore — file may already be cleaned up
  }

  // Ticket path prefixed with fs: so the download endpoint reads from filesystem
  const ticketPath = `fs:${destPath}`;
  const ticket = screenshotTickets.issue(ticketPath);
  const mediaUrl =
    `http://127.0.0.1:${port}/connections/browser/screenshots/file/${encodeURIComponent(ticket.id)}` +
    `?token=${encodeURIComponent(ticket.token)}`;
  const noteText = [
    `MEDIA:${mediaUrl}`,
    `PDF saved (${(pdfBytes.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  ].join("\n");

  const content: BrowserToolCallResult["content"] = [{ type: "text" as const, text: noteText }];

  const decorated: BrowserToolCallResult = { ...result, content };
  const details =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? { ...(result.details as Record<string, unknown>) }
      : {};
  details.path = mediaUrl;
  details.vaultPath = destPath;
  decorated.details = details;
  return decorated;
}

// =============================================================================
// Transport: Streamable HTTP
// =============================================================================

export type HttpServerHandle = {
  httpServer: import("http").Server;
  port: number;
  stop: () => Promise<void>;
};

/**
 * Start MCP server over Streamable HTTP (JSON responses, no SSE).
 * Binds to localhost only. Returns a handle for shutdown and port discovery.
 */
export async function startMcpHttpServer(port: number, options?: { quiet?: boolean }): Promise<HttpServerHandle> {
  const storeDbPath = process.env.INDEX_PATH || getDefaultDbPath();
  const workspaceLogsDir = (() => {
    const explicit = process.env.STRAJA_WORKSPACE_APP_LOGS_DIR?.trim();
    if (explicit) {
      return explicit;
    }
    const cacheHome = process.env.XDG_CACHE_HOME?.trim();
    return cacheHome ? resolve(cacheHome, "straja-vault") : resolve(homedir(), ".cache", "straja-vault");
  })();
  mkdirSync(workspaceLogsDir, { recursive: true });
  const workspaceLogFd = openSync(join(workspaceLogsDir, "workspace.log"), "a");
  let mountedStore: Store | null = null;

  const store = new Proxy({} as Store, {
    get(target, prop, receiver) {
      if (Reflect.has(target as object, prop)) {
        return Reflect.get(target as object, prop, receiver);
      }
      if (prop === "dbPath") {
        return storeDbPath;
      }
      if (prop === "close") {
        return () => {
          if (mountedStore) {
            mountedStore.close();
            mountedStore = null;
          }
        };
      }
      if (!mountedStore) {
        throw new Error("Vault is locked.");
      }
      const value = Reflect.get(mountedStore as object, prop, receiver);
      return typeof value === "function" ? value.bind(mountedStore) : value;
    },
  });

  function syncGoogleOAuthClientConfig(activeStore: Store | null): void {
    if (!activeStore) {
      setGoogleOAuthClientConfig(null);
      return;
    }
    const doc = activeStore.getDocumentWithContent("_config", "google-oauth.json");
    if (!doc?.content) {
      setGoogleOAuthClientConfig(null);
      return;
    }
    try {
      setGoogleOAuthClientConfig(parseGoogleOAuthClientConfig(JSON.parse(doc.content)));
    } catch {
      setGoogleOAuthClientConfig(null);
    }
  }

  function syncGitHubOAuthClientConfig(activeStore: Store | null): void {
    if (!activeStore) {
      setGitHubOAuthClientConfig(null);
      return;
    }
    const doc = activeStore.getDocumentWithContent("_config", "github-oauth.json");
    if (!doc?.content) {
      setGitHubOAuthClientConfig(null);
      return;
    }
    try {
      setGitHubOAuthClientConfig(parseGitHubOAuthClientConfig(JSON.parse(doc.content)));
    } catch {
      setGitHubOAuthClientConfig(null);
    }
  }

  const STARTER_TEAM_PROFILE_IDS: AgentProfileId[] = [
    "chief-of-staff",
    "software-engineer",
    "researcher",
    "marketing-expert",
    "community-manager",
    "customer-service",
    "sales-assistant",
    "operations-admin",
  ];

  async function mountStore(): Promise<Store> {
    if (mountedStore) {
      return mountedStore;
    }
    const nextStore = createStore(storeDbPath);
    const legacyRowEncryptedDocs = nextStore.db.prepare(`
      SELECT d.collection as collection, d.path as path
      FROM documents d
      JOIN content c ON c.hash = d.hash
      WHERE d.active = 1
        AND (
          d.collection IN ('_sessions', '_sessions_store', '_credentials', '_auth_profiles', '_config')
          OR (
            d.collection = '_workspace'
            AND (
              d.path GLOB '_config/*.json'
              OR d.path GLOB '.openclaw/*.json'
            )
          )
        )
        AND c.doc LIKE ?
    `).all(`${LEGACY_ROW_ENCRYPTION_PREFIX}%`) as Array<{ collection: string; path: string }>;
    for (const row of legacyRowEncryptedDocs) {
      nextStore.deactivateDocument(row.collection, row.path);
    }
    if (legacyRowEncryptedDocs.length > 0 && !options?.quiet) {
      console.error(
        `Removed ${legacyRowEncryptedDocs.length} legacy row-encrypted documents that are incompatible with DB-level encryption.`,
      );
    }
    migrateSystemCollectionNames(nextStore, options?.quiet ? undefined : (msg) => console.log(msg));
    await ensureSystemBrowserRawCollections(nextStore);
    await ensureEditableCollection(nextStore);
    await ensureNotesCollection(nextStore);
    await seedWorkspaceDefaults(nextStore);
    mountedStore = nextStore;
    syncGoogleOAuthClientConfig(nextStore);
    syncGitHubOAuthClientConfig(nextStore);
    return nextStore;
  }

  function unmountStore(): void {
    if (!mountedStore) {
      return;
    }
    mountedStore.close();
    mountedStore = null;
    syncGoogleOAuthClientConfig(null);
    syncGitHubOAuthClientConfig(null);
  }

  if (!isVaultLocked(storeDbPath)) {
    await mountStore();
  }
  const browserScreenshotTickets = createBrowserScreenshotTicketManager();
  const artifactTickets = createArtifactTicketManager();
  let mcpServer = null as unknown as McpServer;
  let transport = null as unknown as WebStandardStreamableHTTPServerTransport;

  const startTime = Date.now();
  const quiet = options?.quiet ?? false;

  /** Format timestamp for request logging */
  function ts(): string {
    return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  }

  /** Extract a human-readable label from a JSON-RPC body */
  function describeRequest(body: any): string {
    const method = body?.method ?? "unknown";
    if (method === "tools/call") {
      const tool = body.params?.name ?? "?";
      const args = body.params?.arguments;
      // Show query string if present, truncated
      if (args?.query) {
        const q = String(args.query).slice(0, 80);
        return `tools/call ${tool} "${q}"`;
      }
      if (args?.path) return `tools/call ${tool} ${args.path}`;
      if (args?.pattern) return `tools/call ${tool} ${args.pattern}`;
      return `tools/call ${tool}`;
    }
    return method;
  }

  function log(msg: string): void {
    try {
      writeSync(workspaceLogFd, `${msg}\n`);
    } catch {
      // Best-effort file logging only.
    }
    if (!quiet) console.error(msg);
  }

  let browserSecurity = null as unknown as BrowserSecurityController;
  let webSearch = null as unknown as WebSearchController;
  let webFetch = null as unknown as WebFetchController;
  let interactiveRuntimeInitPromise: Promise<void> | null = null;

  async function ensureInteractiveRuntimeInitialized(): Promise<void> {
    if (!mountedStore) {
      throw new Error("Vault is locked.");
    }
    if (!(browserSecurity as unknown)) {
      browserSecurity = new BrowserSecurityController(store, callBrowserTool, listBrowserTools, log);
    }
    if (!(webSearch as unknown)) {
      webSearch = new WebSearchController(store, globalThis.fetch.bind(globalThis), log);
    }
    if (!(webFetch as unknown)) {
      webFetch = new WebFetchController(store, globalThis.fetch.bind(globalThis), log);
    }
    if (!(transport as unknown)) {
      mcpServer = createMcpServer(store);
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });
      await mcpServer.connect(transport);
    }
  }

  function scheduleInteractiveRuntimeInitialization(reason: string): void {
    if (interactiveRuntimeInitPromise) {
      return;
    }
    interactiveRuntimeInitPromise = (async () => {
      try {
        await ensureInteractiveRuntimeInitialized();
      } catch (err: any) {
        log(`${ts()} interactive-runtime init failed (${reason}): ${err?.message || err}`);
      } finally {
        interactiveRuntimeInitPromise = null;
      }
    })();
  }

  if (mountedStore) {
    await ensureInteractiveRuntimeInitialized();
  }

  class PayloadTooLargeError extends Error {
    constructor(readonly maxBytes: number) {
      super(`Request body exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit`);
      this.name = "PayloadTooLargeError";
    }
  }

  async function collectBodyBytes(
    req: IncomingMessage,
    maxBytes = MAX_HTTP_JSON_BODY_BYTES,
  ): Promise<Buffer> {
    const declaredLength = Number.parseInt(getHeaderValue(req, "content-length") || "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.destroy();
      throw new PayloadTooLargeError(maxBytes);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const bufferChunk = chunk as Buffer;
      total += bufferChunk.length;
      if (total > maxBytes) {
        req.destroy();
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(bufferChunk);
    }
    return Buffer.concat(chunks, total);
  }

  async function collectBody(
    req: IncomingMessage,
    maxBytes = MAX_HTTP_JSON_BODY_BYTES,
  ): Promise<string> {
    return (await collectBodyBytes(req, maxBytes)).toString();
  }

  function getHeaderValue(req: IncomingMessage, headerName: string): string | undefined {
    const value = req.headers[headerName];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }

  function shouldTreatRawBodyAsBinary(req: IncomingMessage): boolean {
    const explicitMime = normalizeMimeType(getHeaderValue(req, "x-mime-type"));
    if (explicitMime) return true;

    const contentType = normalizeMimeType(getHeaderValue(req, "content-type"));
    if (!contentType) return false;
    if (contentType.startsWith("text/")) return false;

    return !new Set([
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/yaml",
      "application/x-yaml",
      "application/javascript",
      "application/typescript",
      "application/x-www-form-urlencoded",
    ]).has(contentType);
  }

  const managedModelUris = [
    DEFAULT_EMBED_MODEL_URI,
    DEFAULT_GENERATE_MODEL_URI,
    DEFAULT_ANSWER_MODEL_URI,
    DEFAULT_RERANK_MODEL_URI,
  ];

  type HttpModelStatusItem = {
    model: string;
    path: string;
    size: string;
    status: "downloaded" | "missing" | "downloading";
  };

  type ModelPullState = {
    inProgress: boolean;
    autoStarted: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    lastError: string | null;
    lastOutput: string;
    trigger: string | null;
  };

  const modelPullState: ModelPullState = {
    inProgress: false,
    autoStarted: false,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    lastOutput: "",
    trigger: null,
  };
  let modelPullPromise: Promise<{ exitCode: number; stdout: string; stderr: string }> | null = null;

  function formatModelBytes(sizeBytes: number): string {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = sizeBytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    const precision = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  function modelFilename(modelUri: string): string | null {
    const trimmed = modelUri.trim();
    if (!trimmed) return null;
    const name = trimmed.split("/").pop()?.trim();
    return name || null;
  }

  async function getModelsStatusSnapshot(): Promise<{
    downloaded: boolean;
    models: HttpModelStatusItem[];
    pulling: boolean;
    totalCount: number;
    downloadedCount: number;
    lastError: string | null;
  }> {
    let files: string[] = [];
    try {
      const entries = await readdir(DEFAULT_MODEL_CACHE_DIR, { withFileTypes: true });
      files = entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith(".etag"))
        .map((entry) => entry.name);
    } catch {
      files = [];
    }

    let downloadedCount = 0;
    const models: HttpModelStatusItem[] = [];
    for (const model of managedModelUris) {
      const filename = modelFilename(model);
      const matched = filename
        ? files
            .filter((name) => name === filename || name.includes(filename))
            .sort((a, b) => b.length - a.length || a.localeCompare(b))[0]
        : undefined;
      const resolvedPath = matched ? join(DEFAULT_MODEL_CACHE_DIR, matched) : "";
      let size = "—";
      if (resolvedPath) {
        downloadedCount++;
        try {
          const modelStat = await stat(resolvedPath);
          size = formatModelBytes(modelStat.size);
        } catch {
          size = "—";
        }
      }
      models.push({
        model,
        path: resolvedPath || join(DEFAULT_MODEL_CACHE_DIR, filename ?? ""),
        size,
        status: resolvedPath
          ? "downloaded"
          : modelPullState.inProgress
            ? "downloading"
            : "missing",
      });
    }

    return {
      downloaded: managedModelUris.length > 0 && downloadedCount === managedModelUris.length,
      models,
      pulling: modelPullState.inProgress,
      totalCount: managedModelUris.length,
      downloadedCount,
      lastError: modelPullState.lastError,
    };
  }

  function startModelPull(refresh: boolean, trigger: string): Promise<{ exitCode: number; stdout: string; stderr: string }> | null {
    if (modelPullPromise) {
      return null;
    }
    const vaultJs = resolve(dirname(fileURLToPath(import.meta.url)), "vault.js");
    const args = refresh ? ["pull", "--refresh"] : ["pull"];
    modelPullState.inProgress = true;
    modelPullState.startedAt = new Date().toISOString();
    modelPullState.lastError = null;
    modelPullState.lastOutput = "";
    modelPullState.trigger = trigger;

    modelPullPromise = runSubcommand(vaultJs, args, store.dbPath)
      .then((result) => {
        modelPullState.lastOutput = result.stdout.trim();
        if (result.exitCode !== 0) {
          const errorText = (result.stderr || result.stdout || "Model pull failed").trim();
          modelPullState.lastError = errorText;
          log(`${ts()} model pull (${trigger}) FAILED: ${errorText}`);
        } else {
          log(`${ts()} model pull (${trigger}) done`);
        }
        return result;
      })
      .catch((err) => {
        const errorText = err instanceof Error ? err.message : String(err);
        modelPullState.lastError = errorText;
        log(`${ts()} model pull (${trigger}) ERROR: ${errorText}`);
        return { exitCode: 1, stdout: "", stderr: errorText };
      })
      .finally(() => {
        modelPullState.inProgress = false;
        modelPullState.finishedAt = new Date().toISOString();
        modelPullPromise = null;
      });
    return modelPullPromise;
  }

  async function startAutoModelPullIfNeeded(trigger: string): Promise<void> {
    if (!mountedStore || modelPullState.autoStarted) {
      return;
    }
    const snapshot = await getModelsStatusSnapshot();
    modelPullState.autoStarted = true;
    if (snapshot.downloaded || snapshot.pulling) {
      return;
    }
    startModelPull(false, `auto:${trigger}`);
  }

  function startBackgroundEmbed(
    params: { force?: boolean; immediate?: boolean; trigger?: string } = {},
  ): boolean {
    if (params.immediate) {
      return startAutoEmbedNow(store.dbPath, {
        force: params.force,
        trigger: params.trigger ?? "/embed",
      });
    }
    scheduleAutoEmbed(store.dbPath, {
      force: params.force,
      trigger: params.trigger ?? "auto",
    });
    return true;
  }

  // -----------------------------------------------------------------------
  // Write queue — ALL document writes go through this in-memory queue.
  // Callers (MCP tools, HTTP handlers, etc.) never write to SQLite directly.
  // A single drain worker commits entries to SQLite sequentially, eliminating
  // SQLITE_BUSY contention and FK ordering issues.
  // -----------------------------------------------------------------------

  interface WriteQueueEntry {
    id: string;
    op: "upsert" | "deactivate";
    collection: string;
    path: string;
    title: string;
    content: string;
    hash: string;
    origin: string;
    enqueuedAt: number;
    status: "pending" | "writing";
    attempts: number;
    error?: string;
  }

  /** FIFO queue of pending write operations. */
  const writeQueue: WriteQueueEntry[] = [];

  /** Fast lookup index: "collection\0path" → latest queue entry for that path. */
  const writeQueueIndex = new Map<string, WriteQueueEntry>();

  /** Buffered content from insertContent() calls, waiting to be paired with insertDocument/updateDocument. */
  const contentPending = new Map<string, { content: string; createdAt: string }>();

  /**
   * Context hint set by getDocumentWithContent when it returns a synthetic id=-1
   * for a queued entry. Maps the synthetic id to collection/path so that
   * updateDocument can route the write correctly instead of dropping it.
   *
   * This works because JS is single-threaded: the caller does
   *   const doc = getDocumentWithContent(coll, path)  // sets hint
   *   updateDocument(doc.id, ...)                       // reads hint
   * with no async gap in between.
   */
  const syntheticIdContext = new Map<number, { collection: string; path: string }>();
  let nextSyntheticId = -1;

  function wqKey(collection: string, path: string): string {
    return `${collection}\0${path}`;
  }

  /** Enqueue a document upsert. Coalesces with existing pending entry for same path. */
  function enqueueUpsert(collection: string, path: string, title: string, content: string, hash: string, origin: string = "scan"): void {
    if (collection === EDITABLE_COLLECTION) {
      _pendingEditableArtifactWrites.set(path, { path, content, enqueuedAt: Date.now() });
    }
    const key = wqKey(collection, path);
    const existing = writeQueueIndex.get(key);
    if (existing && existing.status === "pending") {
      // Coalesce: update in place — latest content wins
      existing.title = title;
      existing.content = content;
      existing.hash = hash;
      existing.enqueuedAt = Date.now();
      // Don't downgrade origin: if existing is non-scan, keep it
      if (existing.origin === "scan" && origin !== "scan") {
        existing.origin = origin;
      }
      return;
    }
    const entry: WriteQueueEntry = {
      id: randomUUID(),
      op: "upsert",
      collection,
      path,
      title,
      content,
      hash,
      origin,
      enqueuedAt: Date.now(),
      status: "pending",
      attempts: 0,
    };
    writeQueue.push(entry);
    writeQueueIndex.set(key, entry);
  }

  /** Enqueue a document deactivation (soft delete). */
  function enqueueDeactivate(collection: string, path: string): void {
    if (collection === EDITABLE_COLLECTION) {
      _pendingEditableArtifactWrites.delete(path);
    }
    const key = wqKey(collection, path);
    const existing = writeQueueIndex.get(key);
    if (existing && existing.status === "pending") {
      // Replace pending upsert with deactivation
      existing.op = "deactivate";
      existing.content = "";
      existing.hash = "";
      existing.title = "";
      existing.enqueuedAt = Date.now();
      return;
    }
    const entry: WriteQueueEntry = {
      id: randomUUID(),
      op: "deactivate",
      collection,
      path,
      title: "",
      content: "",
      hash: "",
      origin: "scan",
      enqueuedAt: Date.now(),
      status: "pending",
      attempts: 0,
    };
    writeQueue.push(entry);
    writeQueueIndex.set(key, entry);
  }

  let writeQueueLastBlockedAt: string | null = null;
  let writeQueueLastBlockedPath: string | null = null;
  let writeQueueLastError: string | null = null;
  let writeQueueBlockedCount = 0;
  let writeQueueLastSuccessAt: string | null = null;

  /** Get write queue stats for the status endpoint. */
  function getWriteQueueStats(): {
    docs: number;
    entries: number;
    pending: number;
    writing: number;
    oldestAgeMs: number | null;
    maxAttempts: number;
    lastBlockedAt: string | null;
    lastBlockedPath: string | null;
    lastError: string | null;
    blockedCount: number;
    lastSuccessAt: string | null;
  } {
    const now = Date.now();
    let oldestAgeMs: number | null = null;
    let maxAttempts = 0;
    let pending = 0;
    let writing = 0;
    for (const entry of writeQueue) {
      if (entry.status === "pending") pending++;
      if (entry.status === "writing") writing++;
      const ageMs = now - entry.enqueuedAt;
      oldestAgeMs = oldestAgeMs == null ? ageMs : Math.max(oldestAgeMs, ageMs);
      maxAttempts = Math.max(maxAttempts, entry.attempts);
    }
    return {
      docs: writeQueue.length,
      entries: writeQueue.length,
      pending,
      writing,
      oldestAgeMs,
      maxAttempts,
      lastBlockedAt: writeQueueLastBlockedAt,
      lastBlockedPath: writeQueueLastBlockedPath,
      lastError: writeQueueLastError,
      blockedCount: writeQueueBlockedCount,
      lastSuccessAt: writeQueueLastSuccessAt,
    };
  }

  function getVaultDegradedState(): { degraded: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const writeQueueStats = getWriteQueueStats();
    const embedStatus = getAutoEmbedStatus();

    if (writeQueueStats.entries > 0 && (writeQueueStats.oldestAgeMs ?? 0) >= 2_000) {
      reasons.push(`write queue backlog (${writeQueueStats.entries} entries)`);
    }
    if (writeQueueStats.maxAttempts > 0) {
      reasons.push(`write queue retries (${writeQueueStats.maxAttempts} max attempts)`);
    }
    if (embedStatus.running && writeQueueStats.entries > 0) {
      reasons.push("embedding running while writes are queued");
    }
    if (embedStatus.lastDeferredReason?.includes("write queue")) {
      reasons.push(`embed deferred: ${embedStatus.lastDeferredReason}`);
    }

    return { degraded: reasons.length > 0, reasons };
  }

  // --- Store method overrides ---
  // Intercept write methods so all callers transparently route through the queue.
  // Callers don't need to know about the queue — they call the same store API.

  function requireMountedStore(): Store {
    if (!mountedStore) {
      throw new Error("Vault is locked.");
    }
    return mountedStore;
  }

  // Save raw references lazily — the HTTP daemon must still boot while locked.
  function rawInsertContent(hash: string, content: string, createdAt: string): void {
    requireMountedStore().insertContent(hash, content, createdAt);
  }

  function rawInsertDocument(
    collectionName: string,
    path: string,
    title: string,
    hash: string,
    createdAt: string,
    modifiedAt: string,
    origin?: string,
  ): void {
    requireMountedStore().insertDocument(collectionName, path, title, hash, createdAt, modifiedAt, origin);
  }

  function rawUpdateDocument(documentId: number, title: string, hash: string, modifiedAt: string): void {
    requireMountedStore().updateDocument(documentId, title, hash, modifiedAt);
  }

  function rawDeactivateDocument(collectionName: string, path: string): void {
    requireMountedStore().deactivateDocument(collectionName, path);
  }

  function rawGetDocumentWithContent(
    collectionName: string,
    path: string,
  ): { id: number; hash: string; title: string; content: string } | null {
    return requireMountedStore().getDocumentWithContent(collectionName, path);
  }

  function getEncryptionStatusSnapshot() {
    return getVaultEncryptionStatus(store.dbPath);
  }

  function stopConfiguredServices(): Promise<void> {
    stopGmailPolling();
    stopCalendarPolling();
    stopDrivePolling();
    stopContactsPolling();
    stopGitHubPolling();
    return stopBrowserService();
  }

  function restoreConfiguredServicesFromStore(): void {
    const gmailCfg = getGmailConfig();
    if (gmailCfg?.pollEnabled && gmailCfg.pollIntervalMinutes && !gmailCfg.authErrorCode) {
      startGmailPolling(gmailCfg.pollIntervalMinutes);
    }
    const calCfg = getCalendarConfig();
    if (calCfg?.pollEnabled && calCfg.pollIntervalMinutes && !calCfg.authErrorCode) {
      startCalendarPolling(calCfg.pollIntervalMinutes);
    }
    const drvCfg = getDriveConfig();
    if (drvCfg?.pollEnabled && drvCfg.pollIntervalMinutes && !drvCfg.authErrorCode) {
      startDrivePolling(drvCfg.pollIntervalMinutes);
    }
    const ctcCfg = getContactsConfig();
    if (ctcCfg?.pollEnabled && ctcCfg.pollIntervalMinutes && !ctcCfg.authErrorCode) {
      startContactsPolling(ctcCfg.pollIntervalMinutes);
    }
    const ghCfg = getGitHubConfig();
    if (ghCfg?.pollEnabled && ghCfg.pollIntervalMinutes && !ghCfg.authErrorCode) {
      startGitHubPolling(ghCfg.pollIntervalMinutes);
    }

    const browserDoc = store.getDocumentWithContent("_config", "browser.json");
    if (browserDoc?.content) {
      try {
        const browserCfg = JSON.parse(browserDoc.content) as BrowserConfig;
        setBrowserConfig(browserCfg);
        if (browserCfg.enabled) {
          startBrowserService(browserCfg).then(() => {
            log(`${ts()} browser: auto-started`);
          }).catch((err) => {
            log(`${ts()} browser: auto-start failed: ${err?.message}`);
          });
        }
      } catch {
        // Ignore invalid config at startup or unlock.
      }
    }
  }

  /**
   * insertContent → buffer content in memory (no SQLite write).
   * The content will be paired with the next insertDocument/updateDocument call.
   */
  store.insertContent = (hash: string, content: string, createdAt: string): void => {
    contentPending.set(hash, { content, createdAt });
  };

  /**
   * insertDocument → grab buffered content, enqueue full document write.
   */
  store.insertDocument = (collectionName: string, path: string, title: string, hash: string, _createdAt: string, _modifiedAt: string, origin?: string): void => {
    const buffered = contentPending.get(hash);
    if (buffered) {
      enqueueUpsert(collectionName, path, title, buffered.content, hash, origin ?? "scan");
      // Don't delete from contentPending — multiple docs may reference the same hash
    } else {
      // Content already in SQLite (e.g., re-import of unchanged file).
      // Enqueue with empty content — drain worker will use writeDocumentAtomic
      // which does INSERT OR IGNORE on content, so this is safe.
      enqueueUpsert(collectionName, path, title, "", hash, origin ?? "scan");
    }
  };

  /**
   * updateDocument → grab buffered content, look up collection/path, enqueue.
   */
  store.updateDocument = (documentId: number, title: string, hash: string, _modifiedAt: string): void => {
    let collection: string;
    let path: string;

    if (documentId <= 0) {
      // Synthetic id from getDocumentWithContent read-through — look up context hint
      const ctx = syntheticIdContext.get(documentId);
      if (ctx) {
        syntheticIdContext.delete(documentId);
        collection = ctx.collection;
        path = ctx.path;
      } else {
        // No context hint — fall back to scanning the queue index.
        // This happens if updateDocument is called with a stale synthetic id.
        log(`${ts()} write-queue: updateDocument called with synthetic id=${documentId} but no context — falling back to insertDocument via contentPending`);
        return;
      }
    } else {
      // Real SQLite id — look up collection/path from the database
      const doc = store.db.prepare(
        `SELECT collection, path FROM documents WHERE id = ?`
      ).get(documentId) as { collection: string; path: string } | undefined;
      if (!doc) {
        log(`${ts()} write-queue: updateDocument called with unknown id=${documentId}, dropping`);
        return;
      }
      collection = doc.collection;
      path = doc.path;
    }

    const buffered = contentPending.get(hash);
    if (buffered) {
      enqueueUpsert(collection, path, title, buffered.content, hash);
    } else {
      // Content already exists in SQLite. Enqueue with empty content.
      enqueueUpsert(collection, path, title, "", hash);
    }
  };

  /**
   * deactivateDocument → enqueue deactivation op.
   */
  store.deactivateDocument = (collectionName: string, path: string): void => {
    enqueueDeactivate(collectionName, path);
  };

  /**
   * getDocumentWithContent → read-through: check queue first, then SQLite.
   */
  store.getDocumentWithContent = (collectionName: string, path: string): { id: number; hash: string; title: string; content: string } | null => {
    const key = wqKey(collectionName, path);
    const queued = writeQueueIndex.get(key);
    if (queued && queued.op === "upsert" && queued.content) {
      // Assign a unique negative id and store context so updateDocument
      // can find the collection/path when it receives this synthetic id.
      const synId = nextSyntheticId--;
      syntheticIdContext.set(synId, { collection: collectionName, path });
      // Keep map bounded — clean up old entries (single-threaded, so only
      // a handful should accumulate before being consumed).
      if (syntheticIdContext.size > 100) {
        const oldest = syntheticIdContext.keys().next().value!;
        syntheticIdContext.delete(oldest);
      }
      return {
        id: synId,
        hash: queued.hash,
        title: queued.title,
        content: queued.content,
      };
    }
    if (queued && queued.op === "deactivate") {
      // Document has been deactivated in the queue
      return null;
    }
    return rawGetDocumentWithContent(collectionName, path);
  };

  // --- Drain worker ---
  // Processes queue entries one at a time, sequentially.
  // Never gives up — retries forever on any error.

  function drainOneEntry(): void {
    const entry = writeQueue.find(e => e.status === "pending");
    if (!entry) return;

    entry.status = "writing";
    try {
      if (entry.op === "upsert") {
        if (entry.content) {
          store.writeDocumentAtomic(
            entry.collection,
            entry.path,
            entry.title,
            entry.content,
            entry.hash,
            new Date().toISOString(),
            entry.origin,
          );
        } else {
          // Content already in SQLite (hash-only upsert) — use raw methods in a transaction
          const now = new Date().toISOString();
          const persistedHash = entry.hash;
          rawInsertContent(persistedHash, "", now); // INSERT OR IGNORE — no-op if exists
          const existing = store.findActiveDocument(entry.collection, entry.path);
          if (existing) {
            rawUpdateDocument(existing.id, entry.title, persistedHash, now);
          } else {
            rawInsertDocument(entry.collection, entry.path, entry.title, persistedHash, now, now, entry.origin);
          }
        }
      } else if (entry.op === "deactivate") {
        rawDeactivateDocument(entry.collection, entry.path);
      }

      // Success — remove from queue + index
      const idx = writeQueue.indexOf(entry);
      if (idx >= 0) writeQueue.splice(idx, 1);
      const key = wqKey(entry.collection, entry.path);
      if (writeQueueIndex.get(key) === entry) writeQueueIndex.delete(key);
      if (entry.collection === EDITABLE_COLLECTION) {
        if (entry.op === "upsert") {
          _pendingEditableArtifactWrites.delete(entry.path);
        } else if (entry.op === "deactivate") {
          _pendingEditableArtifactWrites.delete(entry.path);
        }
      }
      // Clean up any consumed content from the pending buffer
      if (entry.hash) contentPending.delete(entry.hash);
      writeQueueLastSuccessAt = new Date().toISOString();
    } catch (err) {
      // NEVER give up — entry stays in queue forever until it succeeds.
      // Move to back so other entries can drain while this one waits.
      entry.status = "pending";
      entry.attempts++;
      entry.error = String(err);
      writeQueueLastBlockedAt = new Date().toISOString();
      writeQueueLastBlockedPath = `${entry.collection}/${entry.path}`;
      writeQueueLastError = String(err);
      writeQueueBlockedCount++;
      // Only log first failure and then every 100th — SQLITE_BUSY retries
      // are normal during embedding and shouldn't spam the log.
      if (entry.attempts === 1 || entry.attempts % 100 === 0) {
        log(`${ts()} write-queue: drain blocked for ${entry.collection}/${entry.path} (attempt ${entry.attempts}): ${err}`);
      }
      const idx = writeQueue.indexOf(entry);
      if (idx >= 0) {
        writeQueue.splice(idx, 1);
        writeQueue.push(entry);
      }
    }
  }

  // Start drain worker — processes one entry per tick, ~20 writes/sec throughput.
  // better-sqlite3 is synchronous, so writes complete within the tick.
  const writeQueueDrainInterval = setInterval(drainOneEntry, 50);
  writeQueueDrainInterval.unref(); // Don't keep process alive just for drain

  // -----------------------------------------------------------------------
  // Gmail polling
  // -----------------------------------------------------------------------

  let gmailPollTimer: ReturnType<typeof setInterval> | null = null;
  let gmailSyncInProgress = false;
  const WORKSPACE_CONFIG_PATH = "workspace.json";
  const DEFAULT_WORKSPACE_NAME = "Your Workspace";

  function getGmailConfig(): GmailConfig | null {
    const doc = store.getDocumentWithContent("_config", "gmail.json");
    if (!doc?.content) return null;
    try {
      const config = JSON.parse(doc.content) as GmailConfig;
      return config.refreshToken ? config : null;
    } catch { return null; }
  }

  function clearAuthErrorFields(config: {
    authErrorCode?: string;
    authErrorMessage?: string;
    authErrorAt?: string;
  }): void {
    delete config.authErrorCode;
    delete config.authErrorMessage;
    delete config.authErrorAt;
  }

  function clearGmailAuthError(config: GmailConfig): void {
    clearAuthErrorFields(config);
  }

  async function saveConfigDocument(configPath: string, config: unknown, modifiedAt = new Date().toISOString()): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    const hash = await hashContent(content);
    store.insertContent(hash, content, modifiedAt);
    const existing = store.findActiveDocument("_config", configPath);
    if (existing) {
      store.updateDocument(existing.id, configPath, hash, modifiedAt);
    } else {
      store.insertDocument("_config", configPath, configPath, hash, modifiedAt, modifiedAt);
    }
  }

  async function saveGmailConfig(config: GmailConfig, modifiedAt = new Date().toISOString()): Promise<void> {
    await saveConfigDocument("gmail.json", config, modifiedAt);
  }

  function getWorkspaceConfig(): { name: string } {
    const doc = store.getDocumentWithContent("_config", WORKSPACE_CONFIG_PATH);
    if (!doc?.content) {
      return { name: DEFAULT_WORKSPACE_NAME };
    }
    try {
      const parsed = JSON.parse(doc.content) as { name?: unknown };
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim().slice(0, 40)
          : DEFAULT_WORKSPACE_NAME;
      return { name };
    } catch {
      return { name: DEFAULT_WORKSPACE_NAME };
    }
  }

  function isOAuthInvalidGrantError(err: unknown): boolean {
    const anyErr = err as any;
    const message = String(anyErr?.message || err || "");
    const code = String(anyErr?.code || "");
    const responseError = String(anyErr?.response?.data?.error || "");
    const responseDescription = String(anyErr?.response?.data?.error_description || "");
    return [message, code, responseError, responseDescription].some((value) =>
      value.toLowerCase().includes("invalid_grant"),
    );
  }

  function isGmailInvalidGrantError(err: unknown): boolean {
    return isOAuthInvalidGrantError(err);
  }

  async function markGoogleConnectionAuthError(params: {
    config: {
      accessToken?: string;
      accessTokenExpiry?: string;
      authErrorCode?: string;
      authErrorMessage?: string;
      authErrorAt?: string;
    };
    configPath: string;
    stopPolling: () => void;
    logLabel: string;
    rawError: unknown;
    userMessage: string;
  }): Promise<void> {
    const when = new Date().toISOString();
    delete params.config.accessToken;
    delete params.config.accessTokenExpiry;
    params.config.authErrorCode = "invalid_grant";
    params.config.authErrorMessage = params.userMessage;
    params.config.authErrorAt = when;
    await saveConfigDocument(params.configPath, params.config, when);
    params.stopPolling();
    const rawMessage = String((params.rawError as any)?.message || params.rawError || "invalid_grant");
    log(`${ts()} ${params.logLabel} auth disabled after invalid_grant: ${rawMessage}`);
  }

  async function markGmailAuthError(config: GmailConfig, err: unknown): Promise<void> {
    await markGoogleConnectionAuthError({
      config,
      configPath: "gmail.json",
      stopPolling: stopGmailPolling,
      logLabel: "gmail",
      rawError: err,
      userMessage: "Gmail authorization expired or was revoked. Reconnect Gmail.",
    });
  }

  async function runGmailPollSync(): Promise<void> {
    if (gmailSyncInProgress) return;
    gmailSyncInProgress = true;
    let config: GmailConfig | null = null;
    try {
      config = getGmailConfig();
      if (!config || !config.pollEnabled || config.authErrorCode) {
        stopGmailPolling();
        return;
      }
      const result = await runGmailSync({
        config,
        documentExists: (collection, path) => !!store.findActiveDocument(collection, path),
        upsertDocument: async (collection, path, content, title) => {
          const now = new Date().toISOString();
          const hash = await hashContent(content);
          const existing = store.findActiveDocument(collection, path);
          if (existing) {
            const prev = store.getDocumentWithContent(collection, path);
            if (prev && prev.hash === hash) return;
            store.insertContent(hash, content, now);
            store.updateDocument(existing.id, title, hash, now);
          } else {
            store.insertContent(hash, content, now);
            store.insertDocument(collection, path, title, hash, now, now);
          }
        },
      });
      // Update lastSync timestamp
      clearGmailAuthError(config);
      config.lastSync = new Date().toISOString();
      await saveGmailConfig(config, config.lastSync);

      appendAuditEntry(store, "gmail", {
        timestamp: new Date().toISOString(),
        toolName: "gmail_poll",
        action: "sync",
        verdict: "allowed",
        reason: `Poll sync: imported=${result.imported} skipped=${result.skipped} total=${result.total}`,
        severity: "low",
        details: { imported: result.imported, skipped: result.skipped, total: result.total },
      }).catch(() => {});

      handleImportedItemsNotification("gmail", {
        imported: result.imported,
        total: result.total,
        items: result.importedItems,
      }, "gmail poll");
    } catch (err: any) {
      if (config && isGmailInvalidGrantError(err)) {
        await markGmailAuthError(config, err);
        appendAuditEntry(store, "gmail", {
          timestamp: new Date().toISOString(),
          toolName: "gmail_poll",
          action: "sync",
          verdict: "error",
          reason: "Auth error: invalid_grant",
          severity: "high",
        }).catch(() => {});
        return;
      }
      log(`${ts()} gmail poll ERROR: ${err?.message}`);
      appendAuditEntry(store, "gmail", {
        timestamp: new Date().toISOString(),
        toolName: "gmail_poll",
        action: "sync",
        verdict: "error",
        reason: err?.message || "Poll sync failed",
        severity: "high",
      }).catch(() => {});
    } finally {
      gmailSyncInProgress = false;
    }
  }

  function startGmailPolling(intervalMinutes: number): void {
    stopGmailPolling();
    const ms = intervalMinutes * 60_000;
    gmailPollTimer = setInterval(runGmailPollSync, ms);
    gmailPollTimer.unref?.();
    log(`${ts()} gmail polling started: every ${intervalMinutes}m`);
  }

  function stopGmailPolling(): void {
    if (gmailPollTimer) {
      clearInterval(gmailPollTimer);
      gmailPollTimer = null;
      log(`${ts()} gmail polling stopped`);
    }
  }

  // -----------------------------------------------------------------------
  // Calendar polling
  // -----------------------------------------------------------------------

  let calendarPollTimer: ReturnType<typeof setInterval> | null = null;
  let calendarSyncInProgress = false;

  function getCalendarConfig(): CalendarConfig | null {
    const doc = store.getDocumentWithContent("_config", "gcalendar.json");
    if (!doc?.content) return null;
    try {
      const config = JSON.parse(doc.content) as CalendarConfig;
      return config.refreshToken ? config : null;
    } catch { return null; }
  }

  async function saveCalendarConfig(config: CalendarConfig, modifiedAt = new Date().toISOString()): Promise<void> {
    await saveConfigDocument("gcalendar.json", config, modifiedAt);
  }

  async function markCalendarAuthError(config: CalendarConfig, err: unknown): Promise<void> {
    await markGoogleConnectionAuthError({
      config,
      configPath: "gcalendar.json",
      stopPolling: stopCalendarPolling,
      logLabel: "calendar",
      rawError: err,
      userMessage: "Google Calendar authorization expired or was revoked. Reconnect Google Calendar.",
    });
  }

  async function runCalendarPollSync(): Promise<void> {
    if (calendarSyncInProgress) return;
    calendarSyncInProgress = true;
    let config: CalendarConfig | null = null;
    try {
      config = getCalendarConfig();
      if (!config || !config.pollEnabled || config.authErrorCode) {
        stopCalendarPolling();
        return;
      }
      const result = await runCalendarSync({
        config,
        documentExists: (collection, path) => !!store.findActiveDocument(collection, path),
        upsertDocument: async (collection, path, content, title) => {
          const now = new Date().toISOString();
          const hash = await hashContent(content);
          const existing = store.findActiveDocument(collection, path);
          if (existing) {
            const prev = store.getDocumentWithContent(collection, path);
            if (prev && prev.hash === hash) return false; // unchanged
            store.insertContent(hash, content, now);
            store.updateDocument(existing.id, title, hash, now);
            return true;
          }
          store.insertContent(hash, content, now);
          store.insertDocument(collection, path, title, hash, now, now);
          return true;
        },
      });

      // Check if sync caught an auth error internally (swallowed into result.errors)
      const authErr = result.errors.find((e: string) => e.toLowerCase().includes("invalid_grant"));
      if (authErr && config) {
        await markCalendarAuthError(config, new Error(authErr));
        appendAuditEntry(store, "gcalendar", {
          timestamp: new Date().toISOString(),
          toolName: "gcalendar_poll",
          action: "sync",
          verdict: "error",
          reason: "Auth error: invalid_grant",
          severity: "high",
        }).catch(() => {});
        return;
      }

      appendAuditEntry(store, "gcalendar", {
        timestamp: new Date().toISOString(),
        toolName: "gcalendar_poll",
        action: "sync",
        verdict: "allowed",
        reason: `Poll sync: imported=${result.imported}`,
        severity: "low",
        details: { imported: result.imported },
      }).catch(() => {});

      handleImportedItemsNotification("gcalendar", {
        imported: result.imported,
        total: result.total,
        items: result.importedItems,
      }, "calendar poll");

      // Update lastSync
      clearAuthErrorFields(config);
      config.lastSync = new Date().toISOString();
      await saveCalendarConfig(config, config.lastSync);
    } catch (err: any) {
      if (config && isOAuthInvalidGrantError(err)) {
        await markCalendarAuthError(config, err);
        appendAuditEntry(store, "gcalendar", {
          timestamp: new Date().toISOString(),
          toolName: "gcalendar_poll",
          action: "sync",
          verdict: "error",
          reason: "Auth error: invalid_grant",
          severity: "high",
        }).catch(() => {});
        return;
      }
      log(`${ts()} calendar poll ERROR: ${err?.message}`);
      appendAuditEntry(store, "gcalendar", {
        timestamp: new Date().toISOString(),
        toolName: "gcalendar_poll",
        action: "sync",
        verdict: "error",
        reason: err?.message || "Poll sync failed",
        severity: "high",
      }).catch(() => {});
    } finally {
      calendarSyncInProgress = false;
    }
  }

  function startCalendarPolling(intervalMinutes: number): void {
    stopCalendarPolling();
    const ms = intervalMinutes * 60_000;
    calendarPollTimer = setInterval(runCalendarPollSync, ms);
    calendarPollTimer.unref?.();
    log(`${ts()} calendar polling started: every ${intervalMinutes}m`);
  }

  function stopCalendarPolling(): void {
    if (calendarPollTimer) {
      clearInterval(calendarPollTimer);
      calendarPollTimer = null;
      log(`${ts()} calendar polling stopped`);
    }
  }

  // -----------------------------------------------------------------------
  // Drive polling (no notifications — just auto-sync)
  // -----------------------------------------------------------------------

  let drivePollTimer: ReturnType<typeof setInterval> | null = null;
  let driveSyncInProgress = false;

  function getDriveConfig(): DriveConfig | null {
    const doc = store.getDocumentWithContent("_config", "gdrive.json");
    if (!doc?.content) return null;
    try {
      const config = JSON.parse(doc.content) as DriveConfig;
      return config.refreshToken ? config : null;
    } catch { return null; }
  }

  async function saveDriveConfig(config: DriveConfig, modifiedAt = new Date().toISOString()): Promise<void> {
    await saveConfigDocument("gdrive.json", config, modifiedAt);
  }

  async function markDriveAuthError(config: DriveConfig, err: unknown): Promise<void> {
    await markGoogleConnectionAuthError({
      config,
      configPath: "gdrive.json",
      stopPolling: stopDrivePolling,
      logLabel: "drive",
      rawError: err,
      userMessage: "Google Drive authorization expired or was revoked. Reconnect Google Drive.",
    });
  }

  async function runDrivePollSync(): Promise<void> {
    if (driveSyncInProgress) return;
    driveSyncInProgress = true;
    let config: DriveConfig | null = null;
    try {
      config = getDriveConfig();
      if (!config || !config.pollEnabled || config.authErrorCode) {
        stopDrivePolling();
        return;
      }
      const result = await runDriveSync({
        config,
        documentExists: (collection, path) => !!store.findActiveDocument(collection, path),
        upsertDocument: async (collection, path, content, title) => {
          const now = new Date().toISOString();
          const hash = await hashContent(content);
          const existing = store.findActiveDocument(collection, path);
          if (existing) {
            const prev = store.getDocumentWithContent(collection, path);
            if (prev && prev.hash === hash) return false;
            store.insertContent(hash, content, now);
            store.updateDocument(existing.id, title, hash, now);
            return true;
          }
          store.insertContent(hash, content, now);
          store.insertDocument(collection, path, title, hash, now, now, "gdrive");
          return true;
        },
        saveAsset: async (path, binary, mimeType) => {
          await writeArtifact(store, path, binary, { mimeType, originalName: path.split("/").pop() });
        },
      });
      appendAuditEntry(store, "gdrive", {
        timestamp: new Date().toISOString(),
        toolName: "gdrive_poll",
        action: "sync",
        verdict: "allowed",
        reason: `Poll sync: imported=${result.imported}`,
        severity: "low",
        details: { imported: result.imported },
      }).catch(() => {});

      if (result.imported > 0) {
        startBackgroundEmbed({ trigger: "drive-poll" });
        log(`${ts()} drive poll: imported ${result.imported} new/updated files`);
      } else {
        log(`${ts()} drive poll: no new files`);
      }

      // Update lastSync
      clearAuthErrorFields(config);
      config.lastSync = new Date().toISOString();
      await saveDriveConfig(config, config.lastSync);
    } catch (err: any) {
      if (config && isOAuthInvalidGrantError(err)) {
        await markDriveAuthError(config, err);
        appendAuditEntry(store, "gdrive", {
          timestamp: new Date().toISOString(),
          toolName: "gdrive_poll",
          action: "sync",
          verdict: "error",
          reason: "Auth error: invalid_grant",
          severity: "high",
        }).catch(() => {});
        return;
      }
      log(`${ts()} drive poll ERROR: ${err?.message}`);
      appendAuditEntry(store, "gdrive", {
        timestamp: new Date().toISOString(),
        toolName: "gdrive_poll",
        action: "sync",
        verdict: "error",
        reason: err?.message || "Poll sync failed",
        severity: "high",
      }).catch(() => {});
    } finally {
      driveSyncInProgress = false;
    }
  }

  function startDrivePolling(intervalMinutes: number): void {
    stopDrivePolling();
    const ms = intervalMinutes * 60_000;
    drivePollTimer = setInterval(runDrivePollSync, ms);
    drivePollTimer.unref?.();
    log(`${ts()} drive polling started: every ${intervalMinutes}m`);
  }

  function stopDrivePolling(): void {
    if (drivePollTimer) {
      clearInterval(drivePollTimer);
      drivePollTimer = null;
      log(`${ts()} drive polling stopped`);
    }
  }

  // -----------------------------------------------------------------------
  // Contacts polling (no notifications — just auto-sync)
  // -----------------------------------------------------------------------

  let contactsPollTimer: ReturnType<typeof setInterval> | null = null;
  let contactsSyncInProgress = false;

  function getContactsConfig(): ContactsConfig | null {
    const doc = store.getDocumentWithContent("_config", "gcontacts.json");
    if (!doc?.content) return null;
    try {
      const config = JSON.parse(doc.content) as ContactsConfig;
      return config.refreshToken ? config : null;
    } catch { return null; }
  }

  async function saveContactsConfig(config: ContactsConfig, modifiedAt = new Date().toISOString()): Promise<void> {
    await saveConfigDocument("gcontacts.json", config, modifiedAt);
  }

  async function markContactsAuthError(config: ContactsConfig, err: unknown): Promise<void> {
    await markGoogleConnectionAuthError({
      config,
      configPath: "gcontacts.json",
      stopPolling: stopContactsPolling,
      logLabel: "contacts",
      rawError: err,
      userMessage: "Google Contacts authorization expired or was revoked. Reconnect Google Contacts.",
    });
  }

  async function runContactsPollSync(): Promise<void> {
    if (contactsSyncInProgress) return;
    contactsSyncInProgress = true;
    let config: ContactsConfig | null = null;
    try {
      config = getContactsConfig();
      if (!config || !config.pollEnabled || config.authErrorCode) {
        stopContactsPolling();
        return;
      }
      const result = await runContactsSync({
        config,
        documentExists: (collection, path) => !!store.findActiveDocument(collection, path),
        upsertDocument: async (collection, path, content, title) => {
          const now = new Date().toISOString();
          const hash = await hashContent(content);
          const existing = store.findActiveDocument(collection, path);
          if (existing) {
            const prev = store.getDocumentWithContent(collection, path);
            if (prev && prev.hash === hash) return false;
            store.insertContent(hash, content, now);
            store.updateDocument(existing.id, title, hash, now);
            return true;
          }
          store.insertContent(hash, content, now);
          store.insertDocument(collection, path, title, hash, now, now);
          return true;
        },
      });

      // Check if sync caught an auth error internally (swallowed into result.errors)
      const authErr = result.errors.find((e: string) => e.toLowerCase().includes("invalid_grant"));
      if (authErr && config) {
        await markContactsAuthError(config, new Error(authErr));
        return;
      }

      if (result.imported > 0) {
        startBackgroundEmbed({ trigger: "contacts-poll" });
        log(`${ts()} contacts poll: imported ${result.imported} new/updated contacts`);
      } else {
        log(`${ts()} contacts poll: no new contacts`);
      }

      // Update lastSync
      clearAuthErrorFields(config);
      config.lastSync = new Date().toISOString();
      await saveContactsConfig(config, config.lastSync);
    } catch (err: any) {
      if (config && isOAuthInvalidGrantError(err)) {
        await markContactsAuthError(config, err);
        return;
      }
      log(`${ts()} contacts poll ERROR: ${err?.message}`);
    } finally {
      contactsSyncInProgress = false;
    }
  }

  function startContactsPolling(intervalMinutes: number): void {
    stopContactsPolling();
    const ms = intervalMinutes * 60_000;
    contactsPollTimer = setInterval(runContactsPollSync, ms);
    contactsPollTimer.unref?.();
    log(`${ts()} contacts polling started: every ${intervalMinutes}m`);
  }

  function stopContactsPolling(): void {
    if (contactsPollTimer) {
      clearInterval(contactsPollTimer);
      contactsPollTimer = null;
      log(`${ts()} contacts polling stopped`);
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub connection — config helpers & polling
  // ---------------------------------------------------------------------------

  let githubPollTimer: ReturnType<typeof setInterval> | null = null;
  let githubSyncInProgress = false;

  function getGitHubConfig(): GitHubConfig | null {
    const doc = store.getDocumentWithContent("_config", "github.json");
    if (!doc?.content) return null;
    try {
      const config = JSON.parse(doc.content) as GitHubConfig;
      return config.accessToken ? config : null;
    } catch {
      return null;
    }
  }

  async function saveGitHubConfig(config: GitHubConfig, modifiedAt?: string): Promise<void> {
    await saveConfigDocument("github.json", config, modifiedAt);
  }

  async function runGitHubPollSync(): Promise<void> {
    if (githubSyncInProgress) return;
    githubSyncInProgress = true;
    try {
      const config = getGitHubConfig();
      if (!config) return;
      if (config.authErrorCode) return;

      const result = await runGitHubSync({
        config,
        upsertDocument: async (collection, path, content, title) => {
          const now = new Date().toISOString();
          const hash = await hashContent(content);
          const existing = store.findActiveDocument(collection, path);
          if (existing) {
            const prev = store.getDocumentWithContent(collection, path);
            if (prev && prev.hash === hash) return;
            store.insertContent(hash, content, now);
            store.updateDocument(existing.id, title, hash, now);
          } else {
            store.insertContent(hash, content, now);
            store.insertDocument(collection, path, title, hash, now, now);
          }
        },
      });

      if (result.imported > 0) {
        log(`${ts()} github poll: synced ${result.imported} repos to ~/.straja/repos/`);
      } else {
        log(`${ts()} github poll: no changes`);
      }

      clearGitHubAuthError(config);
      config.lastSync = new Date().toISOString();
      await saveGitHubConfig(config, config.lastSync);

      appendAuditEntry(store, "github", {
        timestamp: new Date().toISOString(),
        toolName: "github_poll",
        action: "sync",
        verdict: "allowed",
        reason: `Poll sync: imported=${result.imported} skipped=${result.skipped}`,
        severity: "low",
        details: { imported: result.imported, skipped: result.skipped, total: result.total },
      }).catch(() => {});
    } catch (err: any) {
      if (isGitHubAuthError(err)) {
        const config = getGitHubConfig();
        if (config) {
          markGitHubAuthError(config);
          await saveGitHubConfig(config);
          stopGitHubPolling();
        }
        return;
      }
      log(`${ts()} github poll ERROR: ${err?.message}`);
    } finally {
      githubSyncInProgress = false;
    }
  }

  function startGitHubPolling(intervalMinutes: number): void {
    stopGitHubPolling();
    const ms = intervalMinutes * 60_000;
    githubPollTimer = setInterval(runGitHubPollSync, ms);
    githubPollTimer.unref?.();
    log(`${ts()} github polling started: every ${intervalMinutes}m`);
  }

  function stopGitHubPolling(): void {
    if (githubPollTimer) {
      clearInterval(githubPollTimer);
      githubPollTimer = null;
      log(`${ts()} github polling stopped`);
    }
  }

  configureAutoEmbedRuntime({
    log: (message) => log(`${ts()} ${message}`),
    getAdmission: () => {
      const writeQueueStats = getWriteQueueStats();
      if (writeQueueStats.entries > 0) {
        return {
          ok: false,
          reason: `write queue pending (${writeQueueStats.entries} entries)`,
          retryMs: 5_000,
        };
      }
      if (writeQueueStats.lastBlockedAt) {
        const lastBlockedMs = Date.now() - Date.parse(writeQueueStats.lastBlockedAt);
        if (Number.isFinite(lastBlockedMs) && lastBlockedMs < 15_000) {
          return {
            ok: false,
            reason: `write queue recently blocked (${lastBlockedMs}ms ago)`,
            retryMs: 5_000,
          };
        }
      }
      const activeSyncs = [
        gmailSyncInProgress ? "gmail" : null,
        calendarSyncInProgress ? "calendar" : null,
        driveSyncInProgress ? "gdrive" : null,
        contactsSyncInProgress ? "gcontacts" : null,
        githubSyncInProgress ? "github" : null,
      ].filter((value): value is string => Boolean(value));
      if (activeSyncs.length > 0) {
        return {
          ok: false,
          reason: `connector sync active (${activeSyncs.join(", ")})`,
          retryMs: 10_000,
        };
      }
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // Agent connections — config helpers & notification dispatch
  // ---------------------------------------------------------------------------

  type AgentVaultAccessScope =
    | "vault.read"
    | "vault.write"
    | "exec.run"
    | "exec.manage"
    | "repo-exec.run"
    | "integrations.use"
    | "secrets.read"
    | "secrets.write"
    | "audit.append";

  interface AgentVaultAccessConfig {
    enabled: boolean;
    tokenHash: string;
    tokenPreview: string;
    scopes: AgentVaultAccessScope[];
    createdAt: string;
    lastRotatedAt: string;
    lastSeenAt?: string;
  }

  type AgentProfileId =
    | "chief-of-staff"
    | "software-engineer"
    | "researcher"
    | "marketing-expert"
    | "community-manager"
    | "customer-service"
    | "sales-assistant"
    | "operations-admin"
    | "custom";
  type AgentMemoryPromptInjectionMode = "off" | "new_sessions" | "always";
  type AgentModelRoutingPolicy = "local_only" | "cloud_only" | "hybrid";
  const DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE: AgentMemoryPromptInjectionMode = "always";

  interface AgentRoutingProfileConfig {
    purpose?: string;
    primaryDomains?: string[];
    preferredTaskTypes?: string[];
    forbiddenTaskTypes?: string[];
    toolFamiliesAvailable?: string[];
    shortExamples?: string[];
  }

  interface AgentConnectionConfig {
    id: string;
    name: string;
    type: "openclaw" | "mcp" | "custom";
    gatewayUrl: string;
    token: string;
    /** Separate token for gateway WebSocket auth (falls back to `token` if unset). */
    gatewayToken?: string;
    hooksPath: string;
    enabled: boolean;
    notifications: { gmail: boolean; gcalendar: boolean };
    lastNotified?: string;
    lastError?: string;
    vaultAccess?: AgentVaultAccessConfig;
    openclawConfigPath?: string;
    /** Agent profile — determines tool scoping and execution model. */
    profile?: AgentProfileId;
    /** Extra domains the SE agent may reach (merged with default allowlist). */
    networkAllowlist?: string[];
    /** Explicit tool list for custom profiles (written as alsoAllow to openclaw.json). */
    customTools?: string[];
    /** Optional per-agent primary model (provider/model). */
    model?: string;
    /** Optional ordered per-agent fallback models (provider/model). */
    modelFallbacks?: string[];
    /** How this agent should treat local vs cloud candidates. */
    modelPolicy?: AgentModelRoutingPolicy;
    /** How the vault plugin injects persistent memory into prompts. */
    memoryPromptInjectionMode?: AgentMemoryPromptInjectionMode;
    /** Router-facing metadata describing what this agent should own. */
    routingProfile?: AgentRoutingProfileConfig;
    /** Concrete delivery targets for the agent owner, keyed by channel (e.g. telegram -> telegram:5232990709). */
    ownerTargets?: Record<string, string>;
  }

  /** All SE agent repos must live under this base directory. */
  const REPOS_BASE_DIR = resolve(homedir(), ".straja", "repos");

  /** Default network domains allowed for software-engineer exec proxy. */
  const SE_DEFAULT_NETWORK_ALLOWLIST = [
    "github.com",
    "api.github.com",
    "registry.npmjs.org",
    "pypi.org",
    "files.pythonhosted.org",
  ];

  const PROFILE_TOOL_GROUPS: Record<string, string[]> = USER_FACING_TOOL_GROUPS;
  const CHIEF_OF_STAFF_DENYLIST_SET = new Set<string>(CHIEF_OF_STAFF_DENYLIST);
  const ROUTING_TOOL_FAMILIES = [
    "general",
    "coding",
    "research",
    "email",
    "presentation",
    "local_automation",
  ] as const;

  const SOFTWARE_ENGINEER_TOOLS = [
    "vault_repo_exec",
    "vault_repos_list",
    "vault_process",
    "vault_github_create_issue",
    "vault_github_list_issues",
    "vault_github_create_branch",
    "vault_github_create_pr",
    "vault_github_list_prs",
    "vault_github_push",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "session_status",
  ];

  function pickProfileTools(groupNames: string[]): string[] {
    return Array.from(
      new Set(
        groupNames.flatMap((groupName) => PROFILE_TOOL_GROUPS[groupName] ?? []),
      ),
    );
  }

  function sanitizeRoutingList(value: string[] | undefined): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  function sanitizeAgentRoutingProfile(
    value: unknown,
    fallback?: AgentRoutingProfileConfig,
  ): AgentRoutingProfileConfig | undefined {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    const purpose = typeof raw?.purpose === "string" ? raw.purpose.trim() : "";
    const next: AgentRoutingProfileConfig = {
      purpose: purpose || fallback?.purpose,
      primaryDomains: sanitizeRoutingList(raw?.primaryDomains as string[] | undefined) ?? fallback?.primaryDomains,
      preferredTaskTypes:
        sanitizeRoutingList(raw?.preferredTaskTypes as string[] | undefined) ?? fallback?.preferredTaskTypes,
      forbiddenTaskTypes:
        sanitizeRoutingList(raw?.forbiddenTaskTypes as string[] | undefined) ?? fallback?.forbiddenTaskTypes,
      toolFamiliesAvailable:
        sanitizeRoutingList(raw?.toolFamiliesAvailable as string[] | undefined) ?? fallback?.toolFamiliesAvailable,
      shortExamples:
        sanitizeRoutingList(raw?.shortExamples as string[] | undefined) ?? fallback?.shortExamples,
    };
    if (
      !next.purpose &&
      !next.primaryDomains?.length &&
      !next.preferredTaskTypes?.length &&
      !next.forbiddenTaskTypes?.length &&
      !next.toolFamiliesAvailable?.length &&
      !next.shortExamples?.length
    ) {
      return undefined;
    }
    return next;
  }

  type AgentProfileDefinitionConfig = {
    id: AgentProfileId;
    label: string;
    defaultName: string;
    description: string;
    capabilities: string[];
    toolGroups: string[];
    routingProfile?: AgentRoutingProfileConfig;
    requiresRepo?: boolean;
    allowsNetwork?: boolean;
    defaultNetworkAllowlist?: string[];
    reposBaseDir?: string;
  };

  const PROFILE_DEFINITIONS: Record<AgentProfileId, AgentProfileDefinitionConfig> = {
    "chief-of-staff": {
      id: "chief-of-staff",
      label: "Chief of Staff",
      defaultName: "Straja Chief of Staff",
      description: "Business coordination, planning, communication, and cross-functional execution.",
      capabilities: [
        "Planning, triage, and next-step coordination",
        "Research synthesis, briefs, and summaries",
        "Emails, presentations, and general business operations",
      ],
      toolGroups: Object.keys(USER_FACING_TOOL_GROUPS).filter((group) => group !== "Developer"),
      routingProfile: {
        purpose: "Business coordinator and general operator for planning, communication, and cross-functional execution.",
        primaryDomains: ["strategy", "planning", "operations", "communication", "research synthesis"],
        preferredTaskTypes: [
          "summarize threads and documents",
          "prioritize work",
          "draft briefs and emails",
          "route business requests",
          "prepare research summaries",
        ],
        forbiddenTaskTypes: [
          "code changes",
          "repo debugging",
          "deep technical implementation",
        ],
        toolFamiliesAvailable: [...ROUTING_TOOL_FAMILIES].filter((value) => value !== "coding"),
        shortExamples: [
          "Summarize this conversation and recommend next steps",
          "Draft a partner follow-up email",
          "Prepare a short briefing on this company",
        ],
      },
    },
    "software-engineer": {
      id: "software-engineer",
      label: "Software Engineer",
      defaultName: "Straja Engineer",
      description: "Repo-focused coding with real git, npm, and build tools. Works against an attached local repository.",
      capabilities: [
        "Repo execution (git, npm, build, test)",
        "GitHub (issues, PRs, push)",
        "Technical debugging and implementation",
      ],
      toolGroups: ["Developer", "Sessions", "Memory", "Vault Search & Read", "Messaging"],
      routingProfile: {
        purpose: "Technical implementation and debugging specialist for software systems, repos, and integrations.",
        primaryDomains: ["coding", "debugging", "repositories", "integrations", "technical analysis"],
        preferredTaskTypes: [
          "fix bugs",
          "write code",
          "inspect logs",
          "refactor code",
          "implement features",
        ],
        forbiddenTaskTypes: [
          "customer messaging",
          "marketing planning",
          "business strategy",
          "policy drafting",
        ],
        toolFamiliesAvailable: ["coding", "research", "general"],
        shortExamples: [
          "Fix this TypeScript error",
          "Implement a Telegram integration",
          "Review this code path and explain the bug",
        ],
      },
      requiresRepo: true,
      allowsNetwork: true,
      defaultNetworkAllowlist: SE_DEFAULT_NETWORK_ALLOWLIST,
      reposBaseDir: REPOS_BASE_DIR,
    },
    "researcher": {
      id: "researcher",
      label: "Researcher",
      defaultName: "Straja Researcher",
      description: "Research, comparison, SEO, and source-backed synthesis for decisions.",
      capabilities: [
        "Competitor and market analysis",
        "SEO and keyword research",
        "Source-backed research briefs",
      ],
      toolGroups: ["Memory", "Web", "Vault Search & Read", "Collections & Artifacts", "Messaging"],
      routingProfile: {
        purpose: "Information gathering and synthesis specialist for market, SEO, and competitive research.",
        primaryDomains: ["research", "seo", "competition", "market intelligence", "source synthesis"],
        preferredTaskTypes: [
          "research competitors",
          "compare vendors",
          "summarize sources",
          "analyze keywords",
          "prepare research briefs",
        ],
        forbiddenTaskTypes: [
          "direct customer replies",
          "code changes",
          "contract drafting",
        ],
        toolFamiliesAvailable: ["research", "general", "presentation"],
        shortExamples: [
          "Compare three competitors in this market",
          "Find relevant SEO keywords for this niche",
          "Summarize what we know about this company",
        ],
      },
    },
    "marketing-expert": {
      id: "marketing-expert",
      label: "Marketing Expert",
      defaultName: "Straja Marketing Expert",
      description: "Campaign planning, positioning, messaging, and content strategy.",
      capabilities: [
        "Campaign and launch planning",
        "Messaging, positioning, and content calendars",
        "Email and offer strategy",
      ],
      toolGroups: ["Memory", "Web", "Vault Search & Read", "Collections & Artifacts", "Gmail", "Messaging"],
      routingProfile: {
        purpose: "Marketing planner for campaigns, messaging, offers, and audience-facing content strategy.",
        primaryDomains: ["marketing", "campaigns", "messaging", "content", "growth"],
        preferredTaskTypes: [
          "plan campaigns",
          "write landing-page copy",
          "outline email sequences",
          "draft content ideas",
          "prepare launch messaging",
        ],
        forbiddenTaskTypes: [
          "debugging code",
          "customer complaint resolution",
          "legal interpretation",
        ],
        toolFamiliesAvailable: ["general", "email", "research", "presentation"],
        shortExamples: [
          "Plan a two-week launch campaign",
          "Draft homepage messaging for this offer",
          "Outline a weekly email nurture sequence",
        ],
      },
    },
    "community-manager": {
      id: "community-manager",
      label: "Community Manager",
      defaultName: "Straja Community Manager",
      description: "Community-facing communication, moderation, and feedback handling.",
      capabilities: [
        "Reply to community messages and comments",
        "Summarize feedback and escalate issues",
        "Draft lightweight announcements and updates",
      ],
      toolGroups: ["Memory", "Vault Search & Read", "Collections & Artifacts", "Gmail", "Messaging"],
      routingProfile: {
        purpose: "Community communication specialist for member engagement, moderation, and feedback loops.",
        primaryDomains: ["community", "messaging", "engagement", "moderation", "feedback"],
        preferredTaskTypes: [
          "reply to community messages",
          "summarize feedback",
          "draft short announcements",
          "escalate issues to owner",
        ],
        forbiddenTaskTypes: [
          "engineering work",
          "financial operations",
          "deep research projects",
        ],
        toolFamiliesAvailable: ["local_automation", "general", "email"],
        shortExamples: [
          "Reply politely to this inbound community message",
          "Summarize the top community concerns this week",
          "Draft a short update for the group",
        ],
      },
    },
    "customer-service": {
      id: "customer-service",
      label: "Customer Service",
      defaultName: "Straja Customer Service",
      description: "Customer-facing support communication, issue triage, and resolution drafting.",
      capabilities: [
        "Reply to support questions and complaints",
        "Clarify missing info and summarize cases",
        "Draft empathetic, operationally safe replies",
      ],
      toolGroups: ["Memory", "Vault Search & Read", "Collections & Artifacts", "Gmail", "Messaging"],
      routingProfile: {
        purpose: "Customer support specialist for handling customer questions, triage, and resolution communication.",
        primaryDomains: ["support", "customer communication", "issue triage", "faq", "resolution"],
        preferredTaskTypes: [
          "answer support questions",
          "summarize issues",
          "request missing info",
          "draft customer replies",
        ],
        forbiddenTaskTypes: [
          "product strategy",
          "code changes",
          "legal conclusions",
        ],
        toolFamiliesAvailable: ["local_automation", "general", "email"],
        shortExamples: [
          "Reply to this customer complaint",
          "Classify this support request",
          "Draft a polite resolution email",
        ],
      },
    },
    "sales-assistant": {
      id: "sales-assistant",
      label: "Sales Assistant",
      defaultName: "Straja Sales Assistant",
      description: "Sales follow-ups, outreach, lead qualification, and proposal support.",
      capabilities: [
        "Lead qualification and follow-up drafting",
        "Sales outreach and proposal preparation",
        "Prospect research and CRM hygiene support",
      ],
      toolGroups: ["Memory", "Web", "Vault Search & Read", "Collections & Artifacts", "Gmail", "Calendar", "Messaging"],
      routingProfile: {
        purpose: "Sales and outreach specialist for prospect follow-ups, proposals, and lead movement.",
        primaryDomains: ["sales", "outreach", "lead qualification", "follow-up", "proposals"],
        preferredTaskTypes: [
          "draft outreach",
          "write follow-up emails",
          "summarize prospects",
          "prepare proposal outlines",
        ],
        forbiddenTaskTypes: [
          "support resolution",
          "code changes",
          "bookkeeping",
        ],
        toolFamiliesAvailable: ["email", "general", "research", "presentation"],
        shortExamples: [
          "Draft a follow-up after this sales call",
          "Summarize this prospect and next step",
          "Prepare a proposal outline for this lead",
        ],
      },
    },
    "operations-admin": {
      id: "operations-admin",
      label: "Operations Admin",
      defaultName: "Straja Operations Admin",
      description: "Structured admin work, spreadsheets, records, and routine internal operations.",
      capabilities: [
        "Update trackers, notes, and spreadsheets",
        "Create records and perform routine admin workflows",
        "Coordinate operational follow-up and notifications",
      ],
      toolGroups: ["Memory", "Vault Search & Read", "Collections & Artifacts", "Vault Write", "Calendar", "Gmail", "Messaging", "Automation"],
      routingProfile: {
        purpose: "Structured operations specialist for repetitive internal admin, spreadsheets, and record maintenance.",
        primaryDomains: ["operations", "admin", "spreadsheets", "records", "internal processes"],
        preferredTaskTypes: [
          "update spreadsheets",
          "maintain records",
          "create routine notes",
          "run deterministic admin workflows",
        ],
        forbiddenTaskTypes: [
          "business strategy",
          "engineering work",
          "open-ended creative writing",
        ],
        toolFamiliesAvailable: ["local_automation", "general", "email"],
        shortExamples: [
          "Update the tracker and notify the owner",
          "Create a note for this request",
          "Record this absence in the spreadsheet",
        ],
      },
    },
    "custom": {
      id: "custom",
      label: "Custom",
      defaultName: "Straja Custom",
      description: "Manually select which tools this agent can use.",
      capabilities: [],
      toolGroups: [],
    },
  };

  /** Explicit tool allow-lists per vault profile (written to openclaw.json as alsoAllow). */
  const PROFILE_ALSO_ALLOW: Record<AgentProfileId, string[] | null> = {
    "software-engineer": SOFTWARE_ENGINEER_TOOLS,
    "chief-of-staff": ALL_KNOWN_TOOLS.filter((tool) => !CHIEF_OF_STAFF_DENYLIST_SET.has(tool)),
    "researcher": pickProfileTools(PROFILE_DEFINITIONS["researcher"].toolGroups),
    "marketing-expert": pickProfileTools(PROFILE_DEFINITIONS["marketing-expert"].toolGroups),
    "community-manager": pickProfileTools(PROFILE_DEFINITIONS["community-manager"].toolGroups),
    "customer-service": pickProfileTools(PROFILE_DEFINITIONS["customer-service"].toolGroups),
    "sales-assistant": pickProfileTools(PROFILE_DEFINITIONS["sales-assistant"].toolGroups),
    "operations-admin": pickProfileTools(PROFILE_DEFINITIONS["operations-admin"].toolGroups),
    "custom": null,
  };

  /** Cross-agent spawn allowlists per profile (written to openclaw.json as subagents.allowAgents). */
  const PROFILE_SUBAGENT_ALLOW: Record<AgentProfileId, string[] | null> = {
    "chief-of-staff": ["*"], // CoS can delegate to any agent
    "software-engineer": null,
    "researcher": null,
    "marketing-expert": null,
    "community-manager": null,
    "customer-service": null,
    "sales-assistant": null,
    "operations-admin": null,
    "custom": null,
  };
  const CHIEF_OF_STAFF_EXCLUDED_TOOLS = new Set(CHIEF_OF_STAFF_DENYLIST_SET);

  function sanitizeProfileAlsoAllow(profile: AgentProfileId, tools: string[] | null | undefined): string[] {
    const base = Array.isArray(tools)
      ? tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
      : [];
    if (profile === "chief-of-staff") {
      return base.filter((tool) => !CHIEF_OF_STAFF_EXCLUDED_TOOLS.has(tool));
    }
    return base;
  }

  function resolveOpenClawAlsoAllow(
    profile: AgentProfileId | undefined,
    customTools: string[] | null | undefined,
  ): string[] {
    const extras = Array.isArray(customTools)
      ? customTools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
      : [];
    if (!profile) {
      return sanitizeProfileAlsoAllow("custom", extras);
    }
    const profileTools = profile === "custom" ? [] : (PROFILE_ALSO_ALLOW[profile] ?? []);
    return sanitizeProfileAlsoAllow(profile, Array.from(new Set([...profileTools, ...extras])));
  }

  function applyOpenClawAgentToolConfig(
    oc: Record<string, any>,
    ocAgent: Record<string, any>,
    profile: AgentProfileId | undefined,
    customTools: string[] | null | undefined,
    logMessage: string,
  ): void {
    const alsoAllow = resolveOpenClawAlsoAllow(profile, customTools);
    if (profile || alsoAllow.length > 0) {
      if (!ocAgent.tools || typeof ocAgent.tools !== "object") ocAgent.tools = {};
      ocAgent.tools.profile = "minimal";
      if (alsoAllow.length > 0) {
        ocAgent.tools.alsoAllow = [...alsoAllow];
      } else if ("alsoAllow" in ocAgent.tools) {
        delete ocAgent.tools.alsoAllow;
      }
    }
    if (profile) {
      applyOpenClawProfileRuntimeOptions(oc, ocAgent, profile);
      if (profile === "software-engineer") {
        if (!ocAgent.sandbox) ocAgent.sandbox = {};
        ocAgent.sandbox.workspaceAccess = "none";
      }
      const subagentAllow = PROFILE_SUBAGENT_ALLOW[profile];
      if (subagentAllow) {
        if (!ocAgent.subagents) ocAgent.subagents = {};
        ocAgent.subagents.allowAgents = [...subagentAllow];
      }
      log(`${ts()} ${logMessage}: synced profile "${profile}" → minimal + ${alsoAllow.length} tools for "${ocAgent.id ?? "unknown"}"`);
    }
  }

  function resolveDefaultRoutingProfile(profile: AgentProfileId | undefined): AgentRoutingProfileConfig | undefined {
    return profile ? sanitizeAgentRoutingProfile(PROFILE_DEFINITIONS[profile]?.routingProfile) : undefined;
  }

  function applyOpenClawAgentRoutingProfile(
    ocAgent: Record<string, any>,
    routingProfile: AgentRoutingProfileConfig | undefined,
  ): void {
    const sanitized = sanitizeAgentRoutingProfile(routingProfile);
    if (sanitized) {
      ocAgent.routing = sanitized;
      return;
    }
    if (ocAgent && typeof ocAgent === "object" && "routing" in ocAgent) {
      delete ocAgent.routing;
    }
  }

  function applyOpenClawProfileRuntimeOptions(
    oc: Record<string, any>,
    ocAgent: Record<string, any>,
    profile: AgentProfileId,
  ): void {
    if (profile === "chief-of-staff") {
      if (!oc.tools || typeof oc.tools !== "object") oc.tools = {};
      if (!oc.tools.message || typeof oc.tools.message !== "object") oc.tools.message = {};
      if (!oc.tools.message.crossContext || typeof oc.tools.message.crossContext !== "object") {
        oc.tools.message.crossContext = {};
      }
      oc.tools.message.crossContext.allowAcrossProviders = true;
    }
    if (ocAgent.tools && typeof ocAgent.tools === "object" && "message" in ocAgent.tools) {
      delete ocAgent.tools.message;
    }
  }


  function normalizeAgentHookEndpointPath(rawPath?: string): string {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      return "/hooks/agent";
    }
    const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    const normalized = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
    if (normalized.endsWith("/agent")) {
      return normalized;
    }
    return `${normalized}/agent`;
  }

  function normalizeOpenClawHooksBasePath(rawPath?: string): string {
    const endpointPath = normalizeAgentHookEndpointPath(rawPath);
    const basePath = endpointPath.slice(0, -"/agent".length);
    return basePath || "/hooks";
  }

  function normalizeAgentMemoryPromptInjectionMode(
    rawMode: unknown,
    legacyInjectMemoryInPrompt?: unknown,
    fallback: AgentMemoryPromptInjectionMode = DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
  ): AgentMemoryPromptInjectionMode {
    if (rawMode === "off" || rawMode === "new_sessions" || rawMode === "always") {
      return rawMode;
    }
    if (legacyInjectMemoryInPrompt === true) {
      return "always";
    }
    return fallback;
  }

  function ensureOpenClawVaultPluginConfig(parsed: Record<string, any>): Record<string, any> {
    if (!parsed.plugins) parsed.plugins = {};
    if (!Array.isArray(parsed.plugins.allow)) parsed.plugins.allow = [];
    if (!parsed.plugins.entries || typeof parsed.plugins.entries !== "object") {
      parsed.plugins.entries = {};
    }
    if (!parsed.plugins.allow.includes("straja-vault")) {
      parsed.plugins.allow.push("straja-vault");
    }
    if (!parsed.plugins.entries["straja-vault"] || typeof parsed.plugins.entries["straja-vault"] !== "object") {
      parsed.plugins.entries["straja-vault"] = {};
    }
    if (
      !parsed.plugins.entries["straja-vault"].config ||
      typeof parsed.plugins.entries["straja-vault"].config !== "object"
    ) {
      parsed.plugins.entries["straja-vault"].config = {};
    }
    return parsed.plugins.entries["straja-vault"].config as Record<string, any>;
  }

  function applyOpenClawVaultPluginConfig(
    parsed: Record<string, any>,
    params: {
      authToken?: string;
      baseUrl?: string;
      memoryPromptInjectionMode?: AgentMemoryPromptInjectionMode;
    },
  ): void {
    const vaultPluginConfig = ensureOpenClawVaultPluginConfig(parsed);
    if (!parsed.hooks || typeof parsed.hooks !== "object") {
      parsed.hooks = {};
    }
    parsed.hooks.path = normalizeOpenClawHooksBasePath(parsed.hooks.path);
    if (typeof params.authToken === "string") {
      vaultPluginConfig.authToken = params.authToken;
    }
    if (typeof params.baseUrl === "string") {
      vaultPluginConfig.baseUrl = params.baseUrl;
    }
    if (params.memoryPromptInjectionMode) {
      vaultPluginConfig.memoryPromptInjectionMode = params.memoryPromptInjectionMode;
      if (params.memoryPromptInjectionMode === "always") {
        vaultPluginConfig.injectMemoryInPrompt = true;
      } else if (params.memoryPromptInjectionMode === "off") {
        vaultPluginConfig.injectMemoryInPrompt = false;
      } else {
        delete vaultPluginConfig.injectMemoryInPrompt;
      }
    }
  }

  type AgentUpstreamAuthProvider = "anthropic" | "openai" | "openai-codex";
  type AgentUpstreamAuthMode = "api_key" | "token" | "oauth";
  const OPENAI_CODEX_DEFAULT_MODEL = "openai-codex/gpt-5.4";

  interface AgentUpstreamAuthState {
    configured: boolean;
    profileId?: string;
    mode?: AgentUpstreamAuthMode;
    preview?: string;
    expiresAt?: string;
  }

  interface AgentUpstreamAuthSummary {
    anthropic: AgentUpstreamAuthState;
    openai: AgentUpstreamAuthState;
  }

  interface AgentLatestUsageSummary {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    totalTokensFresh?: boolean;
    estimatedCostUsd?: number;
    local: boolean;
    usedAt?: string;
    fallbackFrom?: {
      provider: string;
      model: string;
    } | null;
  }

  interface AgentAuthProfileStoreFile {
    version: number;
    profiles: Record<string, Record<string, unknown>>;
    order?: Record<string, string[]>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, Record<string, unknown>>;
  }

  interface AgentsConfigFile {
    agents: AgentConnectionConfig[];
  }

  interface GatewayUsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    missingCostEntries: number;
  }

  interface GatewayModelUsageRow {
    provider?: string;
    model?: string;
    count: number;
    totals: GatewayUsageTotals;
  }

  interface GatewayDailyRow {
    date: string;
    tokens: number;
    cost: number;
    messages: number;
    toolCalls: number;
    errors: number;
  }

  interface GatewayDailyModelUsageRow {
    date: string;
    provider?: string;
    model?: string;
    tokens: number;
    cost: number;
    count: number;
  }

  interface GatewaySessionUsageSummary extends GatewayUsageTotals {
    modelUsage?: GatewayModelUsageRow[];
  }

  interface GatewaySessionsUsageEntry {
    key: string;
    label?: string;
    sessionId?: string;
    updatedAt?: number;
    agentId?: string;
    channel?: string;
    modelProvider?: string;
    model?: string;
    usage: GatewaySessionUsageSummary | null;
  }

  interface GatewaySessionsUsageResult {
    updatedAt: number;
    startDate: string;
    endDate: string;
    sessions: GatewaySessionsUsageEntry[];
    totals: GatewayUsageTotals;
    aggregates: {
      byModel: GatewayModelUsageRow[];
      byProvider: GatewayModelUsageRow[];
      daily: GatewayDailyRow[];
      modelDaily?: GatewayDailyModelUsageRow[];
    };
  }

  interface UsageBenchmarkModel {
    provider: string;
    model: string;
    label: string;
  }

  interface UsagePricingModelOption extends UsageBenchmarkModel {
    official: boolean;
    sourceUrl: string;
    cost: OpenClawUsagePricingCost;
  }

  interface UsageOverviewBreakdownRow {
    provider: string;
    model?: string;
    label: string;
    local: boolean;
    requests: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    actualCostUsd: number;
    estimatedSavingsUsd: number;
    benchmarkEquivalentCostUsd: number;
  }

  interface UsageOverviewAgentRow {
    agentId: string;
    agentName: string;
    requests: number;
    totalTokens: number;
    localTokens: number;
    cloudTokens: number;
    actualCostUsd: number;
    estimatedSavingsUsd: number;
  }

  interface UsageOverviewDailyRow {
    date: string;
    tokens: number;
    localTokens: number;
    cloudTokens: number;
    requests: number;
    localRequests: number;
    cloudRequests: number;
    actualCostUsd: number;
    estimatedSavingsUsd: number;
    benchmarkEquivalentCostUsd: number;
    messages: number;
    toolCalls: number;
    errors: number;
  }

  interface UsageOverviewResponse {
    generatedAt: string;
    startDate: string;
    endDate: string;
    benchmarkModel: UsageBenchmarkModel | null;
    totals: {
      requestCount: number;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      localTokens: number;
      cloudTokens: number;
      localRequests: number;
      cloudRequests: number;
      actualCostUsd: number;
      estimatedSavingsUsd: number;
      benchmarkEquivalentCostUsd: number;
      localShare: number;
    };
    byProvider: UsageOverviewBreakdownRow[];
    byModel: UsageOverviewBreakdownRow[];
    byAgent: UsageOverviewAgentRow[];
    daily: UsageOverviewDailyRow[];
  }

  interface UsagePricingResponse {
    benchmarkModel: UsageBenchmarkModel;
    sourceUrl: string;
    official: boolean;
    cost: OpenClawUsagePricingCost;
    models: UsagePricingModelOption[];
  }

  function createEmptyUsageOverviewResponse(params?: {
    startDate?: string;
    endDate?: string;
  }): UsageOverviewResponse {
    const now = new Date();
    const endDate =
      typeof params?.endDate === "string" && params.endDate.trim()
        ? params.endDate.trim()
        : now.toISOString().slice(0, 10);
    const startDate =
      typeof params?.startDate === "string" && params.startDate.trim()
        ? params.startDate.trim()
        : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      generatedAt: now.toISOString(),
      startDate,
      endDate,
      benchmarkModel: null,
      totals: {
        requestCount: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        localTokens: 0,
        cloudTokens: 0,
        localRequests: 0,
        cloudRequests: 0,
        actualCostUsd: 0,
        estimatedSavingsUsd: 0,
        benchmarkEquivalentCostUsd: 0,
        localShare: 0,
      },
      byProvider: [],
      byModel: [],
      byAgent: [],
      daily: [],
    };
  }

  function getAgentsConfig(): AgentsConfigFile {
    const doc = store.getDocumentWithContent("_config", "agents.json");
    if (!doc?.content) return { agents: [] };
    try {
      const parsed = JSON.parse(doc.content) as AgentsConfigFile;
      return Array.isArray(parsed.agents) ? parsed : { agents: [] };
    } catch { return { agents: [] }; }
  }

  async function saveAgentsConfig(config: AgentsConfigFile): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    const now = new Date().toISOString();
    const hash = await hashContent(content);
    store.insertContent(hash, content, now);
    const existing = store.findActiveDocument("_config", "agents.json");
    if (existing) {
      store.updateDocument(existing.id, "agents.json", hash, now);
    } else {
      store.insertDocument("_config", "agents.json", "agents.json", hash, now, now);
    }
  }

  async function detectLocalOpenClawForStarterTeam(): Promise<{
    configPath: string;
    gatewayUrl: string;
    gatewayToken?: string;
    hooksToken: string;
    hooksPath: string;
    memoryPromptInjectionMode: AgentMemoryPromptInjectionMode;
  } | null> {
    try {
      const { configPath, config } = await readLocalOpenClawConfig();
      const gatewayPort = Number.parseInt(String(config?.gateway?.port ?? ""), 10);
      const gatewayUrl = Number.isInteger(gatewayPort) && gatewayPort > 0
        ? `http://localhost:${gatewayPort}`
        : "http://localhost:18789";
      const hooksToken = typeof config?.hooks?.token === "string" ? config.hooks.token.trim() : "";
      if (!hooksToken) {
        return null;
      }
      const vaultEntry = config?.plugins?.entries?.["straja-vault"];
      return {
        configPath,
        gatewayUrl,
        gatewayToken:
          typeof config?.gateway?.auth?.token === "string" && config.gateway.auth.token.trim().length > 0
            ? config.gateway.auth.token.trim()
            : undefined,
        hooksToken,
        hooksPath: normalizeAgentHookEndpointPath(config?.hooks?.path),
        memoryPromptInjectionMode: normalizeAgentMemoryPromptInjectionMode(
          vaultEntry?.config?.memoryPromptInjectionMode,
          vaultEntry?.config?.injectMemoryInPrompt,
          DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
        ),
      };
    } catch {
      return null;
    }
  }

  function buildStarterAgentConfigFromProfile(params: {
    detected: {
      configPath: string;
      gatewayUrl: string;
      gatewayToken?: string;
      hooksToken: string;
      hooksPath: string;
      memoryPromptInjectionMode: AgentMemoryPromptInjectionMode;
    };
    profileDef: AgentProfileDefinitionConfig;
  }): Partial<AgentConnectionConfig> & {
    id: string;
    name: string;
    gatewayUrl: string;
    autoPair: true;
  } {
    return {
      id: slugify(params.profileDef.defaultName || params.profileDef.label),
      name: params.profileDef.defaultName || params.profileDef.label,
      type: "openclaw",
      gatewayUrl: params.detected.gatewayUrl,
      token: params.detected.hooksToken,
      gatewayToken: params.detected.gatewayToken,
      hooksPath: params.detected.hooksPath,
      enabled: true,
      notifications: { gmail: true, gcalendar: true },
      autoPair: true,
      openclawConfigPath: params.detected.configPath,
      profile: params.profileDef.id,
      networkAllowlist: params.profileDef.id === "software-engineer"
        ? ["github.com", "api.github.com", "registry.npmjs.org", "pypi.org", "files.pythonhosted.org"]
        : undefined,
      memoryPromptInjectionMode: params.detected.memoryPromptInjectionMode,
      routingProfile: params.profileDef.routingProfile,
    };
  }

  function listMissingStarterTeamProfiles(existingAgents: Array<{
    id?: string;
    profile?: AgentProfileId;
  }>): AgentProfileId[] {
    return STARTER_TEAM_PROFILE_IDS.filter((profileId) => {
      const profileDef = PROFILE_DEFINITIONS[profileId];
      if (!profileDef) {
        return false;
      }
      const defaultId = slugify(profileDef.defaultName || profileDef.label);
      return !existingAgents.some((agent) => agent.profile === profileId || agent.id === defaultId);
    });
  }

  async function createStarterTeam(): Promise<{
    createdIds: string[];
    missingProfileIds: AgentProfileId[];
  }> {
    const detected = await detectLocalOpenClawForStarterTeam();
    if (!detected) {
      throw new Error("Local OpenClaw auto-detection is required before the starter team can be created.");
    }
    const config = getAgentsConfig();
    const missingProfileIds = listMissingStarterTeamProfiles(config.agents);
    const createdIds: string[] = [];
    for (const profileId of missingProfileIds) {
      const profileDef = PROFILE_DEFINITIONS[profileId];
      if (!profileDef) {
        continue;
      }
      const result = await upsertAgentConfig(
        buildStarterAgentConfigFromProfile({
          detected,
          profileDef,
        }),
      );
      createdIds.push(result.agent.id);
    }
    return {
      createdIds,
      missingProfileIds,
    };
  }

  async function upsertAgentConfig(params: Partial<AgentConnectionConfig> & {
    id: string;
    name: string;
    gatewayUrl: string;
    autoPair?: boolean;
    injectMemoryInPrompt?: boolean;
  }): Promise<{
    agent: AgentConnectionConfig;
    autoPaired: boolean;
    vaultTokenPreview?: string;
    created: boolean;
  }> {
    const config = getAgentsConfig();
    const idx = config.agents.findIndex((a) => a.id === params.id);
    const existing = idx >= 0 ? config.agents[idx] : undefined;
    const incomingProfile = (params as { profile?: AgentProfileId }).profile;
    const incomingNetworkAllowlist = (params as { networkAllowlist?: string[] }).networkAllowlist;
    const incomingCustomTools = (params as { customTools?: string[] }).customTools;
    const incomingModel =
      typeof (params as { model?: unknown }).model === "string"
        ? ((params as { model?: string }).model?.trim() || undefined)
        : undefined;
    const incomingModelFallbacks = Array.isArray((params as { modelFallbacks?: unknown }).modelFallbacks)
      ? ((params as { modelFallbacks?: unknown[] }).modelFallbacks ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean)
      : undefined;
    const incomingModelPolicy = normalizeAgentModelRoutingPolicy(
      (params as { modelPolicy?: unknown }).modelPolicy,
    );
    const incomingMemoryPromptInjectionMode = normalizeAgentMemoryPromptInjectionMode(
      (params as { memoryPromptInjectionMode?: unknown }).memoryPromptInjectionMode,
      (params as { injectMemoryInPrompt?: unknown }).injectMemoryInPrompt,
      existing?.memoryPromptInjectionMode ?? DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
    );
    const incomingRoutingProfile = sanitizeAgentRoutingProfile(
      (params as { routingProfile?: unknown }).routingProfile,
      resolveDefaultRoutingProfile(incomingProfile ?? existing?.profile),
    );
    const incomingOwnerTargets =
      (params as { ownerTargets?: unknown }).ownerTargets &&
      typeof (params as { ownerTargets?: unknown }).ownerTargets === "object" &&
      !Array.isArray((params as { ownerTargets?: unknown }).ownerTargets)
        ? Object.fromEntries(
            Object.entries((params as { ownerTargets?: Record<string, unknown> }).ownerTargets ?? {})
              .map(([channel, value]) => [channel, typeof value === "string" ? value.trim() : ""])
              .filter(([, value]) => value),
          )
        : undefined;

    const normalizedModelStack = normalizeAgentModelStackForPolicy({
      model: incomingModel ?? existing?.model,
      fallbacks: incomingModelFallbacks ?? existing?.modelFallbacks,
      policy: incomingModelPolicy ?? existing?.modelPolicy,
    });

    const agent: AgentConnectionConfig = {
      id: params.id,
      name: params.name,
      type: params.type || "openclaw",
      gatewayUrl: params.gatewayUrl,
      token: params.token || existing?.token || "",
      gatewayToken: params.gatewayToken || existing?.gatewayToken || undefined,
      hooksPath: normalizeAgentHookEndpointPath(params.hooksPath),
      enabled: params.enabled !== false,
      notifications: {
        gmail: params.notifications?.gmail !== false,
        gcalendar: params.notifications?.gcalendar !== false,
      },
      lastNotified: existing?.lastNotified,
      lastError: existing?.lastError,
      vaultAccess: normalizeAgentVaultAccess(existing?.vaultAccess),
      openclawConfigPath:
        typeof (params as { openclawConfigPath?: unknown }).openclawConfigPath === "string"
          ? ((params as { openclawConfigPath?: string }).openclawConfigPath || undefined)
          : existing?.openclawConfigPath,
      profile: incomingProfile ?? existing?.profile,
      networkAllowlist: incomingNetworkAllowlist ?? existing?.networkAllowlist,
      customTools: incomingCustomTools ?? existing?.customTools,
      model: normalizedModelStack.model,
      modelFallbacks: normalizedModelStack.fallbacks,
      modelPolicy: normalizedModelStack.policy,
      memoryPromptInjectionMode: incomingMemoryPromptInjectionMode,
      routingProfile:
        incomingRoutingProfile ??
        existing?.routingProfile ??
        resolveDefaultRoutingProfile(incomingProfile ?? existing?.profile),
      ownerTargets: incomingOwnerTargets ?? existing?.ownerTargets,
    };
    const modelStackChanged =
      incomingModel !== undefined ||
      incomingModelFallbacks !== undefined ||
      incomingModelPolicy !== undefined;

    let autoPaired = false;
    let vaultTokenPreview: string | undefined;
    if (params.autoPair && (agent.type === "openclaw")) {
        const configPath = agent.openclawConfigPath || process.env.OPENCLAW_CONFIG_PATH || join(homedir(), ".openclaw", "openclaw.json");
        if (existsSync(configPath)) {
          agent.openclawConfigPath = configPath;
        const vaultToken = createAgentVaultAccessToken();
        const now = new Date().toISOString();
        const previous = normalizeAgentVaultAccess(agent.vaultAccess);
        agent.vaultAccess = {
          enabled: true,
          tokenHash: hashAgentVaultAccessToken(vaultToken),
          tokenPreview: buildAgentVaultTokenPreview(vaultToken),
          scopes: [...DEFAULT_AGENT_VAULT_ACCESS_SCOPES],
          createdAt: previous?.createdAt ?? now,
          lastRotatedAt: now,
          lastSeenAt: previous?.lastSeenAt,
        };
        vaultTokenPreview = agent.vaultAccess.tokenPreview;

        const ocRaw = await readFile(configPath, "utf-8");
        const oc = JSON.parse(ocRaw);
        const ocGatewayToken = oc?.gateway?.auth?.token;
        if (ocGatewayToken && typeof ocGatewayToken === "string") {
          agent.gatewayToken = ocGatewayToken;
        }
        const vaultPort = port ?? 8181;
        applyOpenClawVaultPluginConfig(oc, {
          authToken: vaultToken,
          baseUrl: `http://localhost:${vaultPort}`,
          memoryPromptInjectionMode: agent.memoryPromptInjectionMode,
        });

        const ocAgent = ensureOpenClawAgentEntry(oc, agent.id);
        if (agent.name) {
          ocAgent.name = agent.name;
        }
        applyOpenClawAgentRoutingProfile(ocAgent, agent.routingProfile);
        applyOpenClawAgentModelConfig(
          ocAgent,
          agent.model,
          agent.modelFallbacks,
          agent.modelPolicy,
        );
        applyOpenClawAgentToolConfig(oc, ocAgent, agent.profile, agent.customTools, "auto-pair");

        await writeFile(configPath + ".bak", ocRaw, "utf-8");
        await writeFile(configPath, JSON.stringify(oc, null, 2) + "\n", "utf-8");
        autoPaired = true;
        log(`${ts()} auto-pair: wrote vault token + baseUrl to ${configPath}`);
      }
    }

    if (!autoPaired && agent.openclawConfigPath) {
      try {
        if (existsSync(agent.openclawConfigPath)) {
          const ocRaw2 = await readFile(agent.openclawConfigPath, "utf-8");
          const oc2 = JSON.parse(ocRaw2);
          const ocAgent2 = ensureOpenClawAgentEntry(oc2, agent.id);
          if (agent.name) {
            ocAgent2.name = agent.name;
          }
          applyOpenClawAgentRoutingProfile(ocAgent2, agent.routingProfile);
          applyOpenClawAgentModelConfig(
            ocAgent2,
            agent.model,
            agent.modelFallbacks,
            agent.modelPolicy,
          );
          if (incomingProfile !== undefined || incomingCustomTools !== undefined) {
            applyOpenClawAgentToolConfig(
              oc2,
              ocAgent2,
              agent.profile,
              agent.customTools,
              "profile-sync",
            );
          }
          await writeFile(agent.openclawConfigPath + ".bak", ocRaw2, "utf-8");
          await writeFile(agent.openclawConfigPath, JSON.stringify(oc2, null, 2) + "\n", "utf-8");
        }
      } catch (profileSyncErr: any) {
        log(`${ts()} agent-sync: failed to sync agent entry to openclaw.json: ${profileSyncErr?.message}`);
      }
    }

    if (!autoPaired && agent.openclawConfigPath) {
      try {
        await syncOpenClawVaultPluginConfig(agent, {
          memoryPromptInjectionMode: agent.memoryPromptInjectionMode,
        });
      } catch (vaultPluginSyncErr: any) {
        log(`${ts()} vault-plugin-sync: failed to sync vault plugin config: ${vaultPluginSyncErr?.message}`);
      }
    }

    if (agent.type === "openclaw") {
      try {
        await syncAgentModelToOpenClawConfigs(agent);
      } catch {
        // Non-fatal.
      }
      try {
        await syncAgentModelsCatalog(agent);
      } catch {
        // Non-fatal.
      }
    }

    if (modelStackChanged && agent.type === "openclaw") {
      try {
        await clearOpenClawAgentSessionModelOverrides(agent);
      } catch {
        // Non-fatal.
      }
    }

    if (idx >= 0) {
      config.agents[idx] = agent;
    } else {
      config.agents.push(agent);
    }

    await saveAgentsConfig(config);

    const gwTokenForPatch = agent.gatewayToken || agent.token;
    if (agent.type === "openclaw" && agent.gatewayUrl && gwTokenForPatch) {
      patchOpenClawGatewayConfig(agent, gwTokenForPatch, {
        plugins: {
          entries: {
            "straja-vault": {
              config: {
                memoryPromptInjectionMode: agent.memoryPromptInjectionMode,
                ...(agent.memoryPromptInjectionMode === "always"
                  ? { injectMemoryInPrompt: true }
                  : agent.memoryPromptInjectionMode === "off"
                    ? { injectMemoryInPrompt: false }
                    : {}),
              },
            },
          },
        },
      }).catch((runtimeSyncErr: any) => {
        log(`${ts()} vault-plugin-sync: runtime config patch skipped: ${runtimeSyncErr?.message}`);
      });
    }

    return {
      agent,
      autoPaired,
      vaultTokenPreview,
      created: idx < 0,
    };
  }

  function getAgentAuthProfileStore(): AgentAuthProfileStoreFile {
    const doc = store.getDocumentWithContent("_auth_profiles", "auth-profiles.json");
    if (!doc?.content) {
      return { version: 1, profiles: {} };
    }
    try {
      const parsed = JSON.parse(doc.content) as AgentAuthProfileStoreFile;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { version: 1, profiles: {} };
      }
      const profiles =
        parsed.profiles && typeof parsed.profiles === "object" && !Array.isArray(parsed.profiles)
          ? parsed.profiles
          : {};
      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        profiles,
        order:
          parsed.order && typeof parsed.order === "object" && !Array.isArray(parsed.order)
            ? parsed.order
            : undefined,
        lastGood:
          parsed.lastGood && typeof parsed.lastGood === "object" && !Array.isArray(parsed.lastGood)
            ? parsed.lastGood
            : undefined,
        usageStats:
          parsed.usageStats &&
          typeof parsed.usageStats === "object" &&
          !Array.isArray(parsed.usageStats)
            ? parsed.usageStats
            : undefined,
      };
    } catch {
      return { version: 1, profiles: {} };
    }
  }

  async function saveAgentAuthProfileStore(config: AgentAuthProfileStoreFile): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    const now = new Date().toISOString();
    const hash = await hashContent(content);
    store.insertContent(hash, content, now);
    const existing = store.findActiveDocument("_auth_profiles", "auth-profiles.json");
    if (existing) {
      store.updateDocument(existing.id, "auth-profiles.json", hash, now);
    } else {
      store.insertDocument("_auth_profiles", "auth-profiles.json", "auth-profiles.json", hash, now, now);
    }
  }

  function buildSecretPreview(secret: string): string {
    const trimmed = String(secret ?? "").trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.length <= 8) {
      return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
    }
    return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
  }

  function resolveProviderProfileInfo(
    authStore: AgentAuthProfileStoreFile,
    provider: "anthropic" | "openai",
  ): AgentUpstreamAuthState {
    const providerIds = provider === "openai" ? ["openai-codex", "openai"] : [provider];
    const explicitOrder = Array.isArray(authStore.order?.[provider])
      ? authStore.order?.[provider] ?? []
      : [];
    const allProfiles = Object.entries(authStore.profiles).filter(([, value]) => {
      return (
        value &&
        typeof value === "object" &&
        providerIds.includes(String((value as { provider?: unknown }).provider ?? ""))
      );
    });
    const preferredIds = explicitOrder.length > 0
      ? explicitOrder
      : provider === "anthropic"
        ? ["anthropic:default", "anthropic:manual", "anthropic:claude-cli"]
        : ["openai-codex:default", "openai:default"];
    const ordered = [
      ...preferredIds,
      ...allProfiles.map(([profileId]) => profileId).filter((profileId) => !preferredIds.includes(profileId)),
    ];
    for (const profileId of ordered) {
      const profile = authStore.profiles[profileId];
      if (!profile || typeof profile !== "object") {
        continue;
      }
      const type = String((profile as { type?: unknown }).type ?? "");
      if (type !== "api_key" && type !== "token" && type !== "oauth") {
        continue;
      }
      const previewSource = type === "api_key"
        ? String((profile as { key?: unknown }).key ?? "")
        : type === "token"
          ? String((profile as { token?: unknown }).token ?? "")
          : String(
              (profile as { email?: unknown; accountId?: unknown }).email ??
              (profile as { accountId?: unknown }).accountId ??
              "",
            );
      const expiresAtRaw = (profile as { expires?: unknown }).expires;
      const configured = type === "oauth"
        ? Boolean(
            String((profile as { access?: unknown }).access ?? "").trim() &&
            String((profile as { refresh?: unknown }).refresh ?? "").trim(),
          )
        : Boolean(previewSource.trim());
      return {
        configured,
        profileId,
        mode: type as AgentUpstreamAuthMode,
        preview: previewSource.trim()
          ? type === "oauth"
            ? previewSource
            : buildSecretPreview(previewSource)
          : undefined,
        expiresAt:
          typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw) && expiresAtRaw > 0
            ? new Date(expiresAtRaw).toISOString()
            : undefined,
      };
    }
    return { configured: false };
  }

  function getAgentUpstreamAuthSummary(): AgentUpstreamAuthSummary {
    const authStore = getAgentAuthProfileStore();
    return {
      anthropic: resolveProviderProfileInfo(authStore, "anthropic"),
      openai: resolveProviderProfileInfo(authStore, "openai"),
    };
  }

  function applyAuthProfileConfigLike(
    cfg: Record<string, unknown>,
    params: {
      profileId: string;
      provider: AgentUpstreamAuthProvider;
      mode: AgentUpstreamAuthMode;
    },
  ): Record<string, unknown> {
    const authRaw =
      cfg.auth && typeof cfg.auth === "object" && !Array.isArray(cfg.auth)
        ? (cfg.auth as Record<string, unknown>)
        : {};
    const profilesRaw =
      authRaw.profiles && typeof authRaw.profiles === "object" && !Array.isArray(authRaw.profiles)
        ? (authRaw.profiles as Record<string, unknown>)
        : {};
    const orderRaw =
      authRaw.order && typeof authRaw.order === "object" && !Array.isArray(authRaw.order)
        ? (authRaw.order as Record<string, unknown>)
        : {};
    const existingOrder = Array.isArray(orderRaw[params.provider])
      ? (orderRaw[params.provider] as unknown[]).filter((value): value is string => typeof value === "string")
      : undefined;
    const reordered =
      existingOrder !== undefined
        ? [params.profileId, ...existingOrder.filter((value) => value !== params.profileId)]
        : undefined;
    return {
      ...cfg,
      auth: {
        ...authRaw,
        profiles: {
          ...profilesRaw,
          [params.profileId]: {
            provider: params.provider,
            mode: params.mode,
          },
        },
        ...(reordered
          ? {
              order: {
                ...orderRaw,
                [params.provider]: reordered,
              },
            }
          : {}),
      },
    };
  }

  function applyPrimaryModelConfigLike(
    cfg: Record<string, unknown>,
    primaryModel: string,
  ): Record<string, unknown> {
    const trimmed = primaryModel.trim();
    if (!trimmed) {
      return cfg;
    }
    const agentsRaw =
      cfg.agents && typeof cfg.agents === "object" && !Array.isArray(cfg.agents)
        ? (cfg.agents as Record<string, unknown>)
        : {};
    const defaultsRaw =
      agentsRaw.defaults && typeof agentsRaw.defaults === "object" && !Array.isArray(agentsRaw.defaults)
        ? (agentsRaw.defaults as Record<string, unknown>)
        : {};
    const modelRaw =
      defaultsRaw.model && typeof defaultsRaw.model === "object" && !Array.isArray(defaultsRaw.model)
        ? (defaultsRaw.model as Record<string, unknown>)
        : {};
    return {
      ...cfg,
      agents: {
        ...agentsRaw,
        defaults: {
          ...defaultsRaw,
          model: {
            ...modelRaw,
            primary: trimmed,
          },
        },
      },
    };
  }

  function ensureOpenClawAgentEntry(
    parsed: Record<string, any>,
    agentId: string,
  ): Record<string, any> {
    if (!parsed.agents || typeof parsed.agents !== "object") {
      parsed.agents = {};
    }
    if (!Array.isArray(parsed.agents.list)) {
      parsed.agents.list = [];
    }
    let entry = parsed.agents.list.find((value: { id?: string }) => value?.id === agentId);
    if (!entry) {
      entry = { id: agentId };
      parsed.agents.list.push(entry);
    }
    return entry as Record<string, any>;
  }

  function readOpenClawAgentPrimaryModel(
    parsed: Record<string, any>,
    agentId: string,
  ): string | undefined {
    const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    const entry = list.find((value: { id?: string }) => value?.id === agentId);
    if (!entry || typeof entry !== "object") {
      return undefined;
    }
    const modelRaw = (entry as { model?: unknown }).model;
    if (typeof modelRaw === "string") {
      const trimmed = modelRaw.trim();
      return trimmed || undefined;
    }
    if (modelRaw && typeof modelRaw === "object" && !Array.isArray(modelRaw)) {
      const primary = typeof (modelRaw as { primary?: unknown }).primary === "string"
        ? (modelRaw as { primary?: string }).primary?.trim()
        : "";
      return primary || undefined;
    }
    return undefined;
  }

  function readOpenClawAgentModelFallbacks(
    parsed: Record<string, any>,
    agentId: string,
  ): string[] | undefined {
    const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    const entry = list.find((value: { id?: string }) => value?.id === agentId);
    if (!entry || typeof entry !== "object") {
      return undefined;
    }
    const modelRaw = (entry as { model?: unknown }).model;
    if (!modelRaw || typeof modelRaw !== "object" || Array.isArray(modelRaw)) {
      return undefined;
    }
    if (!Object.hasOwn(modelRaw, "fallbacks")) {
      return undefined;
    }
    const rawFallbacks = (modelRaw as { fallbacks?: unknown }).fallbacks;
    if (!Array.isArray(rawFallbacks)) {
      return undefined;
    }
    return rawFallbacks
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
  }

  function normalizeAgentModelRoutingPolicy(
    value: unknown,
  ): AgentModelRoutingPolicy | undefined {
    if (value === "local_only" || value === "cloud_only" || value === "hybrid") {
      return value;
    }
    if (value === "prefer_local" || value === "allow_cloud") {
      return "hybrid";
    }
    return undefined;
  }

  const DEFAULT_LOCAL_AGENT_MODEL = "ollama/gemma4:e4b";
  const DEFAULT_CLOUD_AGENT_MODEL = "openai-codex/gpt-5.4";

  function isLocalModelRef(value: unknown): boolean {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      return false;
    }
    const slash = trimmed.indexOf("/");
    if (slash <= 0) {
      return false;
    }
    const provider = trimmed.slice(0, slash).trim().toLowerCase();
    return provider === "ollama" || provider === "vllm";
  }

  function normalizeAgentModelStackForPolicy(params: {
    model?: string;
    fallbacks?: string[];
    policy?: AgentModelRoutingPolicy;
  }): {
    model?: string;
    fallbacks?: string[];
    policy?: AgentModelRoutingPolicy;
  } {
    const policy = normalizeAgentModelRoutingPolicy(params.policy);
    const primary = typeof params.model === "string" ? params.model.trim() : "";
    const fallbacks = Array.isArray(params.fallbacks)
      ? params.fallbacks.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const uniqueFallbacks = Array.from(new Set(fallbacks.filter((value) => value !== primary)));

    if (policy === "local_only") {
      const nextPrimary =
        (isLocalModelRef(primary) ? primary : "") ||
        uniqueFallbacks.find((value) => isLocalModelRef(value)) ||
        DEFAULT_LOCAL_AGENT_MODEL;
      return {
        model: nextPrimary,
        fallbacks: [],
        policy,
      };
    }

    if (policy === "cloud_only") {
      const nextPrimary =
        (!primary || isLocalModelRef(primary) ? "" : primary) ||
        uniqueFallbacks.find((value) => !isLocalModelRef(value)) ||
        DEFAULT_CLOUD_AGENT_MODEL;
      return {
        model: nextPrimary,
        fallbacks: [],
        policy,
      };
    }

    return {
      model: primary || undefined,
      fallbacks: uniqueFallbacks,
      policy,
    };
  }

  function readOpenClawAgentModelPolicy(
    parsed: Record<string, any>,
    agentId: string,
  ): AgentModelRoutingPolicy | undefined {
    const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    const entry = list.find((value: { id?: string }) => value?.id === agentId);
    if (!entry || typeof entry !== "object") {
      return undefined;
    }
    const modelRaw = (entry as { model?: unknown }).model;
    if (!modelRaw || typeof modelRaw !== "object" || Array.isArray(modelRaw)) {
      return undefined;
    }
    return normalizeAgentModelRoutingPolicy((modelRaw as { policy?: unknown }).policy);
  }

  function applyOpenClawAgentModelConfig(
    entry: Record<string, any>,
    model?: string,
    fallbacks?: string[],
    policy?: AgentModelRoutingPolicy,
  ): void {
    const normalized = normalizeAgentModelStackForPolicy({
      model,
      fallbacks,
      policy,
    });
    const trimmed = typeof normalized.model === "string" ? normalized.model.trim() : "";
    const normalizedFallbacks = Array.isArray(normalized.fallbacks)
      ? normalized.fallbacks.map((value) => String(value).trim()).filter(Boolean)
      : undefined;
    const normalizedPolicy = normalized.policy;
    if (!trimmed && normalizedFallbacks === undefined && normalizedPolicy === undefined) {
      return;
    }
    const existingModel =
      entry.model && typeof entry.model === "object" && !Array.isArray(entry.model)
        ? (entry.model as Record<string, unknown>)
        : {};
    const nextModel: Record<string, unknown> = { ...existingModel };
    if (trimmed) {
      nextModel.primary = trimmed;
    }
    if (normalizedFallbacks !== undefined) {
      nextModel.fallbacks = normalizedFallbacks;
    }
    if (normalizedPolicy !== undefined) {
      nextModel.policy = normalizedPolicy;
    }
    entry.model = nextModel;
  }

  function isLocalProvider(provider: string | undefined): boolean {
    const normalized = String(provider ?? "").trim().toLowerCase();
    return normalized === "ollama" || normalized === "vllm";
  }

  function normalizeProviderKey(provider: string | undefined): string {
    return String(provider ?? "").trim().toLowerCase();
  }

  function resolveWorkspaceDevOpenClawConfigPath(): string {
    return resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "straja-workspace-app",
      ".dev",
      "openclaw.json",
    );
  }

  function listOpenClawConfigCandidatePaths(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
  ): string[] {
    const seen = new Set<string>();
    const candidates = [
      process.env.OPENCLAW_CONFIG_PATH,
      resolveWorkspaceDevOpenClawConfigPath(),
      agent.openclawConfigPath,
      join(homedir(), ".openclaw", "openclaw.json"),
    ];
    const resolved: string[] = [];
    for (const raw of candidates) {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        continue;
      }
      const absolute = resolve(trimmed);
      if (seen.has(absolute)) {
        continue;
      }
      seen.add(absolute);
      resolved.push(absolute);
    }
    return resolved;
  }

  function normalizeOpenClawAgentId(value: unknown): string {
    const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
    return trimmed || "main";
  }

  function resolveDefaultOpenClawAgentId(parsed: Record<string, any>): string {
    const agents = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    if (agents.length === 0) {
      return "main";
    }
    const defaults = agents.filter((entry: Record<string, unknown> | null | undefined) => entry?.default);
    const chosen = defaults[0] ?? agents[0];
    return normalizeOpenClawAgentId(chosen?.id);
  }

  function resolveOpenClawConfigForAgent(agent: Pick<AgentConnectionConfig, "openclawConfigPath">): {
    path: string;
    parsed: Record<string, any>;
  } | null {
    for (const configPath of listOpenClawConfigCandidatePaths(agent)) {
      if (!existsSync(configPath)) {
        continue;
      }
      try {
        const raw = readFileSync(configPath, "utf-8");
        return {
          path: configPath,
          parsed: JSON.parse(raw) as Record<string, any>,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  function resolvePreferredOpenClawConfigPath(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
  ): string {
    const resolved = resolveOpenClawConfigForAgent(agent);
    if (resolved?.path) {
      return resolved.path;
    }
    return resolveDefaultOpenClawConfigPath();
  }

  function listOpenClawWritableConfigPaths(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
  ): string[] {
    return listOpenClawConfigCandidatePaths(agent).filter((configPath) => existsSync(configPath));
  }

  async function writeOpenClawConfigToWritablePaths(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
    parsed: Record<string, any>,
  ): Promise<void> {
    const payload = `${JSON.stringify(parsed, null, 2)}\n`;
    let wroteAny = false;
    for (const configPath of listOpenClawWritableConfigPaths(agent)) {
      await writeFile(configPath, payload, "utf-8");
      wroteAny = true;
    }
    if (!wroteAny) {
      throw new Error("No writable OpenClaw config path found.");
    }
  }

  function isTransientUsageGatewayError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (!message) return false;
    return (
      message.includes("Agent gateway connection error") ||
      message.includes("WebSocket closed unexpectedly") ||
      message.includes("timeout after") ||
      message.includes("Received network error or non-101 status code")
    );
  }

  async function getGatewayUsageOverviewViaCli(
    agent: Pick<AgentConnectionConfig, "gatewayUrl" | "gatewayToken" | "token" | "openclawConfigPath">,
    params: { startDate: string; endDate: string; limit: number },
  ): Promise<GatewaySessionsUsageResult> {
    const result = await runOpenClawCli(
      agent as AgentConnectionConfig,
      [
        "gateway",
        "call",
        "sessions.usage",
        "--json",
        "--params",
        JSON.stringify(params),
      ],
      240_000,
    );
    if (result.status !== 0) {
      throw new Error(compactCliErrorText(result.stderr, result.stdout));
    }
    const raw = result.stdout.trim();
    if (!raw) {
      throw new Error("Usage overview CLI returned an empty response.");
    }
    return JSON.parse(raw) as GatewaySessionsUsageResult;
  }

  async function getGatewayUsageOverviewWithRetry(
    agent: Pick<AgentConnectionConfig, "gatewayUrl" | "gatewayToken" | "token" | "openclawConfigPath">,
    params: { startDate: string; endDate: string; limit: number },
  ): Promise<GatewaySessionsUsageResult> {
    const gwToken = agent.gatewayToken || agent.token;
    if (!agent.gatewayUrl || !gwToken) {
      throw new Error("Agent gateway is not configured.");
    }

    const attempts = [0, 750, 1500];
    let lastError: unknown = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const backoffMs = attempts[index] ?? 0;
      if (backoffMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, backoffMs));
      }
      try {
        return (await agentGatewayRpc(
          agent.gatewayUrl,
          gwToken,
          "sessions.usage",
          params,
          180_000,
        )) as GatewaySessionsUsageResult;
      } catch (error) {
        lastError = error;
        if (!isTransientUsageGatewayError(error)) {
          throw error;
        }
        if (index === attempts.length - 1) {
          try {
            return await getGatewayUsageOverviewViaCli(agent, params);
          } catch (cliError) {
            throw cliError;
          }
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to load usage overview");
  }

  async function resolveOpenClawUsagePricingState(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
  ): Promise<{ resolved: { path: string; parsed: Record<string, any> }; pricing: UsagePricingResponse }> {
    const resolved = resolveOpenClawConfigForAgent(agent);
    if (!resolved) {
      throw new Error("OpenClaw config not found.");
    }
    const touchedAt = new Date().toISOString();
    const seeded = applyOfficialUsagePricingDefaults(resolved.parsed, touchedAt);
    const seededJson = JSON.stringify(seeded);
    if (seededJson !== JSON.stringify(resolved.parsed)) {
      await writeOpenClawConfigToWritablePaths(agent, seeded);
      resolved.parsed = seeded;
    }

    const benchmark = resolveUsageBenchmarkModel({
      parsed: resolved.parsed,
      config: getAgentsConfig(),
    });
    const officialModels = getOfficialUsagePricingModels();
    const fallbackOfficial = officialModels[0] ?? {
      provider: "openai-codex",
      model: "gpt-5.4",
      label: "openai-codex/gpt-5.4",
      sourceUrl: "https://openai.com/api/pricing/",
      cost: {
        input: 2.5,
        output: 15,
        cacheRead: 0.25,
        cacheWrite: 0,
      },
    };
    const activeBenchmark = benchmark ?? {
      provider: fallbackOfficial.provider,
      model: fallbackOfficial.model,
      label: fallbackOfficial.label,
    };
    const providerEntry =
      resolved.parsed?.models?.providers &&
      typeof resolved.parsed.models.providers === "object" &&
      !Array.isArray(resolved.parsed.models.providers)
        ? (resolved.parsed.models.providers as Record<string, any>)[activeBenchmark.provider]
        : undefined;
    const modelEntry = Array.isArray(providerEntry?.models)
      ? providerEntry.models.find((entry: { id?: string }) => entry?.id === activeBenchmark.model)
      : undefined;
    const officialMatch = officialModels.find(
      (entry) => entry.provider === activeBenchmark.provider && entry.model === activeBenchmark.model,
    ) ?? fallbackOfficial;
    const models = listConfiguredUsagePricingModels(resolved.parsed).map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      label: entry.label,
      official: entry.official,
      sourceUrl: entry.sourceUrl,
      cost: { ...entry.cost },
    }));
    const currentCost = modelEntry?.cost && typeof modelEntry.cost === "object" ? modelEntry.cost : {};
    return {
      resolved,
      pricing: {
        benchmarkModel: activeBenchmark,
        sourceUrl: officialMatch.sourceUrl,
        official: officialMatch.provider === activeBenchmark.provider && officialMatch.model === activeBenchmark.model,
        models,
        cost: {
          input: typeof currentCost.input === "number" && Number.isFinite(currentCost.input) ? currentCost.input : officialMatch.cost.input,
          output: typeof currentCost.output === "number" && Number.isFinite(currentCost.output) ? currentCost.output : officialMatch.cost.output,
          cacheRead:
            typeof currentCost.cacheRead === "number" && Number.isFinite(currentCost.cacheRead)
              ? currentCost.cacheRead
              : officialMatch.cost.cacheRead,
          cacheWrite:
            typeof currentCost.cacheWrite === "number" && Number.isFinite(currentCost.cacheWrite)
              ? currentCost.cacheWrite
              : officialMatch.cost.cacheWrite,
        },
      },
    };
  }

  function listOpenClawSessionStorePaths(
    agent: Pick<AgentConnectionConfig, "id" | "openclawConfigPath">,
  ): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const configPath of listOpenClawConfigCandidatePaths(agent)) {
      const root = dirname(configPath);
      const candidates = [
        join(root, "agents", agent.id, "sessions", "sessions.json"),
        join(root, "agents", "main", "sessions", "sessions.json"),
      ];
      for (const candidate of candidates) {
        if (seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        paths.push(candidate);
      }
    }
    return paths;
  }

  async function clearOpenClawAgentSessionModelOverrides(
    agent: Pick<AgentConnectionConfig, "id" | "openclawConfigPath">,
  ): Promise<boolean> {
    let changedAny = false;
    for (const storePath of listOpenClawSessionStorePaths(agent)) {
      if (!existsSync(storePath)) {
        continue;
      }
      try {
        const raw = await readFile(storePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
        let changed = false;
        for (const entry of Object.values(parsed)) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          if ("providerOverride" in entry) {
            delete (entry as Record<string, unknown>).providerOverride;
            changed = true;
          }
          if ("modelOverride" in entry) {
            delete (entry as Record<string, unknown>).modelOverride;
            changed = true;
          }
          if ("modelProvider" in entry) {
            delete (entry as Record<string, unknown>).modelProvider;
            changed = true;
          }
          if ("model" in entry) {
            delete (entry as Record<string, unknown>).model;
            changed = true;
          }
          if ("fallbackNoticeSelectedModel" in entry) {
            delete (entry as Record<string, unknown>).fallbackNoticeSelectedModel;
            changed = true;
          }
          if ("fallbackNoticeActiveModel" in entry) {
            delete (entry as Record<string, unknown>).fallbackNoticeActiveModel;
            changed = true;
          }
          if ("fallbackNoticeReason" in entry) {
            delete (entry as Record<string, unknown>).fallbackNoticeReason;
            changed = true;
          }
        }
        if (!changed) {
          continue;
        }
        await writeFile(storePath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
        changedAny = true;
      } catch {
        continue;
      }
    }
    return changedAny;
  }

  async function syncAgentModelToOpenClawConfigs(
    agent: Pick<
      AgentConnectionConfig,
      "id" | "name" | "model" | "modelFallbacks" | "modelPolicy" | "openclawConfigPath"
    >,
  ): Promise<boolean> {
    let wroteAny = false;
    for (const configPath of listOpenClawWritableConfigPaths(agent)) {
      try {
        const ocRaw = await readFile(configPath, "utf-8");
        const oc = JSON.parse(ocRaw);
        const ocAgent = ensureOpenClawAgentEntry(oc, agent.id);
        if (agent.name) {
          ocAgent.name = agent.name;
        }
        applyOpenClawAgentModelConfig(
          ocAgent,
          agent.model,
          agent.modelFallbacks,
          agent.modelPolicy,
        );
        if (
          normalizeOpenClawAgentId(resolveDefaultOpenClawAgentId(oc)) ===
          normalizeOpenClawAgentId(agent.id)
        ) {
          if (!oc.agents) {
            oc.agents = {};
          }
          if (!oc.agents.defaults) {
            oc.agents.defaults = {};
          }
          if (!oc.agents.defaults.model || typeof oc.agents.defaults.model === "string") {
            oc.agents.defaults.model = {};
          }
          if (typeof agent.model === "string" && agent.model.trim()) {
            oc.agents.defaults.model.primary = agent.model.trim();
          } else if (typeof agent.model === "string" && !agent.model.trim()) {
            delete oc.agents.defaults.model.primary;
          }
          if (Array.isArray(agent.modelFallbacks)) {
            oc.agents.defaults.model.fallbacks = [...agent.modelFallbacks];
          } else {
            delete oc.agents.defaults.model.fallbacks;
          }
          delete oc.agents.defaults.model.policy;
        }
        await writeFile(configPath + ".bak", ocRaw, "utf-8");
        await writeFile(configPath, JSON.stringify(oc, null, 2) + "\n", "utf-8");
        wroteAny = true;
      } catch {
        continue;
      }
    }
    return wroteAny;
  }

  function resolveModelCostUsdFromOpenClawConfig(params: {
    parsed: Record<string, any>;
    provider: string;
    model: string;
    usage: Pick<AgentLatestUsageSummary, "inputTokens" | "outputTokens">;
  }): number | undefined {
    const providers =
      params.parsed?.models?.providers &&
      typeof params.parsed.models.providers === "object" &&
      !Array.isArray(params.parsed.models.providers)
        ? (params.parsed.models.providers as Record<string, any>)
        : {};
    const providerKey = Object.keys(providers).find(
      (key) => normalizeProviderKey(key) === normalizeProviderKey(params.provider),
    );
    const providerEntry = providerKey ? providers[providerKey] : undefined;
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    const modelEntry = models.find((entry: { id?: string }) => entry?.id === params.model);
    const cost = modelEntry?.cost;
    if (!cost || typeof cost !== "object") {
      return isLocalProvider(params.provider) ? 0 : undefined;
    }
    const input = typeof params.usage.inputTokens === "number" ? params.usage.inputTokens : 0;
    const output = typeof params.usage.outputTokens === "number" ? params.usage.outputTokens : 0;
    const inputCost = typeof cost.input === "number" ? cost.input : 0;
    const outputCost = typeof cost.output === "number" ? cost.output : 0;
    const total = input * inputCost + output * outputCost;
    return Number.isFinite(total) ? total / 1_000_000 : undefined;
  }

  function createEmptyGatewayUsageTotals(): GatewayUsageTotals {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
  }

  function normalizeGatewayUsageTotals(value: unknown): GatewayUsageTotals {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const read = (key: keyof GatewayUsageTotals): number => {
      const entry = raw[key];
      return typeof entry === "number" && Number.isFinite(entry) ? entry : 0;
    };
    return {
      input: read("input"),
      output: read("output"),
      cacheRead: read("cacheRead"),
      cacheWrite: read("cacheWrite"),
      totalTokens: read("totalTokens"),
      totalCost: read("totalCost"),
      inputCost: read("inputCost"),
      outputCost: read("outputCost"),
      cacheReadCost: read("cacheReadCost"),
      cacheWriteCost: read("cacheWriteCost"),
      missingCostEntries: read("missingCostEntries"),
    };
  }

  function parseUsageRangeTimestamp(raw: unknown): Date | null {
    if (typeof raw === "string" && raw.trim()) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.valueOf()) ? null : parsed;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.valueOf()) ? null : parsed;
    }
    return null;
  }

  function extractTranscriptTimestamp(entry: Record<string, any>): Date | null {
    return (
      parseUsageRangeTimestamp(entry.timestamp) ??
      parseUsageRangeTimestamp(entry.message?.timestamp) ??
      null
    );
  }

  function extractTranscriptText(content: unknown): string | undefined {
    if (typeof content === "string") {
      return content.trim() || undefined;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "text" &&
          typeof (block as Record<string, unknown>).text === "string"
        ) {
          const text = ((block as Record<string, unknown>).text as string).trim();
          if (text) {
            return text;
          }
        }
      }
    }
    return undefined;
  }

  function parseTranscriptUsageTotals(
    usageRaw: unknown,
    provider: string | undefined,
    model: string | undefined,
    parsed?: Record<string, any>,
  ): GatewayUsageTotals | null {
    const usage =
      usageRaw && typeof usageRaw === "object" && !Array.isArray(usageRaw)
        ? (usageRaw as Record<string, unknown>)
        : null;
    if (!usage) {
      return null;
    }
    const read = (...keys: string[]): number => {
      for (const key of keys) {
        const value = usage[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
      }
      return 0;
    };
    const input = read("input", "inputTokens");
    const output = read("output", "outputTokens");
    const cacheRead = read("cacheRead", "cachedInput");
    const cacheWrite = read("cacheWrite");
    const totalTokens = read("totalTokens", "total") || input + output + cacheRead + cacheWrite;
    const costRaw =
      usage.cost && typeof usage.cost === "object" && !Array.isArray(usage.cost)
        ? (usage.cost as Record<string, unknown>)
        : null;
    const explicitTotalCost =
      costRaw && typeof costRaw.total === "number" && Number.isFinite(costRaw.total)
        ? costRaw.total
        : undefined;
    const estimatedTotalCost =
      !explicitTotalCost && provider && model && parsed
        ? resolveModelCostUsdFromOpenClawConfig({
            parsed,
            provider,
            model,
            usage: {
              inputTokens: input,
              outputTokens: output,
            },
          })
        : undefined;
    const totalCost = explicitTotalCost ?? estimatedTotalCost ?? (isLocalProvider(provider) ? 0 : 0);
    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens,
      totalCost,
      inputCost:
        costRaw && typeof costRaw.input === "number" && Number.isFinite(costRaw.input)
          ? costRaw.input
          : 0,
      outputCost:
        costRaw && typeof costRaw.output === "number" && Number.isFinite(costRaw.output)
          ? costRaw.output
          : 0,
      cacheReadCost:
        costRaw && typeof costRaw.cacheRead === "number" && Number.isFinite(costRaw.cacheRead)
          ? costRaw.cacheRead
          : 0,
      cacheWriteCost:
        costRaw && typeof costRaw.cacheWrite === "number" && Number.isFinite(costRaw.cacheWrite)
          ? costRaw.cacheWrite
          : 0,
      missingCostEntries:
        explicitTotalCost !== undefined || estimatedTotalCost !== undefined || isLocalProvider(provider)
          ? 0
          : 1,
    };
  }

  function addGatewayUsageTotals(target: GatewayUsageTotals, source: GatewayUsageTotals): void {
    target.input += source.input;
    target.output += source.output;
    target.cacheRead += source.cacheRead;
    target.cacheWrite += source.cacheWrite;
    target.totalTokens += source.totalTokens;
    target.totalCost += source.totalCost;
    target.inputCost += source.inputCost;
    target.outputCost += source.outputCost;
    target.cacheReadCost += source.cacheReadCost;
    target.cacheWriteCost += source.cacheWriteCost;
    target.missingCostEntries += source.missingCostEntries;
  }

  function parseAgentIdFromSessionKey(sessionKey: string): string | undefined {
    const match = sessionKey.match(/^agent:([^:]+):/);
    const agentId = match?.[1]?.trim();
    return agentId ? agentId : undefined;
  }

  async function buildUsageGatewaySnapshotFromVault(params: {
    store: Store;
    startDate: string;
    endDate: string;
    parsed?: Record<string, any>;
  }): Promise<GatewaySessionsUsageResult> {
    const totals = createEmptyGatewayUsageTotals();
    const byProviderMap = new Map<string, GatewayModelUsageRow>();
    const byModelMap = new Map<string, GatewayModelUsageRow>();
    const dailyMap = new Map<string, GatewayDailyRow>();
    const modelDailyMap = new Map<string, GatewayDailyModelUsageRow>();
    const sessions: GatewaySessionsUsageEntry[] = [];
    const startMs = new Date(`${params.startDate}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${params.endDate}T23:59:59.999Z`).getTime();

    const sessionRows = params.store.db
      .prepare(`
        SELECT path
        FROM documents
        WHERE collection = '_sessions' AND active = 1 AND modified_at >= ?
        ORDER BY modified_at DESC
      `)
      .all(`${params.startDate}T00:00:00.000Z`) as { path: string }[];

    for (const row of sessionRows) {
      const doc = params.store.getDocumentWithContent("_sessions", row.path);
      if (!doc) {
        continue;
      }
      const sessionKey = row.path.replace(/\.jsonl$/, "");
      const sessionUsage = createEmptyGatewayUsageTotals();
      const sessionModelUsage = new Map<string, GatewayModelUsageRow>();
      let sessionUpdatedAt = 0;
      let sessionLabel: string | undefined;
      let sessionMessageCount = 0;

      for (const line of doc.content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let parsedLine: Record<string, any>;
        try {
          parsedLine = JSON.parse(trimmed) as Record<string, any>;
        } catch {
          continue;
        }
        const message =
          parsedLine.message && typeof parsedLine.message === "object"
            ? (parsedLine.message as Record<string, any>)
            : null;
        if (!message) {
          continue;
        }
        const role = typeof message.role === "string" ? message.role : "";
        const timestamp = extractTranscriptTimestamp(parsedLine);
        if (!timestamp) {
          continue;
        }
        const ts = timestamp.getTime();
        if (ts > sessionUpdatedAt) {
          sessionUpdatedAt = ts;
        }
        if (!sessionLabel && role === "user") {
          sessionLabel = extractTranscriptText(message.content)?.slice(0, 120);
        }
        if (ts < startMs || ts > endMs) {
          continue;
        }

        const dayKey = timestamp.toISOString().slice(0, 10);
        const daily =
          dailyMap.get(dayKey) ??
          {
            date: dayKey,
            tokens: 0,
            cost: 0,
            messages: 0,
            toolCalls: 0,
            errors: 0,
          };
        daily.messages += 1;
        sessionMessageCount += 1;
        if (role === "assistant" && message.stopReason === "error") {
          daily.errors += 1;
        }
        dailyMap.set(dayKey, daily);

        const provider =
          typeof message.provider === "string"
            ? message.provider
            : typeof parsedLine.provider === "string"
              ? parsedLine.provider
              : undefined;
        const model =
          typeof message.model === "string"
            ? message.model
            : typeof parsedLine.model === "string"
              ? parsedLine.model
              : undefined;
        const usage = parseTranscriptUsageTotals(
          message.usage ?? parsedLine.usage,
          provider,
          model,
          params.parsed,
        );
        if (!usage) {
          continue;
        }

        addGatewayUsageTotals(totals, usage);
        addGatewayUsageTotals(sessionUsage, usage);
        daily.tokens += usage.totalTokens;
        daily.cost += usage.totalCost;
        dailyMap.set(dayKey, daily);

        const providerKey = provider || "unknown";
        const providerRow =
          byProviderMap.get(providerKey) ??
          {
            provider: providerKey,
            totals: createEmptyGatewayUsageTotals(),
            count: 0,
          };
        addGatewayUsageTotals(providerRow.totals, usage);
        providerRow.count += 1;
        byProviderMap.set(providerKey, providerRow);

        const modelKey = `${providerKey}::${model || ""}`;
        const modelRow =
          byModelMap.get(modelKey) ??
          {
            provider: providerKey,
            model,
            totals: createEmptyGatewayUsageTotals(),
            count: 0,
          };
        addGatewayUsageTotals(modelRow.totals, usage);
        modelRow.count += 1;
        byModelMap.set(modelKey, modelRow);

        const sessionModelRow =
          sessionModelUsage.get(modelKey) ??
          {
            provider: providerKey,
            model,
            totals: createEmptyGatewayUsageTotals(),
            count: 0,
          };
        addGatewayUsageTotals(sessionModelRow.totals, usage);
        sessionModelRow.count += 1;
        sessionModelUsage.set(modelKey, sessionModelRow);

        const modelDailyKey = `${dayKey}::${providerKey}::${model || ""}`;
        const modelDaily =
          modelDailyMap.get(modelDailyKey) ??
          {
            date: dayKey,
            provider: providerKey,
            model,
            tokens: 0,
            cost: 0,
            count: 0,
          };
        modelDaily.tokens += usage.totalTokens;
        modelDaily.cost += usage.totalCost;
        modelDaily.count += 1;
        modelDailyMap.set(modelDailyKey, modelDaily);
      }

      if (sessionUsage.totalTokens <= 0 && sessionMessageCount <= 0) {
        continue;
      }
      const dominantModelUsage = Array.from(sessionModelUsage.values()).sort((a, b) => {
        const tokenDiff = (b.totals.totalTokens || 0) - (a.totals.totalTokens || 0);
        if (tokenDiff !== 0) {
          return tokenDiff;
        }
        return (b.count || 0) - (a.count || 0);
      })[0];

      sessions.push({
        key: sessionKey,
        label: sessionLabel,
        sessionId: sessionKey,
        updatedAt: sessionUpdatedAt || undefined,
        agentId: parseAgentIdFromSessionKey(sessionKey),
        modelProvider: dominantModelUsage?.provider,
        model: dominantModelUsage?.model,
        usage: {
          ...sessionUsage,
          modelUsage: Array.from(sessionModelUsage.values()),
        },
      });
    }

    return {
      updatedAt: Date.now(),
      startDate: params.startDate,
      endDate: params.endDate,
      sessions,
      totals,
      aggregates: {
        byModel: Array.from(byModelMap.values()),
        byProvider: Array.from(byProviderMap.values()),
        daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        modelDaily: Array.from(modelDailyMap.values()).sort((a, b) => {
          const dateDiff = a.date.localeCompare(b.date);
          if (dateDiff !== 0) {
            return dateDiff;
          }
          return `${a.provider}/${a.model || ""}`.localeCompare(`${b.provider}/${b.model || ""}`);
        }),
      },
    };
  }

  function parseModelRef(ref: string | undefined): { provider: string; model: string } | null {
    const trimmed = typeof ref === "string" ? ref.trim() : "";
    const slash = trimmed.indexOf("/");
    if (!trimmed || slash <= 0 || slash === trimmed.length - 1) {
      return null;
    }
    return {
      provider: trimmed.slice(0, slash).trim(),
      model: trimmed.slice(slash + 1).trim(),
    };
  }

  function hasPricedCloudModelInOpenClawConfig(
    parsed: Record<string, any>,
    provider: string,
    model: string,
  ): boolean {
    const estimated = resolveModelCostUsdFromOpenClawConfig({
      parsed,
      provider,
      model,
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    return typeof estimated === "number" && Number.isFinite(estimated) && estimated > 0;
  }

  function collectConfiguredModelRefs(
    parsed: Record<string, any>,
    config: AgentsConfigFile,
  ): string[] {
    const refs: string[] = [];
    const push = (value: unknown) => {
      if (typeof value !== "string") {
        return;
      }
      const trimmed = value.trim();
      if (trimmed) {
        refs.push(trimmed);
      }
    };

    for (const agent of config.agents) {
      push(agent.model);
      if (Array.isArray(agent.modelFallbacks)) {
        for (const fallback of agent.modelFallbacks) push(fallback);
      }
    }

    const defaultsModel =
      parsed?.agents?.defaults?.model &&
      typeof parsed.agents.defaults.model === "object" &&
      !Array.isArray(parsed.agents.defaults.model)
        ? (parsed.agents.defaults.model as Record<string, unknown>)
        : undefined;
    push(defaultsModel?.primary);
    if (Array.isArray(defaultsModel?.fallbacks)) {
      for (const fallback of defaultsModel.fallbacks) push(fallback);
    }

    const openclawAgents = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    for (const entry of openclawAgents) {
      if (!entry || typeof entry !== "object") continue;
      const modelRaw = (entry as { model?: unknown }).model;
      if (typeof modelRaw === "string") {
        push(modelRaw);
        continue;
      }
      if (modelRaw && typeof modelRaw === "object" && !Array.isArray(modelRaw)) {
        push((modelRaw as { primary?: unknown }).primary);
        if (Array.isArray((modelRaw as { fallbacks?: unknown[] }).fallbacks)) {
          for (const fallback of (modelRaw as { fallbacks?: unknown[] }).fallbacks ?? []) push(fallback);
        }
      }
    }

    return Array.from(new Set(refs));
  }

  function resolveUsageBenchmarkModel(params: {
    parsed: Record<string, any> | undefined;
    config: AgentsConfigFile;
  }): UsageBenchmarkModel | null {
    if (!params.parsed) {
      return null;
    }

    const pinned = readUsagePricingBenchmarkRef(params.parsed);
    if (pinned) {
      return {
        ...pinned,
        label: `${pinned.provider}/${pinned.model}`,
      };
    }

    const preferredRefs = [
      "openai-codex/gpt-5.4",
      "openai/gpt-5.4",
      ...collectConfiguredModelRefs(params.parsed, params.config),
    ];

    for (const ref of preferredRefs) {
      const parsedRef = parseModelRef(ref);
      if (!parsedRef || isLocalProvider(parsedRef.provider)) {
        continue;
      }
      if (hasPricedCloudModelInOpenClawConfig(params.parsed, parsedRef.provider, parsedRef.model)) {
        return {
          ...parsedRef,
          label: `${parsedRef.provider}/${parsedRef.model}`,
        };
      }
    }

    const providers =
      params.parsed?.models?.providers &&
      typeof params.parsed.models.providers === "object" &&
      !Array.isArray(params.parsed.models.providers)
        ? (params.parsed.models.providers as Record<string, any>)
        : {};
    for (const [providerKey, providerEntry] of Object.entries(providers)) {
      if (isLocalProvider(providerKey)) {
        continue;
      }
      const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
      for (const modelEntry of models) {
        const modelId = typeof modelEntry?.id === "string" ? modelEntry.id.trim() : "";
        if (!modelId) {
          continue;
        }
        if (hasPricedCloudModelInOpenClawConfig(params.parsed, providerKey, modelId)) {
          return {
            provider: providerKey,
            model: modelId,
            label: `${providerKey}/${modelId}`,
          };
        }
      }
    }

    return null;
  }

  function estimateBenchmarkUsd(params: {
    parsed: Record<string, any> | undefined;
    benchmark: UsageBenchmarkModel | null;
    inputTokens?: number;
    outputTokens?: number;
  }): number {
    if (!params.parsed || !params.benchmark) {
      return 0;
    }
    const estimated = resolveModelCostUsdFromOpenClawConfig({
      parsed: params.parsed,
      provider: params.benchmark.provider,
      model: params.benchmark.model,
      usage: {
        inputTokens: params.inputTokens ?? 0,
        outputTokens: params.outputTokens ?? 0,
      },
    });
    return typeof estimated === "number" && Number.isFinite(estimated) ? estimated : 0;
  }

  function resolveUsageOpenClawAgent(config: AgentsConfigFile): AgentConnectionConfig | undefined {
    const configured =
      (
      config.agents.find(
        (entry) => entry.type === "openclaw" && entry.enabled && entry.gatewayUrl && (entry.gatewayToken || entry.token),
      ) ??
      config.agents.find(
        (entry) => entry.type === "openclaw" && entry.gatewayUrl && (entry.gatewayToken || entry.token),
      )
    );
    if (configured) {
      return configured;
    }

    const configPath = resolveDefaultOpenClawConfigPath();
    if (!configPath || !existsSync(configPath)) {
      return undefined;
    }
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, any>;
      const gatewayPort =
        typeof parsed?.gateway?.port === "number" && Number.isFinite(parsed.gateway.port)
          ? parsed.gateway.port
          : 18789;
      const gatewayToken =
        typeof parsed?.gateway?.auth?.token === "string" ? parsed.gateway.auth.token.trim() : "";
      if (!gatewayToken) {
        return undefined;
      }
      return {
        id: "local-openclaw",
        name: "Local OpenClaw",
        type: "openclaw",
        gatewayUrl: `http://localhost:${gatewayPort}`,
        token: gatewayToken,
        gatewayToken,
        hooksPath: normalizeAgentHookEndpointPath(parsed?.hooks?.path),
        enabled: true,
        notifications: { gmail: false, gcalendar: false },
        openclawConfigPath: configPath,
      };
    } catch {
      return undefined;
    }
  }

  function buildUsageOverviewResponse(params: {
    gateway: GatewaySessionsUsageResult;
    parsed?: Record<string, any>;
    config: AgentsConfigFile;
  }): UsageOverviewResponse {
    const benchmark = resolveUsageBenchmarkModel({
      parsed: params.parsed,
      config: params.config,
    });

    const benchmarkInputRate =
      benchmark && params.parsed
        ? estimateBenchmarkUsd({
            parsed: params.parsed,
            benchmark,
            inputTokens: params.gateway.totals.input || 0,
            outputTokens: params.gateway.totals.output || 0,
          }) /
          Math.max(1, (params.gateway.totals.input || 0) + (params.gateway.totals.output || 0))
        : 0;

    const byProvider = (params.gateway.aggregates.byProvider ?? []).map((entry) => {
      const totals = normalizeGatewayUsageTotals(entry.totals);
      const provider = typeof entry.provider === "string" ? entry.provider : "unknown";
      const local = isLocalProvider(provider);
      const estimatedSavingsUsd = local
        ? estimateBenchmarkUsd({
            parsed: params.parsed,
            benchmark,
            inputTokens: totals.input,
            outputTokens: totals.output,
          })
        : 0;
      return {
        provider,
        model: undefined,
        label: provider,
        local,
        requests: typeof entry.count === "number" && Number.isFinite(entry.count) ? entry.count : 0,
        totalTokens: totals.totalTokens,
        inputTokens: totals.input,
        outputTokens: totals.output,
        actualCostUsd: totals.totalCost,
        estimatedSavingsUsd,
        benchmarkEquivalentCostUsd: totals.totalCost + estimatedSavingsUsd,
      } satisfies UsageOverviewBreakdownRow;
    });

    const byModel = (params.gateway.aggregates.byModel ?? []).map((entry) => {
      const totals = normalizeGatewayUsageTotals(entry.totals);
      const provider = typeof entry.provider === "string" ? entry.provider : "unknown";
      const model = typeof entry.model === "string" ? entry.model : undefined;
      const local = isLocalProvider(provider);
      const estimatedSavingsUsd = local
        ? estimateBenchmarkUsd({
            parsed: params.parsed,
            benchmark,
            inputTokens: totals.input,
            outputTokens: totals.output,
          })
        : 0;
      return {
        provider,
        model,
        label: model ? `${provider}/${model}` : provider,
        local,
        requests: typeof entry.count === "number" && Number.isFinite(entry.count) ? entry.count : 0,
        totalTokens: totals.totalTokens,
        inputTokens: totals.input,
        outputTokens: totals.output,
        actualCostUsd: totals.totalCost,
        estimatedSavingsUsd,
        benchmarkEquivalentCostUsd: totals.totalCost + estimatedSavingsUsd,
      } satisfies UsageOverviewBreakdownRow;
    });

    const agentNames = new Map(params.config.agents.map((agent) => [agent.id, agent.name]));
    const byAgentMap = new Map<string, UsageOverviewAgentRow>();
    for (const session of params.gateway.sessions ?? []) {
      const agentId = typeof session.agentId === "string" && session.agentId.trim() ? session.agentId.trim() : "unknown";
      const usage = session.usage ? normalizeGatewayUsageTotals(session.usage) : createEmptyGatewayUsageTotals();
      const provider = typeof session.modelProvider === "string" ? session.modelProvider : "";
      const local = isLocalProvider(provider);
      const requestCount = Array.isArray(session.usage?.modelUsage)
        ? session.usage.modelUsage.reduce(
            (sum, entry) => sum + (typeof entry.count === "number" && Number.isFinite(entry.count) ? entry.count : 0),
            0,
          )
        : usage.totalTokens > 0
          ? 1
          : 0;
      const estimatedSavingsUsd = local
        ? estimateBenchmarkUsd({
            parsed: params.parsed,
            benchmark,
            inputTokens: usage.input,
            outputTokens: usage.output,
          })
        : 0;
      const current = byAgentMap.get(agentId) ?? {
        agentId,
        agentName: agentNames.get(agentId) ?? agentId,
        requests: 0,
        totalTokens: 0,
        localTokens: 0,
        cloudTokens: 0,
        actualCostUsd: 0,
        estimatedSavingsUsd: 0,
      };
      current.requests += requestCount;
      current.totalTokens += usage.totalTokens;
      current.actualCostUsd += usage.totalCost;
      current.estimatedSavingsUsd += estimatedSavingsUsd;
      if (local) {
        current.localTokens += usage.totalTokens;
      } else {
        current.cloudTokens += usage.totalTokens;
      }
      byAgentMap.set(agentId, current);
    }

    const dailyMap = new Map<string, UsageOverviewDailyRow>();
    for (const day of params.gateway.aggregates.daily ?? []) {
      dailyMap.set(day.date, {
        date: day.date,
        tokens: typeof day.tokens === "number" && Number.isFinite(day.tokens) ? day.tokens : 0,
        localTokens: 0,
        cloudTokens: 0,
        requests: 0,
        localRequests: 0,
        cloudRequests: 0,
        actualCostUsd: typeof day.cost === "number" && Number.isFinite(day.cost) ? day.cost : 0,
        estimatedSavingsUsd: 0,
        benchmarkEquivalentCostUsd: 0,
        messages: typeof day.messages === "number" && Number.isFinite(day.messages) ? day.messages : 0,
        toolCalls: typeof day.toolCalls === "number" && Number.isFinite(day.toolCalls) ? day.toolCalls : 0,
        errors: typeof day.errors === "number" && Number.isFinite(day.errors) ? day.errors : 0,
      });
    }
    for (const row of params.gateway.aggregates.modelDaily ?? []) {
      const date = typeof row.date === "string" ? row.date : "";
      if (!date) continue;
      const provider = typeof row.provider === "string" ? row.provider : "";
      const local = isLocalProvider(provider);
      const current =
        dailyMap.get(date) ??
        ({
          date,
          tokens: 0,
          localTokens: 0,
          cloudTokens: 0,
          requests: 0,
          localRequests: 0,
          cloudRequests: 0,
          actualCostUsd: 0,
          estimatedSavingsUsd: 0,
          benchmarkEquivalentCostUsd: 0,
          messages: 0,
          toolCalls: 0,
          errors: 0,
        } satisfies UsageOverviewDailyRow);
      const tokens = typeof row.tokens === "number" && Number.isFinite(row.tokens) ? row.tokens : 0;
      const requests = typeof row.count === "number" && Number.isFinite(row.count) ? row.count : 0;
      current.requests += requests;
      if (local) {
        current.localTokens += tokens;
        current.localRequests += requests;
        current.estimatedSavingsUsd += tokens * benchmarkInputRate;
      } else {
        current.cloudTokens += tokens;
        current.cloudRequests += requests;
      }
      current.benchmarkEquivalentCostUsd = current.actualCostUsd + current.estimatedSavingsUsd;
      dailyMap.set(date, current);
    }

    const totalLocalTokens = byProvider
      .filter((entry) => entry.local)
      .reduce((sum, entry) => sum + entry.totalTokens, 0);
    const totalCloudTokens = byProvider
      .filter((entry) => !entry.local)
      .reduce((sum, entry) => sum + entry.totalTokens, 0);
    const totalLocalRequests = byProvider
      .filter((entry) => entry.local)
      .reduce((sum, entry) => sum + entry.requests, 0);
    const totalCloudRequests = byProvider
      .filter((entry) => !entry.local)
      .reduce((sum, entry) => sum + entry.requests, 0);
    const estimatedSavingsUsd = byProvider.reduce((sum, entry) => sum + entry.estimatedSavingsUsd, 0);
    const requestCount = byProvider.reduce((sum, entry) => sum + entry.requests, 0);

    return {
      generatedAt: new Date(params.gateway.updatedAt || Date.now()).toISOString(),
      startDate: params.gateway.startDate,
      endDate: params.gateway.endDate,
      benchmarkModel: benchmark,
      totals: {
        requestCount,
        totalTokens: params.gateway.totals.totalTokens || 0,
        inputTokens: params.gateway.totals.input || 0,
        outputTokens: params.gateway.totals.output || 0,
        localTokens: totalLocalTokens,
        cloudTokens: totalCloudTokens,
        localRequests: totalLocalRequests,
        cloudRequests: totalCloudRequests,
        actualCostUsd: params.gateway.totals.totalCost || 0,
        estimatedSavingsUsd,
        benchmarkEquivalentCostUsd: (params.gateway.totals.totalCost || 0) + estimatedSavingsUsd,
        localShare:
          params.gateway.totals.totalTokens > 0
            ? totalLocalTokens / params.gateway.totals.totalTokens
            : 0,
      },
      byProvider: byProvider.toSorted((a, b) => b.benchmarkEquivalentCostUsd - a.benchmarkEquivalentCostUsd),
      byModel: byModel.toSorted((a, b) => b.benchmarkEquivalentCostUsd - a.benchmarkEquivalentCostUsd),
      byAgent: Array.from(byAgentMap.values()).toSorted((a, b) => (b.actualCostUsd + b.estimatedSavingsUsd) - (a.actualCostUsd + a.estimatedSavingsUsd)),
      daily: Array.from(dailyMap.values()).toSorted((a, b) => a.date.localeCompare(b.date)),
    };
  }

  function readLatestOpenClawUsage(
    agent: Pick<AgentConnectionConfig, "id" | "openclawConfigPath" | "model">,
  ): AgentLatestUsageSummary | undefined {
    const resolved = resolveOpenClawConfigForAgent(agent);
    if (!resolved) {
      return undefined;
    }
    for (const storePath of listOpenClawSessionStorePaths(agent)) {
      if (!existsSync(storePath)) {
        continue;
      }
      try {
        const raw = readFileSync(storePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, Record<string, any>>;
        const latest = Object.values(parsed)
          .filter((entry) => entry && typeof entry === "object")
          .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0];
        if (!latest) {
          continue;
        }
        const provider = typeof latest.modelProvider === "string" ? latest.modelProvider.trim() : "";
        const model = typeof latest.model === "string" ? latest.model.trim() : "";
        if (!provider || !model) {
          continue;
        }
        const inputTokens =
          typeof latest.inputTokens === "number" && Number.isFinite(latest.inputTokens)
            ? latest.inputTokens
            : undefined;
        const outputTokens =
          typeof latest.outputTokens === "number" && Number.isFinite(latest.outputTokens)
            ? latest.outputTokens
            : undefined;
        const totalTokens =
          typeof latest.totalTokens === "number" && Number.isFinite(latest.totalTokens)
            ? latest.totalTokens
            : undefined;
        const fallbackFrom =
          typeof agent.model === "string" &&
          agent.model.trim() &&
          agent.model.trim() !== `${provider}/${model}` &&
          agent.model.includes("/")
            ? (() => {
                const [selectedProvider, ...selectedModelParts] = agent.model.trim().split("/");
                const selectedModel = selectedModelParts.join("/");
                return selectedProvider && selectedModel
                  ? { provider: selectedProvider, model: selectedModel }
                  : null;
              })()
            : null;
        const summary: AgentLatestUsageSummary = {
          provider,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          totalTokensFresh: latest.totalTokensFresh !== false,
          local: isLocalProvider(provider),
          usedAt:
            typeof latest.updatedAt === "number" && Number.isFinite(latest.updatedAt)
              ? new Date(latest.updatedAt).toISOString()
              : undefined,
          fallbackFrom,
        };
        summary.estimatedCostUsd = resolveModelCostUsdFromOpenClawConfig({
          parsed: resolved.parsed,
          provider,
          model,
          usage: summary,
        });
        return summary;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  function readLatestOpenClawUsageForAgentId(agentId: string): AgentLatestUsageSummary | undefined {
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (!normalizedAgentId) {
      return undefined;
    }
    const config = getAgentsConfig();
    const agent = config.agents.find((entry) => entry.id === normalizedAgentId && entry.type === "openclaw");
    if (!agent) {
      return undefined;
    }
    return readLatestOpenClawUsage({
      id: agent.id,
      openclawConfigPath: agent.openclawConfigPath,
      model: agent.model,
    });
  }

  function resolveOllamaApiBaseFromConfig(configPath?: string): string {
    const managedBase =
      process.env.STRAJA_OLLAMA_BASE_URL?.trim() ||
      process.env.OLLAMA_API_BASE?.trim() ||
      process.env.OLLAMA_BASE_URL?.trim() ||
      "";
    const fallbackBase = managedBase || "http://127.0.0.1:11435";
    if (!configPath || !existsSync(configPath)) {
      return fallbackBase;
    }
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, any>;
      const providers =
        parsed?.models?.providers &&
        typeof parsed.models.providers === "object" &&
        !Array.isArray(parsed.models.providers)
          ? (parsed.models.providers as Record<string, any>)
          : {};
      const providerKey = Object.keys(providers).find(
        (key) => normalizeProviderKey(key) === "ollama",
      );
      const baseUrl =
        providerKey && typeof providers[providerKey]?.baseUrl === "string"
          ? providers[providerKey].baseUrl.trim()
          : "";
      const trimmed = (baseUrl || fallbackBase).replace(/\/+$/, "");
      return trimmed.replace(/\/v1$/i, "");
    } catch {
      return fallbackBase;
    }
  }

  function listOpenClawStateDirCandidates(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
  ): string[] {
    const seen = new Set<string>();
    const candidates = [
      process.env.OPENCLAW_STATE_DIR,
      join(homedir(), ".openclaw"),
      ...listOpenClawConfigCandidatePaths(agent).map((configPath) => dirname(configPath)),
    ];
    const resolved: string[] = [];
    for (const raw of candidates) {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        continue;
      }
      const absolute = resolve(trimmed);
      if (seen.has(absolute)) {
        continue;
      }
      seen.add(absolute);
      resolved.push(absolute);
    }
    return resolved;
  }

  function listOpenClawAgentModelsPaths(
    agent: Pick<AgentConnectionConfig, "id" | "openclawConfigPath">,
  ): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const stateDir of listOpenClawStateDirCandidates(agent)) {
      const candidate = join(stateDir, "agents", agent.id, "agent", "models.json");
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      paths.push(candidate);
    }
    return paths;
  }

  function buildOpenClawLocalModelDefinition(id: string): Record<string, unknown> {
    const lower = id.toLowerCase();
    const reasoning =
      lower.includes("r1") || lower.includes("reasoning") || lower.includes("think");
    return {
      id,
      name: id,
      reasoning,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 128000,
      maxTokens: 8192,
    };
  }

  function collectAgentLocalModelIds(
    agent: Pick<AgentConnectionConfig, "model" | "modelFallbacks">,
  ): string[] {
    const ids = new Set<string>();
    const addRef = (value: unknown) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) {
        return;
      }
      const slash = trimmed.indexOf("/");
      if (slash <= 0) {
        return;
      }
      const provider = trimmed.slice(0, slash).trim().toLowerCase();
      const modelId = trimmed.slice(slash + 1).trim();
      if (provider !== "ollama" || !modelId) {
        return;
      }
      ids.add(modelId);
    };
    addRef(agent.model);
    for (const fallback of agent.modelFallbacks ?? []) {
      addRef(fallback);
    }
    return Array.from(ids);
  }

  async function syncAgentModelsCatalog(
    agent: Pick<AgentConnectionConfig, "id" | "model" | "modelFallbacks" | "openclawConfigPath">,
  ): Promise<boolean> {
    const localModelIds = collectAgentLocalModelIds(agent);
    if (localModelIds.length === 0) {
      return false;
    }
    let wroteAny = false;
    const ollamaBaseUrl = resolveOllamaApiBaseFromConfig(agent.openclawConfigPath);
    const ollamaProvider = {
      baseUrl: ollamaBaseUrl,
      api: "ollama",
      apiKey: "OLLAMA_API_KEY",
      models: localModelIds.map((id) => buildOpenClawLocalModelDefinition(id)),
    };
    for (const modelsPath of listOpenClawAgentModelsPaths(agent)) {
      try {
        let parsed: Record<string, any> = {};
        try {
          const raw = await readFile(modelsPath, "utf-8");
          parsed = JSON.parse(raw) as Record<string, any>;
        } catch {
          parsed = {};
        }
        if (!parsed || typeof parsed !== "object") {
          parsed = {};
        }
        if (!parsed.providers || typeof parsed.providers !== "object" || Array.isArray(parsed.providers)) {
          parsed.providers = {};
        }
        parsed.providers.ollama = ollamaProvider;
        const next = JSON.stringify({ providers: parsed.providers }, null, 2) + "\n";
        const existing = existsSync(modelsPath) ? await readFile(modelsPath, "utf-8") : "";
        if (existing === next) {
          continue;
        }
        await mkdir(dirname(modelsPath), { recursive: true });
        await writeFile(modelsPath, next, "utf-8");
        wroteAny = true;
      } catch {
        continue;
      }
    }
    return wroteAny;
  }

  function resolveDefaultOpenClawConfigPathForOllama(): string {
    const config = getAgentsConfig();
    const firstOpenClawAgent = config.agents.find((agent) => agent.type === "openclaw");
    return (
      firstOpenClawAgent?.openclawConfigPath ||
      process.env.OPENCLAW_CONFIG_PATH ||
      join(homedir(), ".openclaw", "openclaw.json")
    );
  }

  function normalizeOllamaModelName(raw: unknown): string {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return "";
    return trimmed.replace(/^ollama\//i, "");
  }

  function parseOllamaErrorMessage(rawText: string, fallbackStatus?: number): string {
    const text = rawText.trim();
    if (!text) {
      return fallbackStatus ? `Ollama request failed (HTTP ${fallbackStatus}).` : "Ollama request failed.";
    }
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      const errorMessage = typeof parsed?.error === "string" ? parsed.error.trim() : "";
      if (errorMessage) {
        return errorMessage;
      }
    } catch {
      // Fall back to raw text below.
    }
    return text;
  }

  function resolveWorkspaceAppDataDir(): string {
    const override = process.env.STRAJA_WORKSPACE_APP_DATA_DIR?.trim();
    if (override) {
      return resolve(override);
    }
    if (process.platform === "darwin") {
      return join(homedir(), "Library", "Application Support", "StrajaWorkspaceAlpha");
    }
    const stateHome = process.env.XDG_STATE_HOME?.trim();
    return stateHome ? join(stateHome, "straja-workspace-alpha") : join(homedir(), ".local", "state", "straja-workspace-alpha");
  }

  function resolveManagedOllamaInstallDir(): string {
    const explicit = process.env.STRAJA_WORKSPACE_OLLAMA_INSTALL_DIR?.trim();
    if (explicit) {
      return resolve(explicit);
    }
    return join(resolveWorkspaceAppDataDir(), "runtime-tools", "ollama");
  }

  function resolveManagedOllamaBinaryPath(): string {
    const binaryName = process.platform === "win32" ? "ollama.exe" : "ollama";
    return join(resolveManagedOllamaInstallDir(), binaryName);
  }

  function normalizeConfiguredOllamaBinaryPath(rawPath: string | undefined): string | undefined {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      return undefined;
    }
    const resolved = resolve(trimmed);
    if (existsSync(resolved)) {
      return resolved;
    }
    if (process.platform === "darwin") {
      const appBundleBinary = join(resolved, "Contents", "Resources", "ollama");
      if (existsSync(appBundleBinary)) {
        return appBundleBinary;
      }
    }
    const nestedBinary = join(resolved, process.platform === "win32" ? "ollama.exe" : "ollama");
    if (existsSync(nestedBinary)) {
      return nestedBinary;
    }
    return undefined;
  }

  function resolveWorkspaceOllamaBinaryPath(): string | undefined {
    return normalizeConfiguredOllamaBinaryPath(process.env.STRAJA_WORKSPACE_OLLAMA_PATH)
      ?? (existsSync(resolveManagedOllamaBinaryPath()) ? resolveManagedOllamaBinaryPath() : undefined);
  }

  function resolveManagedOllamaRuntimeHome(): string {
    return join(resolveWorkspaceAppDataDir(), "ollama");
  }

  function resolveManagedOllamaRuntimeLogPath(): string {
    return join(resolveManagedOllamaRuntimeHome(), "ollama.log");
  }

  function resolveManagedOllamaRuntimePidFile(): string {
    return join(resolveManagedOllamaRuntimeHome(), "ollama.pid");
  }

  function resolveManagedOllamaPort(): number {
    const envPort = process.env.STRAJA_OLLAMA_PORT?.trim();
    if (envPort) {
      const parsed = Number.parseInt(envPort, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
    try {
      const baseUrl = new URL(resolveOllamaApiBaseFromConfig(resolveDefaultOpenClawConfigPathForOllama()));
      const parsed = Number.parseInt(baseUrl.port || "", 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      // Ignore malformed base URL and fall back.
    }
    return 11435;
  }

  function readManagedOllamaPid(): number | null {
    const pidFile = resolveManagedOllamaRuntimePidFile();
    if (!existsSync(pidFile)) {
      return null;
    }
    const raw = readFileSync(pidFile, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  function isPidRunning(pid: number | null): boolean {
    if (!pid) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function clearManagedOllamaPidFile(): void {
    const pidFile = resolveManagedOllamaRuntimePidFile();
    try {
      if (existsSync(pidFile)) {
        rmSync(pidFile, { force: true });
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  function resolveManagedOllamaDownloadSpec():
    | { supported: true; url: string; archiveName: string }
    | { supported: false; error: string } {
    if (process.platform === "darwin") {
      return {
        supported: true,
        url: "https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz",
        archiveName: "ollama-darwin.tgz",
      };
    }
    if (process.platform === "linux") {
      const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : "";
      if (arch) {
        return {
          supported: true,
          url: `https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${arch}.tgz`,
          archiveName: `ollama-linux-${arch}.tgz`,
        };
      }
    }
    return {
      supported: false,
      error: `Managed local runtime install is not supported on ${process.platform}/${process.arch}.`,
    };
  }

  function readManagedOllamaVersion(binaryPath: string): string | undefined {
    if (!existsSync(binaryPath)) {
      return undefined;
    }
    try {
      const result = nodeSpawnSync(binaryPath, ["--version"], {
        encoding: "utf8",
        timeout: 5_000,
      });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
      const match = output.match(/version is ([^\s]+)/i) || output.match(/\b(\d+\.\d+\.\d+)\b/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  async function getManagedOllamaRuntimeStatus() {
    const installDir = resolveManagedOllamaInstallDir();
    const binaryPath = resolveWorkspaceOllamaBinaryPath();
    const installed = Boolean(binaryPath);
    const baseUrl = resolveOllamaApiBaseFromConfig(resolveDefaultOpenClawConfigPathForOllama());
    const downloadSpec = resolveManagedOllamaDownloadSpec();
    const managedPid = readManagedOllamaPid();
    const managedRunning = isPidRunning(managedPid);
    if (managedPid && !managedRunning) {
      clearManagedOllamaPidFile();
    }
    const port = resolveManagedOllamaPort();
    const listeningPids = listPidsListeningOnPort(port);
    const portListening = listeningPids.length > 0;
    const running = managedRunning || portListening;
    const status: {
      supported: boolean;
      installed: boolean;
      running: boolean;
      available: boolean;
      source: "managed" | "external" | "none";
      baseUrl: string;
      platform: string;
      arch: string;
      installDir: string;
      binaryPath?: string;
      version?: string;
      error?: string;
    } = {
      supported: downloadSpec.supported,
      installed,
      running,
      available: false,
      source: installed ? "managed" : "none",
      baseUrl,
      platform: process.platform,
      arch: process.arch,
      installDir: binaryPath ? dirname(binaryPath) : installDir,
      binaryPath,
      version: binaryPath ? readManagedOllamaVersion(binaryPath) : undefined,
      error: installed
        ? running
          ? "Local runtime process is starting and not ready yet."
          : "Local runtime is installed but currently stopped."
        : portListening
          ? "External runtime process is starting and not ready yet."
          : undefined as string | undefined,
    };
    if (!downloadSpec.supported) {
      status.error = downloadSpec.error;
      return status;
    }
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        status.available = true;
        status.running = true;
        status.source = installed ? "managed" : "external";
        status.error = undefined;
      } else {
        status.source = installed ? "managed" : portListening ? "external" : status.source;
        status.error = installed
          ? status.running
            ? `Local runtime process is running but not ready yet (HTTP ${response.status}).`
            : "Local runtime is installed but currently stopped."
          : portListening
            ? `External runtime process is running but not ready yet (HTTP ${response.status}).`
            : `HTTP ${response.status}`;
      }
    } catch (err: any) {
      if (!status.error && (installed || portListening)) {
        status.error = installed
          ? status.running
            ? "Local runtime process is starting and not ready yet."
            : "Local runtime is installed but currently stopped."
          : "External runtime process is starting and not ready yet.";
      }
    }
    return status;
  }

  async function ensureManagedOllamaRuntimeAvailable(): Promise<Awaited<ReturnType<typeof getManagedOllamaRuntimeStatus>>> {
    let status = await getManagedOllamaRuntimeStatus();
    if (!status.installed || status.available) {
      return status;
    }
    try {
      await ensureManagedOllamaRuntimeStarted();
      status = await getManagedOllamaRuntimeStatus();
    } catch (err: any) {
      return {
        ...status,
        error: err?.message || status.error || "fetch failed",
      };
    }
    return status;
  }

  let managedOllamaInstallPromise: Promise<void> | null = null;

  async function waitForManagedOllamaAvailability(baseUrl: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(1_500),
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // Keep polling.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    return false;
  }

  async function waitForManagedOllamaPortToClear(port: number, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (listPidsListeningOnPort(port).length === 0) {
        return true;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    return false;
  }

  async function stopProcessesListeningOnManagedOllamaPort(): Promise<void> {
    const port = resolveManagedOllamaPort();
    const pids = listPidsListeningOnPort(port);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore pids we cannot signal.
      }
    }
    if (pids.length > 0) {
      await waitForManagedOllamaPortToClear(port, 5_000);
    }
    const survivors = listPidsListeningOnPort(port);
    for (const pid of survivors) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore pids we cannot signal.
      }
    }
    if (survivors.length > 0) {
      await waitForManagedOllamaPortToClear(port, 5_000);
    }
  }

  async function ensureManagedOllamaRuntimeStarted(options?: { takeover?: boolean }): Promise<void> {
    const binaryPath = resolveManagedOllamaBinaryPath();
    if (!existsSync(binaryPath)) {
      throw new Error("Local runtime binary is not installed.");
    }
    const baseUrl = resolveOllamaApiBaseFromConfig(resolveDefaultOpenClawConfigPathForOllama());
    const currentStatus = await getManagedOllamaRuntimeStatus();
    if (currentStatus.available && (!options?.takeover || currentStatus.source === "managed")) {
      return;
    }
    if (options?.takeover) {
      await stopProcessesListeningOnManagedOllamaPort();
      clearManagedOllamaPidFile();
    }
    const runtimeHome = resolveManagedOllamaRuntimeHome();
    const modelsDir = join(runtimeHome, "models");
    const tmpDir = join(runtimeHome, "tmp");
    const logPath = resolveManagedOllamaRuntimeLogPath();
    const pidFile = resolveManagedOllamaRuntimePidFile();
    await mkdir(runtimeHome, { recursive: true });
    await mkdir(modelsDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    const existingPid = readManagedOllamaPid();
    if (existingPid) {
      try {
        process.kill(existingPid, 0);
      } catch {
        clearManagedOllamaPidFile();
      }
    }

    const logFd = openSync(logPath, "a");
    const child = nodeSpawn(binaryPath, ["serve"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        OLLAMA_HOST: `127.0.0.1:${resolveManagedOllamaPort()}`,
        OLLAMA_MODELS: modelsDir,
        OLLAMA_TMPDIR: tmpDir,
      },
    });
    if (!child.pid) {
      throw new Error("Failed to start local runtime.");
    }
    writeFileSync(pidFile, `${child.pid}\n`, "utf-8");
    child.unref();

    const ready = await waitForManagedOllamaAvailability(baseUrl);
    if (!ready) {
      throw new Error("Local runtime installed but did not become healthy.");
    }
  }

  async function stopManagedOllamaRuntime(): Promise<void> {
    const pid = readManagedOllamaPid();
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore already-exited pid.
      }
    }
    clearManagedOllamaPidFile();
  }

  async function restartManagedOllamaRuntime(): Promise<void> {
    await stopManagedOllamaRuntime();
    await ensureManagedOllamaRuntimeStarted({ takeover: true });
  }

  async function installManagedOllamaRuntime(): Promise<void> {
    if (managedOllamaInstallPromise) {
      return managedOllamaInstallPromise;
    }
    managedOllamaInstallPromise = (async () => {
      const downloadSpec = resolveManagedOllamaDownloadSpec();
      if (!downloadSpec.supported) {
        throw new Error(downloadSpec.error);
      }
      const installDir = resolveManagedOllamaInstallDir();
      const tempRoot = await mkdtemp(join(tmpdir(), "straja-ollama-install-"));
      try {
        const archivePath = join(tempRoot, downloadSpec.archiveName);
        const extractDir = join(tempRoot, "extract");
        await mkdir(extractDir, { recursive: true });

        const response = await fetch(downloadSpec.url, {
          signal: AbortSignal.timeout(300_000),
        });
        if (!response.ok) {
          throw new Error(`Failed to download local runtime (HTTP ${response.status}).`);
        }
        const archiveBuffer = Buffer.from(await response.arrayBuffer());
        await writeFile(archivePath, archiveBuffer);

        const extractResult = nodeSpawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
          encoding: "utf8",
          timeout: 60_000,
        });
        if (extractResult.status !== 0) {
          const details = `${extractResult.stdout || ""}\n${extractResult.stderr || ""}`.trim();
          throw new Error(details || "Failed to extract local runtime archive.");
        }

        const extractedBinaryPath = join(extractDir, process.platform === "win32" ? "ollama.exe" : "ollama");
        if (!existsSync(extractedBinaryPath)) {
          throw new Error("Downloaded local runtime archive did not contain an ollama binary.");
        }

        await rm(installDir, { recursive: true, force: true });
        await cp(extractDir, installDir, { recursive: true, force: true });
        await ensureManagedOllamaRuntimeStarted({ takeover: true });
      } finally {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        managedOllamaInstallPromise = null;
      }
    })();
    return managedOllamaInstallPromise;
  }

  async function removeManagedOllamaRuntime(): Promise<void> {
    await stopManagedOllamaRuntime();
    await rm(resolveManagedOllamaInstallDir(), { recursive: true, force: true });
  }

  async function syncOpenClawAuthProfileConfig(
    agent: Pick<AgentConnectionConfig, "type" | "openclawConfigPath">,
    params: {
      profileId: string;
      provider: AgentUpstreamAuthProvider;
      mode: AgentUpstreamAuthMode;
    },
  ): Promise<boolean> {
    if (agent.type !== "openclaw") {
      return false;
    }
    const configPath = resolvePreferredOpenClawConfigPath(agent);
    if (!configPath || !existsSync(configPath)) {
      return false;
    }
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.hooks !== "object" || parsed.hooks === null) {
      parsed.hooks = {};
    }
    (parsed.hooks as Record<string, unknown>).path = normalizeOpenClawHooksBasePath(
      (parsed.hooks as { path?: string }).path,
    );
    let next = applyAuthProfileConfigLike(parsed, params);
    if (params.provider === "openai" || params.provider === "openai-codex") {
      next = applyPrimaryModelConfigLike(next, OPENAI_CODEX_DEFAULT_MODEL);
    }
    await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    return true;
  }

  async function syncOpenClawVaultPluginConfig(
    agent: Pick<AgentConnectionConfig, "type" | "openclawConfigPath">,
    params: {
      authToken?: string;
      baseUrl?: string;
      memoryPromptInjectionMode?: AgentMemoryPromptInjectionMode;
    },
  ): Promise<boolean> {
    if (agent.type !== "openclaw") {
      return false;
    }
    const configPath = resolvePreferredOpenClawConfigPath(agent);
    if (!configPath || !existsSync(configPath)) {
      return false;
    }
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, any>;
    applyOpenClawVaultPluginConfig(parsed, params);
    await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    return true;
  }

  function listLocalOpenClawConfigCandidatePaths(): string[] {
    const seen = new Set<string>();
    const candidates = [
      process.env.OPENCLAW_CONFIG_PATH,
      resolveWorkspaceDevOpenClawConfigPath(),
      join(homedir(), ".openclaw", "openclaw.json"),
    ];
    const resolved: string[] = [];
    for (const raw of candidates) {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        continue;
      }
      const absolute = resolve(trimmed);
      if (seen.has(absolute)) {
        continue;
      }
      seen.add(absolute);
      resolved.push(absolute);
    }
    return resolved;
  }

  function resolveDefaultOpenClawConfigPath(): string {
    for (const configPath of listLocalOpenClawConfigCandidatePaths()) {
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    return process.env.OPENCLAW_CONFIG_PATH || join(homedir(), ".openclaw", "openclaw.json");
  }

  async function readLocalOpenClawConfig(): Promise<{
    configPath: string;
    config: Record<string, any>;
  }> {
    const configPath = resolveDefaultOpenClawConfigPath();
    if (!configPath || !existsSync(configPath)) {
      throw new Error("Local openclaw.json not found");
    }
    const raw = await readFile(configPath, "utf-8");
    return {
      configPath,
      config: JSON.parse(raw) as Record<string, any>,
    };
  }

  function buildOpenClawOrchestrationSettingsPayload(params: {
    configPath: string;
    config: Record<string, any>;
  }) {
    const orchestration = params.config?.agents?.defaults?.orchestration;
    const router = orchestration?.router;
    const optimizationEnabled = orchestration?.enabled === true;
    const gatewayPort = Number.parseInt(String(params.config?.gateway?.port ?? ""), 10);
    const gatewayUrl = Number.isInteger(gatewayPort) && gatewayPort > 0
      ? `http://localhost:${gatewayPort}`
      : undefined;
    return {
      detected: true,
      configPath: params.configPath,
      gatewayUrl,
      optimizationEnabled,
      routerModel:
        typeof router?.model === "string" && router.model.trim().length > 0
          ? router.model.trim()
          : "ollama/gemma4:e4b",
      updatedAt:
        typeof params.config?.meta?.lastTouchedAt === "string"
          ? params.config.meta.lastTouchedAt
          : undefined,
    };
  }

  async function updateLocalOpenClawOrchestrationSettings(params: {
    enabled?: boolean;
  }): Promise<{
    configPath: string;
    config: Record<string, any>;
  }> {
    const { configPath, config } = await readLocalOpenClawConfig();
    const currentOrchestration = config?.agents?.defaults?.orchestration;
    const nextEnabled = params.enabled ?? currentOrchestration?.enabled ?? false;
    const touchedAt = new Date().toISOString();
    const patch = {
      agents: {
        defaults: {
          orchestration: {
            enabled: nextEnabled,
            router: {
              enabled: nextEnabled,
              model: "ollama/gemma4:e4b",
            },
            localFastPath: {
              enabled: nextEnabled,
              model: "ollama/gemma4:e4b",
              requireFlowContext: false,
            },
          },
        },
      },
      meta: {
        lastTouchedAt: touchedAt,
      },
    } satisfies Record<string, unknown>;

    const gatewayToken =
      typeof config?.gateway?.auth?.token === "string" && config.gateway.auth.token.trim().length > 0
        ? config.gateway.auth.token.trim()
        : "";
    const gatewayPort = Number.parseInt(String(config?.gateway?.port ?? ""), 10);
    const gatewayUrl = Number.isInteger(gatewayPort) && gatewayPort > 0
      ? `http://localhost:${gatewayPort}`
      : "";

    let patchedLive = false;
    if (gatewayToken && gatewayUrl) {
      try {
        const configSnapshot = (await agentGatewayRpc(gatewayUrl, gatewayToken, "config.get", {})) as {
          hash?: string;
          baseHash?: string;
        };
        const baseHash = configSnapshot?.hash ?? configSnapshot?.baseHash;
        if (!baseHash) {
          throw new Error("Could not read live gateway config hash");
        }
        await agentGatewayRpc(gatewayUrl, gatewayToken, "config.patch", {
          baseHash,
          raw: JSON.stringify(patch),
        });
        patchedLive = true;
      } catch (err: any) {
        log(`${ts()} orchestration settings: live patch failed, falling back to file write: ${err?.message || err}`);
      }
    }

    const next = applyOpenClawOptimizationSetting(config, nextEnabled, touchedAt);
    await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

    return await readLocalOpenClawConfig();
  }

  async function refreshOpenClawAgentRuntimeConfig(agent: AgentConnectionConfig): Promise<boolean> {
    if (agent.type !== "openclaw") {
      return false;
    }
    const configPath = resolvePreferredOpenClawConfigPath(agent);
    if (!configPath || !existsSync(configPath)) {
      return false;
    }
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, any>;
    const gatewayPort = Number.parseInt(String(parsed?.gateway?.port ?? ""), 10);
    const nextGatewayUrl = Number.isInteger(gatewayPort) && gatewayPort > 0
      ? `http://localhost:${gatewayPort}`
      : agent.gatewayUrl;
    const nextGatewayToken =
      typeof parsed?.gateway?.auth?.token === "string" && parsed.gateway.auth.token.trim().length > 0
        ? parsed.gateway.auth.token
        : agent.gatewayToken;
    const nextHooksToken =
      typeof parsed?.hooks?.token === "string" && parsed.hooks.token.trim().length > 0
        ? parsed.hooks.token
        : agent.token;
    const nextHooksPath = normalizeAgentHookEndpointPath(parsed?.hooks?.path);

    let changed = false;
    if (agent.gatewayUrl !== nextGatewayUrl) {
      agent.gatewayUrl = nextGatewayUrl;
      changed = true;
    }
    if (nextGatewayToken && agent.gatewayToken !== nextGatewayToken) {
      agent.gatewayToken = nextGatewayToken;
      changed = true;
    }
    if (agent.token !== nextHooksToken) {
      agent.token = nextHooksToken;
      changed = true;
    }
    if (agent.hooksPath !== nextHooksPath) {
      agent.hooksPath = nextHooksPath;
      changed = true;
    }
    if (agent.openclawConfigPath !== configPath) {
      agent.openclawConfigPath = configPath;
      changed = true;
    }
    const runtimeAgentModel = readOpenClawAgentPrimaryModel(parsed, agent.id);
    const runtimeAgentModelFallbacks = readOpenClawAgentModelFallbacks(parsed, agent.id);
    const runtimeAgentModelPolicy = readOpenClawAgentModelPolicy(parsed, agent.id);
    const normalizedRuntimeModelStack = normalizeAgentModelStackForPolicy({
      model: runtimeAgentModel,
      fallbacks: runtimeAgentModelFallbacks,
      policy: runtimeAgentModelPolicy,
    });
    const runtimeModelNeedsRepair =
      normalizedRuntimeModelStack.model !== runtimeAgentModel ||
      JSON.stringify(normalizedRuntimeModelStack.fallbacks ?? []) !== JSON.stringify(runtimeAgentModelFallbacks ?? []) ||
      normalizedRuntimeModelStack.policy !== runtimeAgentModelPolicy;
    if (runtimeModelNeedsRepair) {
      const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
      const entry = list.find((value: { id?: string }) => value?.id === agent.id);
      if (entry && typeof entry === "object") {
        applyOpenClawAgentModelConfig(
          entry as Record<string, any>,
          normalizedRuntimeModelStack.model,
          normalizedRuntimeModelStack.fallbacks,
          normalizedRuntimeModelStack.policy,
        );
      }
      if (
        normalizeOpenClawAgentId(resolveDefaultOpenClawAgentId(parsed)) ===
        normalizeOpenClawAgentId(agent.id)
      ) {
        if (!parsed.agents) {
          parsed.agents = {};
        }
        if (!parsed.agents.defaults) {
          parsed.agents.defaults = {};
        }
        if (!parsed.agents.defaults.model || typeof parsed.agents.defaults.model === "string") {
          parsed.agents.defaults.model = {};
        }
        if (normalizedRuntimeModelStack.model) {
          parsed.agents.defaults.model.primary = normalizedRuntimeModelStack.model;
        } else {
          delete parsed.agents.defaults.model.primary;
        }
        parsed.agents.defaults.model.fallbacks = [...(normalizedRuntimeModelStack.fallbacks ?? [])];
        delete parsed.agents.defaults.model.policy;
      }
      await writeFile(configPath + ".bak", raw, "utf-8");
      await writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
    }
    if ((agent.model || undefined) !== normalizedRuntimeModelStack.model) {
      agent.model = normalizedRuntimeModelStack.model;
      changed = true;
    }
    const currentModelFallbacks = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : undefined;
    if (JSON.stringify(currentModelFallbacks ?? []) !== JSON.stringify(normalizedRuntimeModelStack.fallbacks ?? [])) {
      agent.modelFallbacks = normalizedRuntimeModelStack.fallbacks;
      changed = true;
    }
    if (agent.modelPolicy !== normalizedRuntimeModelStack.policy) {
      agent.modelPolicy = normalizedRuntimeModelStack.policy;
      changed = true;
    }
    const runtimeMemoryPromptInjectionMode = normalizeAgentMemoryPromptInjectionMode(
      parsed?.plugins?.entries?.["straja-vault"]?.config?.memoryPromptInjectionMode,
      parsed?.plugins?.entries?.["straja-vault"]?.config?.injectMemoryInPrompt,
      agent.memoryPromptInjectionMode ?? DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
    );
    if (agent.memoryPromptInjectionMode !== runtimeMemoryPromptInjectionMode) {
      agent.memoryPromptInjectionMode = runtimeMemoryPromptInjectionMode;
      changed = true;
    }
    return changed;
  }

  function resolveOpenClawGatewayLauncher(): { exe: string; args: string[]; cwd: string } | null {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidateRoots = [
      process.env.STRAJA_AGENT_ROOT,
      process.env.OPENCLAW_AGENT_ROOT,
      resolve(thisDir, "../../straja-agent"),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const root of candidateRoots) {
      const runNodePath = resolve(root, "scripts/run-node.mjs");
      if (existsSync(runNodePath)) {
        return {
          exe: process.execPath,
          args: [runNodePath, "gateway", "--allow-unconfigured"],
          cwd: root,
        };
      }
      const cliEntryPath = resolve(root, "straja-agent.mjs");
      if (existsSync(cliEntryPath)) {
        return {
          exe: process.execPath,
          args: [cliEntryPath, "gateway", "--allow-unconfigured"],
          cwd: root,
        };
      }
    }
    return null;
  }

  function resolveOpenClawCliLauncher(): { exe: string; args: string[]; cwd: string } | null {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidateRoots = [
      process.env.STRAJA_AGENT_ROOT,
      process.env.OPENCLAW_AGENT_ROOT,
      resolve(thisDir, "../../straja-agent"),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const root of candidateRoots) {
      const cliEntryPath = resolve(root, "straja-agent.mjs");
      if (existsSync(cliEntryPath)) {
        return {
          exe: process.execPath,
          args: [cliEntryPath],
          cwd: root,
        };
      }
      const distEntryPath = resolve(root, "dist/entry.js");
      if (existsSync(distEntryPath)) {
        return {
          exe: process.execPath,
          args: [distEntryPath],
          cwd: root,
        };
      }
    }
    return null;
  }

  async function probeAgentHook(agent: AgentConnectionConfig, timeoutMs = 1500): Promise<boolean> {
    const url = `${agent.gatewayUrl.replace(/\/+$/, "")}${normalizeAgentHookEndpointPath(agent.hooksPath)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agent.token}`,
      },
      body: JSON.stringify({
        message: "Vault health probe",
        name: "Vault Health Probe",
        deliver: false,
        allowUnsafeExternalContent: true,
        skipGuardModelChecks: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  }

  function listPidsListeningOnPort(port: number | null | undefined): number[] {
    const safePort = typeof port === "number" ? port : null;
    if (safePort === null || !Number.isInteger(safePort) || safePort <= 0) {
      return [];
    }
    const result = nodeSpawnSync("lsof", ["-ti", `tcp:${safePort}`], {
      encoding: "utf8",
    });
    if (result.status !== 0 && !result.stdout.trim()) {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  async function stopOpenClawGateway(agent: AgentConnectionConfig): Promise<{ stopped: boolean; alreadyStopped?: boolean }> {
    let gatewayPort: number | null = null;
    try {
      const parsed = new URL(agent.gatewayUrl);
      const port = Number.parseInt(parsed.port, 10);
      gatewayPort = Number.isInteger(port) && port > 0 ? port : null;
    } catch {
      gatewayPort = null;
    }

    const pids = listPidsListeningOnPort(gatewayPort);
    if (pids.length === 0) {
      return { stopped: false, alreadyStopped: true };
    }

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore already-dead or inaccessible processes.
      }
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 125));
      const survivors = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
      if (survivors.length === 0) {
        return { stopped: true };
      }
    }

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore already-dead or inaccessible processes.
      }
    }

    return { stopped: true };
  }

  async function patchOpenClawGatewayConfig(
    agent: AgentConnectionConfig,
    gwToken: string,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    const configResult = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.get", {})) as {
      hash?: string;
      baseHash?: string;
    };
    const baseHash = configResult?.hash ?? configResult?.baseHash;
    if (!baseHash) {
      throw new Error("Could not read agent config hash");
    }
    return await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.patch", {
      baseHash,
      raw: JSON.stringify(patch),
    });
  }

  function readAgentChannelPolicy(
    configSnapshot: any,
    channel: string,
    accountId?: string,
  ): { dmPolicy?: string; allowFrom?: string[] } {
    const channelConfig = configSnapshot?.config?.channels?.[channel];
    if (!channelConfig || typeof channelConfig !== "object") {
      return {};
    }
    const rootDmPolicy =
      typeof channelConfig.dmPolicy === "string" ? channelConfig.dmPolicy : undefined;
    const rootAllowFrom = Array.isArray(channelConfig.allowFrom)
      ? channelConfig.allowFrom.map((entry: unknown) => String(entry).trim()).filter(Boolean)
      : undefined;
    if (!accountId) {
      return { dmPolicy: rootDmPolicy, allowFrom: rootAllowFrom };
    }
    const accountConfig = channelConfig.accounts?.[accountId];
    const accountDmPolicy =
      typeof accountConfig?.dmPolicy === "string" ? accountConfig.dmPolicy : undefined;
    const accountAllowFrom = Array.isArray(accountConfig?.allowFrom)
      ? accountConfig.allowFrom.map((entry: unknown) => String(entry).trim()).filter(Boolean)
      : undefined;
    return {
      dmPolicy: accountDmPolicy ?? rootDmPolicy,
      allowFrom: accountAllowFrom ?? rootAllowFrom,
    };
  }

  function resolveLocalAgentLogsDir(agent: Pick<AgentConnectionConfig, "openclawConfigPath">): string | null {
    const configPath = resolvePreferredOpenClawConfigPath(agent);
    if (!configPath) {
      return null;
    }
    const agentDir = dirname(configPath);
    return join(dirname(agentDir), "logs");
  }

  function resolveWorkspaceLogsDir(): string | null {
    const explicit = process.env.STRAJA_WORKSPACE_APP_LOGS_DIR?.trim();
    if (explicit) {
      return explicit;
    }
    const cacheHome = process.env.XDG_CACHE_HOME?.trim();
    return cacheHome ? resolve(cacheHome, "straja-vault") : resolve(homedir(), ".cache", "straja-vault");
  }

  async function readLogTail(logPath: string, maxBytes = 24_000): Promise<string> {
    try {
      const fileStat = await stat(logPath);
      const bytesToRead = Math.min(fileStat.size, maxBytes);
      if (bytesToRead <= 0) {
        return "";
      }
      const content = await readFile(logPath, "utf-8");
      return content.length > maxBytes ? content.slice(-maxBytes) : content;
    } catch {
      return "";
    }
  }

  function resolveStableOpenClawLaunchCwd(
    agent: Pick<AgentConnectionConfig, "openclawConfigPath">,
    fallbackCwd: string,
  ): string {
    const preferredConfigPath = resolvePreferredOpenClawConfigPath(agent);
    const stableLaunchCwdCandidates = [
      preferredConfigPath ? dirname(preferredConfigPath) : "",
      agent.openclawConfigPath ? dirname(agent.openclawConfigPath) : "",
      process.env.STRAJA_WORKSPACE_APP_DATA_DIR || "",
      process.env.HOME || "",
      fallbackCwd,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return (
      stableLaunchCwdCandidates.find((candidate) => {
        try {
          return existsSync(candidate);
        } catch {
          return false;
        }
      }) ?? fallbackCwd
    );
  }

  async function startOpenClawGateway(
    agent: AgentConnectionConfig,
  ): Promise<{ started: boolean; alreadyRunning?: boolean; pending?: boolean }> {
    const preferredConfigPath = resolvePreferredOpenClawConfigPath(agent);
    if (preferredConfigPath && existsSync(preferredConfigPath)) {
      try {
        const raw = await readFile(preferredConfigPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, any>;
        const normalizedBasePath = normalizeOpenClawHooksBasePath(parsed?.hooks?.path);
        if (parsed?.hooks?.path !== normalizedBasePath) {
          if (!parsed.hooks || typeof parsed.hooks !== "object") {
            parsed.hooks = {};
          }
          parsed.hooks.path = normalizedBasePath;
          await writeFile(preferredConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
        }
      } catch {
        // Ignore local config normalization failures; startup probing below will surface actionable errors.
      }
    }
    try {
      const running = await probeAgentHook(agent, 1200);
      if (running) {
        return { started: false, alreadyRunning: true };
      }
    } catch {
      // Continue into local start path when probe fails.
    }

    const launcher = resolveOpenClawGatewayLauncher();
    if (!launcher) {
      throw new Error(
        "Could not find a local Straja Agent install. Set STRAJA_AGENT_ROOT or OPENCLAW_AGENT_ROOT.",
      );
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (preferredConfigPath) {
      env.OPENCLAW_CONFIG_PATH = preferredConfigPath;
    }

    // TODO: Route agent LLM traffic through Guard.
    // The agent's model resolution (forward-compat, catalog) uses hardcoded baseUrls
    // that bypass config overrides.  Proper integration requires agent-side support
    // (e.g. an HTTP proxy layer or STRAJA_GUARD_URL env var in pi-ai).
    // For now, Guard runs as a sidecar with activation events flowing to vault audit.

    const logsDir = resolveLocalAgentLogsDir(agent);
    let stdio: any = "ignore";
    let logFd: number | null = null;
    if (logsDir) {
      await mkdir(logsDir, { recursive: true });
      const logPath = join(logsDir, "agent-gateway.log");
      logFd = openSync(logPath, "a");
      stdio = ["ignore", logFd, logFd];
    }

    const stableLaunchCwd = resolveStableOpenClawLaunchCwd(agent, launcher.cwd);

    const child = nodeSpawn(launcher.exe, launcher.args, {
      cwd: stableLaunchCwd,
      env,
      detached: true,
      stdio,
    });
    if (logFd !== null) {
      closeSync(logFd);
    }
    child.unref();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const running = await probeAgentHook(agent, 750);
        if (running) {
          return { started: true };
        }
      } catch {
        // Keep retrying while the gateway is booting.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    }
    return { started: true, pending: true };
  }

  async function runOpenClawCli(
    agent: AgentConnectionConfig,
    args: string[],
    timeoutMs = 20_000,
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const launcher = resolveOpenClawCliLauncher();
    if (!launcher) {
      throw new Error("Could not find a local Straja Agent install.");
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    const preferredConfigPath = resolvePreferredOpenClawConfigPath(agent);
    if (preferredConfigPath) {
      env.OPENCLAW_CONFIG_PATH = preferredConfigPath;
    }
    const stableLaunchCwd = resolveStableOpenClawLaunchCwd(agent, launcher.cwd);
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = nodeSpawn(launcher.exe, [...launcher.args, ...args], {
        cwd: stableLaunchCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill failures on already-exited process
        }
        rejectPromise(new Error(`Agent CLI timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolvePromise({ status: code, stdout, stderr });
      });
    });
  }

  function compactCliErrorText(stderr: string, stdout: string): string {
    const combined = `${stderr}\n${stdout}`
      .split(/\r?\n/)
      .map((line) => line.replace(/\x1B\[[0-9;]*m/g, "").trim())
      .filter((line) => line.length > 0);

    if (combined.length === 0) {
      return "Failed to load usage overview via local CLI.";
    }

    return (
      combined.find((line) => line.startsWith("Gateway call failed:")) ??
      combined.find((line) => line.includes("gateway closed")) ??
      combined.find((line) => line.includes("Failed to discover Ollama models")) ??
      combined.at(-1) ??
      combined[0]!
    );
  }

  async function approveOpenClawPairingCode(
    agent: AgentConnectionConfig,
    channel: string,
    code: string,
    owner = false,
  ): Promise<{ channel: string; approvedId?: string | null }> {
    const normalizedChannel = channel.trim().toLowerCase();
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedChannel) {
      throw new Error("channel is required");
    }
    if (!normalizedCode) {
      throw new Error("pairing code is required");
    }
    const args = ["pairing", "approve"]
    if (owner) {
      args.push("--owner")
    }
    args.push(normalizedChannel, normalizedCode)
    const result = await runOpenClawCli(agent, args);
    if (result.status !== 0) {
      const errorText = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(errorText || "Failed to approve pairing code.");
    }
    const text = `${result.stdout}\n${result.stderr}`;
    const idMatch = text.match(/sender\s+([^\s.]+)\.?/i);
    return {
      channel: normalizedChannel,
      approvedId: idMatch?.[1] ?? null,
    };
  }

  const LEGACY_AGENT_VAULT_ACCESS_SCOPES = new Set<AgentVaultAccessScope>([
    "secrets.read",
    "secrets.write",
    "audit.append",
  ]);
  const DEFAULT_AGENT_VAULT_ACCESS_SCOPES: AgentVaultAccessScope[] = [
    "vault.read",
    "vault.write",
    "exec.run",
    "exec.manage",
    "repo-exec.run",
    "integrations.use",
    ...LEGACY_AGENT_VAULT_ACCESS_SCOPES,
  ];
  const AGENT_VAULT_AUTH_FAILURE_WINDOW_MS = 60_000;
  const AGENT_VAULT_AUTH_FAILURE_LIMIT = 12;
  const AGENT_VAULT_LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
  const agentVaultAuthFailures = new Map<string, { count: number; windowStartedAtMs: number }>();
  const agentVaultLastSeenWrites = new Map<string, number>();
  const httpAdminToken = normalizeAuthToken(process.env.VAULT_HTTP_ADMIN_TOKEN);

  function normalizeAuthToken(raw: unknown): string | null {
    if (typeof raw !== "string") {
      return null;
    }
    let token = raw.trim();
    if (!token) {
      return null;
    }
    token = token.replace(/^Bearer\s+/i, "").trim();
    return token || null;
  }

  function isHttpAdminAuthEnabled(): boolean {
    return !!httpAdminToken;
  }

  function matchesHttpAdminToken(token: string): boolean {
    return !!httpAdminToken && safeEqualString(token, httpAdminToken);
  }

  function normalizeAgentVaultAccess(raw: unknown): AgentVaultAccessConfig | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const record = raw as Record<string, unknown>;
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((scope): scope is AgentVaultAccessScope =>
          scope === "vault.read" ||
          scope === "vault.write" ||
          scope === "exec.run" ||
          scope === "exec.manage" ||
          scope === "repo-exec.run" ||
          scope === "integrations.use" ||
          scope === "secrets.read" ||
          scope === "secrets.write" ||
          scope === "audit.append",
        )
      : [];
    const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : "";
    const tokenPreview = typeof record.tokenPreview === "string" ? record.tokenPreview.trim() : "";
    if (!tokenHash || !tokenPreview) {
      return undefined;
    }
    // Always merge saved scopes with current defaults so new scopes
    // (e.g. repo-exec.run) propagate without requiring token rotation.
    const effectiveScopes = Array.from(new Set([
      ...DEFAULT_AGENT_VAULT_ACCESS_SCOPES,
      ...scopes,
    ]));

    return {
      enabled: record.enabled !== false,
      tokenHash,
      tokenPreview,
      scopes: effectiveScopes,
      createdAt:
        typeof record.createdAt === "string" && record.createdAt.trim()
          ? record.createdAt
          : new Date().toISOString(),
      lastRotatedAt:
        typeof record.lastRotatedAt === "string" && record.lastRotatedAt.trim()
          ? record.lastRotatedAt
          : new Date().toISOString(),
      lastSeenAt:
        typeof record.lastSeenAt === "string" && record.lastSeenAt.trim()
          ? record.lastSeenAt
          : undefined,
    };
  }

  function sanitizeAgentVaultAccess(access: AgentVaultAccessConfig | undefined) {
    if (!access) {
      return undefined;
    }
    return {
      enabled: access.enabled,
      tokenPreview: access.tokenPreview,
      scopes: [...access.scopes],
      createdAt: access.createdAt,
      lastRotatedAt: access.lastRotatedAt,
      lastSeenAt: access.lastSeenAt,
    };
  }

  function hashAgentVaultAccessToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  function createAgentVaultAccessToken(): string {
    return `svlt_agent_${randomBytes(24).toString("base64url")}`;
  }

  function buildAgentVaultTokenPreview(token: string): string {
    if (token.length <= 12) {
      return token;
    }
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }

  const openAICodexOAuthSessions = new Map<
    string,
    OpenAICodexOAuthSession & { agentId: string; createdAt: number; desktopApp?: boolean }
  >();
  let openAICodexCallbackServer:
    | { close: () => void }
    | null = null;

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderDesktopOpenAIOAuthResult(
    status: "connected" | "error",
    message?: string,
  ): string {
    const title = status === "connected" ? "OpenAI Connected" : "OpenAI Sign-In Failed";
    const subtitle =
      status === "connected"
        ? "Authentication succeeded. You can close this page and return to Straja Workspace."
        : message?.trim() || "Authentication failed. You can close this page and retry from the app.";
    const escapedTitle = escapeHtml(title);
    const escapedSubtitle = escapeHtml(subtitle);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0f1115;
      color: #e6eaf2;
      padding: 24px;
    }
    .card {
      width: min(560px, 100%);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      background: rgba(255,255,255,0.04);
      padding: 24px;
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 22px;
      line-height: 1.2;
    }
    p {
      margin: 0;
      opacity: 0.86;
      font-size: 15px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapedTitle}</h1>
    <p>${escapedSubtitle}</p>
  </div>
  <script>
    setTimeout(function () {
      try { window.close(); } catch {}
    }, 300);
  </script>
</body>
</html>`;
  }

  async function ensureOpenAICodexCallbackServer(): Promise<void> {
    if (openAICodexCallbackServer) {
      return;
    }

    openAICodexCallbackServer = await new Promise<{ close: () => void }>((resolveServer, rejectServer) => {
      const server = createServer(async (req, res) => {
        const callbackStart = Date.now();
        if (!req.url) {
          res.statusCode = 400;
          res.end("Missing request URL");
          return;
        }
        const callbackUrl = new URL(req.url, OPENAI_CODEX_CALLBACK_ORIGIN);
        if (callbackUrl.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const redirectWithStatus = (status: "connected" | "error", message?: string) => {
          const location = new URL("/agents", `http://localhost:${port}`);
          location.searchParams.set("openai", status);
          if (message) {
            location.searchParams.set("message", message);
          }
          res.statusCode = 302;
          res.setHeader("Location", location.toString());
          res.end();
        };

        const oauthError = callbackUrl.searchParams.get("error");
        if (oauthError) {
          redirectWithStatus("error", oauthError);
          return;
        }

        const code = callbackUrl.searchParams.get("code");
        const state = callbackUrl.searchParams.get("state");
        if (!code || !state) {
          redirectWithStatus("error", "Missing OpenAI authorization code.");
          return;
        }

        const pending = openAICodexOAuthSessions.get(state);
        if (!pending) {
          redirectWithStatus("error", "OpenAI sign-in session expired.");
          return;
        }
        openAICodexOAuthSessions.delete(state);

        if (Date.now() - pending.createdAt > 10 * 60_000) {
          redirectWithStatus("error", "OpenAI sign-in session expired.");
          return;
        }

        try {
          const token = await exchangeOpenAICodexAuthorizationCode({
            code,
            verifier: pending.verifier,
            redirectUri: pending.redirectUri,
          });
          const authStore = getAgentAuthProfileStore();
          const profileId = "openai-codex:default";
          authStore.profiles[profileId] = {
            type: "oauth",
            provider: "openai-codex",
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            accountId: token.accountId,
          };
          await saveAgentAuthProfileStore(authStore);

          const config = getAgentsConfig();
          const agent = config.agents.find((entry) => entry.id === pending.agentId);
          if (agent) {
            await syncOpenClawAuthProfileConfig(agent, {
              profileId,
              provider: "openai-codex",
              mode: "oauth",
            }).catch(() => false);
          }

          if (pending.desktopApp) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderDesktopOpenAIOAuthResult("connected"));
          } else {
            redirectWithStatus("connected");
          }
          log(`${ts()} GET ${OPENAI_CODEX_REDIRECT_URI} → connected (${Date.now() - callbackStart}ms)`);
        } catch (err: any) {
          if (pending.desktopApp) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderDesktopOpenAIOAuthResult("error", err?.message || "OpenAI sign-in failed."));
          } else {
            redirectWithStatus("error", err?.message || "OpenAI sign-in failed.");
          }
          log(`${ts()} GET ${OPENAI_CODEX_REDIRECT_URI} → ERROR: ${err?.message || err}`);
        }
      });

      server.once("error", (err) => {
        openAICodexCallbackServer = null;
        rejectServer(err);
      });
      server.listen(1455, "127.0.0.1", () => {
        resolveServer({
          close: () => {
            try {
              server.close();
            } catch {
              // ignore close errors during shutdown
            }
          },
        });
      });
    });
  }

  function safeEqualString(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, "utf-8");
    const bBuf = Buffer.from(b, "utf-8");
    if (aBuf.byteLength !== bBuf.byteLength) {
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }

  function extractBearerToken(req: IncomingMessage): string | null {
    return normalizeAuthToken(getHeaderValue(req, "authorization"));
  }

  function resolveAgentVaultClientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress || "unknown";
  }

  function recordAgentVaultAuthFailure(clientKey: string, nowMs: number): {
    throttled: boolean;
    retryAfterSeconds?: number;
  } {
    const current = agentVaultAuthFailures.get(clientKey);
    if (!current || nowMs - current.windowStartedAtMs > AGENT_VAULT_AUTH_FAILURE_WINDOW_MS) {
      agentVaultAuthFailures.set(clientKey, { count: 1, windowStartedAtMs: nowMs });
      return { throttled: false };
    }
    const next = { count: current.count + 1, windowStartedAtMs: current.windowStartedAtMs };
    agentVaultAuthFailures.set(clientKey, next);
    if (next.count <= AGENT_VAULT_AUTH_FAILURE_LIMIT) {
      return { throttled: false };
    }
    const retryAfterMs = Math.max(
      1,
      next.windowStartedAtMs + AGENT_VAULT_AUTH_FAILURE_WINDOW_MS - nowMs,
    );
    return {
      throttled: true,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  function clearAgentVaultAuthFailure(clientKey: string): void {
    agentVaultAuthFailures.delete(clientKey);
  }

  function findPairedAgentByVaultToken(token: string):
    | { agent: AgentConnectionConfig; access: AgentVaultAccessConfig }
    | null {
    const config = getAgentsConfig();
    const tokenHash = hashAgentVaultAccessToken(token);
    for (const agent of config.agents) {
      if (!agent.enabled) {
        continue;
      }
      const access = normalizeAgentVaultAccess(agent.vaultAccess);
      if (!access || !access.enabled) {
        continue;
      }
      if (safeEqualString(access.tokenHash, tokenHash)) {
        return { agent, access };
      }
    }
    return null;
  }

  async function touchAgentVaultAccessLastSeen(agentId: string, seenAt: string): Promise<void> {
    const nowMs = Date.now();
    const lastWriteMs = agentVaultLastSeenWrites.get(agentId) ?? 0;
    if (nowMs - lastWriteMs < AGENT_VAULT_LAST_SEEN_WRITE_INTERVAL_MS) {
      return;
    }

    const config = getAgentsConfig();
    const agent = config.agents.find((entry) => entry.id === agentId);
    const access = normalizeAgentVaultAccess(agent?.vaultAccess);
    if (!agent || !access) {
      return;
    }

    const previousSeenMs = access.lastSeenAt ? Date.parse(access.lastSeenAt) : Number.NaN;
    if (
      Number.isFinite(previousSeenMs) &&
      nowMs - previousSeenMs < AGENT_VAULT_LAST_SEEN_WRITE_INTERVAL_MS
    ) {
      return;
    }

    agentVaultLastSeenWrites.set(agentId, nowMs);
    agent.vaultAccess = { ...access, lastSeenAt: seenAt };
    await saveAgentsConfig(config);
  }

  type HttpAuthContext =
    | { kind: "admin" }
    | { kind: "agent"; agent: AgentConnectionConfig; access: AgentVaultAccessConfig };

  function denyUnauthorizedRequest(req: IncomingMessage, res: ServerResponse): null {
    const clientKey = resolveAgentVaultClientKey(req);
    const throttle = recordAgentVaultAuthFailure(clientKey, Date.now());
    if (throttle.throttled) {
      const retryAfter = throttle.retryAfterSeconds ?? 1;
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      });
      res.end(JSON.stringify({ error: "Too Many Requests" }));
      return null;
    }
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="straja-vault"',
    });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return null;
  }

  function authorizeAdminRoute(req: IncomingMessage, res: ServerResponse): HttpAuthContext | null {
    if (!isHttpAdminAuthEnabled()) {
      return { kind: "admin" };
    }
    const token = extractBearerToken(req);
    if (!token || !matchesHttpAdminToken(token)) {
      return denyUnauthorizedRequest(req, res);
    }
    clearAgentVaultAuthFailure(resolveAgentVaultClientKey(req));
    return { kind: "admin" };
  }

  function authorizeAdminOrPairedAgent(
    req: IncomingMessage,
    res: ServerResponse,
    requiredScope: AgentVaultAccessScope,
    opts: { openWhenAdminDisabled?: boolean } = {},
  ): HttpAuthContext | null {
    if (!isHttpAdminAuthEnabled()) {
      if (opts.openWhenAdminDisabled !== false) {
        return { kind: "admin" };
      }
    }
    const clientKey = resolveAgentVaultClientKey(req);
    const token = extractBearerToken(req);
    if (!token) {
      return denyUnauthorizedRequest(req, res);
    }

    if (matchesHttpAdminToken(token)) {
      clearAgentVaultAuthFailure(clientKey);
      return { kind: "admin" };
    }

    const matched = findPairedAgentByVaultToken(token);
    if (!matched) {
      return denyUnauthorizedRequest(req, res);
    }

    if (!matched.access.scopes.includes(requiredScope)) {
      clearAgentVaultAuthFailure(clientKey);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return null;
    }

    clearAgentVaultAuthFailure(clientKey);
    void touchAgentVaultAccessLastSeen(matched.agent.id, new Date().toISOString()).catch(() => {});
    markAgentActivity();
    return { kind: "agent", agent: matched.agent, access: matched.access };
  }

  type HttpRouteRequirement =
    | { mode: "public" }
    | { mode: "admin" }
    | {
        mode: "admin_or_agent";
        scope: AgentVaultAccessScope;
        openWhenAdminDisabled?: boolean;
      };

  function getRawCollectionRequirement(
    collName: string,
    method: string,
  ): HttpRouteRequirement {
    const normalizedMethod = method.toUpperCase();
    if (collName === "_credentials") {
      return {
        mode: "admin_or_agent",
        scope: normalizedMethod === "GET" || normalizedMethod === "HEAD" ? "secrets.read" : "secrets.write",
        openWhenAdminDisabled: false,
      };
    }
    if (collName === "_auth_profiles") {
      return {
        mode: "admin_or_agent",
        scope: normalizedMethod === "GET" || normalizedMethod === "HEAD" ? "vault.read" : "vault.write",
        openWhenAdminDisabled: false,
      };
    }
    if (
      collName === "_workspace" ||
      collName === "_memory" ||
      collName === "_flows" ||
      collName === "_sessions" ||
      collName === "_sessions_store" ||
      collName === "_subagents" ||
      collName === "_cron" ||
      collName === "_delivery_queue" ||
      collName === "_logs" ||
      collName === "_bootstrap" ||
      collName === "_editable" ||
      collName === "editable"
    ) {
      return { mode: "admin_or_agent", scope: normalizedMethod === "GET" || normalizedMethod === "HEAD" ? "vault.read" : "vault.write" };
    }
    return { mode: "admin" };
  }

  function isPublicWebUiRoute(pathname: string, method: string): boolean {
    const normalizedMethod = (method || "GET").toUpperCase();
    if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
      return false;
    }

    if (
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname === "/favicon.svg" ||
      pathname === "/favicon.ico" ||
      pathname.startsWith("/assets/")
    ) {
      return true;
    }

    if (
      pathname === "/home" ||
      pathname === "/onboarding" ||
      pathname === "/collections" ||
      pathname === "/search" ||
      pathname === "/exec" ||
      pathname === "/browser" ||
      pathname === "/artifacts" ||
      pathname === "/audit" ||
      pathname === "/connections" ||
      pathname === "/settings" ||
      pathname === "/health" ||
      pathname === "/tasks" ||
      pathname === "/flows" ||
      pathname === "/evals" ||
      pathname === "/orchestration" ||
      pathname === "/usage" ||
      pathname === "/agents" ||
      pathname === "/guard" ||
      pathname === "/models"
    ) {
      return true;
    }

    if (/^\/tasks\/[^/]+$/.test(pathname)) {
      return true;
    }

    if (/^\/orchestration\/[^/]+$/.test(pathname)) {
      return true;
    }

    if (/^\/evals\/suites\/[^/]+$/.test(pathname) || /^\/evals\/runs\/[^/]+$/.test(pathname)) {
      return true;
    }

    if (
      /^\/collections\/[^/]+(?:\/.*)?$/.test(pathname) &&
      !/^\/collections\/[^/]+\/(files|update)(?:\/|$)/.test(pathname)
    ) {
      return true;
    }

    return false;
  }

  function resolveHttpRouteRequirement(pathname: string, method: string): HttpRouteRequirement {
    const normalizedMethod = (method || "GET").toUpperCase();
    if (pathname === "/health" && normalizedMethod === "GET") {
      return { mode: "public" };
    }
    if (
      pathname.startsWith("/connections/gmail/callback") ||
      pathname.startsWith("/connections/gdrive/callback") ||
      pathname.startsWith("/connections/gcalendar/callback") ||
      pathname.startsWith("/connections/gcontacts/callback") ||
      pathname.startsWith("/connections/github/callback")
    ) {
      return { mode: "public" };
    }
    if (pathname === "/artifacts/download" && normalizedMethod === "GET") {
      return { mode: "public" };
    }
    if (BROWSER_SCREENSHOT_FETCH_ROUTE_RE.test(pathname) && normalizedMethod === "GET") {
      return { mode: "public" };
    }
    if (pathname === "/mcp") {
      return { mode: "admin" };
    }
    if ((pathname === "/query" || pathname === "/search" || pathname === "/answer") && normalizedMethod === "POST") {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (
      (pathname === "/spreadsheets/get" || pathname === "/spreadsheets/match") &&
      normalizedMethod === "POST"
    ) {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (pathname === "/spreadsheets/update" && normalizedMethod === "POST") {
      return { mode: "admin_or_agent", scope: "vault.write" };
    }
    if (pathname === "/status" && normalizedMethod === "GET") {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (pathname === "/security/encryption/status" && normalizedMethod === "GET") {
      return { mode: "admin" };
    }
    if (
      pathname === "/security/encryption/init" && normalizedMethod === "POST" ||
      pathname === "/security/encryption/unlock" && normalizedMethod === "POST" ||
      pathname === "/security/encryption/lock" && normalizedMethod === "POST"
    ) {
      return { mode: "admin" };
    }
    if ((pathname === "/browse" || pathname.startsWith("/browse/")) && normalizedMethod === "GET") {
      return { mode: "admin" };
    }
    if (/^\/collections\/[^/]+\/files\/.+$/.test(pathname) && normalizedMethod === "GET") {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (/^\/collections\/[^/]+\/files$/.test(pathname) && normalizedMethod === "GET") {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (
      pathname === "/collections" && normalizedMethod === "POST" ||
      pathname === "/collections/empty" && normalizedMethod === "POST" ||
      /^\/collections\/[^/]+\/update$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/collections\/[^/]+\/files$/.test(pathname) && (normalizedMethod === "POST" || normalizedMethod === "DELETE") ||
      /^\/collections\/[^/]+\/folders$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/collections\/[^/]+$/.test(pathname) && normalizedMethod === "DELETE"
    ) {
      return { mode: "admin" };
    }
    if (
      pathname === "/notes" && normalizedMethod === "POST" ||
      /^\/notes\/.+$/.test(pathname) && normalizedMethod === "PUT"
    ) {
      return { mode: "admin" };
    }
    if (pathname === "/pull" && normalizedMethod === "POST") {
      return { mode: "admin" };
    }
    if (pathname === "/models/status" && normalizedMethod === "GET") {
      return { mode: "admin" };
    }
    if (pathname === "/exec" && normalizedMethod === "POST") {
      return { mode: "admin_or_agent", scope: "exec.run" };
    }
    if (pathname === "/repo-exec" && normalizedMethod === "POST") {
      return { mode: "admin_or_agent", scope: "repo-exec.run" };
    }
    if (
      pathname === "/exec/sessions" && normalizedMethod === "GET" ||
      /^\/exec\/sessions\/[^/]+\/poll$/.test(pathname) && normalizedMethod === "GET" ||
      /^\/exec\/sessions\/[^/]+\/log$/.test(pathname) && normalizedMethod === "GET" ||
      /^\/exec\/sessions\/[^/]+\/write$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/exec\/sessions\/[^/]+\/kill$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/exec\/sessions\/[^/]+$/.test(pathname) && normalizedMethod === "DELETE"
    ) {
      return { mode: "admin_or_agent", scope: "exec.manage" };
    }
    if (
      pathname === "/artifacts" && normalizedMethod === "GET" ||
      pathname === "/artifacts/url" && normalizedMethod === "POST"
    ) {
      return { mode: "admin_or_agent", scope: "vault.read" };
    }
    if (
      pathname === "/artifacts/build" && normalizedMethod === "POST" ||
      pathname === "/reports/build" && normalizedMethod === "POST" ||
      pathname === "/embed" && normalizedMethod === "POST"
    ) {
      return { mode: "admin_or_agent", scope: "vault.write" };
    }
    if (
      pathname === "/media" && normalizedMethod === "POST" ||
      /^\/media\/.+$/.test(pathname) && (normalizedMethod === "GET" || normalizedMethod === "DELETE")
    ) {
      return {
        mode: "admin_or_agent",
        scope: normalizedMethod === "GET" ? "vault.read" : "vault.write",
      };
    }
    const rawAppendMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)\/append$/);
    if (rawAppendMatch && normalizedMethod === "POST") {
      return getRawCollectionRequirement(decodeURIComponent(rawAppendMatch[1]!), normalizedMethod);
    }
    const rawPutMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
    if (rawPutMatch && normalizedMethod === "PUT") {
      return getRawCollectionRequirement(decodeURIComponent(rawPutMatch[1]!), normalizedMethod);
    }
    const rawDeleteMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
    if (rawDeleteMatch && normalizedMethod === "DELETE") {
      return getRawCollectionRequirement(decodeURIComponent(rawDeleteMatch[1]!), normalizedMethod);
    }
    const rawGetMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
    if (rawGetMatch && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) {
      return getRawCollectionRequirement(decodeURIComponent(rawGetMatch[1]!), normalizedMethod);
    }
    if (
      pathname === "/connections/gmail/drafts" && normalizedMethod === "POST" ||
      /^\/connections\/gmail\/drafts\/.+$/.test(pathname) && normalizedMethod === "PUT" ||
      pathname === "/connections/gcalendar/events" && normalizedMethod === "POST" ||
      /^\/connections\/gcalendar\/events\/.+$/.test(pathname) && (normalizedMethod === "PUT" || normalizedMethod === "DELETE") ||
      pathname === "/connections/web-search/duckduckgo" && normalizedMethod === "POST" ||
      pathname === "/connections/web-fetch" && normalizedMethod === "POST" ||
      pathname === "/connections/approve-domain" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/status" && normalizedMethod === "GET" ||
      pathname === "/connections/browser/start" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/stop" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/tools" && normalizedMethod === "GET" ||
      pathname === "/connections/browser/uploads/stage" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/upload" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/tool" && normalizedMethod === "POST"
    ) {
      return { mode: "admin_or_agent", scope: "integrations.use" };
    }
    if (
      pathname === "/audit/append" && normalizedMethod === "POST"
    ) {
      return {
        mode: "admin_or_agent",
        scope: "audit.append",
        openWhenAdminDisabled: false,
      };
    }
    if (
      pathname === "/audit" && normalizedMethod === "GET" ||
      pathname === "/connections/browser/audit" && normalizedMethod === "GET" ||
      pathname === "/connections/web-search/audit" && normalizedMethod === "GET" ||
      pathname === "/connections/browser/policy" && (normalizedMethod === "GET" || normalizedMethod === "POST" || normalizedMethod === "PUT") ||
      pathname === "/connections/browser/policy/reset" && normalizedMethod === "POST" ||
      pathname === "/connections/web-search/policy" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      pathname === "/connections/web-fetch/policy" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      pathname === "/connections/web-fetch/policy/reset" && normalizedMethod === "POST" ||
      pathname === "/connections/browser/config" && normalizedMethod === "POST" ||
      pathname === "/connections/gmail/status" && normalizedMethod === "GET" ||
      pathname === "/connections/gmail/authorize" && normalizedMethod === "POST" ||
      pathname === "/connections/gmail/sync" && normalizedMethod === "POST" ||
      pathname === "/connections/gmail/config" && normalizedMethod === "POST" ||
      pathname === "/connections/gmail/disconnect" && normalizedMethod === "POST" ||
      pathname === "/connections/gdrive/status" && normalizedMethod === "GET" ||
      pathname === "/connections/gdrive/authorize" && normalizedMethod === "POST" ||
      pathname === "/connections/gdrive/sync" && normalizedMethod === "POST" ||
      pathname === "/connections/gdrive/config" && normalizedMethod === "POST" ||
      pathname === "/connections/gdrive/disconnect" && normalizedMethod === "POST" ||
      pathname.startsWith("/connections/gdrive/browse") && normalizedMethod === "GET" ||
      pathname === "/connections/gdrive/import" && normalizedMethod === "POST" ||
      pathname === "/connections/gcalendar/status" && normalizedMethod === "GET" ||
      pathname === "/connections/gcalendar/authorize" && normalizedMethod === "POST" ||
      pathname === "/connections/gcalendar/calendars" && normalizedMethod === "GET" ||
      pathname === "/connections/gcalendar/sync" && normalizedMethod === "POST" ||
      pathname === "/connections/gcalendar/config" && normalizedMethod === "POST" ||
      pathname === "/connections/gcalendar/disconnect" && normalizedMethod === "POST" ||
      pathname === "/connections/gcontacts/status" && normalizedMethod === "GET" ||
      pathname === "/connections/gcontacts/authorize" && normalizedMethod === "POST" ||
      pathname === "/connections/gcontacts/sync" && normalizedMethod === "POST" ||
      pathname === "/connections/gcontacts/config" && normalizedMethod === "POST" ||
      pathname === "/connections/gcontacts/disconnect" && normalizedMethod === "POST" ||
      pathname === "/connections/github/status" && normalizedMethod === "GET" ||
      pathname === "/connections/github/authorize" && normalizedMethod === "POST" ||
      pathname === "/connections/github/repos" && normalizedMethod === "GET" ||
      pathname === "/connections/github/sync" && normalizedMethod === "POST" ||
      pathname === "/connections/github/config" && normalizedMethod === "POST" ||
      pathname === "/connections/github/disconnect" && normalizedMethod === "POST" ||
      pathname === "/connections/github/issues" && normalizedMethod === "POST" ||
      pathname === "/connections/github/issues" && normalizedMethod === "GET" ||
      pathname === "/connections/github/branches" && normalizedMethod === "POST" ||
      pathname === "/connections/github/pull-requests" && normalizedMethod === "POST" ||
      pathname === "/connections/github/pull-requests" && normalizedMethod === "GET" ||
      pathname === "/connections/github/push" && normalizedMethod === "POST" ||
      pathname === "/connections/guard/status" && normalizedMethod === "GET" ||
      pathname === "/connections/guard/config" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      pathname === "/connections/guard/start" && normalizedMethod === "POST" ||
      pathname === "/connections/guard/stop" && normalizedMethod === "POST" ||
      pathname === "/connections/guard/restart" && normalizedMethod === "POST" ||
      pathname === "/connections/guard/activation" && normalizedMethod === "POST" ||
      pathname === "/connections/guard/events" && normalizedMethod === "GET" ||
      pathname === "/connections/guard/logs" && normalizedMethod === "GET" ||
      pathname === "/connections/openclaw/orchestration" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      pathname === "/usage/overview" && normalizedMethod === "GET" ||
      pathname === "/usage/pricing" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      pathname === "/connections/agents/status" && normalizedMethod === "GET" ||
      pathname === "/connections/agents/starter-team" && normalizedMethod === "POST" ||
      pathname === "/connections/agents/profiles" && normalizedMethod === "GET" ||
      pathname === "/flows/test" && normalizedMethod === "POST" ||
      pathname === "/evals/suites" && (normalizedMethod === "GET" || normalizedMethod === "POST") ||
      /^\/evals\/suites\/[^/]+$/.test(pathname) && normalizedMethod === "GET" ||
      /^\/evals\/suites\/[^/]+\/duplicate$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/evals\/suites\/[^/]+\/run$/.test(pathname) && normalizedMethod === "POST" ||
      /^\/evals\/runs\/[^/]+$/.test(pathname) && normalizedMethod === "GET" ||
      /^\/evals\/runs\/[^/]+\/results$/.test(pathname) && normalizedMethod === "GET" ||
      pathname === "/evals/cases" && normalizedMethod === "POST" ||
      /^\/evals\/cases\/[^/]+$/.test(pathname) && (normalizedMethod === "PUT" || normalizedMethod === "DELETE") ||
      pathname === "/evals/cases/from-trace" && normalizedMethod === "POST" ||
      pathname.startsWith("/flows/") && normalizedMethod === "GET" ||
      pathname.startsWith("/flows/") && (normalizedMethod === "PUT" || normalizedMethod === "DELETE") ||
      pathname === "/repos" && normalizedMethod === "GET" ||
      pathname === "/connections/agents/config" && normalizedMethod === "POST" ||
      pathname.startsWith("/connections/agents/") && normalizedMethod === "POST" ||
      pathname.startsWith("/connections/agents/") && normalizedMethod === "DELETE"
    ) {
      return { mode: "admin" };
    }
    // Health stats and maintenance — admin-only (not accessible by agents)
    if (pathname === "/health/stats" && normalizedMethod === "GET") {
      return { mode: "admin" };
    }
    if (pathname === "/sync" && normalizedMethod === "POST") {
      return { mode: "admin" };
    }
    if (pathname.startsWith("/maintenance/") && normalizedMethod === "POST") {
      return { mode: "admin" };
    }
    if (isPublicWebUiRoute(pathname, normalizedMethod)) {
      return { mode: "public" };
    }
    return { mode: "admin" };
  }

  function authorizeHttpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    method: string,
  ): HttpAuthContext | null {
    const requirement = resolveHttpRouteRequirement(pathname, method);
    if (requirement.mode === "public") {
      return { kind: "admin" };
    }
    if (requirement.mode === "admin") {
      return authorizeAdminRoute(req, res);
    }
    return authorizeAdminOrPairedAgent(req, res, requirement.scope, {
      openWhenAdminDisabled: requirement.openWhenAdminDisabled,
    });
  }

  function isLockManagementRoute(pathname: string): boolean {
    return pathname === "/security/encryption/status" ||
      pathname === "/security/encryption/init" ||
      pathname === "/security/encryption/unlock" ||
      pathname === "/security/encryption/lock" ||
      pathname === "/connections/openclaw/orchestration" ||
      pathname === "/connections/agents/ollama/runtime/start" ||
      pathname === "/connections/agents/detect-openclaw";
  }

  function writeVaultLockedResponse(nodeRes: ServerResponse): void {
    nodeRes.writeHead(423, {
      "Content-Type": "application/json",
      "X-Straja-Vault-State": "locked",
    });
    nodeRes.end(JSON.stringify({ error: "Vault is locked.", code: "vault_locked" }));
  }

  type NotifySource = "gmail" | "gcalendar";

  type NotifyInfo =
    | { source: "gmail"; imported: number; total: number; items: ImportedEmailSummary[] }
    | { source: "gcalendar"; imported: number; total: number; items: ImportedEventSummary[] };

  function buildNotifyMessage(info: NotifyInfo): { message: string; hookName: string } {
    if (info.source === "gmail") {
      const lines: string[] = [
        `📬 ${info.imported} new email${info.imported === 1 ? "" : "s"} synced from Gmail.`,
        "",
      ];
      for (const item of info.items.slice(0, 10)) {
        lines.push(`• **${item.subject}** — from ${item.from} (${new Date(item.date).toLocaleDateString()})`);
      }
      if (info.items.length > 10) {
        lines.push(`• ... and ${info.items.length - 10} more`);
      }
      lines.push("");
      lines.push("Notify the user about these new emails on ALL active channels (Telegram AND webchat). Write a short, friendly summary of what arrived. The user can then ask you to read specific emails or draft replies using vault_search and vault_gmail_create_draft.");
      return { message: lines.join("\n"), hookName: "Vault Gmail Sync" };
    }

    // gcalendar
    const lines: string[] = [
      `📅 ${info.imported} new/updated calendar event${info.imported === 1 ? "" : "s"} synced.`,
      "",
    ];
    for (const item of info.items.slice(0, 10)) {
      const when = item.allDay
        ? new Date(item.start).toLocaleDateString()
        : new Date(item.start).toLocaleString();
      lines.push(`• **${item.summary}** — ${when} (${item.calendarName})`);
    }
    if (info.items.length > 10) {
      lines.push(`• ... and ${info.items.length - 10} more`);
    }
    lines.push("");
    lines.push("Notify the user about these new/updated calendar events on ALL active channels (Telegram AND webchat). Write a short, friendly summary of the upcoming events.");
    return { message: lines.join("\n"), hookName: "Vault Calendar Sync" };
  }

  async function notifyAgents(
    source: NotifySource,
    info: { imported: number; total: number; items: (ImportedEmailSummary | ImportedEventSummary)[] },
  ): Promise<void> {
    const config = getAgentsConfig();
    const targets = config.agents.filter(
      (a) => a.enabled && a.notifications[source],
    );
    if (targets.length === 0) return;

    const notifyInfo = { source, ...info } as NotifyInfo;
    const { message, hookName } = buildNotifyMessage(notifyInfo);

    let configChanged = false;

    await Promise.allSettled(
      targets.map(async (agent) => {
        const url = `${agent.gatewayUrl.replace(/\/+$/, "")}${normalizeAgentHookEndpointPath(agent.hooksPath)}`;
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agent.token}`,
            },
            body: JSON.stringify({
              message,
              name: hookName,
              deliver: true,
              channel: "telegram",
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            agent.lastNotified = new Date().toISOString();
            agent.lastError = undefined;
            configChanged = true;
            markAgentActivity();
            log(`${ts()} notifyAgents: ${agent.id} notified OK`);
          } else {
            const body = await resp.text().catch(() => "");
            agent.lastError = `HTTP ${resp.status}: ${body.slice(0, 200)}`;
            configChanged = true;
            log(`${ts()} notifyAgents: ${agent.id} HTTP ${resp.status}: ${body.slice(0, 200)}`);
          }
        } catch (err: any) {
          const cause = err?.cause?.message || err?.cause?.code;
          const msg = cause ? `${err.message}: ${cause}` : (err?.message || "Unknown error");
          agent.lastError = msg;
          configChanged = true;
          log(`${ts()} notifyAgents: ${agent.id} ERROR: ${msg}`);
        }
      }),
    );

    if (configChanged) {
      saveAgentsConfig(config).catch((err) => {
        log(`${ts()} notifyAgents: failed to save config: ${err?.message}`);
      });
    }
  }

  function handleImportedItemsNotification(
    source: NotifySource,
    info: { imported: number; total: number; items: (ImportedEmailSummary | ImportedEventSummary)[] },
    logLabel: string,
  ): void {
    if (info.imported <= 0) {
      log(`${ts()} ${logLabel}: no new ${source === "gmail" ? "emails" : "events"}`);
      return;
    }

    startBackgroundEmbed({ trigger: logLabel });
    log(
      `${ts()} ${logLabel}: imported ${info.imported} ${source === "gmail" ? "new emails" : "new/updated events"}`,
    );
    notifyAgents(source, info).catch((err) => {
      log(`${ts()} ${logLabel}: notifyAgents error: ${err?.message}`);
    });
  }

  if (!isVaultLocked(store.dbPath)) {
    restoreConfiguredServicesFromStore();
  }

  const httpServer = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const reqStart = Date.now();
    const requestUrl = new URL(nodeReq.url || "/", `http://${nodeReq.headers.host || `localhost:${port}`}`);
    const pathname = requestUrl.pathname;
    const acceptsHtmlNavigation = (nodeReq.headers.accept || "").includes("text/html");
    try {
      const SCHEDULE_RECONCILE_RETRY_MS = 10_000;
      let scheduleReconcileTimer: NodeJS.Timeout | null = null;
      let scheduleReconcileInFlight = false;

      function cancelScheduledCronReconcile(): void {
        if (scheduleReconcileTimer) {
          clearTimeout(scheduleReconcileTimer);
          scheduleReconcileTimer = null;
        }
      }

      function scheduleCronReconcile(reason: string, delayMs = 0): void {
        cancelScheduledCronReconcile();
        scheduleReconcileTimer = setTimeout(() => {
          scheduleReconcileTimer = null;
          void runScheduledCronReconcile(reason).catch((err) => {
            const message = err instanceof Error ? err.message : String(err ?? "unknown error");
            log(`${ts()} schedule-reconcile (${reason}) failed: ${message}`);
            scheduleCronReconcile("retry-after-failure", SCHEDULE_RECONCILE_RETRY_MS);
          });
        }, Math.max(0, delayMs));
      }

      if (pathname === "/health" && nodeReq.method === "GET") {
        // If the browser is navigating (Accept: text/html), skip the JSON API
        // and let the SPA fallback serve index.html for the /health page.
        const accept = nodeReq.headers.accept || "";
        if (!accept.includes("text/html")) {
          const body = JSON.stringify({
            status: "ok",
            uptime: Math.floor((Date.now() - startTime) / 1000),
            httpAuth: {
              adminRequired: isHttpAdminAuthEnabled(),
            },
            encryption: getEncryptionStatusSnapshot(),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(body);
          log(`${ts()} GET /health (${Date.now() - reqStart}ms)`);
          return;
        }
      }

      const routeRequirement = resolveHttpRouteRequirement(pathname, nodeReq.method || "GET");

      if (
        isVaultLocked(store.dbPath) &&
        routeRequirement.mode !== "public" &&
        !isLockManagementRoute(pathname)
      ) {
        writeVaultLockedResponse(nodeRes);
        return;
      }

      if (!authorizeHttpRoute(nodeReq, nodeRes, pathname, nodeReq.method || "GET")) {
        return;
      }

      if (pathname === "/security/encryption/status" && nodeReq.method === "GET") {
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(getEncryptionStatusSnapshot()));
        log(`${ts()} GET /security/encryption/status (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/security/encryption/init" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        const payload = JSON.parse(rawBody || "{}") as { pin?: string };
        let status;
        try {
          const activeStore = mountedStore ?? await mountStore();
          await seedWorkspaceDefaults(activeStore);
          syncGoogleOAuthClientConfig(activeStore);
          syncGitHubOAuthClientConfig(activeStore);
          status = initializeVaultEncryption(store.dbPath, String(payload.pin ?? ""));
          const encryption = resolveVaultDatabaseEncryption(store.dbPath);
          if (!encryption) {
            throw new Error("Vault DB encryption settings are unavailable after initialization.");
          }
          encryptDatabaseAtRest(activeStore.db, encryption);
        } catch (err) {
          unmountStore();
          destroyVaultEncryption(store.dbPath);
          throw err;
        }
        restoreConfiguredServicesFromStore();
        void startAutoModelPullIfNeeded("encryption-init");
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(status));
        log(`${ts()} POST /security/encryption/init (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/security/encryption/unlock" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        const payload = JSON.parse(rawBody || "{}") as { pin?: string };
        let status;
        try {
          status = unlockVaultEncryption(store.dbPath, String(payload.pin ?? ""));
          await mountStore();
        } catch (err) {
          lockVaultEncryption(store.dbPath);
          const msg = err instanceof Error ? err.message : "Unlock failed";
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: msg }));
          log(`${ts()} POST /security/encryption/unlock FAILED: ${msg}`);
          return;
        }
        restoreConfiguredServicesFromStore();
        scheduleCronReconcile("encryption-unlock", 1_000);
        void startAutoModelPullIfNeeded("encryption-unlock");
        scheduleInteractiveRuntimeInitialization("encryption-unlock");
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(status));
        log(`${ts()} POST /security/encryption/unlock (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/security/encryption/lock" && nodeReq.method === "POST") {
        cancelScheduledCronReconcile();
        await stopConfiguredServices();
        unmountStore();
        modelPullState.autoStarted = false;
        const status = lockVaultEncryption(store.dbPath);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(status));
        log(`${ts()} POST /security/encryption/lock (${Date.now() - reqStart}ms)`);
        return;
      }

      // REST endpoint: POST /search — structured search without MCP protocol
      // REST endpoint: POST /query (alias: /search) — structured search without MCP protocol
      if ((pathname === "/query" || pathname === "/search") && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        const params = JSON.parse(rawBody);
        
        // Validate required fields
        if (!params.searches || !Array.isArray(params.searches)) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: searches (array)" }));
          return;
        }

        // Map to internal format
        const subSearches: StructuredSubSearch[] = params.searches.map((s: any) => ({
          type: s.type as 'lex' | 'vec' | 'hyde',
          query: String(s.query || ""),
        }));

        const effectiveCollections: string[] | undefined = Array.isArray(params.collections)
          ? params.collections.filter(isExternallyVisibleCollection)
          : undefined;

        const results = await structuredSearch(store, subSearches, {
          collections: effectiveCollections,
          limit: params.limit ?? 10,
          minScore: params.minScore ?? 0,
        });

        // Use first lex or vec query for snippet extraction
        const primaryQuery = params.searches.find((s: any) => s.type === 'lex')?.query
          || params.searches.find((s: any) => s.type === 'vec')?.query
          || params.searches[0]?.query || "";

        const formatted = results.map(r => {
          const { line, snippet } = extractSnippet(r.bestChunk, primaryQuery, 300);
          return {
            docid: `#${r.docid}`,
            file: r.displayPath,
            title: r.title,
            score: Math.round(r.score * 100) / 100,
            context: r.context,
            snippet: addLineNumbers(snippet, line),
          };
        });

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ results: formatted }));
        log(`${ts()} POST /query ${params.searches.length} queries (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /answer — RAG: retrieve chunks + generate answer with LLM
      // -----------------------------------------------------------------------
      if (pathname === "/answer" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        const params = JSON.parse(rawBody);
        const question = String(params.question || "");
        if (!question) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: question" }));
          return;
        }

        const effectiveCollections: string[] | undefined = Array.isArray(params.collections)
          ? params.collections.filter(isExternallyVisibleCollection)
          : undefined;
        const limit = params.limit ?? 5;
        const detailLevel = (params.detailLevel ?? "balanced") as string;

        const detailConfig: Record<string, { maxTokens: number; contextChars: number; promptPrefix: string }> = {
          concise: {
            maxTokens: 250,
            contextChars: 4000,
            promptPrefix: "Give a concise answer with the key facts. Keep it brief but include essential specifics.",
          },
          balanced: {
            maxTokens: 500,
            contextChars: 6000,
            promptPrefix: "Include specific details like numbers, dates, names, steps, and conditions from the context. Do not repeat information.",
          },
          detailed: {
            maxTokens: 800,
            contextChars: 8000,
            promptPrefix: "Provide a thorough answer with all steps, numbers, conditions, and specifics from the context. Stay focused on the question.",
          },
        };
        const detail = detailConfig[detailLevel] ?? detailConfig.balanced!;

        // 1. Retrieve: run hybrid search (lex + vec + hyde)
        const subSearches: StructuredSubSearch[] = [
          { type: "lex", query: question },
          { type: "vec", query: question },
          { type: "hyde", query: question },
        ];

        try {
          const answer = await withLLMSession(async () => {
            // Strip negation operators from vec/hyde queries (only lex supports them)
            const safeQuestion = question.replace(/\s-\w+/g, "").trim() || question;
            const subSearchesSafe: StructuredSubSearch[] = [
              { type: "lex", query: question },
              { type: "vec", query: safeQuestion },
              { type: "hyde", query: safeQuestion },
            ];

            const results = await structuredSearch(store, subSearchesSafe, {
              collections: effectiveCollections,
              limit,
              minScore: 0,
            });

            if (results.length === 0) {
              return { answer: "No relevant documents found.", sources: [] };
            }

            // 2. Build context: collect all candidate chunks, rank globally, truncate to budget
            const MAX_CONTEXT_CHARS = detail.contextChars;
            const queryTerms = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);

            // Collect and globally rank all chunks from top results
            const allChunks: { text: string; header: string; score: number }[] = [];
            for (const r of results.slice(0, 5)) {
              const header = `[${r.title}]`;
              const chunks = chunkDocument(r.body);
              for (const c of chunks) {
                const lower = c.text.toLowerCase();
                const keywordScore = queryTerms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
                // Boost by document-level search score too
                allChunks.push({ text: c.text, header, score: keywordScore + r.score });
              }
            }
            allChunks.sort((a, b) => b.score - a.score);

            // Take chunks until we hit the budget
            const contextParts: string[] = [];
            let contextLen = 0;
            for (const chunk of allChunks) {
              if (contextLen >= MAX_CONTEXT_CHARS) break;
              const part = `${chunk.header}\n${chunk.text}`;
              contextParts.push(part);
              contextLen += part.length;
            }
            const context = contextParts.join("\n\n");

            // 3. Generate answer using the instruct model (not the query expansion model)
            const prompt = `/no_think Answer the following question using ONLY the provided context. ${detail.promptPrefix} If the context doesn't contain enough information, say so.

Context:
${context}

Question: ${question}

Answer:`;

            const llm = getDefaultLlamaCpp();
            const genResult = await llm.answer(prompt, {
              maxTokens: detail.maxTokens,
              temperature: 0.6,
            });

            const sources = results.slice(0, 5).map(r => ({
              docid: `#${r.docid}`,
              file: r.displayPath,
              title: r.title,
              score: Math.round(r.score * 100) / 100,
              snippet: extractSnippet(r.bestChunk, question, 200).snippet,
            }));

            return {
              answer: genResult?.text?.trim() || "Failed to generate answer.",
              sources,
            };
          }, { maxDuration: 5 * 60 * 1000, name: "ragAnswer" });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(answer));
          log(`${ts()} POST /answer "${question.substring(0, 50)}" (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const msg = err?.message || String(err);
          log(`${ts()} POST /answer ERROR: ${msg}`);
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: msg, answer: "An error occurred while generating the answer.", sources: [] }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /status — full index status
      // -----------------------------------------------------------------------
      if (pathname === "/status" && nodeReq.method === "GET") {
        const status = getStatus(store.db);
        const writeQueueStats = getWriteQueueStats();
        const embedStatus = getAutoEmbedStatus();
        const degraded = getVaultDegradedState();
        // Keep _write_queue visible with the live in-memory count.
        const writeQueueCollection = status.collections.find((entry) => entry.name === "_write_queue");
        if (writeQueueCollection) {
          writeQueueCollection.documents = writeQueue.length;
          writeQueueCollection.fileCount = writeQueue.length;
          writeQueueCollection.lastUpdated = new Date().toISOString();
        } else {
          status.collections.push({
            name: "_write_queue",
            path: "",
            pattern: "",
            documents: writeQueue.length,
            fileCount: writeQueue.length,
            lastUpdated: new Date().toISOString(),
            type: "system" as const,
            linked: false,
            deletable: false,
          });
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(
          JSON.stringify({
            ...status,
            embedding: embedStatus.running,
            embedStatus,
            writeQueue: writeQueueStats,
            modelPulling: modelPullState.inProgress,
            degraded,
          }),
        );
        log(`${ts()} GET /status (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET/POST /config/workspace — persisted workspace UI config
      // -----------------------------------------------------------------------
      if (pathname === "/config/workspace" && nodeReq.method === "GET") {
        const config = getWorkspaceConfig();
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(config));
        log(`${ts()} GET /config/workspace (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/config/workspace" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { name?: unknown };
        try {
          params = JSON.parse(rawBody || "{}");
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const name =
          typeof params.name === "string" && params.name.trim()
            ? params.name.trim().slice(0, 40)
            : DEFAULT_WORKSPACE_NAME;

        const config = { ...getWorkspaceConfig(), name };
        await saveConfigDocument(WORKSPACE_CONFIG_PATH, config);

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(config));
        log(`${ts()} POST /config/workspace → updated (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /health/stats — vault health statistics (admin-only)
      // -----------------------------------------------------------------------
      if (pathname === "/health/stats" && nodeReq.method === "GET") {
        const stats = getHealthStats(store.db, store.dbPath);
        const writeQueueStats = getWriteQueueStats();
        const embedStatus = getAutoEmbedStatus();
        const degraded = getVaultDegradedState();
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({
          ...stats,
          writeQueue: writeQueueStats,
          embedding: embedStatus.running,
          embedStatus,
          degraded,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        }));
        log(`${ts()} GET /health/stats (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /maintenance/cleanup-vectors — remove orphaned vectors
      // -----------------------------------------------------------------------
      if (pathname === "/maintenance/cleanup-vectors" && nodeReq.method === "POST") {
        const removed = cleanupOrphanedVectors(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ removed }));
        log(`${ts()} POST /maintenance/cleanup-vectors removed ${removed} orphaned entries (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /maintenance/cleanup-content — remove orphaned content hashes
      // -----------------------------------------------------------------------
      if (pathname === "/maintenance/cleanup-content" && nodeReq.method === "POST") {
        const removed = cleanupOrphanedContent(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ removed }));
        log(`${ts()} POST /maintenance/cleanup-content removed ${removed} orphaned content hashes (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /maintenance/purge-inactive — delete inactive documents
      // -----------------------------------------------------------------------
      if (pathname === "/maintenance/purge-inactive" && nodeReq.method === "POST") {
        const removed = deleteInactiveDocuments(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ removed }));
        log(`${ts()} POST /maintenance/purge-inactive removed ${removed} inactive documents (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /maintenance/clear-llm-cache — clear LLM response cache
      // -----------------------------------------------------------------------
      if (pathname === "/maintenance/clear-llm-cache" && nodeReq.method === "POST") {
        const removed = deleteLLMCache(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ removed }));
        log(`${ts()} POST /maintenance/clear-llm-cache removed ${removed} cached entries (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /maintenance/vacuum — run VACUUM on the database
      // -----------------------------------------------------------------------
      if (pathname === "/maintenance/vacuum" && nodeReq.method === "POST") {
        vacuumDatabase(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /maintenance/vacuum completed (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /browse?path=...&type=file|dir — browse local filesystem
      // -----------------------------------------------------------------------
      if ((pathname === "/browse" || pathname.startsWith("/browse/")) && nodeReq.method === "GET") {
        const { readdir, stat } = await import("node:fs/promises");
        const browseUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
        const browsePath = browseUrl.searchParams.get("path") || homedir();
        const browseType = browseUrl.searchParams.get("type") || "all"; // "file", "dir", "all"

        try {
          const entries = await readdir(browsePath, { withFileTypes: true });
          const items: Array<{ name: string; path: string; type: "file" | "directory" }> = [];
          for (const entry of entries) {
            if (entry.name.startsWith(".")) continue; // skip hidden
            const entryPath = resolve(browsePath, entry.name);
            const type = entry.isDirectory() ? "directory" : "file";
            if (browseType === "file" && type === "directory") { items.push({ name: entry.name, path: entryPath, type }); continue; }
            if (browseType === "dir" && type === "file") continue;
            items.push({ name: entry.name, path: entryPath, type });
          }
          // Sort: directories first, then alphabetical
          items.sort((a, b) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          const parentPath = resolve(browsePath, "..");
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ path: browsePath, parent: parentPath !== browsePath ? parentPath : null, items }));
          log(`${ts()} GET /browse path=${browsePath} → ${items.length} items (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Cannot read directory: ${err?.message || browsePath}` }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Block external browse access to hidden/secret collections (e.g. _config, _credentials).
      // -----------------------------------------------------------------------
      const collAccessMatch = pathname.match(/^\/collections\/([^/]+)/);
      if (collAccessMatch) {
        const collName = decodeURIComponent(collAccessMatch[1]!);
        if (!isExternallyVisibleCollection(collName)) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
          return;
        }
      }

      // -----------------------------------------------------------------------
      // GET /collections/_write_queue/files — virtual file list from in-memory queue
      // -----------------------------------------------------------------------
      if (pathname === "/collections/_write_queue/files" && nodeReq.method === "GET") {
        const files = writeQueue.map(e => ({
          path: `${e.collection}/${e.path}`,
          displayPath: `${e.collection}/${e.path}`,
          title: `[${e.op}] ${e.collection}/${e.path}`,
          size: e.content.length,
          modifiedAt: new Date(e.enqueuedAt).toISOString(),
          docid: e.id,
          indexEntries: 0,
          isTextOnly: true,
          status: e.status,
          attempts: e.attempts,
          error: e.error,
        }));
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(files));
        log(`${ts()} GET /collections/_write_queue/files → ${files.length} entries (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /collections/:name/files — list active files in a collection
      // -----------------------------------------------------------------------
      const filesListMatch = pathname.match(/^\/collections\/([^/]+)\/files$/) ;
      if (filesListMatch && nodeReq.method === "GET") {
        const collName = decodeURIComponent(filesListMatch[1]!);
        // Check YAML config first, then fall back to checking the database
        // (raw-only collections like _workspace and _sessions have no YAML entry)
        const coll = getCollection(collName);
        if (!coll) {
          const dbCheck = store.db.prepare(
            `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
          ).get(collName);
          if (!dbCheck) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
            return;
          }
        }
        const rows = (store.db.prepare(`
          SELECT d.path, d.title, d.hash, d.modified_at,
                 LENGTH(c.doc) as size, SUBSTR(c.doc, 1, 120) as docHead
          FROM documents d
          JOIN content c ON c.hash = d.hash
          WHERE d.collection = ? AND d.active = 1
          ORDER BY d.path ASC
        `).all(collName)) as { path: string; title: string; hash: string; modified_at: string; size: number; docHead: string }[];

        // Group documents into files: originals + their index entries
        type GroupedFile = {
          path: string; displayPath: string; title: string; size: number;
          modifiedAt: string; docid: string;
          indexEntries: number; mimeType?: string; isTextOnly: boolean;
        };
        const fileMap = new Map<string, GroupedFile>();

        // Helper to detect legacy page/sheet paths (#page-N, #sheet-X)
        const legacyBase = (p: string): { base: string; isIndex: boolean } | null => {
          const m = p.match(/^(.+\.pdf)#page-\d+$/i);
          if (m) return { base: m[1]!, isIndex: true };
          const s = p.match(/^(.+\.json)#sheet-.+$/);
          if (s) return { base: s[1]!, isIndex: true };
          return null;
        };

        for (const r of rows) {
          let basePath: string;
          let isIdx: boolean;

          if (isIndexPath(r.path)) {
            basePath = getBasePath(r.path);
            isIdx = true;
          } else {
            const legacy = legacyBase(r.path);
            if (legacy) {
              basePath = legacy.base;
              isIdx = true;
            } else {
              basePath = r.path;
              isIdx = false;
            }
          }

          const existing = fileMap.get(basePath);
          if (isIdx) {
            // Index entry — increment count
            if (existing) {
              existing.indexEntries++;
            } else {
              // Orphaned index (no original stored yet — legacy data)
              fileMap.set(basePath, {
                path: basePath, displayPath: `${collName}/${basePath}`,
                title: r.title, size: r.size, modifiedAt: r.modified_at,
                docid: `#${r.hash.slice(0, 6)}`,
                indexEntries: 1, isTextOnly: false,
              });
            }
          } else {
            // Original or text-only file
            const isBlobEnvelope = r.docHead.startsWith('{"kind":"straja-vault-browser-upload-blob');
            let realSize = r.size;
            let mimeType: string | undefined;
            if (isBlobEnvelope) {
              // Parse full content to get real size + mime
              const fullDoc = store.db.prepare(
                `SELECT doc FROM content WHERE hash = ?`
              ).get(r.hash) as { doc: string } | undefined;
              if (fullDoc) {
                const blob = decodeBrowserUploadBlobEnvelope(fullDoc.doc);
                if (blob) { realSize = blob.byteLength; mimeType = blob.mimeType; }
              }
            }
            const isText = !isBlobEnvelope;
            if (existing) {
              // Update with original's metadata
              existing.title = r.title; existing.size = realSize;
              existing.modifiedAt = r.modified_at;
              existing.docid = `#${r.hash.slice(0, 6)}`;
              existing.mimeType = mimeType; existing.isTextOnly = isText;
            } else {
              fileMap.set(basePath, {
                path: basePath, displayPath: `${collName}/${basePath}`,
                title: r.title, size: realSize, modifiedAt: r.modified_at,
                docid: `#${r.hash.slice(0, 6)}`,
                indexEntries: isText ? 1 : 0, mimeType, isTextOnly: isText,
              });
            }
          }
        }

        // Internal marker files: used for folder structure computation but hidden as direct children
        const isMarkerFile = (p: string) => p === ".collection" || p.endsWith("/.gitkeep");
        const allFiles = Array.from(fileMap.values())
          .sort((a, b) => a.path.localeCompare(b.path));

        // Support ?prefix= for folder browsing: returns virtual folder entries + direct child files
        const prefix = requestUrl.searchParams.get("prefix") || "";
        if (prefix) {
          const norm = prefix.endsWith("/") ? prefix : prefix + "/";
          type BrowseEntry = GroupedFile & { type: "file" | "folder"; childCount?: number };
          const folderSet = new Set<string>();
          const entries: BrowseEntry[] = [];

          for (const f of allFiles) {
            if (!f.path.startsWith(norm)) continue;
            const rest = f.path.slice(norm.length);
            const slashIdx = rest.indexOf("/");
            if (slashIdx === -1) {
              // Direct child file — skip marker files
              if (!isMarkerFile(f.path)) {
                entries.push({ ...f, type: "file" });
              }
            } else {
              // Nested — extract immediate subfolder
              const folder = rest.slice(0, slashIdx);
              if (!folderSet.has(folder)) {
                folderSet.add(folder);
                // Count visible files under this folder prefix
                const folderPrefix = norm + folder + "/";
                const childCount = allFiles.filter(ff => ff.path.startsWith(folderPrefix) && !isMarkerFile(ff.path)).length;
                entries.push({
                  path: norm + folder,
                  displayPath: `${collName}/${norm}${folder}`,
                  title: folder,
                  size: 0, modifiedAt: "", docid: "",
                  indexEntries: 0, isTextOnly: true,
                  type: "folder", childCount,
                });
              }
            }
          }
          entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.path.localeCompare(b.path);
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(entries));
          log(`${ts()} GET /collections/${collName}/files?prefix=${prefix} → ${entries.length} entries (${Date.now() - reqStart}ms)`);
          return;
        }

        // No prefix — return top-level virtual folders + root files
        {
          type BrowseEntry = GroupedFile & { type: "file" | "folder"; childCount?: number };
          const folderSet = new Set<string>();
          const entries: BrowseEntry[] = [];

          for (const f of allFiles) {
            const slashIdx = f.path.indexOf("/");
            if (slashIdx === -1) {
              // Root file — skip marker files
              if (!isMarkerFile(f.path)) {
                entries.push({ ...f, type: "file" });
              }
            } else {
              const folder = f.path.slice(0, slashIdx);
              if (!folderSet.has(folder)) {
                folderSet.add(folder);
                const folderPrefix = folder + "/";
                const childCount = allFiles.filter(ff => ff.path.startsWith(folderPrefix) && !isMarkerFile(ff.path)).length;
                entries.push({
                  path: folder,
                  displayPath: `${collName}/${folder}`,
                  title: folder,
                  size: 0, modifiedAt: "", docid: "",
                  indexEntries: 0, isTextOnly: true,
                  type: "folder", childCount,
                });
              }
            }
          }
          entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.path.localeCompare(b.path);
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(entries));
          log(`${ts()} GET /collections/${collName}/files → ${entries.length} entries (${Date.now() - reqStart}ms)`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /collections/:name/files/*path — get file content
      //   ?view=index — return index entries (::*) for this file instead
      // -----------------------------------------------------------------------
      const fileContentMatch = pathname.match(/^\/collections\/([^/]+)\/files\/(.+)$/);
      if (fileContentMatch && nodeReq.method === "GET") {
        const collName = decodeURIComponent(fileContentMatch[1]!);
        const filePath = decodeURIComponent(fileContentMatch[2]!);
        const viewParam = requestUrl.searchParams.get("view");

        // --- Index entries view ---
        if (viewParam === "index") {
          // New format: path::*
          const indexPrefix = `${filePath}${INDEX_SEPARATOR}`;
          const newRows = (store.db.prepare(`
            SELECT d.path, d.title, d.hash, d.modified_at, LENGTH(c.doc) as size,
              REPLACE(REPLACE(SUBSTR(c.doc, 1, 120), CHAR(10), ' '), CHAR(13), ' ') as snippet
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = ? AND d.path LIKE ? AND d.active = 1
            ORDER BY d.path ASC
          `).all(collName, `${indexPrefix}%`)) as { path: string; title: string; hash: string; modified_at: string; size: number; snippet: string }[];

          // Legacy format: path#page-N (PDFs), path#sheet-* (spreadsheets)
          const legacyRows = (store.db.prepare(`
            SELECT d.path, d.title, d.hash, d.modified_at, LENGTH(c.doc) as size,
              REPLACE(REPLACE(SUBSTR(c.doc, 1, 120), CHAR(10), ' '), CHAR(13), ' ') as snippet
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = ? AND (d.path LIKE ? OR d.path LIKE ?) AND d.active = 1
            ORDER BY d.path ASC
          `).all(collName, `${filePath}#page-%`, `${filePath}#sheet-%`)) as { path: string; title: string; hash: string; modified_at: string; size: number; snippet: string }[];

          // Also check legacy spreadsheet .json base
          let jsonLegacyRows: typeof legacyRows = [];
          const extMatch = filePath.match(/^(.+)\.(xlsx?|csv)$/i);
          if (extMatch) {
            const jsonBase = `${extMatch[1]}.json`;
            jsonLegacyRows = (store.db.prepare(`
              SELECT d.path, d.title, d.hash, d.modified_at, LENGTH(c.doc) as size,
                REPLACE(REPLACE(SUBSTR(c.doc, 1, 120), CHAR(10), ' '), CHAR(13), ' ') as snippet
              FROM documents d
              JOIN content c ON c.hash = d.hash
              WHERE d.collection = ? AND d.path LIKE ? AND d.active = 1
              ORDER BY d.path ASC
            `).all(collName, `${jsonBase}#sheet-%`)) as typeof legacyRows;
          }

          const allRows = [...newRows, ...legacyRows, ...jsonLegacyRows];
          const entries = allRows.map(r => {
            // Compute a human-readable suffix
            let suffix: string;
            if (r.path.startsWith(indexPrefix)) {
              suffix = r.path.slice(indexPrefix.length);
            } else {
              const hashIdx = r.path.indexOf("#");
              suffix = hashIdx !== -1 ? r.path.slice(hashIdx + 1) : r.path;
            }
            // Clean snippet: collapse whitespace runs
            const snippet = (r.snippet || "").replace(/\s{2,}/g, " ").trim();
            return {
              path: r.path,
              suffix,
              title: r.title,
              snippet,
              size: r.size,
              modifiedAt: r.modified_at,
              docid: `#${r.hash.slice(0, 6)}`,
            };
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(entries));
          log(`${ts()} GET /collections/${collName}/files/${filePath}?view=index → ${entries.length} entries (${Date.now() - reqStart}ms)`);
          return;
        }

        // --- Normal file content view ---
        const row = store.db.prepare(`
          SELECT d.path, d.title, d.hash
          FROM documents d
          WHERE d.collection = ? AND d.path = ? AND d.active = 1
          LIMIT 1
        `).get(collName, filePath) as { path: string; title: string; hash: string } | undefined;
        if (!row) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `File not found: ${filePath}` }));
          return;
        }
        const bodyRow = store.db.prepare(`
          SELECT doc
          FROM content
          WHERE hash = ?
          LIMIT 1
        `).get(row.hash) as { doc: string } | undefined;
        const body = bodyRow?.doc ?? "";
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({
          path: filePath,
          displayPath: `${collName}/${row.path}`,
          title: row.title,
          content: body,
          docid: `#${row.hash.slice(0, 6)}`,
        }));
        log(`${ts()} GET /collections/${collName}/files/${filePath} (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /collections/empty — create an empty (unlinked) collection
      // -----------------------------------------------------------------------
      if (pathname === "/collections/empty" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { name?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        const name = params.name?.trim();
        if (!name) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: name" }));
          return;
        }
        if (name.startsWith("_")) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection name cannot start with underscore` }));
          return;
        }
        // Check if collection already exists
        const existing = getCollection(name);
        const dbCheck = store.db.prepare(
          `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
        ).get(name);
        if (existing || dbCheck) {
          nodeRes.writeHead(409, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection "${name}" already exists` }));
          return;
        }
        // Create a hidden marker document so the collection appears in listings
        const now = new Date().toISOString();
        const marker = `Collection "${name}" created at ${now}`;
        const hash = await hashContent(marker);
        store.insertContent(hash, marker, now);
        store.insertDocument(name, ".collection", ".collection", hash, now, now, "api");
        nodeRes.writeHead(201, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ name, documents: 0 }));
        log(`${ts()} POST /collections/empty → ${name} (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /collections/:name/folders — create a virtual folder (placeholder)
      // -----------------------------------------------------------------------
      const folderCreateMatch = pathname.match(/^\/collections\/([^/]+)\/folders$/);
      if (folderCreateMatch && nodeReq.method === "POST") {
        const collName = decodeURIComponent(folderCreateMatch[1]!);
        const rawBody = await collectBody(nodeReq);
        let params: { path?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        const folderPath = params.path?.trim();
        if (!folderPath) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: path" }));
          return;
        }
        // Ensure collection exists
        const coll = getCollection(collName);
        const dbCheck = store.db.prepare(
          `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
        ).get(collName);
        if (!coll && !dbCheck) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
          return;
        }
        // Normalize folder path (strip trailing slash)
        const norm = folderPath.replace(/\/+$/, "");
        const docPath = `${norm}/.gitkeep`;
        // Check if folder already has content
        const existingInFolder = store.db.prepare(
          `SELECT 1 FROM documents WHERE collection = ? AND active = 1 AND path LIKE ? LIMIT 1`
        ).get(collName, `${norm}/%`);
        if (existingInFolder) {
          // Folder already exists (has content) — just return success
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, path: norm, created: false }));
          return;
        }
        // Create placeholder
        const now = new Date().toISOString();
        const content = "";
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);
        store.insertDocument(collName, docPath, docPath, hash, now, now, "api");
        nodeRes.writeHead(201, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, path: norm, created: true }));
        log(`${ts()} POST /collections/${collName}/folders → ${norm} (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /collections — add a new collection and index it
      // -----------------------------------------------------------------------
      if (pathname === "/collections" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { path?: string; name?: string; pattern?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        if (!params.path || !params.name) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required fields: path, name" }));
          return;
        }
        if (params.name.startsWith("_")) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection "${params.name}" is system-managed and cannot be created manually` }));
          return;
        }

        // Validate path exists
        let resolvedPath: string;
        try {
          const { existsSync } = await import("node:fs");
          resolvedPath = resolve(params.path);
          if (!existsSync(resolvedPath)) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Path does not exist: ${params.path}` }));
            return;
          }
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid path: ${params.path}` }));
          return;
        }

        const vaultJs = resolve(dirname(fileURLToPath(import.meta.url)), "vault.js");
        const pattern = params.pattern ?? "**/*";
        const args = ["collection", "add", resolvedPath, "--name", params.name, "--mask", pattern];
        const result = await runSubcommand(vaultJs, args, store.dbPath);
        if (result.exitCode !== 0) {
          // Detect "already exists" (exit 1 from collectionAdd)
          const stderr = result.stderr + result.stdout;
          if (stderr.includes("already exists")) {
            nodeRes.writeHead(409, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection '${params.name}' already exists` }));
          } else {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: result.stderr || result.stdout || "Failed to add collection" }));
          }
          return;
        }
        // Get stats and respond immediately, then embed in background
        const status = getStatus(store.db);
        const coll = status.collections.find(c => c.name === params.name);
        nodeRes.writeHead(201, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ name: params.name, documents: coll?.documents ?? 0, embedded: false }));
        log(`${ts()} POST /collections → ${params.name} (${Date.now() - reqStart}ms)`);

        // Auto-embed in background (non-blocking)
        startBackgroundEmbed({ trigger: "collections-create" });
        return;
      }

      // -----------------------------------------------------------------------
      // POST /sync — re-scan all collections and pick up filesystem changes
      // -----------------------------------------------------------------------
      if (pathname === "/sync" && nodeReq.method === "POST") {
        const vaultJs = resolve(dirname(fileURLToPath(import.meta.url)), "vault.js");
        const result = await runSubcommand(vaultJs, ["update"], store.dbPath);
        if (result.exitCode !== 0) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: result.stderr || "Sync failed" }));
          return;
        }
        const status = getStatus(store.db);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, documents: status.totalDocuments }));
        log(`${ts()} POST /sync (${Date.now() - reqStart}ms)`);
        startBackgroundEmbed({ trigger: "sync" });
        return;
      }

      // POST /collections/:name/update — re-index a collection
      // -----------------------------------------------------------------------
      const collUpdateMatch = pathname.match(/^\/collections\/([^/]+)\/update$/);
      if (collUpdateMatch && nodeReq.method === "POST") {
        const collName = decodeURIComponent(collUpdateMatch[1]!);
        if (isSystemCollection(collName)) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            error: `Collection '${collName}' is system-managed and cannot be re-indexed`,
          }));
          return;
        }
        const coll = getCollection(collName);
        if (!coll) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
          return;
        }
        const vaultJs = resolve(dirname(fileURLToPath(import.meta.url)), "vault.js");
        const result = await runSubcommand(vaultJs, ["update"], store.dbPath);
        if (result.exitCode !== 0) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: result.stderr || "Update failed" }));
          return;
        }
        // Get stats and respond immediately, then embed in background
        const status = getStatus(store.db);
        const collStatus = status.collections.find(c => c.name === collName);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ name: collName, documents: collStatus?.documents ?? 0, embedded: false }));
        log(`${ts()} POST /collections/${collName}/update (${Date.now() - reqStart}ms)`);

        // Auto-embed in background (non-blocking)
        startBackgroundEmbed({ trigger: `collection-update:${collName}` });
        return;
      }

      // -----------------------------------------------------------------------
      // POST /collections/:name/files — add specific files to a collection
      // -----------------------------------------------------------------------
      const collFilesAddMatch = pathname.match(/^\/collections\/([^/]+)\/files$/);
      if (collFilesAddMatch && nodeReq.method === "POST") {
        const collName = decodeURIComponent(collFilesAddMatch[1]!);

        const rawBody = await collectBody(nodeReq);
        let params: { paths?: string[] };
        try { params = JSON.parse(rawBody); } catch { params = {}; }
        if (!Array.isArray(params.paths) || params.paths.length === 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: paths (array of file paths)" }));
          return;
        }

        if (isSystemBrowserRawCollection(collName)) {
          try {
            await ensureSystemBrowserRawCollections(store, log);
            const result = await importFilesToSystemRawCollection(store, collName, params.paths);
            const status = getStatus(store.db);
            const collStatus = status.collections.find(c => c.name === collName);
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              name: collName,
              added: params.paths.length,
              imported: result.imported,
              overwritten: result.overwritten,
              bytesTotal: result.bytesTotal,
              documents: collStatus?.documents ?? 0,
              embedded: false,
              raw: true,
            }));
            log(`${ts()} POST /collections/${collName}/files +${params.paths.length} raw files (${result.bytesTotal}b, ${Date.now() - reqStart}ms)`);
          } catch (err: any) {
            nodeRes.writeHead(500, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: err?.message || "Failed to add raw upload files" }));
          }
          return;
        }

        // Auto-create collection if it doesn't exist
        let coll = getCollection(collName);
        if (!coll) {
          if (isSystemBrowserRawCollection(collName)) {
            await ensureSystemBrowserRawCollections(store, log);
            coll = getCollection(collName);
          }
        }
        if (!coll) {
          // Use a virtual path so `vault update` won't re-scan a real folder.
          // Files are added individually via `add-files` — no glob scan needed.
          const virtualPath = join(dirname(store.dbPath), `.${collName}.virtual`);
          addCollection(collName, virtualPath, "**/*");
          log(`${ts()} Auto-created collection "${collName}" (add-files, virtual path)`);
          coll = getCollection(collName);
        }

        // Run add-files CLI subcommand
        const vaultJs = resolve(dirname(fileURLToPath(import.meta.url)), "vault.js");
        const args = ["collection", "add-files", collName, ...params.paths];
        const result = await runSubcommand(vaultJs, args, store.dbPath);
        if (result.exitCode !== 0) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: result.stderr || "Failed to add files" }));
          return;
        }

        // Get stats and respond immediately, then embed in background
        const status = getStatus(store.db);
        const collStatus = status.collections.find(c => c.name === collName);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({
          name: collName,
          added: params.paths.length,
          documents: collStatus?.documents ?? 0,
          embedded: false,
        }));
        log(`${ts()} POST /collections/${collName}/files +${params.paths.length} files (${Date.now() - reqStart}ms)`);

        // Auto-embed in background (non-blocking)
        startBackgroundEmbed({ trigger: `collection-files:${collName}` });
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /collections/:name/folders — deactivate all files under a prefix
      // -----------------------------------------------------------------------
      const collFolderDeleteMatch = pathname.match(/^\/collections\/([^/]+)\/folders$/);
      if (collFolderDeleteMatch && nodeReq.method === "DELETE") {
        const collName = decodeURIComponent(collFolderDeleteMatch[1]!);
        const coll = getCollection(collName);
        if (!coll) {
          const dbCheck = store.db.prepare(
            `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
          ).get(collName);
          if (!dbCheck) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
            return;
          }
        }
        const rawBody = await collectBody(nodeReq);
        let params: { prefix?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }
        if (!params.prefix || typeof params.prefix !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: prefix (string)" }));
          return;
        }
        // Ensure prefix ends with / for clean folder matching
        const prefix = params.prefix.endsWith("/") ? params.prefix : `${params.prefix}/`;
        // Find all active files under this prefix
        const filePaths = (store.db.prepare(
          `SELECT path FROM documents WHERE collection = ? AND path LIKE ? AND active = 1`
        ).all(collName, `${prefix}%`) as { path: string }[]).map((r) => r.path);

        if (filePaths.length === 0) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ deleted: 0, deactivated: 0 }));
          return;
        }
        let totalDeactivated = 0;
        store.db.exec("BEGIN");
        try {
          for (const p of filePaths) {
            store.deactivateDocument(collName, p);
            totalDeactivated++;
            // Cascade: also deactivate index entries
            if (!isIndexPath(p)) {
              const indexPrefix = `${p}${INDEX_SEPARATOR}`;
              const indexPaths = (store.db.prepare(
                `SELECT path FROM documents WHERE collection = ? AND path LIKE ? AND active = 1`
              ).all(collName, `${indexPrefix}%`) as { path: string }[]);
              for (const idx of indexPaths) {
                store.deactivateDocument(collName, idx.path);
                totalDeactivated++;
              }
            }
          }
          store.db.exec("COMMIT");
        } catch (err) {
          store.db.exec("ROLLBACK");
          throw err;
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ deleted: filePaths.length, deactivated: totalDeactivated }));
        log(`${ts()} DELETE /collections/${collName}/folders prefix="${prefix}" → ${filePaths.length} files, ${totalDeactivated} deactivated (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /collections/:name/files — deactivate specific files
      // -----------------------------------------------------------------------
      const collFilesDeleteMatch = pathname.match(/^\/collections\/([^/]+)\/files$/);
      if (collFilesDeleteMatch && nodeReq.method === "DELETE") {
        const collName = decodeURIComponent(collFilesDeleteMatch[1]!);
        // Check YAML config first, then fall back to checking the database
        // (raw-only collections like _workspace and _sessions have no YAML entry)
        const coll = getCollection(collName);
        if (!coll) {
          const dbCheck = store.db.prepare(
            `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
          ).get(collName);
          if (!dbCheck) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
            return;
          }
        }
        const rawBody = await collectBody(nodeReq);
        let params: { paths?: string[] };
        try { params = JSON.parse(rawBody); } catch { params = {}; }
        if (!Array.isArray(params.paths) || params.paths.length === 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: paths (array)" }));
          return;
        }
        let totalDeactivated = 0;
        // Wrap in a transaction for bulk deletes — without this, each
        // deactivateDocument auto-commits (fsync to WAL), making 900+
        // deletes take minutes instead of seconds.
        store.db.exec("BEGIN");
        try {
          for (const p of params.paths) {
            store.deactivateDocument(collName, p);
            totalDeactivated++;
            // Cascade: also deactivate all index entries
            if (!isIndexPath(p)) {
              // New format: path::*
              const indexPrefix = `${p}${INDEX_SEPARATOR}`;
              const indexPaths = (store.db.prepare(
                `SELECT path FROM documents WHERE collection = ? AND path LIKE ? AND active = 1`
              ).all(collName, `${indexPrefix}%`) as { path: string }[]);
              for (const idx of indexPaths) {
                store.deactivateDocument(collName, idx.path);
                totalDeactivated++;
              }
              // Legacy format: path#page-N (PDFs) and path#sheet-* (spreadsheets)
              const legacyPaths = (store.db.prepare(
                `SELECT path FROM documents WHERE collection = ? AND (path LIKE ? OR path LIKE ?) AND active = 1`
              ).all(collName, `${p}#page-%`, `${p}#sheet-%`) as { path: string }[]);
              for (const idx of legacyPaths) {
                store.deactivateDocument(collName, idx.path);
                totalDeactivated++;
              }
              // Legacy spreadsheets may have been stored under .json base with #sheet-* suffix
              // e.g., original was report.xlsx but index is report.json#sheet-X
              const extMatch = p.match(/^(.+)\.(xlsx?|csv)$/i);
              if (extMatch) {
                const jsonBase = `${extMatch[1]}.json`;
                store.deactivateDocument(collName, jsonBase);
                const jsonLegacy = (store.db.prepare(
                  `SELECT path FROM documents WHERE collection = ? AND path LIKE ? AND active = 1`
                ).all(collName, `${jsonBase}#sheet-%`) as { path: string }[]);
                for (const idx of jsonLegacy) {
                  store.deactivateDocument(collName, idx.path);
                  totalDeactivated++;
                }
              }
            }
          }
          store.db.exec("COMMIT");
        } catch (err) {
          store.db.exec("ROLLBACK");
          throw err;
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ deleted: params.paths.length, deactivated: totalDeactivated }));
        log(`${ts()} DELETE /collections/${collName}/files → ${params.paths.length} files, ${totalDeactivated} total deactivated (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /spreadsheets/get — read a structured spreadsheet-backed doc
      // -----------------------------------------------------------------------
      if (pathname === "/spreadsheets/get" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { collection?: string; path?: string; limit?: number };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        const collection = String(params.collection || "").trim();
        const path = String(params.path || "").trim();
        if (!collection || !path) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "collection and path are required" }));
          return;
        }

        try {
          const resolved = resolveSpreadsheetDocument(store, collection, path);
          if (!resolved) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Spreadsheet document not found: ${collection}/${path}` }));
            return;
          }
          const parsed = parseSpreadsheetDocumentContent(resolved.content);
          const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
          const rows = parsed.rows.slice(0, limit);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            collection,
            path: resolved.path,
            title: resolved.title,
            rowCount: parsed.rows.length,
            columns: spreadsheetColumns(parsed.rows),
            rows,
            sourceAsset: parsed.sourceAsset || null,
            truncated: parsed.rows.length > rows.length,
          }));
          log(`${ts()} POST /spreadsheets/get ${collection}/${resolved.path} → ${rows.length}/${parsed.rows.length} rows (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to read spreadsheet document" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // POST /spreadsheets/match — find rows in a spreadsheet-backed doc
      // -----------------------------------------------------------------------
      if (pathname === "/spreadsheets/match" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: {
          collection?: string;
          path?: string;
          value?: unknown;
          columns?: string[];
          mode?: string;
          limit?: number;
        };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        const collection = String(params.collection || "").trim();
        const path = String(params.path || "").trim();
        const mode = String(params.mode || "exact").trim() || "exact";
        if (!collection || !path) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "collection and path are required" }));
          return;
        }
        if (params.value === undefined || params.value === null || String(params.value) === "") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "value is required" }));
          return;
        }

        try {
          const resolved = resolveSpreadsheetDocument(store, collection, path);
          if (!resolved) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Spreadsheet document not found: ${collection}/${path}` }));
            return;
          }
          const parsed = parseSpreadsheetDocumentContent(resolved.content);
          const columns = resolveSpreadsheetMatchColumns(parsed.rows, params.columns);
          const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
          const matches: Array<{ rowIndex: number; matchedColumns: string[]; row: SpreadsheetRow }> = [];

          parsed.rows.forEach((row, rowIndex) => {
            const matchedColumns = columns.filter((column) => (
              spreadsheetMatchValuesEqual(row[column], params.value, mode)
            ));
            if (matchedColumns.length > 0 && matches.length < limit) {
              matches.push({ rowIndex, matchedColumns, row });
            }
          });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            collection,
            path: resolved.path,
            title: resolved.title,
            rowCount: parsed.rows.length,
            columns,
            matchValue: String(params.value),
            mode,
            matches,
            truncated: matches.length >= limit,
            sourceAsset: parsed.sourceAsset || null,
          }));
          log(`${ts()} POST /spreadsheets/match ${collection}/${resolved.path} → ${matches.length} matches (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to match spreadsheet document" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // POST /spreadsheets/update — update a row in a spreadsheet-backed doc
      // -----------------------------------------------------------------------
      if (pathname === "/spreadsheets/update" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: {
          collection?: string;
          path?: string;
          rowIndex?: number;
          matchValue?: unknown;
          matchColumns?: string[];
          matchMode?: string;
          updates?: Record<string, unknown>;
          createIfMissing?: boolean;
          seedRow?: Record<string, unknown>;
        };
        try { params = JSON.parse(rawBody); } catch { params = {}; }

        const collection = String(params.collection || "").trim();
        const path = String(params.path || "").trim();
        if (!collection || !path) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "collection and path are required" }));
          return;
        }
        if (!params.updates || typeof params.updates !== "object" || Array.isArray(params.updates)) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "updates must be an object" }));
          return;
        }

        try {
          const resolved = resolveSpreadsheetDocument(store, collection, path);
          if (!resolved) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Spreadsheet document not found: ${collection}/${path}` }));
            return;
          }
          const parsed = parseSpreadsheetDocumentContent(resolved.content);
          let rowIndex = Number.isInteger(params.rowIndex) ? Number(params.rowIndex) : -1;

          if (rowIndex < 0) {
            const matchValue = params.matchValue;
            if (matchValue !== undefined && matchValue !== null && String(matchValue) !== "") {
              const mode = String(params.matchMode || "exact").trim() || "exact";
              const matchColumns = resolveSpreadsheetMatchColumns(parsed.rows, params.matchColumns);
              rowIndex = parsed.rows.findIndex((row) => (
                matchColumns.some((column) => spreadsheetMatchValuesEqual(row[column], matchValue, mode))
              ));
            }
          }

          if (rowIndex < 0) {
            if (!params.createIfMissing) {
              nodeRes.writeHead(404, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ error: "No matching row found" }));
              return;
            }
            parsed.rows.push({
              ...((params.seedRow && typeof params.seedRow === "object" && !Array.isArray(params.seedRow)) ? params.seedRow : {}),
            });
            rowIndex = parsed.rows.length - 1;
          }

          if (rowIndex >= parsed.rows.length) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `rowIndex ${rowIndex} is out of range` }));
            return;
          }

          const currentRow = parsed.rows[rowIndex] ?? {};
          const updatedRow = {
            ...currentRow,
            ...params.updates,
          };
          parsed.rows[rowIndex] = updatedRow;

          const updatedContent = serializeSpreadsheetDocumentContent(parsed.wrapper, parsed.rows);
          await writeNoteToCollection(store, collection, resolved.path, updatedContent, resolved.title);
          const assetResult = parsed.sourceAsset
            ? await regenerateSpreadsheetSourceAsset({
                store,
                sourceAsset: parsed.sourceAsset,
                rows: parsed.rows,
                docPath: resolved.path,
              })
            : { updated: false as const };

          startBackgroundEmbed({ trigger: `spreadsheet-update:${collection}` });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            updated: true,
            collection,
            path: resolved.path,
            title: resolved.title,
            rowIndex,
            row: updatedRow,
            assetUpdated: assetResult.updated,
            assetPath: assetResult.path ?? null,
          }));
          log(`${ts()} POST /spreadsheets/update ${collection}/${resolved.path} row ${rowIndex} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update spreadsheet document" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /collections/:name — remove collection + all its docs
      // -----------------------------------------------------------------------
      const collDeleteMatch = pathname.match(/^\/collections\/([^/]+)$/);
      if (collDeleteMatch && nodeReq.method === "DELETE") {
        const collName = decodeURIComponent(collDeleteMatch[1]!);
        if (isSystemCollection(collName)) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            error: `Collection '${collName}' is system-managed and cannot be deleted`,
          }));
          return;
        }
        const coll = getCollection(collName);
        if (!coll) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Collection not found: ${collName}` }));
          return;
        }
        const result = removeCollection(store.db, collName);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(result));
        log(`${ts()} DELETE /collections/${collName} → ${result.deletedDocs} docs (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /notes — create a new note in the _notes collection
      // -----------------------------------------------------------------------
      if (pathname === "/notes" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { title?: string; content?: string; collection?: string; prefix?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }
        if (!params.title || typeof params.title !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: title (string)" }));
          return;
        }
        if (params.content == null || typeof params.content !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: content (string)" }));
          return;
        }
        // Determine target collection: explicit param or default _notes
        const targetCollection = params.collection?.trim() || NOTES_COLLECTION;
        if (targetCollection === NOTES_COLLECTION) {
          await ensureNotesCollection(store, log);
        } else {
          // Verify the target collection exists
          const coll = getCollection(targetCollection);
          const dbCheck = store.db.prepare(
            `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
          ).get(targetCollection);
          if (!coll && !dbCheck) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection not found: ${targetCollection}` }));
            return;
          }
        }
        const ts_stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const filename = `${slugify(params.title)}-${ts_stamp}.md`;
        const folderPrefix = params.prefix?.trim().replace(/\/+$/, "");
        const path = folderPrefix ? `${folderPrefix}/${filename}` : filename;
        const { hash, size } = await writeNoteToCollection(store, targetCollection, path, params.content, params.title);
        nodeRes.writeHead(201, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ path, title: params.title, hash, size, collection: targetCollection }));
        log(`${ts()} POST /notes → ${targetCollection}/${path} (${size}b, ${Date.now() - reqStart}ms)`);
        startBackgroundEmbed({ trigger: "notes-create" });
        return;
      }

      // -----------------------------------------------------------------------
      // PUT /notes/:path — update an existing note
      // -----------------------------------------------------------------------
      const noteUpdateMatch = pathname.match(/^\/notes\/(.+)$/);
      if (noteUpdateMatch && nodeReq.method === "PUT") {
        const notePath = decodeURIComponent(noteUpdateMatch[1]!);
        const rawBody = await collectBody(nodeReq);
        let params: { collection?: string; title?: string; content?: string };
        try { params = JSON.parse(rawBody); } catch { params = {}; }
        if (!params.title || typeof params.title !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: title (string)" }));
          return;
        }
        if (params.content == null || typeof params.content !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: content (string)" }));
          return;
        }
        const targetCollection = params.collection?.trim() || NOTES_COLLECTION;
        if (targetCollection === NOTES_COLLECTION) {
          await ensureNotesCollection(store, log);
        } else {
          const coll = getCollection(targetCollection);
          const dbCheck = store.db.prepare(
            `SELECT 1 FROM documents WHERE collection = ? AND active = 1 LIMIT 1`
          ).get(targetCollection);
          if (!coll && !dbCheck) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: `Collection not found: ${targetCollection}` }));
            return;
          }
        }
        const existing = store.findActiveDocument(targetCollection, notePath);
        if (!existing) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Note not found: ${targetCollection}/${notePath}` }));
          return;
        }
        const { hash, size } = await writeNoteToCollection(store, targetCollection, notePath, params.content, params.title);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ path: notePath, title: params.title, hash, size, collection: targetCollection }));
        log(`${ts()} PUT /notes/${notePath} → ${targetCollection} (${size}b, ${Date.now() - reqStart}ms)`);
        startBackgroundEmbed({ trigger: "notes-update" });
        return;
      }

      // -----------------------------------------------------------------------
      // POST /pull — download models
      // -----------------------------------------------------------------------
      if (pathname === "/pull" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { refresh?: boolean };
        try { params = JSON.parse(rawBody || "{}"); } catch { params = {}; }
        const pullRun = startModelPull(Boolean(params.refresh), "manual");
        if (!pullRun) {
          nodeRes.writeHead(409, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Model download already in progress." }));
          return;
        }
        const result = await pullRun;
        if (result.exitCode !== 0) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: result.stderr || "Pull failed" }));
          return;
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, output: result.stdout.trim() }));
        log(`${ts()} POST /pull (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /models/status — check if models are downloaded
      // -----------------------------------------------------------------------
      if (pathname === "/models/status" && nodeReq.method === "GET") {
        const before = await getModelsStatusSnapshot();
        if (!before.downloaded && !before.pulling && !modelPullState.autoStarted) {
          modelPullState.autoStarted = true;
          startModelPull(false, "auto:models-status");
        }
        const after = await getModelsStatusSnapshot();
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(after));
        log(`${ts()} GET /models/status (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /exec — sandboxed command execution (sync + background modes)
      // -----------------------------------------------------------------------
      if (pathname === "/exec" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: {
          command?: string;
          args?: string[];
          cwd?: string;
          timeout?: number;
          collection?: string;
          background?: boolean;
          yieldMs?: number;
          stdinMode?: "pipe" | "ignore";
        };
        try {
          params = JSON.parse(rawBody);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.command || typeof params.command !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: command (string)" }));
          return;
        }

        const collection = params.collection || "_workspace";
        if (isSystemBrowserRawCollection(collection)) {
          rejectSystemBrowserRawCollection(nodeRes, collection);
          return;
        }

        let backend;
        try {
          backend = resolveBackend();
        } catch (err: any) {
          const detail =
            err instanceof Error && err.message.trim() ? err.message.trim() : "backend unavailable";
          nodeRes.writeHead(503, { "Content-Type": "application/json" });
          nodeRes.end(
            JSON.stringify({
              error:
                "Command execution backend unavailable. Shell commands and binary conversions are disabled, but vault-backed read/write/edit tools remain available.",
              detail,
            }),
          );
          log(`${ts()} POST /exec → 503 backend unavailable (${detail})`);
          return;
        }

        const maxTimeoutMs = params.background || params.yieldMs ? 1_800_000 : 300_000; // 30min for bg, 5min for sync
        const timeoutMs = Math.min(Math.max((params.timeout ?? 30) * 1000, 1000), maxTimeoutMs);
        const execArgs = params.args ?? [];
        const wantBackground = params.background === true;
        const yieldMs = typeof params.yieldMs === "number" ? Math.max(10, Math.min(params.yieldMs, 120_000)) : undefined;
        const stdinMode = params.stdinMode ?? (wantBackground ? "pipe" : "ignore");

        log(`${ts()} POST /exec → command=${params.command} background=${wantBackground} yieldMs=${yieldMs} timeout=${timeoutMs}ms`);

        let execTempDir: string | undefined;
        try {
          // 1. Materialize workspace
          execTempDir = await mkdtemp(join(tmpdir(), "vault-exec-"));
          const rows = store.db.prepare(`
            SELECT d.path, d.hash, c.doc
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = ? AND d.active = 1
          `).all(collection) as { path: string; hash: string; doc: string }[];

          const originalHashes = new Map<string, string>();
          for (const row of rows) {
            const materialized = materializeStoredWorkspaceDocument(row.doc);
            originalHashes.set(row.path, materialized.contentHash);
            const filePath = join(execTempDir, row.path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, materialized.bytes);
          }

          // Also materialize _editable assets (e.g. original xlsx files from
          // Google Drive) so exec sessions can process them with libraries.
          // These are read-only — changes won't be captured back.
          const editableRows = store.db.prepare(`
            SELECT d.path, c.doc
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = ? AND d.active = 1
          `).all(EDITABLE_COLLECTION) as { path: string; doc: string }[];

          for (const row of editableRows) {
            const filePath = join(execTempDir, row.path);
            // Skip if a workspace file already occupies this path
            if (originalHashes.has(row.path)) continue;
            const materialized = materializeStoredWorkspaceDocument(row.doc);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, materialized.bytes);
          }

          const execCwd = params.cwd
            ? resolve(execTempDir, params.cwd)
            : execTempDir;

          // Validate that cwd actually exists in the materialized workspace
          if (!existsSync(execCwd)) {
            await rm(execTempDir, { recursive: true, force: true }).catch(() => {});
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              error: `cwd "${params.cwd}" does not exist in the materialized workspace. ` +
                `For on-disk repos, use vault_repo_exec instead of vault_exec.`,
            }));
            log(`${ts()} POST /exec → 400 cwd not found: ${params.cwd}`);
            return;
          }

          // --- Background / yield mode: spawn process, register session ---
          if (wantBackground || yieldMs !== undefined) {
            const { createSession, createSessionId, appendOutput, drainSession, markBackgrounded, markExited, killSession } = await import("./exec-registry.js");

            const spawnResult = backend.spawnProcess({
              command: params.command,
              args: execArgs,
              cwd: execCwd,
              allowNetwork: false,
              stdinMode,
            });

            const sessionId = createSessionId();
            const session = createSession({
              id: sessionId,
              command: params.command,
              args: execArgs,
              cwd: params.cwd || ".",
              tempDir: execTempDir,
              collection,
              originalHashes,
              child: spawnResult.child,
              stdin: spawnResult.stdin,
            });

            // Wire up output buffering
            spawnResult.child.stdout?.on("data", (chunk: Buffer) => {
              appendOutput(session, "stdout", chunk.toString());
            });
            spawnResult.child.stderr?.on("data", (chunk: Buffer) => {
              appendOutput(session, "stderr", chunk.toString());
            });

            // Setup timeout
            let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
            if (timeoutMs > 0) {
              timeoutHandle = setTimeout(() => {
                if (!session.exited) {
                  session.timedOut = true;
                  killSession(session);
                }
              }, timeoutMs);
              timeoutHandle.unref?.();
            }

            // Wire up exit handler
            spawnResult.child.on("close", (code: number | null, signal: string | null) => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
              markExited(session, code, signal, store).catch((err) => {
                log(`${ts()} ⚠ session ${sessionId} exit handler error: ${err}`);
              });
            });
            spawnResult.child.on("error", (err: Error) => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
              appendOutput(session, "stderr", `\n[spawn error] ${String(err)}`);
              markExited(session, 1, null, store).catch(() => {});
            });

            if (wantBackground) {
              // Immediate background: return session ID right away
              markBackgrounded(session);
              nodeRes.writeHead(200, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({
                status: "running",
                sessionId,
                pid: spawnResult.pid,
                startedAt: session.startedAt,
                backend: backend.name,
              }));
              log(`${ts()} POST /exec ${params.command} → backgrounded session=${sessionId} pid=${spawnResult.pid}`);
              appendAuditEntry(store, "exec", {
                timestamp: new Date().toISOString(),
                toolName: "vault_exec",
                action: "execute_background",
                command: params.command,
                verdict: "allowed",
                reason: `Backgrounded session=${sessionId} pid=${spawnResult.pid}`,
                severity: "low",
                details: { sessionId, pid: spawnResult.pid, args: execArgs, cwd: params.cwd ?? ".", collection, backend: backend.name },
              }).catch(() => {});
              // Don't clean up temp dir — session owns it
              execTempDir = undefined;
            } else if (yieldMs !== undefined) {
              // Yield mode: wait yieldMs, then either return result or background
              await new Promise<void>((resolveYield) => {
                let responseSettled = false;
                const settleYieldResponse = (): boolean => {
                  if (responseSettled || nodeRes.headersSent || nodeRes.writableEnded || nodeRes.destroyed) {
                    return false;
                  }
                  responseSettled = true;
                  return true;
                };

                const yieldTimer = setTimeout(() => {
                  if (session.exited) {
                    checkExit();
                    return;
                  }
                  if (!settleYieldResponse()) {
                    return;
                  }
                  // Process still running — background it
                  markBackgrounded(session);
                  nodeRes.writeHead(200, { "Content-Type": "application/json" });
                  nodeRes.end(JSON.stringify({
                    status: "running",
                    sessionId,
                    pid: spawnResult.pid,
                    startedAt: session.startedAt,
                    backend: backend.name,
                  }));
                  log(`${ts()} POST /exec ${params.command} → yielded→backgrounded session=${sessionId} after ${yieldMs}ms`);
                  appendAuditEntry(store, "exec", {
                    timestamp: new Date().toISOString(),
                    toolName: "vault_exec",
                    action: "execute_background",
                    command: params.command,
                    verdict: "allowed",
                    reason: `Yield→backgrounded session=${sessionId} after ${yieldMs}ms`,
                    severity: "low",
                    details: { sessionId, pid: spawnResult.pid, args: execArgs, cwd: params.cwd ?? ".", collection, backend: backend.name },
                  }).catch(() => {});
                  execTempDir = undefined; // session owns temp dir
                  resolveYield();
                }, yieldMs);

                // If process exits before yield timer, return full result
                const checkExit = () => {
                  if (responseSettled) {
                    return;
                  }
                  if (session.exited) {
                    clearTimeout(yieldTimer);
                    if (!settleYieldResponse()) {
                      return;
                    }
                    const drained = drainSession(session);
                    nodeRes.writeHead(200, { "Content-Type": "application/json" });
                    nodeRes.end(JSON.stringify({
                      exitCode: session.exitCode,
                      stdout: drained.stdout || session.aggregated,
                      stderr: drained.stderr,
                      timedOut: session.timedOut,
                      filesChanged: session.filesChanged ?? [],
                      backend: backend.name,
                    }));
                    log(`${ts()} POST /exec ${params.command} → exit ${session.exitCode} before yield (${Date.now() - reqStart}ms)`);
                    appendAuditEntry(store, "exec", {
                      timestamp: new Date().toISOString(),
                      toolName: "vault_exec",
                      action: "execute",
                      command: params.command,
                      verdict: session.timedOut ? "error" : "allowed",
                      reason: session.timedOut ? "Timed out" : `exit ${session.exitCode}`,
                      severity: session.timedOut ? "medium" : "low",
                      exitCode: session.exitCode,
                      timedOut: session.timedOut,
                      filesChangedCount: (session.filesChanged ?? []).length,
                      durationMs: Date.now() - reqStart,
                      details: { sessionId, args: execArgs, cwd: params.cwd ?? ".", collection, backend: backend.name },
                    }).catch(() => {});
                    execTempDir = undefined; // already cleaned by markExited
                    resolveYield();
                  }
                };

                // Poll for exit on child close
                spawnResult.child.on("close", () => {
                  // Small delay to let markExited finish async work
                  setTimeout(checkExit, 50);
                });
              });
            }
          } else {
            // --- Synchronous mode (original fire-and-forget) ---
            const result = await backend.execute({
              command: params.command,
              args: execArgs,
              cwd: execCwd,
              timeout: timeoutMs,
              allowNetwork: false,
              maxOutputSize: 1_048_576,
            });

            // Capture changes (same logic, now extracted to exec-registry for bg mode)
            const { captureFileDiffs } = await import("./exec-registry.js");
            const tempSession = {
              tempDir: execTempDir,
              collection,
              originalHashes,
            } as any;
            const filesChanged = await captureFileDiffs(tempSession, store);

            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              timedOut: result.timedOut,
              filesChanged,
              backend: backend.name,
              sandbox: execTempDir,
            }));
            log(`${ts()} POST /exec ${params.command} → exit ${result.exitCode} (${filesChanged.length} files changed) sandbox=${execTempDir} (${Date.now() - reqStart}ms)`);

            // Audit: exec completed
            appendAuditEntry(store, "exec", {
              timestamp: new Date().toISOString(),
              toolName: "vault_exec",
              action: "execute",
              command: params.command,
              verdict: result.timedOut ? "error" : "allowed",
              reason: result.timedOut ? "Timed out" : `exit ${result.exitCode}`,
              severity: result.timedOut ? "medium" : "low",
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              filesChangedCount: filesChanged.length,
              durationMs: Date.now() - reqStart,
              details: { args: execArgs, cwd: params.cwd ?? ".", collection, backend: backend.name, filesChanged: filesChanged.slice(0, 10) },
            }).catch(() => {});
          }
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err.message }));
          log(`${ts()} POST /exec → 500 ${err.message}`);

          // Audit: exec error
          appendAuditEntry(store, "exec", {
            timestamp: new Date().toISOString(),
            toolName: "vault_exec",
            action: "execute",
            command: params.command,
            verdict: "error",
            reason: err.message,
            severity: "high",
            durationMs: Date.now() - reqStart,
            details: { args: execArgs, cwd: params.cwd ?? ".", collection },
          }).catch(() => {});
        } finally {
          // Cleanup temp dir only for sync mode (bg mode: session owns it)
          if (execTempDir) {
            const dirToClean = execTempDir;
            try {
              await rm(dirToClean, { recursive: true, force: true });
              try {
                await stat(dirToClean);
                log(`${ts()} ⚠ exec cleanup: temp dir still exists after rm: ${dirToClean}`);
              } catch {
                // Good — directory is gone
              }
            } catch (cleanupErr: any) {
              log(`${ts()} ⚠ exec cleanup failed for ${dirToClean}: ${cleanupErr.message}`);
            }
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // POST /repo-exec — sandboxed command execution against on-disk repos
      // Runs inside ~/.straja/repos/ with domain-filtered network proxy.
      // -----------------------------------------------------------------------
      if (pathname === "/repo-exec" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: {
          command?: string;
          args?: string[];
          cwd?: string;
          timeout?: number;
          background?: boolean;
          yieldMs?: number;
          stdinMode?: "pipe" | "ignore";
        };
        try {
          params = JSON.parse(rawBody);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.command || typeof params.command !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: command (string)" }));
          return;
        }

        if (!params.cwd) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: cwd (repo name, e.g. 'my-repo' or 'my-repo/src')" }));
          return;
        }

        const resolved = resolve(REPOS_BASE_DIR, String(params.cwd));
        if (!resolved.startsWith(REPOS_BASE_DIR)) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `cwd must be inside ${REPOS_BASE_DIR}` }));
          return;
        }
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Directory not found: ${String(params.cwd)}. Clone the repo first under ~/.straja/repos/` }));
          return;
        }
        const repoPath = realpathSync(resolved);

        let backend;
        try {
          backend = resolveBackend();
        } catch (err: any) {
          nodeRes.writeHead(503, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err.message }));
          log(`${ts()} POST /repo-exec → 503 backend unavailable`);
          return;
        }

        const maxTimeoutMs = params.background || params.yieldMs ? 1_800_000 : 300_000;
        const timeoutMs = Math.min(Math.max((params.timeout ?? 30) * 1000, 1000), maxTimeoutMs);
        const execArgs = params.args ?? [];
        const wantBackground = params.background === true;
        const yieldMs = typeof params.yieldMs === "number" ? Math.max(10, Math.min(params.yieldMs, 120_000)) : undefined;
        const stdinMode = params.stdinMode ?? (wantBackground ? "pipe" : "ignore");

        log(`${ts()} POST /repo-exec → command=${params.command} cwd=${params.cwd} background=${wantBackground} timeout=${timeoutMs}ms`);

        // Determine network allowlist from calling agent config
        const execToken = extractBearerToken(nodeReq);
        const callingAgentMatch = execToken ? findPairedAgentByVaultToken(execToken) : null;
        const callingAgent = callingAgentMatch?.agent;
        const agentAllowlist = callingAgent?.networkAllowlist ?? [];

        // Start domain-filtering proxy for network access
        const { startExecProxy } = await import("./exec-proxy.js");
        const allowedDomains = [...SE_DEFAULT_NETWORK_ALLOWLIST, ...agentAllowlist];
        const proxy = await startExecProxy({ allowedDomains });

        // Inject GIT_ASKPASS so git push/pull works with GitHub token
        const ghConfig = getGitHubConfig();
        let askpassPath: string | undefined;
        if (ghConfig?.accessToken) {
          const { tmpdir } = await import("node:os");
          askpassPath = join(tmpdir(), `.git-askpass-repo-${process.pid}-${Date.now()}`);
          await writeFile(askpassPath, `#!/bin/sh\necho "x-access-token:${ghConfig.accessToken}"`, { mode: 0o700 });
        }

        try {
          const proxyUrl = `http://127.0.0.1:${proxy.port}`;
          const proxyEnv: Record<string, string> = {
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            GIT_HTTP_PROXY: proxyUrl,
            GIT_TERMINAL_PROMPT: "0",
            ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
          };

          if (wantBackground || yieldMs) {
            const { createSession, createSessionId, appendOutput, drainSession, markBackgrounded, markExited, killSession } = await import("./exec-registry.js");
            const spawnResult = backend.spawnProcess({
              command: params.command,
              args: execArgs,
              cwd: repoPath,
              allowNetwork: true,
              stdinMode,
              env: proxyEnv,
              extraReadFiles: askpassPath ? [askpassPath] : undefined,
            });
            const sessionId = createSessionId();
            const session = createSession({
              id: sessionId,
              command: params.command,
              args: execArgs,
              cwd: params.cwd ?? ".",
              tempDir: "", // repo-backed: no temp dir to clean up
              collection: "_workspace",
              originalHashes: new Map(),
              child: spawnResult.child,
              stdin: spawnResult.stdin,
              repoBacked: true,
            });
            spawnResult.child.stdout?.on("data", (chunk: Buffer) => appendOutput(session, "stdout", chunk.toString()));
            spawnResult.child.stderr?.on("data", (chunk: Buffer) => appendOutput(session, "stderr", chunk.toString()));
            spawnResult.child.on("exit", async (code, signal) => {
              await proxy.stop();
              if (askpassPath) await rm(askpassPath, { force: true }).catch(() => {});
              markExited(session, code, signal, store).catch((err) => {
                console.error(`[repo-exec] session ${sessionId} markExited failed:`, err);
              });
            });
            const bgTimeout = setTimeout(() => { killSession(session); }, timeoutMs);
            spawnResult.child.on("exit", () => clearTimeout(bgTimeout));

            if (yieldMs) {
              await new Promise<void>((r) => setTimeout(r, Math.min(yieldMs, 5000)));
              const drained = drainSession(session);
              nodeRes.writeHead(200, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({
                sessionId, status: session.exitCode !== null ? "exited" : "running",
                exitCode: session.exitCode, output: session.aggregated, tail: session.tail,
              }));
            } else {
              markBackgrounded(session);
              nodeRes.writeHead(200, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ sessionId, pid: spawnResult.pid }));
            }
            log(`${ts()} POST /repo-exec (bg) → session=${sessionId} repo=${repoPath} (${Date.now() - reqStart}ms)`);
          } else {
            // Synchronous repo exec
            const result = await backend.execute({
              command: params.command,
              args: execArgs,
              cwd: repoPath,
              timeout: timeoutMs,
              allowNetwork: true,
              maxOutputSize: 200_000,
              env: proxyEnv,
              extraReadFiles: askpassPath ? [askpassPath] : undefined,
            });
            await proxy.stop();

            // Append git status summary for observability
            let gitStatus = "";
            try {
              const gitResult = await backend.execute({
                command: "git", args: ["status", "--porcelain"],
                cwd: repoPath, timeout: 5000, maxOutputSize: 10_000,
                allowNetwork: false,
              });
              if (gitResult.stdout.trim()) {
                gitStatus = `\n--- repo changes ---\n${gitResult.stdout.trim()}`;
              }
            } catch { /* ignore git status failures */ }

            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              exitCode: result.exitCode,
              stdout: result.stdout + gitStatus,
              stderr: result.stderr,
              timedOut: result.timedOut,
            }));
            log(`${ts()} POST /repo-exec (sync) → exit=${result.exitCode} repo=${repoPath} (${Date.now() - reqStart}ms)`);
          }
        } catch (err: any) {
          await proxy.stop().catch(() => {});
          if (askpassPath) await rm(askpassPath, { force: true }).catch(() => {});
          throw err;
        } finally {
          // For sync execution, clean up askpass immediately.
          // For background, it's cleaned up on process exit (see below).
          if (askpassPath && !(wantBackground || yieldMs)) {
            await rm(askpassPath, { force: true }).catch(() => {});
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /exec/sessions — list all sessions
      // -----------------------------------------------------------------------
      if (pathname === "/exec/sessions" && nodeReq.method === "GET") {
        const { listAllSessions } = await import("./exec-registry.js");
        const all = listAllSessions();
        const sessions = all.map((entry) => {
          if (entry.type === "running") {
            const s = entry.session;
            return {
              id: s.id,
              status: "running" as const,
              command: s.command,
              args: s.args,
              cwd: s.cwd,
              pid: s.pid,
              startedAt: s.startedAt,
              runtimeMs: Date.now() - s.startedAt,
              tail: s.tail,
              truncated: s.truncated,
            };
          } else {
            const s = entry.session;
            return {
              id: s.id,
              status: s.status,
              command: s.command,
              args: s.args,
              cwd: s.cwd,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              runtimeMs: s.endedAt - s.startedAt,
              exitCode: s.exitCode,
              tail: s.tail,
              truncated: s.truncated,
              timedOut: s.timedOut,
              filesChanged: s.filesChanged,
            };
          }
        });
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ sessions }));
        log(`${ts()} GET /exec/sessions → ${sessions.length} sessions`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /exec/sessions/:id/poll — drain pending output
      // -----------------------------------------------------------------------
      const pollMatch = pathname.match(/^\/exec\/sessions\/([^/]+)\/poll$/);
      if (pollMatch && nodeReq.method === "GET") {
        const sessionId = decodeURIComponent(pollMatch[1]!);
        const { getSession, getFinishedSession, drainSession } = await import("./exec-registry.js");
        const url = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
        const timeoutParam = parseInt(url.searchParams.get("timeout") ?? "0", 10);
        const pollTimeout = Math.max(0, Math.min(timeoutParam, 120_000));

        const running = getSession(sessionId);
        if (running) {
          if (pollTimeout > 0 && !running.exited) {
            // Long-poll: wait for exit or timeout
            await new Promise<void>((resolvePoll) => {
              const timer = setTimeout(resolvePoll, pollTimeout);
              timer.unref?.();
              if (running.child) {
                running.child.on("close", () => {
                  clearTimeout(timer);
                  // Small delay to let markExited process
                  setTimeout(resolvePoll, 50);
                });
              }
            });
          }
          const drained = drainSession(running);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            stdout: drained.stdout,
            stderr: drained.stderr,
            exited: running.exited,
            exitCode: running.exitCode,
            exitSignal: running.exitSignal,
            timedOut: running.timedOut,
            filesChanged: running.exited ? running.filesChanged : null,
          }));
          return;
        }

        const finished = getFinishedSession(sessionId);
        if (finished) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            stdout: "",
            stderr: "",
            exited: true,
            exitCode: finished.exitCode,
            exitSignal: finished.exitSignal,
            timedOut: finished.timedOut,
            filesChanged: finished.filesChanged,
          }));
          return;
        }

        nodeRes.writeHead(404, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        return;
      }

      // -----------------------------------------------------------------------
      // GET /exec/sessions/:id/log — full aggregated output
      // -----------------------------------------------------------------------
      const logMatch = pathname.match(/^\/exec\/sessions\/([^/]+)\/log$/);
      if (logMatch && nodeReq.method === "GET") {
        const sessionId = decodeURIComponent(logMatch[1]!);
        const { getSession, getFinishedSession } = await import("./exec-registry.js");

        const running = getSession(sessionId);
        if (running) {
          const lines = running.aggregated.split("\n");
          const url = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));
          const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)), 1000);
          const sliced = lines.slice(offset, offset + limit);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            log: sliced.join("\n"),
            totalLines: lines.length,
            totalChars: running.aggregated.length,
            truncated: running.truncated,
            exited: running.exited,
            exitCode: running.exitCode,
          }));
          return;
        }

        const finished = getFinishedSession(sessionId);
        if (finished) {
          const lines = finished.aggregated.split("\n");
          const url = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));
          const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)), 1000);
          const sliced = lines.slice(offset, offset + limit);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            log: sliced.join("\n"),
            totalLines: lines.length,
            totalChars: finished.aggregated.length,
            truncated: finished.truncated,
            exited: true,
            exitCode: finished.exitCode,
          }));
          return;
        }

        nodeRes.writeHead(404, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        return;
      }

      // -----------------------------------------------------------------------
      // POST /exec/sessions/:id/write — write to stdin
      // -----------------------------------------------------------------------
      const writeMatch = pathname.match(/^\/exec\/sessions\/([^/]+)\/write$/);
      if (writeMatch && nodeReq.method === "POST") {
        const sessionId = decodeURIComponent(writeMatch[1]!);
        const { getSession } = await import("./exec-registry.js");
        const session = getSession(sessionId);

        if (!session) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Session not found or already finished: ${sessionId}` }));
          return;
        }
        if (!session.stdin) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Session does not have stdin available (stdinMode was 'ignore')" }));
          return;
        }
        if (session.exited) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Session has already exited" }));
          return;
        }

        const body = await collectBody(nodeReq);
        let writeParams: { data?: string; eof?: boolean };
        try {
          writeParams = JSON.parse(body);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const data = writeParams.data ?? "";
        if (data) {
          session.stdin.write(data);
        }
        if (writeParams.eof) {
          session.stdin.end();
        }

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, bytes: Buffer.byteLength(data) }));
        return;
      }

      // -----------------------------------------------------------------------
      // POST /exec/sessions/:id/kill — kill a running session
      // -----------------------------------------------------------------------
      const killMatch = pathname.match(/^\/exec\/sessions\/([^/]+)\/kill$/);
      if (killMatch && nodeReq.method === "POST") {
        const sessionId = decodeURIComponent(killMatch[1]!);
        const { getSession, getFinishedSession, killSession } = await import("./exec-registry.js");

        const session = getSession(sessionId);
        if (session) {
          killSession(session);
          // Wait briefly for the process to exit and diffs to be captured
          await new Promise<void>((r) => setTimeout(r, 200));
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            exited: session.exited,
            exitCode: session.exitCode,
            filesChanged: session.filesChanged,
          }));
          log(`${ts()} POST /exec/sessions/${sessionId}/kill → killed`);
          return;
        }

        const finished = getFinishedSession(sessionId);
        if (finished) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            exited: true,
            exitCode: finished.exitCode,
            filesChanged: finished.filesChanged,
          }));
          return;
        }

        nodeRes.writeHead(404, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /exec/sessions/:id — remove a session (kill + cleanup)
      // -----------------------------------------------------------------------
      const deleteSessionMatch = pathname.match(/^\/exec\/sessions\/([^/]+)$/);
      if (deleteSessionMatch && nodeReq.method === "DELETE") {
        const sessionId = decodeURIComponent(deleteSessionMatch[1]!);
        const { deleteSession } = await import("./exec-registry.js");
        const deleted = deleteSession(sessionId);

        if (deleted) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} DELETE /exec/sessions/${sessionId} → removed`);
        } else {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Session not found: ${sessionId}` }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /artifacts — list artifacts in the editable collection
      // -----------------------------------------------------------------------
      if (pathname === "/artifacts" && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        const url = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
        const prefix = url.searchParams.get("prefix") || "";
        const normalizedPrefix = normalizeEditableArtifactPrefix(prefix);
        const legacyPrefix = normalizedPrefix ? `editable/${normalizedPrefix}` : "";
        const legacyUnderscorePrefix = normalizedPrefix ? `_editable/${normalizedPrefix}` : "";
        const rows = store.db.prepare(`
          SELECT d.path, d.title, d.modified_at, c.doc
          FROM documents d
          JOIN content c ON c.hash = d.hash
          WHERE d.collection = ? AND d.active = 1
            AND (
              ? = '' OR
              d.path LIKE ? || '%' OR
              d.path LIKE ? || '%' OR
              d.path LIKE ? || '%'
            )
          ORDER BY d.modified_at DESC
        `).all(
          EDITABLE_COLLECTION,
          normalizedPrefix,
          normalizedPrefix,
          legacyPrefix,
          legacyUnderscorePrefix,
        ) as Array<{
          path: string; title: string; modified_at: string; doc: string;
        }>;

        const persistedItems = rows.map((row) => {
          const blob = decodeBrowserUploadBlobEnvelope(row.doc);
          return {
            path: stripEditableArtifactPrefix(row.path),
            title: stripEditableArtifactPrefix(row.title || row.path),
            modifiedAt: row.modified_at,
            size: blob ? blob.byteLength : Buffer.byteLength(row.doc, "utf-8"),
            mimeType: blob?.mimeType ?? "text/plain",
            isBinary: !!blob,
          };
        });

        const queuedItems = Array.from(_pendingEditableArtifactWrites.values())
          .map((entry) => {
            const blob = decodeBrowserUploadBlobEnvelope(entry.content);
            const normalizedPath = stripEditableArtifactPrefix(entry.path);
            return {
              path: normalizedPath,
              title: normalizedPath,
              modifiedAt: new Date(entry.enqueuedAt).toISOString(),
              size: blob ? blob.byteLength : Buffer.byteLength(entry.content, "utf-8"),
              mimeType: blob?.mimeType ?? "text/plain",
              isBinary: !!blob,
            };
          })
          .filter((item) => !normalizedPrefix || item.path.startsWith(normalizedPrefix));

        const dedupedItems = new Map<string, {
          path: string;
          title: string;
          modifiedAt: string;
          size: number;
          mimeType: string;
          isBinary: boolean;
        }>();
        for (const item of [...persistedItems, ...queuedItems]) {
          const existing = dedupedItems.get(item.path);
          if (!existing || Date.parse(item.modifiedAt) >= Date.parse(existing.modifiedAt)) {
            dedupedItems.set(item.path, item);
          }
        }

        const items = Array.from(dedupedItems.values()).sort(
          (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt),
        );

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ items }));
        log(`${ts()} GET /artifacts prefix=${normalizedPrefix || "(all)"} → ${items.length} items (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /artifacts/download — serve raw artifact bytes
      // -----------------------------------------------------------------------
      if (pathname === "/artifacts/download" && nodeReq.method === "GET") {
        const url = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
        const collection = canonicalizeLegacySystemCollectionName(url.searchParams.get("collection") || EDITABLE_COLLECTION);
        const filePath = url.searchParams.get("path") || "";
        const token = url.searchParams.get("token") || "";

        if (!filePath) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "path parameter is required" }));
          return;
        }

        if (!isExternallyVisibleCollection(collection)) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Artifact not found: ${collection}/${filePath}` }));
          return;
        }

        if (!token) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "token parameter is required" }));
          return;
        }

        const ticket = artifactTickets.resolve({ collection, path: filePath, token });
        if (!ticket.ok) {
          nodeRes.writeHead(ticket.status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: ticket.error }));
          return;
        }

        const artifact = getExternallyVisibleArtifactDocument(store, collection, filePath);
        if (!artifact) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Artifact not found: ${collection}/${filePath}` }));
          return;
        }

        let bytes: Buffer;
        let mimeType = "application/octet-stream";
        let originalName: string | undefined;

        const blob = decodeBrowserUploadBlobEnvelope(artifact.doc.content);
        if (blob) {
          bytes = blob.bytes;
          if (blob.mimeType) mimeType = blob.mimeType;
          originalName = blob.originalName;
        } else {
          bytes = Buffer.from(artifact.doc.content, "utf8");
          mimeType = "text/plain; charset=utf-8";
        }

        const resolvedPath = artifact.path;
        const fileName = originalName || resolvedPath.split("/").pop() || "download";
        // RFC 5987: use ASCII fallback + UTF-8 encoded filename for non-ASCII chars
        const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
        const utf8Name = encodeURIComponent(fileName).replace(/'/g, "%27");
        const contentDisposition = asciiName === fileName
          ? `attachment; filename="${fileName}"`
          : `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;
        nodeRes.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": contentDisposition,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        nodeRes.end(bytes);
        log(`${ts()} GET /artifacts/download path=${resolvedPath} → ${bytes.byteLength} bytes (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /artifacts/build — trigger PPTX build from spec
      // -----------------------------------------------------------------------
      if (pathname === "/artifacts/build" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { name?: string };
        try {
          params = JSON.parse(rawBody);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.name || typeof params.name !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: name (string)" }));
          return;
        }

        const name = params.name;
        const specPath = `presentations/${name}/spec.json`;
        const specDoc = getEditableArtifactDocument(store, specPath);
        if (!specDoc) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Spec not found: ${EDITABLE_COLLECTION}/${specPath}` }));
          return;
        }

        let specData: unknown;
        try {
          specData = JSON.parse(specDoc.doc.content);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid JSON in spec: ${specPath}` }));
          return;
        }

        const parseResult = PresentationSpecSchema.safeParse(specData);
        if (!parseResult.success) {
          const issues = parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid presentation spec: ${issues}` }));
          return;
        }

        const imageIssues = await resolvePresentationImages(store, parseResult.data);
        if (imageIssues.length > 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Presentation image resolution failed: ${imageIssues.join("; ")}` }));
          return;
        }

        try {
          const pptxBuffer = await buildPptxBuffer(parseResult.data);
          const outputPath = `presentations/${name}/build/${name}.pptx`;
          const { size } = await writeArtifact(store, outputPath, pptxBuffer, {
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            originalName: `${name}.pptx`,
          });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            pptxPath: outputPath,
            size,
            slides: parseResult.data.slides.length,
          }));
          log(`${ts()} POST /artifacts/build name=${name} → ${size} bytes (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Build failed: ${err?.message}` }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // POST /reports/build — trigger PDF report build from spec
      // -----------------------------------------------------------------------
      if (pathname === "/reports/build" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { name?: string };
        try {
          params = JSON.parse(rawBody);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.name || typeof params.name !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: name (string)" }));
          return;
        }

        const name = params.name;
        const specPath = `reports/${name}/spec.json`;
        const specDoc = getEditableArtifactDocument(store, specPath);
        if (!specDoc) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Spec not found: ${EDITABLE_COLLECTION}/${specPath}` }));
          return;
        }

        let specData: unknown;
        try {
          specData = JSON.parse(specDoc.doc.content);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid JSON in spec: ${specPath}` }));
          return;
        }

        const parseResult = ReportSpecSchema.safeParse(specData);
        if (!parseResult.success) {
          const issues = parseResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid report spec: ${issues}` }));
          return;
        }

        const imageIssues = await resolveReportImages(store, parseResult.data);
        if (imageIssues.length > 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Report image resolution failed: ${imageIssues.join("; ")}` }));
          return;
        }

        try {
          const pdfBuffer = await buildReportPdfBuffer(parseResult.data);
          const outputPath = `reports/${name}/build/${name}.pdf`;
          const { size } = await writeArtifact(store, outputPath, pdfBuffer, {
            mimeType: "application/pdf",
            originalName: `${name}.pdf`,
          });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            pdfPath: outputPath,
            size,
            sections: parseResult.data.sections.length,
          }));
          log(`${ts()} POST /reports/build name=${name} → ${size} bytes (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Report build failed: ${err?.message}` }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // POST /artifacts/url — get a time-limited download URL for an artifact
      // -----------------------------------------------------------------------
      if (pathname === "/artifacts/url" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { collection?: string; path?: string };
        try {
          params = JSON.parse(rawBody);
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.path || typeof params.path !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Missing required field: path (string)" }));
          return;
        }

        const collection =
          typeof params.collection === "string" && params.collection.trim()
            ? canonicalizeLegacySystemCollectionName(params.collection.trim())
            : EDITABLE_COLLECTION;
        if (!isExternallyVisibleCollection(collection)) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Artifact not found: ${collection}/${params.path}` }));
          return;
        }

        const artifact = getExternallyVisibleArtifactDocument(store, collection, params.path);
        if (!artifact) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Artifact not found: ${collection}/${params.path}` }));
          return;
        }

        const actualPort = (httpServer.address() as import("net").AddressInfo)?.port ?? port;
        const { token, expiresAtMs } = artifactTickets.issue({ collection: artifact.collection, path: artifact.path });
        const downloadUrl =
          `http://127.0.0.1:${actualPort}/artifacts/download` +
          `?collection=${encodeURIComponent(artifact.collection)}` +
          `&path=${encodeURIComponent(artifact.path)}` +
          `&token=${encodeURIComponent(token)}`;

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ url: downloadUrl, expiresAtMs }));
        log(`${ts()} POST /artifacts/url collection=${artifact.collection} path=${artifact.path} (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /embed — start embedding pass (async, returns immediately)
      // -----------------------------------------------------------------------
      if (pathname === "/embed" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        let params: { force?: boolean };
        try { params = JSON.parse(rawBody || "{}"); } catch { params = {}; }

        // If an embed is already running, return 409 Conflict
        if (isAutoEmbedActive()) {
          nodeRes.writeHead(409, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Embedding already in progress" }));
          return;
        }

        startBackgroundEmbed({ force: params.force, immediate: true, trigger: "/embed" });
        nodeRes.writeHead(202, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, started: true }));
        log(`${ts()} POST /embed → started async`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /media — store ephemeral binary media (e.g., Telegram photos)
      // -----------------------------------------------------------------------
      if (pathname === "/media" && nodeReq.method === "POST") {
        const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
        const MEDIA_COLLECTION = "_media";
        const MEDIA_TTL_MS = 5 * 60 * 1000; // 5 minutes

        // TTL cleanup: remove expired _media documents before storing new one.
        try {
          const cutoff = new Date(Date.now() - MEDIA_TTL_MS).toISOString();
          const expired = store.db
            .prepare(
              `SELECT id, path, hash FROM documents WHERE collection = ? AND active = 1 AND modified_at < ?`,
            )
            .all(MEDIA_COLLECTION, cutoff) as Array<{ id: number; path: string; hash: string }>;
          for (const row of expired) {
            store.deactivateDocument(MEDIA_COLLECTION, row.path);
          }
        } catch {
          // Best-effort cleanup; don't fail the upload.
        }

        try {
          const bytes = await collectBodyBytes(nodeReq, MEDIA_MAX_BYTES);
          if (bytes.byteLength === 0) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Empty body" }));
            return;
          }
          const contentType =
            normalizeMimeType(getHeaderValue(nodeReq, "content-type")) ??
            "application/octet-stream";
          const originalName = getHeaderValue(nodeReq, "x-original-name") ?? undefined;
          const id = randomUUID();
          const ext = contentType.startsWith("image/jpeg")
            ? ".jpg"
            : contentType.startsWith("image/png")
              ? ".png"
              : contentType.startsWith("image/webp")
                ? ".webp"
                : contentType.startsWith("image/gif")
                  ? ".gif"
                  : "";
          const docPath = `${id}${ext}`;

          const storeContent = encodeBrowserUploadBlobEnvelope(bytes, {
            mimeType: contentType,
            originalName,
          });
          const now = new Date().toISOString();
          const hash = await hashContent(storeContent);
          store.insertContent(hash, storeContent, now);
          store.insertDocument(MEDIA_COLLECTION, docPath, originalName ?? docPath, hash, now, now);

          const serverOrigin = `http://${nodeReq.headers.host ?? "127.0.0.1:8181"}`;
          const url = `${serverOrigin}/media/${docPath}`;

          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(
            JSON.stringify({ id, url, contentType, size: bytes.byteLength, path: docPath }),
          );
          log(`${ts()} POST /media → ${docPath} (${bytes.byteLength}b, ${contentType}) (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message ?? "Failed to store media" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /media/:id — retrieve ephemeral binary media
      // -----------------------------------------------------------------------
      const mediaGetMatch = pathname.match(/^\/media\/(.+)$/);
      if (mediaGetMatch && nodeReq.method === "GET") {
        const docPath = decodeURIComponent(mediaGetMatch[1]!);
        const MEDIA_COLLECTION = "_media";
        const doc = store.getDocumentWithContent(MEDIA_COLLECTION, docPath);
        if (!doc) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        try {
          const blob = decodeBrowserUploadBlobEnvelope(doc.content);
          if (blob) {
            nodeRes.writeHead(200, {
              "Content-Type": blob.mimeType || "application/octet-stream",
              "Content-Length": String(blob.byteLength),
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
            });
            nodeRes.end(blob.bytes);
            log(`${ts()} GET /media/${docPath} → ${blob.byteLength}b (${Date.now() - reqStart}ms)`);
            return;
          }
        } catch {
          // Fall through to 404.
        }
        nodeRes.writeHead(404, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /media/:id — explicitly remove ephemeral media
      // -----------------------------------------------------------------------
      const mediaDeleteMatch = pathname.match(/^\/media\/(.+)$/);
      if (mediaDeleteMatch && nodeReq.method === "DELETE") {
        const docPath = decodeURIComponent(mediaDeleteMatch[1]!);
        const MEDIA_COLLECTION = "_media";
        const existing = store.findActiveDocument(MEDIA_COLLECTION, docPath);
        if (!existing) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        store.deactivateDocument(MEDIA_COLLECTION, docPath);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} DELETE /media/${docPath} (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // POST /raw/:collection/:path/append — append a line to a raw document
      // -----------------------------------------------------------------------
      const rawAppendMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)\/append$/);
      if (rawAppendMatch && nodeReq.method === "POST") {
        const rawCollName = decodeURIComponent(rawAppendMatch[1]!);
        const collName = canonicalizeLegacySystemCollectionName(rawCollName);
        const docPath = decodeURIComponent(rawAppendMatch[2]!);
        if (isWriteProtectedCollection(collName)) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Writes are not allowed to collection: ${collName}` }));
          return;
        }
        const newLine = await collectBody(nodeReq, MAX_HTTP_RAW_BODY_BYTES);

        try {
          const now = new Date().toISOString();

          const existing = store.getDocumentWithContent(collName, docPath);
          const existingContent = existing?.content ?? "";
          const updated = existingContent
            ? existingContent + (existingContent.endsWith("\n") ? "" : "\n") + newLine + "\n"
            : newLine + "\n";

          const hash = await hashContent(updated);
          store.insertContent(hash, updated, now);

          if (existing) {
            // updateDocument handles both real SQLite ids (> 0) and
            // synthetic queue ids (<= 0) via the syntheticIdContext map.
            store.updateDocument(existing.id, existing.title, hash, now);
          } else {
            store.insertDocument(collName, docPath, docPath, hash, now, now, "api");
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, hash }));
          log(`${ts()} POST /raw/${rawCollName}/${docPath}/append → ${collName} (+${newLine.length}b) (${Date.now() - reqStart}ms)`);

          // Audit: memory append via raw endpoint
          if (collName === "_memory") {
            appendAuditEntry(store, "memory", {
              timestamp: now,
              toolName: "raw_append",
              action: "append",
              path: docPath,
              verdict: "allowed",
              reason: `Appended to _memory/${docPath}`,
              contentLength: newLine.length,
              severity: "low",
            }).catch(() => {});
          }

          // Auto-embed only for collections that participate in vector indexing.
          if (!isEmbeddingExcludedCollection(collName)) {
            startBackgroundEmbed({ trigger: `raw-append:${collName}` });
          }
        } catch (dbErr) {
          throw dbErr;
        }
        return;
      }

      // -----------------------------------------------------------------------
      // PUT /raw/:collection/:path — upsert a raw document
      // -----------------------------------------------------------------------
      const rawPutMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
      if (rawPutMatch && nodeReq.method === "PUT") {
        const rawCollName = decodeURIComponent(rawPutMatch[1]!);
        const collName = canonicalizeLegacySystemCollectionName(rawCollName);
        const docPath = decodeURIComponent(rawPutMatch[2]!);
        if (isWriteProtectedCollection(collName)) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Writes are not allowed to collection: ${collName}` }));
          return;
        }
        const now = new Date().toISOString();
        const isBinary = shouldTreatRawBodyAsBinary(nodeReq);
        let storeContent: string;
        let byteLength: number;

        if (isBinary) {
          const bytes = await collectBodyBytes(nodeReq, MAX_HTTP_RAW_BODY_BYTES);
          const explicitMime = normalizeMimeType(getHeaderValue(nodeReq, "x-mime-type"));
          const contentType = normalizeMimeType(getHeaderValue(nodeReq, "content-type"));
          const mimeType =
            explicitMime ??
            (contentType && contentType !== "application/octet-stream" ? contentType : undefined);

          storeContent = encodeBrowserUploadBlobEnvelope(bytes, {
            mimeType: mimeType ?? "application/octet-stream",
            originalName: basename(docPath),
          });
          byteLength = bytes.byteLength;
        } else {
          storeContent = await collectBody(nodeReq, MAX_HTTP_RAW_BODY_BYTES);
          byteLength = Buffer.byteLength(storeContent, "utf-8");
        }

        try {
          const hash = await hashContent(storeContent);
          store.insertContent(hash, storeContent, now);

          const existing = store.findActiveDocument(collName, docPath);
          if (existing) {
            store.updateDocument(existing.id, existing.title, hash, now);
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
          } else {
            store.insertDocument(collName, docPath, docPath, hash, now, now, "api");
            nodeRes.writeHead(201, { "Content-Type": "application/json" });
          }
          nodeRes.end(JSON.stringify({ ok: true, hash }));
          log(`${ts()} PUT /raw/${rawCollName}/${docPath} → ${collName} (${byteLength}b${isBinary ? ", binary" : ""}) (${Date.now() - reqStart}ms)`);

          // Audit: memory write via raw endpoint
          if (collName === "_memory") {
            appendAuditEntry(store, "memory", {
              timestamp: now,
              toolName: "raw_put",
              action: existing ? "update" : "write",
              path: docPath,
              verdict: "allowed",
              reason: `${existing ? "Updated" : "Wrote"} _memory/${docPath}`,
              contentLength: byteLength,
              severity: "low",
            }).catch(() => {});
          }

          // Auto-embed only for collections that participate in vector indexing.
          if (!isEmbeddingExcludedCollection(collName)) {
            startBackgroundEmbed({ trigger: `raw-put:${collName}` });
          }
        } catch (dbErr) {
          throw dbErr;
        }
        return;
      }

      // -----------------------------------------------------------------------
      // DELETE /raw/:collection/:path — deactivate (soft-delete) a raw document
      // -----------------------------------------------------------------------
      const rawDeleteMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
      if (rawDeleteMatch && nodeReq.method === "DELETE") {
        const rawCollName = decodeURIComponent(rawDeleteMatch[1]!);
        const collName = canonicalizeLegacySystemCollectionName(rawCollName);
        const docPath = decodeURIComponent(rawDeleteMatch[2]!);
        if (isWriteProtectedCollection(collName)) {
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Writes are not allowed to collection: ${collName}` }));
          return;
        }
        const existing = store.findActiveDocument(collName, docPath);
        if (!existing) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        store.deactivateDocument(collName, docPath);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} DELETE /raw/${rawCollName}/${docPath} → ${collName} (${Date.now() - reqStart}ms)`);

        // Audit: memory delete via raw endpoint
        if (collName === "_memory") {
          appendAuditEntry(store, "memory", {
            timestamp: new Date().toISOString(),
            toolName: "raw_delete",
            action: "delete",
            path: docPath,
            verdict: "allowed",
            reason: `Deleted _memory/${docPath}`,
            severity: "medium",
          }).catch(() => {});
        }
        return;
      }

      // -----------------------------------------------------------------------
      // GET /raw/_write_queue — return queue state as JSON (virtual, in-memory only)
      // -----------------------------------------------------------------------
      if (pathname === "/raw/_write_queue" && (nodeReq.method === "GET" || nodeReq.method === "HEAD")) {
        const entries = writeQueue.map(e => ({
          id: e.id,
          op: e.op,
          collection: e.collection,
          path: e.path,
          title: e.title,
          hash: e.hash,
          enqueuedAt: e.enqueuedAt,
          status: e.status,
          attempts: e.attempts,
          error: e.error,
          contentLength: e.content.length,
        }));
        const body = JSON.stringify({ entries, count: writeQueue.length });
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(nodeReq.method === "HEAD" ? undefined : body);
        log(`${ts()} GET /raw/_write_queue → ${entries.length} entries (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GET /raw/:collection/:path — get raw document content
      // -----------------------------------------------------------------------
      const rawGetMatch = pathname.match(/^\/raw\/([^/]+)\/(.+)$/);
      if (rawGetMatch && (nodeReq.method === "GET" || nodeReq.method === "HEAD")) {
        const rawCollName = decodeURIComponent(rawGetMatch[1]!);
        const collName = canonicalizeLegacySystemCollectionName(rawCollName);
        if (isHiddenCollection(collName)) {
          nodeRes.writeHead(404, { "Content-Type": "text/plain" });
          nodeRes.end("");
          return;
        }
        const docPath = decodeURIComponent(rawGetMatch[2]!);

        const doc = store.getDocumentWithContent(collName, docPath);

        if (!doc) {
          nodeRes.writeHead(404, { "Content-Type": "text/plain" });
          nodeRes.end("");
          return;
        }

        const effectiveContent = doc.content ?? "";

        try {
          const blob = decodeBrowserUploadBlobEnvelope(effectiveContent);
          if (blob) {
            nodeRes.writeHead(200, {
              "Content-Type": blob.mimeType || "application/octet-stream",
              "Content-Length": String(blob.byteLength),
              "X-Content-Type-Options": "nosniff",
            });
            nodeRes.end(nodeReq.method === "HEAD" ? undefined : blob.bytes);
            log(`${ts()} ${nodeReq.method} /raw/${rawCollName}/${docPath} → ${collName} ${blob.byteLength}b binary (${Date.now() - reqStart}ms)`);
            return;
          }
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to load raw document" }));
          return;
        }

        nodeRes.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        nodeRes.end(nodeReq.method === "HEAD" ? undefined : effectiveContent);
        log(`${ts()} ${nodeReq.method} /raw/${rawCollName}/${docPath} → ${collName} ${effectiveContent.length}b (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // Gmail connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/gmail/status" && nodeReq.method === "GET") {
        if (!hasClientCredentials()) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "missing_credentials" }));
          log(`${ts()} GET /connections/gmail/status → missing_credentials (${Date.now() - reqStart}ms)`);
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gmail.json");
        if (!doc?.content) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
          log(`${ts()} GET /connections/gmail/status → not_connected (${Date.now() - reqStart}ms)`);
          return;
        }

        try {
          const config = JSON.parse(doc.content) as GmailConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ status: "not_connected" }));
            return;
          }

          // Count documents in gmail collection
          const docCount = (store.db.prepare(
            `SELECT COUNT(*) as c FROM documents WHERE collection = '_gmail' AND active = 1`
          ).get() as { c: number }).c;

          const statusPayload = {
            status: config.authErrorCode ? "auth_error" : "connected",
            email: config.email,
            labels: config.labels || [],
            includeThreads: config.includeThreads ?? false,
            lastSync: config.lastSync ?? (config.lastSyncHistoryId
              ? (store.db.prepare(`SELECT modified_at FROM documents WHERE id = ?`).get(doc.id) as { modified_at: string } | undefined)?.modified_at
              : undefined),
            documentCount: docCount,
            pollEnabled: config.authErrorCode ? false : (config.pollEnabled ?? false),
            pollIntervalMinutes: config.pollIntervalMinutes ?? 5,
            polling: config.authErrorCode ? false : !!gmailPollTimer,
            syncMode: config.syncMode ?? "labels",
            syncDaysBack: config.syncDaysBack ?? 30,
            needsScopeUpgrade: !(config.scopes?.includes("gmail.compose")),
            authErrorMessage: config.authErrorMessage,
            authErrorAt: config.authErrorAt,
          };

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(statusPayload));
          log(`${ts()} GET /connections/gmail/status → ${statusPayload.status} (${Date.now() - reqStart}ms)`);
        } catch {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
        }
        return;
      }

      if (pathname === "/connections/gmail/authorize" && nodeReq.method === "POST") {
        if (!hasClientCredentials()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google OAuth client is not configured in Vault." }));
          return;
        }

        const redirectUri = `http://localhost:${port}/connections/gmail/callback`;
        const authUrl = generateAuthUrl(redirectUri);

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl }));
        log(`${ts()} POST /connections/gmail/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/gmail/callback") && nodeReq.method === "GET") {
        const callbackUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
        const code = callbackUrl.searchParams.get("code");

        if (!code) {
          nodeRes.writeHead(400, { "Content-Type": "text/html" });
          nodeRes.end("<h1>Error: No authorization code received</h1>");
          return;
        }

        try {
          const redirectUri = `http://localhost:${port}/connections/gmail/callback`;
          const { refreshToken, accessToken, email } = await exchangeCode(code, redirectUri);

          // Load existing config or create new
          const existingDoc = store.getDocumentWithContent("_config", "gmail.json");
          const existingConfig: Partial<GmailConfig> = existingDoc?.content
            ? JSON.parse(existingDoc.content)
            : {};

          const config: GmailConfig = {
            ...existingConfig,
            refreshToken,
            accessToken,
            accessTokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
            email,
            labels: existingConfig.labels || [],
            includeThreads: existingConfig.includeThreads ?? false,
            scopes: ["gmail.readonly", "gmail.compose"],
          };
          clearGmailAuthError(config);

          // Save to _config/gmail.json
          const now = new Date().toISOString();
          await saveGmailConfig(config, now);
          if (config.pollEnabled && config.pollIntervalMinutes) {
            startGmailPolling(config.pollIntervalMinutes);
          }

          // Redirect to web UI
          nodeRes.writeHead(302, { Location: resolveWebUiRedirectLocation("/connections?gmail=connected") });
          nodeRes.end();
          log(`${ts()} GET /connections/gmail/callback → connected as ${email} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "text/html" });
          nodeRes.end(`<h1>OAuth Error</h1><p>${err?.message || "Unknown error"}</p>`);
          log(`${ts()} GET /connections/gmail/callback → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gmail/sync" && nodeReq.method === "POST") {
        const doc = store.getDocumentWithContent("_config", "gmail.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
          return;
        }

        let config: GmailConfig | null = null;
        try {
          config = JSON.parse(doc.content) as GmailConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
            return;
          }
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            return;
          }

          const result = await runGmailSync({
            config,
            documentExists: (collection, path) => {
              return !!store.findActiveDocument(collection, path);
            },
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
              } else {
                store.insertContent(hash, content, now);
                store.insertDocument(collection, path, title, hash, now, now);
              }
            },
          });

          // Update lastSync timestamp
          clearGmailAuthError(config);
          config.lastSync = new Date().toISOString();
          const now = new Date().toISOString();
          await saveGmailConfig(config, now);

          handleImportedItemsNotification("gmail", {
            imported: result.imported,
            total: result.total,
            items: result.importedItems,
          }, "gmail manual sync");

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gmail/sync → imported=${result.imported} skipped=${result.skipped} total=${result.total} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_sync",
            action: "sync",
            verdict: "allowed",
            reason: `Synced: imported=${result.imported} skipped=${result.skipped} total=${result.total}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { imported: result.imported, skipped: result.skipped, total: result.total },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isGmailInvalidGrantError(err)) {
            await markGmailAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            log(`${ts()} POST /connections/gmail/sync → auth_error invalid_grant`);
            appendAuditEntry(store, "gmail", {
              timestamp: new Date().toISOString(),
              toolName: "gmail_sync",
              action: "sync",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Sync failed" }));
          log(`${ts()} POST /connections/gmail/sync → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_sync",
            action: "sync",
            verdict: "error",
            reason: err?.message || "Sync failed",
            severity: "high",
          }).catch(() => {});
        }
        return;
      }

      if (pathname === "/connections/gmail/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { labels?: string[]; includeThreads?: boolean; pollEnabled?: boolean; pollIntervalMinutes?: number; syncMode?: "labels" | "all"; syncDaysBack?: number };
        try { params = JSON.parse(body); } catch { params = {}; }

        const doc = store.getDocumentWithContent("_config", "gmail.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
          return;
        }

        try {
          const config = JSON.parse(doc.content) as GmailConfig;
          if (params.labels !== undefined) config.labels = params.labels;
          if (params.includeThreads !== undefined) config.includeThreads = params.includeThreads;
          if (params.pollEnabled !== undefined) config.pollEnabled = params.pollEnabled;
          if (params.pollIntervalMinutes !== undefined && [1, 5, 10, 15].includes(params.pollIntervalMinutes)) {
            config.pollIntervalMinutes = params.pollIntervalMinutes;
          }
          if (params.syncMode !== undefined && (params.syncMode === "labels" || params.syncMode === "all")) {
            config.syncMode = params.syncMode;
          }
          if (params.syncDaysBack !== undefined && [30, 60, 90].includes(params.syncDaysBack)) {
            config.syncDaysBack = params.syncDaysBack as 30 | 60 | 90;
          }

          const now = new Date().toISOString();
          await saveGmailConfig(config, now);

          // Restart or stop polling based on new config
          if (config.pollEnabled && config.pollIntervalMinutes && !config.authErrorCode) {
            startGmailPolling(config.pollIntervalMinutes);
          } else {
            stopGmailPolling();
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/gmail/config → updated (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/gmail/disconnect" && nodeReq.method === "POST") {
        stopGmailPolling();
        const existing = store.findActiveDocument("_config", "gmail.json");
        if (existing) {
          store.db.prepare(`UPDATE documents SET active = 0 WHERE id = ?`).run(existing.id);
        }

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /connections/gmail/disconnect → done (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/connections/gmail/drafts" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: DraftRequest;
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.to || !params.subject || !params.body) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "to, subject, and body are required" }));
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gmail.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
          return;
        }

        let config: GmailConfig | null = null;
        try {
          config = JSON.parse(doc.content) as GmailConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
            return;
          }
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            return;
          }

          if (!config.scopes?.includes("gmail.compose")) {
            nodeRes.writeHead(403, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Gmail compose scope not granted. Please reconnect Gmail to enable draft creation." }));
            return;
          }

          const result = await createDraft(config, params);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gmail/drafts → draft ${result.id} created (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_drafts",
            action: "create_draft",
            verdict: "allowed",
            reason: `Draft created: ${params.subject}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { draftId: result.id, to: params.to, subject: params.subject },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isGmailInvalidGrantError(err)) {
            await markGmailAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            log(`${ts()} POST /connections/gmail/drafts → auth_error invalid_grant`);
            appendAuditEntry(store, "gmail", {
              timestamp: new Date().toISOString(),
              toolName: "gmail_drafts",
              action: "create_draft",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
              details: { to: params.to, subject: params.subject },
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to create draft" }));
          log(`${ts()} POST /connections/gmail/drafts → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_drafts",
            action: "create_draft",
            verdict: "error",
            reason: err?.message || "Failed to create draft",
            severity: "high",
            details: { to: params.to, subject: params.subject },
          }).catch(() => {});
        }
        return;
      }

      if (pathname.startsWith("/connections/gmail/drafts/") && nodeReq.method === "PUT") {
        const draftId = pathname.split("/connections/gmail/drafts/")[1];
        if (!draftId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Draft ID is required in URL path" }));
          return;
        }

        const body = await collectBody(nodeReq);
        let params: DraftRequest;
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.to || !params.subject || !params.body) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "to, subject, and body are required" }));
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gmail.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
          return;
        }

        let config: GmailConfig | null = null;
        try {
          config = JSON.parse(doc.content) as GmailConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Gmail not connected" }));
            return;
          }
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            return;
          }

          if (!config.scopes?.includes("gmail.compose")) {
            nodeRes.writeHead(403, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Gmail compose scope not granted. Please reconnect Gmail to enable draft operations." }));
            return;
          }

          const result = await updateDraft(config, decodeURIComponent(draftId), params);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} PUT /connections/gmail/drafts/${draftId} → draft updated (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_drafts",
            action: "update_draft",
            verdict: "allowed",
            reason: `Draft updated: ${params.subject}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { draftId, to: params.to, subject: params.subject },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isGmailInvalidGrantError(err)) {
            await markGmailAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Gmail authorization expired or was revoked. Reconnect Gmail." }));
            log(`${ts()} PUT /connections/gmail/drafts/${draftId} → auth_error invalid_grant`);
            appendAuditEntry(store, "gmail", {
              timestamp: new Date().toISOString(),
              toolName: "gmail_drafts",
              action: "update_draft",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
              details: { draftId },
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update draft" }));
          log(`${ts()} PUT /connections/gmail/drafts/${draftId} → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gmail", {
            timestamp: new Date().toISOString(),
            toolName: "gmail_drafts",
            action: "update_draft",
            verdict: "error",
            reason: err?.message || "Failed to update draft",
            severity: "high",
            details: { draftId },
          }).catch(() => {});
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Google Drive connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/gdrive/status" && nodeReq.method === "GET") {
        if (!hasDriveCredentials()) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "missing_credentials" }));
          log(`${ts()} GET /connections/gdrive/status → missing_credentials (${Date.now() - reqStart}ms)`);
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gdrive.json");
        if (!doc?.content) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
          log(`${ts()} GET /connections/gdrive/status → not_connected (${Date.now() - reqStart}ms)`);
          return;
        }

        try {
          const config = JSON.parse(doc.content) as DriveConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ status: "not_connected" }));
            return;
          }

          const docCount = (store.db.prepare(
            `SELECT COUNT(*) as c FROM documents WHERE collection = '_gdrive' AND active = 1`
          ).get() as { c: number }).c;

          const statusPayload = {
            status: config.authErrorCode ? "auth_error" : "connected",
            email: config.email,
            folders: config.folders || [],
            includeSubfolders: config.includeSubfolders ?? true,
            lastSync: config.lastSync ?? (docCount > 0
              ? (store.db.prepare(`SELECT modified_at FROM documents WHERE id = ?`).get(doc.id) as { modified_at: string } | undefined)?.modified_at
              : undefined),
            documentCount: docCount,
            pollEnabled: config.authErrorCode ? false : (config.pollEnabled ?? false),
            pollIntervalMinutes: config.pollIntervalMinutes ?? 30,
            polling: config.authErrorCode ? false : !!drivePollTimer,
            authErrorMessage: config.authErrorMessage,
            authErrorAt: config.authErrorAt,
          };

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(statusPayload));
          log(`${ts()} GET /connections/gdrive/status → ${statusPayload.status} (${Date.now() - reqStart}ms)`);
        } catch {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
        }
        return;
      }

      if (pathname === "/connections/gdrive/authorize" && nodeReq.method === "POST") {
        if (!hasDriveCredentials()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google OAuth client is not configured in Vault." }));
          return;
        }

        const redirectUri = `http://localhost:${port}/connections/gdrive/callback`;
        const authUrl = generateDriveAuthUrl(redirectUri);

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl }));
        log(`${ts()} POST /connections/gdrive/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/gdrive/callback") && nodeReq.method === "GET") {
        const callbackUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
        const code = callbackUrl.searchParams.get("code");

        if (!code) {
          nodeRes.writeHead(400, { "Content-Type": "text/html" });
          nodeRes.end("<h1>Error: No authorization code received</h1>");
          return;
        }

        try {
          const redirectUri = `http://localhost:${port}/connections/gdrive/callback`;
          const { refreshToken, accessToken, email } = await exchangeDriveCode(code, redirectUri);

          const existingDoc = store.getDocumentWithContent("_config", "gdrive.json");
          const existingConfig: Partial<DriveConfig> = existingDoc?.content
            ? JSON.parse(existingDoc.content)
            : {};

          const config: DriveConfig = {
            ...existingConfig,
            refreshToken,
            accessToken,
            accessTokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
            email,
            folders: existingConfig.folders || [],
            includeSubfolders: existingConfig.includeSubfolders ?? true,
          };
          clearAuthErrorFields(config);

          const now = new Date().toISOString();
          await saveDriveConfig(config, now);
          if (config.pollEnabled && config.pollIntervalMinutes) {
            startDrivePolling(config.pollIntervalMinutes);
          }

          nodeRes.writeHead(302, { Location: resolveWebUiRedirectLocation("/connections?gdrive=connected") });
          nodeRes.end();
          log(`${ts()} GET /connections/gdrive/callback → connected as ${email} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "text/html" });
          nodeRes.end(`<h1>OAuth Error</h1><p>${err?.message || "Unknown error"}</p>`);
          log(`${ts()} GET /connections/gdrive/callback → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gdrive/sync" && nodeReq.method === "POST") {
        const doc = store.getDocumentWithContent("_config", "gdrive.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google Drive not connected" }));
          return;
        }

        let config: DriveConfig | null = null;
        try {
          config = JSON.parse(doc.content) as DriveConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Google Drive not connected" }));
            return;
          }
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            return;
          }

          const result = await runDriveSync({
            config,
            documentExists: (collection, path) => {
              return !!store.findActiveDocument(collection, path);
            },
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return false;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
                return true;
              }
              store.insertContent(hash, content, now);
              store.insertDocument(collection, path, title, hash, now, now, "gdrive");
              return true;
            },
            saveAsset: async (path, binary, mimeType) => {
              await writeArtifact(store, path, binary, { mimeType, originalName: path.split("/").pop() });
            },
          });

          // Update lastSync timestamp
          clearAuthErrorFields(config);
          config.lastSync = new Date().toISOString();
          const now = new Date().toISOString();
          await saveDriveConfig(config, now);

          // Auto-embed (non-blocking, guarded against concurrent runs)
          startBackgroundEmbed({ trigger: "gdrive-sync" });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gdrive/sync → imported=${result.imported} skipped=${result.skipped} total=${result.total} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gdrive", {
            timestamp: new Date().toISOString(),
            toolName: "gdrive_sync",
            action: "sync",
            verdict: "allowed",
            reason: `Synced: imported=${result.imported} skipped=${result.skipped} total=${result.total}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { imported: result.imported, skipped: result.skipped, total: result.total },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markDriveAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            log(`${ts()} POST /connections/gdrive/sync → auth_error invalid_grant`);
            appendAuditEntry(store, "gdrive", {
              timestamp: new Date().toISOString(),
              toolName: "gdrive_sync",
              action: "sync",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Sync failed" }));
          log(`${ts()} POST /connections/gdrive/sync → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gdrive", {
            timestamp: new Date().toISOString(),
            toolName: "gdrive_sync",
            action: "sync",
            verdict: "error",
            reason: err?.message || "Sync failed",
            severity: "high",
          }).catch(() => {});
        }
        return;
      }

      if (pathname === "/connections/gdrive/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { folders?: { id: string; name: string }[]; includeSubfolders?: boolean; pollEnabled?: boolean; pollIntervalMinutes?: number };
        try { params = JSON.parse(body); } catch { params = {}; }

        const doc = store.getDocumentWithContent("_config", "gdrive.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google Drive not connected" }));
          return;
        }

        try {
          const config = JSON.parse(doc.content) as DriveConfig;
          if (params.folders !== undefined) config.folders = params.folders;
          if (params.includeSubfolders !== undefined) config.includeSubfolders = params.includeSubfolders;
          if (params.pollEnabled !== undefined) config.pollEnabled = params.pollEnabled;
          if (params.pollIntervalMinutes !== undefined && [15, 30, 60].includes(params.pollIntervalMinutes)) {
            config.pollIntervalMinutes = params.pollIntervalMinutes;
          }

          const now = new Date().toISOString();
          await saveDriveConfig(config, now);

          // Restart or stop polling based on new config
          if (config.pollEnabled && config.pollIntervalMinutes && !config.authErrorCode) {
            startDrivePolling(config.pollIntervalMinutes);
          } else {
            stopDrivePolling();
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/gdrive/config → updated (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/gdrive/disconnect" && nodeReq.method === "POST") {
        stopDrivePolling();
        const existing = store.findActiveDocument("_config", "gdrive.json");
        if (existing) {
          store.db.prepare(`UPDATE documents SET active = 0 WHERE id = ?`).run(existing.id);
        }

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /connections/gdrive/disconnect → done (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/gdrive/browse") && nodeReq.method === "GET") {
        const doc = store.getDocumentWithContent("_config", "gdrive.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google Drive not connected" }));
          return;
        }

        let config: DriveConfig | null = null;
        try {
          config = JSON.parse(doc.content) as DriveConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            return;
          }
          const browseUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
          const folderId = browseUrl.searchParams.get("folderId") || undefined;

          const result = await browseDrive(config, folderId);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} GET /connections/gdrive/browse → ${result.items.length} items (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markDriveAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            log(`${ts()} GET /connections/gdrive/browse → auth_error invalid_grant`);
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Browse failed" }));
          log(`${ts()} GET /connections/gdrive/browse → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gdrive/import" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { fileIds?: string[]; collection?: string };
        try { params = JSON.parse(body); } catch { params = {}; }

        if (!params.fileIds?.length) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "fileIds required" }));
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gdrive.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google Drive not connected" }));
          return;
        }

        let config: DriveConfig | null = null;
        try {
          config = JSON.parse(doc.content) as DriveConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            return;
          }

          const result = await importDriveFiles({
            config,
            fileIds: params.fileIds,
            collection: params.collection,
            documentExists: (collection, path) => {
              return !!store.findActiveDocument(collection, path);
            },
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return false;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
                return true;
              }
              store.insertContent(hash, content, now);
              store.insertDocument(collection, path, title, hash, now, now, "gdrive");
              return true;
            },
            saveAsset: async (path, binary, mimeType) => {
              await writeArtifact(store, path, binary, { mimeType, originalName: path.split("/").pop() });
            },
          });

          // Auto-embed (non-blocking, guarded against concurrent runs)
          startBackgroundEmbed({ trigger: "gdrive-import" });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gdrive/import → imported=${result.imported} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gdrive", {
            timestamp: new Date().toISOString(),
            toolName: "gdrive_import",
            action: "import",
            verdict: "allowed",
            reason: `Imported ${result.imported} files`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { imported: result.imported, fileIds: params.fileIds?.slice(0, 10) },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markDriveAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Drive authorization expired or was revoked. Reconnect Google Drive." }));
            log(`${ts()} POST /connections/gdrive/import → auth_error invalid_grant`);
            appendAuditEntry(store, "gdrive", {
              timestamp: new Date().toISOString(),
              toolName: "gdrive_import",
              action: "import",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
              details: { fileIds: params.fileIds?.slice(0, 10) },
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Import failed" }));
          log(`${ts()} POST /connections/gdrive/import → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gdrive", {
            timestamp: new Date().toISOString(),
            toolName: "gdrive_import",
            action: "import",
            verdict: "error",
            reason: err?.message || "Import failed",
            severity: "high",
            details: { fileIds: params.fileIds?.slice(0, 10) },
          }).catch(() => {});
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Google Calendar connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/gcalendar/status" && nodeReq.method === "GET") {
        if (!hasCalendarCredentials()) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "missing_credentials" }));
          log(`${ts()} GET /connections/gcalendar/status → missing_credentials (${Date.now() - reqStart}ms)`);
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
          log(`${ts()} GET /connections/gcalendar/status → not_connected (${Date.now() - reqStart}ms)`);
          return;
        }

        try {
          const config = JSON.parse(doc.content) as CalendarConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ status: "not_connected" }));
            return;
          }

          const docCount = (store.db.prepare(
            `SELECT COUNT(*) as c FROM documents WHERE collection = '_calendar' AND active = 1`
          ).get() as { c: number }).c;

          const statusPayload = {
            status: config.authErrorCode ? "auth_error" : "connected",
            email: config.email,
            calendars: config.calendars || [],
            lastSync: config.lastSync ?? (docCount > 0
              ? (store.db.prepare(`SELECT modified_at FROM documents WHERE id = ?`).get(doc.id) as { modified_at: string } | undefined)?.modified_at
              : undefined),
            documentCount: docCount,
            syncWindowPastDays: config.syncWindowPastDays ?? 30,
            syncWindowFutureDays: config.syncWindowFutureDays ?? 90,
            pollEnabled: config.authErrorCode ? false : (config.pollEnabled ?? false),
            pollIntervalMinutes: config.pollIntervalMinutes ?? 15,
            polling: config.authErrorCode ? false : !!calendarPollTimer,
            authErrorMessage: config.authErrorMessage,
            authErrorAt: config.authErrorAt,
          };
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(statusPayload));
          log(`${ts()} GET /connections/gcalendar/status → ${statusPayload.status} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/gcalendar/authorize" && nodeReq.method === "POST") {
        if (!hasCalendarCredentials()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google OAuth client is not configured in Vault." }));
          return;
        }
        const redirectUri = `http://localhost:${port}/connections/gcalendar/callback`;
        const authUrl = generateCalendarAuthUrl(redirectUri);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl }));
        log(`${ts()} POST /connections/gcalendar/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/gcalendar/callback") && nodeReq.method === "GET") {
        const callbackUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          nodeRes.writeHead(400, { "Content-Type": "text/plain" });
          nodeRes.end("Missing authorization code");
          return;
        }
        try {
          const redirectUri = `http://localhost:${port}/connections/gcalendar/callback`;
          const tokens = await exchangeCalendarCode(code, redirectUri);

          const now = new Date().toISOString();
          const existingDoc = store.getDocumentWithContent("_config", "gcalendar.json");
          const existingConfig = existingDoc?.content ? JSON.parse(existingDoc.content) : {};

          const config: CalendarConfig = {
            ...existingConfig,
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken,
            email: tokens.email,
            calendars: existingConfig.calendars || [],
            scopes: ["calendar.readonly", "calendar.events"],
          };
          clearAuthErrorFields(config);

          await saveCalendarConfig(config, now);
          if (config.pollEnabled && config.pollIntervalMinutes) {
            startCalendarPolling(config.pollIntervalMinutes);
          }

          nodeRes.writeHead(302, { Location: resolveWebUiRedirectLocation("/connections?gcalendar=connected") });
          nodeRes.end();
          log(`${ts()} GET /connections/gcalendar/callback → connected as ${tokens.email} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "text/plain" });
          nodeRes.end(`Calendar authorization failed: ${err?.message}`);
          log(`${ts()} GET /connections/gcalendar/callback → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gcalendar/calendars" && nodeReq.method === "GET") {
        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Calendar not connected" }));
          return;
        }
        let config: CalendarConfig | null = null;
        try {
          config = JSON.parse(doc.content) as CalendarConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            return;
          }
          const calendars = await listCalendars(config);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ calendars }));
          log(`${ts()} GET /connections/gcalendar/calendars → ${calendars.length} calendars (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markCalendarAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            log(`${ts()} GET /connections/gcalendar/calendars → auth_error invalid_grant`);
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/gcalendar/sync" && nodeReq.method === "POST") {
        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Calendar not connected" }));
          return;
        }
        let config: CalendarConfig | null = null;
        try {
          config = JSON.parse(doc.content) as CalendarConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            return;
          }
          const result = await runCalendarSync({
            config,
            documentExists: (collection, path) => {
              return !!store.findActiveDocument(collection, path);
            },
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return false;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
                return true;
              }
              store.insertContent(hash, content, now);
              store.insertDocument(collection, path, title, hash, now, now);
              return true;
            },
          });

          // Check if sync caught an auth error internally (swallowed into result.errors)
          const authErr = result.errors.find((e: string) => e.toLowerCase().includes("invalid_grant"));
          if (authErr) {
            await markCalendarAuthError(config, new Error(authErr));
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            log(`${ts()} POST /connections/gcalendar/sync → auth_error invalid_grant`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_sync",
              action: "sync",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }

          // Update lastSync
          clearAuthErrorFields(config);
          config.lastSync = new Date().toISOString();
          await saveCalendarConfig(config, config.lastSync);

          handleImportedItemsNotification("gcalendar", {
            imported: result.imported,
            total: result.total,
            items: result.importedItems,
          }, "calendar manual sync");

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gcalendar/sync → imported=${result.imported} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gcalendar", {
            timestamp: new Date().toISOString(),
            toolName: "gcalendar_sync",
            action: "sync",
            verdict: "allowed",
            reason: `Synced: imported=${result.imported}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { imported: result.imported },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markCalendarAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            log(`${ts()} POST /connections/gcalendar/sync → auth_error invalid_grant`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_sync",
              action: "sync",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Sync failed" }));
          log(`${ts()} POST /connections/gcalendar/sync → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gcalendar", {
            timestamp: new Date().toISOString(),
            toolName: "gcalendar_sync",
            action: "sync",
            verdict: "error",
            reason: err?.message || "Sync failed",
            severity: "high",
          }).catch(() => {});
        }
        return;
      }

      if (pathname === "/connections/gcalendar/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: Partial<CalendarConfig>;
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Calendar not connected" }));
          return;
        }

        try {
          const config = JSON.parse(doc.content) as CalendarConfig;
          if (params.calendars !== undefined) config.calendars = params.calendars;
          if (params.syncWindowPastDays !== undefined) config.syncWindowPastDays = params.syncWindowPastDays;
          if (params.syncWindowFutureDays !== undefined) config.syncWindowFutureDays = params.syncWindowFutureDays;
          if (params.pollEnabled !== undefined) config.pollEnabled = params.pollEnabled;
          if (params.pollIntervalMinutes !== undefined && [5, 10, 15, 30].includes(params.pollIntervalMinutes)) {
            config.pollIntervalMinutes = params.pollIntervalMinutes;
          }

          const now = new Date().toISOString();
          await saveCalendarConfig(config, now);

          // Restart or stop polling based on new config
          if (config.pollEnabled && config.pollIntervalMinutes && !config.authErrorCode) {
            startCalendarPolling(config.pollIntervalMinutes);
          } else {
            stopCalendarPolling();
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/gcalendar/config → updated (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/gcalendar/disconnect" && nodeReq.method === "POST") {
        stopCalendarPolling();
        const existing = store.findActiveDocument("_config", "gcalendar.json");
        if (existing) {
          store.db.prepare(`UPDATE documents SET active = 0 WHERE id = ?`).run(existing.id);
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /connections/gcalendar/disconnect → ok (${Date.now() - reqStart}ms)`);
        return;
      }

      // Calendar event CRUD
      if (pathname === "/connections/gcalendar/events" && nodeReq.method === "POST") {
        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Calendar not connected" }));
          return;
        }
        let config: CalendarConfig | null = null;
        try {
          config = JSON.parse(doc.content) as CalendarConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            return;
          }
          const body = await collectBody(nodeReq);
          const req = JSON.parse(body) as EventRequest;
          const result = await createCalendarEvent(config, req);
          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gcalendar/events → ${result.id} created (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "gcalendar", {
            timestamp: new Date().toISOString(),
            toolName: "gcalendar_events",
            action: "create_event",
            verdict: "allowed",
            reason: `Event created: ${req.summary ?? result.id}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { eventId: result.id, summary: req.summary },
          }).catch(() => {});
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markCalendarAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            log(`${ts()} POST /connections/gcalendar/events → auth_error invalid_grant`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_events",
              action: "create_event",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Create event failed" }));
          log(`${ts()} POST /connections/gcalendar/events → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gcalendar", {
            timestamp: new Date().toISOString(),
            toolName: "gcalendar_events",
            action: "create_event",
            verdict: "error",
            reason: err?.message || "Create event failed",
            severity: "high",
          }).catch(() => {});
        }
        return;
      }

      const calEventMatch = pathname.match(/^\/connections\/gcalendar\/events\/(.+)$/);
      if (calEventMatch && (nodeReq.method === "PUT" || nodeReq.method === "DELETE")) {
        const eventId = decodeURIComponent(calEventMatch[1]!);
        const doc = store.getDocumentWithContent("_config", "gcalendar.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Calendar not connected" }));
          return;
        }
        let config: CalendarConfig | null = null;
        try {
          config = JSON.parse(doc.content) as CalendarConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            return;
          }
          if (nodeReq.method === "PUT") {
            const body = await collectBody(nodeReq);
            const req = JSON.parse(body) as Partial<EventRequest> & { calendarId?: string };
            const calendarId = req.calendarId || "primary";
            const result = await updateCalendarEvent(config, calendarId, eventId, req);
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(result));
            log(`${ts()} PUT /connections/gcalendar/events/${eventId} → updated (${Date.now() - reqStart}ms)`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_events",
              action: "update_event",
              verdict: "allowed",
              reason: `Event updated: ${eventId}`,
              severity: "low",
              durationMs: Date.now() - reqStart,
              details: { eventId, summary: req.summary },
            }).catch(() => {});
          } else {
            // DELETE
            const deleteUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
            const calendarId = deleteUrl.searchParams.get("calendarId") || "primary";
            await deleteCalendarEvent(config, calendarId, eventId);
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true }));
            log(`${ts()} DELETE /connections/gcalendar/events/${eventId} → deleted (${Date.now() - reqStart}ms)`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_events",
              action: "delete_event",
              verdict: "allowed",
              reason: `Event deleted: ${eventId}`,
              severity: "medium",
              durationMs: Date.now() - reqStart,
              details: { eventId, calendarId },
            }).catch(() => {});
          }
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markCalendarAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Calendar authorization expired or was revoked. Reconnect Google Calendar." }));
            log(`${ts()} ${nodeReq.method} /connections/gcalendar/events/${eventId} → auth_error invalid_grant`);
            appendAuditEntry(store, "gcalendar", {
              timestamp: new Date().toISOString(),
              toolName: "gcalendar_events",
              action: nodeReq.method === "PUT" ? "update_event" : "delete_event",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
              details: { eventId },
            }).catch(() => {});
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Event operation failed" }));
          log(`${ts()} ${nodeReq.method} /connections/gcalendar/events/${eventId} → ERROR: ${err?.message}`);
          appendAuditEntry(store, "gcalendar", {
            timestamp: new Date().toISOString(),
            toolName: "gcalendar_events",
            action: nodeReq.method === "PUT" ? "update_event" : "delete_event",
            verdict: "error",
            reason: err?.message || "Event operation failed",
            severity: "high",
            details: { eventId },
          }).catch(() => {});
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Google Contacts connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/gcontacts/status" && nodeReq.method === "GET") {
        if (!hasContactsCredentials()) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "missing_credentials" }));
          log(`${ts()} GET /connections/gcontacts/status → missing_credentials (${Date.now() - reqStart}ms)`);
          return;
        }

        const doc = store.getDocumentWithContent("_config", "gcontacts.json");
        if (!doc?.content) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
          log(`${ts()} GET /connections/gcontacts/status → not_connected (${Date.now() - reqStart}ms)`);
          return;
        }

        try {
          const config = JSON.parse(doc.content) as ContactsConfig;
          if (!config.refreshToken) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ status: "not_connected" }));
            return;
          }

          const docCount = (store.db.prepare(
            `SELECT COUNT(*) as c FROM documents WHERE collection = '_contacts' AND active = 1`
          ).get() as { c: number }).c;

          const statusPayload = {
            status: config.authErrorCode ? "auth_error" : "connected",
            email: config.email,
            lastSync: config.lastSync ?? (docCount > 0
              ? (store.db.prepare(`SELECT modified_at FROM documents WHERE id = ?`).get(doc.id) as { modified_at: string } | undefined)?.modified_at
              : undefined),
            documentCount: docCount,
            pollEnabled: config.authErrorCode ? false : (config.pollEnabled ?? false),
            pollIntervalMinutes: config.pollIntervalMinutes ?? 60,
            polling: config.authErrorCode ? false : !!contactsPollTimer,
            authErrorMessage: config.authErrorMessage,
            authErrorAt: config.authErrorAt,
          };
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(statusPayload));
          log(`${ts()} GET /connections/gcontacts/status → ${statusPayload.status} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/gcontacts/authorize" && nodeReq.method === "POST") {
        if (!hasContactsCredentials()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Google OAuth client is not configured in Vault." }));
          return;
        }
        const redirectUri = `http://localhost:${port}/connections/gcontacts/callback`;
        const authUrl = generateContactsAuthUrl(redirectUri);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl }));
        log(`${ts()} POST /connections/gcontacts/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/gcontacts/callback") && nodeReq.method === "GET") {
        const callbackUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          nodeRes.writeHead(400, { "Content-Type": "text/plain" });
          nodeRes.end("Missing authorization code");
          return;
        }
        try {
          const redirectUri = `http://localhost:${port}/connections/gcontacts/callback`;
          const tokens = await exchangeContactsCode(code, redirectUri);

          const now = new Date().toISOString();
          const existingDoc = store.getDocumentWithContent("_config", "gcontacts.json");
          const existingConfig: Partial<ContactsConfig> = existingDoc?.content
            ? JSON.parse(existingDoc.content)
            : {};
          const config: ContactsConfig = {
            ...existingConfig,
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken,
            email: tokens.email,
            scopes: ["contacts.readonly"],
          };
          clearAuthErrorFields(config);

          await saveContactsConfig(config, now);
          if (config.pollEnabled && config.pollIntervalMinutes) {
            startContactsPolling(config.pollIntervalMinutes);
          }

          nodeRes.writeHead(302, { Location: resolveWebUiRedirectLocation("/connections?gcontacts=connected") });
          nodeRes.end();
          log(`${ts()} GET /connections/gcontacts/callback → connected as ${tokens.email} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "text/plain" });
          nodeRes.end(`Contacts authorization failed: ${err?.message}`);
          log(`${ts()} GET /connections/gcontacts/callback → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gcontacts/sync" && nodeReq.method === "POST") {
        const doc = store.getDocumentWithContent("_config", "gcontacts.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Contacts not connected" }));
          return;
        }
        let config: ContactsConfig | null = null;
        try {
          config = JSON.parse(doc.content) as ContactsConfig;
          if (config.authErrorCode) {
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Contacts authorization expired or was revoked. Reconnect Google Contacts." }));
            return;
          }
          const result = await runContactsSync({
            config,
            documentExists: (collection, path) => {
              return !!store.findActiveDocument(collection, path);
            },
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return false;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
                return true;
              }
              store.insertContent(hash, content, now);
              store.insertDocument(collection, path, title, hash, now, now);
              return true;
            },
          });

          // Check if sync caught an auth error internally (swallowed into result.errors)
          const authErr = result.errors.find((e: string) => e.toLowerCase().includes("invalid_grant"));
          if (authErr) {
            await markContactsAuthError(config, new Error(authErr));
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Contacts authorization expired or was revoked. Reconnect Google Contacts." }));
            log(`${ts()} POST /connections/gcontacts/sync → auth_error invalid_grant`);
            appendAuditEntry(store, "gcontacts", {
              timestamp: new Date().toISOString(),
              toolName: "gcontacts_sync",
              action: "sync",
              verdict: "error",
              reason: "Auth error: invalid_grant",
              severity: "high",
            }).catch(() => {});
            return;
          }

          // Update lastSync
          clearAuthErrorFields(config);
          config.lastSync = new Date().toISOString();
          await saveContactsConfig(config, config.lastSync);

          // Auto-embed (non-blocking, guarded against concurrent runs)
          startBackgroundEmbed({ trigger: "gcontacts-sync" });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/gcontacts/sync → imported=${result.imported} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          if (config && isOAuthInvalidGrantError(err)) {
            await markContactsAuthError(config, err);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "Google Contacts authorization expired or was revoked. Reconnect Google Contacts." }));
            log(`${ts()} POST /connections/gcontacts/sync → auth_error invalid_grant`);
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Sync failed" }));
          log(`${ts()} POST /connections/gcontacts/sync → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/gcontacts/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { pollEnabled?: boolean; pollIntervalMinutes?: number };
        try { params = JSON.parse(body); } catch { params = {}; }

        const doc = store.getDocumentWithContent("_config", "gcontacts.json");
        if (!doc?.content) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Contacts not connected" }));
          return;
        }

        try {
          const config = JSON.parse(doc.content) as ContactsConfig;
          if (params.pollEnabled !== undefined) config.pollEnabled = params.pollEnabled;
          if (params.pollIntervalMinutes !== undefined && [30, 60, 120].includes(params.pollIntervalMinutes)) {
            config.pollIntervalMinutes = params.pollIntervalMinutes;
          }

          const now = new Date().toISOString();
          await saveContactsConfig(config, now);

          // Restart or stop polling based on new config
          if (config.pollEnabled && config.pollIntervalMinutes && !config.authErrorCode) {
            startContactsPolling(config.pollIntervalMinutes);
          } else {
            stopContactsPolling();
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/gcontacts/config → updated (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/gcontacts/disconnect" && nodeReq.method === "POST") {
        stopContactsPolling();
        const existing = store.findActiveDocument("_config", "gcontacts.json");
        if (existing) {
          store.db.prepare(`UPDATE documents SET active = 0 WHERE id = ?`).run(existing.id);
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /connections/gcontacts/disconnect → ok (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // GitHub connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/github/status" && nodeReq.method === "GET") {
        if (!hasGitHubClientCredentials()) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "missing_credentials" }));
          log(`${ts()} GET /connections/github/status → missing_credentials (${Date.now() - reqStart}ms)`);
          return;
        }

        const doc = store.getDocumentWithContent("_config", "github.json");
        if (!doc?.content) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
          log(`${ts()} GET /connections/github/status → not_connected (${Date.now() - reqStart}ms)`);
          return;
        }

        try {
          const config = JSON.parse(doc.content) as GitHubConfig;
          if (!config.accessToken) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ status: "not_connected" }));
            return;
          }

          // Count documents in _github collection
          const docCount = (store.db.prepare(
            `SELECT COUNT(*) as c FROM documents WHERE collection = '_github' AND active = 1`
          ).get() as { c: number }).c;

          // Count workspace files for synced repos
          let workspaceFileCount = 0;
          for (const repo of config.selectedRepos || []) {
            const repoFileCount = (store.db.prepare(
              `SELECT COUNT(*) as c FROM documents WHERE collection = '_workspace' AND path LIKE ? AND active = 1`
            ).get(`${repo.name}/%`) as { c: number }).c;
            workspaceFileCount += repoFileCount;
          }

          const statusPayload = {
            status: config.authErrorCode ? "auth_error" : "connected",
            username: config.username,
            avatarUrl: config.avatarUrl,
            selectedRepos: config.selectedRepos || [],
            lastSync: config.lastSync,
            documentCount: docCount,
            workspaceFileCount,
            pollEnabled: config.authErrorCode ? false : (config.pollEnabled ?? false),
            pollIntervalMinutes: config.pollIntervalMinutes ?? 15,
            polling: config.authErrorCode ? false : !!githubPollTimer,
            syncIssues: config.syncIssues ?? true,
            syncPRs: config.syncPRs ?? true,
            authErrorMessage: config.authErrorMessage,
            authErrorAt: config.authErrorAt,
          };

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(statusPayload));
          log(`${ts()} GET /connections/github/status → ${statusPayload.status} (${Date.now() - reqStart}ms)`);
        } catch {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ status: "not_connected" }));
        }
        return;
      }

      if (pathname === "/connections/github/authorize" && nodeReq.method === "POST") {
        if (!hasGitHubClientCredentials()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub OAuth client is not configured in Vault." }));
          return;
        }

        const redirectUri = `http://localhost:${port}/connections/github/callback`;
        const authUrl = generateGitHubAuthUrl(redirectUri);

        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl }));
        log(`${ts()} POST /connections/github/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname.startsWith("/connections/github/callback") && nodeReq.method === "GET") {
        const callbackUrl = new URL(nodeReq.url!, `http://localhost:${port}`);
        const code = callbackUrl.searchParams.get("code");

        if (!code) {
          nodeRes.writeHead(400, { "Content-Type": "text/html" });
          nodeRes.end("<h1>Error: No authorization code received</h1>");
          return;
        }

        try {
          const { accessToken, username, avatarUrl } = await exchangeGitHubCode(code);

          // Load existing config or create new
          const existingDoc = store.getDocumentWithContent("_config", "github.json");
          const existingConfig: Partial<GitHubConfig> = existingDoc?.content
            ? JSON.parse(existingDoc.content)
            : {};

          const config: GitHubConfig = {
            ...existingConfig,
            accessToken,
            username,
            avatarUrl,
            selectedRepos: existingConfig.selectedRepos || [],
          } as GitHubConfig;
          clearGitHubAuthError(config);

          const now = new Date().toISOString();
          await saveGitHubConfig(config, now);
          if (config.pollEnabled && config.pollIntervalMinutes) {
            startGitHubPolling(config.pollIntervalMinutes);
          }

          nodeRes.writeHead(302, { Location: resolveWebUiRedirectLocation("/connections?github=connected") });
          nodeRes.end();
          log(`${ts()} GET /connections/github/callback → connected as ${username} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "text/html" });
          nodeRes.end(`<h1>OAuth Error</h1><p>${err?.message || "Unknown error"}</p>`);
          log(`${ts()} GET /connections/github/callback → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/github/repos" && nodeReq.method === "GET") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }

        try {
          const repos = await listGitHubUserRepos(config.accessToken);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(repos));
          log(`${ts()} GET /connections/github/repos → ${repos.length} repos (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          if (isGitHubAuthError(err)) {
            markGitHubAuthError(config);
            await saveGitHubConfig(config);
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage }));
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/sync" && nodeReq.method === "POST") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        if (config.authErrorCode) {
          nodeRes.writeHead(401, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: config.authErrorMessage || "GitHub authorization expired. Reconnect GitHub." }));
          return;
        }
        if (!config.selectedRepos?.length) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "No repositories selected. Configure repos first." }));
          return;
        }

        try {
          const result = await runGitHubSync({
            config,
            upsertDocument: async (collection, path, content, title) => {
              const now = new Date().toISOString();
              const hash = await hashContent(content);
              const existing = store.findActiveDocument(collection, path);
              if (existing) {
                const prev = store.getDocumentWithContent(collection, path);
                if (prev && prev.hash === hash) return;
                store.insertContent(hash, content, now);
                store.updateDocument(existing.id, title, hash, now);
              } else {
                store.insertContent(hash, content, now);
                store.insertDocument(collection, path, title, hash, now, now);
              }
            },
          });

          clearGitHubAuthError(config);
          config.lastSync = new Date().toISOString();
          await saveGitHubConfig(config, config.lastSync);


          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/github/sync → imported=${result.imported} skipped=${result.skipped} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "github", {
            timestamp: new Date().toISOString(),
            toolName: "github_sync",
            action: "sync",
            verdict: "allowed",
            reason: `Synced: imported=${result.imported} skipped=${result.skipped} total=${result.total}`,
            severity: "low",
            durationMs: Date.now() - reqStart,
            details: { imported: result.imported, skipped: result.skipped, total: result.total },
          }).catch(() => {});
        } catch (err: any) {
          if (isGitHubAuthError(err)) {
            markGitHubAuthError(config);
            await saveGitHubConfig(config);
            stopGitHubPolling();
            nodeRes.writeHead(401, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: config.authErrorMessage }));
            return;
          }
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Sync failed" }));
          log(`${ts()} POST /connections/github/sync → ERROR: ${err?.message}`);
        }
        return;
      }

      if (pathname === "/connections/github/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: {
          selectedRepos?: GitHubConfig["selectedRepos"];
          pollEnabled?: boolean;
          pollIntervalMinutes?: number;
          syncIssues?: boolean;
          syncPRs?: boolean;
        };
        try { params = JSON.parse(body); } catch { params = {}; }

        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }

        try {
          if (params.selectedRepos !== undefined) config.selectedRepos = params.selectedRepos;
          if (params.pollEnabled !== undefined) config.pollEnabled = params.pollEnabled;
          if (params.pollIntervalMinutes !== undefined && [5, 15, 30, 60].includes(params.pollIntervalMinutes)) {
            config.pollIntervalMinutes = params.pollIntervalMinutes;
          }
          if (params.syncIssues !== undefined) config.syncIssues = params.syncIssues;
          if (params.syncPRs !== undefined) config.syncPRs = params.syncPRs;

          const now = new Date().toISOString();
          await saveGitHubConfig(config, now);

          if (config.pollEnabled && config.pollIntervalMinutes && !config.authErrorCode) {
            startGitHubPolling(config.pollIntervalMinutes);
          } else {
            stopGitHubPolling();
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/github/config → updated (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/disconnect" && nodeReq.method === "POST") {
        stopGitHubPolling();
        const existing = store.findActiveDocument("_config", "github.json");
        if (existing) {
          store.db.prepare(`UPDATE documents SET active = 0 WHERE id = ?`).run(existing.id);
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true }));
        log(`${ts()} POST /connections/github/disconnect → ok (${Date.now() - reqStart}ms)`);
        return;
      }

      // GitHub API proxy endpoints (for agent tools)

      if (pathname === "/connections/github/issues" && nodeReq.method === "POST") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const body = await collectBody(nodeReq);
        try {
          const params = JSON.parse(body) as { owner: string; repo: string; title: string; body?: string; labels?: string[] };
          const issue = await createGitHubIssue(config.accessToken, params.owner, params.repo, params.title, params.body, params.labels);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(issue));
          log(`${ts()} POST /connections/github/issues → #${issue.number} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/issues" && nodeReq.method === "GET") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const url = new URL(nodeReq.url!, `http://localhost:${port}`);
        const owner = url.searchParams.get("owner") || "";
        const repo = url.searchParams.get("repo") || "";
        const state = (url.searchParams.get("state") || "open") as "open" | "closed" | "all";
        if (!owner || !repo) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "owner and repo query params required" }));
          return;
        }
        try {
          const issues = await listGitHubIssues(config.accessToken, owner, repo, state);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(issues));
          log(`${ts()} GET /connections/github/issues → ${issues.length} issues (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/branches" && nodeReq.method === "POST") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const body = await collectBody(nodeReq);
        try {
          const params = JSON.parse(body) as { owner: string; repo: string; branch: string; from?: string };
          const result = await createGitHubBranch(config.accessToken, params.owner, params.repo, params.branch, params.from);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/github/branches → ${params.branch} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/pull-requests" && nodeReq.method === "POST") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const body = await collectBody(nodeReq);
        try {
          const params = JSON.parse(body) as { owner: string; repo: string; title: string; body?: string; head: string; base?: string };
          const pr = await createGitHubPR(config.accessToken, params.owner, params.repo, params.title, params.body, params.head, params.base);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(pr));
          log(`${ts()} POST /connections/github/pull-requests → PR #${pr.number} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/pull-requests" && nodeReq.method === "GET") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const url = new URL(nodeReq.url!, `http://localhost:${port}`);
        const owner = url.searchParams.get("owner") || "";
        const repo = url.searchParams.get("repo") || "";
        const state = (url.searchParams.get("state") || "open") as "open" | "closed" | "all";
        if (!owner || !repo) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "owner and repo query params required" }));
          return;
        }
        try {
          const prs = await listGitHubPRs(config.accessToken, owner, repo, state);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(prs));
          log(`${ts()} GET /connections/github/pull-requests → ${prs.length} PRs (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/github/push" && nodeReq.method === "POST") {
        const config = getGitHubConfig();
        if (!config) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "GitHub not connected" }));
          return;
        }
        const body = await collectBody(nodeReq);
        try {
          const params = JSON.parse(body) as {
            owner: string; repo: string; branch: string;
            files: Array<{ path: string; content: string }>;
            message: string;
          };
          const result = await pushGitHubChanges(
            config.accessToken, params.owner, params.repo, params.branch, params.files, params.message,
          );
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/github/push → ${params.branch} sha=${result.sha.slice(0, 7)} (${Date.now() - reqStart}ms)`);
          appendAuditEntry(store, "github", {
            timestamp: new Date().toISOString(),
            toolName: "github_push",
            action: "push",
            verdict: "allowed",
            reason: `Pushed ${params.files.length} files to ${params.owner}/${params.repo}:${params.branch}`,
            severity: "medium",
            durationMs: Date.now() - reqStart,
          }).catch(() => {});
        } catch (err: any) {
          const status = err?.message?.includes("Refused to push") ? 403 : 500;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Push failed" }));
          log(`${ts()} POST /connections/github/push → ERROR ${status}: ${err?.message}`);
          if (status === 403) {
            appendAuditEntry(store, "github", {
              timestamp: new Date().toISOString(),
              toolName: "github_push",
              action: "push",
              verdict: "blocked",
              reason: err?.message || "Protected branch",
              severity: "high",
            }).catch(() => {});
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Tasks endpoints
      // -----------------------------------------------------------------------

      const TASK_TOOL_CALL_TYPES = new Set(["tool_use", "toolcall", "tool_call"]);
      const TASK_TOOL_RESULT_TYPES = new Set(["tool_result", "tool_result_error"]);
      const TASK_OUTPUT_EXT_RE = /\.(pdf|pptx?|docx?|xlsx?|csv|png|jpe?g|gif|svg|webp|zip|tar|gz|txt|md|html)$/i;
      const TASK_REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;
      const TASK_HEARTBEAT_OK_RE = /^HEARTBEAT_OK$/i;
      const TASK_PROGRESS_UPDATE_RE = /^(?:quick update|heads-up):/i;

      function normalizeTaskBlockType(value: unknown): string {
        return typeof value === "string" ? value.trim().toLowerCase() : "";
      }

      function extractTaskTimestamp(
        entry: Record<string, unknown>,
        fallbackIso: string,
      ): { iso: string; ms: number } {
        if (typeof entry.timestamp === "string") {
          const parsed = Date.parse(entry.timestamp);
          if (Number.isFinite(parsed)) {
            return { iso: new Date(parsed).toISOString(), ms: parsed };
          }
        }
        const message =
          typeof entry.message === "object" && entry.message !== null
            ? (entry.message as Record<string, unknown>)
            : undefined;
        if (typeof message?.timestamp === "number" && Number.isFinite(message.timestamp)) {
          return { iso: new Date(message.timestamp).toISOString(), ms: message.timestamp };
        }
        if (typeof message?.timestamp === "string") {
          const parsed = Date.parse(message.timestamp);
          if (Number.isFinite(parsed)) {
            return { iso: new Date(parsed).toISOString(), ms: parsed };
          }
        }
        const fallbackMs = Date.parse(fallbackIso);
        return {
          iso: fallbackIso,
          ms: Number.isFinite(fallbackMs) ? fallbackMs : Date.now(),
        };
      }

      function cleanTaskText(raw: string): string {
        return raw
          .replace(TASK_REPLY_TAG_RE, "")
          .replace(/\r\n/g, "\n")
          .trim();
      }

      function isTaskNoiseText(text: string): boolean {
        const trimmed = text.trim();
        if (!trimmed) return true;
        if (TASK_HEARTBEAT_OK_RE.test(trimmed)) return true;
        if (TASK_PROGRESS_UPDATE_RE.test(trimmed) && trimmed.length <= 240) return true;
        return false;
      }

      function scoreTaskDeliverable(text: string): number {
        if (isTaskNoiseText(text)) return -1;
        let score = text.length;
        if (/\n[-*]\s|\n\d+\.\s/.test(text)) score += 200;
        if (/^#{1,6}\s/m.test(text)) score += 150;
        if (/\n{2,}/.test(text)) score += 75;
        return score;
      }

      function isLikelyTaskOutputPath(path: string): boolean {
        const normalized = path.trim();
        if (!normalized || normalized.endsWith("/spec.json")) return false;
        return normalized.includes("/build/") || TASK_OUTPUT_EXT_RE.test(normalized);
      }

      function extractTaskOutputPath(text: string): string | null {
        const match = text.match(/\b(?:editable|_editable)\/\S+/i);
        if (!match) return null;
        const path = match[0]
          .replace(/^(?:editable|_editable)\//i, "")
          .replace(/[),.;:!?]+$/g, "")
          .trim();
        return isLikelyTaskOutputPath(path) ? path : null;
      }

      function scoreTaskSessionCandidate(params: {
        doc: string;
        taskMarker: string;
        legacyTaskMarker?: string;
      }): number {
        const lines = params.doc.split("\n").filter((line) => line.trim());
        let score = 0;
        let sawCronScopedUserTurn = false;
        let sawHeartbeatWrapper = false;
        let sawSystemHookRelay = false;
        let sawMeaningfulAssistantReply = false;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            if (entry.type !== "message") continue;
            const msg =
              typeof entry.message === "object" && entry.message !== null
                ? (entry.message as Record<string, unknown>)
                : null;
            if (!msg || !Array.isArray(msg.content)) continue;

            const textBlocks = msg.content
              .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
              .filter((block) => normalizeTaskBlockType(block.type) === "text" && typeof block.text === "string")
              .map((block) => String(block.text));
            if (textBlocks.length === 0) continue;

            for (const text of textBlocks) {
              const includesTaskMarker =
                text.includes(params.taskMarker) ||
                (params.legacyTaskMarker ? text.includes(params.legacyTaskMarker) : false);
              if (!includesTaskMarker) continue;

              if (msg.role === "user") {
                if (text.includes("[cron:")) {
                  score += 100;
                  sawCronScopedUserTurn = true;
                }
                if (text.includes("System: Hook ")) {
                  score -= 120;
                  sawSystemHookRelay = true;
                }
                if (text.includes("Read HEARTBEAT.md if it exists")) {
                  score -= 60;
                  sawHeartbeatWrapper = true;
                }
              } else if (msg.role === "assistant") {
                const cleaned = cleanTaskText(text);
                if (cleaned && !isTaskNoiseText(cleaned)) {
                  score += 25;
                  sawMeaningfulAssistantReply = true;
                }
              }
            }
          } catch {
            // Ignore unparsable candidate rows.
          }
        }

        if (sawCronScopedUserTurn) score += 50;
        if (sawMeaningfulAssistantReply) score += 20;
        if (sawSystemHookRelay) score -= 40;
        if (sawHeartbeatWrapper && !sawCronScopedUserTurn) score -= 20;
        return score;
      }

      const TASK_ACTIVITY_TYPE_ORDER: Record<string, number> = {
        instruction: 0,
        delegation: 1,
        reasoning: 2,
        tool_call: 3,
        output: 4,
        error: 5,
        status_change: 6,
      };

      function parseTaskActivityLine(line: string): Record<string, unknown> | null {
        try {
          const parsed = JSON.parse(line);
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }

      function sortTaskActivityLines(lines: string[]): string[] {
        return lines
          .map((line, index) => ({ line, index, entry: parseTaskActivityLine(line) }))
          .sort((a, b) => {
            const aTs = typeof a.entry?.ts === "string" ? Date.parse(a.entry.ts) : Number.NaN;
            const bTs = typeof b.entry?.ts === "string" ? Date.parse(b.entry.ts) : Number.NaN;
            const aValid = Number.isFinite(aTs);
            const bValid = Number.isFinite(bTs);
            if (aValid && bValid && aTs !== bTs) return aTs - bTs;
            if (aValid !== bValid) return aValid ? -1 : 1;

            const aType = typeof a.entry?.type === "string" ? a.entry.type : "";
            const bType = typeof b.entry?.type === "string" ? b.entry.type : "";
            const aOrder = TASK_ACTIVITY_TYPE_ORDER[aType] ?? Number.MAX_SAFE_INTEGER;
            const bOrder = TASK_ACTIVITY_TYPE_ORDER[bType] ?? Number.MAX_SAFE_INTEGER;
            if (aOrder !== bOrder) return aOrder - bOrder;

            return a.index - b.index;
          })
          .map((item) => item.line);
      }

      function collectTaskOutputs(taskId: string, activityEntries: unknown[]) {
        const refs = new Map<string, { collection: string; path: string }>();
        const queuedTaskOutputs = writeQueue.filter((entry) =>
          entry.collection === "_tasks" &&
          entry.op === "upsert" &&
          entry.path.startsWith(`${taskId}/outputs/`) &&
          !entry.path.endsWith("/meta.json") &&
          !entry.path.endsWith("/activity.jsonl"),
        );

        for (const entry of activityEntries) {
          if (!entry || typeof entry !== "object") continue;
          const activity = entry as {
            type?: string;
            summary?: string;
            detail?: string;
            meta?: Record<string, unknown>;
          };
          if (activity.type !== "output") continue;

          const metaCollection =
            typeof activity.meta?.collection === "string" ? activity.meta.collection : undefined;
          const metaPath = typeof activity.meta?.path === "string" ? activity.meta.path : undefined;
          if (metaCollection && metaPath) {
            refs.set(`${metaCollection}:${metaPath}`, { collection: metaCollection, path: metaPath });
            continue;
          }

          const parsedPath =
            (typeof activity.summary === "string" ? extractTaskOutputPath(activity.summary) : null) ||
            (typeof activity.detail === "string" ? extractTaskOutputPath(activity.detail) : null);
          if (parsedPath) {
            refs.set(`${EDITABLE_COLLECTION}:${parsedPath}`, {
              collection: EDITABLE_COLLECTION,
              path: parsedPath,
            });
          }
        }

        const taskOutputRows = (store.db.prepare(`
          SELECT d.path, d.title, d.modified_at, LENGTH(c.doc) as size
          FROM documents d
          JOIN content c ON c.hash = d.hash
          WHERE d.collection = '_tasks' AND d.active = 1 AND d.path LIKE ? AND d.path NOT LIKE '%/meta.json' AND d.path NOT LIKE '%/activity.jsonl'
          ORDER BY d.modified_at DESC
        `).all(`${taskId}/outputs/%`)) as { path: string; title: string; modified_at: string; size: number }[];

        const outputs = taskOutputRows.map((r) => ({
          collection: "_tasks",
          path: r.path,
          title: r.title,
          size: r.size,
          createdAt: r.modified_at,
        }));

        for (const queued of queuedTaskOutputs) {
          outputs.push({
            collection: "_tasks",
            path: queued.path,
            title: queued.title,
            size: Buffer.byteLength(queued.content, "utf-8"),
            createdAt: new Date(queued.enqueuedAt).toISOString(),
          });
        }

        for (const ref of refs.values()) {
          if (ref.collection === EDITABLE_COLLECTION) {
            const artifactDoc = getEditableArtifactDocument(store, ref.path);
            if (artifactDoc) {
              const persistedRow = store.db.prepare(`
                SELECT d.path, d.title, d.modified_at, LENGTH(c.doc) as size
                FROM documents d
                JOIN content c ON c.hash = d.hash
                WHERE d.collection = ? AND d.path = ? AND d.active = 1
                LIMIT 1
              `).get(ref.collection, artifactDoc.path) as
                | { path: string; title: string; modified_at: string; size: number }
                | undefined;
              const queuedRow = writeQueue.find((entry) =>
                entry.collection === EDITABLE_COLLECTION &&
                entry.op === "upsert" &&
                getEditableArtifactCandidatePaths(ref.path).includes(entry.path),
              );
              outputs.push({
                collection: ref.collection,
                path: stripEditableArtifactPrefix(artifactDoc.path),
                title: stripEditableArtifactPrefix(artifactDoc.path),
                size: persistedRow?.size ?? Buffer.byteLength(artifactDoc.doc.content, "utf-8"),
                createdAt: persistedRow?.modified_at ?? new Date(queuedRow?.enqueuedAt ?? Date.now()).toISOString(),
              });
            }
            continue;
          }

          const row = store.db.prepare(`
            SELECT d.path, d.title, d.modified_at, LENGTH(c.doc) as size
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = ? AND d.path = ? AND d.active = 1
            LIMIT 1
          `).get(ref.collection, ref.path) as
            | { path: string; title: string; modified_at: string; size: number }
            | undefined;
          if (row) {
            outputs.push({
              collection: ref.collection,
              path: row.path,
              title: row.title,
              size: row.size,
              createdAt: row.modified_at,
            });
            continue;
          }
          const queued = writeQueue.find((entry) =>
            entry.collection === ref.collection &&
            entry.op === "upsert" &&
            entry.path === ref.path,
          );
          if (!queued) continue;
          outputs.push({
            collection: ref.collection,
            path: queued.path,
            title: queued.title,
            size: Buffer.byteLength(queued.content, "utf-8"),
            createdAt: new Date(queued.enqueuedAt).toISOString(),
          });
        }

        const deduped = new Map<string, { collection: string; path: string; title: string; size: number; createdAt: string }>();
        for (const output of outputs) {
          deduped.set(`${output.collection}:${output.path}`, output);
        }

        return Array.from(deduped.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      }

      async function upsertTaskGeneratedOutput(
        taskId: string,
        fileName: string,
        content: string,
      ): Promise<string | null> {
        const outputPath = `${taskId}/outputs/${fileName}`;
        const normalizedContent = content.replace(/\r\n/g, "\n").trim();
        if (!normalizedContent) return null;
        const now = new Date().toISOString();
        const finalContent = normalizedContent.endsWith("\n") ? normalizedContent : `${normalizedContent}\n`;
        const hash = await hashContent(finalContent);
        store.insertContent(hash, finalContent, now);
        const existing = store.findActiveDocument("_tasks", outputPath);
        if (existing) {
          store.updateDocument(existing.id, outputPath, hash, now);
        } else {
          store.insertDocument("_tasks", outputPath, outputPath, hash, now, now);
        }
        return outputPath;
      }

      function buildTaskGeneratedOutputFileName(isoTimestamp: string): string {
        const safeBase = isoTimestamp
          .replace(/\.\d+Z$/, "Z")
          .replace(/[-:]/g, "")
          .replace("T", "-")
          .replace("Z", "")
          .slice(0, 15);
        return `run-${safeBase || "latest"}.md`;
      }

      type HttpFlowTrigger = {
        channels?: string[];
        accountIds?: string[];
        senders?: string[];
        conversationIds?: string[];
      };

      type HttpFlowVarValue = string | number | boolean;

      type HttpFlowDoc = {
        id: string;
        enabled: boolean;
        kind: "inbound_message";
        name: string;
        priority: number;
        trigger: HttpFlowTrigger;
        vars: Record<string, HttpFlowVarValue>;
        instruction: string;
        updatedAt?: string;
        graph?: Record<string, unknown>;
        schedule?: HttpFlowSchedule;
      };

      type HttpFlowRunTrigger = "scheduled" | "manual_test" | "manual_apply";
      type HttpFlowRunStatus = "ok" | "error";

      type HttpFlowRunRecord = {
        id: string;
        flowId: string;
        flowName: string;
        agentId: string;
        trigger: HttpFlowRunTrigger;
        mode: "dry_run" | "apply";
        status: HttpFlowRunStatus;
        startedAt: string;
        completedAt: string;
        durationMs: number;
        channel: string;
        message: string;
        sender?: string;
        accountId?: string;
        conversationId?: string;
        to?: string;
        summary?: string;
        error?: string;
        usage?: AgentLatestUsageSummary;
      };

      function normalizeFlowText(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      }

      function normalizeFlowStringArray(value: unknown): string[] | undefined {
        if (typeof value === "string") {
          const single = normalizeFlowText(value);
          return single ? [single] : undefined;
        }
        if (!Array.isArray(value)) return undefined;
        const next = value
          .map((entry) => normalizeFlowText(entry))
          .filter((entry): entry is string => Boolean(entry));
        return next.length > 0 ? next : undefined;
      }

      function normalizeFlowId(raw: unknown): string | null {
        if (typeof raw !== "string") return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const segments = trimmed
          .replace(/\\/g, "/")
          .split("/")
          .map((segment) =>
            segment
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9._-]+/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, ""),
          )
          .filter(Boolean);
        if (segments.length === 0) return null;
        return segments.join("/");
      }

      function flowPathFromId(flowId: string): string {
        return flowId.endsWith(".json") ? flowId : `${flowId}.json`;
      }

      function flowIdFromPath(path: string): string {
        return path.replace(/\.json$/i, "");
      }

      function flowRunPath(flowId: string, startedAt: string, runId: string): string {
        const safeStartedAt = startedAt.replace(/[:.]/g, "-");
        return `${flowId}/${safeStartedAt}-${runId}.json`;
      }

      function summarizeFlowRunResult(result: unknown): string | undefined {
        if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
        const raw = result as Record<string, unknown>;
        const counts =
          raw.counts && typeof raw.counts === "object" && !Array.isArray(raw.counts)
            ? (raw.counts as Record<string, unknown>)
            : null;
        const finalPayloads = Array.isArray(raw.finalPayloads) ? raw.finalPayloads.length : 0;
        const toolResults = Array.isArray(raw.toolResults) ? raw.toolResults.length : 0;
        const vaultMutations = Array.isArray(raw.vaultMutations) ? raw.vaultMutations.length : 0;
        const messageActions = Array.isArray(raw.messageActions) ? raw.messageActions.length : 0;
        const parts: string[] = [];
        if (counts && typeof counts.matched === "number") {
          parts.push(`matched=${counts.matched}`);
        }
        if (finalPayloads > 0) parts.push(`payloads=${finalPayloads}`);
        if (toolResults > 0) parts.push(`tools=${toolResults}`);
        if (vaultMutations > 0) parts.push(`vault=${vaultMutations}`);
        if (messageActions > 0) parts.push(`messages=${messageActions}`);
        return parts.length > 0 ? parts.join(" | ") : undefined;
      }

      async function persistFlowRunRecord(run: HttpFlowRunRecord): Promise<void> {
        const now = run.completedAt || new Date().toISOString();
        const path = flowRunPath(run.flowId, run.startedAt, run.id);
        const content = `${JSON.stringify(run, null, 2)}\n`;
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);
        const existing = store.findActiveDocument("_flow_runs", path);
        if (existing) {
          store.updateDocument(existing.id, path, hash, now);
        } else {
          store.insertDocument("_flow_runs", path, path, hash, run.startedAt, now);
        }
      }

      function parseStoredFlowRunDoc(path: string, raw: string, updatedAt?: string): HttpFlowRunRecord | null {
        let parsed: Record<string, unknown>;
        try {
          const value = JSON.parse(raw) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value)) return null;
          parsed = value as Record<string, unknown>;
        } catch {
          return null;
        }
        const flowId = normalizeFlowId(parsed.flowId) ?? flowIdFromPath(path.split("/").slice(0, -1).join("/"));
        if (!flowId) return null;
        const startedAt = normalizeFlowText(parsed.startedAt);
        const completedAt = normalizeFlowText(parsed.completedAt);
        const trigger = normalizeFlowText(parsed.trigger);
        const mode = normalizeFlowText(parsed.mode);
        const status = normalizeFlowText(parsed.status);
        const id = normalizeFlowText(parsed.id);
        const flowName = normalizeFlowText(parsed.flowName);
        const agentId = normalizeFlowText(parsed.agentId);
        const channel = normalizeFlowText(parsed.channel);
        const message = typeof parsed.message === "string" ? parsed.message : "";
        if (
          !startedAt ||
          !completedAt ||
          !id ||
          !flowName ||
          !agentId ||
          !channel ||
          !message ||
          (trigger !== "scheduled" && trigger !== "manual_test" && trigger !== "manual_apply") ||
          (mode !== "dry_run" && mode !== "apply") ||
          (status !== "ok" && status !== "error")
        ) {
          return null;
        }
        const durationMsRaw = parsed.durationMs;
        const durationMs =
          typeof durationMsRaw === "number" && Number.isFinite(durationMsRaw)
            ? Math.max(0, Math.round(durationMsRaw))
            : 0;
        return {
          id,
          flowId,
          flowName,
          agentId,
          trigger,
          mode,
          status,
          startedAt,
          completedAt,
          durationMs,
          channel,
          message,
          ...(typeof parsed.sender === "string" && parsed.sender.trim() ? { sender: parsed.sender.trim() } : {}),
          ...(typeof parsed.accountId === "string" && parsed.accountId.trim() ? { accountId: parsed.accountId.trim() } : {}),
          ...(typeof parsed.conversationId === "string" && parsed.conversationId.trim() ? { conversationId: parsed.conversationId.trim() } : {}),
          ...(typeof parsed.to === "string" && parsed.to.trim() ? { to: parsed.to.trim() } : {}),
          ...(typeof parsed.summary === "string" && parsed.summary.trim() ? { summary: parsed.summary.trim() } : {}),
          ...(typeof parsed.error === "string" && parsed.error.trim() ? { error: parsed.error.trim() } : {}),
          ...(parsed.usage && typeof parsed.usage === "object" && !Array.isArray(parsed.usage)
            ? { usage: parsed.usage as AgentLatestUsageSummary }
            : {}),
        };
      }

      function normalizeFlowVars(value: unknown): Record<string, HttpFlowVarValue> {
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        const out: Record<string, HttpFlowVarValue> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          const normalizedKey = normalizeFlowText(key);
          if (!normalizedKey) continue;
          if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
            out[normalizedKey] = entry;
          }
        }
        return out;
      }

      function parseStoredFlowDoc(path: string, raw: string, updatedAt?: string): HttpFlowDoc | null {
        let parsed: Record<string, unknown>;
        try {
          const value = JSON.parse(raw) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value)) return null;
          parsed = value as Record<string, unknown>;
        } catch {
          return null;
        }

        const flowId = normalizeFlowId(parsed.id) ?? flowIdFromPath(path);
        const name = normalizeFlowText(parsed.name) ?? flowId;
        const instruction =
          normalizeFlowText(parsed.instruction) ??
          normalizeFlowText(parsed.instructions) ??
          normalizeFlowText(parsed.prompt);
        if (!instruction) return null;

        const triggerRaw =
          parsed.trigger && typeof parsed.trigger === "object" && !Array.isArray(parsed.trigger)
            ? (parsed.trigger as Record<string, unknown>)
            : {};
        const priorityRaw = parsed.priority;
        const priority =
          typeof priorityRaw === "number" && Number.isFinite(priorityRaw) ? Math.trunc(priorityRaw) : 0;

        return {
          id: flowId,
          enabled: parsed.enabled !== false,
          kind: "inbound_message",
          name,
          priority,
          trigger: {
            channels:
              normalizeFlowStringArray(triggerRaw.channel) ??
              normalizeFlowStringArray(triggerRaw.channels),
            accountIds:
              normalizeFlowStringArray(triggerRaw.accountId) ??
              normalizeFlowStringArray(triggerRaw.accountIds),
            senders:
              normalizeFlowStringArray(triggerRaw.sender) ??
              normalizeFlowStringArray(triggerRaw.senders),
            conversationIds:
              normalizeFlowStringArray(triggerRaw.conversationId) ??
              normalizeFlowStringArray(triggerRaw.conversationIds),
          },
          vars: normalizeFlowVars(parsed.vars),
          instruction,
          updatedAt,
          schedule: normalizeFlowSchedule(parsed.schedule),
          graph:
            parsed.graph && typeof parsed.graph === "object" && !Array.isArray(parsed.graph)
              ? (parsed.graph as Record<string, unknown>)
              : undefined,
        };
      }

      function serializeFlowDoc(flow: HttpFlowDoc): string {
        return `${JSON.stringify(
          {
            enabled: flow.enabled,
            kind: flow.kind,
            id: flow.id,
            name: flow.name,
            priority: flow.priority,
            trigger: flow.trigger,
            vars: flow.vars,
            instruction: flow.instruction,
            ...(flow.schedule ? { schedule: flow.schedule } : {}),
            ...(flow.graph ? { graph: flow.graph } : {}),
          },
          null,
          2,
        )}\n`;
      }

      function normalizeIncomingFlowDoc(idRaw: string, payload: unknown): HttpFlowDoc {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("Flow body must be a JSON object");
        }
        const body = payload as Record<string, unknown>;
        const id = normalizeFlowId(idRaw);
        if (!id) {
          throw new Error("Flow id is required");
        }
        const name = normalizeFlowText(body.name);
        if (!name) {
          throw new Error("Flow name is required");
        }
        const instruction = normalizeFlowText(body.instruction);
        if (!instruction) {
          throw new Error("Flow instruction is required");
        }

        const triggerRaw =
          body.trigger && typeof body.trigger === "object" && !Array.isArray(body.trigger)
            ? (body.trigger as Record<string, unknown>)
            : {};

        const priorityRaw = body.priority;
        const priority =
          typeof priorityRaw === "number"
            ? Math.trunc(priorityRaw)
            : typeof priorityRaw === "string" && priorityRaw.trim()
              ? Number.parseInt(priorityRaw.trim(), 10)
              : 0;
        if (!Number.isFinite(priority)) {
          throw new Error("Flow priority must be a number");
        }

        return {
          id,
          enabled: body.enabled !== false,
          kind: "inbound_message",
          name,
          priority,
          trigger: {
            channels:
              normalizeFlowStringArray(triggerRaw.channel) ??
              normalizeFlowStringArray(triggerRaw.channels),
            accountIds:
              normalizeFlowStringArray(triggerRaw.accountId) ??
              normalizeFlowStringArray(triggerRaw.accountIds),
            senders:
              normalizeFlowStringArray(triggerRaw.sender) ??
              normalizeFlowStringArray(triggerRaw.senders),
            conversationIds:
              normalizeFlowStringArray(triggerRaw.conversationId) ??
              normalizeFlowStringArray(triggerRaw.conversationIds),
          },
          vars: normalizeFlowVars(body.vars),
          instruction,
          schedule: normalizeFlowSchedule(body.schedule),
          graph:
            body.graph && typeof body.graph === "object" && !Array.isArray(body.graph)
              ? (body.graph as Record<string, unknown>)
              : undefined,
        };
      }

      type HttpScheduleMode = "off" | "every" | "daily" | "once" | "cron";

      type HttpTaskSchedule = {
        mode: HttpScheduleMode;
        cronJobId?: string;
        everyMinutes?: number;
        everyUnit?: "minutes" | "hours";
        dailyTime?: string;
        onceAt?: string;
        timezone?: string;
        cronExpr?: string;
      };

      type HttpFlowSchedule = HttpTaskSchedule & {
        agentId?: string;
        channel?: string;
        message?: string;
        sender?: string;
        accountId?: string;
        conversationId?: string;
        to?: string;
      };

      function normalizeScheduleMode(value: unknown): HttpScheduleMode {
        const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
        if (trimmed === "every" || trimmed === "daily" || trimmed === "once" || trimmed === "cron") {
          return trimmed;
        }
        return "off";
      }

      function normalizeScheduleCronJobId(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      }

      function normalizeScheduleTimezone(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      }

      function normalizeScheduleDailyTime(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : undefined;
      }

      function normalizeScheduleCronExpr(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      }

      function normalizeScheduleOnceAt(value: unknown): string | undefined {
        if (typeof value !== "string" || !value.trim()) {
          return undefined;
        }
        const parsed = new Date(value.trim());
        if (Number.isNaN(parsed.getTime())) {
          return undefined;
        }
        return parsed.toISOString();
      }

      function normalizeScheduleEveryMinutes(value: unknown): number | undefined {
        const parsed =
          typeof value === "number"
            ? value
            : typeof value === "string" && value.trim()
              ? Number.parseFloat(value.trim())
              : Number.NaN;
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return undefined;
        }
        return Math.max(1, Math.round(parsed));
      }

      function normalizeScheduleEveryUnit(value: unknown): "minutes" | "hours" | undefined {
        const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
        return trimmed === "minutes" || trimmed === "hours" ? trimmed : undefined;
      }

      function normalizeTaskSchedule(value: unknown): HttpTaskSchedule | undefined {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const raw = value as Record<string, unknown>;
        const mode = normalizeScheduleMode(raw.mode);
        if (mode === "off") {
          return { mode: "off", ...(normalizeScheduleCronJobId(raw.cronJobId) ? { cronJobId: normalizeScheduleCronJobId(raw.cronJobId) } : {}) };
        }
        const schedule: HttpTaskSchedule = {
          mode,
          ...(normalizeScheduleCronJobId(raw.cronJobId) ? { cronJobId: normalizeScheduleCronJobId(raw.cronJobId) } : {}),
        };
        if (mode === "every") {
          const everyMinutes =
            normalizeScheduleEveryMinutes(raw.everyMinutes) ??
            (() => {
              const hours = normalizeScheduleEveryMinutes(raw.everyHours);
              return hours ? hours * 60 : undefined;
            })();
          if (!everyMinutes) {
            throw new Error("Scheduled interval must be a positive number of minutes");
          }
          schedule.everyMinutes = everyMinutes;
          schedule.everyUnit =
            normalizeScheduleEveryUnit(raw.everyUnit) ??
            (everyMinutes % 60 === 0 ? "hours" : "minutes");
        }
        if (mode === "daily") {
          const dailyTime = normalizeScheduleDailyTime(raw.dailyTime);
          if (!dailyTime) {
            throw new Error("Daily schedule requires time in HH:MM format");
          }
          schedule.dailyTime = dailyTime;
          schedule.timezone =
            normalizeScheduleTimezone(raw.timezone) ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            "UTC";
        }
        if (mode === "once") {
          const onceAt = normalizeScheduleOnceAt(raw.onceAt);
          if (!onceAt) {
            throw new Error("One-off schedule requires a valid run date and time");
          }
          schedule.onceAt = onceAt;
        }
        if (mode === "cron") {
          const cronExpr = normalizeScheduleCronExpr(raw.cronExpr);
          if (!cronExpr) {
            throw new Error("Custom cron schedule requires a cron expression");
          }
          schedule.cronExpr = cronExpr;
          const timezone = normalizeScheduleTimezone(raw.timezone);
          if (timezone) {
            schedule.timezone = timezone;
          }
        }
        return schedule;
      }

      function normalizeFlowSchedule(value: unknown): HttpFlowSchedule | undefined {
        const base = normalizeTaskSchedule(value);
        if (!base) return undefined;
        if (!value || typeof value !== "object" || Array.isArray(value)) return base;
        const raw = value as Record<string, unknown>;
        return {
          ...base,
          ...(typeof raw.agentId === "string" && raw.agentId.trim() ? { agentId: raw.agentId.trim() } : {}),
          ...(typeof raw.channel === "string" && raw.channel.trim() ? { channel: raw.channel.trim() } : {}),
          ...(typeof raw.message === "string" && raw.message.trim() ? { message: raw.message.trim() } : {}),
          ...(typeof raw.sender === "string" && raw.sender.trim() ? { sender: raw.sender.trim() } : {}),
          ...(typeof raw.accountId === "string" && raw.accountId.trim() ? { accountId: raw.accountId.trim() } : {}),
          ...(typeof raw.conversationId === "string" && raw.conversationId.trim() ? { conversationId: raw.conversationId.trim() } : {}),
          ...(typeof raw.to === "string" && raw.to.trim() ? { to: raw.to.trim() } : {}),
        };
      }

      function mergeTaskSchedule(
        existing: HttpTaskSchedule | undefined,
        incoming: HttpTaskSchedule | undefined,
      ): HttpTaskSchedule | undefined {
        if (!incoming) return existing;
        if (incoming.mode === "off") {
          return {
            mode: "off",
            ...(incoming.cronJobId ? { cronJobId: incoming.cronJobId } : existing?.cronJobId ? { cronJobId: existing.cronJobId } : {}),
          };
        }
        return {
          ...(existing ?? { mode: incoming.mode }),
          ...incoming,
          cronJobId: incoming.cronJobId ?? existing?.cronJobId,
        };
      }

      function mergeFlowSchedule(
        existing: HttpFlowSchedule | undefined,
        incoming: HttpFlowSchedule | undefined,
      ): HttpFlowSchedule | undefined {
        const merged = mergeTaskSchedule(existing, incoming);
        if (!merged) return undefined;
        if (merged.mode === "off") {
          return {
            ...merged,
            ...(incoming?.agentId ? { agentId: incoming.agentId } : existing?.agentId ? { agentId: existing.agentId } : {}),
          };
        }
        return {
          ...(existing ?? { mode: merged.mode }),
          ...merged,
          ...(incoming?.agentId ? { agentId: incoming.agentId } : existing?.agentId ? { agentId: existing.agentId } : {}),
          ...(incoming?.channel ? { channel: incoming.channel } : existing?.channel ? { channel: existing.channel } : {}),
          ...(incoming?.message ? { message: incoming.message } : existing?.message ? { message: existing.message } : {}),
          ...(incoming?.sender ? { sender: incoming.sender } : existing?.sender ? { sender: existing.sender } : {}),
          ...(incoming?.accountId ? { accountId: incoming.accountId } : existing?.accountId ? { accountId: existing.accountId } : {}),
          ...(incoming?.conversationId ? { conversationId: incoming.conversationId } : existing?.conversationId ? { conversationId: existing.conversationId } : {}),
          ...(incoming?.to ? { to: incoming.to } : existing?.to ? { to: existing.to } : {}),
        };
      }

      function buildGatewayCronSchedule(schedule: HttpTaskSchedule): Record<string, unknown> {
        if (schedule.mode === "every") {
          return {
            kind: "every",
            everyMs: Math.max(1, (schedule.everyMinutes ?? 60) * 60 * 1000),
          };
        }
        if (schedule.mode === "daily") {
          const [hourText = "09", minuteText = "00"] = String(schedule.dailyTime ?? "09:00").split(":");
          const hour = Math.max(0, Math.min(23, Number.parseInt(hourText, 10) || 0));
          const minute = Math.max(0, Math.min(59, Number.parseInt(minuteText, 10) || 0));
          return {
            kind: "cron",
            expr: `${minute} ${hour} * * *`,
            ...(schedule.timezone ? { tz: schedule.timezone } : {}),
          };
        }
        if (schedule.mode === "once") {
          return {
            kind: "at",
            at: schedule.onceAt,
          };
        }
        if (schedule.mode === "cron") {
          return {
            kind: "cron",
            expr: schedule.cronExpr,
            ...(schedule.timezone ? { tz: schedule.timezone } : {}),
          };
        }
        throw new Error("Cannot build cron schedule for disabled schedule");
      }

      function buildVaultScheduledRequestPayload(pathname: string, summary: string): Record<string, unknown> {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (httpAdminToken) {
          headers.Authorization = `Bearer ${httpAdminToken}`;
        }
        return {
          kind: "httpRequest",
          url: `http://127.0.0.1:${port}${pathname}`,
          method: "POST",
          headers,
          summary,
          timeoutSeconds: 120,
          allowPrivateNetwork: true,
        };
      }

      function schedulesEqual(a: unknown, b: unknown): boolean {
        return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      }

      async function removeLinkedCronJob(agent: AgentConnectionConfig | undefined, cronJobId: string | undefined): Promise<void> {
        if (!agent || !cronJobId) return;
        const gwToken = agent.gatewayToken || agent.token;
        if (!agent.gatewayUrl || !gwToken) return;
        try {
          await agentGatewayRpc(agent.gatewayUrl, gwToken, "cron.remove", { id: cronJobId });
        } catch {
          // ignore cleanup failures for stale/missing jobs
        }
      }

      async function syncTaskCronJob(params: {
        agent: AgentConnectionConfig | undefined;
        task: {
          id: string;
          title: string;
          instruction: string;
          agentId: string;
          schedule?: HttpTaskSchedule;
        };
      }): Promise<HttpTaskSchedule | undefined> {
        const schedule = params.task.schedule;
        const agent = params.agent;
        if (!schedule || schedule.mode === "off") {
          await removeLinkedCronJob(agent, schedule?.cronJobId);
          return schedule && schedule.cronJobId ? { mode: "off" } : schedule;
        }
        if (!agent || !agent.enabled) {
          throw new Error("Scheduled tasks require a valid enabled agent");
        }
        const gwToken = agent.gatewayToken || agent.token;
        if (!agent.gatewayUrl || !gwToken) {
          throw new Error("Agent gateway token is missing");
        }
        const cronInput = {
          name: `Task: ${params.task.title}`,
          description: `Scheduled Vault task template ${params.task.id}`,
          enabled: true,
          sessionTarget: "isolated",
          wakeMode: "next-heartbeat",
          schedule: buildGatewayCronSchedule(schedule),
          payload: buildVaultScheduledRequestPayload(
            `/tasks/${encodeURIComponent(params.task.id)}/run`,
            `Scheduled task: ${params.task.title}`,
          ),
          delivery: { mode: "none" },
        };
        const result = await upsertScheduledCronJob({
          existingCronJobId: schedule.cronJobId,
          update: async (id) =>
            await agentGatewayRpc(agent.gatewayUrl, gwToken, "cron.update", {
              id,
              patch: cronInput,
            }) as { id?: string },
          add: async () =>
            await agentGatewayRpc(agent.gatewayUrl, gwToken, "cron.add", cronInput) as {
              id?: string;
            },
        });
        const cronJobId = typeof result?.id === "string" && result.id.trim()
          ? result.id.trim()
          : schedule.cronJobId;
        return cronJobId ? { ...schedule, cronJobId } : schedule;
      }

      async function syncFlowCronJob(params: {
        flow: HttpFlowDoc;
        schedule?: HttpFlowSchedule;
      }): Promise<HttpFlowSchedule | undefined> {
        const schedule = params.schedule;
        if (!schedule || schedule.mode === "off") {
          const config = getAgentsConfig();
          const cleanupAgent = config.agents.find((entry) => entry.id === schedule?.agentId);
          await removeLinkedCronJob(cleanupAgent, schedule?.cronJobId);
          return schedule && schedule.cronJobId ? { mode: "off" } : schedule;
        }
        const config = getAgentsConfig();
        const agentId = schedule.agentId?.trim();
        const agent = config.agents.find((entry) => entry.id === agentId && entry.enabled);
        if (!agent) {
          throw new Error("Scheduled flows require a valid enabled agent");
        }
        const gwToken = agent.gatewayToken || agent.token;
        if (!agent.gatewayUrl || !gwToken) {
          throw new Error("Agent gateway token is missing");
        }
        const channel = schedule.channel?.trim() || "whatsapp";
        const message = schedule.message?.trim() || `Run scheduled flow: ${params.flow.name}`;
        const cronInput = {
          name: `Flow: ${params.flow.name}`,
          description: `Scheduled Vault flow ${params.flow.id}`,
          enabled: true,
          sessionTarget: "isolated",
          wakeMode: "next-heartbeat",
          schedule: buildGatewayCronSchedule(schedule),
          payload: buildVaultScheduledRequestPayload(
            `/flows/${encodeURIComponent(params.flow.id)}/run`,
            `Scheduled flow: ${params.flow.name}`,
          ),
          delivery: { mode: "none" },
        };
        const result = await upsertScheduledCronJob({
          existingCronJobId: schedule.cronJobId,
          update: async (id) =>
            await agentGatewayRpc(agent.gatewayUrl, gwToken, "cron.update", {
              id,
              patch: cronInput,
            }) as { id?: string },
          add: async () =>
            await agentGatewayRpc(agent.gatewayUrl, gwToken, "cron.add", cronInput) as {
              id?: string;
            },
        });
        const cronJobId = typeof result?.id === "string" && result.id.trim()
          ? result.id.trim()
          : schedule.cronJobId;
        return {
          ...schedule,
          agentId: agent.id,
          channel,
          message,
          ...(cronJobId ? { cronJobId } : {}),
        };
      }

      async function listScheduledTaskMetas(): Promise<
        Array<Record<string, unknown> & {
          id: string;
          title: string;
          instruction: string;
          agentId: string;
          schedule: HttpTaskSchedule;
        }>
      > {
        const activeStore = mountedStore;
        if (!activeStore) {
          return [];
        }
        const rows = activeStore.db.prepare(`
          SELECT d.path, c.doc
          FROM documents d
          JOIN content c ON c.hash = d.hash
          WHERE d.collection = '_tasks' AND d.active = 1 AND d.path LIKE '%/meta.json'
          ORDER BY d.modified_at DESC, d.path ASC
        `).all() as Array<{ path: string; doc: string }>;
        const tasks: Array<Record<string, unknown> & {
          id: string;
          title: string;
          instruction: string;
          agentId: string;
          schedule: HttpTaskSchedule;
        }> = [];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.doc) as Record<string, unknown>;
            const schedule = normalizeTaskSchedule(parsed.schedule);
            if (!schedule || schedule.mode === "off") {
              continue;
            }
            if (
              typeof parsed.id !== "string" ||
              typeof parsed.title !== "string" ||
              typeof parsed.instruction !== "string" ||
              typeof parsed.agentId !== "string"
            ) {
              continue;
            }
            tasks.push({
              ...parsed,
              id: parsed.id,
              title: parsed.title,
              instruction: parsed.instruction,
              agentId: parsed.agentId,
              schedule,
            });
          } catch {
            // Ignore malformed task records during reconcile.
          }
        }
        return tasks;
      }

      async function listScheduledFlows(): Promise<HttpFlowDoc[]> {
        const activeStore = mountedStore;
        if (!activeStore) {
          return [];
        }
        const rows = activeStore.db.prepare(`
          SELECT d.path, c.doc, d.modified_at
          FROM documents d
          JOIN content c ON c.hash = d.hash
          WHERE d.collection = '_flows' AND d.active = 1 AND d.path LIKE '%.json'
          ORDER BY d.modified_at DESC, d.path ASC
        `).all() as Array<{ path: string; doc: string; modified_at: string }>;
        return rows
          .map((row) => parseStoredFlowDoc(row.path, row.doc, row.modified_at))
          .filter((flow): flow is HttpFlowDoc => Boolean(flow?.schedule && flow.schedule.mode !== "off"));
      }

      async function runScheduledCronReconcile(reason: string): Promise<void> {
        if (scheduleReconcileInFlight || !mountedStore || isVaultLocked(store.dbPath)) {
          return;
        }
        scheduleReconcileInFlight = true;
        try {
          const tasks = await listScheduledTaskMetas();
          const flows = await listScheduledFlows();
          const summary = await reconcileScheduledEntries({
            tasks,
            flows,
            hasActiveTaskSchedule: (task) => Boolean(task.schedule && task.schedule.mode !== "off"),
            hasActiveFlowSchedule: (flow) => Boolean(flow.schedule && flow.schedule.mode !== "off"),
            syncTask: async (task) => {
              const config = getAgentsConfig();
              const agent = config.agents.find((entry) => entry.id === task.agentId);
              const nextSchedule = await syncTaskCronJob({ agent, task });
              const nextTask = nextSchedule ? { ...task, schedule: nextSchedule } : task;
              return {
                item: nextTask,
                changed: !schedulesEqual(task.schedule, nextTask.schedule),
              };
            },
            syncFlow: async (flow) => {
              const nextSchedule = await syncFlowCronJob({ flow, schedule: flow.schedule });
              const nextFlow = nextSchedule ? { ...flow, schedule: nextSchedule } : flow;
              return {
                item: nextFlow,
                changed: !schedulesEqual(flow.schedule, nextFlow.schedule),
              };
            },
            persistTask: async (task) => {
              await persistTaskMeta({ taskId: task.id, meta: task });
            },
            persistFlow: async (flow) => {
              if (!flow.schedule) {
                return;
              }
              await persistFlowSchedule({ flow, schedule: flow.schedule });
            },
            isRetryableError: isRetryableScheduleReconcileError,
          });
          log(
            `${ts()} schedule-reconcile (${reason}) tasks=${summary.tasksAttempted} flows=${summary.flowsAttempted} updated=${summary.tasksUpdated + summary.flowsUpdated} retryableFailures=${summary.retryableFailures} nonRetryableFailures=${summary.nonRetryableFailures}`,
          );
          if (summary.retryableFailures > 0) {
            scheduleCronReconcile("retry-after-transient-failure", SCHEDULE_RECONCILE_RETRY_MS);
          }
        } finally {
          scheduleReconcileInFlight = false;
        }
      }

      async function persistTaskMetaSchedule(params: {
        taskId: string;
        meta: Record<string, unknown>;
        schedule: HttpTaskSchedule;
      }): Promise<void> {
        const now = new Date().toISOString();
        const nextMeta = {
          ...params.meta,
          schedule: params.schedule,
          updatedAt: now,
        };
        const content = JSON.stringify(nextMeta, null, 2) + "\n";
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);
        const existing = store.findActiveDocument("_tasks", `${params.taskId}/meta.json`);
        if (existing) {
          store.updateDocument(existing.id, existing.title, hash, now);
        }
      }

      async function clearOneOffTaskSchedule(params: {
        taskId: string;
        meta: Record<string, unknown>;
      }): Promise<void> {
        const schedule = normalizeTaskSchedule(params.meta.schedule);
        if (!schedule || schedule.mode !== "once") {
          return;
        }
        const config = getAgentsConfig();
        const agentId =
          typeof params.meta.agentId === "string" && params.meta.agentId.trim()
            ? params.meta.agentId.trim()
            : "";
        const agent = config.agents.find((entry) => entry.id === agentId);
        await removeLinkedCronJob(agent, schedule.cronJobId);
        await persistTaskMetaSchedule({
          taskId: params.taskId,
          meta: params.meta,
          schedule: { mode: "off" },
        });
      }

      function buildTaskHookName(taskId: string, title: string): string {
        const trimmedTitle = title.trim();
        return trimmedTitle ? `Task ${taskId}: ${trimmedTitle}` : `Task ${taskId}`;
      }

      async function persistTaskMeta(params: {
        taskId: string;
        meta: Record<string, unknown>;
        now?: string;
      }): Promise<void> {
        const now = params.now ?? new Date().toISOString();
        const content = JSON.stringify(params.meta, null, 2) + "\n";
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);
        const existing = store.findActiveDocument("_tasks", `${params.taskId}/meta.json`);
        if (existing) {
          store.updateDocument(existing.id, existing.title, hash, now);
        }
      }

      async function appendTaskActivityEntry(params: {
        taskId: string;
        entry: {
          ts: string;
          type: string;
          summary: string;
          detail?: string;
          meta?: Record<string, unknown>;
        };
      }): Promise<void> {
        const line = JSON.stringify(params.entry) + "\n";
        const actDoc = store.getDocumentWithContent("_tasks", `${params.taskId}/activity.jsonl`);
        const updated = (actDoc?.content || "") + line;
        const actHash = await hashContent(updated);
        store.insertContent(actHash, updated, params.entry.ts);
        const ref = store.findActiveDocument("_tasks", `${params.taskId}/activity.jsonl`);
        if (ref) {
          store.updateDocument(ref.id, ref.title, actHash, params.entry.ts);
        } else {
          store.insertDocument(
            "_tasks",
            `${params.taskId}/activity.jsonl`,
            `${params.taskId}/activity.jsonl`,
            actHash,
            params.entry.ts,
            params.entry.ts,
          );
        }
      }

      async function dispatchExistingTaskToAgent(params: {
        taskId: string;
        meta: {
          id: string;
          title: string;
          instruction: string;
          agentId: string;
          status?: string;
          sessionKey?: string | null;
          currentRunStartedAt?: string | null;
          createdAt?: string;
          updatedAt?: string;
          completedAt?: string | null;
          error?: string | null;
          [key: string]: unknown;
        };
        message?: string;
        resetSessionLink?: boolean;
        appendScheduledDispatchNote?: boolean;
      }): Promise<{
        task: Record<string, unknown>;
        launchSucceeded: boolean;
      }> {
        const now = new Date().toISOString();
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === params.meta.agentId);
        const nextMeta: Record<string, unknown> = {
          ...params.meta,
          status: "running",
          updatedAt: now,
          completedAt: null,
          error: null,
          currentRunStartedAt: now,
          ...(params.resetSessionLink ? { sessionKey: null } : {}),
        };
        await persistTaskMeta({ taskId: params.taskId, meta: nextMeta, now });
        if (params.appendScheduledDispatchNote) {
          await appendTaskActivityEntry({
            taskId: params.taskId,
            entry: {
              ts: now,
              type: "status_change",
              summary: "Scheduled run started",
            },
          });
        }
        if (!agent || !agent.enabled) {
          const failedAt = new Date().toISOString();
          const failedMeta: Record<string, unknown> = {
            ...nextMeta,
            status: "failed",
            updatedAt: failedAt,
            completedAt: failedAt,
            error: `No enabled agent found for id "${params.meta.agentId}"`,
          };
          await persistTaskMeta({ taskId: params.taskId, meta: failedMeta, now: failedAt });
          await appendTaskActivityEntry({
            taskId: params.taskId,
            entry: {
              ts: failedAt,
              type: "error",
              summary: `No enabled agent found for id "${params.meta.agentId}"`,
            },
          });
          return { task: failedMeta, launchSucceeded: false };
        }

        const hookUrl = `${agent.gatewayUrl.replace(/\/+$/, "")}${normalizeAgentHookEndpointPath(agent.hooksPath)}`;
        let launchSucceeded = false;
        try {
          const resp = await fetch(hookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agent.token}`,
            },
            body: JSON.stringify({
              message: (typeof params.message === "string" && params.message.trim()
                ? params.message.trim()
                : params.meta.instruction.trim()),
              name: buildTaskHookName(params.taskId, params.meta.title),
              deliver: false,
              taskId: params.taskId,
              allowUnsafeExternalContent: true,
            }),
            signal: AbortSignal.timeout(30000),
          });
          const hookTs = new Date().toISOString();
          if (resp.ok) {
            launchSucceeded = true;
            await appendTaskActivityEntry({
              taskId: params.taskId,
              entry: {
                ts: hookTs,
                type: "status_change",
                summary: `Task dispatched to agent ${agent.name || agent.id}`,
              },
            });
            const refreshed = {
              ...nextMeta,
              updatedAt: hookTs,
            };
            await persistTaskMeta({ taskId: params.taskId, meta: refreshed, now: hookTs });
            return { task: refreshed, launchSucceeded: true };
          }

          const errBody = await resp.text().catch(() => "");
          const failedMeta: Record<string, unknown> = {
            ...nextMeta,
            status: "failed",
            updatedAt: hookTs,
            completedAt: hookTs,
            error: `Agent hook failed: ${resp.status}`,
          };
          await persistTaskMeta({ taskId: params.taskId, meta: failedMeta, now: hookTs });
          await appendTaskActivityEntry({
            taskId: params.taskId,
            entry: {
              ts: hookTs,
              type: "error",
              summary: `Agent hook failed (${resp.status})`,
              detail: errBody.slice(0, 500) || undefined,
            },
          });
          return { task: failedMeta, launchSucceeded: false };
        } catch (err: any) {
          const errTs = new Date().toISOString();
          const failedMeta: Record<string, unknown> = {
            ...nextMeta,
            status: "failed",
            updatedAt: errTs,
            completedAt: errTs,
            error: `Failed to reach agent: ${err?.message || "unknown error"}`,
          };
          await persistTaskMeta({ taskId: params.taskId, meta: failedMeta, now: errTs });
          await appendTaskActivityEntry({
            taskId: params.taskId,
            entry: {
              ts: errTs,
              type: "error",
              summary: `Failed to reach agent: ${err?.message || "unknown error"}`,
            },
          });
          return { task: failedMeta, launchSucceeded: false };
        }
      }

      async function persistFlowSchedule(params: {
        flow: HttpFlowDoc;
        schedule: HttpFlowSchedule;
      }): Promise<void> {
        const now = new Date().toISOString();
        const nextFlow: HttpFlowDoc = {
          ...params.flow,
          schedule: params.schedule,
          updatedAt: now,
        };
        const path = flowPathFromId(nextFlow.id);
        const content = serializeFlowDoc(nextFlow);
        const hash = await hashContent(content);
        store.insertContent(hash, content, now);
        const existing = store.findActiveDocument("_flows", path);
        if (existing) {
          store.updateDocument(existing.id, path, hash, now);
        } else {
          store.insertDocument("_flows", path, path, hash, now, now);
        }
      }

      async function clearOneOffFlowSchedule(flow: HttpFlowDoc): Promise<void> {
        const schedule = flow.schedule;
        if (!schedule || schedule.mode !== "once") {
          return;
        }
        const config = getAgentsConfig();
        const agentId = schedule.agentId?.trim() || "";
        const agent = config.agents.find((entry) => entry.id === agentId);
        await removeLinkedCronJob(agent, schedule.cronJobId);
        await persistFlowSchedule({
          flow,
          schedule: { mode: "off" },
        });
      }

      function normalizeEvalText(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      }

      function normalizeEvalBoolean(value: unknown): boolean {
        return value === true;
      }

      function normalizeEvalAssertionKeyList(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value
          .map((entry) => normalizeEvalText(entry))
          .filter((entry): entry is string => Boolean(entry));
      }

      function normalizeEvalModeForGateway(mode: EvalMode): "dry_run" | "apply" {
        return mode === "production" ? "apply" : "dry_run";
      }

      function resolveEvalTarget(params: {
        targetType: EvalCase["target_type"];
        targetId: string;
      }): { agent: AgentConnectionConfig | null; flow: HttpFlowDoc | null } {
        const config = getAgentsConfig();
        const defaultAgent = config.agents.find((entry) => entry.enabled) ?? config.agents[0] ?? null;
        if (params.targetType === "agent") {
          const exact = config.agents.find((entry) => entry.id === params.targetId);
          const fallback = params.targetId === "default" ? defaultAgent : null;
          return {
            agent: exact ?? fallback,
            flow: null,
          };
        }
        const path = flowPathFromId(params.targetId);
        const flowDoc = store.getDocumentWithContent("_flows", path);
        const flow = flowDoc?.content ? parseStoredFlowDoc(path, flowDoc.content) : null;
        return {
          agent: defaultAgent,
          flow,
        };
      }

      function validateEvalTargetExists(params: {
        targetType: EvalCase["target_type"];
        targetId: string;
      }): void {
        const { agent, flow } = resolveEvalTarget(params);
        if (params.targetType === "agent" && !agent) {
          throw new Error(`Agent target "${params.targetId}" was not found.`);
        }
        if (params.targetType === "flow" && !flow) {
          throw new Error(`Flow target "${params.targetId}" was not found.`);
        }
      }

      function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      async function waitForEvalTrace(
        sessionKey: string | undefined,
        startedAfter: string,
      ) {
        if (!sessionKey) return null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const trace = findTraceBySessionKey(store, sessionKey, startedAfter);
          if (trace) return trace;
          await sleep(250);
        }
        return null;
      }

      function extractEvalOutputPreview(traceId: string | undefined, execution?: EvalExecutionPayload): string | undefined {
        const texts: string[] = [];
        const push = (value: unknown) => {
          if (typeof value === "string" && value.trim()) {
            texts.push(value.trim());
          }
        };
        const walkPayload = (payload: unknown) => {
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
          const raw = payload as Record<string, unknown>;
          push(raw.text);
          push(raw.message);
          if (Array.isArray(raw.content)) {
            for (const entry of raw.content) {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
              const record = entry as Record<string, unknown>;
              push(record.text);
              push(record.content);
            }
          }
        };
        for (const payload of execution?.finalPayloads ?? []) walkPayload(payload);
        for (const payload of execution?.partialPayloads ?? []) walkPayload(payload);
        for (const payload of execution?.blockPayloads ?? []) walkPayload(payload);
        if (texts.length === 0 && traceId) {
          const detail = readOrchestrationTrace(store, traceId);
          for (const prompt of detail.prompts) {
            for (const text of prompt.assistantTexts ?? []) {
              push(text);
            }
          }
        }
        return texts[0] ? texts[0].slice(0, 400) : undefined;
      }

      function withSandboxWarning(status: EvalCaseStatus, warnings: string[]): EvalCaseStatus {
        if (warnings.length === 0) return status;
        if (status === "failed" || status === "error") return status;
        if (status === "skipped") return "warning";
        return "warning";
      }

      const EVAL_CASE_GATEWAY_TIMEOUT_MS = 1_800_000;

      async function executeEvalCase(params: {
        run: EvalRun;
        item: EvalCase;
      }): Promise<EvalCaseResult> {
        const caseStartedAt = new Date().toISOString();
        const warningReasons: string[] = [];
        const failureReasons: string[] = [];
        const { agent, flow } = resolveEvalTarget({
          targetType: params.item.target_type,
          targetId: params.item.target_id,
        });

        if (!agent) {
          const finishedAt = new Date().toISOString();
          return {
            id: `result.${params.run.id}.${params.item.id}`,
            run_id: params.run.id,
            case_id: params.item.id,
            status: "error",
            started_at: caseStartedAt,
            finished_at: finishedAt,
            duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(caseStartedAt)),
            failure_reasons: [`Target agent "${params.item.target_id}" was not found.`],
            warning_reasons: [],
            assertion_results: [],
            input: params.item.input_text,
            target: { type: params.item.target_type, id: params.item.target_id },
            mode: params.item.mode,
          };
        }
        if (params.item.target_type === "flow" && !flow) {
          const finishedAt = new Date().toISOString();
          return {
            id: `result.${params.run.id}.${params.item.id}`,
            run_id: params.run.id,
            case_id: params.item.id,
            status: "error",
            started_at: caseStartedAt,
            finished_at: finishedAt,
            duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(caseStartedAt)),
            failure_reasons: [`Target flow "${params.item.target_id}" was not found.`],
            warning_reasons: [],
            assertion_results: [],
            input: params.item.input_text,
            target: { type: params.item.target_type, id: params.item.target_id },
            mode: params.item.mode,
          };
        }
        if (params.item.mode === "sandbox") {
          warningReasons.push("Sandbox mode currently executes with dry-run safeguards in v1.");
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(getAgentsConfig());
        }
        const gwToken = agent.gatewayToken || agent.token;
        if (!gwToken) {
          const finishedAt = new Date().toISOString();
          return {
            id: `result.${params.run.id}.${params.item.id}`,
            run_id: params.run.id,
            case_id: params.item.id,
            status: "error",
            started_at: caseStartedAt,
            finished_at: finishedAt,
            duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(caseStartedAt)),
            failure_reasons: [`Agent "${agent.id}" is missing a gateway token.`],
            warning_reasons: warningReasons,
            assertion_results: [],
            input: params.item.input_text,
            target: { type: params.item.target_type, id: params.item.target_id },
            mode: params.item.mode,
          };
        }

        let execution: EvalExecutionPayload | undefined;
        let traceId: string | undefined;
        let startedTraceAt = caseStartedAt;
        try {
          execution = await agentGatewayRpc(
            agent.gatewayUrl,
            gwToken,
            "agents.flow.test",
            {
              agentId: agent.id,
              mode: normalizeEvalModeForGateway(params.item.mode),
              channel: "eval",
              message: params.item.input_text,
              ...(flow?.instruction ? { prependContextOverride: flow.instruction } : {}),
            },
            EVAL_CASE_GATEWAY_TIMEOUT_MS,
          ) as EvalExecutionPayload;
          const matchedTrace = await waitForEvalTrace(execution?.input?.sessionKey, startedTraceAt);
          traceId = matchedTrace?.traceId;
        } catch (err: any) {
          const finishedAt = new Date().toISOString();
          return {
            id: `result.${params.run.id}.${params.item.id}`,
            run_id: params.run.id,
            case_id: params.item.id,
            status: "error",
            started_at: caseStartedAt,
            finished_at: finishedAt,
            duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(caseStartedAt)),
            failure_reasons: [err?.message || "Eval execution failed."],
            warning_reasons: warningReasons,
            assertion_results: [],
            input: params.item.input_text,
            target: { type: params.item.target_type, id: params.item.target_id },
            mode: params.item.mode,
          };
        }

        const finishedAt = new Date().toISOString();
        const traceDetail = traceId ? readOrchestrationTrace(store, traceId) : { run: null, steps: [], prompts: [] };
        const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(caseStartedAt));
        const assertionResults = evaluateTraceAssertions(params.item.assertions, {
          run: traceDetail.run,
          steps: traceDetail.steps,
          prompts: traceDetail.prompts,
          execution,
          durationMs,
          mode: params.item.mode,
        });
        for (const result of assertionResults) {
          if (result.status === "failed" || result.status === "error") {
            failureReasons.push(result.message);
          } else if (result.status === "warning") {
            warningReasons.push(result.message);
          }
        }
        if (!traceId) {
          warningReasons.push("No orchestration trace could be correlated for this eval run.");
        }
        const tokens = traceDetail.prompts.reduce(
          (acc, prompt) => {
            acc.input += typeof prompt.usage?.input === "number" ? prompt.usage.input : 0;
            acc.output += typeof prompt.usage?.output === "number" ? prompt.usage.output : 0;
            acc.total += typeof prompt.usage?.total === "number" ? prompt.usage.total : 0;
            return acc;
          },
          { input: 0, output: 0, total: 0 },
        );
        const baseStatus = (() => {
          if (assertionResults.some((result) => result.status === "failed")) return "failed";
          if (assertionResults.some((result) => result.status === "error")) return "error";
          if (assertionResults.some((result) => result.status === "warning")) return "warning";
          if (assertionResults.length > 0 && assertionResults.every((result) => result.status === "skipped")) {
            return "skipped";
          }
          return "passed";
        })() satisfies EvalCaseStatus;
        return {
          id: `result.${params.run.id}.${params.item.id}`,
          run_id: params.run.id,
          case_id: params.item.id,
          status: withSandboxWarning(baseStatus, warningReasons),
          ...(traceId ? { trace_id: traceId } : {}),
          started_at: caseStartedAt,
          finished_at: finishedAt,
          duration_ms: durationMs,
          ...(tokens.input > 0 ? { input_tokens: tokens.input } : {}),
          ...(tokens.output > 0 ? { output_tokens: tokens.output } : {}),
          ...(tokens.total > 0 ? { total_tokens: tokens.total } : {}),
          failure_reasons: Array.from(new Set(failureReasons)),
          warning_reasons: Array.from(new Set(warningReasons)),
          assertion_results: assertionResults,
          input: params.item.input_text,
          ...(extractEvalOutputPreview(traceId, execution) ? { output_preview: extractEvalOutputPreview(traceId, execution) } : {}),
          target: { type: params.item.target_type, id: params.item.target_id },
          mode: params.item.mode,
          raw_trace_summary: {
            trace_id: traceId ?? null,
            route: traceDetail.run?.finalRoute ?? null,
            status: traceDetail.run?.status ?? null,
            assigned_agent_id: traceDetail.run?.assignedAgentId ?? agent.id,
            tool_call_count: Array.isArray(execution?.toolCalls) ? execution.toolCalls.length : undefined,
          },
        };
      }

      async function runEvalSuiteById(params: {
        suiteId: string;
        createdBy?: string;
        confirmProduction?: boolean;
      }): Promise<{ suite: EvalSuite; run: EvalRun; results: EvalCaseResult[] }> {
        const suite = readSuite(store, params.suiteId);
        if (!suite) {
          throw new Error("Suite not found");
        }
        const detail = getEvalSuiteDetail(store, suite.id);
        if (!detail) {
          throw new Error("Suite details not found");
        }
        const enabledCases = detail.cases.filter((item) => item.enabled);
        if (
          enabledCases.some((item) => item.mode === "production") &&
          !params.confirmProduction
        ) {
          throw new Error("This eval may call real tools and cause external side effects. Continue?");
        }
        const runMode = enabledCases.some((item) => item.mode === "production")
          ? "production"
          : enabledCases.some((item) => item.mode === "sandbox")
            ? "sandbox"
            : "dry_run";
        const run = createEvalRun(store, {
          suite_id: suite.id,
          total_cases: enabledCases.length,
          created_by: params.createdBy,
          mode: runMode,
        });
        const results: EvalCaseResult[] = [];
        for (const item of enabledCases) {
          const result = await executeEvalCase({ run, item });
          persistEvalCaseResult(store, result);
          results.push(result);
        }
        const finalized = finalizeEvalRun(store, {
          run,
          results,
          status: "completed",
        });
        return {
          suite,
          run: finalized,
          results,
        };
      }

      // GET /flows — list flow definitions
      if (pathname === "/flows" && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        try {
          const rows = (store.db.prepare(`
            SELECT d.path, c.doc, d.modified_at
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = '_flows' AND d.active = 1 AND d.path LIKE '%.json'
            ORDER BY d.modified_at DESC, d.path ASC
          `).all()) as { path: string; doc: string; modified_at: string }[];

          const flows = rows
            .map((row) => parseStoredFlowDoc(row.path, row.doc, row.modified_at))
            .filter((flow): flow is HttpFlowDoc => Boolean(flow))
            .sort((a, b) => {
              if (a.priority !== b.priority) return b.priority - a.priority;
              return a.name.localeCompare(b.name);
            });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ flows }));
          log(`${ts()} GET /flows → ${flows.length} flows (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list flows" }));
        }
        return;
      }

      const flowDetailMatch = pathname.match(/^\/flows\/(.+)$/);
      if (flowDetailMatch && nodeReq.method === "PUT") {
        const requestedId = decodeURIComponent(flowDetailMatch[1]!);
        const body = await collectBody(nodeReq);
        let params: unknown;
        try {
          params = JSON.parse(body || "{}");
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        try {
          const flow = normalizeIncomingFlowDoc(requestedId, params);
          const existingPath = flowPathFromId(flow.id);
          const existingFlowDoc = store.getDocumentWithContent("_flows", existingPath);
          const existingFlow = existingFlowDoc?.content
            ? parseStoredFlowDoc(existingPath, existingFlowDoc.content)
            : null;
          flow.schedule = mergeFlowSchedule(existingFlow?.schedule, flow.schedule);
          flow.schedule = await syncFlowCronJob({ flow, schedule: flow.schedule });
          const path = existingPath;
          const now = new Date().toISOString();
          const content = serializeFlowDoc(flow);
          const hash = await hashContent(content);
          store.insertContent(hash, content, now);
          const existing = store.findActiveDocument("_flows", path);
          if (existing) {
            store.updateDocument(existing.id, path, hash, now);
          } else {
            store.insertDocument("_flows", path, path, hash, now, now);
          }

          nodeRes.writeHead(existing ? 200 : 201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ flow: { ...flow, updatedAt: now } }));
          log(`${ts()} PUT /flows/${flow.id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Invalid flow definition" }));
        }
        return;
      }

      if (flowDetailMatch && nodeReq.method === "DELETE") {
        const requestedId = normalizeFlowId(decodeURIComponent(flowDetailMatch[1]!));
        if (!requestedId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid flow id" }));
          return;
        }
        const path = flowPathFromId(requestedId);
        const existing = store.findActiveDocument("_flows", path);
        if (!existing) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Flow not found" }));
          return;
        }
        const existingDoc = store.getDocumentWithContent("_flows", path);
        const parsedExisting = existingDoc?.content
          ? parseStoredFlowDoc(path, existingDoc.content)
          : null;
        if (parsedExisting?.schedule?.cronJobId) {
          const config = getAgentsConfig();
          const cleanupAgent = config.agents.find((entry) => entry.id === parsedExisting.schedule?.agentId);
          await removeLinkedCronJob(cleanupAgent, parsedExisting.schedule.cronJobId);
        }
        store.deactivateDocument("_flows", path);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ ok: true, id: requestedId }));
        log(`${ts()} DELETE /flows/${requestedId} (${Date.now() - reqStart}ms)`);
        return;
      }

      const flowRunsMatch = pathname.match(/^\/flows\/(.+)\/runs$/);
      if (flowRunsMatch && nodeReq.method === "GET") {
        const flowId = normalizeFlowId(decodeURIComponent(flowRunsMatch[1]!));
        if (!flowId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid flow id" }));
          return;
        }
        try {
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const limitRaw = Number.parseInt(reqUrl.searchParams.get("limit") || "25", 10);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25;
          const rows = (store.db.prepare(`
            SELECT d.path, c.doc, d.modified_at
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = '_flow_runs' AND d.active = 1 AND d.path LIKE ?
            ORDER BY d.modified_at DESC, d.path DESC
            LIMIT ?
          `).all(`${flowId}/%`, limit)) as { path: string; doc: string; modified_at: string }[];
          const runs = rows
            .map((row) => parseStoredFlowRunDoc(row.path, row.doc, row.modified_at))
            .filter((run): run is HttpFlowRunRecord => Boolean(run));
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ runs }));
          log(`${ts()} GET /flows/${flowId}/runs → ${runs.length} runs (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list flow runs" }));
        }
        return;
      }

      const flowRunMatch = pathname.match(/^\/flows\/(.+)\/run$/);
      if (flowRunMatch && nodeReq.method === "POST") {
        const flowId = normalizeFlowId(decodeURIComponent(flowRunMatch[1]!));
        if (!flowId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid flow id" }));
          return;
        }
        const path = flowPathFromId(flowId);
        const flowDoc = store.getDocumentWithContent("_flows", path);
        const flow = flowDoc?.content ? parseStoredFlowDoc(path, flowDoc.content) : null;
        if (!flow) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Flow not found" }));
          return;
        }
        const schedule = flow.schedule;
        if (!schedule || schedule.mode === "off") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Flow has no active schedule" }));
          return;
        }
        const config = getAgentsConfig();
        const agentId = schedule.agentId?.trim() || config.agents.find((entry) => entry.enabled)?.id || "";
        const agent = config.agents.find((entry) => entry.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        const gwToken = agent.gatewayToken || agent.token;
        if (!gwToken) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent gateway token is missing" }));
          return;
        }
        const runStartedAt = new Date().toISOString();
        const runBase: Omit<HttpFlowRunRecord, "status" | "completedAt" | "durationMs"> = {
          id: crypto.randomUUID().slice(0, 12),
          flowId: flow.id,
          flowName: flow.name,
          agentId: agent.id,
          trigger: "scheduled",
          mode: "apply",
          startedAt: runStartedAt,
          channel: schedule.channel?.trim() || "whatsapp",
          message: schedule.message?.trim() || `Run scheduled flow: ${flow.name}`,
          ...(schedule.sender ? { sender: schedule.sender } : {}),
          ...(schedule.accountId ? { accountId: schedule.accountId } : {}),
          ...(schedule.conversationId ? { conversationId: schedule.conversationId } : {}),
          ...(schedule.to ? { to: schedule.to } : {}),
        };
        const clearOneOffScheduleAfterRun = schedule.mode === "once";
        try {
          const result = await agentGatewayRpc(
            agent.gatewayUrl,
            gwToken,
            "agents.flow.test",
            {
              agentId: agent.id,
              mode: "apply",
              channel: runBase.channel,
              message: runBase.message,
              ...(schedule.sender ? { sender: schedule.sender } : {}),
              ...(schedule.accountId ? { accountId: schedule.accountId } : {}),
              ...(schedule.conversationId ? { conversationId: schedule.conversationId } : {}),
              ...(schedule.to ? { to: schedule.to } : {}),
              prependContextOverride: flow.instruction,
            },
            600_000,
          );
          const completedAt = new Date().toISOString();
          const usage = readLatestOpenClawUsageForAgentId(agent.id);
          await persistFlowRunRecord({
            ...runBase,
            status: "ok",
            completedAt,
            durationMs: Date.parse(completedAt) - Date.parse(runStartedAt),
            ...(summarizeFlowRunResult(result) ? { summary: summarizeFlowRunResult(result) } : {}),
            ...(usage ? { usage } : {}),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, result }));
          log(`${ts()} POST /flows/${flowId}/run → agent ${agent.id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const completedAt = new Date().toISOString();
          const usage = readLatestOpenClawUsageForAgentId(agent.id);
          await persistFlowRunRecord({
            ...runBase,
            status: "error",
            completedAt,
            durationMs: Date.parse(completedAt) - Date.parse(runStartedAt),
            error: err?.message || "Scheduled flow run failed",
            ...(usage ? { usage } : {}),
          }).catch(() => {});
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Scheduled flow run failed" }));
        } finally {
          if (clearOneOffScheduleAfterRun) {
            await clearOneOffFlowSchedule(flow).catch(() => {});
          }
        }
        return;
      }

      if (pathname === "/flows/test" && nodeReq.method === "POST") {
        let params: {
          agentId?: unknown;
          flowId?: unknown;
          mode?: unknown;
          channel?: unknown;
          message?: unknown;
          sender?: unknown;
          senderE164?: unknown;
          senderName?: unknown;
          senderUsername?: unknown;
          accountId?: unknown;
          conversationId?: unknown;
          to?: unknown;
          flow?: unknown;
        } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const config = getAgentsConfig();
        const requestedAgentId =
          typeof params.agentId === "string" && params.agentId.trim() ? params.agentId.trim() : "";
        const agentId = requestedAgentId || config.agents.find((entry) => entry.enabled)?.id || "";
        const agent = config.agents.find((entry) => entry.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        const gwToken = agent.gatewayToken || agent.token;
        if (!gwToken) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent gateway token is missing" }));
          return;
        }

        const mode =
          typeof params.mode === "string" && params.mode.trim()
            ? params.mode.trim()
            : "dry_run";
        const channel = typeof params.channel === "string" ? params.channel.trim() : "";
        const message = typeof params.message === "string" ? params.message : "";
        if (!channel || !message) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "channel and message are required" }));
          return;
        }

        let prependContextOverride: string | undefined;
        const requestedFlowId =
          typeof params.flowId === "string" && params.flowId.trim()
            ? normalizeFlowId(params.flowId.trim())
            : null;
        let persistedFlowDoc: HttpFlowDoc | null = null;
        if (params.flow !== undefined) {
          try {
            const flow = normalizeIncomingFlowDoc("preview", params.flow);
            prependContextOverride = flow.instruction;
          } catch (err: any) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: err?.message || "Invalid flow preview" }));
            return;
          }
        }
        if (requestedFlowId) {
          const persistedPath = flowPathFromId(requestedFlowId);
          const persistedDoc = store.getDocumentWithContent("_flows", persistedPath);
          persistedFlowDoc = persistedDoc?.content
            ? parseStoredFlowDoc(persistedPath, persistedDoc.content)
            : null;
        }

        const shouldPersistRun =
          mode === "dry_run" || mode === "apply"
            ? Boolean(requestedFlowId && persistedFlowDoc)
            : false;
        const runStartedAt = new Date().toISOString();
        const runBase = shouldPersistRun && persistedFlowDoc
          ? ({
              id: crypto.randomUUID().slice(0, 12),
              flowId: persistedFlowDoc.id,
              flowName: persistedFlowDoc.name,
              agentId,
              trigger: mode === "apply" ? "manual_apply" : "manual_test",
              mode: mode === "apply" ? "apply" : "dry_run",
              startedAt: runStartedAt,
              channel,
              message,
              ...(typeof params.sender === "string" && params.sender.trim() ? { sender: params.sender.trim() } : {}),
              ...(typeof params.accountId === "string" && params.accountId.trim() ? { accountId: params.accountId.trim() } : {}),
              ...(typeof params.conversationId === "string" && params.conversationId.trim() ? { conversationId: params.conversationId.trim() } : {}),
              ...(typeof params.to === "string" && params.to.trim() ? { to: params.to.trim() } : {}),
            } satisfies Omit<HttpFlowRunRecord, "status" | "completedAt" | "durationMs">)
          : null;

        try {
          const result = await agentGatewayRpc(
            agent.gatewayUrl,
            gwToken,
            "agents.flow.test",
            {
              agentId,
              mode,
              channel,
              message,
              ...(typeof params.sender === "string" ? { sender: params.sender } : {}),
              ...(typeof params.senderE164 === "string" ? { senderE164: params.senderE164 } : {}),
              ...(typeof params.senderName === "string" ? { senderName: params.senderName } : {}),
              ...(typeof params.senderUsername === "string"
                ? { senderUsername: params.senderUsername }
                : {}),
              ...(typeof params.accountId === "string" ? { accountId: params.accountId } : {}),
              ...(typeof params.conversationId === "string"
                ? { conversationId: params.conversationId }
                : {}),
              ...(typeof params.to === "string" ? { to: params.to } : {}),
              ...(prependContextOverride ? { prependContextOverride } : {}),
            },
            mode === "match_only" ? 15_000 : 600_000,
          );
          if (runBase) {
            const completedAt = new Date().toISOString();
            const usage = readLatestOpenClawUsageForAgentId(agent.id);
            await persistFlowRunRecord({
              ...runBase,
              status: "ok",
              completedAt,
              durationMs: Date.parse(completedAt) - Date.parse(runStartedAt),
              ...(summarizeFlowRunResult(result) ? { summary: summarizeFlowRunResult(result) } : {}),
              ...(usage ? { usage } : {}),
            });
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /flows/test → agent ${agentId} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          if (runBase) {
            const completedAt = new Date().toISOString();
            const usage = readLatestOpenClawUsageForAgentId(agent.id);
            await persistFlowRunRecord({
              ...runBase,
              status: "error",
              completedAt,
              durationMs: Date.parse(completedAt) - Date.parse(runStartedAt),
              error: err?.message || "Flow test failed",
              ...(usage ? { usage } : {}),
            }).catch(() => {});
          }
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Flow test failed" }));
          log(`${ts()} POST /flows/test → 502: ${err?.message || "Flow test failed"}`);
        }
        return;
      }

      if (pathname === "/evals/suites" && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        try {
          const suites = listEvalSuites(store);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ suites }));
          log(`${ts()} GET /evals/suites → ${suites.length} suites (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list eval suites" }));
        }
        return;
      }

      if (pathname === "/evals/suites" && nodeReq.method === "POST") {
        let params: { name?: unknown; description?: unknown } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const suite = createEvalSuite(store, {
            name: typeof params.name === "string" ? params.name : "",
            description: typeof params.description === "string" ? params.description : "",
          });
          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ suite }));
          log(`${ts()} POST /evals/suites → ${suite.id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to create eval suite" }));
        }
        return;
      }

      const evalSuiteDuplicateMatch = pathname.match(/^\/evals\/suites\/([^/]+)\/duplicate$/);
      if (evalSuiteDuplicateMatch && nodeReq.method === "POST") {
        const suiteId = decodeURIComponent(evalSuiteDuplicateMatch[1]!);
        try {
          const suite = duplicateBuiltinSuite(store, suiteId);
          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ suite }));
          log(`${ts()} POST /evals/suites/${suiteId}/duplicate (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to duplicate eval suite";
          nodeRes.writeHead(message.includes("not found") ? 404 : 400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      const evalSuiteRunMatch = pathname.match(/^\/evals\/suites\/([^/]+)\/run$/);
      if (evalSuiteRunMatch && nodeReq.method === "POST") {
        const suiteId = decodeURIComponent(evalSuiteRunMatch[1]!);
        let params: { createdBy?: unknown; confirmProduction?: unknown; confirm_production?: unknown } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const detail = getEvalSuiteDetail(store, suiteId);
          if (!detail) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Suite not found" }));
            return;
          }
          const result = await runEvalSuiteById({
            suiteId,
            createdBy: normalizeEvalText(params.createdBy),
            confirmProduction:
              normalizeEvalBoolean(params.confirmProduction) ||
              normalizeEvalBoolean(params.confirm_production),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /evals/suites/${suiteId}/run (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to run eval suite";
          nodeRes.writeHead(
            message === "Suite not found" ? 404 : message.includes("Continue?") ? 400 : 500,
            { "Content-Type": "application/json" },
          );
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      const evalSuiteDetailMatch = pathname.match(/^\/evals\/suites\/([^/]+)$/);
      if (evalSuiteDetailMatch && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        const suiteId = decodeURIComponent(evalSuiteDetailMatch[1]!);
        const suite = getEvalSuiteDetail(store, suiteId);
        if (!suite) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Suite not found" }));
          return;
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ suite }));
        log(`${ts()} GET /evals/suites/${suiteId} (${Date.now() - reqStart}ms)`);
        return;
      }

      const evalRunResultsMatch = pathname.match(/^\/evals\/runs\/([^/]+)\/results$/);
      if (evalRunResultsMatch && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        const runId = decodeURIComponent(evalRunResultsMatch[1]!);
        const run = readEvalRun(store, runId);
        if (!run) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Eval run not found" }));
          return;
        }
        const suite = getEvalSuiteDetail(store, run.suite_id);
        const results = listEvalCaseResults(store, runId);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ run, suite, results, cases: suite?.cases ?? [] }));
        log(`${ts()} GET /evals/runs/${runId}/results (${Date.now() - reqStart}ms)`);
        return;
      }

      const evalRunDetailMatch = pathname.match(/^\/evals\/runs\/([^/]+)$/);
      if (evalRunDetailMatch && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        const runId = decodeURIComponent(evalRunDetailMatch[1]!);
        const run = readEvalRun(store, runId);
        if (!run) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Eval run not found" }));
          return;
        }
        const suite = getEvalSuiteDetail(store, run.suite_id);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ run, suite }));
        log(`${ts()} GET /evals/runs/${runId} (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/evals/cases" && nodeReq.method === "POST") {
        let params: {
          suite_id?: unknown;
          name?: unknown;
          description?: unknown;
          target_type?: unknown;
          target_id?: unknown;
          mode?: unknown;
          input_text?: unknown;
          assertions?: unknown;
          enabled?: unknown;
        } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const targetType =
            params.target_type === "flow" ? "flow" : "agent";
          const targetId = typeof params.target_id === "string" ? params.target_id : "";
          validateEvalTargetExists({ targetType, targetId });
          const item = createEvalCase(store, {
            suite_id: typeof params.suite_id === "string" ? params.suite_id : "",
            name: typeof params.name === "string" ? params.name : "",
            description: typeof params.description === "string" ? params.description : "",
            target_type: targetType,
            target_id: targetId,
            mode:
              params.mode === "sandbox" || params.mode === "production" || params.mode === "dry_run"
                ? params.mode
                : "dry_run",
            input_text: typeof params.input_text === "string" ? params.input_text : "",
            assertions: Array.isArray(params.assertions) ? (params.assertions as EvalAssertion[]) : [],
            enabled: params.enabled !== false,
          });
          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ case: item }));
          log(`${ts()} POST /evals/cases → ${item.id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to create eval case" }));
        }
        return;
      }

      const evalCaseDetailMatch = pathname.match(/^\/evals\/cases\/([^/]+)$/);
      if (evalCaseDetailMatch && nodeReq.method === "PUT") {
        const caseId = decodeURIComponent(evalCaseDetailMatch[1]!);
        let params: {
          name?: unknown;
          description?: unknown;
          target_type?: unknown;
          target_id?: unknown;
          mode?: unknown;
          input_text?: unknown;
          assertions?: unknown;
          enabled?: unknown;
        } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const existing = readCase(store, caseId);
          if (!existing) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Eval case not found" }));
            return;
          }
          const targetType =
            params.target_type === "flow"
              ? "flow"
              : params.target_type === "agent"
                ? "agent"
                : existing.target_type;
          const targetId =
            typeof params.target_id === "string" && params.target_id.trim()
              ? params.target_id
              : existing.target_id;
          validateEvalTargetExists({ targetType, targetId });
          const item = updateEvalCase(store, caseId, {
            ...(typeof params.name === "string" ? { name: params.name } : {}),
            ...(typeof params.description === "string" ? { description: params.description } : {}),
            target_type: targetType,
            target_id: targetId,
            ...(params.mode === "sandbox" || params.mode === "production" || params.mode === "dry_run"
              ? { mode: params.mode }
              : {}),
            ...(typeof params.input_text === "string" ? { input_text: params.input_text } : {}),
            ...(Array.isArray(params.assertions) ? { assertions: params.assertions as EvalAssertion[] } : {}),
            ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ case: item }));
          log(`${ts()} PUT /evals/cases/${caseId} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to update eval case";
          nodeRes.writeHead(message.includes("not found") ? 404 : 400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (evalCaseDetailMatch && nodeReq.method === "DELETE") {
        const caseId = decodeURIComponent(evalCaseDetailMatch[1]!);
        try {
          deleteEvalCase(store, caseId);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, id: caseId }));
          log(`${ts()} DELETE /evals/cases/${caseId} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to delete eval case";
          nodeRes.writeHead(message.includes("not found") ? 404 : 400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (pathname === "/evals/cases/from-trace" && nodeReq.method === "POST") {
        let params: {
          trace_id?: unknown;
          traceId?: unknown;
          suite_id?: unknown;
          name?: unknown;
          description?: unknown;
          target_type?: unknown;
          target_id?: unknown;
          mode?: unknown;
          input_text?: unknown;
          assertion_keys?: unknown;
          assertionKeys?: unknown;
        } = {};
        try {
          const body = await collectBody(nodeReq);
          params = body ? (JSON.parse(body) as typeof params) : {};
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        const traceId =
          typeof params.trace_id === "string"
            ? params.trace_id
            : typeof params.traceId === "string"
              ? params.traceId
              : "";
        if (!traceId.trim()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "trace_id is required" }));
          return;
        }
        try {
          const draft = buildEvalCaseDraftFromTrace(store, traceId.trim());
          const selectedKeys = normalizeEvalAssertionKeyList(params.assertion_keys ?? params.assertionKeys);
          const assertions =
            selectedKeys.length > 0
              ? draft.case.assertions.filter((assertion) => selectedKeys.includes(assertion.type))
              : draft.case.assertions;
          const suiteId =
            typeof params.suite_id === "string" && params.suite_id.trim()
              ? params.suite_id.trim()
              : "";
          if (!suiteId) {
            const suites = listEvalSuites(store).filter((suite) => !suite.builtin);
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ draft, suites }));
            log(`${ts()} POST /evals/cases/from-trace → draft ${traceId} (${Date.now() - reqStart}ms)`);
            return;
          }
          const targetType =
            params.target_type === "flow" ? "flow" : params.target_type === "agent" ? "agent" : draft.case.target_type;
          const targetId =
            typeof params.target_id === "string" && params.target_id.trim()
              ? params.target_id
              : draft.case.target_id;
          validateEvalTargetExists({ targetType, targetId });
          const item = createEvalCase(store, {
            suite_id: suiteId,
            name:
              typeof params.name === "string" && params.name.trim()
                ? params.name
                : draft.case.name,
            description:
              typeof params.description === "string"
                ? params.description
                : draft.case.description,
            target_type: targetType,
            target_id: targetId,
            mode:
              params.mode === "sandbox" || params.mode === "production" || params.mode === "dry_run"
                ? params.mode
                : draft.case.mode,
            input_text:
              typeof params.input_text === "string"
                ? params.input_text
                : draft.case.input_text,
            assertions,
            enabled: true,
          });
          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ case: item, draft }));
          log(`${ts()} POST /evals/cases/from-trace → ${item.id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to build eval case from trace";
          nodeRes.writeHead(message.includes("not found") ? 404 : 400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      // GET /tasks — list all tasks
      if (pathname === "/tasks" && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        try {
          const rows = (store.db.prepare(`
            SELECT d.path, c.doc
            FROM documents d
            JOIN content c ON c.hash = d.hash
            WHERE d.collection = '_tasks' AND d.active = 1 AND d.path LIKE '%/meta.json'
            ORDER BY d.modified_at DESC
          `).all()) as { path: string; doc: string }[];

          const tasks = rows.map((r) => {
            try {
              const meta = JSON.parse(r.doc);
              return {
                id: meta.id,
                title: meta.title,
                agentId: meta.agentId,
                status: meta.status,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                schedule: normalizeTaskSchedule(meta.schedule),
              };
            } catch {
              return null;
            }
          }).filter(Boolean);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ tasks }));
          log(`${ts()} GET /tasks → ${tasks.length} tasks (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list tasks" }));
        }
        return;
      }

      // POST /tasks — create a new task
      if (pathname === "/tasks" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { title?: string; instruction?: string; agentId?: string; schedule?: unknown };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        if (!params.instruction?.trim()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "instruction is required" }));
          return;
        }
        try {
          const id = `tsk_${crypto.randomUUID().slice(0, 8)}`;
          const now = new Date().toISOString();
          const config = getAgentsConfig();
          const agentId = params.agentId || config.agents.find((a) => a.enabled)?.id || "";
          const agent = config.agents.find((a) => a.id === agentId);
          const title = params.title?.trim() || params.instruction.trim().slice(0, 80);
          const schedule = normalizeTaskSchedule(params.schedule);

          const isDelayedOneOff = schedule?.mode === "once";
          const meta: {
            id: string;
            title: string;
            instruction: string;
            agentId: string;
            status: "scheduled" | "running";
            sessionKey: null;
            createdAt: string;
            updatedAt: string;
            completedAt: null;
            error: null;
            schedule?: HttpTaskSchedule;
          } = {
            id,
            title,
            instruction: params.instruction.trim(),
            agentId,
            status: isDelayedOneOff ? "scheduled" as const : "running" as const,
            sessionKey: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            error: null,
            ...(schedule ? { schedule } : {}),
          };

          if (schedule && schedule.mode !== "off") {
            const syncedSchedule = await syncTaskCronJob({ agent, task: meta });
            if (syncedSchedule) {
              meta.schedule = syncedSchedule;
            } else {
              delete meta.schedule;
            }
          }

          // Store meta
          const metaContent = JSON.stringify(meta, null, 2) + "\n";
          const metaHash = await hashContent(metaContent);
          store.insertContent(metaHash, metaContent, now);
          store.insertDocument("_tasks", `${id}/meta.json`, `${id}/meta.json`, metaHash, now, now);

          // Store initial instruction activity entry
          const activityEntry = JSON.stringify({
            ts: now,
            type: "instruction",
            summary: params.instruction.trim(),
          }) + "\n";
          const actHash = await hashContent(activityEntry);
          store.insertContent(actHash, activityEntry, now);
          store.insertDocument("_tasks", `${id}/activity.jsonl`, `${id}/activity.jsonl`, actHash, now, now);

          // Send hook to agent immediately unless this is a delayed one-off template.
          if (!isDelayedOneOff && agent && agent.enabled) {
            void dispatchExistingTaskToAgent({
              taskId: id,
              meta,
              resetSessionLink: true,
            }).then((result) => {
              if (result.launchSucceeded) {
                log(`${ts()} task ${id}: hook sent to agent ${agentId}`);
              } else {
                log(`${ts()} task ${id}: hook failed`);
              }
            }).catch((err) => {
              log(`${ts()} task ${id}: hook error: ${err?.message}`);
            });
          } else if (!isDelayedOneOff) {
            // No agent available
            const noAgentTs = new Date().toISOString();
            await appendTaskActivityEntry({ taskId: id, entry: { ts: noAgentTs, type: "error", summary: `No enabled agent found for id "${agentId}"` } });
          } else {
            await appendTaskActivityEntry({
              taskId: id,
              entry: {
                ts: now,
                type: "status_change",
                summary: `One-off task scheduled for ${schedule?.onceAt ?? "later run"}`,
              },
            });
          }

          nodeRes.writeHead(201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ task: meta }));
          log(`${ts()} POST /tasks → created ${id} for agent ${agentId} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to create task" }));
        }
        return;
      }

      // GET /tasks/:id — get task detail (with session bridge)
      const taskDetailMatch = pathname.match(/^\/tasks\/([^/]+)$/);
      if (taskDetailMatch && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        const taskId = decodeURIComponent(taskDetailMatch[1]!);
        try {
          const metaDoc = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (!metaDoc) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          const meta = JSON.parse(metaDoc.content);
          let metaChanged = false;

          // ── Session bridge: find + sync agent session ──
          if (meta.status === "running") {
            // Step 1: Find matching session if not linked yet
            if (!meta.sessionKey) {
              const taskSearchSince =
                typeof meta.currentRunStartedAt === "string" && meta.currentRunStartedAt.trim()
                  ? meta.currentRunStartedAt
                  : meta.createdAt;
              const taskMarker = buildTaskHookName(taskId, typeof meta.title === "string" ? meta.title : "");
              const legacyTaskMarker =
                typeof meta.title === "string" && meta.title.trim() ? `Task: ${meta.title}` : undefined;
              let sessionRows = (store.db.prepare(`
                SELECT d.path, d.modified_at
                FROM documents d
                JOIN content c ON c.hash = d.hash
                WHERE d.collection = '_sessions' AND d.active = 1 AND d.modified_at >= ?
                  AND INSTR(c.doc, ?) > 0
                ORDER BY d.modified_at DESC
                LIMIT 5
              `).all(taskSearchSince, taskMarker)) as { path: string; modified_at: string }[];
              if (sessionRows.length === 0 && legacyTaskMarker) {
                sessionRows = (store.db.prepare(`
                  SELECT d.path, d.modified_at
                  FROM documents d
                  JOIN content c ON c.hash = d.hash
                  WHERE d.collection = '_sessions' AND d.active = 1 AND d.modified_at >= ?
                    AND INSTR(c.doc, ?) > 0
                  ORDER BY d.modified_at DESC
                  LIMIT 5
                `).all(taskSearchSince, legacyTaskMarker)) as { path: string; modified_at: string }[];
              }

              if (sessionRows.length > 0) {
                const candidates = sessionRows
                  .map((row) => {
                    const path = row.path.replace(/\.jsonl$/, "");
                    const doc = store.getDocumentWithContent("_sessions", `${path}.jsonl`);
                    return {
                      path,
                      modifiedAt: row.modified_at,
                      score: doc
                        ? scoreTaskSessionCandidate({
                            doc: doc.content,
                            taskMarker,
                            legacyTaskMarker,
                          })
                        : Number.NEGATIVE_INFINITY,
                    };
                  })
                  .sort((a, b) => {
                    if (a.score !== b.score) return b.score - a.score;
                    return Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt);
                  });
                const bestCandidate = candidates[0];
                if (bestCandidate && Number.isFinite(bestCandidate.score) && bestCandidate.score > 0) {
                  meta.sessionKey = bestCandidate.path;
                  metaChanged = true;
                  log(`${ts()} task ${taskId}: linked to session ${meta.sessionKey} (score=${bestCandidate.score})`);
                }
              }
            }

            // Step 2: Sync session transcript to activity
            if (meta.sessionKey) {
              const sessionDoc = store.getDocumentWithContent("_sessions", `${meta.sessionKey}.jsonl`);
              if (sessionDoc) {
                const sessionLines = sessionDoc.content.split("\n").filter((l) => l.trim());
                const newActivity: string[] = [];
                let lastTaskActivityMs = new Date(meta.createdAt).getTime();
                let lastTaskRole: "user" | "assistant" | "toolResult" | null = null;
                let sawAgentWork = false;
                let sawExplicitOutput = false;
                let bestAssistantDeliverable: { ts: string; text: string; score: number } | null = null;
                // Track whether we've reached the task's portion of the session
                let inTaskScope = false;

                for (const line of sessionLines) {
                  try {
                    const entry = JSON.parse(line) as Record<string, unknown>;
                    if (entry.type !== "message") continue;
                    const msg =
                      typeof entry.message === "object" && entry.message !== null
                        ? (entry.message as Record<string, unknown>)
                        : null;
                    if (!msg) continue;
                    const { iso: entryTs, ms: entryMs } = extractTaskTimestamp(entry, meta.createdAt);

                    if (!inTaskScope) {
                      if (msg.role === "user" && Array.isArray(msg.content)) {
                        for (const block of msg.content) {
                          if (
                            block &&
                            typeof block === "object" &&
                            (block as { type?: unknown }).type === "text" &&
                            typeof (block as { text?: unknown }).text === "string" &&
                            (
                              (block as { text: string }).text.includes(buildTaskHookName(taskId, typeof meta.title === "string" ? meta.title : "")) ||
                              (typeof meta.title === "string" && (block as { text: string }).text.includes(`Task: ${meta.title}`))
                            )
                          ) {
                            inTaskScope = true;
                            break;
                          }
                        }
                      }
                      if (!inTaskScope) continue;
                    }

                    if (msg.role === "user") {
                      lastTaskRole = "user";
                      lastTaskActivityMs = entryMs;
                    }

                    if (msg.role === "assistant" && Array.isArray(msg.content)) {
                      let sawMeaningfulAssistantContent = false;
                      for (const block of msg.content) {
                        if (!block || typeof block !== "object") continue;
                        const blockRecord = block as Record<string, unknown>;
                        const blockType = normalizeTaskBlockType(blockRecord.type);

                        if (blockType === "text" && typeof blockRecord.text === "string") {
                          if (blockRecord.text.startsWith("✅ New session started")) continue;
                          const cleanText = cleanTaskText(blockRecord.text);
                          if (cleanText && !isTaskNoiseText(cleanText)) {
                            sawMeaningfulAssistantContent = true;
                            const outputPath = extractTaskOutputPath(cleanText);
                            if (outputPath) {
                              sawExplicitOutput = true;
                              newActivity.push(JSON.stringify({
                                ts: entryTs,
                                type: "output",
                                summary: cleanText.length > 300 ? cleanText.slice(0, 300) + "..." : cleanText,
                                detail: cleanText.length > 300 ? cleanText : undefined,
                                meta: { collection: EDITABLE_COLLECTION, path: outputPath },
                              }));
                            } else {
                              const score = scoreTaskDeliverable(cleanText);
                              if (score >= 0 && (!bestAssistantDeliverable || score >= bestAssistantDeliverable.score)) {
                                bestAssistantDeliverable = { ts: entryTs, text: cleanText, score };
                              }
                              newActivity.push(JSON.stringify({
                                ts: entryTs,
                                type: "reasoning",
                                summary: cleanText.length > 300 ? cleanText.slice(0, 300) + "..." : cleanText,
                                detail: cleanText.length > 300 ? cleanText : undefined,
                              }));
                            }
                          }
                        }

                        if (TASK_TOOL_CALL_TYPES.has(blockType)) {
                          sawAgentWork = true;
                          sawMeaningfulAssistantContent = true;
                          const toolName =
                            typeof blockRecord.name === "string" && blockRecord.name.trim()
                              ? blockRecord.name.trim()
                              : "unknown";
                          newActivity.push(JSON.stringify({
                            ts: entryTs,
                            type: "tool_call",
                            summary: `Called ${toolName}`,
                            meta: { toolName },
                          }));
                        }

                        if (TASK_TOOL_RESULT_TYPES.has(blockType) && typeof blockRecord.text === "string") {
                          sawAgentWork = true;
                          sawMeaningfulAssistantContent = true;
                          const cleanText = cleanTaskText(blockRecord.text);
                          if (!cleanText || isTaskNoiseText(cleanText)) continue;
                          const outputPath = extractTaskOutputPath(cleanText);
                          if (outputPath) sawExplicitOutput = true;
                          newActivity.push(JSON.stringify({
                            ts: entryTs,
                            type: "output",
                            summary: cleanText.length > 200 ? cleanText.slice(0, 200) + "..." : cleanText,
                            detail: cleanText.length > 200 ? cleanText : undefined,
                            meta: outputPath ? { collection: EDITABLE_COLLECTION, path: outputPath } : undefined,
                          }));
                        }
                      }

                      if (sawMeaningfulAssistantContent) {
                        lastTaskRole = "assistant";
                        lastTaskActivityMs = entryMs;
                      }
                    } else if (msg.role === "toolResult" && Array.isArray(msg.content)) {
                      let sawMeaningfulToolResult = false;
                      for (const block of msg.content) {
                        if (!block || typeof block !== "object") continue;
                        const blockRecord = block as Record<string, unknown>;
                        const blockType = normalizeTaskBlockType(blockRecord.type);
                        if (!(blockType === "" || blockType === "text") || typeof blockRecord.text !== "string") continue;
                        sawAgentWork = true;
                        sawMeaningfulToolResult = true;
                        const cleanText = cleanTaskText(blockRecord.text);
                        if (!cleanText || isTaskNoiseText(cleanText)) continue;
                        const outputPath = extractTaskOutputPath(cleanText);
                        if (outputPath) sawExplicitOutput = true;
                        newActivity.push(JSON.stringify({
                          ts: entryTs,
                          type: "output",
                          summary: cleanText.length > 200 ? cleanText.slice(0, 200) + "..." : cleanText,
                          detail: cleanText.length > 200 ? cleanText : undefined,
                          meta: outputPath ? { collection: EDITABLE_COLLECTION, path: outputPath } : undefined,
                        }));
                      }

                      if (sawMeaningfulToolResult) {
                        lastTaskRole = "toolResult";
                        lastTaskActivityMs = entryMs;
                      }
                    }
                  } catch { /* skip unparseable lines */ }
                }

                // Replace activity with synced version while preserving prior artifact-backed outputs.
                const existingActDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
                const existingLines = existingActDoc ? existingActDoc.content.split("\n").filter((l) => l.trim()) : [];
                const now = new Date().toISOString();

                // Step 3: Materialize a fallback deliverable when the agent only replied in chat
                if (!sawExplicitOutput && bestAssistantDeliverable?.text) {
                  const outputPath = await upsertTaskGeneratedOutput(
                    taskId,
                    buildTaskGeneratedOutputFileName(bestAssistantDeliverable.ts),
                    bestAssistantDeliverable.text,
                  );
                  if (outputPath) {
                    newActivity.push(JSON.stringify({
                      ts: bestAssistantDeliverable.ts,
                      type: "output",
                      summary: bestAssistantDeliverable.text.length > 300
                        ? bestAssistantDeliverable.text.slice(0, 300) + "..."
                        : bestAssistantDeliverable.text,
                      detail: bestAssistantDeliverable.text.length > 300
                        ? bestAssistantDeliverable.text
                        : undefined,
                      meta: { collection: "_tasks", path: outputPath },
                    }));
                  }
                }

                const currentOutputKeys = new Set<string>();
                for (const line of newActivity) {
                  try {
                    const entry = JSON.parse(line);
                    const collection =
                      typeof entry?.meta?.collection === "string" ? entry.meta.collection : null;
                    const path = typeof entry?.meta?.path === "string" ? entry.meta.path : null;
                    if (entry?.type === "output" && collection && path) {
                      currentOutputKeys.add(`${collection}:${path}`);
                    }
                  } catch { /* skip unparseable lines */ }
                }

                const keptEntries = existingLines.filter((l) => {
                  try {
                    const e = JSON.parse(l);
                    if (e.type === "instruction" || e.type === "status_change" || e.type === "error") {
                      return true;
                    }
                    const collection =
                      typeof e?.meta?.collection === "string" ? e.meta.collection : null;
                    const path = typeof e?.meta?.path === "string" ? e.meta.path : null;
                    if (e.type === "output" && collection && path) {
                      return !currentOutputKeys.has(`${collection}:${path}`);
                    }
                    return false;
                  } catch { return false; }
                });

                const allEntries = sortTaskActivityLines([...keptEntries, ...newActivity]);
                const actContent = allEntries.join("\n") + "\n";
                const actHash = await hashContent(actContent);
                store.insertContent(actHash, actContent, now);
                const actRef = store.findActiveDocument("_tasks", `${taskId}/activity.jsonl`);
                if (actRef) {
                  store.updateDocument(actRef.id, actRef.title, actHash, now);
                } else if (store.findActiveDocument("_tasks", `${taskId}/meta.json`)) {
                  store.insertDocument("_tasks", `${taskId}/activity.jsonl`, `${taskId}/activity.jsonl`, actHash, now, now);
                }

                // Step 4: Auto-detect completion
                // Session is done if the task scope ended with agent output and has been quiet for 30s.
                const staleMs = Date.now() - lastTaskActivityMs;
                if (
                  meta.status === "running" &&
                  (lastTaskRole === "assistant" || lastTaskRole === "toolResult") &&
                  staleMs > 30_000 &&
                  (sawAgentWork || newActivity.length > 0)
                ) {
                  const latestUsage = typeof meta.agentId === "string"
                    ? readLatestOpenClawUsageForAgentId(meta.agentId)
                    : undefined;
                  meta.status = "completed";
                  meta.completedAt = now;
                  meta.updatedAt = now;
                  meta.currentRunStartedAt = null;
                  metaChanged = true;

                  // Add completion activity
                  const completedEntries = sortTaskActivityLines([
                    ...allEntries,
                    JSON.stringify({
                      ts: now,
                      type: "status_change",
                      summary: "Task completed",
                      ...(latestUsage ? { meta: { usage: latestUsage } } : {}),
                    }),
                  ]);
                  const finalContent = completedEntries.join("\n") + "\n";
                  const finalHash = await hashContent(finalContent);
                  store.insertContent(finalHash, finalContent, now);
                  if (actRef) store.updateDocument(actRef.id, actRef.title, finalHash, now);

                  log(`${ts()} task ${taskId}: auto-completed (session stale ${Math.round(staleMs / 1000)}s)`);
                }
              }
            }

            // Save meta if changed (session linked or status updated)
            if (metaChanged) {
              const now = new Date().toISOString();
              meta.updatedAt = now;
              const content = JSON.stringify(meta, null, 2) + "\n";
              const hash = await hashContent(content);
              store.insertContent(hash, content, now);
              const doc = store.findActiveDocument("_tasks", `${taskId}/meta.json`);
              if (doc) store.updateDocument(doc.id, doc.title, hash, now);
            }
          }

          // ── Read final activity for response ──
          const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const offset = parseInt(reqUrl.searchParams.get("offset") || "0", 10);
          const limit = parseInt(reqUrl.searchParams.get("limit") || "200", 10);

          let activity: unknown[] = [];
          let activityTotal = 0;
          if (actDoc) {
            const lines = sortTaskActivityLines(actDoc.content.split("\n").filter((l) => l.trim()));
            activityTotal = lines.length;
            activity = lines.slice(offset, offset + limit).map((l) => {
              return parseTaskActivityLine(l);
            }).filter(Boolean);
          }

          const outputs = collectTaskOutputs(taskId, activity);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ meta, activity, activityTotal, outputs }));
          log(`${ts()} GET /tasks/${taskId} → ${activityTotal} entries, session=${meta.sessionKey || "none"} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to get task" }));
        }
        return;
      }

      // PATCH /tasks/:id — update task
      const taskPatchMatch = pathname.match(/^\/tasks\/([^/]+)$/);
      if (taskPatchMatch && nodeReq.method === "PATCH") {
        const taskId = decodeURIComponent(taskPatchMatch[1]!);
        const body = await collectBody(nodeReq);
        let patch: { title?: string; status?: string; error?: string; schedule?: unknown };
        try { patch = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const existing = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (!existing) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          const meta = JSON.parse(existing.content);
          const now = new Date().toISOString();
          if (patch.title !== undefined) meta.title = patch.title;
          if (patch.status !== undefined) {
            meta.status = patch.status;
            if (patch.status === "completed" || patch.status === "failed") {
              meta.completedAt = now;
              meta.currentRunStartedAt = null;
            }
          }
          if (patch.error !== undefined) meta.error = patch.error;
          if ("schedule" in patch) {
            meta.schedule = mergeTaskSchedule(
              normalizeTaskSchedule(meta.schedule),
              normalizeTaskSchedule(patch.schedule),
            );
            const config = getAgentsConfig();
            const agent = config.agents.find((entry) => entry.id === meta.agentId);
            meta.schedule = await syncTaskCronJob({ agent, task: meta });
          }
          meta.updatedAt = now;

          const content = JSON.stringify(meta, null, 2) + "\n";
          const hash = await hashContent(content);
          store.insertContent(hash, content, now);
          const doc = store.findActiveDocument("_tasks", `${taskId}/meta.json`);
          if (doc) store.updateDocument(doc.id, doc.title, hash, now);

          // Append status_change activity if status changed
          if (patch.status !== undefined) {
            const entry = JSON.stringify({
              ts: now,
              type: "status_change",
              summary: `Status changed to ${patch.status}`,
            }) + "\n";
            const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
            const updated = (actDoc?.content || "") + entry;
            const actHash = await hashContent(updated);
            store.insertContent(actHash, updated, now);
            const actDocRef = store.findActiveDocument("_tasks", `${taskId}/activity.jsonl`);
            if (actDocRef) store.updateDocument(actDocRef.id, actDocRef.title, actHash, now);
            else store.insertDocument("_tasks", `${taskId}/activity.jsonl`, `${taskId}/activity.jsonl`, actHash, now, now);
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ task: meta }));
          log(`${ts()} PATCH /tasks/${taskId} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update task" }));
        }
        return;
      }

      // POST /tasks/:id/stop — stop a running task
      const taskStopMatch = pathname.match(/^\/tasks\/([^/]+)\/stop$/);
      if (taskStopMatch && nodeReq.method === "POST") {
        const taskId = decodeURIComponent(taskStopMatch[1]!);
        try {
          const metaDoc = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (!metaDoc) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          const meta = JSON.parse(metaDoc.content);
          const now = new Date().toISOString();

          // Update status to failed
          meta.status = "failed";
          meta.error = "Stopped by user";
          meta.completedAt = now;
          meta.updatedAt = now;
          meta.currentRunStartedAt = null;
          const content = JSON.stringify(meta, null, 2) + "\n";
          const hash = await hashContent(content);
          store.insertContent(hash, content, now);
          const doc = store.findActiveDocument("_tasks", `${taskId}/meta.json`);
          if (doc) store.updateDocument(doc.id, doc.title, hash, now);

          // Append stop activity
          const stopEntry = JSON.stringify({ ts: now, type: "status_change", summary: "Task stopped by user" }) + "\n";
          const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
          const updated = (actDoc?.content || "") + stopEntry;
          const actHash = await hashContent(updated);
          store.insertContent(actHash, updated, now);
          const actRef = store.findActiveDocument("_tasks", `${taskId}/activity.jsonl`);
          if (actRef) store.updateDocument(actRef.id, actRef.title, actHash, now);
          else store.insertDocument("_tasks", `${taskId}/activity.jsonl`, `${taskId}/activity.jsonl`, actHash, now, now);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ task: meta }));
          log(`${ts()} POST /tasks/${taskId}/stop (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to stop task" }));
        }
        return;
      }

      // DELETE /tasks/:id — delete task
      const taskDeleteMatch = pathname.match(/^\/tasks\/([^/]+)$/);
      if (taskDeleteMatch && nodeReq.method === "DELETE") {
        const taskId = decodeURIComponent(taskDeleteMatch[1]!);
        try {
          const prefix = `${taskId}/%`;
          const metaDoc = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (metaDoc?.content) {
            try {
              const meta = JSON.parse(metaDoc.content) as { agentId?: string; schedule?: HttpTaskSchedule };
              const config = getAgentsConfig();
              const agent = config.agents.find((entry) => entry.id === meta.agentId);
              await removeLinkedCronJob(agent, meta.schedule?.cronJobId);
            } catch {
              // ignore cleanup parse errors
            }
          }
          const row = store.db.prepare(`
            SELECT COUNT(*) as count
            FROM documents
            WHERE collection = '_tasks' AND active = 1 AND path LIKE ?
          `).get(prefix) as { count: number } | undefined;
          const deleted = row?.count ?? 0;

          store.db.prepare(`
            UPDATE documents
            SET active = 0
            WHERE collection = '_tasks' AND active = 1 AND path LIKE ?
          `).run(prefix);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, deleted }));
          log(`${ts()} DELETE /tasks/${taskId} → ${deleted} docs (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to delete task" }));
        }
        return;
      }

      const taskRunMatch = pathname.match(/^\/tasks\/([^/]+)\/run$/);
      if (taskRunMatch && nodeReq.method === "POST") {
        const taskId = decodeURIComponent(taskRunMatch[1]!);
        try {
          const metaDoc = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (!metaDoc) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          const template = JSON.parse(metaDoc.content) as {
            title?: string;
            instruction?: string;
            agentId?: string;
          };
          if (!template.instruction?.trim()) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task template instruction is missing" }));
            return;
          }
          const clearOneOffScheduleAfterRun = normalizeTaskSchedule((template as Record<string, unknown>).schedule)?.mode === "once";
          let launchSucceeded = false;
          let latestTaskMeta: Record<string, unknown> = template as Record<string, unknown>;
          try {
            const result = await dispatchExistingTaskToAgent({
              taskId,
              meta: template as Record<string, unknown> as {
                id: string;
                title: string;
                instruction: string;
                agentId: string;
                status?: string;
                sessionKey?: string | null;
                currentRunStartedAt?: string | null;
                createdAt?: string;
                updatedAt?: string;
                completedAt?: string | null;
                error?: string | null;
                [key: string]: unknown;
              },
              resetSessionLink: true,
              appendScheduledDispatchNote: true,
            });
            launchSucceeded = result.launchSucceeded;
            latestTaskMeta = result.task;
            nodeRes.writeHead(result.launchSucceeded ? 200 : 502, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ task: result.task }));
            log(`${ts()} POST /tasks/${taskId}/run (${Date.now() - reqStart}ms)`);
          } finally {
            if (clearOneOffScheduleAfterRun && launchSucceeded) {
              await clearOneOffTaskSchedule({
                taskId,
                meta: latestTaskMeta,
              }).catch(() => {});
            }
          }
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to run scheduled task" }));
        }
        return;
      }

      // POST /tasks/:id/send — send message to a running task
      const taskSendMatch = pathname.match(/^\/tasks\/([^/]+)\/send$/);
      if (taskSendMatch && nodeReq.method === "POST") {
        const taskId = decodeURIComponent(taskSendMatch[1]!);
        const body = await collectBody(nodeReq);
        let params: { message?: string };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        if (!params.message?.trim()) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "message is required" }));
          return;
        }
        try {
          const metaDoc = store.getDocumentWithContent("_tasks", `${taskId}/meta.json`);
          if (!metaDoc) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          const meta = JSON.parse(metaDoc.content);
          const now = new Date().toISOString();

          // Append instruction activity
          const entry = JSON.stringify({
            ts: now,
            type: "instruction",
            summary: params.message.trim(),
          }) + "\n";
          const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
          const updated = (actDoc?.content || "") + entry;
          const actHash = await hashContent(updated);
          store.insertContent(actHash, updated, now);
          const actDocRef = store.findActiveDocument("_tasks", `${taskId}/activity.jsonl`);
          if (actDocRef) store.updateDocument(actDocRef.id, actDocRef.title, actHash, now);
          else store.insertDocument("_tasks", `${taskId}/activity.jsonl`, `${taskId}/activity.jsonl`, actHash, now, now);

          // Update meta timestamp
          meta.updatedAt = now;
          await persistTaskMeta({ taskId, meta, now });

          // Send hook to agent
          void dispatchExistingTaskToAgent({
            taskId,
            meta,
            message: params.message.trim(),
            resetSessionLink: true,
          }).catch((err) => {
            log(`${ts()} task ${taskId}/send: hook error: ${err?.message}`);
          });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /tasks/${taskId}/send (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to send message" }));
        }
        return;
      }

      // GET /tasks/:id/activity — poll activity stream
      const taskActivityMatch = pathname.match(/^\/tasks\/([^/]+)\/activity$/);
      if (taskActivityMatch && nodeReq.method === "GET") {
        const taskId = decodeURIComponent(taskActivityMatch[1]!);
        try {
          const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const offset = parseInt(reqUrl.searchParams.get("offset") || "0", 10);
          const limit = parseInt(reqUrl.searchParams.get("limit") || "100", 10);

          let entries: unknown[] = [];
          let total = 0;
          if (actDoc) {
            const lines = sortTaskActivityLines(actDoc.content.split("\n").filter((l) => l.trim()));
            total = lines.length;
            entries = lines.slice(offset, offset + limit).map((l) => {
              return parseTaskActivityLine(l);
            }).filter(Boolean);
          }

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ entries, total }));
          log(`${ts()} GET /tasks/${taskId}/activity → ${total} entries (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to get activity" }));
        }
        return;
      }

      // GET /tasks/:id/outputs — list task outputs
      const taskOutputsMatch = pathname.match(/^\/tasks\/([^/]+)\/outputs$/);
      if (taskOutputsMatch && nodeReq.method === "GET") {
        const taskId = decodeURIComponent(taskOutputsMatch[1]!);
        try {
          const actDoc = store.getDocumentWithContent("_tasks", `${taskId}/activity.jsonl`);
          const activityEntries = actDoc
            ? sortTaskActivityLines(
                actDoc.content
                .split("\n")
                .filter((l) => l.trim())
              ).map((l) => parseTaskActivityLine(l))
                .filter(Boolean)
            : [];
          const outputs = collectTaskOutputs(taskId, activityEntries);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ outputs }));
          log(`${ts()} GET /tasks/${taskId}/outputs → ${outputs.length} files (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list outputs" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Usage overview endpoint
      // -----------------------------------------------------------------------

      if (pathname === "/usage/overview" && nodeReq.method === "GET") {
        try {
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const startDateParam = reqUrl.searchParams.get("startDate")?.trim() || undefined;
          const endDateParam = reqUrl.searchParams.get("endDate")?.trim() || undefined;
          const daysRaw = reqUrl.searchParams.get("days");
          const days =
            typeof daysRaw === "string" && daysRaw.trim()
              ? Math.max(1, Number.parseInt(daysRaw, 10) || 30)
              : 30;
          const now = new Date();
          const endDateDefault = now.toISOString().slice(0, 10);
          const startDateDefault = new Date(
            now.getTime() - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000,
          )
            .toISOString()
            .slice(0, 10);
          const startDate = startDateParam || startDateDefault;
          const endDate = endDateParam || endDateDefault;
          const config = getAgentsConfig();
          const agent = resolveUsageOpenClawAgent(config);
          if (!agent) {
            const empty = createEmptyUsageOverviewResponse({ startDate, endDate });
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(empty));
            log(`${ts()} GET /usage/overview → empty (no openclaw agent) (${Date.now() - reqStart}ms)`);
            return;
          }

          const pricingState = await resolveOpenClawUsagePricingState(agent);
          const resolved = pricingState.resolved;
          const gateway = await buildUsageGatewaySnapshotFromVault({
            store,
            startDate,
            endDate,
            parsed: resolved?.parsed,
          });
          const response = buildUsageOverviewResponse({
            gateway,
            parsed: resolved?.parsed,
            config,
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(response));
          log(`${ts()} GET /usage/overview (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to load usage overview" }));
          log(`${ts()} GET /usage/overview → error: ${err?.message || "Failed to load usage overview"}`);
        }
        return;
      }

      if (pathname === "/usage/pricing" && nodeReq.method === "GET") {
        try {
          const config = getAgentsConfig();
          const agent = resolveUsageOpenClawAgent(config);
          if (!agent || !agent.openclawConfigPath) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "No OpenClaw config available for usage pricing." }));
            return;
          }
          const pricingState = await resolveOpenClawUsagePricingState(agent);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(pricingState.pricing));
          log(`${ts()} GET /usage/pricing (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to load usage pricing" }));
          log(`${ts()} GET /usage/pricing → error: ${err?.message || "Failed to load usage pricing"}`);
        }
        return;
      }

      if (pathname === "/usage/pricing" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        try {
          const config = getAgentsConfig();
          const agent = resolveUsageOpenClawAgent(config);
          if (!agent || !agent.openclawConfigPath) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "No OpenClaw config available for usage pricing." }));
            return;
          }
          let params: any = {};
          try {
            params = JSON.parse(body || "{}");
          } catch {
            params = {};
          }
          const provider = typeof params?.provider === "string" ? params.provider.trim() : "";
          const model = typeof params?.model === "string" ? params.model.trim() : "";
          const rawCost = params?.cost && typeof params.cost === "object" ? params.cost : {};
          const read = (key: keyof OpenClawUsagePricingCost): number => {
            const value = rawCost[key];
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
              throw new Error(`Invalid ${key} pricing value.`);
            }
            return value;
          };
          if (!provider || !model) {
            throw new Error("Provider and model are required.");
          }
          const pricingState = await resolveOpenClawUsagePricingState(agent);
          const next = upsertUsagePricingModelCost(pricingState.resolved.parsed, {
            provider,
            model,
            cost: {
              input: read("input"),
              output: read("output"),
              cacheRead: read("cacheRead"),
              cacheWrite: read("cacheWrite"),
            },
            touchedAt: new Date().toISOString(),
          });
          await writeOpenClawConfigToWritablePaths(agent, next);
          const refreshed = await resolveOpenClawUsagePricingState(agent);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(refreshed.pricing));
          log(`${ts()} POST /usage/pricing (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to save usage pricing" }));
          log(`${ts()} POST /usage/pricing → error: ${err?.message || "Failed to save usage pricing"}`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Agents connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/agents/status" && nodeReq.method === "GET") {
        const config = getAgentsConfig();
        let configChanged = false;
        for (const agent of config.agents) {
          if (await refreshOpenClawAgentRuntimeConfig(agent)) {
            configChanged = true;
          }
        }
        if (configChanged) {
          await saveAgentsConfig(config);
        }
        const upstreamAuth = getAgentUpstreamAuthSummary();
        const agents = await Promise.all(
          config.agents.map(async ({ token: _token, vaultAccess, openclawConfigPath: _openclawConfigPath, ...rest }) => {
            let running = false;
            let latestUsage: AgentLatestUsageSummary | undefined;
            if (rest.type === "openclaw") {
              try {
                running = await probeAgentHook({ ...rest, token: _token, vaultAccess, openclawConfigPath: _openclawConfigPath }, 1200);
              } catch {
                running = false;
              }
              latestUsage = readLatestOpenClawUsage({
                id: rest.id,
                openclawConfigPath: _openclawConfigPath,
                model: rest.model,
              });
            }
            return {
              ...rest,
              routingProfile:
                sanitizeAgentRoutingProfile(rest.routingProfile, resolveDefaultRoutingProfile(rest.profile)) ??
                resolveDefaultRoutingProfile(rest.profile),
              running,
              latestUsage,
              vaultAccess: sanitizeAgentVaultAccess(normalizeAgentVaultAccess(vaultAccess)),
              upstreamAuth,
            };
          }),
        );
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ agents }));
        log(`${ts()} GET /connections/agents/status → ${agents.length} agents (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/connections/agents/starter-team" && nodeReq.method === "POST") {
        try {
          const { createdIds, missingProfileIds } = await createStarterTeam();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            createdIds,
            alreadyCreated: missingProfileIds.length === 0,
          }));
          log(`${ts()} POST /connections/agents/starter-team → ${createdIds.length} created (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to create starter team" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime" && nodeReq.method === "GET") {
        try {
          const status = await getManagedOllamaRuntimeStatus();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(status));
          log(`${ts()} GET /connections/agents/ollama/runtime → installed=${status.installed} available=${status.available} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to inspect local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime/install" && nodeReq.method === "POST") {
        try {
          await installManagedOllamaRuntime();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/agents/ollama/runtime/install → ok (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to install local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime/remove" && nodeReq.method === "POST") {
        try {
          await removeManagedOllamaRuntime();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/agents/ollama/runtime/remove → ok (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to remove local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime/start" && nodeReq.method === "POST") {
        try {
          await ensureManagedOllamaRuntimeStarted({ takeover: true });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/agents/ollama/runtime/start → ok (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to start local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime/stop" && nodeReq.method === "POST") {
        try {
          await stopManagedOllamaRuntime();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/agents/ollama/runtime/stop → ok (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to stop local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/runtime/restart" && nodeReq.method === "POST") {
        try {
          await restartManagedOllamaRuntime();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/agents/ollama/runtime/restart → ok (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to restart local runtime" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/models" && nodeReq.method === "GET") {
        try {
          const configPath = resolveDefaultOpenClawConfigPathForOllama();
          const baseUrl = resolveOllamaApiBaseFromConfig(configPath);
          const runtimeStatus = await getManagedOllamaRuntimeStatus();
          const modelsPath =
            runtimeStatus.source === "managed"
              ? join(resolveManagedOllamaRuntimeHome(), "models")
              : undefined;
          if (!runtimeStatus.available) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              available: false,
              baseUrl,
              modelsPath,
              models: [],
              error: runtimeStatus.error || "Local runtime is not running.",
            }));
            return;
          }
          const response = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({
              available: false,
              baseUrl,
              modelsPath,
              models: [],
              error: `HTTP ${response.status}`,
            }));
            return;
          }
          const data = await response.json() as { models?: Array<{ name?: string; size?: number; modified_at?: string }> };
          const models = Array.isArray(data.models)
            ? data.models
              .map((entry) => {
                const name = typeof entry?.name === "string" ? entry.name.trim() : "";
                if (!name) {
                  return null;
                }
                return {
                  id: `ollama/${name}`,
                  name,
                  sizeBytes: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : undefined,
                  modifiedAt: typeof entry.modified_at === "string" ? entry.modified_at : undefined,
                };
              })
              .filter(Boolean)
            : [];
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            available: true,
            baseUrl,
            modelsPath,
            models,
          }));
          log(`${ts()} GET /connections/agents/ollama/models → ${models.length} models (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const configPath = resolveDefaultOpenClawConfigPathForOllama();
          const runtimeStatus = await getManagedOllamaRuntimeStatus().catch(() => null);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            available: false,
            baseUrl: resolveOllamaApiBaseFromConfig(configPath),
            modelsPath:
              runtimeStatus?.source === "managed"
                ? join(resolveManagedOllamaRuntimeHome(), "models")
                : undefined,
            models: [],
            error: err?.message || "Failed to query Ollama",
          }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/pull" && nodeReq.method === "POST") {
        let params: { model?: unknown } = {};
        try {
          params = JSON.parse(await collectBody(nodeReq) || "{}") as { model?: unknown };
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        const model = normalizeOllamaModelName(params.model);
        if (!model) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "model is required" }));
          return;
        }
        const configPath = resolveDefaultOpenClawConfigPathForOllama();
        const baseUrl = resolveOllamaApiBaseFromConfig(configPath);
        try {
          await ensureManagedOllamaRuntimeAvailable();
          const response = await fetch(`${baseUrl}/api/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, stream: false }),
            signal: AbortSignal.timeout(1_800_000),
          });
          if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            const parsedError = parseOllamaErrorMessage(errorText, response.status);
            const message =
              response.status === 412
                ? `This model requires a newer local runtime. Update the local runtime from Models, then try again. Upstream: ${parsedError}`
                : parsedError;
            nodeRes.writeHead(502, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: message }));
            return;
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, model }));
          log(`${ts()} POST /connections/agents/ollama/pull → ${model} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to pull Ollama model" }));
        }
        return;
      }

      if (pathname === "/connections/agents/ollama/delete" && nodeReq.method === "POST") {
        let params: { model?: unknown } = {};
        try {
          params = JSON.parse(await collectBody(nodeReq) || "{}") as { model?: unknown };
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        const model = normalizeOllamaModelName(params.model);
        if (!model) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "model is required" }));
          return;
        }
        const configPath = resolveDefaultOpenClawConfigPathForOllama();
        const baseUrl = resolveOllamaApiBaseFromConfig(configPath);
        try {
          await ensureManagedOllamaRuntimeAvailable();
          const response = await fetch(`${baseUrl}/api/delete`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            const message = parseOllamaErrorMessage(errorText, response.status);
            nodeRes.writeHead(502, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: message }));
            return;
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, model }));
          log(`${ts()} POST /connections/agents/ollama/delete → ${model} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to delete Ollama model" }));
        }
        return;
      }

      // ── Agent profiles and available tools ──────────────────────────
      if (pathname === "/connections/agents/profiles" && nodeReq.method === "GET") {
        const profiles = (Object.values(PROFILE_DEFINITIONS) as AgentProfileDefinitionConfig[]).map((profile) => ({
          id: profile.id,
          label: profile.label,
          defaultName: profile.defaultName,
          description: profile.description,
          capabilities: profile.capabilities,
          routingProfile: profile.routingProfile,
          ...(profile.requiresRepo ? { requiresRepo: true } : {}),
          ...(profile.allowsNetwork ? { allowsNetwork: true } : {}),
          ...(profile.defaultNetworkAllowlist ? { defaultNetworkAllowlist: profile.defaultNetworkAllowlist } : {}),
          ...(profile.reposBaseDir ? { reposBaseDir: profile.reposBaseDir } : {}),
        }));
        const profileTools = Object.fromEntries(
          (Object.keys(PROFILE_DEFINITIONS) as AgentProfileId[]).map((profileId) => [
            profileId,
            PROFILE_ALSO_ALLOW[profileId] ?? [],
          ]),
        );
        const toolGroups = PROFILE_TOOL_GROUPS;
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ profiles, toolGroups, profileTools, allKnownTools: ALL_KNOWN_TOOLS }));
        log(`${ts()} GET /connections/agents/profiles (${Date.now() - reqStart}ms)`);
        return;
      }

      // ── List available repos under ~/.straja/repos/ ─────────────────
      if (pathname === "/repos" && nodeReq.method === "GET") {
        try {
          const repos: { name: string; path: string; hasGit: boolean }[] = [];
          if (existsSync(REPOS_BASE_DIR)) {
            const entries = readdirSync(REPOS_BASE_DIR, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith(".")) {
                const fullPath = join(REPOS_BASE_DIR, entry.name);
                repos.push({
                  name: entry.name,
                  path: fullPath,
                  hasGit: existsSync(join(fullPath, ".git")),
                });
              }
            }
          }
          repos.sort((a, b) => a.name.localeCompare(b.name));
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ repos, baseDir: REPOS_BASE_DIR }));
          log(`${ts()} GET /repos → ${repos.length} repos (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to list repos" }));
        }
        return;
      }

      // ── Detect local OpenClaw instance ──────────────────────────────
      if (pathname === "/connections/openclaw/orchestration" && nodeReq.method === "GET") {
        try {
          const settings = buildOpenClawOrchestrationSettingsPayload(await readLocalOpenClawConfig());
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(settings));
          log(`${ts()} GET /connections/openclaw/orchestration (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            detected: false,
            optimizationEnabled: false,
            routerModel: "ollama/gemma4:e4b",
            error: err?.message || "Failed to read local OpenClaw config",
          }));
        }
        return;
      }

      if (pathname === "/connections/openclaw/orchestration" && nodeReq.method === "POST") {
        let params: { enabled?: unknown } = {};
        try {
          params = JSON.parse(await collectBody(nodeReq) || "{}") as {
            enabled?: unknown;
          };
        } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        if (typeof params.enabled !== "boolean") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            error: "enabled must be a boolean",
          }));
          return;
        }
        try {
          const next = await updateLocalOpenClawOrchestrationSettings({
            enabled: params.enabled,
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(buildOpenClawOrchestrationSettingsPayload(next)));
          log(
            `${ts()} POST /connections/openclaw/orchestration → enabled=${params.enabled} (${Date.now() - reqStart}ms)`,
          );
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update optimization settings" }));
        }
        return;
      }

      if (pathname === "/connections/agents/detect-openclaw" && nodeReq.method === "GET") {
        try {
          const configPath = resolveDefaultOpenClawConfigPath();
          if (!existsSync(configPath)) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ detected: false }));
            log(`${ts()} GET /connections/agents/detect-openclaw → not found (${Date.now() - reqStart}ms)`);
            return;
          }
          const raw = await readFile(configPath, "utf-8");
          const oc = JSON.parse(raw);
          const gwPort = oc?.gateway?.port ?? 18789;
          const gwToken = oc?.gateway?.auth?.token ?? "";
          const hooksToken = oc?.hooks?.token ?? "";
          const hooksPath = normalizeAgentHookEndpointPath(oc?.hooks?.path);
          const telegramBotToken = oc?.channels?.telegram?.botToken ?? undefined;
          const pluginAllow: string[] = Array.isArray(oc?.plugins?.allow) ? oc.plugins.allow : [];
          const whatsappEnabled = pluginAllow.includes("whatsapp") || oc?.plugins?.entries?.whatsapp?.enabled === true;
          const vaultEntry = oc?.plugins?.entries?.["straja-vault"];
          const hasVaultPlugin = pluginAllow.includes("straja-vault") || !!vaultEntry;
          const existingVaultToken = vaultEntry?.config?.authToken
            ? buildAgentVaultTokenPreview(vaultEntry.config.authToken)
            : undefined;
          const memoryPromptInjectionMode = normalizeAgentMemoryPromptInjectionMode(
            vaultEntry?.config?.memoryPromptInjectionMode,
            vaultEntry?.config?.injectMemoryInPrompt,
            DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
          );

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            detected: true,
            configPath,
            gatewayUrl: `http://localhost:${gwPort}`,
            gatewayToken: gwToken,
            hooksToken,
            hooksPath,
            telegramConfigured: !!telegramBotToken,
            whatsappConfigured: whatsappEnabled,
            hasVaultPlugin,
            existingVaultToken,
            memoryPromptInjectionMode,
          }));
          log(`${ts()} GET /connections/agents/detect-openclaw → detected on :${gwPort} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ detected: false, error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/agents/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: Partial<AgentConnectionConfig> & {
          autoPair?: boolean;
          injectMemoryInPrompt?: boolean;
        };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.id || !params.name || !params.gatewayUrl) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "id, name, and gatewayUrl are required" }));
          return;
        }

        try {
          const typedParams = params as Partial<AgentConnectionConfig> & {
            id: string;
            name: string;
            gatewayUrl: string;
            autoPair?: boolean;
            injectMemoryInPrompt?: boolean;
          };
          const { agent, autoPaired, vaultTokenPreview, created } = await upsertAgentConfig(typedParams);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, autoPaired, vaultTokenPreview }));
          log(`${ts()} POST /connections/agents/config → ${created ? "added" : "updated"} ${agent.id}${autoPaired ? " (auto-paired)" : ""} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      const openAIAuthorizeMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/upstream-auth\/openai\/authorize$/);
      if (openAIAuthorizeMatch && nodeReq.method === "POST") {
        const agentId = decodeURIComponent(openAIAuthorizeMatch[1] ?? "");
        let desktopApp = false;
        try {
          const body = await collectBody(nodeReq);
          if (body.trim().length > 0) {
            const parsed = JSON.parse(body) as { desktopApp?: unknown };
            desktopApp = parsed.desktopApp === true;
          }
        } catch {
          desktopApp = false;
        }
        const config = getAgentsConfig();
        const agent = config.agents.find((entry) => entry.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }

        try {
          await ensureOpenAICodexCallbackServer();
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            error: `Failed to start local OpenAI callback server on 127.0.0.1:1455: ${err?.message || "unknown error"}`,
          }));
          return;
        }

        const session = await createOpenAICodexOAuthSession({
          redirectUri: OPENAI_CODEX_REDIRECT_URI,
          originator: "pi",
        });
        openAICodexOAuthSessions.set(session.state, {
          ...session,
          agentId,
          createdAt: Date.now(),
          desktopApp,
        });
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ authUrl: session.authUrl }));
        log(`${ts()} POST /connections/agents/${agentId}/upstream-auth/openai/authorize → URL generated (${Date.now() - reqStart}ms)`);
        return;
      }

      const upstreamAuthMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/upstream-auth(?:\/([^/]+))?$/);
      if (upstreamAuthMatch && pathname.startsWith("/connections/agents/")) {
        const agentId = decodeURIComponent(upstreamAuthMatch[1] ?? "");
        const providerParam = upstreamAuthMatch[2] ? decodeURIComponent(upstreamAuthMatch[2]) : "";
        const config = getAgentsConfig();
        const agent = config.agents.find((entry) => entry.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }

        if (nodeReq.method === "POST") {
          let body: {
            provider?: AgentUpstreamAuthProvider;
            mode?: AgentUpstreamAuthMode;
            secret?: string;
          };
          try {
            body = JSON.parse(await collectBody(nodeReq)) as typeof body;
          } catch {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }

          const provider = body.provider;
          if (provider !== "anthropic" && provider !== "openai") {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "provider must be anthropic or openai" }));
            return;
          }
          const mode = body.mode;
          if (mode !== "api_key" && mode !== "token") {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "mode must be api_key or token" }));
            return;
          }
          const secret = String(body.secret ?? "").trim();
          if (!secret) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "secret is required" }));
            return;
          }

          const authStore = getAgentAuthProfileStore();
          const profileId =
            provider === "anthropic"
              ? mode === "token"
                ? "anthropic:manual"
                : "anthropic:default"
              : "openai:default";
          authStore.profiles[profileId] =
            mode === "api_key"
              ? { type: "api_key", provider, key: secret }
              : { type: "token", provider, token: secret };
          await saveAgentAuthProfileStore(authStore);
          const configUpdated = await syncOpenClawAuthProfileConfig(agent, {
            profileId,
            provider,
            mode,
          }).catch(() => false);
          const upstreamAuth = getAgentUpstreamAuthSummary();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, configUpdated, upstreamAuth }));
          log(`${ts()} POST /connections/agents/${agentId}/upstream-auth → ${provider}/${mode} (${Date.now() - reqStart}ms)`);
          return;
        }

        if (nodeReq.method === "DELETE") {
          const provider = providerParam === "anthropic" || providerParam === "openai" ? providerParam : "";
          if (!provider) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "provider must be anthropic or openai" }));
            return;
          }
          const authStore = getAgentAuthProfileStore();
          const profileIds = provider === "anthropic"
            ? ["anthropic:default", "anthropic:manual"]
            : ["openai:default", "openai-codex:default"];
          for (const profileId of profileIds) {
            delete authStore.profiles[profileId];
          }
          await saveAgentAuthProfileStore(authStore);
          const upstreamAuth = getAgentUpstreamAuthSummary();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, upstreamAuth }));
          log(`${ts()} DELETE /connections/agents/${agentId}/upstream-auth/${provider} (${Date.now() - reqStart}ms)`);
          return;
        }
      }

      if (
        pathname.startsWith("/connections/agents/") &&
        pathname.endsWith("/vault-access/token") &&
        nodeReq.method === "POST"
      ) {
        const agentId = decodeURIComponent(
          (pathname.split("/connections/agents/")[1] ?? "").replace(/\/vault-access\/token$/, ""),
        );
        if (!agentId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent ID required" }));
          return;
        }

        try {
          const config = getAgentsConfig();
          const agent = config.agents.find((entry) => entry.id === agentId);
          if (!agent) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Agent not found" }));
            return;
          }

          const token = createAgentVaultAccessToken();
          const now = new Date().toISOString();
          const previous = normalizeAgentVaultAccess(agent.vaultAccess);
          agent.vaultAccess = {
            enabled: true,
            tokenHash: hashAgentVaultAccessToken(token),
            tokenPreview: buildAgentVaultTokenPreview(token),
            scopes: [...DEFAULT_AGENT_VAULT_ACCESS_SCOPES],
            createdAt: previous?.createdAt ?? now,
            lastRotatedAt: now,
            lastSeenAt: previous?.lastSeenAt,
          };

          const configUpdated = await syncOpenClawVaultPluginConfig(agent, {
            authToken: token,
            baseUrl: `http://localhost:${port ?? 8181}`,
            memoryPromptInjectionMode:
              agent.memoryPromptInjectionMode ?? DEFAULT_AGENT_MEMORY_PROMPT_INJECTION_MODE,
          }).catch(() => false);

          await saveAgentsConfig(config);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            token,
            configUpdated,
            vaultAccess: sanitizeAgentVaultAccess(agent.vaultAccess),
          }));
          log(`${ts()} POST /connections/agents/${agentId}/vault-access/token → issued (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (
        pathname.startsWith("/connections/agents/") &&
        pathname.endsWith("/vault-access") &&
        nodeReq.method === "DELETE"
      ) {
        const agentId = decodeURIComponent(
          (pathname.split("/connections/agents/")[1] ?? "").replace(/\/vault-access$/, ""),
        );
        if (!agentId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent ID required" }));
          return;
        }

        try {
          const config = getAgentsConfig();
          const agent = config.agents.find((entry) => entry.id === agentId);
          if (!agent) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Agent not found" }));
            return;
          }

          delete agent.vaultAccess;
          await saveAgentsConfig(config);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} DELETE /connections/agents/${agentId}/vault-access → revoked (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname.startsWith("/connections/agents/") && pathname.endsWith("/test") && nodeReq.method === "POST") {
        const agentId = decodeURIComponent((pathname.split("/connections/agents/")[1] ?? "").replace(/\/test$/, ""));
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: false, message: "Agent not found" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }

        const url = `${agent.gatewayUrl.replace(/\/+$/, "")}${normalizeAgentHookEndpointPath(agent.hooksPath)}`;
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agent.token}`,
            },
            body: JSON.stringify({
              message: "Test connection from Straja Vault. If you see this, the hook is working.",
              name: "Vault Connection Test",
              deliver: false,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            // Clear any previous notification error on successful test
            if (agent.lastError) {
              agent.lastError = undefined;
              saveAgentsConfig(config).catch(() => {});
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, message: "Connection successful" }));
            log(`${ts()} POST /connections/agents/${agentId}/test → OK (${Date.now() - reqStart}ms)`);
          } else {
            const text = await resp.text().catch(() => "");
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 200)}` }));
            log(`${ts()} POST /connections/agents/${agentId}/test → HTTP ${resp.status} (${Date.now() - reqStart}ms)`);
          }
        } catch (err: any) {
          const cause = err?.cause?.message || err?.cause?.code;
          const msg = cause ? `${err.message}: ${cause}` : (err?.message || "Connection failed");
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: false, message: msg }));
          log(`${ts()} POST /connections/agents/${agentId}/test → ERROR: ${msg}`);
        }
        return;
      }

      if (pathname.startsWith("/connections/agents/") && nodeReq.method === "DELETE") {
        const agentId = decodeURIComponent(pathname.split("/connections/agents/")[1] ?? "");
        if (!agentId) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent ID required" }));
          return;
        }

        try {
          const config = getAgentsConfig();
          const removedAgent = config.agents.find((a) => a.id === agentId);
          const before = config.agents.length;
          config.agents = config.agents.filter((a) => a.id !== agentId);
          if (config.agents.length < before) {
            await saveAgentsConfig(config);

            // Remove agent entry from openclaw.json if it was auto-paired
            if (removedAgent?.openclawConfigPath && existsSync(removedAgent.openclawConfigPath)) {
              try {
                const ocRaw = await readFile(removedAgent.openclawConfigPath, "utf-8");
                const oc = JSON.parse(ocRaw);
                if (oc.agents?.list && Array.isArray(oc.agents.list)) {
                  const ocBefore = oc.agents.list.length;
                  oc.agents.list = oc.agents.list.filter((a: { id?: string }) => a.id !== agentId);
                  if (oc.agents.list.length < ocBefore) {
                    await writeFile(removedAgent.openclawConfigPath + ".bak", ocRaw, "utf-8");
                    await writeFile(removedAgent.openclawConfigPath, JSON.stringify(oc, null, 2) + "\n", "utf-8");
                    log(`${ts()} DELETE /connections/agents/${agentId} → also removed from openclaw.json`);
                  }
                }
              } catch (ocErr: any) {
                log(`${ts()} DELETE /connections/agents/${agentId} → failed to clean openclaw.json: ${ocErr?.message}`);
              }
            }
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} DELETE /connections/agents/${agentId} → done (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Agent start endpoint
      // -----------------------------------------------------------------------

      const agentStartMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/start$/);
      if (agentStartMatch && nodeReq.method === "POST") {
        const agentId = decodeURIComponent(agentStartMatch[1]!);
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (agent.type !== "openclaw") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Start is only supported for local OpenClaw agents" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        try {
          const result = await startOpenClawGateway(agent);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            started: result.started,
            alreadyRunning: result.alreadyRunning === true,
            pending: result.pending === true,
          }));
          log(`${ts()} POST /connections/agents/${agentId}/start → ${result.alreadyRunning ? "already running" : "spawned"} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Start failed" }));
          log(`${ts()} POST /connections/agents/${agentId}/start → error: ${err?.message}`);
        }
        return;
      }

      const agentStopMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/stop$/);
      if (agentStopMatch && nodeReq.method === "POST") {
        const agentId = decodeURIComponent(agentStopMatch[1]!);
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (agent.type !== "openclaw") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Stop is only supported for local OpenClaw agents" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        try {
          const result = await stopOpenClawGateway(agent);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            stopped: result.stopped,
            alreadyStopped: result.alreadyStopped === true,
          }));
          log(`${ts()} POST /connections/agents/${agentId}/stop → ${result.alreadyStopped ? "already stopped" : "stopped"} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Stop failed" }));
          log(`${ts()} POST /connections/agents/${agentId}/stop → error: ${err?.message}`);
        }
        return;
      }

      const agentLogsMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/logs$/);
      if (agentLogsMatch && nodeReq.method === "GET") {
        const agentId = decodeURIComponent(agentLogsMatch[1]!);
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        const logsDir = resolveLocalAgentLogsDir(agent);
        const gatewayLogPath = logsDir ? join(logsDir, "agent-gateway.log") : null;
        const logs = await Promise.all([
          gatewayLogPath
            ? readLogTail(gatewayLogPath).then((content) => ({
                id: "gateway",
                label: "Agent gateway log",
                path: gatewayLogPath,
                content,
                exists: existsSync(gatewayLogPath),
              }))
            : Promise.resolve({
                id: "gateway",
                label: "Agent gateway log",
                path: null,
                content: "",
                exists: false,
              }),
        ]);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ logs }));
        log(`${ts()} GET /connections/agents/${agentId}/logs (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/logs/workspace" && nodeReq.method === "GET") {
        const logsDir = resolveWorkspaceLogsDir();
        const workspaceLogPath = logsDir ? join(logsDir, "workspace.log") : null;
        const logs = await Promise.all([
          workspaceLogPath
            ? readLogTail(workspaceLogPath).then((content) => ({
                id: "workspace",
                label: "Workspace log",
                path: workspaceLogPath,
                content,
                exists: existsSync(workspaceLogPath),
              }))
            : Promise.resolve({
                id: "workspace",
                label: "Workspace log",
                path: null,
                content: "",
                exists: false,
              }),
        ]);
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ logs }));
        log(`${ts()} GET /logs/workspace (${Date.now() - reqStart}ms)`);
        return;
      }

      // -----------------------------------------------------------------------
      // Agent restart endpoint
      // -----------------------------------------------------------------------

      const agentRestartMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/restart$/);
      if (agentRestartMatch && nodeReq.method === "POST") {
        const agentId = decodeURIComponent(agentRestartMatch[1]!);
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        const gwToken = agent.gatewayToken || agent.token;
        try {
          // Step 1: get current config hash
          const configResult = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.get", {})) as any;
          const baseHash = configResult?.hash ?? configResult?.baseHash;
          if (!baseHash) {
            nodeRes.writeHead(502, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Could not read agent config hash" }));
            return;
          }
          // Step 2: patch with meta.lastTouchedAt to trigger restart
          await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.patch", {
            baseHash,
            raw: JSON.stringify({ meta: { lastTouchedAt: new Date().toISOString() } }),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, restarting: true }));
          log(`${ts()} POST /connections/agents/${agentId}/restart → triggered (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Restart failed" }));
          log(`${ts()} POST /connections/agents/${agentId}/restart → error: ${err?.message}`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Agent channel endpoints (proxy to agent gateway via WebSocket RPC)
      // -----------------------------------------------------------------------

      // Helper: resolve agent + gateway token from path
      const agentChannelMatch = pathname.match(/^\/connections\/agents\/([^/]+)\/channels(?:\/(.+))?$/);
      if (agentChannelMatch && pathname.startsWith("/connections/agents/")) {
        const agentId = decodeURIComponent(agentChannelMatch[1]!);
        const channelPath = agentChannelMatch[2] ?? ""; // e.g. "", "whatsapp/login", "telegram/config"
        const config = getAgentsConfig();
        const agent = config.agents.find((a) => a.id === agentId);
        if (!agent) {
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Agent not found" }));
          return;
        }
        if (await refreshOpenClawAgentRuntimeConfig(agent)) {
          await saveAgentsConfig(config);
        }
        const gwToken = agent.gatewayToken || agent.token;

        try {
          // GET /connections/agents/{id}/channels — channel status
          // Agent returns: { channelOrder, channels, channelAccounts, channelDefaultAccountId, ... }
          // We transform to: { whatsapp: { status, phone?, dmPolicy?, allowFrom?, ... }, telegram: { ... } }
          if (channelPath === "" && nodeReq.method === "GET") {
            const raw = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "channels.status", {})) as any;
            const configResult = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.get", {})) as any;
            const transformed: Record<string, any> = {};
            const order = Array.from(
              new Set<string>([
                ...((raw?.channelOrder ?? Object.keys(raw?.channelAccounts ?? {})) as string[]),
                "whatsapp",
                "telegram",
              ]),
            );
            for (const ch of order) {
              const accounts: any[] = raw?.channelAccounts?.[ch] ?? [];
              const defaultId = raw?.channelDefaultAccountId?.[ch];
              const policy = readAgentChannelPolicy(configResult, ch, defaultId);
              const acct = accounts.find((a: any) => a.accountId === defaultId) ?? accounts[0];
              const summary = raw?.channels?.[ch];
              if (!acct && !summary?.configured) {
                transformed[ch] = { status: "not_configured", ...policy };
                continue;
              }
              if (!acct) {
                transformed[ch] = {
                  status: summary?.configured ? "disconnected" : "not_configured",
                  ...policy,
                };
                continue;
              }
              let status: string;
              // For polling-based channels (Telegram), running+configured = connected.
              // For socket-based channels (WhatsApp), there's a separate `connected` flag.
              const isConnected = acct.connected || (acct.running && acct.configured);
              if (isConnected) status = "connected";
              else if (acct.running) status = "connecting";
              else if (acct.configured || summary?.configured) status = "disconnected";
              else status = "not_configured";
              if (acct.lastError && !isConnected) status = "error";
              transformed[ch] = {
                status,
                accountId: acct.accountId ?? defaultId ?? undefined,
                phone: acct.phone ?? acct.name ?? undefined,
                botUsername: acct.botUsername ?? acct.name ?? undefined,
                error: acct.lastError ?? undefined,
                lastConnected: acct.lastConnectedAt ? new Date(acct.lastConnectedAt).toISOString() : undefined,
                ...policy,
              };
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(transformed));
            log(`${ts()} GET /connections/agents/${agentId}/channels (${Date.now() - reqStart}ms)`);
            return;
          }

          const channelPolicyMatch = channelPath.match(/^([^/]+)\/policy$/);
          if (channelPolicyMatch && nodeReq.method === "POST") {
            const channel = channelPolicyMatch[1] ?? "";
            if (channel !== "whatsapp" && channel !== "telegram") {
              nodeRes.writeHead(400, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ error: "Unsupported channel policy target" }));
              return;
            }
            const body = await collectBody(nodeReq);
            const params = body ? JSON.parse(body) : {};
            const dmPolicy =
              typeof params.dmPolicy === "string" ? params.dmPolicy.trim() : "";
            if (!["open", "pairing", "allowlist", "disabled"].includes(dmPolicy)) {
              nodeRes.writeHead(400, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ error: "Invalid dmPolicy" }));
              return;
            }
            const rawAllowFrom = Array.isArray(params.allowFrom) ? params.allowFrom : [];
            const allowFrom = rawAllowFrom
              .map((entry: unknown) => String(entry).trim())
              .filter(Boolean);
            const effectiveAllowFrom =
              dmPolicy === "open" && !allowFrom.includes("*")
                ? [...allowFrom, "*"]
                : allowFrom;
            const result = await patchOpenClawGatewayConfig(agent, gwToken, {
              channels: {
                [channel]: {
                  dmPolicy,
                  allowFrom: effectiveAllowFrom,
                },
              },
            });
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, ...((result as any) ?? {}) }));
            log(`${ts()} POST /connections/agents/${agentId}/channels/${channel}/policy (${Date.now() - reqStart}ms)`);
            return;
          }

          // POST /connections/agents/{id}/channels/whatsapp/login — start QR
          // Always clears stale session first, then starts fresh login with force.
          // We transform to: { status, qrDataUrl?, error? }
          if (channelPath === "whatsapp/login" && nodeReq.method === "POST") {
            // Step 1: Clear any stale session (ignore errors — may not have one)
            try {
              await agentGatewayRpc(agent.gatewayUrl, gwToken, "channels.logout", {
                channel: "whatsapp",
              }, 10_000);
            } catch { /* no existing session to clear — fine */ }

            // Step 2: Start fresh QR login
            let raw: any;
            try {
              raw = await agentGatewayRpc(agent.gatewayUrl, gwToken, "web.login.start", {
                force: true,
                timeoutMs: 60_000,
              }, 30_000);
            } catch (rpcErr: any) {
              const errMsg = rpcErr?.message || "";
              // WhatsApp extension not loaded in agent
              if (errMsg.includes("not available") || errMsg.includes("not supported")) {
                nodeRes.writeHead(200, { "Content-Type": "application/json" });
                nodeRes.end(JSON.stringify({
                  status: "error",
                  error: "WhatsApp is not enabled on this agent. Add 'whatsapp' to plugins.allow in the agent config.",
                }));
                log(`${ts()} POST /connections/agents/${agentId}/channels/whatsapp/login → provider not available`);
                return;
              }
              throw rpcErr;
            }
            const out: any = {};
            if (raw?.qrDataUrl) {
              out.status = "qr_ready";
              out.qrDataUrl = raw.qrDataUrl;
            } else if (raw?.message?.toLowerCase().includes("already")) {
              out.status = "already_connected";
            } else {
              out.status = "error";
              out.error = raw?.message || "Unknown error";
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(out));
            log(`${ts()} POST /connections/agents/${agentId}/channels/whatsapp/login (${Date.now() - reqStart}ms)`);
            return;
          }

          // POST /connections/agents/{id}/channels/whatsapp/login/poll — poll for scan
          // Agent returns: { connected: boolean, message }
          // We transform to: { status: "waiting"|"connected"|"timeout"|"error", error? }
          if (channelPath === "whatsapp/login/poll" && nodeReq.method === "POST") {
            const raw = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "web.login.wait", {
              timeoutMs: 10_000,
            }, 15_000)) as any;
            const out: any = {};
            if (raw?.connected) {
              out.status = "connected";
              // Trigger gateway restart so WhatsApp channel picks up new credentials
              patchOpenClawGatewayConfig(
                agent,
                gwToken,
                { channels: { whatsapp: { enabled: true } } },
              ).catch(() => { /* best-effort restart */ });
            } else if (raw?.message?.toLowerCase().includes("timeout")) {
              out.status = "timeout";
            } else {
              out.status = "waiting";
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(out));
            log(`${ts()} POST /connections/agents/${agentId}/channels/whatsapp/login/poll (${Date.now() - reqStart}ms)`);
            return;
          }

          // POST /connections/agents/{id}/channels/telegram/config — set bot token
          if (channelPath === "telegram/config" && nodeReq.method === "POST") {
            const body = await collectBody(nodeReq);
            const params = JSON.parse(body);
            const result = await patchOpenClawGatewayConfig(agent, gwToken, {
              channels: { telegram: { botToken: params.botToken, enabled: true } },
            });
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, ...((result as any) ?? {}) }));
            log(`${ts()} POST /connections/agents/${agentId}/channels/telegram/config (${Date.now() - reqStart}ms)`);
            return;
          }

          // POST /connections/agents/{id}/channels/{channel}/pairing/approve — approve DM pairing code
          const pairingApproveMatch = channelPath.match(/^([^/]+)\/pairing\/approve$/);
          if (pairingApproveMatch && nodeReq.method === "POST") {
            const channel = pairingApproveMatch[1] ?? "";
            let params: { code?: unknown; owner?: unknown } = {};
            try {
              const body = await collectBody(nodeReq);
              params = body ? (JSON.parse(body) as typeof params) : {};
            } catch {
              nodeRes.writeHead(400, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
              return;
            }
            const code = typeof params.code === "string" ? params.code.trim() : "";
            const owner = params.owner === true;
            if (!code) {
              nodeRes.writeHead(400, { "Content-Type": "application/json" });
              nodeRes.end(JSON.stringify({ error: "Pairing code is required" }));
              return;
            }
            const approved = await approveOpenClawPairingCode(agent, channel, code, owner);
            if (owner && approved.approvedId) {
              const ownerTarget = `${approved.channel}:${approved.approvedId}`;
              const config = getAgentsConfig();
              const configAgent = config.agents.find((entry) => entry.id === agentId);
              if (configAgent) {
                configAgent.ownerTargets = {
                  ...(configAgent.ownerTargets ?? {}),
                  [approved.channel]: ownerTarget,
                };
                await saveAgentsConfig(config);
              }
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(
              JSON.stringify({
                ok: true,
                channel: approved.channel,
                approvedId: approved.approvedId ?? null,
              }),
            );
            log(
              `${ts()} POST /connections/agents/${agentId}/channels/${approved.channel}/pairing/approve (${Date.now() - reqStart}ms)`,
            );
            return;
          }

          // POST /connections/agents/{id}/channels/{channel}/disconnect
          if (channelPath.endsWith("/disconnect") && nodeReq.method === "POST") {
            const channel = channelPath.replace(/\/disconnect$/, "");
            const result = await agentGatewayRpc(agent.gatewayUrl, gwToken, "channels.logout", {
              channel,
            });
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, ...((result as any) ?? {}) }));
            log(`${ts()} POST /connections/agents/${agentId}/channels/${channel}/disconnect (${Date.now() - reqStart}ms)`);
            return;
          }

          // POST /connections/agents/{id}/channels/{channel}/reset
          // Clean reset: logout channel + restart agent (for stuck/limbo states)
          if (channelPath.endsWith("/reset") && nodeReq.method === "POST") {
            const channel = channelPath.replace(/\/reset$/, "");
            // Step 1: logout (clear stale session/credentials)
            try {
              await agentGatewayRpc(agent.gatewayUrl, gwToken, "channels.logout", { channel });
            } catch {
              // Logout may fail if channel is already dead — that's fine, continue to restart
            }
            // Step 2: restart agent
            let restarted = false;
            try {
              const configResult = (await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.get", {})) as any;
              const baseHash = configResult?.hash ?? configResult?.baseHash;
              if (baseHash) {
                await agentGatewayRpc(agent.gatewayUrl, gwToken, "config.patch", {
                  baseHash,
                  raw: JSON.stringify({ meta: { lastTouchedAt: new Date().toISOString() } }),
                });
                restarted = true;
              }
            } catch {
              // Restart best-effort
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, channel, cleared: true, restarted }));
            log(`${ts()} POST /connections/agents/${agentId}/channels/${channel}/reset → cleared + ${restarted ? "restarted" : "restart failed"} (${Date.now() - reqStart}ms)`);
            return;
          }

          // Unknown channel sub-path
          nodeRes.writeHead(404, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Unknown channel endpoint" }));
          return;
        } catch (err: any) {
          const msg = err?.message || "Agent gateway error";
          nodeRes.writeHead(502, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: msg }));
          log(`${ts()} ${nodeReq.method} /connections/agents/${agentId}/channels/${channelPath} → 502: ${msg}`);
          return;
        }
      }

      // -----------------------------------------------------------------------
      // Browser connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/browser/status" && nodeReq.method === "GET") {
        const browserStatus = getBrowserStatus();
        // Merge with config from store if available
        const doc = store.getDocumentWithContent("_config", "browser.json");
        if (doc?.content && browserStatus.status === "not_configured") {
          try {
            const cfg = JSON.parse(doc.content) as BrowserConfig;
            setBrowserConfig(cfg);
            const updated = getBrowserStatus();
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify(updated));
            log(`${ts()} GET /connections/browser/status → ${updated.status} (${Date.now() - reqStart}ms)`);
            return;
          } catch { /* fall through */ }
        }
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(browserStatus));
        log(`${ts()} GET /connections/browser/status → ${browserStatus.status} (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/connections/browser/policy" && nodeReq.method === "GET") {
        try {
          const policy = browserSecurity.getPolicy();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(policy));
          log(`${ts()} GET /connections/browser/policy (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to load browser policy" }));
        }
        return;
      }

      if (pathname === "/connections/browser/policy" && (nodeReq.method === "POST" || nodeReq.method === "PUT")) {
        const body = await collectBody(nodeReq);
        try {
          const parsed = body ? JSON.parse(body) : {};
          const policy = nodeReq.method === "PUT"
            ? await browserSecurity.putPolicy(parsed as BrowserPolicy)
            : await browserSecurity.patchPolicy(parsed as any);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, policy }));
          log(`${ts()} ${nodeReq.method} /connections/browser/policy (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Invalid browser policy" }));
        }
        return;
      }

      if (pathname === "/connections/browser/policy/reset" && nodeReq.method === "POST") {
        try {
          const policy = await browserSecurity.resetPolicy();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, policy }));
          log(`${ts()} POST /connections/browser/policy/reset (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to reset browser policy" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Guard connection endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/connections/guard/status" && nodeReq.method === "GET") {
        try {
          const status = await getGuardStatus();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(status));
          log(`${ts()} GET /connections/guard/status → ${status.running ? "running" : "stopped"} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to get guard status" }));
        }
        return;
      }

      if (pathname === "/connections/guard/config" && nodeReq.method === "GET") {
        try {
          const config = getGuardConfig(store);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(config ?? {}));
          log(`${ts()} GET /connections/guard/config (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to get guard config" }));
        }
        return;
      }

      if (pathname === "/connections/guard/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        try {
          const updates = body ? JSON.parse(body) : {};
          const config = updateGuardConfig(store, updates);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, config }));
          log(`${ts()} POST /connections/guard/config (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Invalid guard config" }));
        }
        return;
      }

      if (pathname === "/connections/guard/start" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        try {
          const configOverride = body ? JSON.parse(body) : undefined;
          const result = await startGuard(store, configOverride);
          const status = result.ok ? 200 : 500;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/guard/start → ${result.ok ? "started" : result.error} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/guard/stop" && nodeReq.method === "POST") {
        try {
          const result = await stopGuard();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/guard/stop → ${result.alreadyStopped ? "already stopped" : "stopped"} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return;
      }

      if (pathname === "/connections/guard/restart" && nodeReq.method === "POST") {
        try {
          const result = await restartGuard(store);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/guard/restart → ${result.ok ? "restarted" : result.error} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return;
      }

      // Webhook receiver for Guard activation events
      if (pathname === "/connections/guard/activation" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        try {
          const event = JSON.parse(body || "{}") as GuardActivationEvent;
          await ingestGuardActivation(store, event);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/guard/activation → ingested ${event.request_id} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to ingest activation event" }));
        }
        return;
      }

      // Guard audit events (filtered view)
      if (pathname === "/connections/guard/events" && nodeReq.method === "GET") {
        const params = new URL(nodeReq.url || "/", `http://${nodeReq.headers.host || "localhost"}`).searchParams;
        const date = params.get("date") ?? undefined;
        try {
          let result = getAuditGeneric(store, "guard", date, "straja_guard");
          if (!date && result.entries.length === 0 && result.dates.length > 0) {
            result = getAuditGeneric(store, "guard", result.dates[0], "straja_guard");
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} GET /connections/guard/events date=${result.date ?? date ?? "latest"} entries=${result.entries.length} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to fetch guard events" }));
        }
        return;
      }

      if (pathname === "/connections/guard/logs" && nodeReq.method === "GET") {
        try {
          const guardLogPath = process.env.STRAJA_GUARD_LOG_PATH?.trim() || null;
          const logs = await Promise.all([
            guardLogPath
              ? readLogTail(guardLogPath).then((content) => ({
                  id: "guard",
                  label: "Guard log",
                  path: guardLogPath,
                  content,
                  exists: existsSync(guardLogPath),
                }))
              : Promise.resolve({
                  id: "guard",
                  label: "Guard log",
                  path: null,
                  content: "",
                  exists: false,
                }),
          ]);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ logs }));
          log(`${ts()} GET /connections/guard/logs (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to fetch guard logs" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Unified audit endpoints
      // -----------------------------------------------------------------------

      if (pathname === "/audit/append" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { category?: string; entry?: Record<string, unknown>; entries?: Record<string, unknown>[] };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const category = params.category;
        if (!category || !(AUDIT_CATEGORIES as readonly string[]).includes(category)) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Invalid category. Must be one of: ${AUDIT_CATEGORIES.join(", ")}` }));
          return;
        }

        const items: Record<string, unknown>[] = params.entries
          ?? (params.entry ? [params.entry] : []);
        if (items.length === 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Provide 'entry' or 'entries'" }));
          return;
        }

        try {
          for (const item of items) {
            await appendAuditEntry(store, category, item);
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, count: items.length }));
          log(`${ts()} POST /audit/append category=${category} count=${items.length} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to append audit entry" }));
        }
        return;
      }

      if (pathname === "/audit" && nodeReq.method === "GET" && !acceptsHtmlNavigation) {
        try {
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const date = reqUrl.searchParams.get("date") ?? undefined;
          const categoryFilter = reqUrl.searchParams.get("category") ?? undefined;

          const categoriesToQuery = categoryFilter
            ? (AUDIT_CATEGORIES as readonly string[]).includes(categoryFilter)
              ? [categoryFilter]
              : []
            : [...AUDIT_CATEGORIES];

          const categories: Record<string, string[]> = {};
          let allEntries: Array<Record<string, unknown> & { _category: string }> = [];

          for (const cat of categoriesToQuery) {
            const result = getAuditGeneric<Record<string, unknown>>(store, cat, date);
            categories[cat] = result.dates;
            for (const entry of result.entries) {
              allEntries.push({ ...entry, _category: cat });
            }
          }

          // Sort by timestamp descending
          allEntries.sort((a, b) => {
            const ta = (a.timestamp as string) ?? "";
            const tb = (b.timestamp as string) ?? "";
            return tb.localeCompare(ta);
          });

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            date: date ?? null,
            category: categoryFilter ?? null,
            categories,
            entries: allEntries,
          }));
          log(`${ts()} GET /audit date=${date ?? "all"} category=${categoryFilter ?? "all"} entries=${allEntries.length} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to read audit" }));
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Per-category audit endpoints (backward compat)
      // -----------------------------------------------------------------------

      if (pathname === "/connections/browser/audit" && nodeReq.method === "GET") {
        try {
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const date = reqUrl.searchParams.get("date") ?? undefined;
          const auditData = await browserSecurity.getAudit(date);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(auditData));
          log(`${ts()} GET /connections/browser/audit (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to read browser audit" }));
        }
        return;
      }

      if (pathname === "/connections/web-search/audit" && nodeReq.method === "GET") {
        try {
          const reqUrl = new URL(nodeReq.url!, `http://${nodeReq.headers.host}`);
          const date = reqUrl.searchParams.get("date") ?? undefined;
          const auditData = await webSearch.getAudit(date);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(auditData));
          log(`${ts()} GET /connections/web-search/audit (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to read web search audit" }));
        }
        return;
      }

      if (pathname === "/connections/web-search/policy" && nodeReq.method === "GET") {
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(webSearch.getPolicy()));
        return;
      }

      if (pathname === "/connections/web-search/policy" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let patch: Record<string, unknown>;
        try { patch = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const policy = await webSearch.updatePolicy(patch);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, policy }));
          log(`${ts()} POST /connections/web-search/policy (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update web search policy" }));
        }
        return;
      }

      if (pathname === "/connections/web-search/duckduckgo" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { query?: string; limit?: number };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        try {
          const result = await webSearch.searchDuckDuckGo(
            typeof params.query === "string" ? params.query : "",
            typeof params.limit === "number" ? params.limit : undefined,
          );
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/web-search/duckduckgo (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const status = (err instanceof WebSearchValidationError) ? 400
            : (err instanceof WebSearchBlockedError) ? 403
            : 502;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "DuckDuckGo search failed" }));
        }
        return;
      }

      if (pathname === "/connections/web-fetch/policy" && nodeReq.method === "GET") {
        nodeRes.writeHead(200, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify(webFetch.getPolicy()));
        return;
      }

      if (pathname === "/connections/web-fetch/policy" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let patch: Record<string, unknown>;
        try { patch = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        try {
          const policy = await webFetch.updatePolicy(patch);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, policy }));
          log(`${ts()} POST /connections/web-fetch/policy (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to update web fetch policy" }));
        }
        return;
      }

      if (pathname === "/connections/web-fetch/policy/reset" && nodeReq.method === "POST") {
        try {
          const policy = await webFetch.resetPolicy();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true, policy }));
          log(`${ts()} POST /connections/web-fetch/policy/reset (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to reset web fetch policy" }));
        }
        return;
      }

      // Domain approval endpoint — approve a domain for web-fetch and/or browser (navigate + post)
      if (pathname === "/connections/approve-domain" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { domain?: string; scope?: string; decision?: string; capability?: string };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const domain = (params.domain ?? "").trim().toLowerCase();
        if (!domain) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "domain is required" }));
          return;
        }

        const decision = normalizeDomainApproval(params.decision);
        if (!decision) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: 'decision must be "once", "always", or "remove"' }));
          return;
        }

        const scope = (params.scope ?? "all").toLowerCase().trim();
        const capability = (params.capability ?? "navigate").toLowerCase().trim();
        const applyWebFetch = scope === "all" || scope === "web-fetch";
        const applyBrowser = scope === "all" || scope === "browser";
        const applyNavigate = capability === "navigate" || capability === "all";
        const applyPost = capability === "post" || capability === "all";

        try {
          const results: string[] = [];

          if (decision === "once") {
            if (applyNavigate) {
              if (applyWebFetch) webFetch.approveOnce(domain);
              if (applyBrowser) browserSecurity.approveOnce(domain);
              results.push("navigation");
            }
            if (applyPost && applyBrowser) {
              browserSecurity.postApproveOnce(domain);
              results.push("posting");
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, domain, decision: "once", capability, message: `Domain ${domain} approved for one-time ${results.join(" and ")} access.` }));
          } else if (decision === "remove") {
            const normalized = domain.toLowerCase().replace(/\.+$/, "");
            if (applyNavigate) {
              if (applyWebFetch) {
                const fp = webFetch.getPolicy();
                const filtered = fp.allowedDomains.filter(
                  (r) => r.domain.toLowerCase().replace(/\.+$/, "") !== normalized,
                );
                if (filtered.length < fp.allowedDomains.length) {
                  await webFetch.updatePolicy({ allowedDomains: filtered });
                  results.push("web-fetch domain allow list");
                }
              }
              if (applyBrowser) {
                const bp = browserSecurity.getPolicy();
                const filtered = bp.allowedDomains.filter(
                  (r) => r.domain.toLowerCase().replace(/\.+$/, "") !== normalized,
                );
                if (filtered.length < bp.allowedDomains.length) {
                  await browserSecurity.patchPolicy({ allowedDomains: filtered });
                  results.push("browser domain allow list");
                }
              }
            }
            if (applyPost && applyBrowser) {
              const removed = await browserSecurity.removeEgressRule(domain);
              if (removed) results.push("browser egress rules");
            }
            const msg = results.length > 0
              ? `Domain ${domain} removed from ${results.join(" and ")}.`
              : `Domain ${domain} was not found on any allow list or egress rule.`;
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, domain, decision: "remove", capability, message: msg }));
          } else {
            // "always"
            if (applyNavigate) {
              if (applyWebFetch) {
                await webFetch.updatePolicy({
                  allowedDomains: [
                    ...webFetch.getPolicy().allowedDomains,
                    { domain, includeSubdomains: true },
                  ],
                });
                results.push("web-fetch allow list");
              }
              if (applyBrowser) {
                const bp = browserSecurity.getPolicy();
                await browserSecurity.patchPolicy({
                  allowedDomains: [
                    ...bp.allowedDomains,
                    { domain, includeSubdomains: true },
                  ],
                });
                results.push("browser allow list");
              }
            }
            if (applyPost && applyBrowser) {
              await browserSecurity.addEgressRule(domain);
              results.push("browser egress rules (posting enabled)");
            }
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, domain, decision: "always", capability, message: `Domain ${domain} added permanently to ${results.join(" and ")}.` }));
          }
          log(`${ts()} POST /connections/approve-domain ${domain} ${decision} capability=${capability} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to approve domain" }));
        }
        return;
      }

      if (pathname === "/connections/web-fetch" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { url?: string; extractMode?: string; maxChars?: number; domainApproval?: string };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        try {
          const result = await webFetch.fetch({
            url: typeof params.url === "string" ? params.url : "",
            extractMode: params.extractMode === "text" ? "text" : "markdown",
            maxChars: typeof params.maxChars === "number" ? params.maxChars : undefined,
            domainApproval: (() => { const d = normalizeDomainApproval(params.domainApproval); return d === "remove" ? undefined : d; })(),
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/web-fetch ${result.finalUrl} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const status = (err instanceof WebFetchValidationError) ? 400
            : (err instanceof WebFetchSsrfBlockedError || err instanceof WebFetchBlockedError) ? 403
            : 502;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Web fetch failed" }));
        }
        return;
      }

      if (pathname === "/connections/browser/config" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: Partial<BrowserConfig>;
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        try {
          const config: BrowserConfig = {
            enabled: params.enabled !== false,
            headless: params.headless,
            cdpEndpoint: params.cdpEndpoint,
            userDataDir: params.userDataDir,
            isolated: params.isolated,
            allowedOrigins: params.allowedOrigins,
            blockedOrigins: params.blockedOrigins,
            capabilities: params.capabilities,
          };

          const now = new Date().toISOString();
          const content = JSON.stringify(config, null, 2);
          const cfgHash = await hashContent(content);
          store.insertContent(cfgHash, content, now);
          const existing = store.findActiveDocument("_config", "browser.json");
          if (existing) {
            store.updateDocument(existing.id, "browser.json", cfgHash, now);
          } else {
            store.insertDocument("_config", "browser.json", "browser.json", cfgHash, now, now);
          }
          setBrowserConfig(config);

          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
          log(`${ts()} POST /connections/browser/config → saved (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/browser/start" && nodeReq.method === "POST") {
        try {
          if (isBrowserRunning()) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ ok: true, message: "Already running" }));
            return;
          }

          // Load config from store
          const doc = store.getDocumentWithContent("_config", "browser.json");
          if (!doc?.content) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Browser not configured. Save config first." }));
            return;
          }

          const config = JSON.parse(doc.content) as BrowserConfig;
          await startBrowserService(config);
          log(`${ts()} POST /connections/browser/start → started (${Date.now() - reqStart}ms)`);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          log(`${ts()} POST /connections/browser/start → ERROR: ${err?.message}`);
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to start browser" }));
        }
        return;
      }

      if (pathname === "/connections/browser/stop" && nodeReq.method === "POST") {
        try {
          await stopBrowserService();
          log(`${ts()} POST /connections/browser/stop → stopped (${Date.now() - reqStart}ms)`);
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to stop browser" }));
        }
        return;
      }

      if (pathname === "/connections/browser/tools" && nodeReq.method === "GET") {
        try {
          if (!isBrowserRunning()) {
            nodeRes.writeHead(200, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ tools: [] }));
            return;
          }
          const tools = await browserSecurity.listExposedTools();
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ tools }));
          log(`${ts()} GET /connections/browser/tools → ${tools.length} tools (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed" }));
        }
        return;
      }

      if (pathname === "/connections/browser/uploads/stage" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: {
          path?: string;
          contentBase64?: string;
          mimeType?: string;
          overwrite?: boolean;
          originalName?: string;
        };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (typeof params.path !== "string" || typeof params.contentBase64 !== "string") {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "path and contentBase64 are required" }));
          return;
        }

        let stagedPath: string;
        try {
          stagedPath = normalizeBrowserUploadStagePath(params.path);
        } catch (err: any) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Invalid upload path" }));
          return;
        }

        const compactBase64 = params.contentBase64.replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64) || compactBase64.length % 4 !== 0) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "contentBase64 must be valid base64" }));
          return;
        }

        const bytes = Buffer.from(compactBase64, "base64");
        const policy = browserSecurity.getPolicy();
        if (bytes.byteLength > policy.uploadConstraints.maxFileSizeBytes) {
          nodeRes.writeHead(413, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            error: `Staged file too large (${bytes.byteLength} > ${policy.uploadConstraints.maxFileSizeBytes})`,
          }));
          return;
        }

        const existing = store.findActiveDocument(BROWSER_UPLOAD_COLLECTION, stagedPath);
        if (existing && params.overwrite !== true) {
          nodeRes.writeHead(409, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `File already exists in uploads: ${stagedPath}` }));
          return;
        }

        try {
          const now = new Date().toISOString();
          const envelope = encodeBrowserUploadBlobEnvelope(bytes, {
            mimeType: typeof params.mimeType === "string" ? params.mimeType : undefined,
            originalName: typeof params.originalName === "string" ? params.originalName : undefined,
          });
          const hash = await hashContent(envelope);
          store.insertContent(hash, envelope, now);
          if (existing) {
            store.updateDocument(existing.id, existing.title, hash, now);
          } else {
            store.insertDocument(BROWSER_UPLOAD_COLLECTION, stagedPath, stagedPath, hash, now, now);
          }

          nodeRes.writeHead(existing ? 200 : 201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({
            ok: true,
            collection: BROWSER_UPLOAD_COLLECTION,
            path: stagedPath,
            size: bytes.byteLength,
            mimeType: typeof params.mimeType === "string" ? params.mimeType : null,
            overwritten: !!existing,
          }));
          log(`${ts()} POST /connections/browser/uploads/stage ${stagedPath} (${bytes.byteLength}b, ${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: err?.message || "Failed to stage browser upload" }));
        }
        return;
      }

      if (pathname === "/connections/browser/uploads/stage-from-media" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: {
          mediaUrl?: string;
          mediaPath?: string;
          path?: string;
          overwrite?: boolean;
        };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        try {
          const staged = await stageBrowserUploadFromVaultMedia(store, params);
          nodeRes.writeHead(staged.overwritten ? 200 : 201, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(staged));
          log(`${ts()} POST /connections/browser/uploads/stage-from-media ${staged.sourcePath} -> ${staged.path} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Failed to stage media upload";
          const status = /required|must reference|not found|invalid|already exists/i.test(message) ? 400 : 500;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      const screenshotRouteMatch =
        nodeReq.method === "GET" ? BROWSER_SCREENSHOT_FETCH_ROUTE_RE.exec(pathname) : null;
      if (screenshotRouteMatch) {
        const screenshotId = screenshotRouteMatch[1] ?? "";
        const token = requestUrl.searchParams.get("token") ?? "";
        const ticket = browserScreenshotTickets.resolve({ id: screenshotId, token });
        if (!ticket.ok) {
          nodeRes.writeHead(ticket.status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: ticket.error }));
          return;
        }

        const screenshotPath = ticket.screenshotPath;

        let bytes: Buffer;
        let mimeType = "application/octet-stream";

        if (screenshotPath.startsWith("fs:")) {
          // Filesystem-backed file (PDFs — too large for SQLite blob envelopes)
          const fsPath = screenshotPath.slice(3);
          try {
            bytes = await readFile(fsPath);
            mimeType = fsPath.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
          } catch (err: any) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "File not found" }));
            return;
          }
        } else {
          // SQLite-backed file (screenshots — small enough for blob envelopes)
          const doc = store.getDocumentWithContent(BROWSER_SCREENSHOT_COLLECTION, screenshotPath);
          if (!doc) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: "Screenshot not found" }));
            return;
          }

          try {
            const blob = decodeBrowserUploadBlobEnvelope(doc.content);
            if (blob) {
              bytes = blob.bytes;
              if (blob.mimeType) mimeType = blob.mimeType;
            } else {
              bytes = Buffer.from(doc.content, "utf8");
            }
          } catch (err: any) {
            nodeRes.writeHead(500, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: err?.message || "Failed to load screenshot" }));
            return;
          }
        }

        const disposition = mimeType === "application/pdf" ? "attachment" : "inline";
        const ssFileName = basename(screenshotPath.replace(/^fs:/, ''));
        const ssAsciiName = ssFileName.replace(/[^\x20-\x7E]/g, "_");
        const ssUtf8Name = encodeURIComponent(ssFileName).replace(/'/g, "%27");
        const ssContentDisposition = ssAsciiName === ssFileName
          ? `${disposition}; filename="${ssFileName}"`
          : `${disposition}; filename="${ssAsciiName}"; filename*=UTF-8''${ssUtf8Name}`;
        nodeRes.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": ssContentDisposition,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        nodeRes.end(bytes);
        log(`${ts()} GET /connections/browser/screenshots/file/${screenshotId} ${screenshotPath} (${bytes.byteLength}b, ${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/connections/browser/upload" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: {
          collection?: string;
          path?: string;
          mediaUrl?: string;
          mediaPath?: string;
          stagePath?: string;
          overwrite?: boolean;
        };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        let collection = typeof params.collection === "string" ? params.collection.trim() : "";
        let path = typeof params.path === "string" ? params.path.trim() : "";
        if ((!collection || !path) && (typeof params.mediaUrl === "string" || typeof params.mediaPath === "string")) {
          try {
            const staged = await stageBrowserUploadFromVaultMedia(store, {
              mediaUrl: params.mediaUrl,
              mediaPath: params.mediaPath,
              path: params.stagePath,
              overwrite: params.overwrite,
            });
            collection = staged.collection;
            path = staged.path;
          } catch (err: any) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(JSON.stringify({ error: err?.message || "Failed to stage media upload" }));
            return;
          }
        }

        if (!collection || !path) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "collection and path are required unless mediaUrl/mediaPath is provided" }));
          return;
        }

        if (!isBrowserRunning()) {
          nodeRes.writeHead(503, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Browser service is not running" }));
          return;
        }

        try {
          const result = await browserSecurity.vaultUpload({
            collection,
            path,
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/browser/upload ${collection}/${path} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Browser upload failed";
          const status = /blocked|disabled|allow|policy|required|not found|too large|extension/i.test(message) ? 403 : 500;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (pathname === "/connections/browser/tool" && nodeReq.method === "POST") {
        const body = await collectBody(nodeReq);
        let params: { name: string; arguments?: Record<string, unknown> };
        try { params = JSON.parse(body); } catch {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!params.name) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "Tool name is required" }));
          return;
        }

        if (!EXPOSED_PLAYWRIGHT_BROWSER_TOOL_SET.has(params.name)) {
          try {
            await browserSecurity.callExposedTool(params.name, params.arguments ?? {});
          } catch {
            // policy controller already emitted audit log
          }
          nodeRes.writeHead(403, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `Browser tool not allowed: ${params.name}` }));
          return;
        }

        try {
          // Pre-PDF-export pipeline: dismiss cookie consent, force lazy images
          // to load, scroll page to trigger image fetch, inject print-background CSS.
          if (params.name === "browser_pdf_save") {
            try {
              await callBrowserTool("browser_evaluate", {
                function: `() => {
                  // --- 1. Remove cookie/consent dialogs ---
                  const consentKeywords = /cookie|consent|gdpr|privacy.?(?:settings|policy|notice|banner)|data.?(?:protection|choice)|ccpa|advertising/i;
                  const consentSelectors = [
                    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
                    '#onetrust-consent-sdk', '#onetrust-banner-sdk',
                    '.fc-consent-root', '.qc-cmp2-container',
                    '[class*="cookie-banner"]', '[id*="cookie-banner"]',
                    '[class*="cookie-consent"]', '[id*="cookie-consent"]',
                    '[class*="cookieBanner"]', '[id*="cookieBanner"]',
                    '[class*="consent-banner"]', '[id*="consent-banner"]',
                    '[class*="cmp-"]', '[id*="cmp-"]',
                    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
                    '[data-testid*="consent" i]', '[data-testid*="cookie" i]',
                  ];
                  for (const sel of consentSelectors) {
                    document.querySelectorAll(sel).forEach(el => el.remove());
                  }
                  // Remove dialogs (open or not) with consent text
                  document.querySelectorAll('dialog, [role="dialog"]').forEach(el => {
                    if (consentKeywords.test(el.textContent || '')) el.remove();
                  });
                  // Remove consent-related iframes (SourcePoint, Cookiebot, OneTrust, etc.)
                  // These CMPs render inside iframes which we can't reach into,
                  // but we CAN remove the iframe element itself from the parent.
                  document.querySelectorAll('iframe').forEach(iframe => {
                    const src = (iframe.src || '').toLowerCase();
                    const id = (iframe.id || '').toLowerCase();
                    const title = (iframe.title || '').toLowerCase();
                    if (consentKeywords.test(src) || consentKeywords.test(id) || consentKeywords.test(title) ||
                        /sourcepoint|sp_message|quantcast|onetrust|cookiebot|trustarc|evidon|iubenda/.test(src + id + title)) {
                      iframe.remove();
                    }
                  });
                  // Remove fixed-position overlays with consent text
                  const allEls = document.querySelectorAll('div, section, aside, [role="banner"]');
                  allEls.forEach(el => {
                    const style = window.getComputedStyle(el);
                    if ((style.position === 'fixed' || style.position === 'sticky') && consentKeywords.test(el.textContent || '')) {
                      el.remove();
                    }
                  });
                  // Remove semi-transparent backdrop overlays
                  document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-bg"], [class*="Overlay"]').forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed' && parseFloat(style.opacity || '1') < 1) {
                      el.remove();
                    }
                  });
                  document.body.style.overflow = '';
                  document.documentElement.style.overflow = '';

                  // --- 2. Force lazy-loaded images to load ---
                  document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                    img.loading = 'eager';
                  });
                  // Also handle images with data-src (common lazy-load pattern)
                  document.querySelectorAll('img[data-src]').forEach(img => {
                    if (!img.src || img.src === '' || img.src.startsWith('data:')) {
                      img.src = img.dataset.src;
                    }
                  });
                  // Handle srcset lazy loading
                  document.querySelectorAll('img[data-srcset]').forEach(img => {
                    if (!img.srcset) {
                      img.srcset = img.dataset.srcset;
                    }
                  });
                  // Handle <source> elements in <picture> tags
                  document.querySelectorAll('source[data-srcset]').forEach(source => {
                    if (!source.srcset) {
                      source.srcset = source.dataset.srcset;
                    }
                  });
                  // Force IntersectionObserver-based lazy loaders to trigger
                  document.querySelectorAll('img').forEach(img => {
                    if (!img.complete && img.src) {
                      const clone = img.cloneNode(true);
                      img.parentNode?.replaceChild(clone, img);
                    }
                  });

                  // --- 3. Force background printing ---
                  const s = document.createElement('style');
                  s.id = '__vault_print_bg';
                  s.textContent = '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }';
                  document.head.appendChild(s);
                }`,
              });
            } catch {
              // Best-effort
            }

            // Scroll through the page to trigger any remaining lazy-load observers,
            // then wait for images to finish loading.
            try {
              await callBrowserTool("browser_evaluate", {
                function: `async () => {
                  // Scroll to bottom in steps to trigger IntersectionObserver lazy loaders
                  const step = window.innerHeight;
                  const maxScroll = document.body.scrollHeight;
                  for (let y = 0; y <= maxScroll; y += step) {
                    window.scrollTo(0, y);
                    await new Promise(r => setTimeout(r, 100));
                  }
                  // Scroll back to top
                  window.scrollTo(0, 0);

                  // Wait for all images to finish loading (up to 5 seconds)
                  const images = Array.from(document.querySelectorAll('img'));
                  const deadline = Date.now() + 5000;
                  while (Date.now() < deadline) {
                    const pending = images.filter(img => img.src && !img.complete);
                    if (pending.length === 0) break;
                    await new Promise(r => setTimeout(r, 200));
                  }
                }`,
              });
            } catch {
              // Best-effort: PDF will generate with whatever images loaded
            }
          }

          let result = await browserSecurity.callExposedTool(params.name, params.arguments ?? {});

          // Clean up injected CSS after PDF generation
          if (params.name === "browser_pdf_save") {
            try {
              await callBrowserTool("browser_evaluate", {
                function: `() => document.getElementById('__vault_print_bg')?.remove()`,
              });
            } catch {
              // Ignore cleanup failures
            }
          }

          if (params.name === "browser_take_screenshot") {
            try {
              result = await persistBrowserScreenshotAndDecorateResult(
                store,
                result,
                port,
                browserScreenshotTickets,
              );
            } catch (persistErr: any) {
              log(`${ts()} POST /connections/browser/tool ${params.name} screenshot-persist-error: ${persistErr?.message || String(persistErr)}`);
            }
          } else if (params.name === "browser_pdf_save") {
            try {
              result = await persistBrowserPdfAndDecorateResult(
                store,
                result,
                port,
                browserScreenshotTickets,
              );
            } catch (persistErr: any) {
              log(`${ts()} POST /connections/browser/tool ${params.name} pdf-persist-error: ${persistErr?.message || String(persistErr)}`);
            }
          }
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify(result));
          log(`${ts()} POST /connections/browser/tool ${params.name} (${Date.now() - reqStart}ms)`);
        } catch (err: any) {
          const message = err?.message || "Tool call failed";
          const status = /allowlisted|blocked|disabled|Unsupported scheme|URL unavailable|Invalid URL|Domain not allowlisted/i.test(message)
            ? 403
            : /not running/i.test(message)
              ? 503
              : 500;
          nodeRes.writeHead(status, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (pathname === "/mcp" && nodeReq.method === "POST") {
        const rawBody = await collectBody(nodeReq);
        const body = JSON.parse(rawBody);
        const label = describeRequest(body);
        const url = `http://localhost:${port}${pathname}`;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(nodeReq.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
        const request = new Request(url, { method: "POST", headers, body: rawBody });
        const response = await transport.handleRequest(request, { parsedBody: body });
        nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
        nodeRes.end(Buffer.from(await response.arrayBuffer()));
        log(`${ts()} POST /mcp ${label} (${Date.now() - reqStart}ms)`);
        return;
      }

      if (pathname === "/mcp") {
        const url = `http://localhost:${port}${pathname}`;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(nodeReq.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
        const rawBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD" ? await collectBody(nodeReq) : undefined;
        const request = new Request(url, { method: nodeReq.method || "GET", headers, ...(rawBody ? { body: rawBody } : {}) });
        const response = await transport.handleRequest(request);
        nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
        nodeRes.end(Buffer.from(await response.arrayBuffer()));
        return;
      }

      // --- Static file serving for web UI ---
      const webDistDir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/dist");
      const MIME_TYPES: Record<string, string> = {
        ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
        ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
        ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
      };
      try {
        // Try to serve the requested file
        const safePath = pathname.replace(/\.\./g, "");
        const filePath = join(webDistDir, safePath === "/" ? "index.html" : safePath);
        const fileStat = await stat(filePath);
        if (fileStat.isFile()) {
          const ext = filePath.slice(filePath.lastIndexOf("."));
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const content = await readFile(filePath);
          nodeRes.writeHead(200, { "Content-Type": contentType, "Content-Length": content.length });
          nodeRes.end(content);
          return;
        }
      } catch {
        // File not found - fall through to SPA fallback
      }
      // SPA fallback: serve index.html for client-side routing
      try {
        const indexPath = join(webDistDir, "index.html");
        const indexContent = await readFile(indexPath);
        nodeRes.writeHead(200, { "Content-Type": "text/html", "Content-Length": indexContent.length });
        nodeRes.end(indexContent);
        return;
      } catch {
        // No web UI built - return 404
      }

      nodeRes.writeHead(404);
      nodeRes.end("Not Found");
    } catch (err: any) {
      if (err instanceof PayloadTooLargeError) {
        nodeRes.writeHead(413, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: err.message }));
        return;
      }
      if (err?.code === "ECONNRESET" || err?.message === "aborted") {
        return;
      }
      console.error("HTTP handler error:", err);
      if (nodeRes.headersSent || nodeRes.writableEnded || nodeRes.destroyed) {
        return;
      }
      if (err?.code === "SQLITE_BUSY" || /database is locked/i.test(String(err?.message ?? ""))) {
        nodeRes.writeHead(503, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: "Database busy, retry request" }));
        return;
      }
      nodeRes.writeHead(500);
      nodeRes.end("Internal Server Error");
    }
  });

  // Allow long-running local model downloads/pulls without the HTTP server
  // aborting the request at the default 5 minute boundary.
  httpServer.requestTimeout = 0;
  httpServer.timeout = 0;

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolve());
  });

  const actualPort = (httpServer.address() as import("net").AddressInfo).port;

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    stopGmailPolling();
    stopCalendarPolling();
    stopDrivePolling();
    stopContactsPolling();
    await stopBrowserService();
    if (transport as unknown) {
      await transport.close();
    }
    httpServer.close();
    openAICodexCallbackServer?.close();
    openAICodexCallbackServer = null;
    store.close();
    try {
      closeSync(workspaceLogFd);
    } catch {
      // ignore close failures during shutdown
    }
    await disposeDefaultLlamaCpp();
  };

  process.on("SIGTERM", async () => {
    console.error("Shutting down (SIGTERM)...");
    await stop();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    console.error("Shutting down (SIGINT)...");
    await stop();
    process.exit(0);
  });

  log(`Straja Vault MCP server listening on http://127.0.0.1:${actualPort}/mcp`);
  void startAutoModelPullIfNeeded("startup");

  // Run orphaned data cleanup in background after startup
  setTimeout(() => {
    try {
      const vecRemoved = cleanupOrphanedVectors(store.db);
      if (vecRemoved > 0) {
        log(`Startup cleanup: removed ${vecRemoved} orphaned vector entries`);
      }
      const inactiveRemoved = deleteInactiveDocuments(store.db);
      if (inactiveRemoved > 0) {
        log(`Startup cleanup: removed ${inactiveRemoved} inactive documents`);
      }
      const contentRemoved = cleanupOrphanedContent(store.db);
      if (contentRemoved > 0) {
        log(`Startup cleanup: removed ${contentRemoved} orphaned content hashes`);
      }
    } catch (err) {
      log(`Startup cleanup error: ${err}`);
    }
  }, 5000); // Run 5 seconds after startup

  return { httpServer, port: actualPort, stop };
}

// Run if this is the main module
if (fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1]?.endsWith("/mcp.ts") || process.argv[1]?.endsWith("/mcp.js")) {
  startMcpServer().catch(console.error);
}
