import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  decodeBrowserUploadBlobEnvelope,
  encodeBrowserUploadBlobEnvelope,
} from "./browser-upload-staging.js";

function sha256Hex(value: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}

function isUtf8TextBuffer(bytes: Buffer): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes);
}

export function materializeStoredWorkspaceDocument(docContent: string): {
  bytes: Buffer;
  contentHash: string;
} {
  const blob = decodeBrowserUploadBlobEnvelope(docContent);
  const bytes = blob ? blob.bytes : Buffer.from(docContent, "utf8");
  return {
    bytes,
    contentHash: sha256Hex(bytes),
  };
}

export function serializeWorkspaceFileForStore(relPath: string, bytes: Buffer): {
  content: string;
  contentHash: string;
  storeHash: string;
} {
  const contentHash = sha256Hex(bytes);
  const content = isUtf8TextBuffer(bytes)
    ? bytes.toString("utf8")
    : encodeBrowserUploadBlobEnvelope(bytes, {
        mimeType: "application/octet-stream",
        originalName: basename(relPath),
      });
  return {
    content,
    contentHash,
    storeHash: sha256Hex(content),
  };
}
