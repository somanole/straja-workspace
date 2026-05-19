import { useEffect, useMemo, useState } from "react"
import {
  Shield,
  Play,
  Square,
  RotateCw,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Download,
  FileJson,
  FileSpreadsheet,
  Terminal,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useGuardStatus,
  useGuardEvents,
  useGuardLogs,
  useGuardStart,
  useGuardStop,
  useGuardRestart,
} from "@/hooks/use-guard"
import type { GuardActivationEvent } from "@/lib/types"
import { cn, statusBadgeClass } from "@/lib/utils"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "-"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return ts
  }
}

function timestampValue(ts: string): number {
  const value = Date.parse(ts)
  return Number.isFinite(value) ? value : 0
}

function verdictClass(verdict: string) {
  return statusBadgeClass(verdict)
}

function severityColor(severity?: string) {
  if (severity === "high") return "text-red-500"
  if (severity === "medium") return "text-yellow-500"
  return "text-muted-foreground"
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

function GuardEventRow({ entry }: { entry: GuardActivationEvent }) {
  const [expanded, setExpanded] = useState(false)
  const details = entry.details ?? {}
  const requestPreview =
    typeof details.request_preview === "string" ? details.request_preview.trim() : ""
  const responsePreview =
    typeof details.response_preview === "string" ? details.response_preview.trim() : ""

  return (
    <div
      className="px-3 py-2.5 text-xs cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <Shield className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", severityColor(entry.severity))} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{entry.action}</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", verdictClass(entry.verdict))}>
              {entry.verdict}
            </Badge>
            {details.model && (
              <span className="text-[10px] text-muted-foreground truncate">{String(details.model)}</span>
            )}
          </div>
          {entry.reason && entry.reason !== "Clean" && (
            <div className="text-muted-foreground truncate">{entry.reason}</div>
          )}
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>{formatTime(entry.timestamp)}</span>
            {details.provider && <span>{String(details.provider)}</span>}
            {details.timing_ms && (
              <span>{(details.timing_ms as { total: number }).total?.toFixed(0)}ms</span>
            )}
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-2 space-y-2 border-t pt-2">
              {details.request_id && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Request ID</span>
                  <span className="font-mono text-[10px] break-all">{String(details.request_id)}</span>
                </div>
              )}
              {details.categories && (details.categories as string[]).length > 0 && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Categories</span>
                  <div className="flex flex-wrap gap-1">
                    {(details.categories as string[]).map((cat) => (
                      <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {details.request_scores && Object.keys(details.request_scores as object).length > 0 && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Scores</span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(details.request_scores as Record<string, number>).map(([k, v]) => (
                      <span key={k} className="font-mono">{k}: {(v as number).toFixed(3)}</span>
                    ))}
                  </div>
                </div>
              )}
              {details.request_decision && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Request</span>
                  <span>{String(details.request_decision)}</span>
                </div>
              )}
              {details.response_decision && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Response</span>
                  <span>{String(details.response_decision)}</span>
                </div>
              )}
              {details.intel_status && (
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Intel</span>
                  <span>{String(details.intel_status)}{details.bundle_version ? ` (${details.bundle_version})` : ""}</span>
                </div>
              )}
              {(requestPreview || responsePreview) && (
                <div className="space-y-2">
                  {requestPreview && (
                    <div className="space-y-1">
                      <div className="font-medium">Request preview</div>
                      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[11px] leading-5">
                        {requestPreview}
                      </pre>
                    </div>
                  )}
                  {responsePreview && (
                    <div className="space-y-1">
                      <div className="font-medium">Response preview</div>
                      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[11px] leading-5">
                        {responsePreview}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function GuardPage() {
  const statusQuery = useGuardStatus()
  const startMutation = useGuardStart()
  const stopMutation = useGuardStop()
  const restartMutation = useGuardRestart()

  const status = statusQuery.data
  const isRunning = status?.running ?? false
  const isExternallyManaged = status?.externallyManaged ?? false
  const controlMode = status?.controlMode ?? "managed"
  const canControlGuard = controlMode !== "external_readonly"
  const isMutating = startMutation.isPending || stopMutation.isPending || restartMutation.isPending

  // Events tab state
  const [selectedDate, setSelectedDate] = useState("")
  const eventsQuery = useGuardEvents(selectedDate || undefined)
  const logsQuery = useGuardLogs(true)
  const [verdictFilter, setVerdictFilter] = useState<"all" | "allowed" | "blocked">("all")

  const dates = useMemo(() => eventsQuery.data?.dates ?? [], [eventsQuery.data?.dates])
  const entries = useMemo(
    () => [...(eventsQuery.data?.entries ?? [])].sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp)),
    [eventsQuery.data?.entries],
  )
  const filteredEntries = useMemo(
    () => entries.filter((e) => verdictFilter === "all" || e.verdict === verdictFilter),
    [entries, verdictFilter],
  )

  // Stats
  const blockedCount = useMemo(() => entries.filter((e) => e.verdict === "blocked").length, [entries])
  const allowedCount = useMemo(() => entries.filter((e) => e.verdict === "allowed").length, [entries])
  const detectedCount = useMemo(
    () => entries.filter((e) => {
      const cats = (e.details?.categories as string[]) ?? []
      return cats.length > 0
    }).length,
    [entries],
  )

  useEffect(() => {
    if (!selectedDate && dates.length > 0) {
      setSelectedDate(dates[0])
    }
  }, [dates, selectedDate])

  const handleStart = async () => {
    try {
      const result = await startMutation.mutateAsync(undefined)
      if (result.ok) toast.success("Guard started")
      else toast.error(result.error || "Failed to start guard")
    } catch (err: any) {
      toast.error(err?.message || "Failed to start guard")
    }
  }

  const handleStop = async () => {
    try {
      const result = await stopMutation.mutateAsync()
      if (result.ok) toast.success("Guard stopped")
      else toast.error(result.error || "Failed to stop guard")
    } catch (err: any) {
      toast.error(err?.message || "Failed to stop guard")
    }
  }

  const handleRestart = async () => {
    try {
      const result = await restartMutation.mutateAsync()
      if (result.ok) toast.success("Guard restarted")
      else toast.error(result.error || "Failed to restart guard")
    } catch (err: any) {
      toast.error(err?.message || "Failed to restart guard")
    }
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = () => {
    if (!filteredEntries.length) return
    const blob = new Blob([JSON.stringify(filteredEntries, null, 2)], { type: "application/json" })
    downloadBlob(blob, `guard-events-${selectedDate || "all"}.json`)
  }

  const exportCsv = () => {
    if (!filteredEntries.length) return
    const cols = [
      "timestamp",
      "toolName",
      "action",
      "verdict",
      "reason",
      "severity",
      "request_id",
      "provider",
      "model",
      "mode",
      "project_id",
      "request_decision",
      "response_decision",
      "categories",
      "request_scores",
      "response_scores",
      "request_hits",
      "response_hits",
      "request_preview",
      "response_preview",
      "intel_status",
      "bundle_version",
      "timing_ms",
      "request_latency_ms",
      "response_latency_ms",
    ] as const
    const escapeCell = (v: unknown): string => {
      if (v === null || v === undefined) return ""
      const s = typeof v === "object" ? JSON.stringify(v) : String(v)
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const header = cols.join(",")
    const rows = filteredEntries.map((entry) => {
      const details = entry.details ?? {}
      const record: Record<string, unknown> = {
        timestamp: entry.timestamp,
        toolName: entry.toolName,
        action: entry.action,
        verdict: entry.verdict,
        reason: entry.reason,
        severity: entry.severity,
        request_id: details.request_id,
        provider: details.provider,
        model: details.model,
        mode: details.mode,
        project_id: details.project_id,
        request_decision: details.request_decision,
        response_decision: details.response_decision,
        categories: details.categories,
        request_scores: details.request_scores,
        response_scores: details.response_scores,
        request_hits: details.request_hits,
        response_hits: details.response_hits,
        request_preview: details.request_preview,
        response_preview: details.response_preview,
        intel_status: details.intel_status,
        bundle_version: details.bundle_version,
        timing_ms: details.timing_ms,
        request_latency_ms: details.request_latency_ms,
        response_latency_ms: details.response_latency_ms,
      }
      return cols.map((col) => escapeCell(record[col])).join(",")
    })
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    downloadBlob(blob, `guard-events-${selectedDate || "all"}.csv`)
  }

  return (
    <PageShell>
      <PageHeader
        title="Straja Guard"
        description="AI safety layer — prompt injection, jailbreak detection, PII redaction, and tool safety checks."
      />

      <Tabs defaultValue="status">
        <TabsList variant="line">
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="events">
            Events
            {blockedCount > 0 && (
              <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25">
                {blockedCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* ── Status Tab ── */}
        <TabsContent value="status">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Status card */}
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Process
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => statusQuery.refetch()}
                      disabled={statusQuery.isFetching}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", statusQuery.isFetching && "animate-spin")} />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-3 w-3 rounded-full",
                    isRunning ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                  )} />
                  <span className="font-medium">
                    {isRunning ? "Running" : "Stopped"}
                  </span>
                  {status?.pid && (
                    <span className="text-xs text-muted-foreground">PID {status.pid}</span>
                  )}
                </div>

                {isRunning && status?.health && (
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      {status.health.healthy ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                      <span>Health</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {status.health.ready ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      <span>Ready</span>
                    </div>
                    {status.uptime !== null && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{formatUptime(status.uptime)}</span>
                      </div>
                    )}
                  </div>
                )}

                {status?.lastError && !isRunning && (
                  <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-400">
                    {status.lastError}
                  </div>
                )}

                {!isRunning && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="space-y-1.5">
                        <p className="font-medium">
                          Guard is stopped. Start it to enable jailbreak, prompt-injection, PII, and tool-safety checks.
                        </p>
                        <p className="text-amber-800/90 dark:text-amber-200/80">
                          Running Guard typically needs around 4 GB of RAM for its local safety models.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <div className="space-y-1.5">
                      <p className="font-medium">
                        Guard reduces risk, but it is still a probabilistic system.
                      </p>
                      <p className="text-blue-800/90 dark:text-blue-200/80">
                        False positives and false negatives can happen, so treat Guard decisions as an additional safety layer, not a guarantee.
                      </p>
                    </div>
                  </div>
                </div>

                {isExternallyManaged && controlMode === "external_readonly" && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                    This Guard instance is externally managed by the dev stack. Use <span className="font-mono">npm run dev</span> to restart it; Vault can only monitor its status and events.
                  </div>
                )}

                {/* Controls */}
                <div className="mt-auto flex items-center gap-2 pt-3 border-t">
                  {!isRunning ? (
                    <Button
                      size="sm"
                      onClick={handleStart}
                      disabled={isMutating || !canControlGuard}
                      className="gap-1.5"
                    >
                      {startMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Start Guard
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStop}
                        disabled={isMutating || !canControlGuard}
                        className="gap-1.5"
                      >
                        {stopMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                        Stop
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRestart}
                        disabled={isMutating || !canControlGuard}
                        className="gap-1.5"
                      >
                        {restartMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCw className="h-3.5 w-3.5" />
                        )}
                        Restart
                      </Button>
                    </>
                  )}

                  {isRunning && status?.consoleUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 ml-auto"
                      onClick={() => window.open(status.consoleUrl, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Console
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Info card */}
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 text-xs">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Listen address</span>
                    <span className="font-mono">{status?.listenAddr ?? "127.0.0.1:8080"}</span>
                  </div>
                  {status?.config?.binaryPath && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Binary</span>
                      <span className="font-mono truncate max-w-[200px]" title={status.config.binaryPath}>
                        {status.config.binaryPath}
                      </span>
                    </div>
                  )}
                  {status?.config?.configPath && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Config</span>
                      <span className="font-mono truncate max-w-[200px]" title={status.config.configPath}>
                        {status.config.configPath}
                      </span>
                    </div>
                  )}
                </div>

                <div className="border-t pt-3 space-y-2">
                  <p className="font-medium text-foreground">Safety capabilities</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["Prompt injection", "Jailbreak detection", "PII redaction", "Secrets blocking", "Data exfil prevention", "Tool safety (Toolgate)"].map((cap) => (
                      <div key={cap} className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        <span>{cap}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick stats */}
            {entries.length > 0 && (
              <Card className="md:col-span-2">
                <CardContent className="pt-5">
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-semibold">{entries.length}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Total requests</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-emerald-600">{allowedCount}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Allowed</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-red-600">{blockedCount}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Blocked</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-amber-600">{detectedCount}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Detections</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Events Tab ── */}
        <TabsContent value="events">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Activation Events
                <div className="ml-auto flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={filteredEntries.length === 0}
                        title="Export visible guard events"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={exportCsv} className="text-xs gap-2">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Export CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportJson} className="text-xs gap-2">
                        <FileJson className="h-3.5 w-3.5" />
                        Export JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => eventsQuery.refetch()}
                    disabled={eventsQuery.isFetching}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", eventsQuery.isFetching && "animate-spin")} />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filters */}
              <div className="flex items-center gap-2">
                <Select value={selectedDate || (dates[0] ?? "")} onValueChange={setSelectedDate}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue placeholder="Select date" />
                  </SelectTrigger>
                  <SelectContent>
                    {dates.length === 0 ? (
                      <SelectItem value="__none" disabled>No data yet</SelectItem>
                    ) : (
                      dates.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>

                <Select value={verdictFilter} onValueChange={(v) => setVerdictFilter(v as typeof verdictFilter)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Verdicts</SelectItem>
                    <SelectItem value="allowed">Allowed</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>

                {entries.length > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {filteredEntries.length === entries.length
                      ? `${entries.length} events`
                      : `${filteredEntries.length} / ${entries.length}`
                    }
                  </span>
                )}
              </div>

              {/* Event list */}
              {eventsQuery.isLoading ? (
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading events...
                </div>
              ) : entries.length === 0 ? (
                <div className="text-xs text-muted-foreground rounded border border-dashed p-4 text-center">
                  {isRunning
                    ? "No activation events yet. Events appear as the agent makes LLM requests through Guard."
                    : "Guard is not running. Start it to begin receiving activation events."
                  }
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground rounded border border-dashed p-4 text-center">
                  No events match the selected filters.
                </div>
              ) : (
                <div className="rounded-md border divide-y max-h-[40rem] overflow-y-auto">
                  {filteredEntries.map((entry, i) => (
                    <GuardEventRow key={`${entry.timestamp}-${i}`} entry={entry} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Guard logs
                <div className="ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => logsQuery.refetch()}
                    disabled={logsQuery.isFetching}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", logsQuery.isFetching && "animate-spin")} />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Tail of the local Guard process log. Use this to inspect startup problems such as missing trust keys or bundle download failures.
              </p>
              {logsQuery.isLoading ? (
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading logs...
                </div>
              ) : (
                <div className="space-y-3">
                  {(logsQuery.data?.logs ?? []).map((logFile) => (
                    <div key={logFile.id} className="space-y-2 rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{logFile.label}</div>
                          <div className="text-[10px] text-muted-foreground font-mono break-all">
                            {logFile.path ?? "No log path available"}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {logFile.exists ? "Available" : "Missing"}
                        </Badge>
                      </div>
                      <div className="rounded border bg-background">
                        <pre className="max-h-80 overflow-auto p-3 text-[10px] leading-4 whitespace-pre-wrap break-words font-mono">
                          {logFile.content || "No log output yet."}
                        </pre>
                      </div>
                    </div>
                  ))}
                  {!logsQuery.isLoading && (logsQuery.data?.logs?.length ?? 0) === 0 && (
                    <div className="rounded-md border bg-muted/20 p-3 text-[10px] text-muted-foreground">
                      No guard logs available.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
