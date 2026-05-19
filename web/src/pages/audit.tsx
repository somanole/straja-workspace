import { useState, useEffect, useMemo } from "react"
import {
  ShieldCheck,
  Shield,
  RefreshCw,
  Loader2,
  Terminal,
  MessageSquare,
  Brain,
  Globe,
  Search,
  Link,
  Mail,
  Calendar,
  HardDrive,
  Download,
  FileJson,
  FileSpreadsheet,
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
import { useAudit, useWorkspaceLogs } from "@/hooks/use-audit"
import type { UnifiedAuditEntry } from "@/lib/types"
import { cn, statusBadgeClass } from "@/lib/utils"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { value: "all", label: "All Categories", icon: ShieldCheck },
  { value: "browser", label: "Browser", icon: Globe },
  { value: "web-search", label: "Web Search", icon: Search },
  { value: "web-fetch", label: "Web Fetch", icon: Link },
  { value: "exec", label: "Execution", icon: Terminal },
  { value: "memory", label: "Memory", icon: Brain },
  { value: "messaging", label: "Messaging", icon: MessageSquare },
  { value: "gmail", label: "Gmail", icon: Mail },
  { value: "gcalendar", label: "Calendar", icon: Calendar },
  { value: "gdrive", label: "Drive", icon: HardDrive },
  { value: "guard", label: "Guard", icon: Shield },
] as const

function verdictClass(verdict: string) {
  return statusBadgeClass(verdict)
}

function severityColor(severity?: string) {
  if (severity === "high") return "text-red-500"
  if (severity === "medium") return "text-yellow-500"
  return "text-muted-foreground"
}

function categoryIcon(category: string) {
  const cat = CATEGORIES.find((c) => c.value === category)
  return cat?.icon ?? ShieldCheck
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ts
  }
}

const POLL_TOOL_NAMES = new Set(["gmail_poll", "gcalendar_poll", "gdrive_poll"])

function isZeroImportPoll(entry: UnifiedAuditEntry): boolean {
  if (!POLL_TOOL_NAMES.has(entry.toolName ?? "")) return false
  const imported = (entry.details as Record<string, unknown>)?.imported
  return imported === 0
}

function entryDescription(entry: UnifiedAuditEntry): string {
  const cat = entry._category
  if (cat === "exec") {
    return `${entry.command ?? "command"}${entry.exitCode !== undefined ? ` → exit ${entry.exitCode}` : ""}`
  }
  if (cat === "memory") {
    return `${entry.action} ${entry.path ?? ""}`
  }
  if (cat === "messaging") {
    return `${entry.action} via ${entry.channel ?? "unknown"}${entry.target ? ` → ${entry.target}` : ""}`
  }
  if (cat === "browser") {
    return `${entry.action}${entry.domain ? ` on ${entry.domain}` : ""}`
  }
  if (cat === "web-search") {
    return entry.query ? `"${entry.query}"` : entry.action
  }
  if (cat === "web-fetch") {
    return entry.url ? String(entry.url) : entry.action
  }
  if (cat === "gmail") {
    return `${entry.action}${entry.details?.subject ? `: ${entry.details.subject}` : ""}`
  }
  if (cat === "gcalendar") {
    return `${entry.action}${entry.details?.summary ? `: ${entry.details.summary}` : entry.details?.eventId ? ` ${entry.details.eventId}` : ""}`
  }
  if (cat === "gdrive") {
    return entry.reason || entry.action
  }
  if (cat === "guard") {
    const model = entry.details?.model ? ` (${entry.details.model})` : ""
    return `${entry.action}${model}`
  }
  return entry.action
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function AuditEntryRow({ entry }: { entry: UnifiedAuditEntry }) {
  const Icon = categoryIcon(entry._category)
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 text-xs">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", severityColor(entry.severity))} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{entryDescription(entry)}</span>
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", verdictClass(entry.verdict))}>
            {entry.verdict}
          </Badge>
        </div>
        {entry.reason && entry.reason !== "Delivered successfully" && entry.reason !== "Inbound message processed" && (
          <div className="text-muted-foreground truncate">{entry.reason}</div>
        )}
        <div className="flex items-center gap-3 text-muted-foreground">
          <span>{formatTime(entry.timestamp)}</span>
          <span className="text-muted-foreground/50">{entry._category}</span>
          {entry.durationMs !== undefined && <span>{entry.durationMs}ms</span>}
          {entry.filesChangedCount !== undefined && entry.filesChangedCount > 0 && (
            <span>{entry.filesChangedCount} files</span>
          )}
          {entry.contentLength !== undefined && (
            <span>{entry.contentLength} chars</span>
          )}
          {(entry.details as Record<string, unknown>)?.payloadCount !== undefined && (
            <span>{String((entry.details as Record<string, unknown>).payloadCount)} payloads</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AuditPage() {
  const [activeTab, setActiveTab] = useState("ledger")
  // Fetch index (all categories, no date filter) to get available dates
  const indexQuery = useAudit(null, null)
  const workspaceLogsQuery = useWorkspaceLogs(activeTab === "logs")

  // Selected filters
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [verdictFilter, setVerdictFilter] = useState<"all" | "allowed" | "blocked" | "error">("all")

  // Collect all unique dates across all categories
  const allDates = useMemo(() => {
    const categories = indexQuery.data?.categories ?? {}
    const dateSet = new Set<string>()
    for (const dates of Object.values(categories)) {
      for (const d of dates) dateSet.add(d)
    }
    return Array.from(dateSet).sort().reverse()
  }, [indexQuery.data?.categories])

  // Auto-select most recent date
  useEffect(() => {
    if (allDates.length === 0) {
      if (selectedDate) setSelectedDate("")
      return
    }
    if (!selectedDate || !allDates.includes(selectedDate)) {
      setSelectedDate(allDates[0]!)
    }
  }, [allDates, selectedDate])

  // Fetch entries for selected date + category
  const entriesQuery = useAudit(
    selectedDate || null,
    selectedCategory === "all" ? null : selectedCategory,
  )

  const entries = useMemo(
    () => entriesQuery.data?.entries ?? [],
    [entriesQuery.data?.entries],
  )

  const filteredEntries = useMemo(
    () =>
      entries
        .filter((e) => !isZeroImportPoll(e))
        .filter((e) => verdictFilter === "all" || e.verdict === verdictFilter),
    [entries, verdictFilter],
  )

  // Category counts for the selected date (exclude zero-import polls)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of entries) {
      if (isZeroImportPoll(e)) continue
      counts[e._category] = (counts[e._category] ?? 0) + 1
    }
    return counts
  }, [entries])

  const refresh = async () => {
    await Promise.all([
      indexQuery.refetch(),
      entriesQuery.refetch(),
      ...(activeTab === "logs" ? [workspaceLogsQuery.refetch()] : []),
    ])
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
    if (!entries.length) return
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" })
    downloadBlob(blob, `audit-${selectedDate || "all"}.json`)
  }

  const exportCsv = () => {
    if (!entries.length) return
    const cols = [
      "timestamp", "_category", "toolName", "action", "verdict", "reason",
      "severity", "command", "path", "channel", "target", "domain", "url",
      "query", "exitCode", "durationMs", "contentLength", "filesChangedCount",
      "details",
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
    const rows = entries.map((e) =>
      cols.map((c) => escapeCell(e[c])).join(",")
    )
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    downloadBlob(blob, `audit-${selectedDate || "all"}.csv`)
  }

  return (
    <PageShell>
      <PageHeader
        title="Audit Log"
        description="Unified, immutable record of all vault actions — commands, memory, messaging, browsing, and search."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="ledger">Action Ledger</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Action Ledger
                <div className="ml-auto flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={entries.length === 0}
                        title="Export audit log (includes all entries)"
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
                    onClick={refresh}
                    disabled={indexQuery.isFetching || entriesQuery.isFetching}
                  >
                    <RefreshCw className={cn(
                      "h-3.5 w-3.5",
                      (indexQuery.isFetching || entriesQuery.isFetching) && "animate-spin"
                    )} />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date picker */}
            <Select value={selectedDate} onValueChange={setSelectedDate}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent>
                {allDates.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No audit data yet
                  </SelectItem>
                ) : (
                  allDates.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {/* Category filter */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                    {cat.value !== "all" && categoryCounts[cat.value]
                      ? ` (${categoryCounts[cat.value]})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Verdict filter */}
            <Select value={verdictFilter} onValueChange={(v) => setVerdictFilter(v as typeof verdictFilter)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verdicts</SelectItem>
                <SelectItem value="allowed">Allowed</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Summary badges */}
          {selectedDate && entries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(categoryCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => {
                  const Icon = categoryIcon(cat)
                  return (
                    <button
                      key={cat}
                      className={cn(
                        "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                        selectedCategory === cat
                          ? "bg-secondary text-secondary-foreground border-secondary"
                          : "text-muted-foreground hover:bg-secondary/50"
                      )}
                      onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
                    >
                      <Icon className="h-3 w-3" />
                      {cat} ({count})
                    </button>
                  )
                })}
              <span className="text-[10px] text-muted-foreground self-center ml-1">
                {(() => {
                  const totalVisible = Object.values(categoryCounts).reduce((a, b) => a + b, 0)
                  return filteredEntries.length === totalVisible
                    ? `${totalVisible} total`
                    : `${filteredEntries.length} / ${totalVisible}`
                })()}
              </span>
            </div>
          )}

          {/* Error states */}
          {indexQuery.error instanceof Error && (
            <div className="text-xs text-destructive">
              Failed to load audit index: {indexQuery.error.message}
            </div>
          )}
          {entriesQuery.error instanceof Error && (
            <div className="text-xs text-destructive">
              Failed to load audit entries: {entriesQuery.error.message}
            </div>
          )}

          {/* Entries */}
          {!selectedDate ? (
            <div className="text-xs text-muted-foreground rounded border border-dashed p-4 text-center">
              No audit data yet. Entries appear as the agent executes commands, writes memory, or delivers messages.
            </div>
          ) : entriesQuery.isLoading ? (
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading audit entries...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-muted-foreground rounded border border-dashed p-4 text-center">
              No entries for {selectedDate}.
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground rounded border border-dashed p-4 text-center">
              No entries match the selected filters.
            </div>
          ) : (
            <div className="rounded-md border divide-y max-h-[40rem] overflow-y-auto">
              {filteredEntries.map((entry, i) => (
                <AuditEntryRow key={`${entry.timestamp}-${i}`} entry={entry} />
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
                Logs
                <div className="ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={refresh}
                    disabled={workspaceLogsQuery.isFetching}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", workspaceLogsQuery.isFetching && "animate-spin")} />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Tail of the Workspace log.
              </p>
              {(workspaceLogsQuery.data?.logs ?? []).map((logFile) => (
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
                    <pre className="max-h-96 overflow-auto p-3 text-[10px] leading-4 whitespace-pre-wrap break-words font-mono">
                      {logFile.content || "No log output yet."}
                    </pre>
                  </div>
                </div>
              ))}
              {!workspaceLogsQuery.isLoading && (workspaceLogsQuery.data?.logs?.length ?? 0) === 0 && (
                <div className="rounded-md border bg-muted/20 p-3 text-[10px] text-muted-foreground">
                  No workspace logs available.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
