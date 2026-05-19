import { useState, useCallback, useRef, useEffect } from "react"
import {
  ListTodo,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Send,
  Trash2,
  MessageSquare,
  Brain,
  Wrench,
  FileText,
  Download,
  GitBranch,
  AlertTriangle,
  Info,
  Square,
  Bot,
  RotateCw,
  CalendarClock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { PageLoading } from "@/components/shared/page-loading"
import {
  useTasksList,
  useTaskDetail,
  useCreateTask,
  useDeleteTask,
  useStopTask,
  useUpdateTask,
  useSendTaskMessage,
} from "@/hooks/use-tasks"
import { useAgentsStatus } from "@/hooks/use-agents"
import { cn, statusBadgeClass } from "@/lib/utils"
import type { TaskListItem, ActivityEntry, TaskStatus } from "@/lib/task-types"
import { issueArtifactDownloadUrl } from "@/lib/api"
import type { ScheduleConfig } from "@/lib/schedule-types"
import { createDefaultSchedule, formatScheduleLabel, isScheduleEnabled } from "@/lib/schedule"
import { ScheduleFields } from "@/components/shared/schedule-fields"
import type { AgentLatestUsage } from "@/lib/types"
import { useParams, useNavigate } from "react-router"
import { toast } from "sonner"

export function TasksPage() {
  const { id: routeTaskId } = useParams()
  const navigate = useNavigate()
  const { data, isLoading } = useTasksList()
  const [selectedTask, setSelectedTask] = useState<string | null>(routeTaskId ?? null)
  const [createOpen, setCreateOpen] = useState(false)

  const tasks = data?.tasks ?? []
  const selected = tasks.find((t) => t.id === selectedTask) ?? null

  // Sync route param to selection
  useEffect(() => {
    if (routeTaskId && routeTaskId !== selectedTask) {
      setSelectedTask(routeTaskId)
    }
  }, [routeTaskId])

  const handleSelectTask = useCallback(
    (id: string) => {
      setSelectedTask(id)
      navigate(`/tasks/${id}`, { replace: true })
    },
    [navigate],
  )

  const handleCreated = useCallback(
    (id: string) => {
      setSelectedTask(id)
      navigate(`/tasks/${id}`, { replace: true })
    },
    [navigate],
  )

  const handleBack = useCallback(() => {
    setSelectedTask(null)
    navigate("/tasks", { replace: true })
  }, [navigate])

  return (
    <>
      <div className="h-[calc(100vh-3rem)] min-[1300px]:flex min-[1300px]:overflow-hidden">
        {/* Left panel — task list */}
        <div className={cn(
          "border-b min-[1300px]:flex min-[1300px]:h-full min-[1300px]:w-80 min-[1300px]:flex-col min-[1300px]:shrink-0 min-[1300px]:overflow-hidden min-[1300px]:border-b-0 min-[1300px]:border-r",
          selectedTask ? "hidden min-[1300px]:flex" : "flex flex-col h-full",
        )}>
          <div className="flex items-center justify-between border-b px-3 py-3 shrink-0">
            <h1 className="text-sm font-semibold">Tasks</h1>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Task
            </Button>
          </div>
          <TaskListPanel
            tasks={tasks}
            isLoading={isLoading}
            selectedId={selectedTask}
            onSelect={handleSelectTask}
          />
        </div>

        {/* Right panel — task detail */}
        <div className={cn(
          "min-w-0 flex-1 overflow-hidden min-[1300px]:h-full",
          !selectedTask ? "hidden min-[1300px]:flex min-[1300px]:flex-col" : "flex flex-col h-full",
        )}>
          {selected ? (
            <>
              <div className="border-b px-4 py-4 shrink-0 min-[1300px]:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 px-2 text-muted-foreground"
                  onClick={handleBack}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back to tasks
                </Button>
              </div>
              <TaskDetailPanel taskId={selected.id} status={selected.status} schedule={selected.schedule} />
            </>
          ) : (
            <EmptyState
              icon={<ListTodo className="h-10 w-10" />}
              title="Select a task"
              description="Choose a task from the list or create a new one"
              className="flex-1"
            />
          )}
        </div>
      </div>
      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </>
  )
}

/* ── Task List Panel ── */
function TaskListPanel({
  tasks,
  isLoading,
  selectedId,
  onSelect,
}: {
  tasks: TaskListItem[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const scheduled = tasks.filter((t) => isScheduleEnabled(t.schedule))
  const unscheduled = tasks.filter((t) => !isScheduleEnabled(t.schedule))
  const active = unscheduled.filter((t) => t.status === "running")
  const completed = unscheduled.filter((t) => t.status === "completed")
  const failed = unscheduled.filter((t) => t.status === "failed")

  if (isLoading) {
    return (
      <PageLoading variant="spinner" message="Loading tasks..." />
    )
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo className="h-8 w-8" />}
        title="No tasks yet"
        description="Create a task to get started"
        className="py-10"
      />
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-1.5 space-y-2">
        {scheduled.length > 0 && (
          <TaskGroup label="Scheduled" tasks={scheduled} selectedId={selectedId} onSelect={onSelect} section="scheduled" />
        )}
        {active.length > 0 && (
          <TaskGroup label="Active" tasks={active} selectedId={selectedId} onSelect={onSelect} />
        )}
        {failed.length > 0 && (
          <TaskGroup label="Failed" tasks={failed} selectedId={selectedId} onSelect={onSelect} />
        )}
        {completed.length > 0 && (
          <TaskGroup label="Completed" tasks={completed} selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
    </ScrollArea>
  )
}

function TaskGroup({
  label,
  tasks,
  selectedId,
  onSelect,
  section = "status",
}: {
  label: string
  tasks: TaskListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  section?: "scheduled" | "status"
}) {
  return (
    <div>
      <div className="px-2 py-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="space-y-0.5">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={selectedId === task.id}
            onSelect={() => onSelect(task.id)}
            section={section}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  selected,
  onSelect,
  section = "status",
}: {
  task: TaskListItem
  selected: boolean
  onSelect: () => void
  section?: "scheduled" | "status"
}) {
  const StatusIcon = section === "scheduled"
    ? CalendarClock
    : task.status === "scheduled"
      ? CalendarClock
    : task.status === "running"
      ? Loader2
      : task.status === "completed"
        ? CheckCircle2
        : XCircle
  const statusColor = section === "scheduled"
    ? "text-amber-500"
    : task.status === "scheduled"
      ? "text-amber-500"
    : task.status === "running"
      ? "text-blue-500"
      : task.status === "completed"
        ? "text-emerald-500"
        : "text-red-500"
  const stopMut = useStopTask()
  const deleteMut = useDeleteTask()
  const [confirmAction, setConfirmAction] = useState<"stop" | "delete" | null>(null)

  const executeAction = () => {
    if (confirmAction === "stop") {
      stopMut.mutate(task.id, { onSuccess: () => { toast.success("Task stopped"); setConfirmAction(null) } })
    } else if (confirmAction === "delete") {
      deleteMut.mutate(task.id, { onSuccess: () => { toast.success("Task deleted"); setConfirmAction(null) } })
    }
  }

  return (
    <>
      <div
        className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${selected ? "bg-accent" : "hover:bg-muted/50"}`}
        onClick={onSelect}
      >
        <div className="flex items-start gap-2">
          <StatusIcon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${statusColor} ${section === "status" && task.status === "running" ? "animate-spin" : ""}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{task.title}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground truncate">{task.agentId}</span>
              <span className="text-[10px] text-muted-foreground">·</span>
              {section === "scheduled" ? (
                <>
                  <span className="text-[10px] text-muted-foreground capitalize">{task.status}</span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                </>
              ) : null}
              <span className="text-[10px] text-muted-foreground">{timeAgo(task.updatedAt)}</span>
              {isScheduleEnabled(task.schedule) ? (
                <>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <CalendarClock className="h-3 w-3" />
                    {formatScheduleLabel(task.schedule)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          {/* Inline action buttons — visible on hover */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {task.status === "running" && (
              <button type="button" className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground" title="Stop" onClick={() => setConfirmAction("stop")}>
                <Square className="h-3 w-3" />
              </button>
            )}
            <button type="button" className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => setConfirmAction("delete")}>
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title={confirmAction === "delete" ? "Delete task" : "Stop task"}
        description={confirmAction === "delete" ? `Delete "${task.title}"? This cannot be undone.` : `Stop the running task "${task.title}"?`}
        confirmLabel={confirmAction === "delete" ? "Delete" : "Stop"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        isPending={stopMut.isPending || deleteMut.isPending}
        onConfirm={executeAction}
      />
    </>
  )
}

/* ── Task Detail Panel ── */
function TaskDetailPanel({
  taskId,
  status,
  schedule,
}: {
  taskId: string
  status: TaskStatus
  schedule?: ScheduleConfig
}) {
  const { data, isLoading } = useTaskDetail(taskId, status === "running" || isScheduleEnabled(schedule))
  const deleteMut = useDeleteTask()
  const stopMut = useStopTask()
  const updateMut = useUpdateTask()
  const createMut = useCreateTask()
  const sendMut = useSendTaskMessage()
  const [messageInput, setMessageInput] = useState("")
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleConfig>(createDefaultSchedule())
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"stop" | "delete" | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const activityEndRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Auto-scroll to bottom on new activity
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [data?.activityTotal])

  useEffect(() => {
    if (!data?.meta) return
    setScheduleDraft(data.meta.schedule ?? createDefaultSchedule())
  }, [data?.meta, taskId])

  if (isLoading || !data) {
    return (
      <PageLoading variant="spinner" message="Loading task..." />
    )
  }

  const { meta, activity } = data

  const handleSend = () => {
    const msg = messageInput.trim()
    if (!msg) return
    sendMut.mutate({ id: taskId, message: msg })
    setMessageInput("")
  }

  const handleDelete = () => setConfirmAction("delete")
  const handleStop = () => setConfirmAction("stop")

  const executeConfirm = () => {
    if (confirmAction === "delete") {
      deleteMut.mutate(taskId, {
        onSuccess: () => {
          toast.success("Task deleted")
          setConfirmAction(null)
          navigate("/tasks", { replace: true })
        },
      })
    } else if (confirmAction === "stop") {
      stopMut.mutate(taskId, {
        onSuccess: () => { toast.success("Task stopped"); setConfirmAction(null) },
      })
    }
  }

  const handleComplete = () => {
    updateMut.mutate(
      { id: taskId, patch: { status: "completed" } },
      { onSuccess: () => toast.success("Task marked as complete") },
    )
  }

  const handleRerun = () => {
    createMut.mutate(
      { title: meta.title, instruction: meta.instruction, agentId: meta.agentId },
      {
        onSuccess: (data) => {
          toast.success("Task re-created")
          navigate(`/tasks/${data.task.id}`, { replace: true })
        },
      },
    )
  }

  const handleSaveSchedule = () => {
    updateMut.mutate(
      {
        id: taskId,
        patch: {
          schedule: isScheduleEnabled(scheduleDraft) ? scheduleDraft : { mode: "off" },
        },
      },
      {
        onSuccess: ({ task }) => {
          setScheduleDraft(task.schedule ?? createDefaultSchedule())
          setScheduleDialogOpen(false)
          toast.success("Task schedule saved")
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to save task schedule")
        },
      },
    )
  }

  const handleRemoveSchedule = () => {
    setScheduleDraft((prev) => ({
      ...prev,
      mode: "off",
    }))
  }

  const handleOutputDownload = async (collection: string, path: string) => {
    setDownloadingPath(path)
    try {
      const { url } = await issueArtifactDownloadUrl(collection, path)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to prepare download")
    } finally {
      setDownloadingPath(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold truncate">{meta.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] gap-1">
                <Bot className="h-3 w-3" />
                {meta.agentId}
              </Badge>
              <StatusBadge status={meta.status} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-xl px-2 text-[10px]"
                onClick={() => setScheduleDialogOpen(true)}
              >
                <CalendarClock className="h-3 w-3" />
                {formatScheduleLabel(scheduleDraft)}
              </Button>
              <span className="text-[10px] text-muted-foreground">{timeAgo(meta.createdAt)}</span>
              {meta.error && (
                <span className="text-[10px] text-red-500 truncate max-w-48">{meta.error}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {meta.status === "running" && (
              <>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-500" onClick={handleComplete} disabled={updateMut.isPending} title="Mark complete">
                  {updateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleStop} disabled={stopMut.isPending} title="Stop task">
                  {stopMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                </Button>
              </>
            )}
            {(meta.status === "completed" || meta.status === "failed") && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleRerun} disabled={createMut.isPending} title="Rerun task">
                {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={handleDelete} disabled={deleteMut.isPending} title="Delete task">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="border-b px-4 py-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Agent", value: meta.agentId },
            { label: "Status", value: meta.status.charAt(0).toUpperCase() + meta.status.slice(1) },
            { label: "Created", value: timeAgo(meta.createdAt) },
            { label: "Activity", value: `${activity.length} events` },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
              <div className="text-sm font-medium mt-0.5 truncate">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity stream */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-3">
          {activity.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Waiting for activity...
            </div>
          ) : (
            activity.map((entry, i) => (
              <ActivityRow
                key={`${entry.ts}-${i}`}
                entry={entry}
                downloadingPath={downloadingPath}
                onDownload={handleOutputDownload}
              />
            ))
          )}
          <div ref={activityEndRef} />
        </div>
      </ScrollArea>

      {/* Chat input */}
      {meta.status === "running" && (
        <div className="border-t px-4 py-3 shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Follow-up</div>
          <div className="flex gap-2">
            <Input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Send follow-up instruction..."
              className="text-sm h-8"
              disabled={sendMut.isPending}
            />
            <Button size="sm" className="h-8 px-3" onClick={handleSend} disabled={sendMut.isPending || !messageInput.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title={confirmAction === "delete" ? "Delete task" : "Stop task"}
        description={confirmAction === "delete" ? `Delete "${meta.title}"? This cannot be undone.` : `Stop the running task "${meta.title}"?`}
        confirmLabel={confirmAction === "delete" ? "Delete" : "Stop"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        isPending={deleteMut.isPending || stopMut.isPending}
        onConfirm={executeConfirm}
      />

      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Scheduled run</DialogTitle>
            <DialogDescription>
              Run this task template through the existing gateway cron scheduler.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <ScheduleFields schedule={scheduleDraft} onChange={setScheduleDraft} />
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Schedule changes are saved with this task template.
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleRemoveSchedule}
                disabled={scheduleDraft.mode === "off"}
              >
                Remove schedule
              </Button>
              <Button type="button" variant="outline" onClick={() => setScheduleDialogOpen(false)}>
                Close
              </Button>
              <Button type="button" onClick={handleSaveSchedule} disabled={updateMut.isPending}>
                {updateMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
                Save task
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ── Activity Row ── */
function ActivityRow({
  entry,
  downloadingPath,
  onDownload,
}: {
  entry: ActivityEntry
  downloadingPath: string | null
  onDownload: (collection: string, path: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)

  const config = ACTIVITY_CONFIG[entry.type] || ACTIVITY_CONFIG.reasoning
  const Icon = config.icon
  const collection = typeof entry.meta?.collection === "string" ? entry.meta.collection : null
  const path = typeof entry.meta?.path === "string" ? entry.meta.path : null
  const fileName = path?.split("/").pop() ?? null
  const usage = isAgentLatestUsage(entry.meta?.usage) ? entry.meta.usage : null

  return (
    <div className={`flex gap-2.5 ${config.className}`}>
      <div className={`mt-0.5 shrink-0 ${config.iconColor}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{entry.summary}</div>
        {usage && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px]">
              {usage.local ? "Local" : "Cloud"}
            </Badge>
            <span className="font-medium text-foreground/80">{usage.provider}/{usage.model}</span>
            {usage.inputTokens || usage.outputTokens ? (
              <span>{formatCompactTokens(usage.inputTokens)} in / {formatCompactTokens(usage.outputTokens)} out</span>
            ) : null}
            {typeof usage.estimatedCostUsd === "number" ? <span>{formatCompactUsd(usage.estimatedCostUsd)}</span> : null}
            {usage.fallbackFrom ? (
              <span>
                fallback from {usage.fallbackFrom.provider}/{usage.fallbackFrom.model}
              </span>
            ) : null}
          </div>
        )}
        {entry.detail && (
          <>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground mt-0.5"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide details" : "Show details"}
            </button>
            {expanded && (
              <pre className="mt-1 text-[11px] text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60">
                {entry.detail}
              </pre>
            )}
          </>
        )}
        {collection && path && fileName && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => { void onDownload(collection, path) }}
              disabled={downloadingPath === path}
              title={path}
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-56 truncate">{fileName}</span>
              {downloadingPath === path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            </Button>
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-0.5">{formatTime(entry.ts)}</div>
      </div>
    </div>
  )
}

const ACTIVITY_CONFIG: Record<string, { icon: typeof MessageSquare; iconColor: string; className: string }> = {
  instruction: { icon: MessageSquare, iconColor: "text-blue-500", className: "bg-blue-500/5 rounded-md p-2" },
  reasoning: { icon: Brain, iconColor: "text-muted-foreground", className: "opacity-75" },
  tool_call: { icon: Wrench, iconColor: "text-amber-500", className: "rounded-md p-2 border border-amber-500/20 bg-amber-500/5" },
  output: { icon: FileText, iconColor: "text-emerald-500", className: "rounded-md p-2 border border-emerald-500/20 bg-emerald-500/5" },
  delegation: { icon: GitBranch, iconColor: "text-purple-500", className: "rounded-md p-2 border border-purple-500/20 bg-purple-500/5" },
  error: { icon: AlertTriangle, iconColor: "text-red-500", className: "bg-red-500/5 rounded-md p-2" },
  status_change: { icon: Info, iconColor: "text-muted-foreground", className: "opacity-60" },
}

/* ── Status Badge ── */
function StatusBadge({ status }: { status: TaskStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <Badge variant="default" className={`text-[10px] ${statusBadgeClass(status)}`}>
      {label}
    </Badge>
  )
}

/* ── Create Task Dialog ── */
function CreateTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const createMut = useCreateTask()
  const { data: agentsData } = useAgentsStatus()
  const [title, setTitle] = useState("")
  const [instruction, setInstruction] = useState("")
  const [agentId, setAgentId] = useState("")
  const [schedule, setSchedule] = useState<ScheduleConfig>(createDefaultSchedule())

  const agents = agentsData?.agents?.filter((a) => a.enabled) ?? []

  const handleSubmit = () => {
    if (!instruction.trim()) {
      toast.error("Instruction is required")
      return
    }
    createMut.mutate(
      {
        title: title.trim() || undefined,
        instruction: instruction.trim(),
        agentId: agentId || undefined,
        schedule: isScheduleEnabled(schedule) ? schedule : { mode: "off" },
      },
      {
        onSuccess: (data) => {
          toast.success("Task created")
          onOpenChange(false)
          setTitle("")
          setInstruction("")
          setAgentId("")
          setSchedule(createDefaultSchedule())
          onCreated(data.task.id)
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to create task")
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>Describe what you want the agent to do.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Title (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-generated from instruction"
              className="text-sm h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Instruction</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Analyze the ds-mcp repo and create a report"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Default (first enabled)" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <div>
              <div className="text-sm font-medium">Repeat with cron</div>
              <div className="text-xs text-muted-foreground">
                Optional. This task is created now and can also repeat later on a schedule.
              </div>
            </div>
            <ScheduleFields schedule={schedule} onChange={setSchedule} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={createMut.isPending || !instruction.trim()}>
            {createMut.isPending ? "Creating..." : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Helpers ── */
function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return iso
  }
}

function formatCompactTokens(value?: number): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}k`
  return `${numeric}`
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00"
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

function isAgentLatestUsage(value: unknown): value is AgentLatestUsage {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as AgentLatestUsage).provider === "string" &&
      typeof (value as AgentLatestUsage).model === "string" &&
      typeof (value as AgentLatestUsage).local === "boolean",
  )
}
