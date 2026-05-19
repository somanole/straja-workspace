export const BROWSER_UPLOAD_BLOB_ENVELOPE_KIND = "straja-vault-browser-upload-blob/v1";

export type BrowserUploadBlobEnvelope = {
  kind: typeof BROWSER_UPLOAD_BLOB_ENVELOPE_KIND;
  encoding: "base64";
  byteLength: number;
  data: string;
  mimeType?: string;
  originalName?: string;
};

export function normalizeBrowserUploadStagePath(input: string): string {
  const value = String(input ?? "").trim().replace(/\\/g, "/");
  if (!value) throw new Error("path is required");
  if (value.startsWith("/")) throw new Error("path must be relative");
  if (/^[A-Za-z]:\//.test(value)) throw new Error("path must be relative");
  if (value.includes("\0")) throw new Error("path contains invalid characters");

  const segments = value.split("/");
  if (segments.some((s) => !s || s === "." || s === "..")) {
    throw new Error("path contains invalid segments");
  }
  return segments.join("/");
}

export function encodeBrowserUploadBlobEnvelope(
  bytes: Uint8Array,
  opts?: { mimeType?: string; originalName?: string },
): string {
  const envelope: BrowserUploadBlobEnvelope = {
    kind: BROWSER_UPLOAD_BLOB_ENVELOPE_KIND,
    encoding: "base64",
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64"),
    ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts?.originalName ? { originalName: opts.originalName } : {}),
  };
  return JSON.stringify(envelope);
}

function isEnvelope(value: unknown): value is BrowserUploadBlobEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === BROWSER_UPLOAD_BLOB_ENVELOPE_KIND &&
    v.encoding === "base64" &&
    typeof v.byteLength === "number" &&
    Number.isInteger(v.byteLength) &&
    v.byteLength >= 0 &&
    typeof v.data === "string"
  );
}

export function decodeBrowserUploadBlobEnvelope(content: string): {
  bytes: Buffer;
  byteLength: number;
  mimeType?: string;
  originalName?: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isEnvelope(parsed)) return null;
  const bytes = Buffer.from(parsed.data, "base64");
  if (bytes.byteLength !== parsed.byteLength) {
    throw new Error("Invalid staged upload blob: byteLength mismatch");
  }
  return {
    bytes,
    byteLength: bytes.byteLength,
    ...(typeof parsed.mimeType === "string" ? { mimeType: parsed.mimeType } : {}),
    ...(typeof parsed.originalName === "string" ? { originalName: parsed.originalName } : {}),
  };
}

