/**
 * Shared Audit Module — Append-only JSONL audit ledger in the `_audit` collection.
 *
 * Extracted from browser-security.ts and web-search.ts to eliminate duplication
 * and provide a single entry point for all audit categories.
 *
 * Categories:
 *   - browser        — Browser tool calls (navigate, click, upload, …)
 *   - web-search     — DuckDuckGo search queries
 *   - web-fetch      — URL fetch operations
 *   - exec           — Command execution via nono sandbox
 *   - memory         — Memory read/write operations
 *   - messaging      — Inbound/outbound message delivery
 *   - gmail          — Gmail draft create/update, sync
 *   - gcalendar      — Google Calendar event create/update/delete
 *   - gdrive         — Google Drive file import
 *
 * Each category writes daily JSONL files: `_audit/{category}-YYYY-MM-DD.jsonl`
 *
 * The `_audit` collection is hidden from external APIs and write-protected
 * from raw endpoints. Only internal code (and the dedicated POST /audit/append
 * endpoint) can write.
 */

import type { Store } from "./store.js";
import { hashContent } from "./store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All known audit categories. */
export const AUDIT_CATEGORIES = [
  "browser",
  "web-search",
  "web-fetch",
  "exec",
  "memory",
  "messaging",
  "gmail",
  "gcalendar",
  "gdrive",
  "github",
  "collections",
  "guard",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

/** Daily JSONL file path for a given category and date. */
export function auditFilePath(category: string, date?: string): string {
  const d = date ?? nowIso().slice(0, 10);
  return `${category}-${d}.jsonl`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append a single audit entry (as a JSONL line) to the daily audit file.
 *
 * This is the core write primitive. It:
 *   1. Fetches the existing document from `_audit` (if any)
 *   2. Appends the new JSON line
 *   3. Hashes the updated content
 *   4. Upserts via insertContent + insertDocument/updateDocument
 *
 * Callers should `.catch(() => {})` to ensure audit never breaks the
 * operation being audited.
 */
export async function appendAuditEntry(
  store: Store,
  category: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const normalized = {
    ...entry,
    timestamp: (entry.timestamp as string) || nowIso(),
    reason: (entry.reason as string) ?? "",
  };
  const linePath = auditFilePath(category, (normalized.timestamp as string).slice(0, 10));
  const line = JSON.stringify(normalized);

  const now = nowIso();
  const existing = store.getDocumentWithContent("_audit", linePath);
  const updated = existing?.content
    ? `${existing.content}${existing.content.endsWith("\n") ? "" : "\n"}${line}\n`
    : `${line}\n`;

  const hash = await hashContent(updated);
  store.insertContent(hash, updated, now);
  if (existing) {
    store.updateDocument(existing.id, linePath, hash, now);
  } else {
    store.insertDocument("_audit", linePath, linePath, hash, now, now);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List available audit dates for a category, newest first.
 *
 * Queries the `_audit` collection for documents matching
 * `{category}-YYYY-MM-DD.jsonl` and extracts the date portion.
 */
export function listAuditDates(store: Store, category: string): string[] {
  const prefix = `${category}-`;
  const suffix = ".jsonl";
  const pattern = `${category}-____-__-__${suffix}`;
  const rows = store.db
    .prepare(
      `SELECT path FROM documents
       WHERE collection = '_audit' AND active = 1 AND path LIKE ?
       ORDER BY path DESC`,
    )
    .all(pattern.replace(/_/g, "_")) as { path: string }[];
  // The LIKE pattern uses SQL wildcards — underscores in SQL LIKE match any
  // single character, which is exactly what we want for YYYY-MM-DD digits.
  return rows.map((r) => r.path.slice(prefix.length, -suffix.length));
}

/**
 * Parse a JSONL string into typed audit entries.
 *
 * Malformed lines are preserved as synthetic error entries so retrieval
 * never silently hides corruption.
 */
export function parseAuditJsonl<T extends Record<string, unknown>>(
  content: string,
  fallbackToolName = "audit_parser",
): T[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const entries: T[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as T);
    } catch {
      entries.push({
        timestamp: nowIso(),
        toolName: fallbackToolName,
        action: "audit_read",
        verdict: "error",
        reason: "Malformed audit JSONL line",
        severity: "high",
      } as unknown as T);
    }
  }
  return entries;
}

/**
 * Retrieve audit data for a category: available dates + entries for a
 * specific date.
 */
export function getAudit<T extends Record<string, unknown>>(
  store: Store,
  category: string,
  date?: string,
  fallbackToolName?: string,
): { dates: string[]; entries: T[]; date: string | null } {
  const normalizedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const path = normalizedDate ? auditFilePath(category, normalizedDate) : null;
  const doc = path ? store.getDocumentWithContent("_audit", path) : null;
  return {
    dates: listAuditDates(store, category),
    date: normalizedDate,
    entries: doc?.content ? parseAuditJsonl<T>(doc.content, fallbackToolName) : [],
  };
}
