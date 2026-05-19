import type { Store } from "./store.js";
import { hashContent } from "./store.js";
import { appendAuditEntry, getAudit as getAuditGeneric, nowIso } from "./audit.js";

export type DuckDuckGoSearchResult = {
  title: string;
  url: string;
  snippet: string | null;
  domain: string | null;
};

export type DuckDuckGoSearchResponse = {
  provider: "duckduckgo";
  query: string;
  results: DuckDuckGoSearchResult[];
};

export type WebSearchAuditEntry = {
  timestamp: string;
  toolName: string;
  provider: "duckduckgo";
  query: string;
  verdict: "allowed" | "blocked" | "error";
  reason: string;
  resultCount?: number;
  durationMs?: number;
  severity?: "low" | "medium" | "high";
  domains?: string[];
  details?: Record<string, unknown>;
};

type FetchLike = typeof fetch;
type WebSearchLogger = (message: string) => void;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 400;
const MAX_RESPONSE_BYTES = 1_500_000;
const SEARCH_TIMEOUT_MS = 12_000;
const SEARCH_URL = "https://html.duckduckgo.com/html/";
const TOOL_NAME = "vault_web_search_duckduckgo";

// ---------------------------------------------------------------------------
// Web Search Policy
// ---------------------------------------------------------------------------

export interface WebSearchPolicy {
  provider: "duckduckgo";
  enabled: boolean;
}

const DEFAULT_WEB_SEARCH_POLICY: WebSearchPolicy = {
  provider: "duckduckgo",
  enabled: true,
};

const WEB_SEARCH_POLICY_PATH = "web-search-policy.json";

export class WebSearchValidationError extends Error {}
export class WebSearchBlockedError extends Error {}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos" || normalized === "#39") return "'";
    if (normalized === "nbsp") return " ";
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return "";
  });
}

function sanitizeHtmlFragment(value: string): string {
  return compactWhitespace(decodeHtmlEntities(stripTags(value)));
}

function normalizeResultUrl(rawHref: string): string | null {
  const decodedHref = decodeHtmlEntities(rawHref).trim();
  if (!decodedHref) return null;

  let href: URL;
  try {
    href = new URL(decodedHref, SEARCH_URL);
  } catch {
    return null;
  }

  if ((href.hostname === "duckduckgo.com" || href.hostname === "html.duckduckgo.com") && href.pathname === "/l/") {
    const target = href.searchParams.get("uddg");
    if (!target) return null;
    try {
      href = new URL(target);
    } catch {
      return null;
    }
  }

  if (href.protocol !== "http:" && href.protocol !== "https:") return null;
  return href.toString();
}

function normalizeDomain(urlText: string): string | null {
  try {
    return new URL(urlText).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function extractSnippet(blockHtml: string): string | null {
  const snippetMatch =
    blockHtml.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i) ??
    blockHtml.match(/class="[^"]*\bsnippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
  if (!snippetMatch?.[1]) return null;
  const snippet = sanitizeHtmlFragment(snippetMatch[1]);
  return snippet || null;
}

export function parseDuckDuckGoHtml(html: string, limit = DEFAULT_LIMIT): DuckDuckGoSearchResult[] {
  const normalizedLimit = normalizeLimit(limit);
  const anchorPattern = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors: Array<{ href: string; titleHtml: string; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    anchors.push({
      href: match[1] ?? "",
      titleHtml: match[2] ?? "",
      index: match.index,
      end: anchorPattern.lastIndex,
    });
  }

  const results: DuckDuckGoSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < anchors.length && results.length < normalizedLimit; i += 1) {
    const current = anchors[i]!;
    const url = normalizeResultUrl(current.href);
    if (!url || seenUrls.has(url)) continue;

    const title = sanitizeHtmlFragment(current.titleHtml) || url;
    const nextIndex = anchors[i + 1]?.index ?? Math.min(html.length, current.end + 3_500);
    const blockHtml = html.slice(current.end, nextIndex);
    const snippet = extractSnippet(blockHtml);

    seenUrls.add(url);
    results.push({
      title,
      url,
      snippet,
      domain: normalizeDomain(url),
    });
  }

  return results;
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`DuckDuckGo response too large (${contentLength} > ${maxBytes})`);
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`DuckDuckGo response too large (> ${maxBytes} bytes)`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(`DuckDuckGo response too large (> ${maxBytes} bytes)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}



export class WebSearchController {
  private policy: WebSearchPolicy = { ...DEFAULT_WEB_SEARCH_POLICY };

  constructor(
    private readonly store: Store,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly logger: WebSearchLogger | null = null,
  ) {
    this.loadPolicy();
  }

  private log(message: string): void {
    if (this.logger) this.logger(message);
  }

  async getAudit(date?: string): Promise<{ dates: string[]; entries: WebSearchAuditEntry[]; date: string | null }> {
    return getAuditGeneric<WebSearchAuditEntry>(this.store, "web-search", date, "web_search_audit_parser");
  }

  private async writeAudit(entry: WebSearchAuditEntry): Promise<void> {
    try {
      await appendAuditEntry(this.store, "web-search", entry as unknown as Record<string, unknown>);
    } catch (err) {
      this.log(`web search audit write failed: ${String(err)}`);
    }
  }

  // ---- Policy management ----

  loadPolicy(): WebSearchPolicy {
    const doc = this.store.getDocumentWithContent("_config", WEB_SEARCH_POLICY_PATH);
    if (!doc?.content) {
      this.policy = { ...DEFAULT_WEB_SEARCH_POLICY };
      return this.getPolicy();
    }
    try {
      const parsed = JSON.parse(doc.content) as Partial<WebSearchPolicy>;
      this.policy = {
        provider: parsed.provider === "duckduckgo" ? "duckduckgo" : "duckduckgo",
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      };
    } catch {
      this.policy = { ...DEFAULT_WEB_SEARCH_POLICY };
    }
    return this.getPolicy();
  }

  getPolicy(): WebSearchPolicy {
    return { ...this.policy };
  }

  async updatePolicy(patch: Partial<WebSearchPolicy>): Promise<WebSearchPolicy> {
    const current = this.getPolicy();
    if (patch.provider === "duckduckgo") current.provider = patch.provider;
    if (typeof patch.enabled === "boolean") current.enabled = patch.enabled;
    await this.persistPolicy(current);
    this.policy = current;
    return this.getPolicy();
  }

  private async persistPolicy(policy: WebSearchPolicy): Promise<void> {
    const now = nowIso();
    const content = JSON.stringify(policy, null, 2);
    const hash = await hashContent(content);
    this.store.insertContent(hash, content, now);
    const existing = this.store.findActiveDocument("_config", WEB_SEARCH_POLICY_PATH);
    if (existing) {
      this.store.updateDocument(existing.id, WEB_SEARCH_POLICY_PATH, hash, now);
    } else {
      this.store.insertDocument("_config", WEB_SEARCH_POLICY_PATH, WEB_SEARCH_POLICY_PATH, hash, now, now);
    }
  }

  // ---- Search ----

  async searchDuckDuckGo(query: string, limit?: number): Promise<DuckDuckGoSearchResponse> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeQuery(query);
    const normalizedLimit = normalizeLimit(limit);

    // Policy check: is web search enabled?
    if (!this.policy.enabled) {
      const reason = "Web search is disabled. Ask the user to enable it in the vault Web page.";
      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        provider: "duckduckgo",
        query: normalizedQuery || query,
        verdict: "blocked",
        reason,
        durationMs: Date.now() - startedAt,
        severity: "medium",
      });
      throw new WebSearchBlockedError(reason);
    }

    try {
      if (!normalizedQuery) {
        throw new WebSearchValidationError("Search query is required");
      }
      if (normalizedQuery.length > MAX_QUERY_LENGTH) {
        throw new WebSearchValidationError(`Search query too long (${normalizedQuery.length} > ${MAX_QUERY_LENGTH})`);
      }

      const requestUrl = new URL(SEARCH_URL);
      requestUrl.searchParams.set("q", normalizedQuery);
      requestUrl.searchParams.set("kl", "us-en");

      const response = await this.fetchImpl(requestUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "StrajaVault/0.1 DuckDuckGoSearch",
        },
        redirect: "error",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo search failed (${response.status})`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error(`DuckDuckGo returned unexpected content type: ${contentType || "unknown"}`);
      }

      const html = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
      const results = parseDuckDuckGoHtml(html, normalizedLimit);
      const domains = Array.from(new Set(results.map((result) => result.domain).filter(Boolean))) as string[];

      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        provider: "duckduckgo",
        query: normalizedQuery,
        verdict: "allowed",
        reason: results.length > 0 ? "Search completed" : "Search completed with no parsed results",
        resultCount: results.length,
        durationMs: Date.now() - startedAt,
        severity: "low",
        domains: domains.slice(0, 8),
        details: { limit: normalizedLimit },
      });

      return {
        provider: "duckduckgo",
        query: normalizedQuery,
        results,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        provider: "duckduckgo",
        query: normalizedQuery,
        verdict: err instanceof WebSearchValidationError ? "blocked" : "error",
        reason: message,
        durationMs: Date.now() - startedAt,
        severity: err instanceof WebSearchValidationError ? "medium" : "high",
        details: { limit: normalizedLimit },
      });
      throw err;
    }
  }
}
