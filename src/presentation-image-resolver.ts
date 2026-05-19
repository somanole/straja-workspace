import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname } from "node:path";
import {
  decodeBrowserUploadBlobEnvelope,
} from "./browser-upload-staging.js";
import type { PresentationSpec } from "./presentations.js";
import type { ReportSpec } from "./reports.js";
import type { Store } from "./store.js";

const PRESENTATION_IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const PRESENTATION_IMAGE_FETCH_TIMEOUT_MS = 15_000;
const PRESENTATION_IMAGE_MAX_REDIRECTS = 3;
export const MAX_PRESENTATION_IMAGE_BYTES = 10 * 1024 * 1024;

type MinimalStore = Pick<Store, "getDocumentWithContent">;

type RemoteImageFetchResult = {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
};

type Ipv4Tuple = [number, number, number, number];
type Ipv6Hextets = [number, number, number, number, number, number, number, number];

type PinnedHostname = {
  hostname: string;
  addresses: string[];
  lookup: (
    hostname: string,
    options:
      | number
      | { all?: boolean; family?: number }
      | ((err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void)
      | undefined,
    callback?: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => void;
};

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

export function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;
  const mimeType = value.split(";")[0]?.trim().toLowerCase();
  return mimeType || null;
}

function inferImageMimeType(source: string): string | null {
  try {
    const pathname = source.startsWith("http://") || source.startsWith("https://")
      ? new URL(source).pathname
      : source;
    return PRESENTATION_IMAGE_MIME_TYPES[extname(pathname).toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

function describePresentationSlide(index: number, slide: PresentationSpec["slides"][number]): string {
  return slide.title ? `slide ${index + 1} ("${slide.title}")` : `slide ${index + 1}`;
}

function parseStrictIpv4Octet(part: string): number | null {
  if (!/^[0-9]+$/.test(part)) {
    return null;
  }
  const value = Number.parseInt(part, 10);
  if (Number.isNaN(value) || value < 0 || value > 255) {
    return null;
  }
  if (part !== String(value)) {
    return null;
  }
  return value;
}

function parseIpv4(address: string): Ipv4Tuple | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  for (const part of parts) {
    if (parseStrictIpv4Octet(part) === null) {
      return null;
    }
  }
  return parts.map((part) => Number.parseInt(part, 10)) as Ipv4Tuple;
}

function classifyIpv4Part(part: string): "decimal" | "hex" | "invalid-hex" | "non-numeric" {
  if (/^0x[0-9a-f]+$/i.test(part)) {
    return "hex";
  }
  if (/^0x/i.test(part)) {
    return "invalid-hex";
  }
  if (/^[0-9]+$/.test(part)) {
    return "decimal";
  }
  return "non-numeric";
}

function isUnsupportedLegacyIpv4Literal(address: string): boolean {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) {
    return false;
  }
  if (parts.some((part) => part.length === 0)) {
    return true;
  }

  const partKinds = parts.map(classifyIpv4Part);
  if (partKinds.some((kind) => kind === "non-numeric")) {
    return false;
  }
  if (partKinds.some((kind) => kind === "invalid-hex")) {
    return true;
  }

  if (parts.length !== 4) {
    return true;
  }
  for (const part of parts) {
    if (/^0x/i.test(part)) {
      return true;
    }
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value) || value > 255 || part !== String(value)) {
      return true;
    }
  }
  return false;
}

function stripIpv6ZoneId(address: string): string {
  const index = address.indexOf("%");
  return index >= 0 ? address.slice(0, index) : address;
}

function parseIpv6Hextets(address: string): Ipv6Hextets | null {
  let input = stripIpv6ZoneId(address.trim().toLowerCase());
  if (!input) {
    return null;
  }

  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) {
      return null;
    }
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (!ipv4) {
      return null;
    }
    const high = (ipv4[0] << 8) + ipv4[1];
    const low = (ipv4[2] << 8) + ipv4[3];
    input = `${input.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const doubleColonParts = input.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const head = doubleColonParts[0] ?? "";
  const tail = doubleColonParts[1] ?? "";
  const headParts =
    head.length > 0 ? head.split(":").filter(Boolean) : [];
  const tailParts =
    doubleColonParts.length === 2 && tail.length > 0
      ? tail.split(":").filter(Boolean)
      : [];

  const missingParts = 8 - headParts.length - tailParts.length;
  if (missingParts < 0) {
    return null;
  }

  const fullParts =
    doubleColonParts.length === 1
      ? input.split(":")
      : [...headParts, ...Array.from({ length: missingParts }, () => "0"), ...tailParts];

  if (fullParts.length !== 8) {
    return null;
  }

  const hextets: number[] = [];
  for (const part of fullParts) {
    if (!part) {
      return null;
    }
    const value = Number.parseInt(part, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) {
      return null;
    }
    hextets.push(value);
  }
  return hextets as Ipv6Hextets;
}

function decodeIpv4FromHextets(high: number, low: number): Ipv4Tuple {
  return [(high >>> 8) & 0xff, high & 0xff, (low >>> 8) & 0xff, low & 0xff];
}

type EmbeddedIpv4Rule = {
  matches: (hextets: Ipv6Hextets) => boolean;
  extract: (hextets: Ipv6Hextets) => [high: number, low: number];
};

const EMBEDDED_IPV4_RULES: EmbeddedIpv4Rule[] = [
  {
    matches: (hextets) =>
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      (hextets[5] === 0xffff || hextets[5] === 0),
    extract: (hextets) => [hextets[6], hextets[7]],
  },
  {
    matches: (hextets) =>
      hextets[0] === 0x0064 &&
      hextets[1] === 0xff9b &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0,
    extract: (hextets) => [hextets[6], hextets[7]],
  },
  {
    matches: (hextets) =>
      hextets[0] === 0x0064 &&
      hextets[1] === 0xff9b &&
      hextets[2] === 0x0001 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0,
    extract: (hextets) => [hextets[6], hextets[7]],
  },
  {
    matches: (hextets) => hextets[0] === 0x2002,
    extract: (hextets) => [hextets[1], hextets[2]],
  },
  {
    matches: (hextets) => hextets[0] === 0x2001 && hextets[1] === 0x0000,
    extract: (hextets) => [hextets[6] ^ 0xffff, hextets[7] ^ 0xffff],
  },
  {
    matches: (hextets) => (hextets[4] & 0xfcff) === 0 && hextets[5] === 0x5efe,
    extract: (hextets) => [hextets[6], hextets[7]],
  },
];

function extractIpv4FromEmbeddedIpv6(hextets: Ipv6Hextets): Ipv4Tuple | null {
  for (const rule of EMBEDDED_IPV4_RULES) {
    if (!rule.matches(hextets)) {
      continue;
    }
    const [high, low] = rule.extract(hextets);
    return decodeIpv4FromHextets(high, low);
  }
  return null;
}

function isPrivateIpv4(parts: Ipv4Tuple): boolean {
  const [octet1, octet2] = parts;
  if (octet1 === 0) return true;
  if (octet1 === 10) return true;
  if (octet1 === 127) return true;
  if (octet1 === 169 && octet2 === 254) return true;
  if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true;
  if (octet1 === 192 && octet2 === 168) return true;
  if (octet1 === 100 && octet2 >= 64 && octet2 <= 127) return true;
  return false;
}

function isPrivateIpAddress(address: string): boolean {
  let normalized = address.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (!normalized) {
    return false;
  }

  if (normalized.includes(":")) {
    const hextets = parseIpv6Hextets(normalized);
    if (!hextets) {
      return true;
    }

    const isUnspecified =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0 &&
      hextets[6] === 0 &&
      hextets[7] === 0;
    const isLoopback =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0 &&
      hextets[6] === 0 &&
      hextets[7] === 1;
    if (isUnspecified || isLoopback) {
      return true;
    }

    const embeddedIpv4 = extractIpv4FromEmbeddedIpv6(hextets);
    if (embeddedIpv4) {
      return isPrivateIpv4(embeddedIpv4);
    }

    const first = hextets[0];
    if ((first & 0xffc0) === 0xfe80) return true;
    if ((first & 0xffc0) === 0xfec0) return true;
    if ((first & 0xfe00) === 0xfc00) return true;
    return false;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isPrivateIpv4(ipv4);
  }
  if (isUnsupportedLegacyIpv4Literal(normalized)) {
    return true;
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function isBlockedHostnameOrIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }
  return isBlockedHostname(normalized) || isPrivateIpAddress(normalized);
}

function createPinnedLookup(params: { hostname: string; addresses: string[] }): PinnedHostname["lookup"] {
  const normalizedHost = normalizeHostname(params.hostname);
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  let index = 0;

  return ((host, options, callback) => {
    const cb =
      typeof options === "function"
        ? options
        : callback;
    if (!cb) {
      return;
    }
    const normalized = normalizeHostname(host);
    if (!normalized || normalized !== normalizedHost) {
      cb(new Error(`Unexpected hostname lookup: ${host}`) as NodeJS.ErrnoException, "", 0);
      return;
    }

    const requestedFamily =
      typeof options === "number"
        ? options
        : typeof options === "object" && options !== null && typeof options.family === "number"
          ? options.family
          : 0;
    const wantsAll =
      typeof options === "object" && options !== null && options.all === true;

    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((entry) => entry.family === requestedFamily)
        : records;
    const usable = candidates.length > 0 ? candidates : records;

    if (wantsAll) {
      cb(null, usable as LookupAddress[]);
      return;
    }

    const chosen = usable[index % usable.length]!;
    index += 1;
    cb(null, chosen.address, chosen.family);
  });
}

async function resolvePinnedHostname(hostname: string): Promise<PinnedHostname> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }
  if (isBlockedHostnameOrIp(normalized)) {
    throw new Error("Blocked hostname or private/internal IP address");
  }

  const results = await dnsLookup(normalized, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
  for (const entry of results) {
    if (isPrivateIpAddress(entry.address)) {
      throw new Error("Blocked: resolves to private/internal IP address");
    }
  }

  const addresses = Array.from(new Set(results.map((entry) => entry.address)));
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  return {
    hostname: normalized,
    addresses,
    lookup: createPinnedLookup({ hostname: normalized, addresses }),
  };
}

function firstHeaderValue(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function fetchRemotePresentationImage(
  source: string,
  options?: { maxRedirects?: number; maxBytes?: number; timeoutMs?: number },
): Promise<RemoteImageFetchResult> {
  const visited = new Set<string>();
  const maxRedirects = options?.maxRedirects ?? PRESENTATION_IMAGE_MAX_REDIRECTS;
  const maxBytes = options?.maxBytes ?? MAX_PRESENTATION_IMAGE_BYTES;
  const timeoutMs = options?.timeoutMs ?? PRESENTATION_IMAGE_FETCH_TIMEOUT_MS;

  async function fetchUrl(currentUrl: string, redirectsRemaining: number): Promise<RemoteImageFetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error("Invalid URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid URL protocol");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Authenticated URLs are not allowed");
    }

    const pinned = await resolvePinnedHostname(parsed.hostname);
    const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<RemoteImageFetchResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const req = requestFn(parsed, {
        method: "GET",
        headers: {
          Accept: "image/*,*/*;q=0.1",
          "User-Agent": "StrajaVault/PresentationBuilder",
        },
        lookup: pinned.lookup as any,
      }, (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = firstHeaderValue(res.headers.location);

        if (isRedirectStatus(statusCode)) {
          res.resume();
          if (!location) {
            finish(() => reject(new Error(`Redirect missing location header (${statusCode})`)));
            return;
          }
          if (redirectsRemaining <= 0) {
            finish(() => reject(new Error(`Too many redirects (limit: ${maxRedirects})`)));
            return;
          }

          let nextUrl: string;
          try {
            nextUrl = new URL(location, parsed).toString();
          } catch {
            finish(() => reject(new Error("Redirect location is invalid")));
            return;
          }
          if (visited.has(nextUrl)) {
            finish(() => reject(new Error("Redirect loop detected")));
            return;
          }
          visited.add(nextUrl);
          void fetchUrl(nextUrl, redirectsRemaining - 1)
            .then((result) => finish(() => resolve(result)))
            .catch((err) => finish(() => reject(err)));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          finish(() => reject(new Error(`HTTP ${statusCode}${res.statusMessage ? ` ${res.statusMessage}` : ""}`)));
          return;
        }

        const contentLengthHeader = firstHeaderValue(res.headers["content-length"]);
        if (contentLengthHeader) {
          const contentLength = Number(contentLengthHeader);
          if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            res.resume();
            finish(() => reject(new Error(`payload exceeds maxBytes ${maxBytes}`)));
            return;
          }
        }

        const chunks: Buffer[] = [];
        let total = 0;

        res.on("data", (chunk: Buffer | string) => {
          const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bufferChunk.length;
          if (total > maxBytes) {
            res.destroy(new Error(`payload exceeds maxBytes ${maxBytes}`));
            return;
          }
          chunks.push(bufferChunk);
        });

        res.on("end", () => {
          finish(() => resolve({
            buffer: Buffer.concat(chunks, total),
            contentType: normalizeMimeType(firstHeaderValue(res.headers["content-type"])),
            finalUrl: parsed.toString(),
          }));
        });

        res.on("error", (err) => {
          finish(() => reject(err));
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("request timed out"));
      });
      req.on("error", (err) => {
        finish(() => reject(err));
      });
      req.end();
    });
  }

  visited.add(source);
  return fetchUrl(source, maxRedirects);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function looksLikeSvg(buffer: Buffer): boolean {
  const snippet = stripBom(buffer.subarray(0, 4096).toString("utf8")).trimStart();
  if (!snippet) {
    return false;
  }
  if (/^<svg[\s>]/i.test(snippet)) {
    return true;
  }
  if (/^<\?xml[\s\S]*<svg[\s>]/i.test(snippet)) {
    return true;
  }
  return /<svg[\s>]/i.test(snippet.slice(0, 512));
}

function detectSupportedImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  if (looksLikeSvg(buffer)) {
    return "image/svg+xml";
  }
  return null;
}

function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function validateImageBuffer(
  buffer: Buffer,
  context: string,
  hintedMimeType?: string | null,
): { mimeType: string; dataUri: string } | { error: string } {
  if (!buffer.byteLength) {
    return { error: `${context} was empty` };
  }
  if (buffer.byteLength > MAX_PRESENTATION_IMAGE_BYTES) {
    return {
      error: `${context} exceeds ${(MAX_PRESENTATION_IMAGE_BYTES / (1024 * 1024)).toFixed(0)}MB limit`,
    };
  }

  const detectedMimeType = detectSupportedImageMimeType(buffer);
  const normalizedHint = normalizeMimeType(hintedMimeType);

  if (!detectedMimeType) {
    if (normalizedHint && normalizedHint.startsWith("image/")) {
      return { error: `${context} is not a supported image file` };
    }
    return { error: `${context} is not an image` };
  }

  return {
    mimeType: detectedMimeType,
    dataUri: toDataUri(buffer, detectedMimeType),
  };
}

function parseDataUri(source: string): { mimeType: string | null; buffer: Buffer } | { error: string } {
  const commaIndex = source.indexOf(",");
  if (commaIndex < 0) {
    return { error: "invalid data URI" };
  }
  const meta = source.slice(5, commaIndex);
  const payload = source.slice(commaIndex + 1);
  const parts = meta.split(";").filter(Boolean);
  const mimeType = normalizeMimeType(parts[0] ?? null);
  const isBase64 = parts.some((part) => part.trim().toLowerCase() === "base64");

  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mimeType, buffer };
  } catch {
    return { error: "invalid data URI payload" };
  }
}

function resolveInlineStoredImage(
  content: string,
  sourcePath: string,
): { dataUri: string } | { error: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: `editable/${sourcePath} was empty` };
  }

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUri(trimmed);
    if ("error" in parsed) {
      return { error: `editable/${sourcePath} ${parsed.error}` };
    }
    const validated = validateImageBuffer(parsed.buffer, `editable/${sourcePath}`, parsed.mimeType);
    if ("error" in validated) {
      return { error: validated.error };
    }
    return { dataUri: validated.dataUri };
  }

  const hintedMimeType = inferImageMimeType(sourcePath);
  const validated = validateImageBuffer(
    Buffer.from(trimmed, "utf8"),
    `editable/${sourcePath}`,
    hintedMimeType,
  );
  if ("error" in validated) {
    return { error: validated.error };
  }
  return { dataUri: validated.dataUri };
}

async function resolveImageSource(
  store: MinimalStore,
  source: string,
  context: string,
  editableCollection: string,
): Promise<{ dataUri: string } | { error: string }> {
  if (source.startsWith("data:")) {
    const parsed = parseDataUri(source);
    if ("error" in parsed) {
      return { error: `${context}: ${parsed.error}` };
    }
    const validated = validateImageBuffer(parsed.buffer, `${context} image`, parsed.mimeType);
    if ("error" in validated) {
      return { error: `${context}: ${validated.error}` };
    }
    return { dataUri: validated.dataUri };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    try {
      const fetched = await fetchRemotePresentationImage(source);
      const validated = validateImageBuffer(
        fetched.buffer,
        fetched.finalUrl,
        fetched.contentType ?? inferImageMimeType(fetched.finalUrl),
      );
      if ("error" in validated) {
        return { error: `${context}: ${validated.error}` };
      }
      return { dataUri: validated.dataUri };
    } catch (err: any) {
      return {
        error: `${context}: failed to fetch image ${source} (${err?.message || "request failed"})`,
      };
    }
  }

  const imgDoc = store.getDocumentWithContent(editableCollection, source);
  if (!imgDoc) {
    return { error: `${context}: image artifact not found at ${editableCollection}/${source}` };
  }

  try {
    const blob = decodeBrowserUploadBlobEnvelope(imgDoc.content);
    if (blob) {
      const validated = validateImageBuffer(
        blob.bytes,
        `${editableCollection}/${source}`,
        normalizeMimeType(blob.mimeType) ?? inferImageMimeType(source),
      );
      if ("error" in validated) {
        return { error: `${context}: ${validated.error}` };
      }
      return { dataUri: validated.dataUri };
    }

    const inline = resolveInlineStoredImage(imgDoc.content, source);
    if ("error" in inline) {
      return { error: `${context}: ${inline.error}` };
    }
    return { dataUri: inline.dataUri };
  } catch (err: any) {
    return {
      error:
        `${context}: failed to read image artifact ${editableCollection}/${source} ` +
        `(${err?.message || "invalid content"})`,
    };
  }
}

export async function resolvePresentationImages(
  store: MinimalStore,
  spec: PresentationSpec,
  options?: { editableCollection?: string },
): Promise<string[]> {
  const issues: string[] = [];
  const editableCollection = options?.editableCollection ?? "_editable";

  for (const [index, slide] of spec.slides.entries()) {
    if (slide.type !== "image" || !slide.image?.data) continue;

    const source = slide.image.data.trim();
    if (!source) continue;
    slide.image.data = source;

    const slideLabel = describePresentationSlide(index, slide);
    const resolved = await resolveImageSource(store, source, slideLabel, editableCollection);
    if ("error" in resolved) {
      issues.push(resolved.error);
      continue;
    }
    slide.image.data = resolved.dataUri;
  }

  return issues;
}

export async function resolveReportImages(
  store: MinimalStore,
  spec: ReportSpec,
  options?: { editableCollection?: string },
): Promise<string[]> {
  const issues: string[] = [];
  const editableCollection = options?.editableCollection ?? "_editable";

  if (spec.hero?.data) {
    const heroSource = spec.hero.data.trim();
    spec.hero.data = heroSource;
    const resolved = await resolveImageSource(store, heroSource, "report hero image", editableCollection);
    if ("error" in resolved) {
      issues.push(resolved.error);
    } else {
      spec.hero.data = resolved.dataUri;
    }
  }

  for (const [sectionIndex, section] of spec.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (block.type !== "image") continue;

      const source = block.image.data.trim();
      block.image.data = source;
      const context = section.heading
        ? `section ${sectionIndex + 1} ("${section.heading}") block ${blockIndex + 1}`
        : `section ${sectionIndex + 1} block ${blockIndex + 1}`;
      const resolved = await resolveImageSource(store, source, context, editableCollection);
      if ("error" in resolved) {
        issues.push(resolved.error);
        continue;
      }
      block.image.data = resolved.dataUri;
    }
  }

  return issues;
}
