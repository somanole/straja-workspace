import { useNavigate } from "react-router"
import {
  Database,
  FileText,
  Cpu,
  Zap,
  Plug,
  ListTodo,
  GitBranch,
  ArrowRight,
  Plus,
  Search,
  Pencil,
  Check,
  Mail,
  HardDrive,
  Calendar,
  Users,
  Globe,
  Terminal,
  Bot,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { ImportDialog } from "@/components/collections/import-dialog"
import { useVaultStatus } from "@/hooks/use-vault-status"
import { useModelsStatus } from "@/hooks/use-models"
import { useGmailStatus } from "@/hooks/use-gmail"
import { useDriveStatus } from "@/hooks/use-gdrive"
import { useCalendarStatus } from "@/hooks/use-gcalendar"
import { useContactsStatus } from "@/hooks/use-gcontacts"
import { useAudit } from "@/hooks/use-audit"
import { useAgentsStatus } from "@/hooks/use-agents"
import { useTasksList } from "@/hooks/use-tasks"
import { useFlows } from "@/hooks/use-flows"
import { useWorkspaceConfig, useWorkspaceConfigUpdate } from "@/hooks/use-workspace-config"
import { useUIStore } from "@/stores/ui-store"
import { PageShell } from "@/components/shared/page-shell"
import { statusBadgeClass } from "@/lib/utils"
import { useState, useRef, useEffect, useMemo } from "react"
import { formatDistanceToNow } from "date-fns"
import type { UnifiedAuditEntry } from "@/lib/types"
import type { TaskListItem, TaskStatus } from "@/lib/task-types"
import type { FlowDefinition } from "@/lib/flow-types"

export function DashboardPage() {
  const { data: status, isLoading } = useVaultStatus()
  const { data: models, isLoading: modelsLoading } = useModelsStatus()
  const { data: gmail, isLoading: gmailLoading } = useGmailStatus()
  const { data: drive, isLoading: driveLoading } = useDriveStatus()
  const { data: calendar, isLoading: calendarLoading } = useCalendarStatus()
  const { data: contacts, isLoading: contactsLoading } = useContactsStatus()
  // Fetch audit index first (no date) to discover available dates, then fetch the latest date
  const { data: auditIndex } = useAudit()
  const latestAuditDate = useMemo(() => {
    if (!auditIndex?.categories) return undefined
    const allDates = Object.values(auditIndex.categories).flat()
    if (allDates.length === 0) return undefined
    return allDates.sort().reverse()[0]
  }, [auditIndex])
  const { data: audit } = useAudit(latestAuditDate)
  const { data: agents, isLoading: agentsLoading } = useAgentsStatus()
  const { data: tasksData, isLoading: tasksLoading } = useTasksList()
  const { data: flowsData, isLoading: flowsLoading } = useFlows()
  const { data: workspaceConfig } = useWorkspaceConfig()
  const workspaceConfigUpdate = useWorkspaceConfigUpdate()
  const enabledAgents = agents?.agents?.filter((a) => a.enabled) ?? []
  const connectionsLoading = gmailLoading || driveLoading || calendarLoading || contactsLoading || agentsLoading
  const activeConnections =
    [gmail, drive, calendar, contacts].filter((s) => s?.status === "connected").length +
    enabledAgents.length
  const connectionItems = useMemo(
    () =>
      [
        {
          key: "gmail",
          icon: <Mail className="h-4 w-4" />,
          label: "Gmail",
          status: gmail?.status,
          docs: gmail?.documentCount,
          lastSync: gmail?.lastSync,
          error: gmail?.authErrorMessage,
        },
        {
          key: "drive",
          icon: <HardDrive className="h-4 w-4" />,
          label: "Drive",
          status: drive?.status,
          docs: drive?.documentCount,
          lastSync: drive?.lastSync,
          error: drive?.authErrorMessage,
        },
        {
          key: "calendar",
          icon: <Calendar className="h-4 w-4" />,
          label: "Calendar",
          status: calendar?.status,
          docs: calendar?.documentCount,
          lastSync: calendar?.lastSync,
          error: calendar?.authErrorMessage,
        },
        {
          key: "contacts",
          icon: <Users className="h-4 w-4" />,
          label: "Contacts",
          status: contacts?.status,
          docs: contacts?.documentCount,
          lastSync: contacts?.lastSync,
          error: contacts?.authErrorMessage,
        },
        ...enabledAgents.map((agent) => ({
          key: agent.id,
          icon: <Bot className="h-4 w-4" />,
          label: agent.name,
          status: agent.enabled ? "connected" : "not_connected",
          docs: undefined,
          lastSync: undefined,
          error: agent.lastError,
        })),
      ].slice(0, 10),
    [
      calendar?.authErrorMessage,
      calendar?.documentCount,
      calendar?.lastSync,
      calendar?.status,
      contacts?.authErrorMessage,
      contacts?.documentCount,
      contacts?.lastSync,
      contacts?.status,
      drive?.authErrorMessage,
      drive?.documentCount,
      drive?.lastSync,
      drive?.status,
      enabledAgents,
      gmail?.authErrorMessage,
      gmail?.documentCount,
      gmail?.lastSync,
      gmail?.status,
    ],
  )
  const [importOpen, setImportOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const workspaceName = workspaceConfig?.name?.trim() || "Your Workspace"
  const [draftName, setDraftName] = useState(workspaceName)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const renameCommitInFlightRef = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [editingName])

  useEffect(() => {
    if (!editingName) {
      setDraftName(workspaceName)
    }
  }, [workspaceName, editingName])

  const commitName = async () => {
    if (renameCommitInFlightRef.current) return
    renameCommitInFlightRef.current = true
    const trimmed = draftName.trim()
    const nextName = trimmed || "Your Workspace"
    try {
      if (nextName === workspaceName) {
        setDraftName(nextName)
        setEditingName(false)
        return
      }
      await workspaceConfigUpdate.mutateAsync({ name: nextName })
      setDraftName(nextName)
      setEditingName(false)
    } finally {
      renameCommitInFlightRef.current = false
    }
  }

  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const modelsPulling = !!models?.pulling
  const modelsProgress =
    models?.totalCount && models?.totalCount > 0
      ? `${models.downloadedCount ?? 0}/${models.totalCount}`
      : undefined
  const modelsValue = modelsLoading && !models
    ? "Checking..."
    : modelsPulling
      ? `Downloading${modelsProgress ? ` ${modelsProgress}` : ""}`
      : models?.downloaded
        ? "Ready"
        : "Not Downloaded"

  // Recent activity: filter out empty syncs (imported=0), keep syncs that imported docs
  const recentActivity = useMemo(() => {
    if (!audit?.entries) return []
    return audit.entries
      .filter((e) => {
        if (e.action !== "sync") return true
        // Keep syncs that actually imported something
        const imported =
          (e as Record<string, unknown>).imported ??
          (e.details as Record<string, unknown> | undefined)?.imported ??
          0
        return Number(imported) > 0
      })
      .slice(0, 10)
  }, [audit])

  // Top 6 collections sorted by last updated
  const topCollections = status?.collections
    ? [...status.collections]
        .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
        .slice(0, 6)
    : []
  const tasks = tasksData?.tasks ?? []
  const flows = flowsData?.flows ?? []
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [tasks],
  )
  const highlightedFlows = useMemo(
    () =>
      [...flows]
        .sort((a, b) => {
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
          if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
          return a.name.localeCompare(b.name)
        })
        .slice(0, 4),
    [flows],
  )
  const runningTasks = tasks.filter((task) => task.status === "running").length
  const completedTasks = tasks.filter((task) => task.status === "completed").length
  const failedTasks = tasks.filter((task) => task.status === "failed").length
  const enabledFlowsCount = flows.filter((flow) => flow.enabled).length
  const pausedFlowsCount = flows.length - enabledFlowsCount

  return (
    <PageShell>
      {/* Title + Quick Search */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 group">
            {editingName ? (
              <form
                onSubmit={(e) => { e.preventDefault(); void commitName() }}
                className="flex items-center gap-2"
              >
                <input
                  ref={nameInputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => { void commitName() }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setDraftName(workspaceName)
                      setEditingName(false)
                    }
                  }}
                  className="text-2xl font-semibold tracking-tight bg-transparent border-b border-foreground/30 outline-none w-auto"
                  style={{ width: `${Math.max(draftName.length, 3)}ch` }}
                  maxLength={40}
                />
                <button
                  type="submit"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  disabled={workspaceConfigUpdate.isPending}
                >
                  <Check className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">{workspaceName}</h1>
                <button
                  onClick={() => { setDraftName(workspaceName); setEditingName(true) }}
                  className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground transition-colors"
                  title="Rename workspace"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Your documents, searchable and always ready.
          </p>
        </div>
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="relative max-w-lg w-full flex items-center gap-2 rounded-md border border-input bg-background px-3 h-10 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Search className="h-4 w-4" />
          <span>Search your documents or ask a question...</span>
          <kbd className="ml-auto pointer-events-none text-[10px] font-medium text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatusCard
          title="Documents"
          value={status?.totalDocuments}
          icon={<FileText className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <StatusCard
          title="Collections"
          value={status?.collections.length}
          icon={<Database className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <StatusCard
          title="Pending Embed"
          value={status?.needsEmbedding}
          icon={<Zap className="h-4 w-4" />}
          isLoading={isLoading}
          warn={(status?.needsEmbedding ?? 0) > 0}
          dot={(status?.needsEmbedding ?? 0) > 0 ? "amber" : "green"}
        />
        <StatusCard
          title="Write Queue"
          value={status?.writeQueue?.entries ?? 0}
          icon={<ListTodo className="h-4 w-4" />}
          isLoading={isLoading}
          dot={(status?.writeQueue?.entries ?? 0) > 0 ? "amber" : "green"}
        />
        <StatusCard
          title="Models"
          value={modelsValue}
          icon={<Cpu className="h-4 w-4" />}
          isLoading={false}
          warn={!modelsPulling && !modelsLoading && !models?.downloaded}
          dot={modelsPulling ? "amber" : models?.downloaded ? "green" : "amber"}
        />
        <StatusCard
          title="Connections"
          value={`${activeConnections} Active`}
          icon={<Plug className="h-4 w-4" />}
          isLoading={connectionsLoading}
          dot={activeConnections > 0 ? "green" : "amber"}
          onClick={() => navigate("/connections")}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div className="space-y-1">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-muted-foreground" />
                Tasks
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Recent execution work and quick access to the task screen.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => navigate("/tasks")}
            >
              Open tasks
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              <MiniStatPill label="Running" value={runningTasks} tone="blue" />
              <MiniStatPill label="Completed" value={completedTasks} tone="green" />
              <MiniStatPill label="Failed" value={failedTasks} tone="red" />
            </div>
            {tasksLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentTasks.length === 0 ? (
              <CompactEmptyState
                title="No tasks yet"
                description="Tasks you launch will show up here for quick follow-up."
              />
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <TaskOverviewRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div className="space-y-1">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                Flows
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Active automations and shortcuts into the flow builder.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => navigate("/flows")}
            >
              Open flows
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              <MiniStatPill label="Enabled" value={enabledFlowsCount} tone="green" />
              <MiniStatPill label="Paused" value={pausedFlowsCount} tone="slate" />
              <MiniStatPill label="Total" value={flows.length} tone="blue" />
            </div>
            {flowsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : highlightedFlows.length === 0 ? (
              <CompactEmptyState
                title="No flows yet"
                description="Add a flow to automate repeated inbound and outbound work."
              />
            ) : (
              <div className="space-y-2">
                {highlightedFlows.map((flow) => (
                  <FlowOverviewRow key={flow.id} flow={flow} onOpen={() => navigate("/flows")} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connections + Recent Activity — 2-column on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Connections health */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">Connections</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => navigate("/connections")}
            >
              See all
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {connectionsLoading ? (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </>
            ) : (
              <>
                {connectionItems.map((item) => (
                  <ConnectionRow
                    key={item.key}
                    icon={item.icon}
                    label={item.label}
                    status={item.status}
                    docs={item.docs}
                    lastSync={item.lastSync}
                    error={item.error}
                  />
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => navigate("/audit")}
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {recentActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No recent activity
              </p>
            ) : (
              <div className="space-y-1">
                {recentActivity.map((entry, i) => (
                  <ActivityRow key={`${entry.timestamp}-${i}`} entry={entry} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collections — compact, top 6, with "View all" */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Collections</h2>
          <div className="flex items-center gap-2">
            {(status?.collections.length ?? 0) > 6 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => navigate("/collections")}
              >
                View all ({status?.collections.length})
                <ArrowRight className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              className="gap-1.5 h-7 text-xs"
            >
              <Plus className="h-3 w-3" />
              Import
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : topCollections.length === 0 ? (
          <EmptyState
            icon={<Database className="h-10 w-10" />}
            title="No collections yet"
            description="Import your first collection to get started with search and document management."
            action={
              <Button onClick={() => setImportOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Import Collection
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topCollections.map((col) => (
              <Card
                key={col.name}
                className="cursor-pointer hover:bg-secondary/30 transition-colors group"
                onClick={() => navigate(`/collections/${col.name}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">
                          {col.name}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{col.documents} docs</span>
                        <span>
                          {formatDistanceToNow(new Date(col.lastUpdated), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </PageShell>
  )
}

/* ── Helper Components ── */

const DOT_COLORS = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
} as const

function StatusCard({
  title,
  value,
  icon,
  isLoading,
  warn,
  dot,
  onClick,
}: {
  title: string
  value: number | string | undefined
  icon: React.ReactNode
  isLoading: boolean
  warn?: boolean
  dot?: "green" | "amber" | "red"
  onClick?: () => void
}) {
  return (
    <Card
      className={onClick ? "cursor-pointer hover:bg-secondary/30 transition-colors" : undefined}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="flex items-center gap-2">
            {dot && (
              <span className={`h-2 w-2 rounded-full shrink-0 ${DOT_COLORS[dot]}`} />
            )}
            <span
              className={`text-lg sm:text-xl font-semibold truncate ${warn ? "text-amber-500" : ""}`}
            >
              {value ?? "—"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ConnectionRow({
  icon,
  label,
  status,
  docs,
  lastSync,
  error,
}: {
  icon: React.ReactNode
  label: string
  status?: string
  docs?: number
  lastSync?: string
  error?: string
}) {
  const connected = status === "connected"
  const hasError = status === "auth_error"

  return (
    <div className="flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-secondary/50 transition-colors">
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {hasError && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
              Error
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {!status || status === "missing_credentials" || status === "not_connected"
            ? "Not connected"
            : hasError
              ? (error ?? "Authentication error")
              : docs != null
                ? `${docs} docs${lastSync ? ` · synced ${formatDistanceToNow(new Date(lastSync), { addSuffix: true })}` : ""}`
                : lastSync
                  ? `synced ${formatDistanceToNow(new Date(lastSync), { addSuffix: true })}`
                  : "Connected"}
        </div>
      </div>
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${
          connected
            ? "bg-emerald-500"
            : hasError
              ? "bg-red-500"
              : "bg-muted-foreground/30"
        }`}
      />
    </div>
  )
}

const TONE_TO_STATUS: Record<string, string> = {
  green: "completed",
  red: "failed",
  blue: "running",
  slate: "default",
}

function MiniStatPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "blue" | "green" | "red" | "slate"
}) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${statusBadgeClass(TONE_TO_STATUS[tone] ?? "default")}`}>
      <span className="font-medium">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function CompactEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function TaskOverviewRow({ task }: { task: TaskListItem }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
        </div>
      </div>
      <StatusBadge status={task.status} />
    </div>
  )
}

function FlowOverviewRow({
  flow,
  onOpen,
}: {
  flow: FlowDefinition
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{flow.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {flow.id} · priority {flow.priority}
        </div>
      </div>
      <StatusBadge status={flow.enabled ? "enabled" : "paused"} />
    </button>
  )
}

function StatusBadge({
  status,
}: {
  status: TaskStatus | "enabled" | "paused"
}) {
  const label = status.charAt(0).toUpperCase() + status.slice(1)

  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(status)}`}>
      {label}
    </span>
  )
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  browser: <Globe className="h-3.5 w-3.5" />,
  exec: <Terminal className="h-3.5 w-3.5" />,
  "web-search": <Search className="h-3.5 w-3.5" />,
  "web-fetch": <Globe className="h-3.5 w-3.5" />,
}

const VERDICT_STYLE: Record<string, { className: string; label: string }> = {
  allowed: { className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: "allowed" },
  blocked: { className: "bg-red-500/10 text-red-600 dark:text-red-400", label: "blocked" },
  error: { className: "bg-red-500/10 text-red-600 dark:text-red-400", label: "error" },
}

function readEntryString(entry: UnifiedAuditEntry, key: string): string | null {
  const topLevel = entry[key]
  if (typeof topLevel === "string" && topLevel.trim()) {
    return topLevel.trim()
  }
  const nested = entry.details?.[key]
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim()
  }
  return null
}

function formatActivitySummary(entry: UnifiedAuditEntry): string {
  if (entry._category === "exec" && entry.command) {
    return entry.command
  }

  if (entry._category === "messaging") {
    const channel = readEntryString(entry, "channel")
    return `${entry.action}${channel ? ` via ${channel}` : ""}`
  }

  if (entry._category === "browser" || entry._category === "web-fetch") {
    const url = readEntryString(entry, "url")
    if (url) return url
    const domain = readEntryString(entry, "domain")
    if (domain) return domain
  }

  if (entry._category === "web-search" && entry.query) {
    return entry.query
  }

  return entry.action
}

function formatActivityDetail(entry: UnifiedAuditEntry): string | null {
  if (entry._category === "messaging") {
    const target = readEntryString(entry, "target")
    return target ? `Target ${target}` : null
  }

  if (entry._category === "browser" || entry._category === "web-fetch") {
    const domain = readEntryString(entry, "domain")
    if (entry.reason?.trim()) {
      return domain && !entry.reason.includes(domain)
        ? `${domain} · ${entry.reason.trim()}`
        : entry.reason.trim()
    }
    return domain
  }

  if (entry.reason?.trim()) {
    return entry.reason.trim()
  }

  return null
}

function ActivityRow({ entry }: { entry: UnifiedAuditEntry }) {
  const icon = CATEGORY_ICONS[entry._category] ?? <FileText className="h-3.5 w-3.5" />
  const verdict = VERDICT_STYLE[entry.verdict]
  const summary = formatActivitySummary(entry)
  const detail = formatActivityDetail(entry)

  return (
    <div className="flex items-start gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-secondary/50 transition-colors">
      <div className="text-muted-foreground shrink-0 pt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs truncate">{summary}</span>
        </div>
        {detail ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-2">
        {verdict && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${verdict.className}`}>
            {verdict.label}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}
