/**
 * Google Contacts sync engine — fetches contacts via the People API and
 * converts them to individual vault documents (one markdown file per contact).
 *
 * Shared Google OAuth client credentials come from _config/google-oauth.json
 * (shared with Gmail — same Google Cloud project).
 * User tokens (refresh/access) are stored in _config/gcontacts.json inside the vault.
 */

import { google, type people_v1, type Auth } from "googleapis";
import { getGoogleOAuthClientConfig, hasGoogleOAuthClientConfig } from "./google-oauth-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactsConfig {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  email?: string;
  lastSync?: string;
  scopes?: string[];
  /** Enable automatic polling */
  pollEnabled?: boolean;
  /** Polling interval in minutes (default 60) */
  pollIntervalMinutes?: number;
  authErrorCode?: string;
  authErrorMessage?: string;
  authErrorAt?: string;
}

export interface Contact {
  resourceName: string; // e.g. "people/c12345"
  name: string;
  givenName?: string;
  familyName?: string;
  emails: string[];
  phones: string[];
  organization?: string;
  title?: string;
  addresses: string[];
  notes?: string;
  urls: string[];
  photoUrl?: string;
  updated?: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------

function getClientCredentials() {
  return getGoogleOAuthClientConfig();
}

export function hasContactsCredentials(): boolean {
  return hasGoogleOAuthClientConfig();
}

export function getContactsOAuth2Client(refreshToken?: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getClientCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}

export function generateContactsAuthUrl(redirectUri: string): string {
  const client = getContactsOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/contacts.readonly",
    ],
    redirect_uri: redirectUri,
  });
}

export async function exchangeContactsCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; email?: string }> {
  const client = getContactsOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received — try revoking app access in Google Account settings and reconnecting",
    );
  }

  // Get the user's email via tokeninfo (no extra scope needed)
  client.setCredentials(tokens);
  const tokenInfo = await client.getTokenInfo(tokens.access_token!).catch(() => null);
  const email = tokenInfo?.email || undefined;

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || "",
    email,
  };
}

// ---------------------------------------------------------------------------
// People API helpers
// ---------------------------------------------------------------------------

function getPeopleClient(config: ContactsConfig): people_v1.People {
  const client = getContactsOAuth2Client(config.refreshToken);
  return google.people({ version: "v1", auth: client });
}

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,urls,photos,metadata";

/**
 * Fetch all contacts from the user's Google account.
 */
async function fetchAllContacts(
  people: people_v1.People,
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  let pageToken: string | undefined;

  do {
    const res = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 100,
      personFields: PERSON_FIELDS,
      sortOrder: "LAST_NAME_ASCENDING",
      pageToken,
    });

    for (const person of res.data.connections ?? []) {
      const contact = personToContact(person);
      if (contact) contacts.push(contact);
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return contacts;
}

function personToContact(person: people_v1.Schema$Person): Contact | null {
  const rn = person.resourceName;
  if (!rn) return null;

  const primaryName = person.names?.[0];
  const name =
    primaryName?.displayName ||
    primaryName?.givenName ||
    person.emailAddresses?.[0]?.value ||
    "Unknown";

  return {
    resourceName: rn,
    name,
    givenName: primaryName?.givenName || undefined,
    familyName: primaryName?.familyName || undefined,
    emails: (person.emailAddresses ?? [])
      .map((e) => e.value)
      .filter((v): v is string => !!v),
    phones: (person.phoneNumbers ?? [])
      .map((p) => `${p.value || ""}${p.type ? ` (${p.type})` : ""}`.trim())
      .filter(Boolean),
    organization: person.organizations?.[0]?.name || undefined,
    title: person.organizations?.[0]?.title || undefined,
    addresses: (person.addresses ?? [])
      .map((a) => a.formattedValue)
      .filter((v): v is string => !!v),
    notes: person.biographies?.[0]?.value || undefined,
    urls: (person.urls ?? [])
      .map((u) => u.value)
      .filter((v): v is string => !!v),
    photoUrl: person.photos?.[0]?.url || undefined,
    updated:
      person.metadata?.sources?.[0]?.updateTime || undefined,
  };
}

// ---------------------------------------------------------------------------
// Markdown conversion
// ---------------------------------------------------------------------------

function contactToMarkdown(contact: Contact): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`resource_name: ${contact.resourceName}`);
  lines.push(`name: ${yamlEscape(contact.name)}`);
  if (contact.givenName) lines.push(`given_name: ${yamlEscape(contact.givenName)}`);
  if (contact.familyName) lines.push(`family_name: ${yamlEscape(contact.familyName)}`);
  if (contact.emails.length > 0) {
    lines.push(`emails:`);
    for (const e of contact.emails) lines.push(`  - ${e}`);
  }
  if (contact.phones.length > 0) {
    lines.push(`phones:`);
    for (const p of contact.phones) lines.push(`  - ${yamlEscape(p)}`);
  }
  if (contact.organization) lines.push(`organization: ${yamlEscape(contact.organization)}`);
  if (contact.title) lines.push(`title: ${yamlEscape(contact.title)}`);
  if (contact.updated) lines.push(`updated: ${contact.updated}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${contact.name}`);
  lines.push("");

  if (contact.organization || contact.title) {
    const parts = [contact.title, contact.organization].filter(Boolean);
    lines.push(`**${parts.join(" at ")}**`);
    lines.push("");
  }

  if (contact.emails.length > 0) {
    lines.push("## Email");
    for (const e of contact.emails) lines.push(`- ${e}`);
    lines.push("");
  }

  if (contact.phones.length > 0) {
    lines.push("## Phone");
    for (const p of contact.phones) lines.push(`- ${p}`);
    lines.push("");
  }

  if (contact.addresses.length > 0) {
    lines.push("## Address");
    for (const a of contact.addresses) lines.push(`- ${a}`);
    lines.push("");
  }

  if (contact.urls.length > 0) {
    lines.push("## Links");
    for (const u of contact.urls) lines.push(`- ${u}`);
    lines.push("");
  }

  if (contact.notes) {
    lines.push("## Notes");
    lines.push(contact.notes);
    lines.push("");
  }

  return lines.join("\n");
}

function yamlEscape(value: string): string {
  if (/[:#{}[\]&*?|>!%@`"']/.test(value) || value.includes("\n")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  config: ContactsConfig;
  documentExists: (collection: string, path: string) => boolean;
  /** Upsert a document. Returns true if content was new/changed, false if unchanged. */
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string,
  ) => Promise<boolean>;
}

export async function syncContacts(opts: SyncOptions): Promise<SyncResult> {
  const { config } = opts;
  const result: SyncResult = { imported: 0, skipped: 0, total: 0, errors: [] };

  if (!config.refreshToken) {
    result.errors.push("No refresh token — contacts not connected");
    return result;
  }

  const people = getPeopleClient(config);

  try {
    const contacts = await fetchAllContacts(people);
    result.total = contacts.length;

    for (const contact of contacts) {
      const path = `${sanitizeName(contact.name)}-${extractId(contact.resourceName)}.md`;
      try {
        const md = contactToMarkdown(contact);
        const changed = await opts.upsertDocument("_contacts", path, md, contact.name);
        if (changed) {
          result.imported++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push(`Contact ${contact.name}: ${String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Fetch contacts: ${String(err)}`);
  }

  return result;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "contact";
}

function extractId(resourceName: string): string {
  // "people/c12345" → "c12345"
  return resourceName.split("/").pop() || resourceName;
}
