/**
 * Google Drive sync engine — fetches files from selected folders and converts
 * them to vault documents.
 *
 * Shared Google OAuth client credentials come from _config/google-oauth.json
 * (shared with Gmail — same Google Cloud project).
 * User tokens (refresh/access) are stored in _config/gdrive.json inside the vault.
 */

import { google, type drive_v3, type Auth } from "googleapis";
import { encodeBrowserUploadBlobEnvelope } from "./browser-upload-staging.js";
import { buildIndexPath } from "./store.js";
import { getGoogleOAuthClientConfig, hasGoogleOAuthClientConfig } from "./google-oauth-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveConfig {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  email?: string;
  folders: { id: string; name: string }[];
  includeSubfolders: boolean;
  lastSync?: string;
  /** Enable automatic polling */
  pollEnabled?: boolean;
  /** Polling interval in minutes (default 30) */
  pollIntervalMinutes?: number;
  authErrorCode?: string;
  authErrorMessage?: string;
  authErrorAt?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parents: string[];
  size?: string;
  webViewLink?: string;
}

export interface DriveBrowseItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

export interface DriveBrowseResult {
  items: DriveBrowseItem[];
  current: { id: string; name: string } | null;
  parent: string | null;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
}

// Google Workspace MIME types
const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";
const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

/** MIME types we can extract text from. */
const EXPORTABLE_MIMES = new Set([GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDE]);

/** File MIME types we can download directly. */
const DOWNLOADABLE_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/xml",
  "application/json",
  "application/pdf",
  "application/rtf",
]);

/** Check if we can extract text from this MIME type. */
function isTextExtractable(mimeType: string): boolean {
  return (
    EXPORTABLE_MIMES.has(mimeType) ||
    DOWNLOADABLE_MIMES.has(mimeType) ||
    mimeType.startsWith("text/")
  );
}

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------

function getClientCredentials() {
  return getGoogleOAuthClientConfig();
}

export function hasDriveCredentials(): boolean {
  return hasGoogleOAuthClientConfig();
}

export function getDriveOAuth2Client(refreshToken?: string): Auth.OAuth2Client {
  const { clientId, clientSecret } = getClientCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}

export function generateDriveAuthUrl(redirectUri: string): string {
  const client = getDriveOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.readonly"],
    redirect_uri: redirectUri,
  });
}

export async function exchangeDriveCode(
  code: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string; email?: string }> {
  const client = getDriveOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received — try revoking app access in Google Account settings and reconnecting"
    );
  }

  // Get the user's email address
  client.setCredentials(tokens);
  const drive = google.drive({ version: "v3", auth: client });
  const about = await drive.about.get({ fields: "user" });

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || "",
    email: about.data.user?.emailAddress || undefined,
  };
}

// ---------------------------------------------------------------------------
// Drive API helpers
// ---------------------------------------------------------------------------

function getDrive(config: DriveConfig): drive_v3.Drive {
  const client = getDriveOAuth2Client(config.refreshToken);
  return google.drive({ version: "v3", auth: client });
}

const FILE_FIELDS = "id, name, mimeType, modifiedTime, parents, size, webViewLink";

/**
 * List files in a folder (non-recursive).
 */
async function listFilesInFolder(
  drive: drive_v3.Drive,
  folderId: string
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: 100,
      pageToken,
    });
    for (const f of data.files || []) {
      files.push({
        id: f.id || "",
        name: f.name || "Untitled",
        mimeType: f.mimeType || "",
        modifiedTime: f.modifiedTime || "",
        parents: f.parents || [],
        size: f.size || undefined,
        webViewLink: f.webViewLink || undefined,
      });
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

/**
 * Recursively list all extractable files in a folder tree.
 */
async function listFolderTree(
  drive: drive_v3.Drive,
  folderId: string,
  pathPrefix: string = ""
): Promise<{ file: DriveFile; folderPath: string }[]> {
  const results: { file: DriveFile; folderPath: string }[] = [];
  const children = await listFilesInFolder(drive, folderId);

  for (const child of children) {
    if (child.mimeType === GOOGLE_FOLDER) {
      // Recurse into subfolders
      const subPath = pathPrefix ? `${pathPrefix}/${child.name}` : child.name;
      const subFiles = await listFolderTree(drive, child.id, subPath);
      results.push(...subFiles);
    } else if (isTextExtractable(child.mimeType)) {
      results.push({ file: child, folderPath: pathPrefix });
    }
  }

  return results;
}

/**
 * Export or download a file's text content.
 */
export async function exportFileContent(
  drive: drive_v3.Drive,
  file: DriveFile
): Promise<string | null> {
  try {
    // Google Workspace files → export
    if (file.mimeType === GOOGLE_DOC) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: "text/plain" },
        { responseType: "text" }
      );
      return (res.data as string) || null;
    }
    if (file.mimeType === GOOGLE_SHEET) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: "text/csv" },
        { responseType: "text" }
      );
      return (res.data as string) || null;
    }
    if (file.mimeType === GOOGLE_SLIDE) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: "text/plain" },
        { responseType: "text" }
      );
      return (res.data as string) || null;
    }

    // PDF → download binary then extract text
    if (file.mimeType === "application/pdf") {
      const res = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "arraybuffer" }
      );
      try {
        const { PDFParse } = await import("pdf-parse");
        const buffer = Buffer.from(res.data as ArrayBuffer);
        const pdf = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await pdf.getText();
        await pdf.destroy();
        return result.text || null;
      } catch {
        return null; // pdf-parse failed
      }
    }

    // Plain text files → download directly
    if (
      file.mimeType.startsWith("text/") ||
      DOWNLOADABLE_MIMES.has(file.mimeType)
    ) {
      const res = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "text" }
      );
      return (res.data as string) || null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a Drive file + its text content into a markdown document with frontmatter.
 */
export function driveFileToMarkdown(
  file: DriveFile,
  content: string,
  folderPath: string
): string {
  const frontmatter = [
    "---",
    `name: ${file.name}`,
    `mime_type: ${file.mimeType}`,
    `modified: ${file.modifiedTime}`,
    `drive_id: ${file.id}`,
    ...(folderPath ? [`folder: ${folderPath}`] : []),
    ...(file.webViewLink ? [`link: ${file.webViewLink}`] : []),
    "---",
  ].join("\n");

  const title = file.name.replace(/\.[^.]+$/, ""); // strip extension
  return `${frontmatter}\n\n# ${title}\n\n${content.trim()}\n`;
}

type SheetPage = { content: string; pageSuffix: string };

/**
 * Export a Google Sheet as structured JSON (one entry per non-empty sheet).
 * Exports as xlsx binary → parses with SheetJS, same format as vault.ts extractText.
 * Also returns the raw xlsx buffer so it can be saved as an asset.
 */
async function exportSheetAsJson(
  drive: drive_v3.Drive,
  file: DriveFile
): Promise<{ pages: SheetPage[]; xlsxBuffer: Buffer } | null> {
  try {
    const XLSX = await import("xlsx");
    const res = await drive.files.export(
      {
        fileId: file.id,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { responseType: "arraybuffer" }
    );
    const xlsxBuffer = Buffer.from(res.data as ArrayBuffer);
    const wb = XLSX.read(xlsxBuffer, { type: "buffer" });

    if (wb.SheetNames.length === 0) return null;

    if (wb.SheetNames.length === 1) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!);
      if (rows.length === 0) return null;
      return {
        pages: [{ content: JSON.stringify(rows, null, 2), pageSuffix: "" }],
        xlsxBuffer,
      };
    }

    // Multi-sheet → one document per non-empty sheet with #sheet-<slug> suffix
    const pages = wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!);
      if (rows.length === 0) return null;
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return {
        content: JSON.stringify(rows, null, 2),
        pageSuffix: `#sheet-${slug}`,
      };
    }).filter(Boolean) as SheetPage[];

    return pages.length > 0 ? { pages, xlsxBuffer } : null;
  } catch {
    return null;
  }
}

/**
 * Wrap sheet JSON content with a `_source_asset` reference for the agent.
 */
function wrapSheetContent(rawJson: string, assetPath: string): string {
  const rows = JSON.parse(rawJson);
  return JSON.stringify({ _source_asset: assetPath, data: rows }, null, 2);
}

type PdfPage = { content: string; pageNum?: number; pageSuffix: string };

/**
 * Download a PDF from Drive, return the raw buffer + per-page text.
 * Mirrors the local extractText(pdf) path in vault.ts.
 */
async function exportPdfContent(
  drive: drive_v3.Drive,
  file: DriveFile,
): Promise<{ pages: PdfPage[]; pdfBuffer: Buffer } | null> {
  try {
    const res = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "arraybuffer" },
    );
    const pdfBuffer = Buffer.from(res.data as ArrayBuffer);

    let pages: PdfPage[] = [];
    try {
      const { PDFParse } = await import("pdf-parse");
      const pdf = new PDFParse({ data: new Uint8Array(pdfBuffer) });
      const result = await pdf.getText();
      await pdf.destroy();

      if (result.pages && result.pages.length > 1) {
        pages = result.pages
          .filter((p: { text: string }) => p.text.trim().length > 0)
          .map((p: { num: number; text: string }) => ({
            content: p.text,
            pageSuffix: `#page-${p.num}`,
            pageNum: p.num,
          }));
      } else if (result.text?.trim()) {
        pages = [{ content: result.text, pageSuffix: "" }];
      }
    } catch {
      // Text extraction failed — still return the buffer so the binary is stored
      pages = [];
    }

    return { pages, pdfBuffer };
  } catch {
    return null;
  }
}

/**
 * Given a PDF buffer, produce the blob envelope string suitable for upsertDocument.
 */
function pdfToBlobEnvelope(pdfBuffer: Buffer, fileName: string): string {
  return encodeBrowserUploadBlobEnvelope(new Uint8Array(pdfBuffer), {
    mimeType: "application/pdf",
    originalName: fileName,
  });
}

// ---------------------------------------------------------------------------
// Browse (for import dialog)
// ---------------------------------------------------------------------------

export async function browseDrive(
  config: DriveConfig,
  folderId?: string
): Promise<DriveBrowseResult> {
  const drive = getDrive(config);
  const effectiveId = folderId || "root";

  // Get current folder info
  let current: { id: string; name: string } | null = null;
  let parent: string | null = null;

  if (effectiveId !== "root") {
    try {
      const { data } = await drive.files.get({
        fileId: effectiveId,
        fields: "id, name, parents",
      });
      current = { id: data.id || effectiveId, name: data.name || "Unknown" };
      parent = data.parents?.[0] || "root";
    } catch {
      current = null;
    }
  }

  // List children — show folders + text-extractable files
  const children = await listFilesInFolder(drive, effectiveId);
  const items: DriveBrowseItem[] = children
    .filter((f) => f.mimeType === GOOGLE_FOLDER || isTextExtractable(f.mimeType))
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === GOOGLE_FOLDER,
    }))
    .sort((a, b) => {
      // Folders first, then alphabetical
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return { items, current, parent };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  config: DriveConfig;
  /** Target collection (default: "_gdrive"). */
  collection?: string;
  /** Check if a document already exists (by path) to skip reimporting. */
  documentExists: (collection: string, path: string) => boolean;
  /** Insert/upsert a document into the vault. Returns true if new/changed, false if unchanged. */
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string
  ) => Promise<boolean>;
  /** Save a binary asset to the editable collection (for original xlsx files). */
  saveAsset?: (path: string, binary: Buffer, mimeType: string) => Promise<void>;
}

export async function syncDrive(opts: SyncOptions): Promise<SyncResult> {
  const { config, documentExists, upsertDocument } = opts;
  const coll = opts.collection ?? "_gdrive";
  const drive = getDrive(config);
  const result: SyncResult = { imported: 0, skipped: 0, total: 0, errors: [] };

  for (const folder of config.folders) {
    try {
      let files: { file: DriveFile; folderPath: string }[];

      if (config.includeSubfolders) {
        files = await listFolderTree(drive, folder.id, folder.name);
      } else {
        const flat = await listFilesInFolder(drive, folder.id);
        files = flat
          .filter((f) => f.mimeType !== GOOGLE_FOLDER && isTextExtractable(f.mimeType))
          .map((f) => ({ file: f, folderPath: folder.name }));
      }

      result.total += files.length;

      for (const { file, folderPath } of files) {
        // Google Sheets → structured JSON with .json extension + original xlsx asset
        if (file.mimeType === GOOGLE_SHEET) {
          try {
            const sheetResult = await exportSheetAsJson(drive, file);
            if (!sheetResult || sheetResult.pages.length === 0) {
              result.skipped++;
              continue;
            }
            const basePath = folderPath
              ? `${folderPath}/${file.name}.json`
              : `${file.name}.json`;
            const assetPath = folderPath
              ? `gdrive/${folderPath}/${file.name}.xlsx`
              : `gdrive/${file.name}.xlsx`;
            const title = file.name.replace(/\.[^.]+$/, "");

            // Save original xlsx binary as asset
            if (opts.saveAsset) {
              await opts.saveAsset(
                assetPath,
                sheetResult.xlsxBuffer,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              );
            }

            for (const page of sheetResult.pages) {
              const docPath = basePath + page.pageSuffix;
              if (documentExists(coll, docPath)) {
                result.skipped++;
                continue;
              }
              const content = wrapSheetContent(page.content, assetPath);
              await upsertDocument(coll, docPath, content, title);
              result.imported++;
            }
          } catch (err: any) {
            result.errors.push(
              `${file.name}: ${err?.message || "unknown error"}`
            );
          }
          continue;
        }

        // PDFs → blob envelope (downloadable original) + per-page text index entries
        if (file.mimeType === "application/pdf") {
          try {
            const pdfResult = await exportPdfContent(drive, file);
            if (!pdfResult) {
              result.skipped++;
              continue;
            }
            const basePath = folderPath
              ? `${folderPath}/${file.name}`
              : file.name;
            const title = file.name.replace(/\.[^.]+$/, "");

            if (documentExists(coll, basePath)) {
              result.skipped++;
              continue;
            }

            // Store original binary as blob envelope at base path
            const blobContent = pdfToBlobEnvelope(pdfResult.pdfBuffer, file.name);
            await upsertDocument(coll, basePath, blobContent, title);

            // Store per-page text as index entries
            for (const page of pdfResult.pages) {
              if (!page.content.trim()) continue;
              const suffix = page.pageSuffix.startsWith("#page-")
                ? page.pageSuffix.slice(6)
                : "text";
              const indexPath = buildIndexPath(basePath, suffix);
              const pageTitle = page.pageNum
                ? `${title} — p.${page.pageNum}`
                : title;
              await upsertDocument(coll, indexPath, page.content, pageTitle);
            }
            result.imported++;
          } catch (err: any) {
            result.errors.push(
              `${file.name}: ${err?.message || "unknown error"}`
            );
          }
          continue;
        }

        // All other files → markdown with frontmatter
        const docPath = folderPath
          ? `${folderPath}/${file.name}.md`
          : `${file.name}.md`;

        if (documentExists(coll, docPath)) {
          result.skipped++;
          continue;
        }

        try {
          const text = await exportFileContent(drive, file);
          if (!text) {
            result.skipped++;
            continue;
          }

          const markdown = driveFileToMarkdown(file, text, folderPath);
          const title = file.name.replace(/\.[^.]+$/, "");
          await upsertDocument(coll, docPath, markdown, title);
          result.imported++;
        } catch (err: any) {
          result.errors.push(
            `${file.name}: ${err?.message || "unknown error"}`
          );
        }
      }
    } catch (err: any) {
      result.errors.push(
        `Folder "${folder.name}": ${err?.message || "unknown error"}`
      );
    }
  }

  return result;
}

/**
 * Import specific files/folders from Drive (one-off import, not persistent sync).
 */
export async function importDriveFiles(opts: {
  config: DriveConfig;
  fileIds: string[];
  /** Target collection (default: "_gdrive"). */
  collection?: string;
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string
  ) => Promise<boolean>;
  documentExists: (collection: string, path: string) => boolean;
  /** Save a binary asset to the editable collection (for original xlsx files). */
  saveAsset?: (path: string, binary: Buffer, mimeType: string) => Promise<void>;
}): Promise<SyncResult> {
  const { config, fileIds, upsertDocument, documentExists } = opts;
  const coll = opts.collection ?? "_gdrive";
  const drive = getDrive(config);
  const result: SyncResult = { imported: 0, skipped: 0, total: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      const { data } = await drive.files.get({
        fileId,
        fields: FILE_FIELDS,
      });

      const file: DriveFile = {
        id: data.id || fileId,
        name: data.name || "Untitled",
        mimeType: data.mimeType || "",
        modifiedTime: data.modifiedTime || "",
        parents: data.parents || [],
        size: data.size || undefined,
        webViewLink: data.webViewLink || undefined,
      };

      // If it's a folder, import all files inside it
      if (file.mimeType === GOOGLE_FOLDER) {
        const tree = await listFolderTree(drive, file.id, file.name);
        result.total += tree.length;

        for (const { file: subFile, folderPath } of tree) {
          // Google Sheets → structured JSON with .json extension + original xlsx asset
          if (subFile.mimeType === GOOGLE_SHEET) {
            try {
              const sheetResult = await exportSheetAsJson(drive, subFile);
              if (!sheetResult || sheetResult.pages.length === 0) {
                result.skipped++;
                continue;
              }
              const basePath = `${folderPath}/${subFile.name}.json`;
              const assetPath = `gdrive/${folderPath}/${subFile.name}.xlsx`;
              const title = subFile.name.replace(/\.[^.]+$/, "");

              if (opts.saveAsset) {
                await opts.saveAsset(
                  assetPath,
                  sheetResult.xlsxBuffer,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                );
              }

              for (const page of sheetResult.pages) {
                const docPath = basePath + page.pageSuffix;
                if (documentExists(coll, docPath)) {
                  result.skipped++;
                  continue;
                }
                const content = wrapSheetContent(page.content, assetPath);
                await upsertDocument(coll, docPath, content, title);
                result.imported++;
              }
            } catch (err: any) {
              result.errors.push(`${subFile.name}: ${err?.message || "unknown error"}`);
            }
            continue;
          }

          // PDFs → blob envelope + per-page text index entries
          if (subFile.mimeType === "application/pdf") {
            try {
              const pdfResult = await exportPdfContent(drive, subFile);
              if (!pdfResult) {
                result.skipped++;
                continue;
              }
              const basePath = `${folderPath}/${subFile.name}`;
              const title = subFile.name.replace(/\.[^.]+$/, "");

              if (documentExists(coll, basePath)) {
                result.skipped++;
                continue;
              }

              const blobContent = pdfToBlobEnvelope(pdfResult.pdfBuffer, subFile.name);
              await upsertDocument(coll, basePath, blobContent, title);

              for (const page of pdfResult.pages) {
                if (!page.content.trim()) continue;
                const suffix = page.pageSuffix.startsWith("#page-")
                  ? page.pageSuffix.slice(6)
                  : "text";
                const indexPath = buildIndexPath(basePath, suffix);
                const pageTitle = page.pageNum
                  ? `${title} — p.${page.pageNum}`
                  : title;
                await upsertDocument(coll, indexPath, page.content, pageTitle);
              }
              result.imported++;
            } catch (err: any) {
              result.errors.push(`${subFile.name}: ${err?.message || "unknown error"}`);
            }
            continue;
          }

          // All other files → markdown
          const docPath = `${folderPath}/${subFile.name}.md`;
          if (documentExists(coll, docPath)) {
            result.skipped++;
            continue;
          }
          try {
            const text = await exportFileContent(drive, subFile);
            if (!text) {
              result.skipped++;
              continue;
            }
            const md = driveFileToMarkdown(subFile, text, folderPath);
            await upsertDocument(coll, docPath, md, subFile.name.replace(/\.[^.]+$/, ""));
            result.imported++;
          } catch (err: any) {
            result.errors.push(`${subFile.name}: ${err?.message || "unknown error"}`);
          }
        }
      } else {
        result.total++;

        // Google Sheets → structured JSON with .json extension + original xlsx asset
        if (file.mimeType === GOOGLE_SHEET) {
          try {
            const sheetResult = await exportSheetAsJson(drive, file);
            if (!sheetResult || sheetResult.pages.length === 0) {
              result.skipped++;
              continue;
            }
            const basePath = `${file.name}.json`;
            const assetPath = `gdrive/${file.name}.xlsx`;
            const title = file.name.replace(/\.[^.]+$/, "");

            if (opts.saveAsset) {
              await opts.saveAsset(
                assetPath,
                sheetResult.xlsxBuffer,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              );
            }

            for (const page of sheetResult.pages) {
              const docPath = basePath + page.pageSuffix;
              if (documentExists(coll, docPath)) {
                result.skipped++;
                continue;
              }
              const content = wrapSheetContent(page.content, assetPath);
              await upsertDocument(coll, docPath, content, title);
              result.imported++;
            }
          } catch (err: any) {
            result.errors.push(`${file.name}: ${err?.message || "unknown error"}`);
          }
          continue;
        }

        // PDFs → blob envelope + per-page text index entries
        if (file.mimeType === "application/pdf") {
          try {
            const pdfResult = await exportPdfContent(drive, file);
            if (!pdfResult) {
              result.skipped++;
              continue;
            }
            const basePath = file.name;
            const title = file.name.replace(/\.[^.]+$/, "");

            if (documentExists(coll, basePath)) {
              result.skipped++;
              continue;
            }

            const blobContent = pdfToBlobEnvelope(pdfResult.pdfBuffer, file.name);
            await upsertDocument(coll, basePath, blobContent, title);

            for (const page of pdfResult.pages) {
              if (!page.content.trim()) continue;
              const suffix = page.pageSuffix.startsWith("#page-")
                ? page.pageSuffix.slice(6)
                : "text";
              const indexPath = buildIndexPath(basePath, suffix);
              const pageTitle = page.pageNum
                ? `${title} — p.${page.pageNum}`
                : title;
              await upsertDocument(coll, indexPath, page.content, pageTitle);
            }
            result.imported++;
          } catch (err: any) {
            result.errors.push(`${file.name}: ${err?.message || "unknown error"}`);
          }
          continue;
        }

        // All other files → markdown
        const docPath = `${file.name}.md`;
        if (documentExists(coll, docPath)) {
          result.skipped++;
          continue;
        }

        if (!isTextExtractable(file.mimeType)) {
          result.skipped++;
          continue;
        }

        const text = await exportFileContent(drive, file);
        if (!text) {
          result.skipped++;
          continue;
        }

        const md = driveFileToMarkdown(file, text, "");
        await upsertDocument(coll, docPath, md, file.name.replace(/\.[^.]+$/, ""));
        result.imported++;
      }
    } catch (err: any) {
      result.total++;
      result.errors.push(`File ${fileId}: ${err?.message || "unknown error"}`);
    }
  }

  return result;
}
