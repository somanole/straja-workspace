import { useState, useMemo } from "react"
import { Download, FileText, Image, FileSpreadsheet, Presentation, File, Hammer, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/shared/empty-state"
import { PageShell } from "@/components/shared/page-shell"
import { PageLoading } from "@/components/shared/page-loading"
import { useArtifacts, useBuildPresentation } from "@/hooks/use-artifacts"
import { issueArtifactDownloadUrl } from "@/lib/api"
import type { ArtifactItem } from "@/lib/types"
import { toast } from "sonner"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

/** File extensions considered downloadable deliverables */
const DOWNLOADABLE_EXTS = new Set([
  ".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".zip", ".tar", ".gz",
  ".mp3", ".mp4", ".wav", ".mov",
  ".html", ".txt", ".rtf",
])

function isDownloadable(path: string): boolean {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return false
  return DOWNLOADABLE_EXTS.has(path.slice(dot).toLowerCase())
}

function fileIcon(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(ext))
    return <Image className="h-4 w-4 text-violet-500 shrink-0" />
  if ([".pptx", ".ppt"].includes(ext))
    return <Presentation className="h-4 w-4 text-orange-500 shrink-0" />
  if ([".xlsx", ".xls", ".csv"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
  if ([".pdf"].includes(ext))
    return <FileText className="h-4 w-4 text-red-500 shrink-0" />
  if ([".docx", ".doc", ".rtf", ".txt"].includes(ext))
    return <FileText className="h-4 w-4 text-blue-500 shrink-0" />
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />
}

function friendlyName(path: string): string {
  // Strip "presentations/{name}/build/" prefix for cleaner display
  const cleaned = path.replace(/^presentations\/[^/]+\/build\//, "")
  return cleaned.split("/").pop() ?? cleaned
}

interface PresentationGroup {
  name: string
  spec: boolean
  build?: ArtifactItem
}

/** Extract presentation groups and downloadable loose files */
function groupArtifacts(items: ArtifactItem[]) {
  const presentations = new Map<string, PresentationGroup>()
  const downloads: ArtifactItem[] = []

  for (const item of items) {
    const match = item.path.match(/^presentations\/([^/]+)\/(.+)$/)
    if (match) {
      const [, name, rest] = match
      if (!presentations.has(name!)) {
        presentations.set(name!, { name: name!, spec: false })
      }
      const group = presentations.get(name!)!
      if (rest === "spec.json") {
        group.spec = true
      } else if (rest!.startsWith("build/") && isDownloadable(item.path)) {
        group.build = item
      }
      // Skip other presentation internals (images used by spec, etc.)
    } else if (isDownloadable(item.path)) {
      downloads.push(item)
    }
    // Non-downloadable loose files (json, etc.) are hidden
  }

  return {
    presentations: Array.from(presentations.values()),
    downloads,
  }
}

export function ArtifactsPage() {
  const { data, isLoading } = useArtifacts()
  const buildMut = useBuildPresentation()
  const [building, setBuilding] = useState<string | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)

  const { presentations, downloads } = useMemo(
    () => groupArtifacts(data?.items ?? []),
    [data?.items]
  )

  const totalVisible = presentations.length + downloads.length

  const handleBuild = async (name: string) => {
    setBuilding(name)
    try {
      const result = await buildMut.mutateAsync(name)
      if (result.ok) {
        toast.success(`Built ${name}.pptx (${result.slides} slides, ${formatBytes(result.size ?? 0)})`)
      } else {
        toast.error(result.error ?? "Build failed")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Build failed")
    } finally {
      setBuilding(null)
    }
  }

  const handleExport = async (item: ArtifactItem) => {
    setDownloadingPath(item.path)
    try {
      const { url } = await issueArtifactDownloadUrl("_editable", item.path)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to prepare download")
    } finally {
      setDownloadingPath(null)
    }
  }

  return (
    <PageShell variant="full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Artifacts</h1>
          {totalVisible > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalVisible}
            </Badge>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <PageLoading variant="spinner" message="Loading artifacts..." />
        ) : totalVisible === 0 ? (
          <EmptyState
            icon={<Package className="h-8 w-8" />}
            title="No artifacts"
            description="Artifacts created by agents will appear here as downloadable files."
          />
        ) : (
          <div className="space-y-6">
            {/* Presentations */}
            {presentations.length > 0 && (
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                  Presentations
                </h2>
                <div className="space-y-2">
                  {presentations.map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center gap-3 rounded-md border p-3"
                    >
                      <Presentation className="h-5 w-5 text-orange-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}.pptx</div>
                        <div className="text-xs text-muted-foreground">
                          {p.build
                            ? `${formatBytes(p.build.size)} \u00b7 ${formatDate(p.build.modifiedAt)}`
                            : p.spec
                              ? "Ready to build"
                              : "Empty"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.spec && !p.build && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs"
                            disabled={building === p.name}
                            onClick={() => handleBuild(p.name)}
                          >
                            <Hammer className="h-3 w-3" />
                            {building === p.name ? "Building..." : "Build"}
                          </Button>
                        )}
                        {p.build && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs"
                            onClick={() => { void handleExport(p.build!) }}
                            disabled={downloadingPath === p.build.path}
                          >
                            <Download className="h-3 w-3" />
                            {downloadingPath === p.build.path ? "Preparing..." : "Download"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Downloadable files */}
            {downloads.length > 0 && (
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                  Files
                </h2>
                <div className="space-y-1">
                  {downloads.map((item) => (
                    <div
                      key={item.path}
                      className="flex items-center gap-3 rounded-md border p-2.5"
                    >
                      {fileIcon(item.path)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{friendlyName(item.path)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(item.size)} &middot; {formatDate(item.modifiedAt)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-xs"
                        onClick={() => { void handleExport(item) }}
                        disabled={downloadingPath === item.path}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </PageShell>
  )
}
