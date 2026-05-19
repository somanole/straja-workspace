/**
 * Gmail sync engine — fetches labeled emails and converts to vault documents.
 *
 * Shared Google OAuth client credentials come from _config/google-oauth.json.
 * User tokens (refresh/access) are stored in _config/gmail.json inside the vault.
 */

import { google, type gmail_v1, type Auth } from "googleapis";
import { getGoogleOAuthClientConfig, hasGoogleOAuthClientConfig } from "./google-oauth-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailConfig {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  email?: string;
  labels: string[];
  includeThreads: boolean;
  lastSyncHistoryId?: string;
  lastSync?: string;
  // Sync mode
  syncMode?: "labels" | "all"; // default: "labels"
  syncDaysBack?: 30 | 60 | 90; // default: 30, used when syncMode="all"
  // Polling
  pollEnabled?: boolean;
  pollIntervalMinutes?: number; // 1 | 5 | 10 | 15
  // OAuth scopes granted
  scopes?: string[];
  authErrorCode?: string;
  authErrorMessage?: string;
  authErrorAt?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  messageId: string; // RFC 2822 Message-ID header
  from: string;
  to: string;
  cc?: string;
  date: string;
  subject: string;
  labels: string[];
  bodyText: string;
  bodyHtml?: string;
}

export interface GmailThread {
  id: string;
  subject: string;
  participants: string[];
  messages: GmailMessage[];
  labels: string[];
}

export interface ImportedEmailSummary {
  subject: string;
  from: string;
  date: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
  importedItems: ImportedEmailSummary[];
}

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------

function getClientCredentials() {
  return getGoogleOAuthClientConfig();
}

export function hasClientCredentials(): boolean {
  return hasGoogleOAuthClientConfig();
}

export function getOAuth2Client(refreshToken?: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getClientCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}

export function generateAuthUrl(redirectUri: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    redirect_uri: redirectUri,
  });
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string; email?: string }> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });

  if (!tokens.refresh_token) {
    throw new Error("No refresh token received — try revoking app access in Google Account settings and reconnecting");
  }

  // Get the user's email address
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || "",
    email: profile.data.emailAddress || undefined,
  };
}

// ---------------------------------------------------------------------------
// Gmail API helpers
// ---------------------------------------------------------------------------

function getGmail(config: GmailConfig): gmail_v1.Gmail {
  const client = getOAuth2Client(config.refreshToken);
  return google.gmail({ version: "v1", auth: client });
}

/**
 * Resolve a Gmail label name (e.g. "Straja") to its label ID.
 */
async function resolveLabelId(
  gmail: gmail_v1.Gmail,
  labelName: string
): Promise<string | null> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const label = data.labels?.find(
    (l) => l.name?.toLowerCase() === labelName.toLowerCase()
  );
  return label?.id || null;
}

/**
 * Fetch all message IDs with a given label.
 */
async function listMessageIds(
  gmail: gmail_v1.Gmail,
  opts: { labelId?: string; query?: string; maxMessages?: number }
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  const cap = opts.maxMessages ?? Infinity;

  do {
    const listParams: Record<string, unknown> = {
      userId: "me",
      maxResults: 100,
      pageToken,
    };
    if (opts.labelId) listParams.labelIds = [opts.labelId];
    if (opts.query) listParams.q = opts.query;

    const { data } = await gmail.users.messages.list(listParams as any);
    for (const msg of data.messages || []) {
      if (msg.id) ids.push(msg.id);
      if (ids.length >= cap) break;
    }
    if (ids.length >= cap) break;
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return ids;
}

/**
 * Fetch a full message by ID and extract structured fields.
 */
async function fetchMessage(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<GmailMessage> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  const labelNames = data.labelIds || [];

  return {
    id: data.id || messageId,
    threadId: data.threadId || "",
    messageId: getHeader("Message-ID") || `gmail-${messageId}`,
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc") || undefined,
    date: getHeader("Date"),
    subject: getHeader("Subject"),
    labels: labelNames,
    bodyText: extractTextBody(data.payload),
    bodyHtml: extractHtmlBody(data.payload),
  };
}

/**
 * Fetch a complete thread with all messages.
 */
export async function fetchThread(
  gmail: gmail_v1.Gmail,
  threadId: string
): Promise<GmailThread> {
  const { data } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages: GmailMessage[] = [];
  const participants = new Set<string>();
  let subject = "";
  const labelSet = new Set<string>();

  for (const msg of data.messages || []) {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const from = getHeader("From");
    const to = getHeader("To");
    if (!subject) subject = getHeader("Subject");
    if (from) participants.add(from);
    if (to) to.split(",").forEach((t) => participants.add(t.trim()));
    for (const l of msg.labelIds || []) labelSet.add(l);

    messages.push({
      id: msg.id || "",
      threadId: data.id || threadId,
      messageId: getHeader("Message-ID") || `gmail-${msg.id}`,
      from,
      to,
      cc: getHeader("Cc") || undefined,
      date: getHeader("Date"),
      subject: getHeader("Subject"),
      labels: msg.labelIds || [],
      bodyText: extractTextBody(msg.payload),
      bodyHtml: extractHtmlBody(msg.payload),
    });
  }

  return {
    id: data.id || threadId,
    subject,
    participants: [...participants],
    messages,
    labels: [...labelSet],
  };
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

function extractTextBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return "";

  // Direct text/plain body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart — recurse
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    // Fall back to first text part in nested multipart
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  // Fall back to HTML → stripped text
  const html = extractHtmlBody(payload);
  if (html) return stripHtml(html);

  return "";
}

function extractHtmlBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return "";

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }

  return "";
}

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Markdown conversion
// ---------------------------------------------------------------------------

export function emailToMarkdown(msg: GmailMessage): string {
  const frontmatter = [
    "---",
    `from: ${msg.from}`,
    `to: ${msg.to}`,
    ...(msg.cc ? [`cc: ${msg.cc}`] : []),
    `date: ${msg.date}`,
    `subject: ${msg.subject}`,
    `labels: ${msg.labels.join(", ")}`,
    `message_id: ${msg.messageId}`,
    `thread_id: ${msg.threadId}`,
    "---",
  ].join("\n");

  const body = msg.bodyText || "(no body)";
  return `${frontmatter}\n\n# ${msg.subject}\n\n${body}\n`;
}

export function threadToMarkdown(thread: GmailThread): string {
  const dates = thread.messages.map((m) => m.date).filter(Boolean);
  const dateRange =
    dates.length > 1
      ? `${formatShortDate(dates[0]!)} to ${formatShortDate(dates[dates.length - 1]!)}`
      : dates[0] || "unknown";

  const frontmatter = [
    "---",
    `thread_id: ${thread.id}`,
    `subject: ${thread.subject}`,
    `participants: ${thread.participants.join(", ")}`,
    `message_count: ${thread.messages.length}`,
    `date_range: ${dateRange}`,
    `labels: ${thread.labels.join(", ")}`,
    "---",
  ].join("\n");

  const messageSections = thread.messages.map((msg, i) => {
    const header = `## Message ${i + 1} — ${msg.from} (${formatShortDate(msg.date)})`;
    const body = msg.bodyText || "(no body)";
    return `${header}\n\n${body}`;
  });

  return `${frontmatter}\n\n# ${thread.subject}\n\n${messageSections.join("\n\n---\n\n")}\n`;
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Draft creation
// ---------------------------------------------------------------------------

export interface DraftRequest {
  to: string;
  subject: string;
  body: string;
  /** For replies: the RFC 2822 Message-ID of the message being replied to */
  inReplyTo?: string;
  /** For replies: the References header chain */
  references?: string;
  /** For replies: the Gmail thread ID to keep the draft in the same thread */
  threadId?: string;
}

export interface DraftResult {
  id: string;
  message: { id: string; threadId: string };
}

/** RFC 2047 MIME-encode a header value if it contains non-ASCII characters. */
function mimeEncodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value; // pure ASCII — no encoding needed
  const encoded = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function buildRfc2822Message(draft: DraftRequest, fromEmail: string): string {
  const lines: string[] = [];

  lines.push(`From: ${fromEmail}`);
  lines.push(`To: ${draft.to}`);
  lines.push(`Subject: ${mimeEncodeHeader(draft.subject)}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);

  if (draft.inReplyTo) {
    lines.push(`In-Reply-To: ${draft.inReplyTo}`);
  }
  if (draft.references) {
    lines.push(`References: ${draft.references}`);
  }

  lines.push(""); // blank line separating headers from body
  lines.push(Buffer.from(draft.body, "utf-8").toString("base64"));

  return lines.join("\r\n");
}

export async function createDraft(
  config: GmailConfig,
  draft: DraftRequest
): Promise<DraftResult> {
  const gmail = getGmail(config);
  const fromEmail = config.email || "me";

  const raw = buildRfc2822Message(draft, fromEmail);
  const encodedMessage = Buffer.from(raw).toString("base64url");

  const requestBody: gmail_v1.Schema$Draft = {
    message: {
      raw: encodedMessage,
    },
  };

  if (draft.threadId) {
    requestBody.message!.threadId = draft.threadId;
  }

  const { data } = await gmail.users.drafts.create({
    userId: "me",
    requestBody,
  });

  return {
    id: data.id || "",
    message: {
      id: data.message?.id || "",
      threadId: data.message?.threadId || "",
    },
  };
}

export async function updateDraft(
  config: GmailConfig,
  draftId: string,
  draft: DraftRequest
): Promise<DraftResult> {
  const gmail = getGmail(config);
  const fromEmail = config.email || "me";

  const raw = buildRfc2822Message(draft, fromEmail);
  const encodedMessage = Buffer.from(raw).toString("base64url");

  const requestBody: gmail_v1.Schema$Draft = {
    message: {
      raw: encodedMessage,
    },
  };

  if (draft.threadId) {
    requestBody.message!.threadId = draft.threadId;
  }

  const { data } = await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody,
  });

  return {
    id: data.id || "",
    message: {
      id: data.message?.id || "",
      threadId: data.message?.threadId || "",
    },
  };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  config: GmailConfig;
  /** Check if a document already exists (by path) to skip reimporting. */
  documentExists: (collection: string, path: string) => boolean;
  /** Insert/upsert a document into the vault. */
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string
  ) => Promise<void>;
}

export async function syncGmail(opts: SyncOptions): Promise<SyncResult> {
  const { config, documentExists, upsertDocument } = opts;
  const gmail = getGmail(config);
  const result: SyncResult = { imported: 0, skipped: 0, total: 0, errors: [], importedItems: [] };

  /** Process a batch of message IDs (shared by both modes). */
  async function processMessages(messageIds: string[]) {
    result.total += messageIds.length;

    if (config.includeThreads) {
      const threadIds = new Set<string>();
      for (const msgId of messageIds) {
        const { data } = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "metadata",
          metadataHeaders: ["Subject"],
        });
        if (data.threadId) threadIds.add(data.threadId);
      }

      for (const threadId of threadIds) {
        const docPath = `threads/${threadId}.md`;
        if (documentExists("_gmail", docPath)) {
          result.skipped++;
          continue;
        }

        try {
          const thread = await fetchThread(gmail, threadId);
          const markdown = threadToMarkdown(thread);
          await upsertDocument("_gmail", docPath, markdown, thread.subject);
          result.imported++;
          const lastMsg = thread.messages[thread.messages.length - 1];
          result.importedItems.push({
            subject: thread.subject,
            from: lastMsg?.from ?? thread.participants[0] ?? "unknown",
            date: lastMsg?.date ?? new Date().toISOString(),
          });
        } catch (err: any) {
          result.errors.push(`Thread ${threadId}: ${err?.message || "unknown error"}`);
        }
      }
    } else {
      for (const msgId of messageIds) {
        const docPath = `messages/${msgId}.md`;
        if (documentExists("_gmail", docPath)) {
          result.skipped++;
          continue;
        }

        try {
          const msg = await fetchMessage(gmail, msgId);
          const markdown = emailToMarkdown(msg);
          await upsertDocument("_gmail", docPath, markdown, msg.subject);
          result.imported++;
          result.importedItems.push({
            subject: msg.subject,
            from: msg.from,
            date: msg.date,
          });
        } catch (err: any) {
          result.errors.push(`Message ${msgId}: ${err?.message || "unknown error"}`);
        }
      }
    }
  }

  if (config.syncMode === "all") {
    // Sync all recent email with date cap
    const daysBack = config.syncDaysBack ?? 30;
    const after = new Date(Date.now() - daysBack * 86_400_000);
    const afterStr = `${after.getFullYear()}/${String(after.getMonth() + 1).padStart(2, "0")}/${String(after.getDate()).padStart(2, "0")}`;
    const messageIds = await listMessageIds(gmail, { query: `after:${afterStr}`, maxMessages: 2000 });
    await processMessages(messageIds);
  } else {
    // Sync by label (default)
    for (const labelName of config.labels) {
      const labelId = await resolveLabelId(gmail, labelName);
      if (!labelId) {
        result.errors.push(`Label not found: "${labelName}"`);
        continue;
      }

      const messageIds = await listMessageIds(gmail, { labelId });
      await processMessages(messageIds);
    }
  }

  return result;
}
