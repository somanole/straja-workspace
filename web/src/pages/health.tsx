import {
  Database,
  HardDrive,
  Info,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import {
  useHealthStats,
  useCleanupVectors,
  useCleanupContent,
  usePurgeInactive,
  useClearLLMCache,
  useVacuumDB,
} from "@/hooks/use-health"
import { useEmbed } from "@/hooks/use-models"
import { toast } from "sonner"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function StatCard({
  label,
  value,
  loading,
  tip,
}: {
  label: string
  value: string
  loading?: boolean
  tip?: string
}) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        {loading ? (
          <Skeleton className="h-8 w-20 mx-auto mb-1" />
        ) : (
          <div className="text-2xl font-bold tabular-nums">{value}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
          {label}
          {tip && <InfoTip text={tip} />}
        </div>
      </CardContent>
    </Card>
  )
}

function MaintenanceRow({
  label,
  count,
  loading,
  actionLabel,
  onAction,
  isPending,
  variant = "default",
  warnThreshold = 1,
  tip,
}: {
  label: string
  count: number | string
  loading?: boolean
  actionLabel?: string
  onAction?: () => void
  isPending?: boolean
  variant?: "default" | "warning"
  warnThreshold?: number
  tip?: string
}) {
  const numCount = Number(count)
  const isWarning = variant === "warning" && numCount >= warnThreshold
  const isClean = variant === "warning" && numCount === 0

  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        {tip && <InfoTip text={tip} />}
        {loading ? (
          <Skeleton className="h-4 w-12" />
        ) : (
          <span
            className={
              isWarning ? "font-medium text-amber-500" : "font-medium"
            }
          >
            {typeof count === "number" ? count.toLocaleString() : count}
          </span>
        )}
        {isWarning && (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        )}
        {isClean && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
      </div>
      {actionLabel && onAction && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={onAction}
          disabled={isPending || numCount === 0}
        >
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export function HealthPage() {
  const { data: stats, isLoading } = useHealthStats()
  const cleanupVecMut = useCleanupVectors()
  const cleanupContentMut = useCleanupContent()
  const purgeInactiveMut = usePurgeInactive()
  const clearCacheMut = useClearLLMCache()
  const vacuumMut = useVacuumDB()
  const embedMut = useEmbed()

  const totalDocs = (stats?.activeDocuments ?? 0) + (stats?.inactiveDocuments ?? 0)
  const embedPct =
    totalDocs > 0
      ? Math.round(
          ((totalDocs - (stats?.needsEmbedding ?? 0)) / totalDocs) * 100
        )
      : 0

  const handleAction = async (
    action: () => Promise<unknown>,
    successMsg: (result: unknown) => string
  ) => {
    try {
      const result = await action()
      toast.success(successMsg(result))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed")
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Vault Health"
        description="Database health and maintenance."
      />

      {/* Overview stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Documents"
          value={(stats?.activeDocuments ?? 0).toLocaleString()}
          loading={isLoading}
          tip="Active documents across all collections. Includes index entries."
        />
        <StatCard
          label="Vectors"
          value={(stats?.activeVectors ?? 0).toLocaleString()}
          loading={isLoading}
          tip="Embedding chunks used by vector search. Each document is split into overlapping chunks."
        />
        <StatCard
          label="Embedded"
          value={`${embedPct}%`}
          loading={isLoading}
          tip="Percentage of documents with embeddings. 100% means all documents are searchable via semantic queries."
        />
        <StatCard
          label="DB Size"
          value={formatBytes(stats?.dbSizeBytes ?? 0)}
          loading={isLoading}
          tip="On-disk size of the SQLite database. Use Vacuum after cleanup to reclaim space."
        />
      </div>

      {/* Vectors */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vectors</h2>
        </div>
        <Card>
          <CardContent className="p-4 space-y-1">
            <MaintenanceRow
              label="Orphaned vectors"
              count={stats?.orphanedVectors ?? 0}
              loading={isLoading}
              variant="warning"
              actionLabel="Clean up"
              isPending={cleanupVecMut.isPending}
              tip="Vectors from deleted documents. They pollute search results by taking up nearest-neighbor slots. Cleaned automatically on startup."
              onAction={() =>
                handleAction(
                  () => cleanupVecMut.mutateAsync(),
                  (r) =>
                    `Removed ${(r as { removed: number }).removed.toLocaleString()} orphaned vectors`
                )
              }
            />
            <MaintenanceRow
              label="Active vectors"
              count={stats?.activeVectors ?? 0}
              loading={isLoading}
              tip="Vectors linked to active documents — used during search."
            />
            <MaintenanceRow
              label="Needs embedding"
              count={stats?.needsEmbedding ?? 0}
              loading={isLoading}
              variant={
                (stats?.needsEmbedding ?? 0) > 0 ? "warning" : "default"
              }
              actionLabel={stats?.embedding ? "Embedding…" : "Embed"}
              isPending={embedMut.isPending || stats?.embedding}
              tip="Documents without embeddings. They appear in keyword search but not in semantic/vector search."
              onAction={() =>
                handleAction(
                  () => embedMut.mutateAsync(false),
                  () => "Embedding started"
                )
              }
            />
            <div className="flex items-center justify-between text-sm py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Vector index</span>
                <InfoTip text="The sqlite-vec virtual table for nearest-neighbor search. Pull the embedding model and run embedding to build it." />
                {isLoading ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <Badge
                    variant={stats?.hasVectorIndex ? "secondary" : "outline"}
                  >
                    {stats?.hasVectorIndex ? "Active" : "Not built"}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Storage */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Storage</h2>
        </div>
        <Card>
          <CardContent className="p-4 space-y-1">
            <MaintenanceRow
              label="Inactive documents"
              count={stats?.inactiveDocuments ?? 0}
              loading={isLoading}
              variant="warning"
              warnThreshold={50}
              actionLabel="Purge"
              isPending={purgeInactiveMut.isPending}
              tip="Documents marked inactive after deletion or re-import. Small counts are normal from background syncs. Purging is irreversible."
              onAction={() =>
                handleAction(
                  () => purgeInactiveMut.mutateAsync(),
                  (r) =>
                    `Purged ${(r as { removed: number }).removed.toLocaleString()} inactive documents`
                )
              }
            />
            <MaintenanceRow
              label="Orphaned content"
              count={stats?.orphanedContentHashes ?? 0}
              loading={isLoading}
              variant="warning"
              warnThreshold={50}
              actionLabel="Purge"
              isPending={cleanupContentMut.isPending}
              tip="Content blobs no longer referenced by any active document. Trickle up from audit appends and config updates. Cleaned on startup."
              onAction={() =>
                handleAction(
                  () => cleanupContentMut.mutateAsync(),
                  (r) =>
                    `Purged ${(r as { removed: number }).removed.toLocaleString()} orphaned content hashes`
                )
              }
            />
            <MaintenanceRow
              label="LLM cache entries"
              count={stats?.llmCacheEntries ?? 0}
              loading={isLoading}
              actionLabel="Clear"
              isPending={clearCacheMut.isPending}
              tip="Cached LLM responses for query expansion and RAG. Clear after switching models to avoid stale answers."
              onAction={() =>
                handleAction(
                  () => clearCacheMut.mutateAsync(),
                  (r) =>
                    `Cleared ${(r as { removed: number }).removed.toLocaleString()} cache entries`
                )
              }
            />
            <div className="flex items-center justify-between text-sm pt-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  Reclaim unused space
                </span>
                <InfoTip text="Rebuilds the database file to reclaim free pages from deletions. Run after cleanup for maximum effect. The vault is unresponsive during this operation." />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() =>
                  handleAction(
                    () => vacuumMut.mutateAsync(),
                    () => "Database vacuumed successfully"
                  )
                }
                disabled={vacuumMut.isPending}
              >
                {vacuumMut.isPending && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Vacuum DB
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Index */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Index</h2>
        </div>
        <Card>
          <CardContent className="p-4 space-y-1">
            <MaintenanceRow
              label="FTS entries"
              count={stats?.ftsEntries ?? 0}
              loading={isLoading}
              tip="Full-text search index rows. Should be close to the active document count."
            />
            <MaintenanceRow
              label="Content hashes"
              count={stats?.totalContentHashes ?? 0}
              loading={isLoading}
              tip="Total content blobs stored (referenced + orphaned). Content is deduplicated by SHA-256 hash."
            />
            <MaintenanceRow
              label="Write queue"
              count={
                isLoading
                  ? 0
                  : `${stats?.writeQueue?.docs ?? 0} docs / ${stats?.writeQueue?.entries ?? 0} ops`
              }
              loading={isLoading}
              tip="Pending writes in the in-memory queue. Non-zero during imports or syncs."
            />
          </CardContent>
        </Card>
      </section>
    </PageShell>
  )
}
