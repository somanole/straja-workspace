import { lookup as dnsLookup } from "node:dns/promises";
import type { Store } from "./store.js";
import { hashContent } from "./store.js";
import { appendAuditEntry, nowIso } from "./audit.js";
import type { DomainRule } from "./browser-policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebFetchResponse = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  extractMode: "markdown" | "text";
  extractor: "readability" | "json" | "raw" | "cf-markdown";
  truncated: boolean;
  length: number;
  fetchedAt: string;
  tookMs: number;
  text: string;
  cached?: boolean;
};

export type WebFetchAuditEntry = {
  timestamp: string;
  toolName: string;
  url: string;
  verdict: "allowed" | "blocked" | "error";
  reason: string;
  status?: number;
  durationMs?: number;
  severity?: "low" | "medium" | "high";
  details?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Web Fetch Policy
// ---------------------------------------------------------------------------

export interface WebFetchPolicy {
  allowAllDomains: boolean;
  allowedDomains: DomainRule[];
}

const DEFAULT_WEB_FETCH_POLICY: WebFetchPolicy = {
  allowAllDomains: false,
  allowedDomains: [],
};

const WEB_FETCH_POLICY_PATH = "web-fetch-policy.json";

type CacheEntry = {
  value: WebFetchResponse;
  expiresAt: number;
};

type FetchLike = typeof fetch;
type WebFetchLogger = (message: string) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL_NAME = "vault_web_fetch";

const DEFAULT_MAX_CHARS = 50_000;
const MAX_RESPONSE_BYTES = 10_000_000; // 10 MB — large sites like CNN serve 4+ MB of HTML
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 15 * 60_000; // 15 minutes
const MAX_CACHE_ENTRIES = 100;
const MAX_URL_LENGTH = 4096;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
];

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export class WebFetchValidationError extends Error {}
export class WebFetchSsrfBlockedError extends Error {}
export class WebFetchBlockedError extends Error {}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local")) return true;
  if (normalized.endsWith(".internal")) return true;
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  const a = octets[0]!;
  const b = octets[1]!;
  if (a === 0) return true;       // 0.0.0.0/8
  if (a === 10) return true;      // 10.0.0.0/8
  if (a === 127) return true;     // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/%.*$/, ""); // strip zone id
  if (normalized === "::1") return true;       // loopback
  if (normalized === "::") return true;        // unspecified
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fec0:")) return true; // site-local (deprecated)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  // IPv4-mapped ::ffff:x.x.x.x
  const v4mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped?.[1]) return isPrivateIpv4(v4mapped[1]);
  return false;
}

function isPrivateIp(address: string): boolean {
  if (address.includes(":")) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().trim();
  if (!normalized) throw new WebFetchSsrfBlockedError("Empty hostname");
  if (isBlockedHostname(normalized)) {
    throw new WebFetchSsrfBlockedError(`Blocked hostname: ${hostname}`);
  }
  // Direct IP address check
  if (isPrivateIp(normalized)) {
    throw new WebFetchSsrfBlockedError(`Blocked: private/internal IP address`);
  }
  // Bracketed IPv6
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const inner = normalized.slice(1, -1);
    if (isPrivateIp(inner)) {
      throw new WebFetchSsrfBlockedError(`Blocked: private/internal IP address`);
    }
  }

  // DNS resolution check
  try {
    const results = await dnsLookup(normalized, { all: true });
    for (const entry of results) {
      if (isPrivateIp(entry.address)) {
        throw new WebFetchSsrfBlockedError(`Blocked: resolves to private/internal IP address`);
      }
    }
  } catch (err) {
    if (err instanceof WebFetchSsrfBlockedError) throw err;
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
}

// ---------------------------------------------------------------------------
// HTML → Markdown conversion
// ---------------------------------------------------------------------------

let readabilityDepsPromise:
  | Promise<{
      Readability: typeof import("@mozilla/readability").Readability;
      parseHTML: typeof import("linkedom").parseHTML;
    }>
  | undefined;

async function loadReadabilityDeps() {
  if (!readabilityDepsPromise) {
    readabilityDepsPromise = Promise.all([
      import("@mozilla/readability"),
      import("linkedom"),
    ]).then(([readability, linkedom]) => ({
      Readability: readability.Readability,
      parseHTML: linkedom.parseHTML,
    }));
  }
  try {
    return await readabilityDepsPromise;
  } catch (error) {
    readabilityDepsPromise = undefined;
    throw error;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ""));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Strip common non-content elements from HTML before extraction.
 * Removes nav, header, footer, cookie consent, ad containers, and similar junk
 * so that Readability (and the fallback converter) focus on actual page content.
 */
function preCleanHtml(html: string): string {
  let cleaned = html;
  // Remove entire tag blocks that are almost never article content
  cleaned = cleaned.replace(/<nav[\s>][\s\S]*?<\/nav>/gi, "");
  cleaned = cleaned.replace(/<header[\s>][\s\S]*?<\/header>/gi, "");
  cleaned = cleaned.replace(/<footer[\s>][\s\S]*?<\/footer>/gi, "");
  cleaned = cleaned.replace(/<aside[\s>][\s\S]*?<\/aside>/gi, "");
  // Remove common ad / consent / feedback containers by id/class patterns
  cleaned = cleaned.replace(/<div[^>]*(?:id|class)="[^"]*(?:cookie|consent|gdpr|ad-feedback|ad-container|sidebar|social-share|newsletter-signup)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  // Remove SVG blocks (icons, logos — often huge)
  cleaned = cleaned.replace(/<svg[\s>][\s\S]*?<\/svg>/gi, "");
  return cleaned;
}

function htmlToMarkdown(html: string): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] ? normalizeWhitespace(stripTags(titleMatch[1])) : undefined;
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `[${label}](${href})` : href;
  });
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const prefix = "#".repeat(Math.max(1, Math.min(6, Number.parseInt(level, 10))));
    const label = normalizeWhitespace(stripTags(body));
    return `\n${prefix} ${label}\n`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `\n- ${label}` : "";
  });
  text = text
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|table|tr|ul|ol)>/gi, "\n");
  text = stripTags(text);
  text = normalizeWhitespace(text);
  return { text, title };
}

function markdownToText(markdown: string): string {
  let text = markdown;
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""),
  );
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  return normalizeWhitespace(text);
}

const READABILITY_MAX_HTML_CHARS = 2_000_000;

async function extractReadableContent(params: {
  html: string;
  url: string;
  extractMode: "markdown" | "text";
}): Promise<{ text: string; title?: string } | null> {
  // Pre-clean HTML to strip nav/header/footer/ads before extraction
  const cleanedHtml = preCleanHtml(params.html);

  const fallback = (): { text: string; title?: string } => {
    const rendered = htmlToMarkdown(cleanedHtml);
    if (params.extractMode === "text") {
      const text = markdownToText(rendered.text) || normalizeWhitespace(stripTags(cleanedHtml));
      return { text, title: rendered.title };
    }
    return rendered;
  };

  if (cleanedHtml.length > READABILITY_MAX_HTML_CHARS) {
    return fallback();
  }

  try {
    const { Readability, parseHTML } = await loadReadabilityDeps();
    const { document } = parseHTML(cleanedHtml);
    try {
      (document as { baseURI?: string }).baseURI = params.url;
    } catch { /* best-effort */ }
    const reader = new Readability(document, { charThreshold: 0 });
    const parsed = reader.parse();
    if (!parsed?.content) return fallback();
    const title = parsed.title || undefined;
    if (params.extractMode === "text") {
      const text = normalizeWhitespace(parsed.textContent ?? "");
      return text ? { text, title } : fallback();
    }
    const rendered = htmlToMarkdown(parsed.content);
    return { text: rendered.text, title: title ?? rendered.title };
  } catch {
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Response body reader with size limit
// ---------------------------------------------------------------------------

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > maxBytes) {
      // Still try to read partial — don't reject outright
    }
  }

  if (!response.body) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) {
      return { text: text.slice(0, maxBytes), truncated: true };
    }
    return { text, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Take what fits
        const remaining = maxBytes - (total - value.byteLength);
        if (remaining > 0) {
          chunks.push(Buffer.from(value.subarray(0, remaining)));
        }
        truncated = true;
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (truncated) {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

// ---------------------------------------------------------------------------
// Redirect helpers
// ---------------------------------------------------------------------------

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers };
  for (const key of CROSS_ORIGIN_SENSITIVE_HEADERS) {
    delete result[key];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readCache(cache: Map<string, CacheEntry>, key: string): WebFetchResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(cache: Map<string, CacheEntry>, key: string, value: WebFetchResponse): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Text truncation
// ---------------------------------------------------------------------------

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

// ---------------------------------------------------------------------------
// Content type helpers
// ---------------------------------------------------------------------------

function normalizeContentType(value: string | null): string {
  if (!value) return "application/octet-stream";
  const [raw] = value.split(";");
  return raw?.trim()?.toLowerCase() || "application/octet-stream";
}

function looksLikeHtml(value: string): boolean {
  const head = value.trimStart().slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}


// ---------------------------------------------------------------------------
// WebFetchController
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain matching (mirrored from browser-policy.ts to avoid coupling)
// ---------------------------------------------------------------------------

function normalizeFetchDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(normalized)) {
    try { normalized = new URL(normalized).hostname.toLowerCase(); } catch { /* fallthrough */ }
  }
  if (normalized.includes("/")) normalized = normalized.split("/")[0] ?? normalized;
  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) normalized = normalized.split(":")[0] ?? normalized;
  return normalized.replace(/\.+$/, "");
}

function matchesFetchDomainRule(rule: DomainRule, url: URL): boolean {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (rule.schemes?.length) {
    const scheme = url.protocol.slice(0, -1) as "http" | "https";
    if (!rule.schemes.includes(scheme)) return false;
  }
  const host = normalizeFetchDomain(url.hostname);
  const ruleDomain = normalizeFetchDomain(rule.domain);
  if (host === ruleDomain) return true;
  if (rule.includeSubdomains && host.endsWith(`.${ruleDomain}`)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// WebFetchController
// ---------------------------------------------------------------------------

export class WebFetchController {
  private readonly cache = new Map<string, CacheEntry>();
  private policy: WebFetchPolicy = { ...DEFAULT_WEB_FETCH_POLICY, allowedDomains: [] };

  constructor(
    private readonly store: Store,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly logger: WebFetchLogger | null = null,
  ) {
    this.loadPolicy();
  }

  private log(message: string): void {
    if (this.logger) this.logger(message);
  }

  private async writeAudit(entry: WebFetchAuditEntry): Promise<void> {
    try {
      await appendAuditEntry(this.store, "web-fetch", entry as unknown as Record<string, unknown>);
    } catch (err) {
      this.log(`web fetch audit write failed: ${String(err)}`);
    }
  }

  // ---- Policy management ----

  loadPolicy(): WebFetchPolicy {
    const doc = this.store.getDocumentWithContent("_config", WEB_FETCH_POLICY_PATH);
    if (!doc?.content) {
      this.policy = { ...DEFAULT_WEB_FETCH_POLICY, allowedDomains: [] };
      return this.getPolicy();
    }
    try {
      const parsed = JSON.parse(doc.content) as Partial<WebFetchPolicy>;
      this.policy = {
        allowAllDomains: typeof parsed.allowAllDomains === "boolean" ? parsed.allowAllDomains : false,
        allowedDomains: Array.isArray(parsed.allowedDomains) ? parsed.allowedDomains : [],
      };
    } catch {
      this.policy = { ...DEFAULT_WEB_FETCH_POLICY, allowedDomains: [] };
    }
    return this.getPolicy();
  }

  getPolicy(): WebFetchPolicy {
    return JSON.parse(JSON.stringify(this.policy)) as WebFetchPolicy;
  }

  async updatePolicy(patch: Partial<WebFetchPolicy>): Promise<WebFetchPolicy> {
    const current = this.getPolicy();
    if (typeof patch.allowAllDomains === "boolean") current.allowAllDomains = patch.allowAllDomains;
    if (Array.isArray(patch.allowedDomains)) current.allowedDomains = patch.allowedDomains;
    await this.persistPolicy(current);
    this.policy = current;
    return this.getPolicy();
  }

  async resetPolicy(): Promise<WebFetchPolicy> {
    const fresh: WebFetchPolicy = { ...DEFAULT_WEB_FETCH_POLICY, allowedDomains: [] };
    await this.persistPolicy(fresh);
    this.policy = fresh;
    return this.getPolicy();
  }

  private async persistPolicy(policy: WebFetchPolicy): Promise<void> {
    const now = nowIso();
    const content = JSON.stringify(policy, null, 2);
    const hash = await hashContent(content);
    this.store.insertContent(hash, content, now);
    const existing = this.store.findActiveDocument("_config", WEB_FETCH_POLICY_PATH);
    if (existing) {
      this.store.updateDocument(existing.id, WEB_FETCH_POLICY_PATH, hash, now);
    } else {
      this.store.insertDocument("_config", WEB_FETCH_POLICY_PATH, WEB_FETCH_POLICY_PATH, hash, now, now);
    }
  }

  // ---- One-time domain approvals (in-memory, consumed after use) ----

  private readonly oneTimeApprovals = new Map<string, number>(); // domain → timestamp

  approveOnce(hostname: string): void {
    this.oneTimeApprovals.set(normalizeFetchDomain(hostname), Date.now());
  }

  private consumeOneTimeApproval(hostname: string): boolean {
    const key = normalizeFetchDomain(hostname);
    const ts = this.oneTimeApprovals.get(key);
    if (!ts) return false;
    // Expire after 5 minutes
    if (Date.now() - ts > 5 * 60_000) {
      this.oneTimeApprovals.delete(key);
      return false;
    }
    this.oneTimeApprovals.delete(key);
    return true;
  }

  private isDomainAllowed(parsedUrl: URL): boolean {
    if (this.policy.allowAllDomains) return true;
    for (const rule of this.policy.allowedDomains) {
      if (matchesFetchDomainRule(rule, parsedUrl)) return true;
    }
    return false;
  }

  private async addDomainToAllowlist(hostname: string): Promise<void> {
    const normalized = normalizeFetchDomain(hostname);
    const exists = this.policy.allowedDomains.some(
      (r) => normalizeFetchDomain(r.domain) === normalized,
    );
    if (!exists) {
      this.policy.allowedDomains.push({ domain: normalized, includeSubdomains: true });
      await this.persistPolicy(this.policy);
    }
  }

  async fetch(params: {
    url: string;
    extractMode?: "markdown" | "text";
    maxChars?: number;
    domainApproval?: "once" | "always";
  }): Promise<WebFetchResponse> {
    const startedAt = Date.now();
    const rawUrl = (params.url || "").trim();
    const extractMode = params.extractMode === "text" ? "text" : "markdown";
    const maxChars = Math.max(100, Math.min(200_000, params.maxChars ?? DEFAULT_MAX_CHARS));

    // Validate
    if (!rawUrl) throw new WebFetchValidationError("URL is required");
    if (rawUrl.length > MAX_URL_LENGTH) throw new WebFetchValidationError("URL too long");

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new WebFetchValidationError("Invalid URL: must be http or https");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new WebFetchValidationError("Invalid URL: must be http or https");
    }

    // Cache check
    const cacheKey = `fetch:${rawUrl}:${extractMode}:${maxChars}`.toLowerCase();
    const cached = readCache(this.cache, cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // SSRF check
    try {
      await assertPublicHostname(parsedUrl.hostname);
    } catch (err) {
      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        url: rawUrl,
        verdict: "blocked",
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        severity: "high",
      });
      throw err;
    }

    // Domain policy check
    if (!this.isDomainAllowed(parsedUrl)) {
      const hostname = parsedUrl.hostname.toLowerCase();
      if (params.domainApproval === "always") {
        await this.addDomainToAllowlist(hostname);
        await this.writeAudit({
          timestamp: nowIso(),
          toolName: TOOL_NAME,
          url: rawUrl,
          verdict: "allowed",
          reason: `Domain ${hostname} added to allow list`,
          durationMs: Date.now() - startedAt,
          severity: "low",
        });
      } else if (params.domainApproval === "once" || this.consumeOneTimeApproval(hostname)) {
        await this.writeAudit({
          timestamp: nowIso(),
          toolName: TOOL_NAME,
          url: rawUrl,
          verdict: "allowed",
          reason: `Domain ${hostname} approved (one-time)`,
          durationMs: Date.now() - startedAt,
          severity: "low",
        });
      } else {
        const reason = `Domain ${hostname} is not on the web fetch allow list. Ask the user which option they prefer:\n- "approve once" — one-time access (POST /connections/approve-domain {"domain":"${hostname}","decision":"once"}, then retry)\n- "approve always" — add ${hostname} permanently to the allow list (POST /connections/approve-domain {"domain":"${hostname}","decision":"always"}, then retry)`;
        await this.writeAudit({
          timestamp: nowIso(),
          toolName: TOOL_NAME,
          url: rawUrl,
          verdict: "blocked",
          reason,
          durationMs: Date.now() - startedAt,
          severity: "medium",
        });
        throw new WebFetchBlockedError(reason);
      }
    }

    // Fetch with redirect following
    let currentUrl = rawUrl;
    let currentParsedUrl = parsedUrl;
    let headers: Record<string, string> = {
      Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
      "User-Agent": DEFAULT_USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    };
    const visited = new Set<string>();
    let redirectCount = 0;
    let response: Response;

    try {
      while (true) {
        response = await this.fetchImpl(currentUrl, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error(`Redirect missing location header (${response.status})`);

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) throw new Error(`Too many redirects (limit: ${MAX_REDIRECTS})`);

          const nextUrl = new URL(location, currentParsedUrl).toString();
          if (visited.has(nextUrl)) throw new Error("Redirect loop detected");
          visited.add(nextUrl);

          // SSRF check on redirect target
          const nextParsed = new URL(nextUrl);
          await assertPublicHostname(nextParsed.hostname);

          // Strip sensitive headers on cross-origin redirect
          if (nextParsed.origin !== currentParsedUrl.origin) {
            headers = stripSensitiveHeaders(headers);
          }

          void response.body?.cancel();
          currentUrl = nextUrl;
          currentParsedUrl = nextParsed;
          continue;
        }

        break;
      }
    } catch (err) {
      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        url: rawUrl,
        verdict: err instanceof WebFetchSsrfBlockedError ? "blocked" : "error",
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        severity: err instanceof WebFetchSsrfBlockedError ? "high" : "medium",
      });
      throw err;
    }

    // Process response
    try {
      if (!response.ok) {
        const bodyResult = await readResponseBodyWithLimit(response, 64_000);
        let detail = bodyResult.text;
        const ct = response.headers.get("content-type");
        if (ct?.includes("text/html") || looksLikeHtml(detail)) {
          detail = htmlToMarkdown(detail).text;
        }
        const truncated = truncateText(detail, 4_000);
        throw new Error(`Web fetch failed (${response.status}): ${truncated.text || response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const normalizedCt = normalizeContentType(contentType);
      const bodyResult = await readResponseBodyWithLimit(response, MAX_RESPONSE_BYTES);
      const body = bodyResult.text;

      let title: string | undefined;
      let extractor: WebFetchResponse["extractor"] = "raw";
      let text = body;

      if (contentType.includes("text/markdown")) {
        // Cloudflare Markdown for Agents: server returned pre-rendered markdown
        extractor = "cf-markdown";
        if (extractMode === "text") {
          text = markdownToText(body);
        }
      } else if (contentType.includes("text/html") || looksLikeHtml(body)) {
        const readable = await extractReadableContent({
          html: body,
          url: currentUrl,
          extractMode,
        });
        if (readable?.text) {
          text = readable.text;
          title = readable.title;
          extractor = "readability";
        } else {
          // Fallback to basic HTML→markdown
          const rendered = htmlToMarkdown(body);
          text = extractMode === "text" ? markdownToText(rendered.text) : rendered.text;
          title = rendered.title;
          extractor = "raw";
        }
      } else if (contentType.includes("application/json")) {
        try {
          text = JSON.stringify(JSON.parse(body), null, 2);
          extractor = "json";
        } catch {
          extractor = "raw";
        }
      }

      const truncated = truncateText(text, maxChars);
      const result: WebFetchResponse = {
        url: rawUrl,
        finalUrl: currentUrl,
        status: response.status,
        contentType: normalizedCt,
        title,
        extractMode,
        extractor,
        truncated: truncated.truncated || bodyResult.truncated,
        length: truncated.text.length,
        fetchedAt: nowIso(),
        tookMs: Date.now() - startedAt,
        text: truncated.text,
      };

      writeCache(this.cache, cacheKey, result);

      await this.writeAudit({
        timestamp: nowIso(),
        toolName: TOOL_NAME,
        url: rawUrl,
        verdict: "allowed",
        reason: "Fetch completed",
        status: response.status,
        durationMs: Date.now() - startedAt,
        severity: "low",
        details: {
          finalUrl: currentUrl,
          extractor,
          contentType: normalizedCt,
          truncated: truncated.truncated,
          length: truncated.text.length,
        },
      });

      return result;
    } catch (err) {
      if (!(err instanceof WebFetchSsrfBlockedError)) {
        await this.writeAudit({
          timestamp: nowIso(),
          toolName: TOOL_NAME,
          url: rawUrl,
          verdict: "error",
          reason: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
          severity: "medium",
        });
      }
      throw err;
    }
  }
}
