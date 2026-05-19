/**
 * Google Calendar sync engine — fetches events and converts to vault documents.
 * Also provides CRUD operations for creating/updating/deleting events.
 *
 * Shared Google OAuth client credentials come from _config/google-oauth.json
 * (shared with Gmail — same Google Cloud project).
 * User tokens (refresh/access) are stored in _config/gcalendar.json inside the vault.
 */

import { google, type calendar_v3, type Auth } from "googleapis";
import { getGoogleOAuthClientConfig, hasGoogleOAuthClientConfig } from "./google-oauth-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarConfig {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  email?: string;
  /** Calendar IDs to sync (e.g. ["primary", "family@group.calendar.google.com"]) */
  calendars: { id: string; name: string }[];
  /** How many days back to sync (default 30) */
  syncWindowPastDays?: number;
  /** How many days forward to sync (default 90) */
  syncWindowFutureDays?: number;
  lastSync?: string;
  scopes?: string[];
  /** Enable automatic polling */
  pollEnabled?: boolean;
  /** Polling interval in minutes (default 15) */
  pollIntervalMinutes?: number;
  authErrorCode?: string;
  authErrorMessage?: string;
  authErrorAt?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string;
  allDay: boolean;
  attendees: string[];
  organizer?: string;
  status: string;
  htmlLink?: string;
  updated: string;
  recurrence?: string[];
}

export interface CalendarListEntry {
  id: string;
  name: string;
  primary: boolean;
  backgroundColor?: string;
}

export interface ImportedEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
  /** Newly imported or updated events (for notifications). */
  importedItems: ImportedEventSummary[];
}

export interface EventRequest {
  calendarId?: string; // defaults to "primary"
  summary: string;
  description?: string;
  start: string; // ISO 8601
  end: string;
  location?: string;
  attendees?: string[]; // email addresses
  timeZone?: string;
}

export interface EventResult {
  id: string;
  calendarId: string;
  htmlLink?: string;
  summary: string;
  start: string;
  end: string;
}

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------

function getClientCredentials() {
  return getGoogleOAuthClientConfig();
}

export function hasCalendarCredentials(): boolean {
  return hasGoogleOAuthClientConfig();
}

export function getCalendarOAuth2Client(refreshToken?: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getClientCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}

export function generateCalendarAuthUrl(redirectUri: string): string {
  const client = getCalendarOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    redirect_uri: redirectUri,
  });
}

export async function exchangeCalendarCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; email?: string }> {
  const client = getCalendarOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received — try revoking app access in Google Account settings and reconnecting",
    );
  }

  // Get the user's email from calendar settings
  client.setCredentials(tokens);
  const cal = google.calendar({ version: "v3", auth: client });
  const settings = await cal.settings.get({ setting: "timezone" }).catch(() => null);
  // Use the primary calendar's owner email
  const calList = await cal.calendarList.get({ calendarId: "primary" });
  const email = calList.data.id || undefined;

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || "",
    email,
  };
}

// ---------------------------------------------------------------------------
// Calendar API helpers
// ---------------------------------------------------------------------------

function getCalendarClient(config: CalendarConfig): calendar_v3.Calendar {
  const client = getCalendarOAuth2Client(config.refreshToken);
  return google.calendar({ version: "v3", auth: client });
}

/**
 * List calendars visible to the authenticated user.
 */
export async function listCalendars(
  config: CalendarConfig,
): Promise<CalendarListEntry[]> {
  const cal = getCalendarClient(config);
  const result: CalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const res = await cal.calendarList.list({
      maxResults: 100,
      pageToken,
    });
    for (const item of res.data.items ?? []) {
      if (item.id) {
        result.push({
          id: item.id,
          name: item.summary || item.id,
          primary: item.primary === true,
          backgroundColor: item.backgroundColor || undefined,
        });
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return result;
}

/**
 * Fetch events from a single calendar within the sync window.
 */
async function fetchEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      maxResults: 250,
      singleEvents: true, // expand recurring events
      orderBy: "startTime",
      pageToken,
    });

    for (const item of res.data.items ?? []) {
      if (!item.id) continue;

      const startDt = item.start?.dateTime || item.start?.date || "";
      const endDt = item.end?.dateTime || item.end?.date || "";
      const allDay = !item.start?.dateTime;

      events.push({
        id: item.id,
        calendarId,
        summary: item.summary || "(no title)",
        description: item.description || undefined,
        location: item.location || undefined,
        start: startDt,
        end: endDt,
        allDay,
        attendees: (item.attendees ?? [])
          .map((a) => a.email)
          .filter((e): e is string => !!e),
        organizer: item.organizer?.email || undefined,
        status: item.status || "confirmed",
        htmlLink: item.htmlLink || undefined,
        updated: item.updated || "",
        recurrence: item.recurrence || undefined,
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return events;
}

// ---------------------------------------------------------------------------
// Markdown conversion
// ---------------------------------------------------------------------------

function eventToMarkdown(event: CalendarEvent): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`event_id: ${event.id}`);
  lines.push(`calendar_id: ${event.calendarId}`);
  lines.push(`summary: ${yamlEscape(event.summary)}`);
  lines.push(`start: ${event.start}`);
  lines.push(`end: ${event.end}`);
  if (event.allDay) lines.push(`all_day: true`);
  if (event.location) lines.push(`location: ${yamlEscape(event.location)}`);
  if (event.organizer) lines.push(`organizer: ${event.organizer}`);
  if (event.attendees.length > 0) {
    lines.push(`attendees:`);
    for (const a of event.attendees) {
      lines.push(`  - ${a}`);
    }
  }
  lines.push(`status: ${event.status}`);
  if (event.htmlLink) lines.push(`link: ${event.htmlLink}`);
  lines.push(`updated: ${event.updated}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${event.summary}`);
  lines.push("");

  if (event.allDay) {
    lines.push(`**All day** — ${formatDate(event.start)} to ${formatDate(event.end)}`);
  } else {
    lines.push(`**When:** ${formatDateTime(event.start)} — ${formatDateTime(event.end)}`);
  }

  if (event.location) {
    lines.push(`**Where:** ${event.location}`);
  }
  if (event.attendees.length > 0) {
    lines.push(`**Attendees:** ${event.attendees.join(", ")}`);
  }

  if (event.description) {
    lines.push("");
    lines.push(event.description);
  }

  lines.push("");
  return lines.join("\n");
}

function yamlEscape(value: string): string {
  if (/[:#{}[\]&*?|>!%@`"']/.test(value) || value.includes("\n")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  config: CalendarConfig;
  documentExists: (collection: string, path: string) => boolean;
  /** Upsert a document. Returns true if content was new/changed, false if unchanged. */
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string,
  ) => Promise<boolean>;
}

export async function syncCalendar(opts: SyncOptions): Promise<SyncResult> {
  const { config } = opts;
  const result: SyncResult = { imported: 0, skipped: 0, total: 0, errors: [], importedItems: [] };

  if (!config.refreshToken) {
    result.errors.push("No refresh token — calendar not connected");
    return result;
  }

  const calendars = config.calendars;
  if (calendars.length === 0) {
    result.errors.push("No calendars selected for sync");
    return result;
  }

  const cal = getCalendarClient(config);
  const pastDays = config.syncWindowPastDays ?? 30;
  const futureDays = config.syncWindowFutureDays ?? 90;
  const now = new Date();
  const timeMin = new Date(now.getTime() - pastDays * 86400000).toISOString();
  const timeMax = new Date(now.getTime() + futureDays * 86400000).toISOString();

  for (const calendar of calendars) {
    try {
      const events = await fetchEvents(cal, calendar.id, timeMin, timeMax);
      result.total += events.length;

      for (const event of events) {
        const path = `${sanitizePath(calendar.id)}/${event.id}.md`;
        try {
          // Always upsert — the content hash dedup in the vault handles unchanged docs
          const md = eventToMarkdown(event);
          const changed = await opts.upsertDocument("_calendar", path, md, event.summary);
          if (changed) {
            result.imported++;
            result.importedItems.push({
              id: event.id,
              summary: event.summary,
              start: event.start,
              end: event.end,
              allDay: event.allDay,
              calendarName: calendar.name,
            });
          } else {
            result.skipped++;
          }
        } catch (err) {
          result.errors.push(`Event ${event.id}: ${String(err)}`);
        }
      }
    } catch (err) {
      result.errors.push(`Calendar ${calendar.name}: ${String(err)}`);
    }
  }

  return result;
}

function sanitizePath(s: string): string {
  return s.replace(/[^a-zA-Z0-9._@-]/g, "_");
}

// ---------------------------------------------------------------------------
// Event CRUD
// ---------------------------------------------------------------------------

export async function createCalendarEvent(
  config: CalendarConfig,
  req: EventRequest,
): Promise<EventResult> {
  const cal = getCalendarClient(config);
  const calendarId = req.calendarId || "primary";

  const eventBody: calendar_v3.Schema$Event = {
    summary: req.summary,
    description: req.description,
    location: req.location,
    start: buildEventTime(req.start, req.timeZone),
    end: buildEventTime(req.end, req.timeZone),
  };

  if (req.attendees && req.attendees.length > 0) {
    eventBody.attendees = req.attendees.map((email) => ({ email }));
  }

  const res = await cal.events.insert({
    calendarId,
    requestBody: eventBody,
  });

  const data = res.data;
  return {
    id: data.id!,
    calendarId,
    htmlLink: data.htmlLink || undefined,
    summary: data.summary || req.summary,
    start: data.start?.dateTime || data.start?.date || req.start,
    end: data.end?.dateTime || data.end?.date || req.end,
  };
}

export async function updateCalendarEvent(
  config: CalendarConfig,
  calendarId: string,
  eventId: string,
  req: Partial<EventRequest>,
): Promise<EventResult> {
  const cal = getCalendarClient(config);

  // Fetch the current event first
  const existing = await cal.events.get({ calendarId, eventId });
  const eventBody: calendar_v3.Schema$Event = { ...existing.data };

  if (req.summary !== undefined) eventBody.summary = req.summary;
  if (req.description !== undefined) eventBody.description = req.description;
  if (req.location !== undefined) eventBody.location = req.location;
  if (req.start !== undefined) eventBody.start = buildEventTime(req.start, req.timeZone);
  if (req.end !== undefined) eventBody.end = buildEventTime(req.end, req.timeZone);
  if (req.attendees !== undefined) {
    eventBody.attendees = req.attendees.map((email) => ({ email }));
  }

  const res = await cal.events.update({
    calendarId,
    eventId,
    requestBody: eventBody,
  });

  const data = res.data;
  return {
    id: data.id!,
    calendarId,
    htmlLink: data.htmlLink || undefined,
    summary: data.summary || "",
    start: data.start?.dateTime || data.start?.date || "",
    end: data.end?.dateTime || data.end?.date || "",
  };
}

export async function deleteCalendarEvent(
  config: CalendarConfig,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const cal = getCalendarClient(config);
  await cal.events.delete({ calendarId, eventId });
}

function buildEventTime(
  iso: string,
  timeZone?: string,
): calendar_v3.Schema$EventDateTime {
  // If it looks like a date-only string (YYYY-MM-DD), use 'date' field
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { date: iso };
  }
  const result: calendar_v3.Schema$EventDateTime = { dateTime: iso };
  if (timeZone) result.timeZone = timeZone;
  return result;
}
