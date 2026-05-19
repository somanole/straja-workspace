import { useState, useEffect } from "react"
import {
  Loader2,
  AlertTriangle,
  Unplug,
  X,
  Plus,
  Check,
  Bot,
  KeyRound,
  Trash2,
  Zap,
  Shield,
  Code2,
  Briefcase,
  Search,
  Megaphone,
  Users,
  Headset,
  Target,
  ClipboardList,
  ExternalLink,
  MessageCircle,
  Send,
  RotateCw,
  Play,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  useAgentsStatus,
  useAgentConfig,
  useAgentRemove,
  useAgentTest,
  useAgentStart,
  useAgentStop,
  useAgentRestart,
  useAgentVaultAccessIssue,
  useAgentVaultAccessRevoke,
  useAgentUpstreamAuthUpdate,
  useAgentUpstreamAuthClear,
  useAgentOpenAIOAuthAuthorize,
  useAgentChannels,
  useAgentLogs,
  useAgentProfiles,
  useWhatsAppLogin,
  useWhatsAppLoginPoll,
  useTelegramConfig,
  useAgentChannelPolicy,
  useChannelPairingApprove,
  useChannelDisconnect,
  useChannelReset,
  useDetectOpenclawAgent,
  useOllamaModelsStatus,
  useStarterTeamCreate,
} from "@/hooks/use-agents"
import type {
  AgentConnection,
  AgentLatestUsage,
  AgentModelRoutingPolicy,
  AgentMemoryPromptInjectionMode,
  AgentProfileDefinition,
  AgentProfilesResponse,
  AgentProfileId,
  OllamaModelEntry,
  OllamaModelsStatus,
} from "@/lib/types"
import { toast } from "sonner"
import { useSearchParams } from "react-router"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { PageLoading } from "@/components/shared/page-loading"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { cn, statusBadgeClass } from "@/lib/utils"

function openOAuthWindow(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) {
    window.location.assign(url)
  }
}

function isDesktopWorkspaceAppClient(): boolean {
  return typeof navigator !== "undefined" && /StrajaWorkspaceApp/i.test(navigator.userAgent)
}

/** Shorten tool names for display (strip vault_ prefix, use last segment). */
function shortToolName(name: string): string {
  return name.replace(/^vault_/, "")
}

function getProfileTools(
  profilesData: AgentProfilesResponse | undefined,
  profile: AgentProfileId | undefined,
): string[] {
  if (!profile || !profilesData) return []
  return profilesData.profileTools[profile] ?? []
}

function getAllAvailableTools(profilesData: AgentProfilesResponse | undefined): string[] {
  if (!profilesData) return []
  if (Array.isArray(profilesData.allKnownTools) && profilesData.allKnownTools.length > 0) {
    return profilesData.allKnownTools
  }
  return Array.from(new Set(Object.values(profilesData.toolGroups).flat()))
}

function getProfileLabel(
  profilesData: AgentProfilesResponse | undefined,
  profile: AgentProfileId | undefined,
): string {
  if (!profile) return ""
  return profilesData?.profiles.find((entry) => entry.id === profile)?.label
    ?? profile.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

function getProfileIcon(profile: AgentProfileId | undefined) {
  switch (profile) {
    case "chief-of-staff":
      return Briefcase
    case "software-engineer":
      return Code2
    case "researcher":
      return Search
    case "marketing-expert":
      return Megaphone
    case "community-manager":
      return Users
    case "customer-service":
      return Headset
    case "sales-assistant":
      return Target
    case "operations-admin":
      return ClipboardList
    case "custom":
      return Shield
    default:
      return Bot
  }
}

function buildDefaultProfileName(profile: AgentProfileDefinition | undefined): string {
  return profile?.defaultName || profile?.label || "Straja Agent"
}

function slugifyAgentId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const STARTER_TEAM_PROFILES: AgentProfileId[] = [
  "chief-of-staff",
  "software-engineer",
  "researcher",
  "marketing-expert",
  "community-manager",
  "customer-service",
  "sales-assistant",
  "operations-admin",
]

const DEFAULT_MEMORY_PROMPT_INJECTION_MODE: AgentMemoryPromptInjectionMode = "always"
const HEAVY_LOCAL_MODEL_SIZE_BYTES = 14 * 1024 * 1024 * 1024
const CLOUD_MODEL_PRESET_OPTIONS = [
  { id: "openai-codex/gpt-5.4", label: "GPT-5.4", scope: "Cloud", note: "Premium cloud" },
  { id: "openai-codex/gpt-5.3-codex", label: "GPT-5.3 Codex", scope: "Cloud", note: "Fast cloud codex" },
  { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", scope: "Cloud", note: "Strong cloud backup" },
] as const
const DEFAULT_PRIMARY_MODEL = "openai-codex/gpt-5.4"
const LOCAL_FIRST_STARTER = {
  primary: "ollama/gemma4:e4b",
  fallbacks: ["openai-codex/gpt-5.4"],
}
const CLOUD_FIRST_STARTER = {
  primary: "openai-codex/gpt-5.4",
  fallbacks: ["ollama/gemma4:e4b"],
}
const DEFAULT_MODEL_POLICY: AgentModelRoutingPolicy = "hybrid"

const MODEL_POLICY_LABELS: Record<AgentModelRoutingPolicy, string> = {
  local_only: "Local only",
  cloud_only: "Cloud only",
  hybrid: "Hybrid",
}

function parseFallbackInput(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatFallbackInput(values: string[] | undefined): string {
  return (values ?? []).join(", ")
}

type ModelOption = {
  id: string
  label: string
  scope: string
  note?: string
}

function FallbackModelSelector({
  value,
  onChange,
  options,
  primaryModel,
  placeholder = "Select a fallback model",
}: {
  value: string
  onChange: (next: string) => void
  options: ModelOption[]
  primaryModel: string
  placeholder?: string
}) {
  const selectedFallbacks = parseFallbackInput(value)
  const normalizedPrimary = primaryModel.trim()
  const availableOptions = options.filter((option) => {
    if (option.id === normalizedPrimary) return false
    return !selectedFallbacks.includes(option.id)
  })

  const addFallback = (modelId: string) => {
    if (!modelId || modelId === "__none__") return
    const next = [...selectedFallbacks, modelId]
    onChange(formatFallbackInput(next))
  }

  const removeFallback = (modelId: string) => {
    const next = selectedFallbacks.filter((entry) => entry !== modelId)
    onChange(formatFallbackInput(next))
  }

  return (
    <div className="space-y-2">
      <Select value="__none__" onValueChange={addFallback}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{placeholder}</SelectItem>
          {availableOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label} · {option.scope}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedFallbacks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedFallbacks.map((modelId) => (
            <Badge key={modelId} variant="secondary" className="gap-1.5 pr-1 text-[10px] font-mono font-normal">
              <span>{modelId}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
                onClick={() => removeFallback(modelId)}
                aria-label={`Remove fallback model ${modelId}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">
          No fallback models selected.
        </div>
      )}
    </div>
  )
}

function parseListInput(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatListInput(values: string[] | undefined): string {
  return (values ?? []).join("\n")
}

function isLocalModelRef(modelRef: string | undefined): boolean {
  return typeof modelRef === "string" && modelRef.trim().toLowerCase().startsWith("ollama/")
}

function isInstalledLocalModelRef(installedLocalModels: Set<string>, modelRef: string | undefined): boolean {
  return typeof modelRef === "string" && installedLocalModels.has(modelRef.trim())
}

function formatCompactTokens(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return `${Math.round(value)}`
}

function formatCompactUsd(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value === 0) return "$0.00"
  if (value >= 0.01) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

function buildDiscoveredLocalOptions(status: OllamaModelsStatus | undefined) {
  if (!status?.available) return []
  return status.models.map((model) => ({
    id: model.id,
    label: model.name,
    scope: "Local",
    note: formatLocalModelNote(model),
  }))
}

function getPreferredLocalPrimary(options: ModelOption[]): string | null {
  if (options.some((option) => option.id === LOCAL_FIRST_STARTER.primary)) {
    return LOCAL_FIRST_STARTER.primary
  }
  return options[0]?.id ?? null
}

function getPreferredCloudPrimary(options: ModelOption[]): string | null {
  if (options.some((option) => option.id === CLOUD_FIRST_STARTER.primary)) {
    return CLOUD_FIRST_STARTER.primary
  }
  return options.find((option) => !isLocalModelRef(option.id))?.id ?? null
}

function formatBytesCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`
}

function isHeavyLocalModelName(name: string): boolean {
  return /:(?:2[4-9]|[3-9]\d)b$/i.test(name.trim())
}

function formatLocalModelNote(model: OllamaModelEntry): string {
  const parts: string[] = []
  if (typeof model.sizeBytes === "number" && Number.isFinite(model.sizeBytes)) {
    parts.push(formatBytesCompact(model.sizeBytes))
    if (model.sizeBytes >= HEAVY_LOCAL_MODEL_SIZE_BYTES) {
      parts.push("high-memory")
    }
  } else if (isHeavyLocalModelName(model.name)) {
    parts.push("high-memory")
  }
  parts.push("Discovered from local Ollama runtime")
  return parts.join(" · ")
}

function isPotentiallyHeavyLocalModel(
  modelRef: string | undefined,
  modelIndex: Map<string, OllamaModelEntry>,
): boolean {
  if (!isLocalModelRef(modelRef)) return false
  const normalizedRef = modelRef?.trim() ?? ""
  const model = modelIndex.get(normalizedRef)
  if (model && typeof model.sizeBytes === "number" && Number.isFinite(model.sizeBytes)) {
    return model.sizeBytes >= HEAVY_LOCAL_MODEL_SIZE_BYTES
  }
  const localName = normalizedRef.replace(/^ollama\//i, "")
  return isHeavyLocalModelName(localName)
}

function summarizeLatestUsage(latestUsage: AgentLatestUsage | undefined): string | null {
  if (!latestUsage) return null
  const parts = [
    `${latestUsage.local ? "Local" : "Cloud"} ${latestUsage.provider}/${latestUsage.model}`,
    `${formatCompactTokens(latestUsage.inputTokens)} in / ${formatCompactTokens(latestUsage.outputTokens)} out`,
  ]
  const cost = formatCompactUsd(latestUsage.estimatedCostUsd)
  if (cost) parts.push(cost)
  return parts.join(" · ")
}

const MEMORY_PROMPT_INJECTION_LABELS: Record<AgentMemoryPromptInjectionMode, string> = {
  off: "Off",
  new_sessions: "New sessions only",
  always: "Every prompt",
}

const CHANNEL_DM_POLICY_LABELS = {
  pairing: "Pairing only",
  allowlist: "Allowlist only",
  open: "Open",
  disabled: "Disabled",
} as const

type ChannelDmPolicy = keyof typeof CHANNEL_DM_POLICY_LABELS

type GatewayManagementTab = "providers" | "channels" | "logs" | "settings"

export function AgentsPage({ gatewayTabOverride }: { gatewayTabOverride?: GatewayManagementTab | null } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: agents, isLoading: agentsLoading } = useAgentsStatus()
  const { data: profilesData } = useAgentProfiles()

  useEffect(() => {
    const openaiStatus = searchParams.get("openai")
    if (openaiStatus === "connected") {
      toast.success("OpenAI connected successfully")
      setSearchParams({}, { replace: true })
      return
    }
    if (openaiStatus === "error") {
      toast.error(searchParams.get("message") || "OpenAI sign-in failed")
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  return (
    <PageShell className="max-w-6xl space-y-8">
      <PageHeader title="Agents" description="Manage the shared gateway first, then assign each agent a clear role, task boundary, and tool scope." />

      <section className="space-y-4">
        {agentsLoading ? (
          <PageLoading variant="spinner" message="Loading agents..." />
        ) : (
          <>
            <GatewayWorkspaceCard
              agents={agents?.agents ?? []}
              initialManagementTab={gatewayTabOverride ?? undefined}
              autoOpenManagement={Boolean(gatewayTabOverride)}
            />
            <div className="space-y-4">
              <StarterTeamCard existingAgents={agents?.agents ?? []} profilesData={profilesData} />
              <AddAgentCard existingAgents={agents?.agents ?? []} profilesData={profilesData} />
            </div>
          </>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agent Team</h2>
            <p className="text-sm text-muted-foreground">
              Select an agent from the team list to inspect its role, model stack, domains, and tool scope.
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            {(agents?.agents ?? []).length} agent{(agents?.agents ?? []).length === 1 ? "" : "s"}
          </Badge>
        </div>
        {agentsLoading ? null : (
          <AgentTeamExplorer agents={agents?.agents ?? []} profilesData={profilesData} />
        )}
      </section>
    </PageShell>
  )
}

export function ProvidersPage() {
  return <AgentsPage gatewayTabOverride="providers" />
}

export function ChannelsPage() {
  return <AgentsPage gatewayTabOverride="channels" />
}

function AgentTeamExplorer({
  agents,
  profilesData,
}: {
  agents: AgentConnection[]
  profilesData?: AgentProfilesResponse
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[0]?.id ?? null)

  useEffect(() => {
    if (!agents.length) {
      setSelectedAgentId(null)
      return
    }
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0]?.id ?? null)
    }
  }, [agents, selectedAgentId])

  if (!agents.length) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No agents configured yet.
        </CardContent>
      </Card>
    )
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="overflow-hidden xl:sticky xl:top-6 xl:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Team list</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agents.map((agent) => {
            const profileLabel = getProfileLabel(profilesData, agent.profile)
            const ProfileIcon = getProfileIcon(agent.profile)
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedAgentId(agent.id)}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  selectedAgent.id === agent.id
                    ? "border-foreground/20 bg-muted/40 shadow-sm"
                    : "border-border bg-background hover:bg-muted/20",
                )}
                aria-pressed={selectedAgent.id === agent.id}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg border bg-muted/20 p-2 text-muted-foreground">
                    <ProfileIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{agent.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {profileLabel ? (
                        <Badge variant="outline" className="max-w-full text-[10px]">
                          <span className="truncate">{profileLabel}</span>
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px]">
                        {MODEL_POLICY_LABELS[agent.modelPolicy ?? DEFAULT_MODEL_POLICY]}
                      </Badge>
                    </div>
                    {agent.model ? (
                      <div className="mt-2 truncate text-xs font-mono text-muted-foreground">
                        {agent.model}
                      </div>
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>

      <AgentDefinitionCard key={selectedAgent.id} agent={selectedAgent} profilesData={profilesData} />
    </div>
  )
}

function GatewayWorkspaceCard({
  agents,
  initialManagementTab,
  autoOpenManagement = false,
}: {
  agents: AgentConnection[]
  initialManagementTab?: GatewayManagementTab
  autoOpenManagement?: boolean
}) {
  const primaryAgent = agents.find((agent) => agent.type === "openclaw") ?? agents[0]
  const { data: detected } = useDetectOpenclawAgent(true)
  const testMut = useAgentTest()
  const startMut = useAgentStart()
  const stopMut = useAgentStop()
  const restartMut = useAgentRestart()
  const [managementOpen, setManagementOpen] = useState(false)
  const [managementTab, setManagementTab] = useState<GatewayManagementTab>(initialManagementTab ?? "providers")

  useEffect(() => {
    if (!initialManagementTab) {
      return
    }
    setManagementTab(initialManagementTab)
  }, [initialManagementTab])

  useEffect(() => {
    if (!autoOpenManagement || !primaryAgent) {
      return
    }
    setManagementTab(initialManagementTab ?? "providers")
    setManagementOpen(true)
  }, [autoOpenManagement, initialManagementTab, primaryAgent])

  const localPrimaryCount = agents.filter((agent) => isLocalModelRef(agent.model)).length
  const cloudPrimaryCount = agents.filter((agent) => agent.model && !isLocalModelRef(agent.model)).length
  if (!primaryAgent) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Agent Gateway
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Create a starter team or add your first agent to initialize the gateway workspace.
        </CardContent>
      </Card>
    )
  }

  const handleTest = async () => {
    try {
      const result = await testMut.mutateAsync(primaryAgent.id)
      if (result.ok) toast.success(result.message || "Gateway connection successful")
      else toast.error(result.message || "Gateway connection failed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gateway test failed")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Agent Gateway
          <Badge
            variant="outline"
            className={primaryAgent.running
              ? `text-[10px] ${statusBadgeClass("active")}`
              : "text-[10px] bg-muted text-muted-foreground"}
          >
            {primaryAgent.running ? "running" : "stopped"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Shared runtime controls, model coverage, and gateway wiring for the current workspace.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetricCard
            label="Gateway"
            value={detected?.gatewayUrl ?? primaryAgent.gatewayUrl}
            tone="code"
          />
          <SummaryMetricCard
            label="Team"
            value={`${agents.length} active`}
          />
          <SummaryMetricCard
            label="Primary Models"
            value={`${localPrimaryCount} local primary`}
            subvalue={`${cloudPrimaryCount} cloud primary`}
          />
          <SummaryMetricCard
            label="Hooks"
            value={primaryAgent.hooksPath}
            subvalue={detected?.configPath ?? "Config path not detected"}
            tone="code"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">Gateway runtime</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Start, stop, test, or restart the shared OpenClaw runtime without digging through individual agent cards.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleTest} disabled={testMut.isPending}>
                {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Test
              </Button>
              {!primaryAgent.running ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={startMut.isPending}
                  onClick={() => {
                    startMut.mutate(primaryAgent.id, {
                      onSuccess: () => toast.success("Gateway starting..."),
                      onError: (err) => toast.error(err instanceof Error ? err.message : "Start failed"),
                    })
                  }}
                >
                  {startMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Start
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={stopMut.isPending}
                    onClick={() => {
                      stopMut.mutate(primaryAgent.id, {
                        onSuccess: () => toast.success("Gateway stopped"),
                        onError: (err) => toast.error(err instanceof Error ? err.message : "Stop failed"),
                      })
                    }}
                  >
                    {stopMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                    Stop
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={restartMut.isPending}
                    onClick={() => {
                      restartMut.mutate(primaryAgent.id, {
                        onSuccess: () => toast.success("Gateway restarting..."),
                        onError: (err) => toast.error(err instanceof Error ? err.message : "Restart failed"),
                      })
                    }}
                  >
                    {restartMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                    Restart
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                <a
                  href={primaryAgent.gatewayToken
                    ? `${primaryAgent.gatewayUrl}#token=${encodeURIComponent(primaryAgent.gatewayToken)}`
                    : primaryAgent.gatewayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open gateway
                </a>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">Gateway settings</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Provider authentication, channels, logs, and runtime settings live here once for the whole gateway.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-1.5"
                onClick={() => {
                  setManagementTab("providers")
                  setManagementOpen(true)
                }}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Providers
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-1.5"
                onClick={() => {
                  setManagementTab("channels")
                  setManagementOpen(true)
                }}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Channels
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-1.5"
                onClick={() => {
                  setManagementTab("logs")
                  setManagementOpen(true)
                }}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Logs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-1.5"
                onClick={() => {
                  setManagementTab("settings")
                  setManagementOpen(true)
                }}
              >
                <Bot className="h-3.5 w-3.5" />
                Advanced settings
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      <Sheet open={managementOpen} onOpenChange={setManagementOpen}>
        <SheetContent side="right" className="w-[min(1120px,100vw)] gap-0 overflow-hidden border-l border-border/70 bg-background/98 p-0 sm:max-w-[1120px]">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <Zap className="h-5 w-5 text-muted-foreground" />
              Agent Gateway
            </SheetTitle>
            <SheetDescription>
              Shared provider auth, channels, memory, hooks, notifications, logs, and runtime settings for the current workspace.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <GatewayWorkspaceManager agent={primaryAgent} initialTab={managementTab} />
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function SummaryMetricCard({
  label,
  value,
  subvalue,
  tone,
}: {
  label: string
  value: string
  subvalue?: string
  tone?: "default" | "code"
}) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{label}</div>
      <div className={tone === "code" ? "mt-2 break-all font-mono text-xs" : "mt-2 text-base font-semibold"}>
        {value}
      </div>
      {subvalue ? (
        <div className="mt-1 text-xs text-muted-foreground break-all">{subvalue}</div>
      ) : null}
    </div>
  )
}

function GatewayWorkspaceManager({
  agent,
  initialTab = "providers",
}: {
  agent: AgentConnection
  initialTab?: GatewayManagementTab
}) {
  const configMut = useAgentConfig()
  const upstreamAuthUpdateMut = useAgentUpstreamAuthUpdate()
  const upstreamAuthClearMut = useAgentUpstreamAuthClear()
  const openAIOAuthAuthorizeMut = useAgentOpenAIOAuthAuthorize()
  const { data: channels } = useAgentChannels(agent.id)
  const { data: agentLogs, isLoading: agentLogsLoading, refetch: refetchAgentLogs } = useAgentLogs(agent.id, true)
  const whatsAppLoginMut = useWhatsAppLogin()
  const whatsAppPollMut = useWhatsAppLoginPoll()
  const telegramConfigMut = useTelegramConfig()
  const channelPolicyMut = useAgentChannelPolicy()
  const channelPairingApproveMut = useChannelPairingApprove()
  const channelDisconnectMut = useChannelDisconnect()
  const channelResetMut = useChannelReset()

  const [activeTab, setActiveTab] = useState<GatewayManagementTab>(initialTab)
  const [gatewayUrl, setGatewayUrl] = useState(agent.gatewayUrl)
  const [hooksPath, setHooksPath] = useState(agent.hooksPath)
  const [token, setToken] = useState("")
  const [gwToken, setGwToken] = useState("")
  const [enabled, setEnabled] = useState(agent.enabled)
  const [notifyGmail, setNotifyGmail] = useState(agent.notifications.gmail)
  const [notifyCalendar, setNotifyCalendar] = useState(agent.notifications.gcalendar)
  const [memoryPromptInjectionMode, setMemoryPromptInjectionMode] = useState<AgentMemoryPromptInjectionMode>(
    agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
  )
  const [claudeSecret, setClaudeSecret] = useState("")
  const [claudeMode, setClaudeMode] = useState<"api_key" | "token">("api_key")
  const [showOpenAiDetails, setShowOpenAiDetails] = useState(false)
  const [showClaudeDetails, setShowClaudeDetails] = useState(false)
  const [waQrUrl, setWaQrUrl] = useState<string | null>(null)
  const [waPolling, setWaPolling] = useState(false)
  const [tgTokenInput, setTgTokenInput] = useState("")
  const [tgPairingCode, setTgPairingCode] = useState("")
  const [tgPairingEditing, setTgPairingEditing] = useState(false)
  const [tgPairingOwner, setTgPairingOwner] = useState(true)
  const [waPairingCode, setWaPairingCode] = useState("")
  const [waPairingEditing, setWaPairingEditing] = useState(false)
  const [waPairingOwner, setWaPairingOwner] = useState(true)
  const [waDmPolicy, setWaDmPolicy] = useState<ChannelDmPolicy>("pairing")
  const [waAllowFromInput, setWaAllowFromInput] = useState("")
  const [tgDmPolicy, setTgDmPolicy] = useState<ChannelDmPolicy>("pairing")
  const [tgAllowFromInput, setTgAllowFromInput] = useState("")

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    setGatewayUrl(agent.gatewayUrl)
    setHooksPath(agent.hooksPath)
    setEnabled(agent.enabled)
    setNotifyGmail(agent.notifications.gmail)
    setNotifyCalendar(agent.notifications.gcalendar)
    setMemoryPromptInjectionMode(
      agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
    )
    setToken("")
    setGwToken("")
    setClaudeSecret("")
    setClaudeMode(agent.upstreamAuth?.anthropic.mode === "token" ? "token" : "api_key")
  }, [agent])

  useEffect(() => {
    setWaDmPolicy((channels?.whatsapp?.dmPolicy as ChannelDmPolicy | undefined) ?? "pairing")
    setWaAllowFromInput((channels?.whatsapp?.allowFrom ?? []).join(", "))
    setTgDmPolicy((channels?.telegram?.dmPolicy as ChannelDmPolicy | undefined) ?? "pairing")
    setTgAllowFromInput((channels?.telegram?.allowFrom ?? []).join(", "))
  }, [
    channels?.whatsapp?.dmPolicy,
    channels?.whatsapp?.allowFrom,
    channels?.telegram?.dmPolicy,
    channels?.telegram?.allowFrom,
  ])

  const openAiAuth = agent.upstreamAuth?.openai
  const claudeAuth = agent.upstreamAuth?.anthropic
  const whatsappCanPair = channels?.whatsapp?.status === "connected"
  const telegramCanPair = channels?.telegram?.status === "connected"
  const authMutationPending =
    upstreamAuthUpdateMut.isPending ||
    upstreamAuthClearMut.isPending ||
    openAIOAuthAuthorizeMut.isPending

  const handleSaveSettings = async () => {
    if (!gatewayUrl.trim()) {
      toast.error("Gateway URL is required")
      return
    }
    try {
      await configMut.mutateAsync({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        gatewayUrl: gatewayUrl.trim(),
        token: token || undefined,
        gatewayToken: gwToken || undefined,
        hooksPath: hooksPath.trim() || "/hooks/agent",
        enabled,
        notifications: { gmail: notifyGmail, gcalendar: notifyCalendar },
        profile: agent.profile || undefined,
        networkAllowlist: agent.networkAllowlist,
        customTools: agent.customTools,
        model: agent.model,
        modelFallbacks: agent.modelFallbacks,
        modelPolicy: agent.modelPolicy,
        memoryPromptInjectionMode,
        routingProfile: agent.routingProfile,
      })
      toast.success("Gateway settings saved")
      setToken("")
      setGwToken("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save gateway settings")
    }
  }

  const handleWhatsAppConnect = async () => {
    try {
      const result = await whatsAppLoginMut.mutateAsync(agent.id)
      if (result.status === "already_connected") {
        toast.success("WhatsApp already connected")
        return
      }
      if (result.status === "error") {
        toast.error(result.error || "Failed to start WhatsApp login")
        return
      }
      if (result.qrDataUrl) {
        setWaQrUrl(result.qrDataUrl)
        setWaPolling(true)
        const pollLoop = async () => {
          for (let i = 0; i < 20; i++) {
            try {
              const poll = await whatsAppPollMut.mutateAsync(agent.id)
              if (poll.status === "connected") {
                setWaQrUrl(null)
                setWaPolling(false)
                toast.success("WhatsApp connected!")
                return
              }
              if (poll.status === "timeout" || poll.status === "error") {
                setWaQrUrl(null)
                setWaPolling(false)
                if (poll.status === "error") toast.error(poll.error || "WhatsApp login failed")
                else toast.error("QR code expired, try again")
                return
              }
              await new Promise((resolve) => setTimeout(resolve, 3000))
            } catch {
              setWaQrUrl(null)
              setWaPolling(false)
              toast.error("WhatsApp login failed")
              return
            }
          }
          setWaQrUrl(null)
          setWaPolling(false)
          toast.error("QR code expired, try again")
        }
        void pollLoop()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start WhatsApp login")
    }
  }

  const handleTelegramConnect = async () => {
    if (!tgTokenInput.trim()) {
      toast.error("Enter a bot token from @BotFather")
      return
    }
    try {
      await telegramConfigMut.mutateAsync({ agentId: agent.id, botToken: tgTokenInput.trim() })
      toast.success("Telegram bot configured")
      setTgTokenInput("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to configure Telegram")
    }
  }

  const handleChannelPolicySave = async (
    channel: "whatsapp" | "telegram",
    dmPolicy: ChannelDmPolicy,
    allowFromInput: string,
  ) => {
    const allowFrom = allowFromInput
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    try {
      await channelPolicyMut.mutateAsync({
        agentId: agent.id,
        channel,
        dmPolicy,
        allowFrom,
      })
      toast.success(`${channel.charAt(0).toUpperCase() + channel.slice(1)} policy saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${channel} policy`)
    }
  }

  const handleChannelDisconnect = async (channel: string) => {
    try {
      await channelDisconnectMut.mutateAsync({ agentId: agent.id, channel })
      toast.success(`${channel.charAt(0).toUpperCase() + channel.slice(1)} disconnected`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to disconnect ${channel}`)
    }
  }

  const handleChannelReset = async (channel: string) => {
    try {
      const result = await channelResetMut.mutateAsync({ agentId: agent.id, channel })
      toast.success(
        result.restarted
          ? `${channel.charAt(0).toUpperCase() + channel.slice(1)} cleaned — gateway restarting`
          : `${channel.charAt(0).toUpperCase() + channel.slice(1)} cleaned — restart manually`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to reset ${channel}`)
    }
  }

  const handlePairingApprove = async (channel: "telegram" | "whatsapp") => {
    const rawCode = channel === "telegram" ? tgPairingCode : waPairingCode
    const code = rawCode.trim().toUpperCase()
    if (!code) {
      toast.error("Enter the pairing code from the bot message")
      return
    }
    try {
      const result = await channelPairingApproveMut.mutateAsync({
        agentId: agent.id,
        channel,
        code,
        owner: channel === "telegram" ? tgPairingOwner : waPairingOwner,
      })
      toast.success(
        result.approvedId
          ? `${channel.charAt(0).toUpperCase() + channel.slice(1)} paired: ${result.approvedId}`
          : `${channel.charAt(0).toUpperCase() + channel.slice(1)} pairing approved`,
      )
      if (channel === "telegram") {
        setTgPairingCode("")
        setTgPairingEditing(false)
        setTgPairingOwner(true)
      } else {
        setWaPairingCode("")
        setWaPairingEditing(false)
        setWaPairingOwner(true)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to approve ${channel} pairing code`)
    }
  }

  const handleSaveProviderAuth = async (
    provider: "anthropic" | "openai",
    mode: "api_key" | "token",
    secret: string,
  ) => {
    if (!secret.trim()) {
      toast.error(provider === "openai" ? "Enter an OpenAI API key" : "Enter a Claude credential")
      return
    }
    try {
      const result = await upstreamAuthUpdateMut.mutateAsync({
        agentId: agent.id,
        provider,
        mode,
        secret: secret.trim(),
      })
      if (provider === "anthropic") {
        setClaudeSecret("")
      }
      toast.success(
        result.configUpdated === false
          ? `${provider === "openai" ? "OpenAI" : "Claude"} auth saved in Vault. Gateway config was not updated automatically.`
          : `${provider === "openai" ? "OpenAI" : "Claude"} auth saved`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save provider auth")
    }
  }

  const handleClearProviderAuth = async (provider: "anthropic" | "openai") => {
    try {
      await upstreamAuthClearMut.mutateAsync({ agentId: agent.id, provider })
      if (provider === "anthropic") setClaudeSecret("")
      toast.success(`${provider === "openai" ? "OpenAI" : "Claude"} auth cleared`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear provider auth")
    }
  }

  const handleOpenAIConnect = async () => {
    try {
      const result = await openAIOAuthAuthorizeMut.mutateAsync({
        agentId: agent.id,
        desktopApp: isDesktopWorkspaceAppClient(),
      })
      openOAuthWindow(result.authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start OpenAI sign-in")
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GatewayManagementTab)} className="space-y-4">
      <TabsList variant="line">
        <TabsTrigger value="providers">Providers</TabsTrigger>
        <TabsTrigger value="channels">Channels</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="providers" className="space-y-4">
        <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          Provider authentication is shared at the gateway layer. Agents below only choose which models they want to run on.
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">OpenAI</div>
              <div className="text-[10px] text-muted-foreground">OAuth sign-in for cloud OpenAI models used by any agent.</div>
            </div>
            {openAiAuth?.configured ? (
              <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>Connected</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Not configured</Badge>
            )}
          </div>
          {openAiAuth?.profileId ? (
            <div className="text-[10px] text-muted-foreground">
              Profile: <span className="font-mono">{openAiAuth.profileId}</span>
              {openAiAuth.mode ? <span> · Mode: {openAiAuth.mode}</span> : null}
              {openAiAuth.expiresAt ? <span> · Expires: {new Date(openAiAuth.expiresAt).toLocaleString()}</span> : null}
            </div>
          ) : null}
          {openAiAuth?.configured && openAiAuth.preview ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setShowOpenAiDetails((value) => !value)}>
                {showOpenAiDetails ? "Hide details" : "Show details"}
              </Button>
              {showOpenAiDetails ? <span className="text-[10px] font-mono text-muted-foreground">{openAiAuth.preview}</span> : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={handleOpenAIConnect} disabled={authMutationPending}>
              {openAIOAuthAuthorizeMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {openAiAuth?.configured ? "Reconnect with OpenAI" : "Connect with OpenAI"}
            </Button>
            {openAiAuth?.configured ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleClearProviderAuth("openai")} disabled={authMutationPending}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Claude</div>
              <div className="text-[10px] text-muted-foreground">Shared Anthropic credentials for any agent that falls back to Claude.</div>
            </div>
            {claudeAuth?.configured ? (
              <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>Configured</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Not configured</Badge>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Credential type</label>
              <Select value={claudeMode} onValueChange={(value) => setClaudeMode(value as "api_key" | "token")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API key</SelectItem>
                  <SelectItem value="token">Setup token</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">{claudeMode === "token" ? "Claude setup token" : "Anthropic API key"}</label>
              <Input
                type="password"
                value={claudeSecret}
                onChange={(e) => setClaudeSecret(e.target.value)}
                placeholder={claudeMode === "token" ? "token-..." : "sk-ant-..."}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
          {claudeAuth?.profileId ? (
            <div className="text-[10px] text-muted-foreground">
              Profile: <span className="font-mono">{claudeAuth.profileId}</span>
              {claudeAuth.mode ? <span> · Mode: {claudeAuth.mode === "token" ? "setup token" : "api key"}</span> : null}
            </div>
          ) : null}
          {claudeAuth?.configured && claudeAuth.preview ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setShowClaudeDetails((value) => !value)}>
                {showClaudeDetails ? "Hide details" : "Show details"}
              </Button>
              {showClaudeDetails ? <span className="text-[10px] font-mono text-muted-foreground">{claudeAuth.preview}</span> : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveProviderAuth("anthropic", claudeMode, claudeSecret)} disabled={authMutationPending}>
              {upstreamAuthUpdateMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save Claude {claudeMode === "token" ? "token" : "key"}
            </Button>
            {claudeAuth?.configured ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleClearProviderAuth("anthropic")} disabled={authMutationPending}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="channels" className="space-y-4">
        <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          Channels are configured once at the gateway and shared by the agent team.
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </div>
              {channels?.whatsapp?.status === "connected" ? (
                <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                  {channels.whatsapp.phone || "Connected"}
                </Badge>
              ) : channels?.whatsapp?.status === "connecting" ? (
                <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("warning")}`}>Connecting</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Not connected</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleWhatsAppConnect} disabled={whatsAppLoginMut.isPending || waPolling}>
                {whatsAppLoginMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Connect
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setWaPairingEditing((value) => !value)} disabled={!whatsappCanPair}>
                Pair
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleChannelReset("whatsapp")} disabled={channelResetMut.isPending}>
                Reset
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleChannelDisconnect("whatsapp")} disabled={channelDisconnectMut.isPending}>
                Disconnect
              </Button>
            </div>
            {waQrUrl ? (
              <div className="flex flex-col items-center gap-2 rounded-md border bg-background p-3">
                <img src={waQrUrl} alt="WhatsApp QR Code" className="h-48 w-48 rounded" />
                <p className="text-[10px] text-muted-foreground">{waPolling ? "Waiting for scan..." : "Scan with WhatsApp to connect"}</p>
              </div>
            ) : null}
            {waPairingEditing && whatsappCanPair ? (
              <div className="space-y-2 rounded-md border bg-background p-3">
                <Input value={waPairingCode} onChange={(e) => setWaPairingCode(e.target.value)} placeholder="K3P2HL3G" className="h-8 text-xs font-mono uppercase" />
                <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={waPairingOwner} onChange={(e) => setWaPairingOwner(e.target.checked)} className="rounded" />
                  This paired number is an owner
                </label>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => void handlePairingApprove("whatsapp")} disabled={channelPairingApproveMut.isPending}>Approve</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setWaPairingEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            <div className="space-y-2 rounded-md border bg-background p-3">
              <div className="text-xs font-medium">Inbound policy</div>
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
                <Select value={waDmPolicy} onValueChange={(value) => setWaDmPolicy(value as ChannelDmPolicy)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pairing">Pairing only</SelectItem>
                    <SelectItem value="allowlist">Allowlist only</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={waAllowFromInput} onChange={(e) => setWaAllowFromInput(e.target.value)} placeholder="49123..., 1555..." className="h-8 text-xs" />
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => void handleChannelPolicySave("whatsapp", waDmPolicy, waAllowFromInput)} disabled={channelPolicyMut.isPending}>Save WhatsApp policy</Button>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Send className="h-3.5 w-3.5" />
                <span>Telegram</span>
              </div>
              {channels?.telegram?.status === "connected" ? (
                <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                  {channels.telegram.botUsername || "Connected"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Not connected</Badge>
              )}
            </div>
            <div className="space-y-2 rounded-md border bg-background p-3">
              <Input value={tgTokenInput} onChange={(e) => setTgTokenInput(e.target.value)} placeholder="Paste Telegram bot token" className="h-8 text-xs font-mono" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={handleTelegramConnect} disabled={telegramConfigMut.isPending}>Save token</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTgPairingEditing((value) => !value)} disabled={!telegramCanPair}>Pair</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleChannelReset("telegram")} disabled={channelResetMut.isPending}>Reset</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleChannelDisconnect("telegram")} disabled={channelDisconnectMut.isPending}>Disconnect</Button>
              </div>
            </div>
            {tgPairingEditing && telegramCanPair ? (
              <div className="space-y-2 rounded-md border bg-background p-3">
                <Input value={tgPairingCode} onChange={(e) => setTgPairingCode(e.target.value)} placeholder="AB12CD34" className="h-8 text-xs font-mono uppercase" />
                <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={tgPairingOwner} onChange={(e) => setTgPairingOwner(e.target.checked)} className="rounded" />
                  This paired chat is an owner
                </label>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => void handlePairingApprove("telegram")} disabled={channelPairingApproveMut.isPending}>Approve</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTgPairingEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            <div className="space-y-2 rounded-md border bg-background p-3">
              <div className="text-xs font-medium">Inbound policy</div>
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
                <Select value={tgDmPolicy} onValueChange={(value) => setTgDmPolicy(value as ChannelDmPolicy)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pairing">Pairing only</SelectItem>
                    <SelectItem value="allowlist">Allowlist only</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={tgAllowFromInput} onChange={(e) => setTgAllowFromInput(e.target.value)} placeholder="123456, @owner" className="h-8 text-xs" />
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => void handleChannelPolicySave("telegram", tgDmPolicy, tgAllowFromInput)} disabled={channelPolicyMut.isPending}>Save Telegram policy</Button>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="logs" className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Tail of the shared gateway logs.</p>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refetchAgentLogs()} disabled={agentLogsLoading}>
            {agentLogsLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
            Refresh
          </Button>
        </div>
        <div className="space-y-3">
          {(agentLogs?.logs ?? []).map((logFile) => (
            <div key={logFile.id} className="space-y-2 rounded-xl border bg-muted/20 p-3">
              <div>
                <div className="text-sm font-medium">{logFile.label}</div>
                <div className="break-all font-mono text-[10px] text-muted-foreground">{logFile.path ?? "No log path available"}</div>
              </div>
              <div className="rounded border bg-background">
                <pre className="max-h-72 overflow-auto p-3 text-[10px] leading-4 whitespace-pre-wrap break-words font-mono">
                  {logFile.content || "No log output yet."}
                </pre>
              </div>
            </div>
          ))}
          {!agentLogsLoading && (agentLogs?.logs?.length ?? 0) === 0 ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">No logs available for this gateway.</div>
          ) : null}
        </div>
      </TabsContent>

      <TabsContent value="settings" className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Gateway and hooks</div>
              <div className="mt-1 text-xs text-muted-foreground">The single runtime endpoint and hook path used by the workspace.</div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Gateway URL</label>
              <Input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Hooks path</label>
              <Input value={hooksPath} onChange={(e) => setHooksPath(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Hooks token (leave empty to keep current)</label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Gateway token (leave empty to keep current)</label>
              <Input type="password" value={gwToken} onChange={(e) => setGwToken(e.target.value)} className="h-8 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
              Gateway enabled
            </label>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Memory and notifications</div>
              <div className="mt-1 text-xs text-muted-foreground">Shared background behavior that affects how the gateway builds prompt context and notifies you.</div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Memory prompt injection</label>
              <Select value={memoryPromptInjectionMode} onValueChange={(value) => setMemoryPromptInjectionMode(value as AgentMemoryPromptInjectionMode)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_sessions">New sessions only</SelectItem>
                  <SelectItem value="always">Every prompt</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Notifications</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={notifyGmail} onChange={(e) => setNotifyGmail(e.target.checked)} className="rounded" />
                Gmail
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={notifyCalendar} onChange={(e) => setNotifyCalendar(e.target.checked)} className="rounded" />
                Calendar
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSaveSettings()} disabled={configMut.isPending}>
            {configMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save gateway settings
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function StarterTeamCard({
  existingAgents,
  profilesData,
}: {
  existingAgents: AgentConnection[]
  profilesData?: AgentProfilesResponse
}) {
  const starterTeamMut = useStarterTeamCreate()
  const { data: detected, isLoading: detecting } = useDetectOpenclawAgent(true)
  const [creating, setCreating] = useState(false)

  const starterProfiles = STARTER_TEAM_PROFILES
    .map((profileId) => profilesData?.profiles.find((entry) => entry.id === profileId))
    .filter((entry): entry is AgentProfileDefinition => !!entry)
  const hasAnyAgents = existingAgents.length > 0
  const missingProfiles = starterProfiles.filter((profileDef) => {
    const defaultId = slugifyAgentId(buildDefaultProfileName(profileDef))
    return !existingAgents.some(
      (agent) => agent.profile === profileDef.id || agent.id === defaultId,
    )
  })

  if (!profilesData || starterProfiles.length === 0) return null

  const handleCreateStarterTeam = async () => {
    if (!detected?.detected) {
      toast.error("No local OpenClaw instance was detected")
      return
    }
    if (hasAnyAgents) {
      toast.success("Starter team is already created for this workspace")
      return
    }
    setCreating(true)
    try {
      const result = await starterTeamMut.mutateAsync()
      if (result.alreadyCreated || result.createdIds.length === 0) {
        toast.success("Starter team is already created for this workspace")
      } else {
        toast.success(`Added ${result.createdIds.length} starter agent${result.createdIds.length === 1 ? "" : "s"}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create starter team")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Starter Team</span>
            <Badge variant="outline" className="text-[10px]">
              {existingAgents.length}/{STARTER_TEAM_PROFILES.length}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Create the full 8-agent workspace team with routing metadata and tool scopes.
          </p>
          {!hasAnyAgents && missingProfiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {missingProfiles.map((profileDef) => (
                <Badge key={profileDef.id} variant="secondary" className="text-[10px] font-normal">
                  {profileDef.label}
                </Badge>
              ))}
            </div>
          )}
          {detected?.detected === false && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              Local OpenClaw auto-detection is required before the starter team can be created.
            </p>
          )}
        </div>
        <Button
          onClick={handleCreateStarterTeam}
          disabled={creating || detecting || hasAnyAgents || !detected?.detected}
          className="shrink-0"
        >
          {creating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : hasAnyAgents ? (
            <>
              <Check className="h-4 w-4" />
              Team Created
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Create Starter Team
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

export function AgentCard({
  agent,
  profilesData,
}: {
  agent: AgentConnection
  profilesData?: AgentProfilesResponse
}) {
  const configMut = useAgentConfig()
  const removeMut = useAgentRemove()
  const testMut = useAgentTest()
  const startMut = useAgentStart()
  const stopMut = useAgentStop()
  const restartMut = useAgentRestart()
  const vaultAccessIssueMut = useAgentVaultAccessIssue()
  const vaultAccessRevokeMut = useAgentVaultAccessRevoke()
  const upstreamAuthUpdateMut = useAgentUpstreamAuthUpdate()
  const upstreamAuthClearMut = useAgentUpstreamAuthClear()
  const openAIOAuthAuthorizeMut = useAgentOpenAIOAuthAuthorize()
  const { data: channels } = useAgentChannels(agent.id)
  const whatsAppLoginMut = useWhatsAppLogin()
  const whatsAppPollMut = useWhatsAppLoginPoll()
  const telegramConfigMut = useTelegramConfig()
  const channelPolicyMut = useAgentChannelPolicy()
  const channelPairingApproveMut = useChannelPairingApprove()
  const channelDisconnectMut = useChannelDisconnect()
  const channelResetMut = useChannelReset()
  const { data: ollamaModelsStatus } = useOllamaModelsStatus(agent.type === "openclaw")

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(agent.name)
  const [type, setType] = useState(agent.type)
  const [gatewayUrl, setGatewayUrl] = useState(agent.gatewayUrl)
  const [hooksPath, setHooksPath] = useState(agent.hooksPath)
  const [token, setToken] = useState("")
  const [gwToken, setGwToken] = useState("")
  const [enabled, setEnabled] = useState(agent.enabled)
  const [notifyGmail, setNotifyGmail] = useState(agent.notifications.gmail)
  const [notifyCalendar, setNotifyCalendar] = useState(agent.notifications.gcalendar)
  const [memoryPromptInjectionMode, setMemoryPromptInjectionMode] = useState<AgentMemoryPromptInjectionMode>(
    agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
  )
  const [vaultToken, setVaultToken] = useState("")
  const [vaultTokenConfigUpdated, setVaultTokenConfigUpdated] = useState<boolean | null>(null)
  const [waQrUrl, setWaQrUrl] = useState<string | null>(null)
  const [waPolling, setWaPolling] = useState(false)
  const [tgTokenInput, setTgTokenInput] = useState("")
  const [tgEditing, setTgEditing] = useState(false)
  const [tgPairingCode, setTgPairingCode] = useState("")
  const [tgPairingEditing, setTgPairingEditing] = useState(false)
  const [tgPairingOwner, setTgPairingOwner] = useState(true)
  const [waPairingCode, setWaPairingCode] = useState("")
  const [waPairingEditing, setWaPairingEditing] = useState(false)
  const [waPairingOwner, setWaPairingOwner] = useState(true)
  const [waDmPolicy, setWaDmPolicy] = useState<ChannelDmPolicy>("pairing")
  const [waAllowFromInput, setWaAllowFromInput] = useState("")
  const [tgDmPolicy, setTgDmPolicy] = useState<ChannelDmPolicy>("pairing")
  const [tgAllowFromInput, setTgAllowFromInput] = useState("")
  const [claudeSecret, setClaudeSecret] = useState("")
  const [claudeMode, setClaudeMode] = useState<"api_key" | "token">("api_key")
  const [modelPrimary, setModelPrimary] = useState(agent.model || DEFAULT_PRIMARY_MODEL)
  const [modelFallbacksInput, setModelFallbacksInput] = useState(
    formatFallbackInput(agent.modelFallbacks),
  )
  const [modelPolicy, setModelPolicy] = useState<AgentModelRoutingPolicy>(
    agent.modelPolicy ?? DEFAULT_MODEL_POLICY,
  )
  const [acknowledgeHeavyLocalModelRisk, setAcknowledgeHeavyLocalModelRisk] = useState(false)
  const [showOpenAiDetails, setShowOpenAiDetails] = useState(false)
  const [showClaudeDetails, setShowClaudeDetails] = useState(false)
  const [networkAllowlistInput, setNetworkAllowlistInput] = useState(
    (agent.networkAllowlist ?? []).join(", "),
  )
  const [activeTab, setActiveTab] = useState("providers")
  const [managementOpen, setManagementOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmRevokeVault, setConfirmRevokeVault] = useState(false)
  const [channelToDisconnect, setChannelToDisconnect] = useState<string | null>(null)
  const { data: agentLogs, isLoading: agentLogsLoading, refetch: refetchAgentLogs } = useAgentLogs(
    agent.id,
    activeTab === "logs",
  )

  const isOpenclaw = agent.type === "openclaw"
  const discoveredLocalOptions = buildDiscoveredLocalOptions(ollamaModelsStatus)
  const localModelIndex = new Map(
    (ollamaModelsStatus?.models ?? []).map((model) => [model.id, model] as const),
  )
  const installedLocalModelIds = new Set(discoveredLocalOptions.map((option) => option.id))
  const modelPresetOptions = [
    ...discoveredLocalOptions,
    ...CLOUD_MODEL_PRESET_OPTIONS,
  ]
  const preferredLocalPrimary = getPreferredLocalPrimary(discoveredLocalOptions)
  const preferredCloudPrimary = getPreferredCloudPrimary(modelPresetOptions)
  const isLocalOnlyPolicy = modelPolicy === "local_only"
  const isCloudOnlyPolicy = modelPolicy === "cloud_only"
  const configuredFallbacks = parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== modelPrimary.trim())
  const heavyLocalSelections = [modelPrimary.trim(), ...configuredFallbacks]
    .filter((modelRef, index, all) => all.indexOf(modelRef) === index)
    .filter((modelRef) => isPotentiallyHeavyLocalModel(modelRef, localModelIndex))
  const requiresHeavyLocalModelAck = heavyLocalSelections.length > 0
  const localFirstStarterReady =
    isInstalledLocalModelRef(installedLocalModelIds, LOCAL_FIRST_STARTER.primary) &&
    LOCAL_FIRST_STARTER.fallbacks
      .filter((modelRef) => isLocalModelRef(modelRef))
      .every((modelRef) => isInstalledLocalModelRef(installedLocalModelIds, modelRef))
  const cloudFirstStarterFallbacks = CLOUD_FIRST_STARTER.fallbacks.filter(
    (modelRef) => !isLocalModelRef(modelRef) || isInstalledLocalModelRef(installedLocalModelIds, modelRef),
  )
  const profileTools = getProfileTools(profilesData, agent.profile)
  const profileLabel = getProfileLabel(profilesData, agent.profile)
  const profileDefinition = profilesData?.profiles.find((entry) => entry.id === agent.profile)
  const ProfileIcon = getProfileIcon(agent.profile)

  // Sync state when agent data changes
  useEffect(() => {
    setName(agent.name)
    setType(agent.type)
    setGatewayUrl(agent.gatewayUrl)
    setHooksPath(agent.hooksPath)
    setEnabled(agent.enabled)
    setNotifyGmail(agent.notifications.gmail)
    setNotifyCalendar(agent.notifications.gcalendar)
    setMemoryPromptInjectionMode(
      agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
    )
    setToken("")
    setVaultToken("")
    setVaultTokenConfigUpdated(null)
    setClaudeSecret("")
    setClaudeMode(agent.upstreamAuth?.anthropic.mode === "token" ? "token" : "api_key")
    setModelPrimary(agent.model || DEFAULT_PRIMARY_MODEL)
    setModelFallbacksInput(formatFallbackInput(agent.modelFallbacks))
    setModelPolicy(agent.modelPolicy ?? DEFAULT_MODEL_POLICY)
    setAcknowledgeHeavyLocalModelRisk(false)
    setShowOpenAiDetails(false)
    setShowClaudeDetails(false)
    setTgPairingCode("")
    setTgPairingEditing(false)
    setTgPairingOwner(true)
    setWaPairingCode("")
    setWaPairingEditing(false)
    setWaPairingOwner(true)
    setWaDmPolicy("pairing")
    setWaAllowFromInput("")
    setTgDmPolicy("pairing")
    setTgAllowFromInput("")
    setNetworkAllowlistInput((agent.networkAllowlist ?? []).join(", "))
  }, [agent])

  useEffect(() => {
    setAcknowledgeHeavyLocalModelRisk(false)
  }, [modelPrimary, modelFallbacksInput])

  useEffect(() => {
    if (!isLocalOnlyPolicy) return
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (!isLocalModelRef(modelPrimary) && preferredLocalPrimary) {
      setModelPrimary(preferredLocalPrimary)
    }
  }, [isLocalOnlyPolicy, modelFallbacksInput, modelPrimary, preferredLocalPrimary])

  useEffect(() => {
    if (!isCloudOnlyPolicy) return
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (isLocalModelRef(modelPrimary) && preferredCloudPrimary) {
      setModelPrimary(preferredCloudPrimary)
    }
  }, [isCloudOnlyPolicy, modelFallbacksInput, modelPrimary, preferredCloudPrimary])

  useEffect(() => {
    setWaDmPolicy((channels?.whatsapp?.dmPolicy as ChannelDmPolicy | undefined) ?? "pairing")
    setWaAllowFromInput((channels?.whatsapp?.allowFrom ?? []).join(", "))
    setTgDmPolicy((channels?.telegram?.dmPolicy as ChannelDmPolicy | undefined) ?? "pairing")
    setTgAllowFromInput((channels?.telegram?.allowFrom ?? []).join(", "))
  }, [
    channels?.whatsapp?.dmPolicy,
    channels?.whatsapp?.allowFrom,
    channels?.telegram?.dmPolicy,
    channels?.telegram?.allowFrom,
  ])

  const handleSave = async () => {
    if (!name.trim() || !gatewayUrl.trim()) {
      toast.error("Name and gateway URL are required")
      return
    }
    try {
      await configMut.mutateAsync({
        id: agent.id,
        name: name.trim(),
        type,
        gatewayUrl: gatewayUrl.trim(),
        token: token || undefined,
        gatewayToken: gwToken || undefined,
        hooksPath: hooksPath.trim() || "/hooks/agent",
        enabled,
        notifications: { gmail: notifyGmail, gcalendar: notifyCalendar },
        profile: agent.profile || undefined,
        networkAllowlist: agent.profile === "software-engineer" && networkAllowlistInput.trim()
          ? networkAllowlistInput.split(",").map((d) => d.trim()).filter(Boolean)
          : undefined,
        memoryPromptInjectionMode,
      })
      toast.success("Agent settings saved")
      setEditing(false)
      setActiveTab("providers")
      setToken("")
      setGwToken("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleTest = async () => {
    try {
      const result = await testMut.mutateAsync(agent.id)
      if (result.ok) {
        toast.success(result.message || "Connection successful")
      } else {
        toast.error(result.message || "Connection failed")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed")
    }
  }

  const handleRemove = () => {
    setConfirmRemove(true)
  }

  const confirmRemoveAction = async () => {
    try {
      await removeMut.mutateAsync(agent.id)
      toast.success("Agent removed")
      setConfirmRemove(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove")
    }
  }

  const handleIssueVaultAccess = async () => {
    try {
      const result = await vaultAccessIssueMut.mutateAsync(agent.id)
      setVaultToken(result.token)
      setVaultTokenConfigUpdated(result.configUpdated ?? false)
      toast.success(
        result.configUpdated === false
          ? (agent.vaultAccess ? "Vault token rotated. Update agent config manually." : "Vault access paired. Update agent config manually.")
          : (agent.vaultAccess ? "Vault token rotated and synced to the local agent config" : "Vault access paired and synced to the local agent config")
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue vault access token")
    }
  }

  const handleRevokeVaultAccess = () => {
    setConfirmRevokeVault(true)
  }

  const confirmRevokeVaultAction = async () => {
    try {
      await vaultAccessRevokeMut.mutateAsync(agent.id)
      setVaultToken("")
      setVaultTokenConfigUpdated(null)
      toast.success("Vault access revoked")
      setConfirmRevokeVault(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke vault access")
    }
  }

  const handleCopyVaultToken = async () => {
    if (!vaultToken) {
      return
    }
    try {
      await navigator.clipboard.writeText(vaultToken)
      toast.success("Vault token copied")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to copy token")
    }
  }

  const cancelEdit = () => {
    setEditing(false)
    setName(agent.name)
    setType(agent.type)
    setGatewayUrl(agent.gatewayUrl)
    setHooksPath(agent.hooksPath)
    setEnabled(agent.enabled)
    setNotifyGmail(agent.notifications.gmail)
    setNotifyCalendar(agent.notifications.gcalendar)
    setMemoryPromptInjectionMode(
      agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
    )
    setModelPrimary(agent.model || DEFAULT_PRIMARY_MODEL)
    setModelFallbacksInput(formatFallbackInput(agent.modelFallbacks))
    setModelPolicy(agent.modelPolicy ?? DEFAULT_MODEL_POLICY)
    setToken("")
    setGwToken("")
    setActiveTab("providers")
  }

  const handleWhatsAppConnect = async () => {
    try {
      const result = await whatsAppLoginMut.mutateAsync(agent.id)
      if (result.status === "already_connected") {
        toast.success("WhatsApp already connected")
        return
      }
      if (result.status === "error") {
        toast.error(result.error || "Failed to start WhatsApp login")
        return
      }
      if (result.qrDataUrl) {
        setWaQrUrl(result.qrDataUrl)
        setWaPolling(true)
        // Start polling for QR scan
        const pollLoop = async () => {
          for (let i = 0; i < 20; i++) {
            try {
              const poll = await whatsAppPollMut.mutateAsync(agent.id)
              if (poll.status === "connected") {
                setWaQrUrl(null)
                setWaPolling(false)
                toast.success("WhatsApp connected!")
                return
              }
              if (poll.status === "timeout" || poll.status === "error") {
                setWaQrUrl(null)
                setWaPolling(false)
                if (poll.status === "error") toast.error(poll.error || "WhatsApp login failed")
                else toast.error("QR code expired, try again")
                return
              }
              // waiting — continue polling
              await new Promise((r) => setTimeout(r, 3000))
            } catch {
              setWaQrUrl(null)
              setWaPolling(false)
              toast.error("WhatsApp login failed")
              return
            }
          }
          setWaQrUrl(null)
          setWaPolling(false)
          toast.error("QR code expired, try again")
        }
        pollLoop()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start WhatsApp login")
    }
  }

  const handleTelegramConnect = async () => {
    if (!tgTokenInput.trim()) {
      toast.error("Enter a bot token from @BotFather")
      return
    }
    try {
      await telegramConfigMut.mutateAsync({ agentId: agent.id, botToken: tgTokenInput.trim() })
      toast.success("Telegram bot configured")
      setTgTokenInput("")
      setTgEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to configure Telegram")
    }
  }

  const handleChannelPolicySave = async (
    channel: "whatsapp" | "telegram",
    dmPolicy: ChannelDmPolicy,
    allowFromInput: string,
  ) => {
    const allowFrom = allowFromInput
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    try {
      await channelPolicyMut.mutateAsync({
        agentId: agent.id,
        channel,
        dmPolicy,
        allowFrom,
      })
      toast.success(`${channel.charAt(0).toUpperCase() + channel.slice(1)} policy saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${channel} policy`)
    }
  }

  const handleChannelDisconnect = (channel: string) => {
    setChannelToDisconnect(channel)
  }

  const confirmChannelDisconnectAction = async () => {
    if (!channelToDisconnect) return
    try {
      await channelDisconnectMut.mutateAsync({ agentId: agent.id, channel: channelToDisconnect })
      toast.success(`${channelToDisconnect.charAt(0).toUpperCase() + channelToDisconnect.slice(1)} disconnected`)
      setChannelToDisconnect(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to disconnect ${channelToDisconnect}`)
    }
  }

  const handleChannelReset = async (channel: string) => {
    try {
      const result = await channelResetMut.mutateAsync({ agentId: agent.id, channel })
      toast.success(
        result.restarted
          ? `${channel.charAt(0).toUpperCase() + channel.slice(1)} cleaned — agent restarting`
          : `${channel.charAt(0).toUpperCase() + channel.slice(1)} cleaned — restart agent manually`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to reset ${channel}`)
    }
  }

  const handleSaveProviderAuth = async (
    provider: "anthropic" | "openai",
    mode: "api_key" | "token",
    secret: string
  ) => {
    if (!secret.trim()) {
      toast.error(provider === "openai" ? "Enter an OpenAI API key" : "Enter a Claude credential")
      return
    }

    try {
      const result = await upstreamAuthUpdateMut.mutateAsync({
        agentId: agent.id,
        provider,
        mode,
        secret: secret.trim(),
      })
      if (provider === "anthropic") {
        setClaudeSecret("")
        toast.success(
          result.configUpdated === false
            ? "Claude auth saved in Vault. OpenClaw config was not updated automatically."
            : "Claude auth saved"
        )
      } else {
        toast.success(
          result.configUpdated === false
            ? "OpenAI auth saved in Vault. OpenClaw config was not updated automatically."
            : "OpenAI auth saved"
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save provider auth")
    }
  }

  const handleClearProviderAuth = async (provider: "anthropic" | "openai") => {
    try {
      await upstreamAuthClearMut.mutateAsync({ agentId: agent.id, provider })
      if (provider === "anthropic") {
        setClaudeSecret("")
        toast.success("Claude auth cleared")
      } else {
        toast.success("OpenAI auth cleared")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear provider auth")
    }
  }

  const handleOpenAIConnect = async () => {
    try {
      const result = await openAIOAuthAuthorizeMut.mutateAsync({
        agentId: agent.id,
        desktopApp: isDesktopWorkspaceAppClient(),
      })
      openOAuthWindow(result.authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start OpenAI sign-in")
    }
  }

  const handleSaveModelStack = async () => {
    const primary = modelPrimary.trim()
    const fallbacks = (isLocalOnlyPolicy || isCloudOnlyPolicy)
      ? []
      : parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== primary)
    if (!primary) {
      toast.error("Enter a primary model")
      return
    }
    if (isLocalOnlyPolicy && !isLocalModelRef(primary)) {
      toast.error("Local only requires a local primary model")
      return
    }
    if (isCloudOnlyPolicy && isLocalModelRef(primary)) {
      toast.error("Cloud only requires a cloud primary model")
      return
    }
    const missingLocalModels = [primary, ...fallbacks].filter(
      (modelRef) => isLocalModelRef(modelRef) && !isInstalledLocalModelRef(installedLocalModelIds, modelRef),
    )
    if (missingLocalModels.length > 0) {
      toast.error(
        `Download local model${missingLocalModels.length === 1 ? "" : "s"} first: ${missingLocalModels.join(", ")}`,
      )
      return
    }
    if (requiresHeavyLocalModelAck && !acknowledgeHeavyLocalModelRisk) {
      toast.error("Acknowledge the high-memory local model warning before saving this model stack")
      return
    }
    try {
      await configMut.mutateAsync({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        gatewayUrl: agent.gatewayUrl,
        hooksPath: agent.hooksPath,
        enabled: agent.enabled,
        notifications: agent.notifications,
        profile: agent.profile || undefined,
        networkAllowlist: agent.networkAllowlist,
        customTools: agent.customTools,
        memoryPromptInjectionMode:
          agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
        model: primary,
        modelFallbacks: fallbacks,
        modelPolicy,
      })
      setModelFallbacksInput(formatFallbackInput(fallbacks))
      toast.success("Model stack saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save model stack")
    }
  }

  const handlePairingApprove = async (channel: "telegram" | "whatsapp") => {
    if (channel === "telegram" && channels?.telegram?.status !== "connected") {
      toast.error("Connect Telegram first, then pair.")
      return
    }
    if (channel === "whatsapp" && channels?.whatsapp?.status !== "connected") {
      toast.error("Connect WhatsApp first, then pair.")
      return
    }
    const rawCode = channel === "telegram" ? tgPairingCode : waPairingCode
    const code = rawCode.trim().toUpperCase()
    if (!code) {
      toast.error("Enter the pairing code from the bot message")
      return
    }
    try {
      const result = await channelPairingApproveMut.mutateAsync({
        agentId: agent.id,
        channel,
        code,
        owner: channel === "telegram" ? tgPairingOwner : waPairingOwner,
      })
      toast.success(
        result.approvedId
          ? `${channel.charAt(0).toUpperCase() + channel.slice(1)} paired: ${result.approvedId}`
          : `${channel.charAt(0).toUpperCase() + channel.slice(1)} pairing approved`
      )
      if (channel === "telegram") {
        setTgPairingCode("")
        setTgPairingEditing(false)
        setTgPairingOwner(true)
      } else {
        setWaPairingCode("")
        setWaPairingEditing(false)
        setWaPairingOwner(true)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to approve ${channel} pairing code`)
    }
  }

  const openAiAuth = agent.upstreamAuth?.openai
  const claudeAuth = agent.upstreamAuth?.anthropic
  const whatsappCanPair = channels?.whatsapp?.status === "connected"
  const telegramCanPair = channels?.telegram?.status === "connected"
  const authMutationPending =
    upstreamAuthUpdateMut.isPending ||
    upstreamAuthClearMut.isPending ||
    openAIOAuthAuthorizeMut.isPending

  const openManagement = (tab: "providers" | "channels" | "logs" | "settings" = "providers") => {
    setActiveTab(tab)
    if (tab === "settings") {
      setEditing(true)
    }
    setManagementOpen(true)
  }

  // Shared settings panel — used inside the Settings tab (openclaw) or standalone (other types)
  const settingsPanel = (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm h-8"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Type</label>
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openclaw">OpenClaw</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Gateway URL</label>
        <Input
          value={gatewayUrl}
          onChange={(e) => setGatewayUrl(e.target.value)}
          placeholder="http://localhost:18790"
          className="text-sm h-8"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Token {token ? "" : "(leave empty to keep current)"}
        </label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer token for hooks endpoint"
          className="text-sm h-8"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Gateway token {gwToken ? "" : "(leave empty to keep current)"}
        </label>
        <Input
          type="password"
          value={gwToken}
          onChange={(e) => setGwToken(e.target.value)}
          placeholder="OPENCLAW_GATEWAY_TOKEN (for channel management)"
          className="text-sm h-8"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Hooks path</label>
        <Input
          value={hooksPath}
          onChange={(e) => setHooksPath(e.target.value)}
          placeholder="/hooks/agent"
          className="text-sm h-8"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`enabled-${agent.id}`}
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded"
        />
        <label htmlFor={`enabled-${agent.id}`} className="text-sm">
          Enabled
        </label>
      </div>

      {isOpenclaw && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Memory prompt injection</label>
          <Select
            value={memoryPromptInjectionMode}
            onValueChange={(value) =>
              setMemoryPromptInjectionMode(value as AgentMemoryPromptInjectionMode)
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new_sessions">New sessions only</SelectItem>
              <SelectItem value="always">Every prompt</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Injects `_memory/MEMORY.md` plus the two latest daily memory notes into prompt context.
          </p>
        </div>
      )}

      <div className="space-y-2 pt-2">
        <span className="text-xs font-medium">Notifications</span>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`notify-gmail-${agent.id}`}
            checked={notifyGmail}
            onChange={(e) => setNotifyGmail(e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`notify-gmail-${agent.id}`} className="text-sm">
            New Gmail emails
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`notify-calendar-${agent.id}`}
            checked={notifyCalendar}
            onChange={(e) => setNotifyCalendar(e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`notify-calendar-${agent.id}`} className="text-sm">
            New calendar events
          </label>
        </div>
      </div>

      {/* Network allowlist — SE agents only */}
      {agent.profile === "software-engineer" && (
        <div className="space-y-1 pt-2 border-t">
          <label className="text-xs font-medium">Network allowlist</label>
          <p className="text-[10px] text-muted-foreground">
            Domains the agent can reach during repo execution (comma-separated). Default: github.com, api.github.com, registry.npmjs.org.
          </p>
          <Input
            value={networkAllowlistInput}
            onChange={(e) => setNetworkAllowlistInput(e.target.value)}
            placeholder="github.com, api.github.com, registry.npmjs.org"
            className="text-sm h-8 font-mono"
          />
        </div>
      )}

      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Vault access</span>
          {agent.vaultAccess?.enabled ? (
            <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
              Paired
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Not paired
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Pairing gives this agent a dedicated bearer token for vault-only routes that hold secrets.
        </p>
        {agent.vaultAccess?.enabled && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-4">
              <span>Token</span>
              <span className="font-mono">{agent.vaultAccess.tokenPreview}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Scopes</span>
              <span>{agent.vaultAccess.scopes.join(", ")}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Rotated</span>
              <span>{new Date(agent.vaultAccess.lastRotatedAt).toLocaleString()}</span>
            </div>
            {agent.vaultAccess.lastSeenAt && (
              <div className="flex items-center justify-between gap-4">
                <span>Last seen</span>
                <span>{new Date(agent.vaultAccess.lastSeenAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
        {vaultToken && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="text-xs font-medium">New vault token</div>
            <Input
              value={vaultToken}
              readOnly
              className="h-8 font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              {vaultTokenConfigUpdated
                ? "Vault already synced this token into the local Straja agent plugin config. It is shown only now for recovery."
                : <>Paste this into the Straja agent plugin as <code className="bg-muted px-0.5 rounded">authToken</code> or set <code className="bg-muted px-0.5 rounded">STRAJA_VAULT_TOKEN</code>. It is shown only now.</>}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleCopyVaultToken}
              >
                Copy token
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setVaultToken("")}
              >
                Hide
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleIssueVaultAccess}
            disabled={vaultAccessIssueMut.isPending}
          >
            {vaultAccessIssueMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : null}
            {agent.vaultAccess?.enabled ? "Rotate token" : "Pair vault access"}
          </Button>
          {agent.vaultAccess?.enabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleRevokeVaultAccess}
              disabled={vaultAccessRevokeMut.isPending}
            >
              Revoke
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={configMut.isPending}
        >
          {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={cancelEdit}
        >
          Cancel
        </Button>
      </div>
    </div>
  )

  const routingPurpose = agent.routingProfile?.purpose ?? profileDefinition?.routingProfile?.purpose
  const primaryDomains = agent.routingProfile?.primaryDomains ?? profileDefinition?.routingProfile?.primaryDomains ?? []
  const preferredTaskTypes = agent.routingProfile?.preferredTaskTypes ?? profileDefinition?.routingProfile?.preferredTaskTypes ?? []
  const forbiddenTaskTypes = agent.routingProfile?.forbiddenTaskTypes ?? profileDefinition?.routingProfile?.forbiddenTaskTypes ?? []
  const toolFamilies = agent.routingProfile?.toolFamiliesAvailable ?? profileDefinition?.routingProfile?.toolFamiliesAvailable ?? []
  const exampleTasks = agent.routingProfile?.shortExamples ?? profileDefinition?.routingProfile?.shortExamples ?? []
  const visibleProfileTools = profileTools.slice(0, 8)

  const managementCard = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="h-4 w-4" />
          {agent.name}
          <Badge variant="outline" className="text-[10px]">{agent.type}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {agent.enabled ? (
              <Badge variant="outline" className="text-[10px]">
                Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Disabled
              </Badge>
            )}
            {agent.running ? (
              <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                Running
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                Stopped
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compact status summary */}
        <div className="space-y-1">
          <div className="flex items-center gap-x-2 gap-y-0.5 text-xs flex-wrap">
            <span className="font-mono text-muted-foreground truncate">{agent.gatewayUrl}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {[agent.notifications.gmail && "Gmail", agent.notifications.gcalendar && "Calendar"].filter(Boolean).join(", ") || "No notifications"}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {agent.vaultAccess?.enabled
                ? `Vault (${agent.vaultAccess.tokenPreview})`
                : "Vault not paired"}
            </span>
            {agent.type === "openclaw" && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Memory: {MEMORY_PROMPT_INJECTION_LABELS[
                    agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE
                  ]}
                </span>
              </>
            )}
            {agent.model && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Model: <span className="font-mono">{agent.model}</span>
                  {agent.modelFallbacks?.length ? ` +${agent.modelFallbacks.length} fallback${agent.modelFallbacks.length === 1 ? "" : "s"}` : ""}
                </span>
              </>
            )}
            {agent.modelPolicy && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Policy: {MODEL_POLICY_LABELS[agent.modelPolicy]}
                </span>
              </>
            )}
          </div>
          {agent.latestUsage && (
            <div className="text-[10px] text-muted-foreground">
              Latest run: {summarizeLatestUsage(agent.latestUsage)}
            </div>
          )}
          {(agent.lastNotified || agent.vaultAccess?.lastSeenAt) ? (
            <div className="text-[10px] text-muted-foreground">
              {agent.lastNotified && (
                <span>Notified {new Date(agent.lastNotified).toLocaleString()}</span>
              )}
              {agent.lastNotified && agent.vaultAccess?.lastSeenAt && (
                <span> · </span>
              )}
              {agent.vaultAccess?.lastSeenAt && (
                <span>Vault seen {new Date(agent.vaultAccess.lastSeenAt).toLocaleString()}</span>
              )}
              <span> · </span>
              <span>{agent.running ? "Gateway running" : "Gateway stopped"}</span>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              {agent.running ? "Gateway running" : "Gateway stopped"}
            </div>
          )}
        </div>

        {/* Profile & tool groups */}
        {agent.profile && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ProfileIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">
                {profileLabel}
              </span>
            </div>
            {(agent.routingProfile?.purpose || profileDefinition?.routingProfile?.purpose) && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {agent.routingProfile?.purpose ?? profileDefinition?.routingProfile?.purpose}
              </p>
            )}
            {!!(agent.routingProfile?.primaryDomains?.length || profileDefinition?.routingProfile?.primaryDomains?.length) && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Domains:</span>
                {(agent.routingProfile?.primaryDomains ?? profileDefinition?.routingProfile?.primaryDomains ?? []).map((domain) => (
                  <Badge key={domain} variant="outline" className="text-[10px] font-normal">
                    {domain}
                  </Badge>
                ))}
              </div>
            )}
            {profileTools.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Tools:</span>
                {profileTools.map((tool) => (
                  <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono font-normal cursor-default"
                      >
                        {shortToolName(tool)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-mono text-[10px]">{tool}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
            {agent.profile === "software-engineer" && agent.networkAllowlist && agent.networkAllowlist.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Network:</span>
                {agent.networkAllowlist.map((domain) => (
                  <Badge key={domain} variant="outline" className="text-[10px] font-mono font-normal">
                    {domain}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {agent.lastError && (
          <div className="flex items-start gap-3 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <span className="text-xs text-destructive">{agent.lastError}</span>
          </div>
        )}

        {/* Action bar — primary actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleTest}
            disabled={testMut.isPending}
          >
            {testMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {testMut.isPending ? "Testing..." : "Test"}
          </Button>
          {agent.enabled && !agent.running && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={startMut.isPending}
              onClick={() => {
                startMut.mutate(agent.id, {
                  onSuccess: (result) => {
                    if (result.alreadyRunning) {
                      toast.success("Agent gateway is already running")
                      return
                    }
                    if (result.pending) {
                      toast.success("Agent gateway is starting in the background...")
                      return
                    }
                    toast.success("Agent gateway starting...")
                  },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Start failed"),
                })
              }}
            >
              {startMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {startMut.isPending ? "Starting..." : "Start"}
            </Button>
          )}
          {agent.enabled && agent.running && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={stopMut.isPending}
              onClick={() => {
                stopMut.mutate(agent.id, {
                  onSuccess: (result) => {
                    if (result.alreadyStopped) {
                      toast.success("Agent gateway is already stopped")
                      return
                    }
                    toast.success("Agent gateway stopped")
                  },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Stop failed"),
                })
              }}
            >
              {stopMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {stopMut.isPending ? "Stopping..." : "Stop"}
            </Button>
          )}
          {agent.enabled && agent.running && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={restartMut.isPending}
              onClick={() => {
                restartMut.mutate(agent.id, {
                  onSuccess: () => toast.success("Agent restarting..."),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Restart failed"),
                })
              }}
            >
              {restartMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="h-3.5 w-3.5" />
              )}
              {restartMut.isPending ? "Restarting..." : "Restart"}
            </Button>
          )}
          {agent.enabled && agent.running && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              asChild
            >
              <a
                href={agent.gatewayToken
                  ? `${agent.gatewayUrl}#token=${encodeURIComponent(agent.gatewayToken)}`
                  : agent.gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          )}
          {!isOpenclaw && !editing && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing(true)}
            >
              Settings
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive ml-auto"
            onClick={handleRemove}
            disabled={removeMut.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>

        {/* Tabs — openclaw agents */}
        {isOpenclaw && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              if (activeTab === "settings" && v !== "settings") {
                cancelEdit()
              }
              if (v === "settings") {
                setEditing(true)
              }
              setActiveTab(v)
            }}
          >
            <TabsList variant="line">
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="channels">Channels</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            {/* Channels tab */}
            <TabsContent value="channels">
              <div className="space-y-2 pt-2">
                {/* WhatsApp */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>WhatsApp</span>
                  </div>
                  {channels?.whatsapp?.status === "connected" ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                        {channels.whatsapp.phone || "Connected"}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setWaPairingEditing((value) => !value)}
                        disabled={!whatsappCanPair}
                      >
                        Pair
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                        onClick={() => handleChannelDisconnect("whatsapp")}
                        disabled={channelDisconnectMut.isPending}
                      >
                        {channelDisconnectMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Unplug className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ) : channels?.whatsapp?.status === "connecting" ? (
                    <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("warning")}`}>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Connecting
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {(channels?.whatsapp?.status === "disconnected" || channels?.whatsapp?.status === "error") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-muted-foreground"
                          onClick={() => handleChannelReset("whatsapp")}
                          disabled={channelResetMut.isPending}
                        >
                          {channelResetMut.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RotateCw className="h-3 w-3 mr-1" />
                          )}
                          Reset
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={handleWhatsAppConnect}
                        disabled={whatsAppLoginMut.isPending || waPolling}
                      >
                        {whatsAppLoginMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Connect
                      </Button>
                      {channels?.whatsapp?.status !== "not_configured" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setWaPairingEditing((value) => !value)}
                          disabled={!whatsappCanPair}
                          title={whatsappCanPair ? undefined : "Connect WhatsApp first"}
                        >
                          Pair
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* WhatsApp QR Code */}
                {waQrUrl && (
                  <div className="flex flex-col items-center gap-2 p-3 rounded-md border bg-muted/40">
                    <img
                      src={waQrUrl}
                      alt="WhatsApp QR Code"
                      className="w-48 h-48 rounded"
                    />
                    <p className="text-[10px] text-muted-foreground text-center">
                      Scan with WhatsApp to connect
                    </p>
                    {waPolling && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Waiting for scan...
                      </div>
                    )}
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400" />
                      <p className="text-[10px] text-amber-800 dark:text-amber-300">
                        Known issue: if QR scanning gets stuck, restart the agent. After restart,
                        WhatsApp should appear connected.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => {
                        setWaQrUrl(null)
                        setWaPolling(false)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {waPairingEditing && whatsappCanPair && (
                  <div className="space-y-2 p-3 rounded-md border bg-muted/40">
                    <p className="text-[10px] text-muted-foreground">
                      Paste the pairing code received in WhatsApp and approve it.
                    </p>
                    <Input
                      value={waPairingCode}
                      onChange={(e) => setWaPairingCode(e.target.value)}
                      placeholder="K3P2HL3G"
                      className="text-xs h-7 font-mono uppercase"
                    />
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={waPairingOwner}
                        onChange={(e) => setWaPairingOwner(e.target.checked)}
                        className="rounded"
                      />
                      This paired WhatsApp number is an owner
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => void handlePairingApprove("whatsapp")}
                        disabled={channelPairingApproveMut.isPending}
                      >
                        {channelPairingApproveMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Approve code
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          setWaPairingEditing(false)
                          setWaPairingCode("")
                          setWaPairingOwner(true)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2 p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium">Inbound policy</div>
                      <div className="text-[10px] text-muted-foreground">
                        Control who can DM this agent on WhatsApp.
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {CHANNEL_DM_POLICY_LABELS[waDmPolicy]}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">DM policy</label>
                      <Select value={waDmPolicy} onValueChange={(value) => setWaDmPolicy(value as ChannelDmPolicy)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CHANNEL_DM_POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">allowFrom</label>
                      <Input
                        value={waAllowFromInput}
                        onChange={(e) => setWaAllowFromInput(e.target.value)}
                        placeholder="+49123456789, +40712345678"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Use comma-separated E.164 numbers. For <span className="font-mono">open</span>, Straja automatically includes <span className="font-mono">*</span>.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={() => void handleChannelPolicySave("whatsapp", waDmPolicy, waAllowFromInput)}
                      disabled={channelPolicyMut.isPending}
                    >
                      {channelPolicyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save policy
                    </Button>
                  </div>
                </div>

                {/* WhatsApp status / error */}
                {channels?.whatsapp?.status === "error" && channels.whatsapp.error && (
                  channels.whatsapp.error.toLowerCase().includes("not linked") ? (
                    <p className="text-[10px] text-muted-foreground ml-5.5">{channels.whatsapp.error}</p>
                  ) : (
                    <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                      <span className="text-[10px] text-destructive">{channels.whatsapp.error}</span>
                    </div>
                  )
                )}

                {/* Telegram */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Send className="h-3.5 w-3.5" />
                    <span>Telegram</span>
                  </div>
                  {channels?.telegram?.status === "connected" ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                        {channels.telegram.botUsername ? `@${channels.telegram.botUsername}` : "Connected"}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setTgPairingEditing((value) => !value)}
                        disabled={!telegramCanPair}
                      >
                        Pair
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                        onClick={() => handleChannelDisconnect("telegram")}
                        disabled={channelDisconnectMut.isPending}
                      >
                        {channelDisconnectMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Unplug className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ) : !tgEditing ? (
                    <div className="flex items-center gap-1.5">
                      {(channels?.telegram?.status === "disconnected" || channels?.telegram?.status === "error") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-muted-foreground"
                          onClick={() => handleChannelReset("telegram")}
                          disabled={channelResetMut.isPending}
                        >
                          {channelResetMut.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RotateCw className="h-3 w-3 mr-1" />
                          )}
                          Reset
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setTgEditing(true)}
                      >
                        Connect
                      </Button>
                      {channels?.telegram?.status !== "not_configured" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setTgPairingEditing((value) => !value)}
                          disabled={!telegramCanPair}
                          title={telegramCanPair ? undefined : "Connect Telegram first"}
                        >
                          Pair
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Telegram token input */}
                {tgEditing && channels?.telegram?.status !== "connected" && (
                  <div className="space-y-2 p-3 rounded-md border bg-muted/40">
                    <p className="text-[10px] text-muted-foreground">
                      Get a bot token from{" "}
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        @BotFather
                      </a>{" "}
                      on Telegram
                    </p>
                    <Input
                      value={tgTokenInput}
                      onChange={(e) => setTgTokenInput(e.target.value)}
                      placeholder="123456:ABC-DEF..."
                      className="text-xs h-7 font-mono"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={handleTelegramConnect}
                        disabled={telegramConfigMut.isPending}
                      >
                        {telegramConfigMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          setTgEditing(false)
                          setTgTokenInput("")
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {tgPairingEditing && telegramCanPair && (
                  <div className="space-y-2 p-3 rounded-md border bg-muted/40">
                    <p className="text-[10px] text-muted-foreground">
                      Paste the pairing code received in Telegram and approve it.
                    </p>
                    <Input
                      value={tgPairingCode}
                      onChange={(e) => setTgPairingCode(e.target.value)}
                      placeholder="K3P2HL3G"
                      className="text-xs h-7 font-mono uppercase"
                    />
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={tgPairingOwner}
                        onChange={(e) => setTgPairingOwner(e.target.checked)}
                        className="rounded"
                      />
                      This paired Telegram user is an owner
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => void handlePairingApprove("telegram")}
                        disabled={channelPairingApproveMut.isPending}
                      >
                        {channelPairingApproveMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Approve code
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          setTgPairingEditing(false)
                          setTgPairingCode("")
                          setTgPairingOwner(true)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2 p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium">Inbound policy</div>
                      <div className="text-[10px] text-muted-foreground">
                        Control who can DM this agent on Telegram.
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {CHANNEL_DM_POLICY_LABELS[tgDmPolicy]}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">DM policy</label>
                      <Select value={tgDmPolicy} onValueChange={(value) => setTgDmPolicy(value as ChannelDmPolicy)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CHANNEL_DM_POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">allowFrom</label>
                      <Input
                        value={tgAllowFromInput}
                        onChange={(e) => setTgAllowFromInput(e.target.value)}
                        placeholder="123456789, 987654321"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Use numeric Telegram user IDs. For <span className="font-mono">open</span>, Straja automatically includes <span className="font-mono">*</span>.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={() => void handleChannelPolicySave("telegram", tgDmPolicy, tgAllowFromInput)}
                      disabled={channelPolicyMut.isPending}
                    >
                      {channelPolicyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save policy
                    </Button>
                  </div>
                </div>

                {/* Telegram error */}
                {channels?.telegram?.status === "error" && channels.telegram.error && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                    <span className="text-[10px] text-destructive">{channels.telegram.error}</span>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Providers tab */}
            <TabsContent value="providers">
              <div className="space-y-3 pt-2">
                <p className="text-[10px] text-muted-foreground">
                  Configure each agent&apos;s model stack first, then connect cloud providers only where needed.
                </p>

                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Model stack</div>
                      <div className="text-[10px] text-muted-foreground">
                        Primary model, execution policy, and ordered fallbacks.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isLocalModelRef(modelPrimary) ? "default" : "outline"} className="text-[10px]">
                        {isLocalModelRef(modelPrimary) ? "Local primary" : "Cloud primary"}
                      </Badge>
                      {configuredFallbacks.length > 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          {configuredFallbacks.length} fallback{configuredFallbacks.length === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Execution policy</label>
                      <Select
                        value={modelPolicy}
                        onValueChange={(value) => setModelPolicy(value as AgentModelRoutingPolicy)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MODEL_POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Local only uses one local primary. Cloud only uses one cloud primary. Hybrid follows your configured primary and fallback order.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Latest run</label>
                      <div className="rounded-md border bg-background px-3 py-2 text-xs">
                        {agent.latestUsage ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={agent.latestUsage.local ? "default" : "outline"} className="text-[10px]">
                                {agent.latestUsage.local ? "Local" : "Cloud"}
                              </Badge>
                              <span className="font-mono text-[11px]">
                                {agent.latestUsage.provider}/{agent.latestUsage.model}
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatCompactTokens(agent.latestUsage.inputTokens)} in / {formatCompactTokens(agent.latestUsage.outputTokens)} out
                              {formatCompactUsd(agent.latestUsage.estimatedCostUsd) ? ` · ${formatCompactUsd(agent.latestUsage.estimatedCostUsd)}` : ""}
                              {agent.latestUsage.usedAt ? ` · ${new Date(agent.latestUsage.usedAt).toLocaleString()}` : ""}
                            </div>
                            {agent.latestUsage.fallbackFrom ? (
                              <div className="text-[10px] text-muted-foreground">
                                Fell back from <span className="font-mono">{agent.latestUsage.fallbackFrom.provider}/{agent.latestUsage.fallbackFrom.model}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground">
                            No run usage captured yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setModelPrimary(LOCAL_FIRST_STARTER.primary)
                        setModelFallbacksInput(formatFallbackInput(LOCAL_FIRST_STARTER.fallbacks))
                      }}
                      disabled={!localFirstStarterReady || isCloudOnlyPolicy}
                    >
                      Use local-first starter
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setModelPrimary(CLOUD_FIRST_STARTER.primary)
                        setModelFallbacksInput(formatFallbackInput(cloudFirstStarterFallbacks))
                      }}
                      disabled={isLocalOnlyPolicy}
                    >
                      Use cloud-first starter
                    </Button>
                  </div>

                  {!localFirstStarterReady ? (
                    <div className="text-[10px] text-muted-foreground">
                      Download the required local Gemma models from Models before using the local-first starter.
                    </div>
                  ) : null}

                  {requiresHeavyLocalModelAck ? (
                    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[10px] text-amber-100">
                      <div className="font-medium text-amber-200">
                        High-memory local model selected
                      </div>
                      <div>
                        {heavyLocalSelections.join(", ")} can consume enough RAM/VRAM to freeze or crash smaller Macs.
                        For most machines, prefer <span className="font-mono">ollama/gemma4:e4b</span> and keep cloud as fallback.
                      </div>
                      <label className="flex items-start gap-2 text-amber-50">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={acknowledgeHeavyLocalModelRisk}
                          onChange={(e) => setAcknowledgeHeavyLocalModelRisk(e.target.checked)}
                        />
                        <span>I understand the memory risk and still want to save this model stack.</span>
                      </label>
                    </div>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    {modelPresetOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          modelPrimary === option.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background hover:bg-muted/60"
                        }`}
                        onClick={() => setModelPrimary(option.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{option.label}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {option.scope}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                          {option.id}
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {option.note}
                        </div>
                      </button>
                    ))}
                  </div>

                  {isOpenclaw && (
                    <div className="rounded-md border bg-background px-3 py-2 text-[10px] text-muted-foreground">
                      {ollamaModelsStatus?.available ? (
                        <>
                          Local runtime: <span className="font-mono">{ollamaModelsStatus.baseUrl}</span>
                          {" · "}
                          {ollamaModelsStatus.models.length} model{ollamaModelsStatus.models.length === 1 ? "" : "s"} detected
                        </>
                      ) : (
                        <>
                          Local runtime unavailable
                          {ollamaModelsStatus?.error ? ` · ${ollamaModelsStatus.error}` : ""}
                        </>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Primary model</label>
                    <Input
                      value={modelPrimary}
                      onChange={(e) => setModelPrimary(e.target.value)}
                      placeholder="ollama/gemma4:e4b"
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Fallbacks</label>
                    {(isLocalOnlyPolicy || isCloudOnlyPolicy) ? (
                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
                        {isLocalOnlyPolicy ? "Local-only agents do not use fallback models." : "Cloud-only agents do not use fallback models."}
                      </div>
                    ) : (
                      <FallbackModelSelector
                        value={modelFallbacksInput}
                        onChange={setModelFallbacksInput}
                        options={modelPresetOptions}
                        primaryModel={modelPrimary}
                        placeholder="Add a fallback model"
                      />
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      Tried left to right when the primary is unavailable or unsuitable.
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs"
                      onClick={() => void handleSaveModelStack()}
                      disabled={configMut.isPending || (requiresHeavyLocalModelAck && !acknowledgeHeavyLocalModelRisk)}
                    >
                      {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save model stack
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">OpenAI</div>
                      <div className="text-[10px] text-muted-foreground">
                        Browser-based ChatGPT/Codex OAuth for OpenClaw
                      </div>
                    </div>
                    {openAiAuth?.configured ? (
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Not configured
                      </Badge>
                    )}
                  </div>
                  {openAiAuth?.profileId && (
                    <div className="text-[10px] text-muted-foreground">
                      Profile: <span className="font-mono">{openAiAuth.profileId}</span>
                      {openAiAuth.mode ? <span> · Mode: {openAiAuth.mode}</span> : null}
                      {openAiAuth.expiresAt ? (
                        <span> · Expires: {new Date(openAiAuth.expiresAt).toLocaleString()}</span>
                      ) : null}
                    </div>
                  )}
                  {openAiAuth?.configured && openAiAuth.preview ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setShowOpenAiDetails((value) => !value)}
                      >
                        {showOpenAiDetails ? "Hide details" : "Show details"}
                      </Button>
                      {showOpenAiDetails ? (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {openAiAuth.preview}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleOpenAIConnect}
                      disabled={authMutationPending}
                    >
                      {openAIOAuthAuthorizeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      {openAiAuth?.configured ? "Reconnect with OpenAI" : "Connect with OpenAI"}
                    </Button>
                    {openAiAuth?.configured && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleClearProviderAuth("openai")}
                        disabled={authMutationPending}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Cloud credentials are optional. A local-only agent can leave these disconnected and still run on Ollama models.
                  </p>
                </div>

                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Claude</div>
                      <div className="text-[10px] text-muted-foreground">
                        Use either a direct Anthropic API key or a Claude setup token
                      </div>
                    </div>
                    {claudeAuth?.configured ? (
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass("active")}`}>
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Not configured
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Credential type</label>
                      <Select value={claudeMode} onValueChange={(value) => setClaudeMode(value as "api_key" | "token")}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="api_key">API key</SelectItem>
                          <SelectItem value="token">Setup token</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">
                        {claudeMode === "token" ? "Claude setup token" : "Anthropic API key"}
                      </label>
                      <Input
                        type="password"
                        value={claudeSecret}
                        onChange={(e) => setClaudeSecret(e.target.value)}
                        placeholder={claudeMode === "token" ? "token-..." : "sk-ant-..."}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                  {claudeAuth?.profileId && (
                    <div className="text-[10px] text-muted-foreground">
                      Profile: <span className="font-mono">{claudeAuth.profileId}</span>
                      {claudeAuth.mode ? <span> · Mode: {claudeAuth.mode === "token" ? "setup token" : "api key"}</span> : null}
                    </div>
                  )}
                  {claudeAuth?.configured && claudeAuth.preview ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setShowClaudeDetails((value) => !value)}
                      >
                        {showClaudeDetails ? "Hide details" : "Show details"}
                      </Button>
                      {showClaudeDetails ? (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {claudeAuth.preview}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleSaveProviderAuth("anthropic", claudeMode, claudeSecret)}
                      disabled={authMutationPending}
                    >
                      {upstreamAuthUpdateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save Claude {claudeMode === "token" ? "token" : "key"}
                    </Button>
                    {claudeAuth?.configured && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleClearProviderAuth("anthropic")}
                        disabled={authMutationPending}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="logs">
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">
                    Tail of the agent gateway log.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => void refetchAgentLogs()}
                    disabled={agentLogsLoading}
                  >
                    {agentLogsLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RotateCw className="h-3 w-3 mr-1" />
                    )}
                    Refresh
                  </Button>
                </div>
                <div className="space-y-3">
                  {(agentLogs?.logs ?? []).map((logFile) => (
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
                        <pre className="max-h-64 overflow-auto p-3 text-[10px] leading-4 whitespace-pre-wrap break-words font-mono">
                          {logFile.content || "No log output yet."}
                        </pre>
                      </div>
                    </div>
                  ))}
                  {!agentLogsLoading && (agentLogs?.logs?.length ?? 0) === 0 && (
                    <div className="rounded-md border bg-muted/20 p-3 text-[10px] text-muted-foreground">
                      No logs available for this agent.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Settings tab */}
            <TabsContent value="settings">
              {editing && <div className="pt-2">{settingsPanel}</div>}
            </TabsContent>
          </Tabs>
        )}

        {/* Settings for non-openclaw agents — behind editing toggle */}
        {!isOpenclaw && editing && (
          <div className="pt-2 border-t">{settingsPanel}</div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ProfileIcon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{agent.name}</span>
              </CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {profileLabel ? (
                  <Badge variant="outline" className="text-[10px]">
                    {profileLabel}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-[10px]">
                  {agent.type}
                </Badge>
                <Badge
                  variant="outline"
                  className={agent.running
                    ? `text-[10px] ${statusBadgeClass("active")}`
                    : "text-[10px] bg-muted text-muted-foreground"}
                >
                  {agent.running ? "running" : "stopped"}
                </Badge>
                {agent.model ? (
                  <Badge variant="secondary" className="max-w-full text-[10px] font-mono font-normal">
                    {agent.model}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openManagement("providers")}>
                <Bot className="h-3.5 w-3.5" />
                Workspace
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {routingPurpose ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Purpose</div>
              <p className="mt-2 text-sm leading-6 text-foreground/90">{routingPurpose}</p>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Primary domains</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {primaryDomains.length > 0 ? primaryDomains.map((domain) => (
                  <Badge key={domain} variant="secondary" className="text-[10px] font-normal">
                    {domain}
                  </Badge>
                )) : <span className="text-xs text-muted-foreground">No domains defined yet</span>}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Tool families</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {toolFamilies.length > 0 ? toolFamilies.map((family) => (
                  <Badge key={family} variant="secondary" className="text-[10px] font-normal">
                    {family}
                  </Badge>
                )) : <span className="text-xs text-muted-foreground">No tool families defined yet</span>}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Good at</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {preferredTaskTypes.length > 0 ? preferredTaskTypes.slice(0, 4).map((task) => (
                  <li key={task} className="leading-5">• {task}</li>
                )) : <li className="text-xs text-muted-foreground">No preferred tasks defined yet</li>}
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Avoid</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {forbiddenTaskTypes.length > 0 ? forbiddenTaskTypes.slice(0, 4).map((task) => (
                  <li key={task} className="leading-5">• {task}</li>
                )) : <li className="text-xs text-muted-foreground">No restricted tasks defined yet</li>}
              </ul>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-xl border p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Example requests</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {exampleTasks.length > 0 ? exampleTasks.slice(0, 3).map((task) => (
                  <li key={task} className="leading-5">“{task}”</li>
                )) : <li className="text-xs text-muted-foreground">No examples defined yet</li>}
              </ul>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Allowed tools</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {visibleProfileTools.length > 0 ? visibleProfileTools.map((tool) => (
                  <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-[10px] font-mono font-normal">
                        {shortToolName(tool)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-mono text-[10px]">{tool}</p>
                    </TooltipContent>
                  </Tooltip>
                )) : <span className="text-xs text-muted-foreground">No tool scope defined yet</span>}
                {profileTools.length > visibleProfileTools.length ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[10px] font-normal text-secondary-foreground transition hover:bg-secondary/80"
                    onClick={() => openManagement("settings")}
                    aria-label={`Open ${agent.name} settings to view all allowed tools`}
                  >
                    +{profileTools.length - visibleProfileTools.length} more
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              {agent.latestUsage ? `Latest run: ${summarizeLatestUsage(agent.latestUsage)}` : "No run usage captured yet"}
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openManagement("channels")}>
              <MessageCircle className="h-3.5 w-3.5" />
              Channels
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openManagement("logs")}>
              <RotateCw className="h-3.5 w-3.5" />
              Logs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removeMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </CardContent>
      </Card>

      <Sheet open={managementOpen} onOpenChange={setManagementOpen}>
        <SheetContent side="right" className="w-[min(1040px,100vw)] gap-0 overflow-hidden border-l border-border/70 bg-background/98 p-0 sm:max-w-[1040px]">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <ProfileIcon className="h-5 w-5 text-muted-foreground" />
              {agent.name}
            </SheetTitle>
            <SheetDescription>
              Workspace controls, providers, channels, logs, and advanced settings for this agent.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {managementCard}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove agent"
        description={`Are you sure you want to remove "${agent.name}"? This action cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={removeMut.isPending}
        onConfirm={() => void confirmRemoveAction()}
      />
      <ConfirmDialog
        open={confirmRevokeVault}
        onOpenChange={setConfirmRevokeVault}
        title="Revoke vault access"
        description={`Are you sure you want to revoke vault access for "${agent.name}"? The agent will no longer be able to read or write vault data.`}
        confirmLabel="Revoke"
        variant="destructive"
        isPending={vaultAccessRevokeMut.isPending}
        onConfirm={() => void confirmRevokeVaultAction()}
      />
      <ConfirmDialog
        open={channelToDisconnect !== null}
        onOpenChange={(open) => { if (!open) setChannelToDisconnect(null) }}
        title="Disconnect channel"
        description={`Are you sure you want to disconnect the ${channelToDisconnect ?? ""} channel from "${agent.name}"?`}
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={channelDisconnectMut.isPending}
        onConfirm={() => void confirmChannelDisconnectAction()}
      />
    </>
  )
}

function AgentDefinitionCard({
  agent,
  profilesData,
}: {
  agent: AgentConnection
  profilesData?: AgentProfilesResponse
}) {
  const configMut = useAgentConfig()
  const removeMut = useAgentRemove()
  const { data: ollamaModelsStatus } = useOllamaModelsStatus(agent.type === "openclaw")
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [name, setName] = useState(agent.name)
  const [profile, setProfile] = useState<AgentProfileId | undefined>(agent.profile)
  const [modelPrimary, setModelPrimary] = useState(agent.model || DEFAULT_PRIMARY_MODEL)
  const [modelFallbacksInput, setModelFallbacksInput] = useState(formatFallbackInput(agent.modelFallbacks))
  const [modelPolicy, setModelPolicy] = useState<AgentModelRoutingPolicy>(
    agent.modelPolicy ?? DEFAULT_MODEL_POLICY,
  )
  const [purpose, setPurpose] = useState("")
  const [primaryDomainsInput, setPrimaryDomainsInput] = useState("")
  const [preferredTaskTypesInput, setPreferredTaskTypesInput] = useState("")
  const [forbiddenTaskTypesInput, setForbiddenTaskTypesInput] = useState("")
  const [toolFamiliesInput, setToolFamiliesInput] = useState("")
  const [shortExamplesInput, setShortExamplesInput] = useState("")
  const [customToolsInput, setCustomToolsInput] = useState((agent.customTools ?? []).join(", "))
  const [networkAllowlistInput, setNetworkAllowlistInput] = useState((agent.networkAllowlist ?? []).join(", "))
  const [acknowledgeHeavyLocalModelRisk, setAcknowledgeHeavyLocalModelRisk] = useState(false)

  const discoveredLocalOptions = buildDiscoveredLocalOptions(ollamaModelsStatus)
  const localModelIndex = new Map(
    (ollamaModelsStatus?.models ?? []).map((model) => [model.id, model] as const),
  )
  const installedLocalModelIds = new Set(discoveredLocalOptions.map((option) => option.id))
  const modelPresetOptions = [...discoveredLocalOptions, ...CLOUD_MODEL_PRESET_OPTIONS]
  const preferredLocalPrimary = getPreferredLocalPrimary(discoveredLocalOptions)
  const preferredCloudPrimary = getPreferredCloudPrimary(modelPresetOptions)
  const isLocalOnlyPolicy = modelPolicy === "local_only"
  const isCloudOnlyPolicy = modelPolicy === "cloud_only"
  const configuredFallbacks = parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== modelPrimary.trim())
  const heavyLocalSelections = [modelPrimary.trim(), ...configuredFallbacks]
    .filter((modelRef, index, all) => all.indexOf(modelRef) === index)
    .filter((modelRef) => isPotentiallyHeavyLocalModel(modelRef, localModelIndex))
  const requiresHeavyLocalModelAck = heavyLocalSelections.length > 0
  const localFirstStarterReady =
    isInstalledLocalModelRef(installedLocalModelIds, LOCAL_FIRST_STARTER.primary) &&
    LOCAL_FIRST_STARTER.fallbacks
      .filter((modelRef) => isLocalModelRef(modelRef))
      .every((modelRef) => isInstalledLocalModelRef(installedLocalModelIds, modelRef))

  const selectableProfiles = profilesData?.profiles ?? []
  const profileLabel = getProfileLabel(profilesData, profile)
  const profileDefinition = profilesData?.profiles.find((entry) => entry.id === profile)
  const ProfileIcon = getProfileIcon(profile)
  const profileTools = getProfileTools(profilesData, profile)
  const allAvailableTools = getAllAvailableTools(profilesData)
  const mergedToolScope = Array.from(new Set([...profileTools, ...parseListInput(customToolsInput)]))

  const syncRoutingDraft = (nextProfile: AgentProfileId | undefined, explicitRouting = agent.routingProfile) => {
    const defaults = profilesData?.profiles.find((entry) => entry.id === nextProfile)?.routingProfile
    setPurpose(explicitRouting?.purpose ?? defaults?.purpose ?? "")
    setPrimaryDomainsInput(formatListInput(explicitRouting?.primaryDomains ?? defaults?.primaryDomains))
    setPreferredTaskTypesInput(formatListInput(explicitRouting?.preferredTaskTypes ?? defaults?.preferredTaskTypes))
    setForbiddenTaskTypesInput(formatListInput(explicitRouting?.forbiddenTaskTypes ?? defaults?.forbiddenTaskTypes))
    setToolFamiliesInput(formatListInput(explicitRouting?.toolFamiliesAvailable ?? defaults?.toolFamiliesAvailable))
    setShortExamplesInput(formatListInput(explicitRouting?.shortExamples ?? defaults?.shortExamples))
  }

  useEffect(() => {
    setName(agent.name)
    setProfile(agent.profile)
    setModelPrimary(agent.model || DEFAULT_PRIMARY_MODEL)
    setModelFallbacksInput(formatFallbackInput(agent.modelFallbacks))
    setModelPolicy(agent.modelPolicy ?? DEFAULT_MODEL_POLICY)
    setCustomToolsInput((agent.customTools ?? []).join(", "))
    setNetworkAllowlistInput((agent.networkAllowlist ?? []).join(", "))
    setAcknowledgeHeavyLocalModelRisk(false)
    syncRoutingDraft(agent.profile, agent.routingProfile)
  }, [agent, profilesData])

  useEffect(() => {
    setAcknowledgeHeavyLocalModelRisk(false)
  }, [modelPrimary, modelFallbacksInput])

  useEffect(() => {
    if (!isLocalOnlyPolicy) {
      return
    }
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (!isLocalModelRef(modelPrimary) && preferredLocalPrimary) {
      setModelPrimary(preferredLocalPrimary)
    }
  }, [isLocalOnlyPolicy, modelFallbacksInput, modelPrimary, preferredLocalPrimary])

  useEffect(() => {
    if (!isCloudOnlyPolicy) {
      return
    }
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (isLocalModelRef(modelPrimary) && preferredCloudPrimary) {
      setModelPrimary(preferredCloudPrimary)
    }
  }, [isCloudOnlyPolicy, modelFallbacksInput, modelPrimary, preferredCloudPrimary])

  const routingPurpose = purpose || profileDefinition?.routingProfile?.purpose
  const primaryDomains = parseListInput(primaryDomainsInput)
  const preferredTaskTypes = parseListInput(preferredTaskTypesInput)
  const forbiddenTaskTypes = parseListInput(forbiddenTaskTypesInput)
  const toolFamilies = parseListInput(toolFamiliesInput)
  const exampleTasks = parseListInput(shortExamplesInput)
  const visibleToolScope = mergedToolScope.slice(0, 8)

  const handleSave = async () => {
    const primary = modelPrimary.trim()
    const fallbacks = (isLocalOnlyPolicy || isCloudOnlyPolicy)
      ? []
      : parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== primary)
    if (!name.trim()) {
      toast.error("Agent name is required")
      return
    }
    if (!primary) {
      toast.error("Primary model is required")
      return
    }
    if (isLocalOnlyPolicy && !isLocalModelRef(primary)) {
      toast.error("Local only requires a local primary model")
      return
    }
    if (isCloudOnlyPolicy && isLocalModelRef(primary)) {
      toast.error("Cloud only requires a cloud primary model")
      return
    }
    const missingLocalModels = [primary, ...fallbacks].filter(
      (modelRef) => isLocalModelRef(modelRef) && !isInstalledLocalModelRef(installedLocalModelIds, modelRef),
    )
    if (missingLocalModels.length > 0) {
      toast.error(`Download local model${missingLocalModels.length === 1 ? "" : "s"} first: ${missingLocalModels.join(", ")}`)
      return
    }
    if (requiresHeavyLocalModelAck && !acknowledgeHeavyLocalModelRisk) {
      toast.error("Acknowledge the high-memory local model warning before saving")
      return
    }
    try {
      await configMut.mutateAsync({
        id: agent.id,
        name: name.trim(),
        type: agent.type,
        gatewayUrl: agent.gatewayUrl,
        hooksPath: agent.hooksPath,
        enabled: agent.enabled,
        notifications: agent.notifications,
        profile: profile || undefined,
        networkAllowlist: (profile ?? agent.profile) === "software-engineer" && networkAllowlistInput.trim()
          ? networkAllowlistInput.split(",").map((domain) => domain.trim()).filter(Boolean)
          : undefined,
        customTools: parseListInput(customToolsInput),
        model: primary,
        modelFallbacks: fallbacks,
        modelPolicy,
        memoryPromptInjectionMode:
          agent.memoryPromptInjectionMode ?? DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
        routingProfile: {
          purpose: purpose.trim() || undefined,
          primaryDomains,
          preferredTaskTypes,
          forbiddenTaskTypes,
          toolFamiliesAvailable: toolFamilies,
          shortExamples: exampleTasks,
        },
      })
      toast.success("Agent updated")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent")
    }
  }

  const handleRemove = () => {
    setConfirmRemove(true)
  }

  const confirmRemoveAction = async () => {
    try {
      await removeMut.mutateAsync(agent.id)
      toast.success("Agent removed")
      setConfirmRemove(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove agent")
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ProfileIcon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{agent.name}</span>
              </CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {profileLabel ? <Badge variant="outline" className="text-[10px]">{profileLabel}</Badge> : null}
                {agent.model ? <Badge variant="secondary" className="text-[10px] font-mono font-normal">{agent.model}</Badge> : null}
                {agent.modelFallbacks?.length ? <Badge variant="secondary" className="text-[10px] font-normal">+{agent.modelFallbacks.length} fallback{agent.modelFallbacks.length === 1 ? "" : "s"}</Badge> : null}
                <Badge variant="outline" className="text-[10px]">{MODEL_POLICY_LABELS[agent.modelPolicy ?? DEFAULT_MODEL_POLICY]}</Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing(true)}>
              <Bot className="h-3.5 w-3.5" />
              Edit agent
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {routingPurpose ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Description</div>
              <p className="mt-2 text-sm leading-6 text-foreground/90">{routingPurpose}</p>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Domains</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {primaryDomains.length > 0 ? primaryDomains.map((domain) => (
                  <Badge key={domain} variant="secondary" className="text-[10px] font-normal">{domain}</Badge>
                )) : <span className="text-xs text-muted-foreground">No domains defined yet</span>}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Allowed tools</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {visibleToolScope.length > 0 ? visibleToolScope.map((tool) => (
                  <Tooltip key={tool}>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="text-[10px] font-mono font-normal">{shortToolName(tool)}</Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-mono text-[10px]">{tool}</p>
                    </TooltipContent>
                  </Tooltip>
                )) : <span className="text-xs text-muted-foreground">No tool scope defined yet</span>}
                {mergedToolScope.length > visibleToolScope.length ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[10px] font-normal text-secondary-foreground transition hover:bg-secondary/80"
                    onClick={() => setEditing(true)}
                    aria-label={`Open ${agent.name} details to view all allowed tools`}
                  >
                    +{mergedToolScope.length - visibleToolScope.length} more
                  </button>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Good at</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {preferredTaskTypes.length > 0 ? preferredTaskTypes.slice(0, 4).map((task) => (
                  <li key={task} className="leading-5">• {task}</li>
                )) : <li className="text-xs text-muted-foreground">No preferred tasks defined yet</li>}
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Avoid</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {forbiddenTaskTypes.length > 0 ? forbiddenTaskTypes.slice(0, 4).map((task) => (
                  <li key={task} className="leading-5">• {task}</li>
                )) : <li className="text-xs text-muted-foreground">No restricted tasks defined yet</li>}
              </ul>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-xl border p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Example requests</div>
              <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                {exampleTasks.length > 0 ? exampleTasks.slice(0, 3).map((task) => (
                  <li key={task} className="leading-5">“{task}”</li>
                )) : <li className="text-xs text-muted-foreground">No examples defined yet</li>}
              </ul>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Tool families</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {toolFamilies.length > 0 ? toolFamilies.map((family) => (
                  <Badge key={family} variant="secondary" className="text-[10px] font-normal">{family}</Badge>
                )) : <span className="text-xs text-muted-foreground">No tool families defined yet</span>}
              </div>
              {(profile ?? agent.profile) === "software-engineer" && networkAllowlistInput.trim() ? (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Allowed network</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {networkAllowlistInput.split(",").map((domain) => domain.trim()).filter(Boolean).map((domain) => (
                      <Badge key={domain} variant="outline" className="text-[10px] font-mono font-normal">{domain}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div className="text-xs text-muted-foreground">
              Gateway providers, channels, memory, hooks, notifications, logs, and runtime controls are managed once from the Agent Gateway section.
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removeMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </CardContent>
      </Card>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="right" className="w-[min(920px,100vw)] gap-0 overflow-hidden border-l border-border/70 bg-background/98 p-0 sm:max-w-[920px]">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <ProfileIcon className="h-5 w-5 text-muted-foreground" />
              {name || agent.name}
            </SheetTitle>
            <SheetDescription>
              Agent identity, model stack, domains, task boundaries, and allowed tools.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <div className="text-sm font-medium">Identity</div>
                    <div className="mt-1 text-xs text-muted-foreground">Name, role, and the description Gemma should use when routing to this agent.</div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Role</label>
                    <Select
                      value={profile ?? "__none__"}
                      onValueChange={(value) => {
                        const nextProfile = value === "__none__" ? undefined : value as AgentProfileId
                        setProfile(nextProfile)
                        syncRoutingDraft(nextProfile, undefined)
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No role</SelectItem>
                        {selectableProfiles.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Description</label>
                    <textarea
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      rows={5}
                      className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Explain this agent's purpose clearly."
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <div className="text-sm font-medium">Model stack</div>
                    <div className="mt-1 text-xs text-muted-foreground">Primary and fallback models for this agent only.</div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Primary model</label>
                    <Select value={modelPrimary} onValueChange={setModelPrimary}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {modelPresetOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.label} · {option.scope}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input value={modelPrimary} onChange={(e) => setModelPrimary(e.target.value)} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Fallback models</label>
                    {(isLocalOnlyPolicy || isCloudOnlyPolicy) ? (
                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
                        {isLocalOnlyPolicy ? "Local-only agents do not use fallback models." : "Cloud-only agents do not use fallback models."}
                      </div>
                    ) : (
                      <FallbackModelSelector
                        value={modelFallbacksInput}
                        onChange={setModelFallbacksInput}
                        options={modelPresetOptions}
                        primaryModel={modelPrimary}
                        placeholder="Add a fallback model"
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Execution policy</label>
                    <Select value={modelPolicy} onValueChange={(value) => setModelPolicy(value as AgentModelRoutingPolicy)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local_only">Local only</SelectItem>
                        <SelectItem value="cloud_only">Cloud only</SelectItem>
                        <SelectItem value="hybrid">Hybrid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {requiresHeavyLocalModelAck ? (
                    <label className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                      <input type="checkbox" checked={acknowledgeHeavyLocalModelRisk} onChange={(e) => setAcknowledgeHeavyLocalModelRisk(e.target.checked)} className="mt-0.5 rounded" />
                      I understand these local models may require high memory and can make execution unstable.
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                      setModelPrimary(CLOUD_FIRST_STARTER.primary)
                      setModelFallbacksInput(formatFallbackInput(CLOUD_FIRST_STARTER.fallbacks))
                    }} disabled={isLocalOnlyPolicy}>
                      Cloud-first preset
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={!localFirstStarterReady || isCloudOnlyPolicy} onClick={() => {
                      setModelPrimary(LOCAL_FIRST_STARTER.primary)
                      setModelFallbacksInput(formatFallbackInput(LOCAL_FIRST_STARTER.fallbacks))
                    }}>
                      Local-first preset
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <div className="text-sm font-medium">Domains and tasks</div>
                    <div className="mt-1 text-xs text-muted-foreground">This is the routing contract Gemma sees when deciding whether this agent should own a task.</div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Domains</label>
                    <textarea value={primaryDomainsInput} onChange={(e) => setPrimaryDomainsInput(e.target.value)} rows={4} className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"strategy\nplanning\noperations"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Good at</label>
                    <textarea value={preferredTaskTypesInput} onChange={(e) => setPreferredTaskTypesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"summarize threads\nprepare briefs\ndraft partner emails"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Avoid</label>
                    <textarea value={forbiddenTaskTypesInput} onChange={(e) => setForbiddenTaskTypesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"code changes\nproduction debugging\nlegal advice"} />
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <div className="text-sm font-medium">Tools and examples</div>
                    <div className="mt-1 text-xs text-muted-foreground">Allowed tools are agent-specific. Providers and channels are managed once above at the gateway level.</div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Tool families</label>
                    <textarea value={toolFamiliesInput} onChange={(e) => setToolFamiliesInput(e.target.value)} rows={4} className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"general\nresearch\nemail"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Example requests</label>
                    <textarea value={shortExamplesInput} onChange={(e) => setShortExamplesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={'Summarize this conversation and tell me next steps.\nDraft an email reply to this partner.'} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground">Allowed tools (extra tools, comma or newline separated)</label>
                    <textarea value={customToolsInput} onChange={(e) => setCustomToolsInput(e.target.value)} rows={4} className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={allAvailableTools.slice(0, 6).join(", ")} />
                    {profileTools.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {profileTools.map((tool) => (
                          <Badge key={tool} variant="secondary" className="text-[10px] font-mono font-normal">{shortToolName(tool)}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {(profile ?? agent.profile) === "software-engineer" ? (
                    <div className="space-y-2">
                      <label className="text-[10px] text-muted-foreground">Allowed network domains</label>
                      <Input value={networkAllowlistInput} onChange={(e) => setNetworkAllowlistInput(e.target.value)} className="h-8 text-xs font-mono" placeholder="github.com, api.github.com, registry.npmjs.org" />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <div className="text-xs text-muted-foreground">
                  Provider auth, channels, memory, hooks, notifications, logs, and runtime controls are managed once from the Agent Gateway section.
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button onClick={() => void handleSave()} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save agent
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove agent"
        description={`Are you sure you want to remove "${agent.name}"? This action cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={removeMut.isPending}
        onConfirm={() => void confirmRemoveAction()}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Add Agent Card
// ---------------------------------------------------------------------------

function AddAgentCard({
  existingAgents,
  profilesData,
}: {
  existingAgents: AgentConnection[]
  profilesData?: AgentProfilesResponse
}) {
  const configMut = useAgentConfig()
  const [adding, setAdding] = useState(false)
  const [manualMode, setManualMode] = useState(false)

  const [name, setName] = useState("")
  const type: "openclaw" = "openclaw"
  const [gatewayUrl, setGatewayUrl] = useState("")
  const [hooksPath, setHooksPath] = useState("/hooks/agent")
  const [token, setToken] = useState("")
  const [profile, setProfile] = useState<AgentProfileId | undefined>(undefined)
  const [networkAllowlist, setNetworkAllowlist] = useState("github.com, api.github.com, registry.npmjs.org")
  const [customTools, setCustomTools] = useState<Set<string>>(new Set())
  const [memoryPromptInjectionMode] = useState<AgentMemoryPromptInjectionMode>(
    DEFAULT_MEMORY_PROMPT_INJECTION_MODE,
  )
  const [modelPrimary, setModelPrimary] = useState(DEFAULT_PRIMARY_MODEL)
  const [modelFallbacksInput, setModelFallbacksInput] = useState("")
  const [modelPolicy, setModelPolicy] = useState<AgentModelRoutingPolicy>(DEFAULT_MODEL_POLICY)
  const [purpose, setPurpose] = useState("")
  const [primaryDomainsInput, setPrimaryDomainsInput] = useState("")
  const [preferredTaskTypesInput, setPreferredTaskTypesInput] = useState("")
  const [forbiddenTaskTypesInput, setForbiddenTaskTypesInput] = useState("")
  const [toolFamiliesInput, setToolFamiliesInput] = useState("")
  const [shortExamplesInput, setShortExamplesInput] = useState("")
  const [acknowledgeHeavyLocalModelRisk, setAcknowledgeHeavyLocalModelRisk] = useState(false)

  // Derive slug and check uniqueness
  const nameSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const nameTaken = nameSlug ? existingAgents.some((a) => a.id === nameSlug) : false

  // Auto-detect openclaw instance
  const { data: detected, isLoading: detecting } = useDetectOpenclawAgent(adding && !manualMode)
  const { data: ollamaModelsStatus } = useOllamaModelsStatus(adding)
  const allAvailableTools = getAllAvailableTools(profilesData)
  const selectedProfileTools = getProfileTools(profilesData, profile)
  const selectableProfiles = (profilesData?.profiles ?? []).filter((entry) => entry.id !== "custom")
  const customProfile = profilesData?.profiles.find((entry) => entry.id === "custom")
  const discoveredLocalOptions = buildDiscoveredLocalOptions(ollamaModelsStatus)
  const localModelIndex = new Map(
    (ollamaModelsStatus?.models ?? []).map((model) => [model.id, model] as const),
  )
  const installedLocalModelIds = new Set(discoveredLocalOptions.map((option) => option.id))
  const modelPresetOptions = [...discoveredLocalOptions, ...CLOUD_MODEL_PRESET_OPTIONS]
  const preferredLocalPrimary = getPreferredLocalPrimary(discoveredLocalOptions)
  const preferredCloudPrimary = getPreferredCloudPrimary(modelPresetOptions)
  const isLocalOnlyPolicy = modelPolicy === "local_only"
  const isCloudOnlyPolicy = modelPolicy === "cloud_only"
  const configuredFallbacks = parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== modelPrimary.trim())
  const heavyLocalSelections = [modelPrimary.trim(), ...configuredFallbacks]
    .filter((modelRef, index, all) => all.indexOf(modelRef) === index)
    .filter((modelRef) => isPotentiallyHeavyLocalModel(modelRef, localModelIndex))
  const requiresHeavyLocalModelAck = heavyLocalSelections.length > 0
  const localFirstStarterReady =
    isInstalledLocalModelRef(installedLocalModelIds, LOCAL_FIRST_STARTER.primary) &&
    LOCAL_FIRST_STARTER.fallbacks
      .filter((modelRef) => isLocalModelRef(modelRef))
      .every((modelRef) => isInstalledLocalModelRef(installedLocalModelIds, modelRef))

  const syncRoutingDraft = (nextProfile: AgentProfileId | undefined) => {
    const defaults = profilesData?.profiles.find((entry) => entry.id === nextProfile)?.routingProfile
    setPurpose(defaults?.purpose ?? "")
    setPrimaryDomainsInput(formatListInput(defaults?.primaryDomains))
    setPreferredTaskTypesInput(formatListInput(defaults?.preferredTaskTypes))
    setForbiddenTaskTypesInput(formatListInput(defaults?.forbiddenTaskTypes))
    setToolFamiliesInput(formatListInput(defaults?.toolFamiliesAvailable))
    setShortExamplesInput(formatListInput(defaults?.shortExamples))
  }

  // Pre-fill from detection
  useEffect(() => {
    if (detected?.detected && !manualMode) {
      setGatewayUrl(detected.gatewayUrl ?? "")
      setToken(detected.hooksToken ?? "")
      setHooksPath(detected.hooksPath ?? "/hooks/agent")
      if (!name && !profile) setName("Straja Agent")
    }
  }, [detected, manualMode])

  useEffect(() => {
    setAcknowledgeHeavyLocalModelRisk(false)
  }, [modelPrimary, modelFallbacksInput])

  useEffect(() => {
    if (!isLocalOnlyPolicy) return
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (!isLocalModelRef(modelPrimary) && preferredLocalPrimary) {
      setModelPrimary(preferredLocalPrimary)
    }
  }, [isLocalOnlyPolicy, modelFallbacksInput, modelPrimary, preferredLocalPrimary])

  useEffect(() => {
    if (!isCloudOnlyPolicy) return
    if (modelFallbacksInput.trim()) {
      setModelFallbacksInput("")
    }
    if (isLocalModelRef(modelPrimary) && preferredCloudPrimary) {
      setModelPrimary(preferredCloudPrimary)
    }
  }, [isCloudOnlyPolicy, modelFallbacksInput, modelPrimary, preferredCloudPrimary])

  const handleStartAdd = () => {
    setName("")
    setGatewayUrl("")
    setHooksPath("/hooks/agent")
    setToken("")
    setManualMode(false)
    setProfile(undefined)
    setNetworkAllowlist("github.com, api.github.com, registry.npmjs.org")
    setCustomTools(new Set())
    setModelPrimary(DEFAULT_PRIMARY_MODEL)
    setModelFallbacksInput("")
    setModelPolicy(DEFAULT_MODEL_POLICY)
    setPurpose("")
    setPrimaryDomainsInput("")
    setPreferredTaskTypesInput("")
    setForbiddenTaskTypesInput("")
    setToolFamiliesInput("")
    setShortExamplesInput("")
    setAcknowledgeHeavyLocalModelRisk(false)
    setAdding(true)
  }

  const isAutoDetected = detected?.detected && !manualMode

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    if (nameTaken) {
      toast.error("An agent with this name already exists")
      return
    }
    if (!isAutoDetected && !gatewayUrl.trim()) {
      toast.error("Gateway URL is required")
      return
    }
    if (!isAutoDetected && !token.trim()) {
      toast.error("Token is required for new agents")
      return
    }
    const primary = modelPrimary.trim()
    const fallbacks = (isLocalOnlyPolicy || isCloudOnlyPolicy)
      ? []
      : parseFallbackInput(modelFallbacksInput).filter((modelId) => modelId !== primary)
    if (!primary) {
      toast.error("Primary model is required")
      return
    }
    if (isLocalOnlyPolicy && !isLocalModelRef(primary)) {
      toast.error("Local only requires a local primary model")
      return
    }
    if (isCloudOnlyPolicy && isLocalModelRef(primary)) {
      toast.error("Cloud only requires a cloud primary model")
      return
    }
    const missingLocalModels = [primary, ...fallbacks].filter(
      (modelRef) => isLocalModelRef(modelRef) && !isInstalledLocalModelRef(installedLocalModelIds, modelRef),
    )
    if (missingLocalModels.length > 0) {
      toast.error(`Download local model${missingLocalModels.length === 1 ? "" : "s"} first: ${missingLocalModels.join(", ")}`)
      return
    }
    if (requiresHeavyLocalModelAck && !acknowledgeHeavyLocalModelRisk) {
      toast.error("Acknowledge the high-memory local model warning before saving")
      return
    }
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    try {
      const result = await configMut.mutateAsync({
        id,
        name: name.trim(),
        type,
        gatewayUrl: (isAutoDetected ? detected?.gatewayUrl : gatewayUrl.trim()) || "",
        token: (isAutoDetected ? detected?.hooksToken : token.trim()) || "",
        gatewayToken: isAutoDetected ? detected?.gatewayToken : undefined,
        hooksPath: hooksPath.trim() || "/hooks/agent",
        enabled: true,
        notifications: { gmail: true, gcalendar: true },
        autoPair: isAutoDetected ? true : undefined,
        profile: profile || undefined,
        model: primary,
        modelFallbacks: fallbacks,
        modelPolicy,
        networkAllowlist: profile === "software-engineer" && networkAllowlist.trim()
          ? networkAllowlist.split(",").map((d) => d.trim()).filter(Boolean)
          : undefined,
        customTools: customTools.size > 0
          ? Array.from(customTools)
          : undefined,
        memoryPromptInjectionMode: detected?.memoryPromptInjectionMode ?? memoryPromptInjectionMode,
        routingProfile: {
          purpose: purpose.trim() || undefined,
          primaryDomains: parseListInput(primaryDomainsInput),
          preferredTaskTypes: parseListInput(preferredTaskTypesInput),
          forbiddenTaskTypes: parseListInput(forbiddenTaskTypesInput),
          toolFamiliesAvailable: parseListInput(toolFamiliesInput),
          shortExamples: parseListInput(shortExamplesInput),
        },
      })
      if (result.autoPaired) {
        toast.success("Agent paired automatically — vault token written to openclaw.json")
      } else {
        toast.success("Agent added")
      }
      setAdding(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add agent")
    }
  }

  if (!adding) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4">
          <Button
            variant="ghost"
            className="w-full gap-2 text-muted-foreground"
            onClick={handleStartAdd}
          >
            <Plus className="h-4 w-4" />
            Add Agent
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="h-4 w-4" />
          New Agent
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0"
            onClick={() => setAdding(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Identity</div>
              <div className="mt-1 text-xs text-muted-foreground">Name, role, and the description Gemma should use when routing to this agent.</div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent"
                className={`text-sm h-8 ${nameTaken ? "border-red-500 focus-visible:ring-red-500" : nameSlug && !nameTaken ? "border-emerald-500 focus-visible:ring-emerald-500" : ""}`}
              />
              {nameSlug && (
                <div className={`flex items-center gap-1 text-[10px] ${nameTaken ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {nameTaken ? (
                    <><X className="h-3 w-3" /> <span><span className="font-mono">{nameSlug}</span> is already taken</span></>
                  ) : (
                    <><Check className="h-3 w-3" /> <span><span className="font-mono">{nameSlug}</span> is available</span></>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Role</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[...selectableProfiles, ...(customProfile ? [customProfile] : [])].map((profileDef) => {
                  const pid = profileDef.id
                  const Icon = getProfileIcon(pid)
                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => {
                        setProfile(pid)
                        syncRoutingDraft(pid)
                        const knownDefaultNames = (profilesData?.profiles ?? []).map((entry) => buildDefaultProfileName(entry))
                        const defaultName = buildDefaultProfileName(profileDef)
                        if (!name || name === "Straja Agent" || knownDefaultNames.includes(name)) {
                          setName(defaultName)
                        }
                      }}
                      className={`text-left p-2.5 rounded-md border transition-colors ${
                        profile === pid
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium">{profileDef.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{profileDef.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Description</label>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={5}
                className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Explain this agent's purpose clearly."
              />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Model stack</div>
              <div className="mt-1 text-xs text-muted-foreground">Primary and fallback models for this agent only.</div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Primary model</label>
              <Select value={modelPrimary} onValueChange={setModelPrimary}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelPresetOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label} · {option.scope}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={modelPrimary} onChange={(e) => setModelPrimary(e.target.value)} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Fallback models</label>
              {(isLocalOnlyPolicy || isCloudOnlyPolicy) ? (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
                  {isLocalOnlyPolicy ? "Local-only agents do not use fallback models." : "Cloud-only agents do not use fallback models."}
                </div>
              ) : (
                <FallbackModelSelector
                  value={modelFallbacksInput}
                  onChange={setModelFallbacksInput}
                  options={modelPresetOptions}
                  primaryModel={modelPrimary}
                  placeholder="Add a fallback model"
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Execution policy</label>
              <Select value={modelPolicy} onValueChange={(value) => setModelPolicy(value as AgentModelRoutingPolicy)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_only">Local only</SelectItem>
                  <SelectItem value="cloud_only">Cloud only</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {requiresHeavyLocalModelAck ? (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <input type="checkbox" checked={acknowledgeHeavyLocalModelRisk} onChange={(e) => setAcknowledgeHeavyLocalModelRisk(e.target.checked)} className="mt-0.5 rounded" />
                I understand these local models may require high memory and can make execution unstable.
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setModelPrimary(CLOUD_FIRST_STARTER.primary)
                  setModelFallbacksInput(formatFallbackInput(CLOUD_FIRST_STARTER.fallbacks))
                }}
                disabled={isLocalOnlyPolicy}
              >
                Cloud-first preset
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!localFirstStarterReady || isCloudOnlyPolicy}
                onClick={() => {
                  setModelPrimary(LOCAL_FIRST_STARTER.primary)
                  setModelFallbacksInput(formatFallbackInput(LOCAL_FIRST_STARTER.fallbacks))
                }}
              >
                Local-first preset
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Domains and tasks</div>
              <div className="mt-1 text-xs text-muted-foreground">This is the routing contract Gemma sees when deciding whether this agent should own a task.</div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Domains</label>
              <textarea value={primaryDomainsInput} onChange={(e) => setPrimaryDomainsInput(e.target.value)} rows={4} className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"strategy\nplanning\noperations"} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Good at</label>
              <textarea value={preferredTaskTypesInput} onChange={(e) => setPreferredTaskTypesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"summarize threads\nprepare briefs\ndraft partner emails"} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Avoid</label>
              <textarea value={forbiddenTaskTypesInput} onChange={(e) => setForbiddenTaskTypesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"code changes\nproduction debugging\nlegal advice"} />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-medium">Tools and examples</div>
              <div className="mt-1 text-xs text-muted-foreground">Allowed tools are agent-specific. Providers and channels are managed once above at the gateway level.</div>
            </div>
            {profile && profile !== "custom" && selectedProfileTools.length > 0 ? (
              <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-3">
                <div className="text-[10px] text-muted-foreground font-medium">Included profile tools</div>
                <div className="flex flex-wrap gap-1">
                  {selectedProfileTools.map((tool) => (
                    <Tooltip key={tool}>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                          {shortToolName(tool)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs font-mono">{tool}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Tool families</label>
              <textarea value={toolFamiliesInput} onChange={(e) => setToolFamiliesInput(e.target.value)} rows={4} className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"general\nresearch\nemail"} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Example requests</label>
              <textarea value={shortExamplesInput} onChange={(e) => setShortExamplesInput(e.target.value)} rows={5} className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={'Summarize this conversation and tell me next steps.\nDraft an email reply to this partner.'} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Allowed tools (extra tools, comma or newline separated)</label>
              {profile === "custom" ? (
                <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-3">
                  <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-tight">
                      Custom profiles require manual tool selection. Granting both vault read and execution access can expose workspace data.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto">
                    {allAvailableTools.map((tool) => (
                      <label key={tool} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={customTools.has(tool)}
                          onChange={(e) => {
                            const next = new Set(customTools)
                            if (e.target.checked) next.add(tool)
                            else next.delete(tool)
                            setCustomTools(next)
                          }}
                          className="rounded h-3 w-3"
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[10px] font-mono text-muted-foreground truncate">{shortToolName(tool)}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs font-mono">{tool}</TooltipContent>
                        </Tooltip>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={Array.from(customTools).join(", ")}
                    onChange={(e) => setCustomTools(new Set(parseListInput(e.target.value)))}
                    rows={4}
                    className="min-h-[112px] w-full rounded-md border bg-background px-3 py-2 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={allAvailableTools.slice(0, 6).join(", ")}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {allAvailableTools.map((tool) => {
                      const providedByProfile = selectedProfileTools.includes(tool)
                      const selected = providedByProfile || customTools.has(tool)
                      return (
                        <Tooltip key={tool}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={providedByProfile}
                              onClick={() => {
                                const next = new Set(customTools)
                                if (next.has(tool)) next.delete(tool)
                                else next.add(tool)
                                setCustomTools(next)
                              }}
                              className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-mono transition",
                                providedByProfile
                                  ? "cursor-default border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : selected
                                    ? "border border-primary/30 bg-primary/10 text-foreground"
                                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                              )}
                              aria-pressed={selected}
                            >
                              {shortToolName(tool)}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs font-mono">
                            {providedByProfile ? `${tool} (included by role)` : tool}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            {profile === "software-engineer" ? (
              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground">Allowed network domains</label>
                <Input
                  value={networkAllowlist}
                  onChange={(e) => setNetworkAllowlist(e.target.value)}
                  placeholder="github.com, registry.npmjs.org"
                  className="text-sm h-8 font-mono"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div>
            <div className="text-sm font-medium">Connection</div>
            <div className="mt-1 text-xs text-muted-foreground">How this new agent connects to the shared workspace gateway.</div>
          </div>

        {/* Auto-detection banner */}
        {!manualMode && detecting && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50 border text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking for local OpenClaw instance...
          </div>
        )}

        {isAutoDetected && (
          <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Auto-detected from {detected.configPath}
            </div>
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <div>Gateway: <span className="font-mono">{detected.gatewayUrl}</span></div>
              <div>Hooks token: <span className="font-mono">configured</span></div>
              {(detected.telegramConfigured || detected.whatsappConfigured) && (
                <div>
                  Channels:{" "}
                  {[
                    detected.telegramConfigured && "Telegram",
                    detected.whatsappConfigured && "WhatsApp",
                  ].filter(Boolean).join(", ")}
                </div>
              )}
              {detected.existingVaultToken && <div>Vault token: <span className="font-mono">{detected.existingVaultToken}</span> (will be rotated)</div>}
              {!detected.existingVaultToken && <div>Vault access: <span className="text-emerald-600 dark:text-emerald-400">will be paired automatically</span></div>}
            </div>
            <button
              className="text-[10px] text-muted-foreground underline hover:text-foreground"
              onClick={() => setManualMode(true)}
            >
              Switch to manual setup
            </button>
          </div>
        )}

        {!manualMode && !detecting && detected && !detected.detected && (
          <div className="p-2.5 rounded-md bg-muted/50 border text-xs text-muted-foreground">
            No OpenClaw instance found at ~/.openclaw.{" "}
            <button
              className="underline hover:text-foreground"
              onClick={() => setManualMode(true)}
            >
              Set up manually
            </button>
          </div>
        )}

        {/* Manual fields — shown for non-openclaw types, manual mode, or when not detected */}
        {(manualMode || (!detecting && !isAutoDetected)) && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Gateway URL</label>
              <Input
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="http://localhost:18790"
                className="text-sm h-8"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Token</label>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Bearer token for hooks endpoint"
                className="text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                For OpenClaw agents, use the <code className="bg-muted px-0.5 rounded">hooks.token</code> from your openclaw.json config.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Hooks path</label>
              <Input
                value={hooksPath}
                onChange={(e) => setHooksPath(e.target.value)}
                placeholder="/hooks/agent"
                className="text-sm h-8"
              />
            </div>
          </>
        )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={configMut.isPending}
          >
            {configMut.isPending ? "Adding..." : isAutoDetected ? "Add & Pair" : "Add Agent"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
