import { useMemo, useState } from "react"
import { AlertTriangle, Bot, Cpu, Download, Info, Loader2, Play, Square, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useModelsStatus,
  usePullModels,
  usePullOllamaModel,
  useDeleteOllamaModel,
  useOllamaRuntimeStatus,
  useInstallOllamaRuntime,
  useRestartOllamaRuntime,
  useStartOllamaRuntime,
  useStopOllamaRuntime,
} from "@/hooks/use-models"
import { useOllamaModelsStatus } from "@/hooks/use-agents"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { PageLoading } from "@/components/shared/page-loading"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { toast } from "sonner"

const MODEL_DESCRIPTIONS: Record<string, string> = {
  embeddinggemma: "Converts documents into vectors for semantic search",
  "qwen3-reranker": "Re-ranks search results by relevance to the query",
  "qmd-query-expansion": "Expands search queries for better recall",
  "qwen3-1.7b": "Generates answers from search results",
  lfm2: "Lightweight language model for text generation",
}

const LOCAL_AGENT_MODEL_PRESETS = [
  {
    id: "ollama/gemma4:e2b",
    label: "Gemma 4 E2B",
    description: "Fastest local worker for lightweight agent tasks.",
  },
  {
    id: "ollama/gemma4:e4b",
    label: "Gemma 4 E4B",
    description: "Balanced default for everyday local agent work.",
  },
  {
    id: "ollama/gemma4:26b",
    label: "Gemma 4 26B",
    description: "High-capability local model for ambitious agent tasks.",
  },
  {
    id: "ollama/gemma4:31b",
    label: "Gemma 4 31B",
    description: "Largest local Gemma option for workstation-class agents.",
  },
]

const LOCAL_MODEL_GUIDANCE: Record<
  string,
  {
    recommendation: string
    info: string
    warning?: string
  }
> = {
  "ollama/gemma4:e2b": {
    recommendation: "Recommended for 8 GB RAM Macs.",
    info: "Best fit when you want the lightest local model and need responsive basic tasks on constrained memory.",
    warning: "Expect lower quality on complex multi-step work.",
  },
  "ollama/gemma4:e4b": {
    recommendation: "Recommended default for 16 GB RAM Macs.",
    info: "Balanced choice for everyday local routing and specialist work without pushing memory too hard.",
  },
  "ollama/gemma4:26b": {
    recommendation: "Recommended for 32 GB RAM Macs.",
    info: "Use this when you want stronger local reasoning and can afford a heavier model in memory.",
    warning: "Heavier startup and slower response times than E4B.",
  },
  "ollama/gemma4:31b": {
    recommendation: "Only for workstation-class setups.",
    info: "Use on machines with substantial memory and a more specialized GPU setup.",
    warning: "Not recommended for typical MacBook configs. Expect pressure on RAM, thermal limits, and latency without stronger hardware.",
  },
}

type LocalCatalogEntry = {
  id: string
  label: string
  description: string
  installed: boolean
  sizeBytes?: number
  modifiedAt?: string
}

function getModelDescription(modelName: string): string | undefined {
  const lower = modelName.toLowerCase()
  for (const [key, desc] of Object.entries(MODEL_DESCRIPTIONS)) {
    if (lower.includes(key)) return desc
  }
  return undefined
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—"
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function ModelsPage() {
  const { data: workspaceModels, isLoading: workspaceModelsLoading } = useModelsStatus()
  const { data: ollamaRuntimeStatus, isLoading: ollamaRuntimeLoading } = useOllamaRuntimeStatus(true)
  const { data: ollamaModelsStatus, isLoading: ollamaLoading } = useOllamaModelsStatus(true)
  const pullWorkspaceModels = usePullModels()
  const installOllamaRuntimeMutation = useInstallOllamaRuntime()
  const startOllamaRuntimeMutation = useStartOllamaRuntime()
  const stopOllamaRuntimeMutation = useStopOllamaRuntime()
  const restartOllamaRuntimeMutation = useRestartOllamaRuntime()
  const pullOllamaModelMutation = usePullOllamaModel()
  const deleteOllamaModelMutation = useDeleteOllamaModel()
  const [activeLocalModel, setActiveLocalModel] = useState<string | null>(null)
  const [modelToDelete, setModelToDelete] = useState<string | null>(null)

  const modelsPulling = pullWorkspaceModels.isPending || !!workspaceModels?.pulling
  const runtimeBusy =
    installOllamaRuntimeMutation.isPending ||
    startOllamaRuntimeMutation.isPending ||
    stopOllamaRuntimeMutation.isPending ||
    restartOllamaRuntimeMutation.isPending
  const installedLocalModels = useMemo(
    () => new Set((ollamaModelsStatus?.models ?? []).map((entry) => entry.id)),
    [ollamaModelsStatus?.models],
  )

  const localCatalog = useMemo(() => {
    const discovered: LocalCatalogEntry[] = (ollamaModelsStatus?.models ?? []).map((entry) => ({
      id: entry.id,
      label: entry.name,
      description: "Installed in the local Ollama runtime.",
      installed: true,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
    }))
    const byId = new Map<string, LocalCatalogEntry>(discovered.map((entry) => [entry.id, entry]))
    for (const preset of LOCAL_AGENT_MODEL_PRESETS) {
      const existing = byId.get(preset.id)
      if (existing) {
        byId.set(preset.id, { ...existing, label: preset.label, description: preset.description })
      } else {
        byId.set(preset.id, { ...preset, installed: false })
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [ollamaModelsStatus?.models])

  const handlePullWorkspaceModels = async () => {
    try {
      await pullWorkspaceModels.mutateAsync(false)
      toast.success("Workspace models downloaded successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Model download failed")
    }
  }

  const handleInstallLocalModel = async (modelId: string) => {
    setActiveLocalModel(modelId)
    try {
      await pullOllamaModelMutation.mutateAsync(modelId)
      toast.success(`Installed ${modelId.replace(/^ollama\//i, "")}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to install local model")
    } finally {
      setActiveLocalModel(null)
    }
  }

  const handleInstallLocalRuntime = async () => {
    try {
      await installOllamaRuntimeMutation.mutateAsync()
      toast.success("Local runtime installed and started")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to install local runtime")
    }
  }

  const handleStartLocalRuntime = async () => {
    try {
      await startOllamaRuntimeMutation.mutateAsync()
      toast.success("Local runtime started")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start local runtime")
    }
  }

  const handleStopLocalRuntime = async () => {
    try {
      await stopOllamaRuntimeMutation.mutateAsync()
      toast.success("Local runtime stopped")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop local runtime")
    }
  }

  const handleRestartLocalRuntime = async () => {
    try {
      await restartOllamaRuntimeMutation.mutateAsync()
      toast.success("Local runtime restarted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restart local runtime")
    }
  }

  const handleDeleteLocalModel = (modelId: string) => {
    setModelToDelete(modelId)
  }

  const confirmDeleteLocalModel = async () => {
    if (!modelToDelete) return
    setActiveLocalModel(modelToDelete)
    try {
      await deleteOllamaModelMutation.mutateAsync(modelToDelete)
      toast.success(`Removed ${modelToDelete.replace(/^ollama\//i, "")}`)
      setModelToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove local model")
    } finally {
      setActiveLocalModel(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Models"
        description="Manage workspace, agent, and security models from one place."
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Workspace models</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Embedding, reranking, and generation models used by Vault search and AI features.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handlePullWorkspaceModels}
            disabled={modelsPulling}
          >
            {modelsPulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {modelsPulling ? "Downloading..." : "Pull models"}
          </Button>
        </div>

        {modelsPulling ? (
          <Card>
            <CardContent className="p-4 text-sm text-amber-700 dark:text-amber-400">
              Workspace model download in progress.
              {workspaceModels?.totalCount ? ` (${workspaceModels.downloadedCount ?? 0}/${workspaceModels.totalCount} ready)` : ""}
            </CardContent>
          </Card>
        ) : null}

        {workspaceModelsLoading && !workspaceModels ? (
          <PageLoading variant="spinner" message="Loading models..." />
        ) : !workspaceModels || workspaceModels.models.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No workspace model metadata available yet.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {workspaceModels.models.map((model) => (
              <Card key={model.model}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        <div className="text-sm font-medium truncate">{model.model}</div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-1">{model.path}</div>
                    </div>
                    <Badge variant="outline">{model.status}</Badge>
                  </div>
                  {getModelDescription(model.model) ? (
                    <div className="text-xs text-muted-foreground">{getModelDescription(model.model)}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">{model.size}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agent local models</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Ollama models used by local-first agents, including Gemma 4 variants.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="text-sm">
            <div className="font-medium text-blue-700 dark:text-blue-300">
              For most users, start with Gemma 4 E4B on a 16 GB Mac.
            </div>
            <div className="mt-1 text-xs leading-5 text-blue-700/80 dark:text-blue-300/80">
              Move down to E2B on tighter memory, or up to 26B only when you have enough RAM and want stronger local reasoning.
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <div className="font-medium text-amber-800 dark:text-amber-200">
              Local routing is still experimental.
            </div>
            <div className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">
              Running Gemma locally can use significant RAM and may slow the machine noticeably during routing or local answers.
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Local runtime</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {ollamaRuntimeStatus?.available
                    ? ollamaRuntimeStatus.source === "managed"
                      ? `Connected to ${ollamaRuntimeStatus.baseUrl}${ollamaRuntimeStatus.version ? ` · v${ollamaRuntimeStatus.version}` : ""}`
                      : `Connected to external runtime at ${ollamaRuntimeStatus.baseUrl}`
                    : ollamaRuntimeStatus?.installed
                      ? ollamaRuntimeStatus.running
                        ? ollamaRuntimeStatus.error || "Local runtime is starting."
                        : "Available locally, but currently stopped."
                      : ollamaRuntimeStatus?.error || "Install the local runtime to use agent-local models."}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">
                {ollamaRuntimeLoading || ollamaLoading
                  ? "Checking..."
                  : ollamaRuntimeStatus?.available
                    ? ollamaRuntimeStatus.source === "managed"
                      ? "Available"
                      : "External runtime"
                    : ollamaRuntimeStatus?.installed
                      ? ollamaRuntimeStatus.running
                        ? "Starting"
                        : "Stopped"
                      : "Unavailable"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ollamaRuntimeStatus?.installed ? (
                <>
                  {ollamaRuntimeStatus.available ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void handleStopLocalRuntime()}
                        disabled={runtimeBusy}
                      >
                        {stopOllamaRuntimeMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                        Stop
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void handleRestartLocalRuntime()}
                        disabled={runtimeBusy}
                      >
                        {restartOllamaRuntimeMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Cpu className="h-3.5 w-3.5" />
                        )}
                        Restart
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void handleStartLocalRuntime()}
                      disabled={runtimeBusy}
                    >
                      {startOllamaRuntimeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Start
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleInstallLocalRuntime()}
                    disabled={runtimeBusy || ollamaRuntimeStatus?.supported === false}
                  >
                    {installOllamaRuntimeMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Update runtime
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleInstallLocalRuntime()}
                  disabled={runtimeBusy || ollamaRuntimeStatus?.supported === false}
                >
                  {installOllamaRuntimeMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {ollamaRuntimeStatus?.source === "external" ? "Install app-managed runtime" : "Install local runtime"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {!ollamaRuntimeStatus?.supported ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              App-managed local runtime install is not supported on this platform yet.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {localCatalog.map((model) => {
            const installed = installedLocalModels.has(model.id)
            const busy = activeLocalModel === model.id
            const guidance = LOCAL_MODEL_GUIDANCE[model.id]
            return (
              <Card key={model.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    {model.label}
                  </CardTitle>
                  <CardDescription>{model.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{installed ? "Installed" : "Not installed"}</Badge>
                    <Badge variant="outline">{model.id.replace(/^ollama\//i, "")}</Badge>
                    {"sizeBytes" in model && model.sizeBytes ? (
                      <Badge variant="outline">{formatBytes(model.sizeBytes)}</Badge>
                    ) : null}
                  </div>
                  {guidance ? (
                    <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium text-foreground">{guidance.recommendation}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{guidance.info}</div>
                      {guidance.warning ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{guidance.warning}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {installed && ollamaModelsStatus?.modelsPath ? (
                    <div className="text-xs text-muted-foreground break-all">
                      {ollamaModelsStatus.modelsPath}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {installed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => handleDeleteLocalModel(model.id)}
                        disabled={busy || !ollamaModelsStatus?.available}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Remove
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void handleInstallLocalModel(model.id)}
                        disabled={busy || !ollamaModelsStatus?.available || !ollamaRuntimeStatus?.installed}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Download
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <ConfirmDialog
        open={modelToDelete !== null}
        onOpenChange={(open) => { if (!open) setModelToDelete(null) }}
        title="Remove model"
        description={`Remove ${modelToDelete?.replace(/^ollama\//i, "") ?? "this model"}? You can re-download it later.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={deleteOllamaModelMutation.isPending}
        onConfirm={() => void confirmDeleteLocalModel()}
      />
    </PageShell>
  )
}
