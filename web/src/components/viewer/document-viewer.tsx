import { useState } from "react"
import { Copy, Download, FileText, Pencil, ChevronDown, ChevronRight, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownRenderer } from "./markdown-renderer"
import { EmptyState } from "@/components/shared/empty-state"
import { useFileContent, useFileIndexEntries } from "@/hooks/use-files"
import { issueArtifactDownloadUrl } from "@/lib/api"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import type { GroupedFileInfo } from "@/lib/types"

interface DocumentViewerProps {
  collection: string | null
  file: GroupedFileInfo | null
  onEdit?: () => void
}

type ExportOnlyDocumentType = "pptx" | "pdf"

function isPresentationFile(path: string): boolean {
  return path.toLowerCase().endsWith(".pptx")
}

function isPdfFile(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf")
}

function isSpreadsheetFile(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")
}

function getExportOnlyDocumentType(path: string): ExportOnlyDocumentType | null {
  if (isPresentationFile(path)) return "pptx"
  if (isPdfFile(path)) return "pdf"
  return null
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferTextMimeType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(".md")) return "text/markdown;charset=utf-8"
  if (lower.endsWith(".json")) return "application/json;charset=utf-8"
  if (lower.endsWith(".csv")) return "text/csv;charset=utf-8"
  if (lower.endsWith(".html")) return "text/html;charset=utf-8"
  return "text/plain;charset=utf-8"
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function parseSourceArtifactReference(content: string | null | undefined): { collection: string; path: string; label: string } | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as { _source_asset?: unknown }
    if (typeof parsed?._source_asset !== "string" || !parsed._source_asset.trim()) return null
    const raw = parsed._source_asset.trim()
    const slashIndex = raw.indexOf("/")
    if (slashIndex <= 0 || slashIndex === raw.length - 1) return null
    const artifactPath = raw
    const label = raw.slice(slashIndex + 1).split("/").pop() ?? artifactPath
    return { collection: "_editable", path: artifactPath, label }
  } catch {
    return null
  }
}

function IndexEntriesSection({ collection, path }: { collection: string; path: string }) {
  const [expanded, setExpanded] = useState(false)
  const { data: entries, isLoading } = useFileIndexEntries(
    expanded ? collection : null,
    expanded ? path : null
  )

  return (
    <div className="border rounded-md mt-4">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <Database className="h-3.5 w-3.5 shrink-0" />
        Search index entries
      </button>
      {expanded && (
        <div className="border-t px-3 py-2">
          {isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : entries && entries.length > 0 ? (
            <div className="space-y-0.5">
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-start gap-2 text-xs text-muted-foreground py-1"
                >
                  <span className="font-mono shrink-0 w-8 text-right tabular-nums">{entry.suffix}</span>
                  <span className="truncate flex-1 text-foreground/60">{entry.snippet}</span>
                  <span className="whitespace-nowrap shrink-0">{formatFileSize(entry.size)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No index entries found</p>
          )}
        </div>
      )}
    </div>
  )
}

export function DocumentViewer({ collection, file, onEdit }: DocumentViewerProps) {
  const filePath = file?.path ?? null
  const isBinaryFile = file ? !file.isTextOnly : false
  // Only fetch content for text files — binary files show file info instead
  const { data, isLoading } = useFileContent(
    isBinaryFile ? null : collection,
    isBinaryFile ? null : filePath
  )
  const [isPreparingDownload, setIsPreparingDownload] = useState(false)
  // Can only export/download if we have a real original (mimeType set from blob envelope)
  const hasOriginal = Boolean(file?.mimeType)
  const canExport = Boolean(collection && file && hasOriginal)
  const exportOnlyType = file ? getExportOnlyDocumentType(file.path) : null
  const isPptx = exportOnlyType === "pptx"
  const isPdf = exportOnlyType === "pdf"
  const isXlsx = file ? isSpreadsheetFile(file.path) : false
  const exportLabel = isPptx ? "Export PPTX" : isPdf ? "Export PDF" : isXlsx ? "Export Spreadsheet" : "Download"
  const sourceArtifact = !isBinaryFile ? parseSourceArtifactReference(data?.content) : null
  const canDownloadTextPreview = !isBinaryFile && Boolean(file && data?.content)
  const canDownloadOriginalArtifact = canExport && (isBinaryFile || exportOnlyType)
  const canDownloadAny = Boolean(sourceArtifact || canDownloadOriginalArtifact || canDownloadTextPreview)

  const handleArtifactDownload = async (artifactCollection: string, artifactPath: string, errorMessage: string) => {
    if (isPreparingDownload) return
    setIsPreparingDownload(true)
    try {
      const { url } = await issueArtifactDownloadUrl(artifactCollection, artifactPath)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : errorMessage)
    } finally {
      setIsPreparingDownload(false)
    }
  }

  const handleDownload = async () => {
    if (sourceArtifact) {
      await handleArtifactDownload(sourceArtifact.collection, sourceArtifact.path, "Failed to prepare original download")
      return
    }
    if (canDownloadOriginalArtifact && collection && file) {
      await handleArtifactDownload(collection, file.path, "Failed to prepare download")
      return
    }
    if (canDownloadTextPreview && file && data?.content) {
      try {
        downloadTextFile(file.title || file.path, data.content, inferTextMimeType(file.path))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to download file")
      }
    }
  }

  if (!file) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title="No document selected"
        description="Select a file from the list to preview it"
      />
    )
  }

  if (!isBinaryFile && isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="border-b px-4 py-3 shrink-0 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium truncate min-w-0">
            {isBinaryFile ? (file.title || file.path) : (data?.title || file.title || file.path)}
          </h3>
          <div className="flex items-center gap-2 shrink-0">
            {canDownloadAny && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { void handleDownload() }}
                disabled={isPreparingDownload}
              >
                <Download className="h-3.5 w-3.5" />
                {isPreparingDownload ? "Preparing..." : sourceArtifact ? "Download" : exportLabel}
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onEdit}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {!isBinaryFile && !exportOnlyType && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    if (data?.content) {
                      navigator.clipboard.writeText(data.content)
                      toast.success("Copied to clipboard")
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {file.docid && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              {file.docid}
            </Badge>
          )}
          {file.mimeType && (
            <Badge variant="outline" className="text-[10px]">
              {file.mimeType.split("/").pop()}
            </Badge>
          )}
          {file.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
          )}
          {file.modifiedAt && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(file.modifiedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {isBinaryFile ? (
          /* Binary file: show file info + download CTA + index entries */
          <div className="max-w-md mx-auto mt-8">
            {hasOriginal ? (
              <EmptyState
                icon={<Download className="h-10 w-10" />}
                title={isPdf ? "PDF file" : isXlsx ? "Spreadsheet file" : "Binary file"}
                description={
                  isPdf
                    ? "Export this PDF file to open it in your preferred PDF viewer."
                    : isXlsx
                      ? "Export this spreadsheet to open it in Excel or Google Sheets."
                      : "Download this file to view it in the appropriate application."
                }
                action={
                  canExport ? (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { void handleDownload() }}
                      disabled={isPreparingDownload}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {isPreparingDownload ? "Preparing..." : exportLabel}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                icon={<Database className="h-10 w-10" />}
                title={isPdf ? "Indexed PDF" : isXlsx ? "Indexed spreadsheet" : "Indexed file"}
                description={`This file has ${file.indexEntries} search index ${file.indexEntries === 1 ? "entry" : "entries"}. Re-import the original to enable downloads.`}
              />
            )}
            {collection && file.indexEntries > 0 && (
              <IndexEntriesSection collection={collection} path={file.path} />
            )}
          </div>
        ) : data?.content ? (
          <MarkdownRenderer content={data.content} />
        ) : (
          <p className="text-sm text-muted-foreground">No content available</p>
        )}
      </div>
    </div>
  )
}
