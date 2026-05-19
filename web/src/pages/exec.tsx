import { useState, useCallback } from "react"
import {
  Terminal,
  Plus,
  Square,
  Trash2,
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  ArrowLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { PageLoading } from "@/components/shared/page-loading"
import { cn } from "@/lib/utils"
import {
  useSessions,
  useSessionLog,
  useExecCommand,
  useKillSession,
  useDeleteSession,
  useWriteToSession,
} from "@/hooks/use-exec"
import type { ExecSession } from "@/lib/types"
import { toast } from "sonner"

export function ExecPage() {
  const { data, isLoading } = useSessions(true)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [newExecOpen, setNewExecOpen] = useState(false)

  const sessions = data?.sessions ?? []
  const selected = sessions.find((s) => s.id === selectedSession) ?? null

  const handleSelectSession = useCallback(
    (id: string) => {
      setSelectedSession(id)
    },
    []
  )

  const handleCreated = useCallback(
    (id: string) => {
      setSelectedSession(id)
    },
    []
  )

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
        <h1 className="text-sm font-semibold">Execution Console</h1>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setNewExecOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Command
        </Button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Session list */}
        <div className={cn(
          "border-b min-[1300px]:flex min-[1300px]:h-full min-[1300px]:w-80 min-[1300px]:flex-col min-[1300px]:shrink-0 min-[1300px]:border-b-0 min-[1300px]:border-r",
          selectedSession ? "hidden min-[1300px]:flex" : "flex flex-col flex-1",
        )}>
          <div className="px-3 py-2 border-b">
            <span className="text-xs font-medium text-muted-foreground">
              Sessions ({sessions.length})
            </span>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <PageLoading variant="spinner" message="Loading sessions..." />
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={<Terminal className="h-8 w-8" />}
                title="No sessions"
                description="Run a command to get started"
                className="py-10"
              />
            ) : (
              <div className="p-1.5 space-y-0.5">
                {sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={selectedSession === session.id}
                    onSelect={() => handleSelectSession(session.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Session detail */}
        <div className={cn(
          "min-w-0 flex-1 flex flex-col overflow-hidden min-[1300px]:h-full",
          !selectedSession ? "hidden min-[1300px]:flex" : "flex",
        )}>
          {selected ? (
            <>
              <div className="border-b px-4 py-4 shrink-0 min-[1300px]:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 px-2 text-muted-foreground"
                  onClick={() => setSelectedSession(null)}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back to sessions
                </Button>
              </div>
              <SessionDetail session={selected} />
            </>
          ) : (
            <EmptyState
              icon={<Terminal className="h-10 w-10" />}
              title="Select a session"
              description="Choose a session from the list to view its output"
            />
          )}
        </div>
      </div>

      <NewExecDialog
        open={newExecOpen}
        onOpenChange={setNewExecOpen}
        onCreated={handleCreated}
      />
    </div>
  )
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ExecSession
  selected: boolean
  onSelect: () => void
}) {
  const deleteMut = useDeleteSession()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const statusIcon =
    session.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    ) : session.status === "completed" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-red-500" />
    )

  return (
    <div
      onClick={onSelect}
      className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${
        selected ? "bg-accent" : "hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">{statusIcon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate">
            {session.command} {session.args?.join(" ")}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {session.runtimeMs < 1000
                ? `${session.runtimeMs}ms`
                : `${(session.runtimeMs / 1000).toFixed(1)}s`}
            </span>
            {session.exitCode != null && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className={`text-[10px] ${session.exitCode === 0 ? "text-muted-foreground" : "text-red-500"}`}>
                  exit {session.exitCode}
                </span>
              </>
            )}
          </div>
        </div>
        {session.status !== "running" && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive"
              title="Remove session"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMut.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove session"
        description="Remove this session? Output will be lost."
        confirmLabel="Remove"
        variant="destructive"
        isPending={deleteMut.isPending}
        onConfirm={() => {
          deleteMut.mutate(session.id, {
            onSuccess: () => {
              toast.success("Session removed")
              setConfirmDelete(false)
            },
            onError: (err) => {
              toast.error(err instanceof Error ? err.message : "Failed")
              setConfirmDelete(false)
            },
          })
        }}
      />
    </div>
  )
}

function SessionDetail({ session }: { session: ExecSession }) {
  const { data: logData } = useSessionLog(session.id)
  const killMut = useKillSession()
  const deleteMut = useDeleteSession()
  const writeMut = useWriteToSession()
  const [stdinInput, setStdinInput] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmKill, setConfirmKill] = useState(false)

  const handleSendInput = () => {
    if (!stdinInput.trim()) return
    writeMut.mutate({ id: session.id, data: stdinInput + "\n" })
    setStdinInput("")
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      <div className="flex items-start justify-between border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono font-medium whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {session.command} {session.args?.join(" ")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Session {session.id} &middot;{" "}
            {session.status === "running" ? "Running" : `Exit ${session.exitCode}`}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0 ml-2 pt-0.5">
          {session.status === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-destructive"
              onClick={() => setConfirmKill(true)}
              disabled={killMut.isPending}
            >
              <Square className="h-3 w-3" />
              Kill
            </Button>
          )}
          {session.status !== "running" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMut.isPending}
              title="Remove session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Remove session"
            description="Remove this session? Output will be lost."
            confirmLabel="Remove"
            variant="destructive"
            isPending={deleteMut.isPending}
            onConfirm={() => {
              deleteMut.mutate(session.id, {
                onSuccess: () => {
                  toast.success("Session removed")
                  setConfirmDelete(false)
                },
                onError: (err) => {
                  toast.error(err instanceof Error ? err.message : "Failed")
                  setConfirmDelete(false)
                },
              })
            }}
          />
          <ConfirmDialog
            open={confirmKill}
            onOpenChange={setConfirmKill}
            title="Kill session?"
            description="This will terminate the running process. Any unsaved work will be lost."
            confirmLabel="Kill"
            variant="destructive"
            isPending={killMut.isPending}
            onConfirm={async () => {
              try {
                await killMut.mutateAsync(session.id)
                toast.success("Session killed")
                setConfirmKill(false)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed")
                setConfirmKill(false)
              }
            }}
          />
        </div>
      </div>

      {/* Terminal output */}
      <div className="flex-1 bg-muted/30 overflow-y-auto min-h-0">
        <pre className="p-4 text-xs font-mono leading-5 whitespace-pre-wrap break-all text-foreground overflow-x-hidden">
          {logData?.log || session.tail || "Waiting for output..."}
        </pre>
      </div>

      {/* Stdin input */}
      {session.status === "running" && (
        <div className="flex items-center gap-2 border-t px-4 py-2">
          <Input
            placeholder="Send input to process..."
            className="font-mono text-sm h-8"
            value={stdinInput}
            onChange={(e) => setStdinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendInput()}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={handleSendInput}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* File changes */}
      {session.filesChanged && session.filesChanged.length > 0 && (
        <div className="border-t px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Files changed:
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {session.filesChanged.map((fc) => (
              <Badge
                key={fc.path}
                variant={
                  fc.action === "created"
                    ? "default"
                    : fc.action === "deleted"
                      ? "destructive"
                      : "secondary"
                }
                className="text-[10px]"
              >
                {fc.action}: {fc.path}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NewExecDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sessionId: string) => void
}) {
  const [command, setCommand] = useState("")
  const [background, setBackground] = useState(true)
  const execMut = useExecCommand()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!command.trim()) return

    const parts = command.trim().split(/\s+/)
    const cmd = parts[0]
    const args = parts.slice(1)

    try {
      const result = await execMut.mutateAsync({
        command: cmd,
        args,
        background,
        timeout: 300,
      })

      if ("sessionId" in result) {
        onCreated(result.sessionId)
        toast.success(`Command started (session: ${result.sessionId})`)
      } else {
        toast.success(`Command completed (exit: ${result.exitCode})`)
      }
      onOpenChange(false)
      setCommand("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run Command</DialogTitle>
          <DialogDescription>
            Execute a command in the sandboxed vault environment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Command</label>
            <textarea
              placeholder="python script.py"
              className="flex h-24 w-full resize-none overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="background"
              checked={background}
              onChange={(e) => setBackground(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="background" className="text-sm">
              Run in background
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!command.trim() || execMut.isPending}
            >
              {execMut.isPending ? "Starting..." : "Execute"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
