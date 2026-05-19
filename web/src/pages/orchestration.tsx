import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"
import {
  ArrowLeft,
  Beaker,
  Bot,
  CheckCircle2,
  Brain,
  ChevronRight,
  Cpu,
  Database,
  Download,
  FileJson,
  GitBranch,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
  Wrench,
  Workflow,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/shared/empty-state"
import { PageLoading } from "@/components/shared/page-loading"
import { cn, statusBadgeClass } from "@/lib/utils"
import { toast } from "sonner"
import { usePullOllamaModel, useOllamaRuntimeStatus, useStartOllamaRuntime } from "@/hooks/use-models"
import { useBuildEvalCaseFromTrace, useCreateEvalSuite, useEvalSuites } from "@/hooks/use-evals"
import {
  useOpenclawOrchestrationSettings,
  useUpdateOpenclawOrchestrationSettings,
} from "@/hooks/use-openclaw-orchestration"
import {
  useOrchestrationRunDetail,
  useOrchestrationRuns,
  type OrchestrationPromptRecord,
  type OrchestrationRunRecord,
  type OrchestrationRunListItem,
  type OrchestrationStepRecord,
} from "@/hooks/use-orchestration"
import { getOllamaModelsStatus } from "@/lib/api"
import type { EvalCaseDraftFromTrace } from "@/lib/eval-types"
import { useQuery } from "@tanstack/react-query"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function formatDateTime(value?: string) {
  if (!value) return "Unknown"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function previewText(value: unknown, max = 180) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  if (!text) return "No inbound text captured"
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "0"
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function firstUserHistoryText(historyMessages: unknown[] | undefined) {
  if (!Array.isArray(historyMessages)) return ""
  for (const entry of historyMessages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (record.role !== "user") continue
    const direct =
      typeof record.content === "string"
        ? record.content
        : typeof record.text === "string"
          ? record.text
          : ""
    const trimmed = direct.trim()
    if (trimmed) return trimmed
  }
  return ""
}

function resolveRunInboundText(
  run: OrchestrationRunRecord,
  prompts: OrchestrationPromptRecord[] = [],
) {
  const explicit = typeof run.inboundText === "string" ? run.inboundText.trim() : ""
  if (explicit) return explicit
  const inboundBody = typeof asRecord(run.inbound)?.body === "string"
    ? String(asRecord(run.inbound)?.body).trim()
    : ""
  if (inboundBody) return inboundBody
  for (const prompt of prompts) {
    const fromHistory = firstUserHistoryText(prompt.historyMessages)
    if (fromHistory) return fromHistory
  }
  return ""
}

function summarizeValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.length ? `${value.length} items` : "0 items"
  if (value && typeof value === "object") return `${Object.keys(value).length} fields`
  return "n/a"
}

function promptUsageTotal(prompt: OrchestrationPromptRecord, key: keyof NonNullable<OrchestrationPromptRecord["usage"]>) {
  return typeof prompt.usage?.[key] === "number" ? prompt.usage[key]! : 0
}

function countToolSteps(steps: OrchestrationStepRecord[]) {
  return steps.filter((step) => step.stage.startsWith("tool:call")).length
}

function countStagePrefix(steps: OrchestrationStepRecord[], prefix: string) {
  return steps.filter((step) => step.stage.startsWith(prefix)).length
}

function getPacketToolAllowlist(packet: unknown) {
  return asStringList(asRecord(packet)?.toolAllowlist)
}

function stagePhase(stage: string) {
  if (stage.includes("error")) return "errors"
  if (
    stage.includes("route") ||
    stage.startsWith("hook:") ||
    stage.startsWith("dispatch:before_inbound") ||
    stage.startsWith("dispatch:fast_abort")
  ) {
    return "routing"
  }
  if (stage.startsWith("reply:") || stage.startsWith("dispatch:start")) {
    return "preparation"
  }
  if (stage.startsWith("llm_")) return "llm"
  if (stage.startsWith("tool:")) return "tools"
  if (stage.startsWith("dispatch:")) return "delivery"
  return "other"
}

function groupStepsByPhase(steps: OrchestrationStepRecord[]) {
  const groups = new Map<
    string,
    {
      key: string
      label: string
      icon: typeof GitBranch
      steps: OrchestrationStepRecord[]
    }
  >()
  const definitions: Record<string, { label: string; icon: typeof GitBranch }> = {
    routing: { label: "Routing", icon: GitBranch },
    preparation: { label: "Preparation", icon: Workflow },
    llm: { label: "Model Calls", icon: Brain },
    tools: { label: "Tool Activity", icon: Wrench },
    delivery: { label: "Delivery", icon: Send },
    errors: { label: "Errors", icon: TriangleAlert },
    other: { label: "Other", icon: FileJson },
  }

  for (const step of steps) {
    const key = stagePhase(step.stage)
    const definition = definitions[key]
    const existing = groups.get(key) ?? { key, label: definition.label, icon: definition.icon, steps: [] }
    existing.steps.push(step)
    groups.set(key, existing)
  }

  const order = ["routing", "preparation", "llm", "tools", "delivery", "errors", "other"]
  return order.map((key) => groups.get(key)).filter((group): group is NonNullable<typeof group> => Boolean(group))
}

function formatDurationMs(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "n/a"
  if (value < 1000) return `${value}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function phaseDurationMs(steps: OrchestrationStepRecord[]) {
  if (!steps.length) return null
  const timestamps = steps
    .map((step) => (step.timestamp ? Date.parse(step.timestamp) : Number.NaN))
    .filter((value) => Number.isFinite(value))
  if (!timestamps.length) return null
  return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps))
}

function uniqueToolNames(steps: OrchestrationStepRecord[]) {
  return Array.from(
    new Set(
      steps
        .map((step) => {
          const toolName = step.data && typeof step.data.toolName === "string" ? step.data.toolName : ""
          return toolName.trim()
        })
        .filter(Boolean),
    ),
  )
}

function firstErrorText(steps: OrchestrationStepRecord[]) {
  for (const step of steps) {
    const error = step.data && typeof step.data.error === "string" ? step.data.error.trim() : ""
    if (error) return error
  }
  return ""
}

function compactStageLabel(stage: string) {
  const labels: Record<string, string> = {
    "route:evaluated": "Route evaluated",
    "router:model": "Router model decision",
    "router:error": "Router model error",
    "router:parse_error": "Router parse error",
    "reply:start": "Reply pipeline started",
    "reply:workspace:start": "Workspace init start",
    "reply:workspace:end": "Workspace ready",
    "reply:workspace:error": "Workspace init failed",
    "reply:context_finalize:start": "Context finalize start",
    "reply:context_finalize:end": "Context finalized",
    "reply:session_init:start": "Session init start",
    "reply:session_init:end": "Session initialized",
    "reply:session_init:error": "Session init failed",
    "reply:session_initialized": "Session state loaded",
    "reply:directives:start": "Directive resolution start",
    "reply:directives:end": "Directive resolution end",
    "reply:directives:error": "Directive resolution failed",
    "reply:short_circuit": "Short-circuited before execution",
    "llm_input": "Model input recorded",
    "llm_output": "Model output recorded",
    "tool:call": "Tool called",
    "tool:result": "Tool result received",
    "tool:error": "Tool failed",
    "dispatch:start": "Dispatch started",
    "dispatch:final_reply": "Final reply delivered",
    "dispatch:tool_result": "Tool result delivered",
    "dispatch:block_reply": "Block reply delivered",
    "dispatch:end": "Dispatch completed",
    "dispatch:error": "Dispatch failed",
  }
  return labels[stage] ?? stage.replace(/[:_]/g, " ")
}

type PromptSetSummary = ReturnType<typeof summarizePromptSet>

function buildTraceNarrative(params: {
  run: OrchestrationRunRecord
  inboundText: string
  promptSummaries: PromptSetSummary[]
  steps: OrchestrationStepRecord[]
}) {
  const { run, inboundText, promptSummaries, steps } = params
  const lines: string[] = []
  const routerSummary = promptSummaries.find((entry) => entry.kind === "router")
  const executionSummary = promptSummaries.find((entry) => entry.kind === "execution")
  const route = typeof run.finalRoute === "string" ? run.finalRoute : "unknown"
  const assignedAgent = typeof run.assignedAgentId === "string" ? run.assignedAgentId : "unknown agent"
  const toolNames = uniqueToolNames(steps)
  const status = typeof run.status === "string" ? run.status : "unknown"
  const routerSource =
    run.router && typeof asRecord(run.router)?.source === "string"
      ? String(asRecord(run.router)?.source)
      : undefined

  lines.push(
    inboundText
      ? `Inbound message: "${previewText(inboundText, 120)}".`
      : "Inbound message was received, but no body was stored on the run snapshot.",
  )
  if (routerSummary?.provider && routerSummary?.model) {
    lines.push(
      `Routing used ${routerSummary.provider}/${routerSummary.model} and chose ${route}${routerSource ? ` (${routerSource})` : ""}.`,
    )
  } else {
    lines.push(`Routing resolved to ${route} for ${assignedAgent}.`)
  }
  if (executionSummary?.provider && executionSummary?.model) {
    lines.push(
      `Execution ran on ${executionSummary.provider}/${executionSummary.model} for ${assignedAgent}.`,
    )
  } else if (route === "local_fast_path") {
    lines.push("The request was intended for local execution, but no execution model call was recorded.")
  } else {
    lines.push(`The assigned specialist remained ${assignedAgent}.`)
  }
  lines.push(
    toolNames.length
      ? `Tools used: ${toolNames.join(", ")}.`
      : "No tools were used during this run.",
  )
  if (status.includes("error")) {
    lines.push(`The run ended in error: ${firstErrorText(steps) || String(run.error ?? status)}.`)
  } else {
    lines.push(`The run completed with status ${status}.`)
  }
  return lines
}

function buildPhaseSummary(params: {
  key: string
  label: string
  steps: OrchestrationStepRecord[]
  run: OrchestrationRunRecord
  routerPromptSummary: PromptSetSummary | null
  executionPromptSummary: PromptSetSummary | null
}) {
  const { key, label, steps, run, routerPromptSummary, executionPromptSummary } = params
  const duration = formatDurationMs(phaseDurationMs(steps))
  const reasons = asStringList(run.reasons)
  const blockers = asStringList(run.blockers)
  const route = typeof run.finalRoute === "string" ? run.finalRoute : "unknown"
  const confidence =
    typeof run.confidence === "number" && Number.isFinite(run.confidence)
      ? run.confidence.toFixed(2)
      : "n/a"

  if (key === "routing") {
    return {
      headline: `The system decided on ${route}.`,
      details: [
        routerPromptSummary?.provider && routerPromptSummary?.model
          ? `Router model: ${routerPromptSummary.provider}/${routerPromptSummary.model}.`
          : "No dedicated router prompt snapshot was recorded.",
        reasons.length ? `Why: ${reasons.join(", ")}.` : "No explicit routing reasons were stored.",
        blockers.length ? `Blockers: ${blockers.join(", ")}.` : "No blockers were recorded.",
      ],
      metrics: [
        { label: "Route", value: route },
        { label: "Confidence", value: confidence },
        { label: "Steps", value: formatCount(steps.length) },
        { label: "Duration", value: duration },
      ],
    }
  }

  if (key === "preparation") {
    const packetTextLength =
      run.packet && typeof asRecord(run.packet)?.packetText === "string"
        ? String(asRecord(run.packet)?.packetText).length
        : 0
    const sessionStep = steps.find((step) => step.stage === "reply:session_initialized")
    const sessionKey =
      sessionStep?.data && typeof sessionStep.data.sessionKey === "string"
        ? sessionStep.data.sessionKey
        : typeof run.sessionKey === "string"
          ? run.sessionKey
          : "unknown"
    return {
      headline: "Context, session state, and runtime inputs were prepared.",
      details: [
        `Session: ${sessionKey}.`,
        packetTextLength > 0
          ? `A packetized context was built (${packetTextLength.toLocaleString()} chars).`
          : "No packetized context was stored for this run.",
        steps.some((step) => step.stage === "reply:workspace:end")
          ? "Workspace initialization completed."
          : "Workspace initialization was skipped or not recorded.",
      ],
      metrics: [
        { label: "Steps", value: formatCount(steps.length) },
        { label: "Packet Chars", value: formatCount(packetTextLength) },
        { label: "Flow Context", value: formatCount(asRecord(run.inbound)?.flowContext ? (asRecord(run.inbound)?.flowContext as unknown[]).length : 0) },
        { label: "Duration", value: duration },
      ],
    }
  }

  if (key === "llm") {
    const hasExecution = Boolean(executionPromptSummary?.provider && executionPromptSummary?.model)
    return {
      headline: hasExecution
        ? `The execution model produced a response on ${executionPromptSummary?.provider}/${executionPromptSummary?.model}.`
        : "No execution model call completed in this phase.",
      details: [
        hasExecution
          ? `Input tokens: ${formatCount(executionPromptSummary?.inputTokens ?? 0)}. Output tokens: ${formatCount(executionPromptSummary?.outputTokens ?? 0)}.`
          : "If the run stopped earlier, routing may have succeeded without a later execution call.",
        executionPromptSummary?.toolDefinitions
          ? `Visible tool schemas: ${formatCount(executionPromptSummary.toolDefinitions)}.`
          : "No execution tool schemas were captured.",
      ],
      metrics: [
        { label: "Steps", value: formatCount(steps.length) },
        { label: "Input Tokens", value: formatCount(executionPromptSummary?.inputTokens ?? 0) },
        { label: "Output Tokens", value: formatCount(executionPromptSummary?.outputTokens ?? 0) },
        { label: "Duration", value: duration },
      ],
    }
  }

  if (key === "tools") {
    const toolNames = uniqueToolNames(steps)
    return {
      headline: toolNames.length
        ? `${toolNames.length} tool${toolNames.length === 1 ? "" : "s"} ran during execution.`
        : "No tools ran in this phase.",
      details: [
        toolNames.length ? `Tools: ${toolNames.join(", ")}.` : "The model answered without tool use.",
        steps.some((step) => step.stage === "tool:error")
          ? `One or more tools failed: ${firstErrorText(steps) || "see raw trace for details"}.`
          : "No tool errors were recorded.",
      ],
      metrics: [
        { label: "Steps", value: formatCount(steps.length) },
        { label: "Unique Tools", value: formatCount(toolNames.length) },
        { label: "Errors", value: formatCount(steps.filter((step) => step.stage === "tool:error").length) },
        { label: "Duration", value: duration },
      ],
    }
  }

  if (key === "delivery") {
    return {
      headline: typeof run.status === "string" && run.status.includes("error")
        ? "The gateway did not finish delivery cleanly."
        : "The gateway delivered the final outcome.",
      details: [
        typeof run.outcome === "string" ? `Outcome: ${run.outcome}.` : "No explicit outcome field was stored.",
        run.counts && typeof run.counts === "object"
          ? `Queued counts: ${formatJson(run.counts)}`
          : "No queued reply counts were stored.",
      ],
      metrics: [
        { label: "Steps", value: formatCount(steps.length) },
        { label: "Final Replies", value: formatCount(steps.filter((step) => step.stage === "dispatch:final_reply").length) },
        { label: "Tool Deliveries", value: formatCount(steps.filter((step) => step.stage === "dispatch:tool_result").length) },
        { label: "Duration", value: duration },
      ],
    }
  }

  if (key === "errors") {
    return {
      headline: "Errors were recorded in this run.",
      details: [
        firstErrorText(steps) || "Open the raw trace to inspect the exact error payload.",
      ],
      metrics: [
        { label: "Steps", value: formatCount(steps.length) },
        { label: "First Error", value: firstErrorText(steps) || "n/a" },
        { label: "Status", value: typeof run.status === "string" ? run.status : "unknown" },
        { label: "Duration", value: duration },
      ],
    }
  }

  return {
    headline: `${label} recorded ${steps.length} raw event${steps.length === 1 ? "" : "s"}.`,
    details: ["Open the raw trace section for the exact low-level payloads."],
    metrics: [
      { label: "Steps", value: formatCount(steps.length) },
      { label: "Duration", value: duration },
    ],
  }
}

function summarizePromptSet([runId, prompts]: [string, OrchestrationPromptRecord[]]) {
  const inputs = prompts.filter((prompt) => prompt.kind === "input")
  const outputs = prompts.filter((prompt) => prompt.kind === "output")
  return {
    runId,
    kind: runId.startsWith("router-") ? "router" : "execution",
    provider:
      inputs.find((prompt) => prompt.provider && prompt.model)?.provider ??
      outputs.find((prompt) => prompt.provider && prompt.model)?.provider,
    model:
      inputs.find((prompt) => prompt.provider && prompt.model)?.model ??
      outputs.find((prompt) => prompt.provider && prompt.model)?.model,
    inputTokens: outputs.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "input"), 0),
    outputTokens: outputs.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "output"), 0),
    totalTokens: outputs.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "total"), 0),
    toolDefinitions: inputs.reduce((sum, prompt) => sum + (prompt.toolDefinitions?.length ?? 0), 0),
    inputChars: inputs.reduce(
      (sum, prompt) => sum + (prompt.systemPrompt?.length ?? 0) + (prompt.prompt?.length ?? 0),
      0,
    ),
  }
}

function stageTone(stage: string) {
  if (stage.startsWith("tool:error") || stage.includes("error")) {
    return "border-red-500/30 bg-red-500/5"
  }
  if (stage.startsWith("tool:")) {
    return "border-amber-500/30 bg-amber-500/5"
  }
  if (stage.startsWith("dispatch:")) {
    return "border-emerald-500/30 bg-emerald-500/5"
  }
  if (stage.includes("llm")) {
    return "border-blue-500/30 bg-blue-500/5"
  }
  return "border-border bg-card"
}

function phaseTone(key: string) {
  if (key === "errors") {
    return "border-red-500/30 bg-red-500/5"
  }
  if (key === "tools") {
    return "border-amber-500/30 bg-amber-500/5"
  }
  if (key === "delivery") {
    return "border-emerald-500/30 bg-emerald-500/5"
  }
  if (key === "execution") {
    return "border-blue-500/30 bg-blue-500/5"
  }
  return "border-border bg-muted/20"
}

function phaseAccentText(key: string) {
  if (key === "errors") return "text-red-700 dark:text-red-300"
  if (key === "tools") return "text-amber-700 dark:text-amber-300"
  if (key === "delivery") return "text-emerald-700 dark:text-emerald-300"
  if (key === "execution") return "text-blue-700 dark:text-blue-300"
  return ""
}

function stageIcon(stage: string) {
  if (stage.startsWith("tool:")) return Wrench
  if (stage.includes("route")) return GitBranch
  if (stage.includes("llm")) return Brain
  if (stage.startsWith("dispatch:final_reply") || stage.startsWith("dispatch:tool_result")) return Send
  if (stage.startsWith("dispatch:")) return Workflow
  return FileJson
}

function routeBadgeClass(route?: string) {
  if (route === "local_fast_path") return statusBadgeClass("success")
  if (route === "default_specialist") return statusBadgeClass("info")
  return ""
}

function JsonBlock({ value, maxHeight = "max-h-96" }: { value: unknown; maxHeight?: string }) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-lg border bg-muted/30 p-3 text-[11px] leading-5 text-foreground whitespace-pre-wrap break-words",
        maxHeight,
      )}
    >
      {formatJson(value)}
    </pre>
  )
}

function TextBlock({ value, label }: { value?: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-[12px] leading-5 whitespace-pre-wrap break-words">
        {value?.trim() || "None"}
      </pre>
    </div>
  )
}

function BadgeList({
  label,
  values,
  emptyLabel = "None",
  tone,
}: {
  label: string
  values: string[]
  emptyLabel?: string
  tone?: "default" | "danger"
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge
              key={value}
              variant="outline"
              className={cn(
                "max-w-full break-all whitespace-normal text-left font-mono text-[11px]",
                tone === "danger" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
              )}
            >
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}

function KeyValueGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 min-[1900px]:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-lg border bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-1 break-words text-sm font-medium">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function PromptCard({
  prompt,
  onOpenRaw,
}: {
  prompt: OrchestrationPromptRecord
  onOpenRaw: (path: string) => void
}) {
  const toolCount = prompt.toolDefinitions?.length ?? 0
  const historyCount = prompt.historyMessages?.length ?? 0
  const systemChars = prompt.systemPrompt?.length ?? 0
  const userChars = prompt.prompt?.length ?? 0
  const assistantPreview = prompt.assistantTexts?.join("\n\n") ?? ""
  const promptError =
    prompt.lastAssistant &&
    typeof prompt.lastAssistant === "object" &&
    !Array.isArray(prompt.lastAssistant) &&
    (prompt.lastAssistant as Record<string, unknown>).stopReason === "error" &&
    typeof (prompt.lastAssistant as Record<string, unknown>).errorMessage === "string"
      ? String((prompt.lastAssistant as Record<string, unknown>).errorMessage)
      : ""
  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="uppercase tracking-wide">
                {prompt.runId.startsWith("router-") ? "Router" : "Execution"}
              </Badge>
              <Badge variant="outline">{prompt.kind}</Badge>
              {prompt.provider && prompt.model ? (
                <Badge variant="secondary" className="max-w-full break-all whitespace-normal text-left">
                  {prompt.provider}/{prompt.model}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">{formatDateTime(prompt.timestamp)}</span>
            </div>
            <CardTitle className="break-words text-sm font-medium">
              {prompt.runId.startsWith("router-") ? "Gemma router call" : `Run ${prompt.runId}`}
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenRaw(prompt.path)}>
            <Database className="mr-2 h-4 w-4" />
            Raw
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {prompt.kind === "input" ? (
          <KeyValueGrid
            items={[
              { label: "System Chars", value: formatCount(systemChars) },
              { label: "User Chars", value: formatCount(userChars) },
              { label: "History Messages", value: formatCount(historyCount) },
              { label: "Tool Definitions", value: formatCount(toolCount) },
            ]}
          />
        ) : (
          <KeyValueGrid
            items={[
              { label: "Input Tokens", value: formatCount(promptUsageTotal(prompt, "input")) },
              { label: "Output Tokens", value: formatCount(promptUsageTotal(prompt, "output")) },
              { label: "Cache Read", value: formatCount(promptUsageTotal(prompt, "cacheRead")) },
              { label: "Total Tokens", value: formatCount(promptUsageTotal(prompt, "total")) },
            ]}
          />
        )}

        <Tabs defaultValue={prompt.kind === "input" ? "system" : "output"} className="space-y-3">
          <TabsList
            className={cn(
              "grid h-auto w-full gap-1",
              prompt.kind === "input"
                ? historyCount
                  ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
                  : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                : "grid-cols-1 min-[420px]:grid-cols-3",
            )}
          >
            {prompt.kind === "input" ? (
              <>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="system">System</TabsTrigger>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="user">User</TabsTrigger>
                {historyCount ? (
                  <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="history">History</TabsTrigger>
                ) : null}
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="tools">Tools</TabsTrigger>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="report">Report</TabsTrigger>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="raw">Raw</TabsTrigger>
              </>
            ) : (
              <>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="output">Output</TabsTrigger>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="payload">Payload</TabsTrigger>
                <TabsTrigger className="h-auto whitespace-normal px-2 py-2 text-xs sm:text-sm" value="raw">Raw</TabsTrigger>
              </>
            )}
          </TabsList>

          {prompt.kind === "input" ? (
            <>
              <TabsContent value="system" className="space-y-3">
                <TextBlock value={prompt.systemPrompt} label="System Prompt" />
              </TabsContent>
              <TabsContent value="user" className="space-y-3">
                <TextBlock value={prompt.prompt} label="User Prompt" />
              </TabsContent>
              {historyCount ? (
                <TabsContent value="history" className="space-y-3">
                  <JsonBlock value={prompt.historyMessages} maxHeight="max-h-[22rem]" />
                </TabsContent>
              ) : null}
              <TabsContent value="tools" className="space-y-3">
                <BadgeList label="Tool Allowlist" values={prompt.toolAllowlist ?? []} emptyLabel="No tool allowlist stored" />
                {prompt.toolDefinitions?.length ? (
                  <div className="space-y-3">
                    {prompt.toolDefinitions.map((tool) => (
                      <div key={tool.name} className="rounded-md border bg-background/80 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="font-mono">
                            {tool.name}
                          </Badge>
                          {tool.label ? <span className="break-words text-xs text-muted-foreground">{tool.label}</span> : null}
                        </div>
                        {tool.description ? <p className="mt-2 text-sm text-muted-foreground">{tool.description}</p> : null}
                        {tool.parameters ? <JsonBlock value={tool.parameters} maxHeight="max-h-60" /> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No tool definitions recorded.</p>
                )}
              </TabsContent>
              <TabsContent value="report" className="space-y-3">
                {prompt.systemPromptReport ? (
                  <JsonBlock value={prompt.systemPromptReport} maxHeight="max-h-[32rem]" />
                ) : (
                  <p className="text-sm text-muted-foreground">No prompt composition report recorded.</p>
                )}
              </TabsContent>
              <TabsContent value="raw" className="space-y-3">
                <JsonBlock value={prompt} maxHeight="max-h-[36rem]" />
              </TabsContent>
            </>
          ) : (
            <>
              <TabsContent value="output" className="space-y-3">
                {assistantPreview ? (
                  <TextBlock value={assistantPreview} label="Assistant Output" />
                ) : promptError ? (
                  <div className="rounded-lg border border-red-300/80 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-100">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
                      Model Error
                    </div>
                    <div className="mt-2 break-words font-medium">{promptError}</div>
                  </div>
                ) : (
                  <TextBlock value="" label="Assistant Output" />
                )}
              </TabsContent>
              <TabsContent value="payload" className="space-y-3">
                {prompt.lastAssistant !== undefined ? (
                  <JsonBlock value={prompt.lastAssistant} maxHeight="max-h-[32rem]" />
                ) : (
                  <p className="text-sm text-muted-foreground">No raw assistant payload recorded.</p>
                )}
              </TabsContent>
              <TabsContent value="raw" className="space-y-3">
                <JsonBlock value={prompt} maxHeight="max-h-[36rem]" />
              </TabsContent>
            </>
          )}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "danger"
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-3",
        tone === "danger" ? "border-red-500/30 bg-red-500/5" : "bg-muted/20",
      )}
    >
      <div
        className={cn(
          "text-[11px] uppercase tracking-[0.18em] text-muted-foreground",
          tone === "danger" && "text-red-700/80 dark:text-red-300/80",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1 break-words text-base font-semibold sm:text-lg",
          tone === "danger" && "text-red-950 dark:text-red-100",
        )}
      >
        {value}
      </div>
    </div>
  )
}

function NarrativeCard({ lines }: { lines: string[] }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquareText className="h-4 w-4" />
          Trace Story
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="flex gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold">
              {index + 1}
            </div>
            <p className="text-sm leading-6 text-foreground">{line}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function HumanPhaseCard({
  label,
  icon: Icon,
  steps,
  run,
  routerPromptSummary,
  executionPromptSummary,
}: {
  label: string
  icon: typeof GitBranch
  steps: OrchestrationStepRecord[]
  run: OrchestrationRunRecord
  routerPromptSummary: PromptSetSummary | null
  executionPromptSummary: PromptSetSummary | null
}) {
  const key = stagePhase(steps[0]?.stage ?? label.toLowerCase())
  const summary = buildPhaseSummary({
    key,
    label,
    steps,
    run,
    routerPromptSummary,
    executionPromptSummary,
  })
  return (
    <Card className={cn("shadow-none", key === "errors" ? "border-red-500/30 bg-red-500/5" : "")}>
      <CardHeader className="pb-3">
        <CardTitle className={cn("flex items-center gap-2 text-sm", phaseAccentText(key))}>
          <Icon className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn("rounded-xl border p-4", phaseTone(key))}>
          <p className={cn("text-sm font-medium", phaseAccentText(key))}>{summary.headline}</p>
          <div className="mt-3 space-y-2">
            {summary.details.map((detail) => (
              <p
                key={detail}
                className={cn("text-sm text-muted-foreground", key === "errors" ? "text-red-700/90 dark:text-red-300/90" : "")}
              >
                {detail}
              </p>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 2xl:grid-cols-4">
          {summary.metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              tone={key === "errors" ? "danger" : "default"}
            />
          ))}
        </div>
        <details className={cn("rounded-lg border p-3", key === "errors" ? "border-red-500/30 bg-red-500/5" : "bg-muted/10")}>
          <summary className="cursor-pointer text-sm font-medium">
            Stage details ({steps.length} raw event{steps.length === 1 ? "" : "s"})
          </summary>
          <div className="mt-3 space-y-2">
            {steps.map((step) => (
              <div key={step.path} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {compactStageLabel(step.stage)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(step.timestamp)}</span>
                </div>
                {step.data ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {summarizeValue(
                      step.data.error ??
                        step.data.note ??
                        step.data.kind ??
                        step.data.source ??
                        step.data.toolName ??
                        step.data.result ??
                        step.data.selectedAgentId ??
                        step.data.provider,
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

function RawTraceSection({ phaseGroups }: { phaseGroups: ReturnType<typeof groupStepsByPhase> }) {
  return (
    <details className="rounded-xl border bg-muted/10 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Show raw trace events
      </summary>
      <div className="mt-4 space-y-4">
        {phaseGroups.map((group) => (
          <div key={group.key} className="space-y-4">
            <div className="flex items-center gap-2">
              <group.icon className="h-4 w-4" />
              <h3 className="text-sm font-semibold">{group.label}</h3>
              <Badge variant="outline">{group.steps.length}</Badge>
            </div>
            <div className="space-y-4">
              {group.steps.map((step) => (
                <TimelineStep key={step.path} step={step} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

function TimelineGuideCard() {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Workflow className="h-4 w-4" />
          How To Read This Trace
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 min-[1300px]:grid-cols-3 min-[1900px]:grid-cols-5">
        {[
          ["Inbound", "What came in from Telegram or another channel."],
          ["Routing", "How the system chose local fast-path or a specialist."],
          ["Context Build", "What session, packet, and runtime prep happened before execution."],
          ["Execution", "What model ran and what it answered."],
          ["Delivery", "What the gateway actually sent outward."],
        ].map(([label, text]) => (
          <div key={label} className="rounded-lg border bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PhaseBreakdownCard({ phaseGroups }: { phaseGroups: ReturnType<typeof groupStepsByPhase> }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Workflow className="h-4 w-4" />
          Phase Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 min-[1900px]:grid-cols-3">
        {phaseGroups.map((group) => (
          <div key={group.key} className={cn("rounded-xl border p-4", phaseTone(group.key))}>
            <div className={cn("flex items-center gap-2", phaseAccentText(group.key))}>
              <group.icon className="h-4 w-4" />
              <div className="text-sm font-medium">{group.label}</div>
            </div>
            <div className="mt-3 grid gap-2">
              <MetricCard
                label="Steps"
                value={formatCount(group.steps.length)}
                tone={group.key === "errors" ? "danger" : "default"}
              />
              <MetricCard
                label="Duration"
                value={formatDurationMs(phaseDurationMs(group.steps))}
                tone={group.key === "errors" ? "danger" : "default"}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RoutingSettingsCard() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const settingsQuery = useOpenclawOrchestrationSettings()
  const modelsQuery = useQuery({
    queryKey: ["agents", "ollama-models"],
    queryFn: getOllamaModelsStatus,
    staleTime: 10_000,
  })
  const runtimeQuery = useOllamaRuntimeStatus()
  const updateSettingsMut = useUpdateOpenclawOrchestrationSettings()
  const pullModelMut = usePullOllamaModel()
  const startRuntimeMut = useStartOllamaRuntime()

  const settings = settingsQuery.data
  const settingsError = settingsQuery.error instanceof Error ? settingsQuery.error.message : null
  const gemmaReady = (modelsQuery.data?.models ?? []).some((model) => model.name === "gemma4:e4b")
  const runtimeInstalled = Boolean(runtimeQuery.data?.installed)
  const runtimeRunning = Boolean(runtimeQuery.data?.running)
  const gemmaBlockedByStoppedRuntime = !gemmaReady && runtimeInstalled && !runtimeRunning
  const canEnable =
    settings?.detected &&
    !settings?.optimizationEnabled &&
    !updateSettingsMut.isPending
  const loading = settingsQuery.isLoading || modelsQuery.isLoading

  const handleEnable = async (enabled: boolean) => {
    try {
      await updateSettingsMut.mutateAsync({ enabled })
      if (enabled && !gemmaReady) {
        toast.success("Optimization enabled. Download Gemma e4b to activate the local path.")
      } else {
        toast.success(enabled ? "Optimization enabled" : "Optimization disabled")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update optimization settings")
    }
  }

  const handleDownload = async () => {
    try {
      await pullModelMut.mutateAsync("gemma4:e4b")
      toast.success("Gemma 4 e4b downloaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download gemma4:e4b")
    }
  }

  const handleStartRuntime = async () => {
    try {
      await startRuntimeMut.mutateAsync()
      toast.success("Local runtime started")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start local runtime")
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 shrink-0 gap-2 px-3"
        onClick={() => setDialogOpen(true)}
      >
        <span className="font-medium">
          {loading
            ? "Routing"
            : settingsError
              ? "Optimization unavailable"
              : !settings?.detected
                ? "Optimization unavailable"
                : settings.optimizationEnabled
                  ? "Optimization on"
                  : "Optimization off"}
        </span>
        {!loading && !settingsError && settings?.detected ? (
          <Badge
            variant="outline"
            className={cn(
              "hidden h-6 px-2 text-[11px] min-[420px]:inline-flex",
              settings.optimizationEnabled ? routeBadgeClass("local_fast_path") : "",
            )}
          >
            {settings.optimizationEnabled ? "enabled" : "disabled"}
          </Badge>
        ) : null}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Optimize With Local Routing</DialogTitle>
            <DialogDescription>
              Try simple tasks locally first, then delegate to the right specialist when needed.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <PageLoading variant="spinner" message="Loading optimization settings..." />
          ) : settingsError ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-sm text-muted-foreground space-y-2">
              <div className="font-medium text-foreground">Optimization settings could not be loaded.</div>
              <div>{settingsError}</div>
              <div>Vault needs the orchestration API route on the backend before this switch can be used.</div>
            </div>
          ) : !settings?.detected ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              <div>Local OpenClaw config was not detected. Vault cannot control routing until `openclaw.json` is available.</div>
              <div className="mt-2">Vault looked for the config in the default local path and the workspace dev config path.</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <div className="font-medium text-foreground">Experimental</div>
                    <div className="mt-1">
                      Local routing is still experimental. Running Gemma locally can use significant RAM and may slow the machine noticeably while routing or answering.
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Optimization</div>
                        <div className="mt-1 text-sm font-medium">{settings.optimizationEnabled ? "Enabled" : "Disabled"}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          When enabled, Straja routes with local Gemma and answers trivial tasks locally before delegating to specialists.
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={settings.optimizationEnabled ? routeBadgeClass("local_fast_path") : ""}
                      >
                        {settings.optimizationEnabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                    <div>
                      {settings.optimizationEnabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={updateSettingsMut.isPending}
                          onClick={() => void handleEnable(false)}
                        >
                          Disable
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!canEnable}
                          onClick={() => void handleEnable(true)}
                        >
                          Enable
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Gemma e4b</div>
                      <div className="mt-1 text-sm font-medium">
                        {gemmaReady ? "Installed" : gemmaBlockedByStoppedRuntime ? "Check when started" : "Missing"}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {gemmaBlockedByStoppedRuntime
                          ? "Ollama is stopped, so Vault cannot verify whether Gemma e4b is already installed."
                          : "Optimization uses `ollama/gemma4:e4b` for routing and token-saving local-first handling."}
                      </div>
                    </div>
                    {gemmaReady ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : gemmaBlockedByStoppedRuntime ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={startRuntimeMut.isPending}
                        onClick={() => void handleStartRuntime()}
                      >
                        {startRuntimeMut.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Start
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={pullModelMut.isPending || runtimeQuery.data?.available === false}
                        onClick={() => void handleDownload()}
                      >
                        {pullModelMut.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground space-y-1">
                <div>{settings.configPath ? `Config: ${settings.configPath}` : "Config path unavailable"}</div>
                <div>{runtimeQuery.data?.baseUrl ? `Ollama: ${runtimeQuery.data.baseUrl}` : "Ollama runtime not detected"}</div>
              </div>
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  )
}

function TimelineStep({ step }: { step: OrchestrationStepRecord }) {
  const Icon = stageIcon(step.stage)
  const stepData = step.data ?? {}
  const reasons = asStringList(stepData.reasons)
  const blockers = asStringList(stepData.blockers)
  const toolAllowlist = asStringList(stepData.toolAllowlist)
  const assistantTexts = asStringList(stepData.assistantTexts)
  const toolName = typeof stepData.toolName === "string" ? stepData.toolName : undefined
  const toolCallId = typeof stepData.toolCallId === "string" ? stepData.toolCallId : undefined
  const provider = typeof stepData.provider === "string" ? stepData.provider : undefined
  const model = typeof stepData.model === "string" ? stepData.model : undefined
  const systemPrompt = typeof stepData.systemPrompt === "string" ? stepData.systemPrompt : undefined
  const prompt = typeof stepData.prompt === "string" ? stepData.prompt : undefined
  return (
    <div className="relative pl-10">
      <div className="absolute left-[15px] top-0 h-full w-px bg-border" />
      <div className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div className={cn("mb-4 rounded-xl border p-4", stageTone(step.stage))}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            {step.stage}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatDateTime(step.timestamp)}</span>
        </div>
        <div className="mt-3 space-y-3">
          {toolName ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary" className="font-mono">
                {toolName}
              </Badge>
              {toolCallId ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {toolCallId}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {provider && model ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {provider}/{model}
              </Badge>
            </div>
          ) : null}
          {reasons.length ? <BadgeList label="Reasons" values={reasons} /> : null}
          {blockers.length ? <BadgeList label="Blockers" values={blockers} tone="danger" /> : null}
          {toolAllowlist.length ? <BadgeList label="Tool Allowlist" values={toolAllowlist} /> : null}
          {systemPrompt ? <TextBlock value={systemPrompt} label="System Prompt" /> : null}
          {prompt ? <TextBlock value={prompt} label="Prompt" /> : null}
          {assistantTexts.length ? <TextBlock value={assistantTexts.join("\n\n")} label="Assistant Output" /> : null}
          <JsonBlock value={stepData} maxHeight="max-h-[24rem]" />
        </div>
      </div>
    </div>
  )
}

function RunListItemRow({
  item,
  selected,
  onSelect,
}: {
  item: OrchestrationRunListItem
  selected: boolean
  onSelect: () => void
}) {
  const inbound = resolveRunInboundText(item.run)
  const route = typeof item.run.finalRoute === "string" ? item.run.finalRoute : undefined
  const executionProvider = typeof item.run.executionProvider === "string" ? item.run.executionProvider : undefined
  const executionModel = typeof item.run.executionModel === "string" ? item.run.executionModel : undefined
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent" : "hover:bg-muted/50",
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium truncate block">
          {previewText(inbound, 64)}
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {route ? (
            <Badge variant="outline" className={cn("max-w-full truncate", routeBadgeClass(route))}>
              {route}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
          <span>{formatDateTime((item.run.updatedAt as string | undefined) ?? (item.run.createdAt as string | undefined))}</span>
          {item.run.assignedAgentId ? <span className="truncate">agent: {String(item.run.assignedAgentId)}</span> : null}
          {executionProvider && executionModel ? (
            <span>
              {executionProvider}/{executionModel}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function RunListContent({
  runsQuery,
  filteredRuns,
  traceId,
  navigate,
}: {
  runsQuery: ReturnType<typeof useOrchestrationRuns>
  filteredRuns: OrchestrationRunListItem[]
  traceId: string | undefined
  navigate: ReturnType<typeof useNavigate>
}) {
  if (runsQuery.isLoading) {
    return (
      <PageLoading variant="spinner" message="Loading orchestration runs..." />
    )
  }

  if (filteredRuns.length === 0) {
    return (
      <EmptyState
        icon={<Workflow className="h-10 w-10" />}
        title="No orchestration traces yet"
        description="Send a message through the agent, then inspect the full run here."
        className="py-10"
      />
    )
  }

  return (
    <>
      {filteredRuns.map((item) => (
        <RunListItemRow
          key={item.run.traceId}
          item={item}
          selected={item.run.traceId === traceId}
          onSelect={() => navigate(`/orchestration/${item.run.traceId}`)}
        />
      ))}
    </>
  )
}

export function OrchestrationPage() {
  const navigate = useNavigate()
  const { traceId } = useParams()
  const [filter, setFilter] = useState("")
  const [saveEvalOpen, setSaveEvalOpen] = useState(false)
  const [draft, setDraft] = useState<EvalCaseDraftFromTrace | null>(null)
  const [selectedAssertionKeys, setSelectedAssertionKeys] = useState<string[]>([])
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>("__new__")
  const [newSuiteName, setNewSuiteName] = useState("")
  const [newSuiteDescription, setNewSuiteDescription] = useState("")
  const [draftCaseName, setDraftCaseName] = useState("")
  const runsQuery = useOrchestrationRuns()
  const detailQuery = useOrchestrationRunDetail(traceId ?? null)
  const evalSuitesQuery = useEvalSuites()
  const buildEvalDraftMut = useBuildEvalCaseFromTrace()
  const createEvalSuiteMut = useCreateEvalSuite()

  const filteredRuns = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const runs = runsQuery.data ?? []
    if (!query) return runs
    return runs.filter((item) => {
      const inbound = resolveRunInboundText(item.run)
      const haystack = [
        item.run.traceId,
        item.run.sessionKey,
        item.run.assignedAgentId,
        item.run.executionModel,
        inbound,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [filter, runsQuery.data])

  const selectedRun = detailQuery.data?.run ?? null
  const selectedInboundText = useMemo(
    () => (selectedRun ? resolveRunInboundText(selectedRun, detailQuery.data?.prompts ?? []) : ""),
    [detailQuery.data?.prompts, selectedRun],
  )
  const promptsByRun = useMemo(() => {
    const groups = new Map<string, OrchestrationPromptRecord[]>()
    for (const prompt of detailQuery.data?.prompts ?? []) {
      const existing = groups.get(prompt.runId) ?? []
      existing.push(prompt)
      existing.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "input" ? -1 : 1))
      groups.set(prompt.runId, existing)
    }
    return [...groups.entries()]
  }, [detailQuery.data?.prompts])

  const summary = useMemo(() => {
    const prompts = detailQuery.data?.prompts ?? []
    const steps = detailQuery.data?.steps ?? []
    return {
      promptCalls: new Set(prompts.map((prompt) => prompt.runId)).size,
      toolCalls: countToolSteps(steps),
      llmInputs: countStagePrefix(steps, "llm_input"),
      llmOutputs: countStagePrefix(steps, "llm_output"),
      dispatchSteps: countStagePrefix(steps, "dispatch:"),
      inputTokens: prompts.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "input"), 0),
      outputTokens: prompts.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "output"), 0),
      totalTokens: prompts.reduce((sum, prompt) => sum + promptUsageTotal(prompt, "total"), 0),
    }
  }, [detailQuery.data?.prompts, detailQuery.data?.steps])

  const phaseGroups = useMemo(
    () => groupStepsByPhase(detailQuery.data?.steps ?? []),
    [detailQuery.data?.steps],
  )

  const promptSetSummaries = useMemo(
    () => promptsByRun.map(summarizePromptSet),
    [promptsByRun],
  )

  const routerPromptSummary =
    promptSetSummaries.find((summaryItem) => summaryItem.kind === "router") ?? null
  const executionPromptSummary =
    promptSetSummaries.find((summaryItem) => summaryItem.kind === "execution") ?? null
  const traceNarrative = useMemo(
    () => (
      selectedRun
        ? buildTraceNarrative({
            run: selectedRun,
            inboundText: selectedInboundText,
            promptSummaries: promptSetSummaries,
            steps: detailQuery.data?.steps ?? [],
          })
        : []
    ),
    [detailQuery.data?.steps, promptSetSummaries, selectedInboundText, selectedRun],
  )

  const openRaw = (path: string) => {
    navigate(`/collections/_orchestration/${path.replace(/#/g, "%23")}`)
  }

  const customEvalSuites = useMemo(
    () => (evalSuitesQuery.data?.suites ?? []).filter((suite) => !suite.builtin),
    [evalSuitesQuery.data?.suites],
  )

  const openSaveAsEval = async () => {
    if (!selectedRun) return
    try {
      const response = await buildEvalDraftMut.mutateAsync({ trace_id: selectedRun.traceId })
      if (!response.draft) {
        toast.error("The trace did not produce an eval draft.")
        return
      }
      setDraft(response.draft)
      setDraftCaseName(response.draft.case.name)
      setSelectedAssertionKeys(
        response.draft.case.assertion_options
          .filter((option) => option.checked)
          .map((option) => option.key),
      )
      setSelectedSuiteId(customEvalSuites[0]?.id ?? "__new__")
      setNewSuiteName(response.draft.suite.suggested_name)
      setNewSuiteDescription(response.draft.suite.suggested_description)
      setSaveEvalOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build eval case from trace")
    }
  }

  const saveTraceAsEvalCase = async () => {
    if (!selectedRun || !draft) return
    try {
      let suiteTargetId = selectedSuiteId
      if (suiteTargetId === "__new__") {
        const result = await createEvalSuiteMut.mutateAsync({
          name: newSuiteName.trim() || draft.suite.suggested_name,
          description: newSuiteDescription.trim() || draft.suite.suggested_description,
        })
        suiteTargetId = result.suite.id
      }
      const response = await buildEvalDraftMut.mutateAsync({
        trace_id: selectedRun.traceId,
        suite_id: suiteTargetId,
        name: draftCaseName.trim() || draft.case.name,
        assertion_keys: selectedAssertionKeys,
      })
      if (!response.case) {
        toast.error("The eval case could not be saved.")
        return
      }
      toast.success("Saved trace as eval case")
      setSaveEvalOpen(false)
      navigate(`/evals/suites/${suiteTargetId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save eval case")
    }
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] min-[1300px]:flex min-[1300px]:h-[calc(100vh-3rem)] min-[1300px]:overflow-hidden">
      <div
        className={cn(
          "border-b min-[1300px]:flex min-[1300px]:h-full min-[1300px]:min-h-0 min-[1300px]:w-[24rem] min-[1300px]:flex-col min-[1300px]:overflow-hidden min-[1300px]:border-b-0 min-[1300px]:border-r",
          traceId ? "hidden min-[1300px]:flex" : "block min-[1300px]:flex",
        )}
      >
        <div className="border-b px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold">Orchestration</h1>
              <p className="mt-1 hidden text-xs text-muted-foreground min-[520px]:block">
                Vault-native trace of routing, prompts, tools, and replies.
              </p>
            </div>
            <Button variant="outline" size="icon" onClick={() => { void runsQuery.refetch(); void detailQuery.refetch() }}>
              <RefreshCw className={cn("h-4 w-4", runsQuery.isFetching || detailQuery.isFetching ? "animate-spin" : "")} />
            </Button>
          </div>
          <div className="mt-3 flex flex-col gap-2 min-[560px]:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search traces"
                className="pl-9"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{formatCount(filteredRuns.length)}</span>{" "}
              traces
            </div>
            <RoutingSettingsCard />
          </div>
        </div>
        <div className="space-y-3 p-3 min-[1300px]:hidden">
          <RunListContent
            runsQuery={runsQuery}
            filteredRuns={filteredRuns}
            traceId={traceId}
            navigate={navigate}
          />
        </div>
        <ScrollArea className="hidden min-[1300px]:min-h-0 min-[1300px]:flex-1 min-[1300px]:block">
          <div className="space-y-3 p-3">
            <RunListContent
              runsQuery={runsQuery}
              filteredRuns={filteredRuns}
              traceId={traceId}
              navigate={navigate}
            />
          </div>
        </ScrollArea>
      </div>

      <div className={cn("min-w-0 flex-1 overflow-hidden min-[1300px]:h-full", !traceId ? "hidden min-[1300px]:block" : "block")}>
        {!traceId ? (
          <EmptyState
            icon={<Sparkles className="h-12 w-12" />}
            title="Select a trace"
            description="Choose a run from the list to inspect the inbound message, router prompts, tool calls, specialist prompts, and final reply."
            className="h-full"
          />
        ) : detailQuery.isLoading ? (
          <PageLoading variant="spinner" message="Loading trace detail..." />
        ) : !selectedRun ? (
          <EmptyState
            icon={<TriangleAlert className="h-10 w-10" />}
            title="Trace not found"
            description="This trace no longer exists in the vault."
            className="h-full"
          />
        ) : (
          <div className="h-full overflow-auto min-[1300px]:min-h-0">
            <div className="border-b px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 px-2 text-muted-foreground min-[1300px]:hidden"
                    onClick={() => navigate("/orchestration")}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back to traces
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">Trace {selectedRun.traceId}</h2>
                    {selectedRun.finalRoute ? (
                      <Badge variant="outline" className={routeBadgeClass(String(selectedRun.finalRoute))}>
                        {String(selectedRun.finalRoute)}
                      </Badge>
                    ) : null}
                    {selectedRun.status ? <Badge variant="secondary">{String(selectedRun.status)}</Badge> : null}
                  </div>
                  <p className="max-w-4xl text-sm text-muted-foreground">
                    {previewText(selectedInboundText, 240)}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTime((selectedRun.updatedAt as string | undefined) ?? (selectedRun.createdAt as string | undefined))}</span>
                    {selectedRun.messageId ? <span>message: {String(selectedRun.messageId)}</span> : null}
                    {selectedRun.sessionKey ? <span>session: {String(selectedRun.sessionKey)}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void openSaveAsEval()} disabled={buildEvalDraftMut.isPending}>
                    {buildEvalDraftMut.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Beaker className="mr-2 h-4 w-4" />
                    )}
                    Save as eval case
                  </Button>
                  <Button variant="outline" onClick={() => openRaw(`runs/${selectedRun.traceId}.json`)}>
                    <Database className="mr-2 h-4 w-4" />
                    Open raw vault file
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4">
              <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="grid h-auto w-full grid-cols-3 min-[1300px]:w-[32rem]">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="prompts">Prompts</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <NarrativeCard lines={traceNarrative} />

                  <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 min-[1800px]:grid-cols-4">
                    <MetricCard label="Prompt Calls" value={formatCount(summary.promptCalls)} />
                    <MetricCard label="Tool Calls" value={formatCount(summary.toolCalls)} />
                    <MetricCard label="Total Input Tokens" value={formatCount(summary.inputTokens)} />
                    <MetricCard label="Total Tokens" value={formatCount(summary.totalTokens)} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2">
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Cpu className="h-4 w-4" />
                          Router vs Execution
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-1 gap-4 min-[1500px]:grid-cols-2">
                        <div className="min-w-0 rounded-xl border bg-muted/20 p-4">
                          <div className="flex flex-col items-start gap-2 min-[480px]:flex-row min-[480px]:items-center">
                            <Badge variant="outline">Router</Badge>
                            {routerPromptSummary?.provider && routerPromptSummary?.model ? (
                              <Badge variant="secondary" className="max-w-full break-all whitespace-normal text-left">
                                {routerPromptSummary.provider}/{routerPromptSummary.model}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-2">
                            <MetricCard label="Input Chars" value={formatCount(routerPromptSummary?.inputChars ?? 0)} />
                            <MetricCard label="Input Tokens" value={formatCount(routerPromptSummary?.inputTokens ?? 0)} />
                            <MetricCard label="Output Tokens" value={formatCount(routerPromptSummary?.outputTokens ?? 0)} />
                            <MetricCard label="Tool Schemas" value={formatCount(routerPromptSummary?.toolDefinitions ?? 0)} />
                          </div>
                        </div>

                        <div className="min-w-0 rounded-xl border bg-muted/20 p-4">
                          <div className="flex flex-col items-start gap-2 min-[480px]:flex-row min-[480px]:items-center">
                            <Badge variant="outline">Execution</Badge>
                            {executionPromptSummary?.provider && executionPromptSummary?.model ? (
                              <Badge variant="secondary" className="max-w-full break-all whitespace-normal text-left">
                                {executionPromptSummary.provider}/{executionPromptSummary.model}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-2">
                            <MetricCard label="Input Chars" value={formatCount(executionPromptSummary?.inputChars ?? 0)} />
                            <MetricCard label="Input Tokens" value={formatCount(executionPromptSummary?.inputTokens ?? 0)} />
                            <MetricCard label="Output Tokens" value={formatCount(executionPromptSummary?.outputTokens ?? 0)} />
                            <MetricCard label="Tool Schemas" value={formatCount(executionPromptSummary?.toolDefinitions ?? 0)} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <PhaseBreakdownCard phaseGroups={phaseGroups} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2">
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <MessageSquareText className="h-4 w-4" />
                          Inbound Message
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <TextBlock
                          label="Inbound Body"
                          value={selectedInboundText}
                        />
                        {"flowContext" in (selectedRun.inbound as Record<string, unknown> | undefined ?? {}) ? (
                          <details className="rounded-lg border bg-muted/20 p-3">
                            <summary className="cursor-pointer text-sm font-medium">Flow Context</summary>
                            <div className="mt-3">
                              <JsonBlock value={(selectedRun.inbound as Record<string, unknown>).flowContext} maxHeight="max-h-60" />
                            </div>
                          </details>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <GitBranch className="h-4 w-4" />
                          Routing Decision
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-2">
                          <MetricCard label="Assigned Agent" value={String(selectedRun.assignedAgentId ?? "unknown")} />
                          <MetricCard label="Task Class" value={String(selectedRun.taskClass ?? "unknown")} />
                          <MetricCard label="Assigned Model" value={`${selectedRun.assignedProvider ?? "?"}/${selectedRun.assignedModel ?? "?"}`} />
                          <MetricCard label="Execution Model" value={`${selectedRun.executionProvider ?? "?"}/${selectedRun.executionModel ?? "?"}`} />
                        </div>
                        <KeyValueGrid
                          items={[
                            { label: "Suggested Route", value: String(selectedRun.suggestedRoute ?? "unknown") },
                            { label: "Final Route", value: String(selectedRun.finalRoute ?? "unknown") },
                            { label: "Router Source", value: String(asRecord(selectedRun.router)?.source ?? "unknown") },
                            { label: "Confidence", value: summarizeValue(selectedRun.confidence) },
                            { label: "Router Calls", value: formatCount(summary.llmInputs) },
                          ]}
                        />
                        {typeof asRecord(selectedRun.router)?.selectedAgentReason === "string" ? (
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              Selection Reason
                            </div>
                            <div className="mt-1 text-sm font-medium break-words">
                              {String(asRecord(selectedRun.router)?.selectedAgentReason)}
                            </div>
                          </div>
                        ) : null}
                        <BadgeList label="Reasons" values={asStringList(selectedRun.reasons)} emptyLabel="No route reasons stored" />
                        <BadgeList
                          label="Blockers"
                          values={asStringList(selectedRun.blockers)}
                          emptyLabel="No blockers stored"
                          tone="danger"
                        />
                        <details className="rounded-lg border bg-muted/20 p-3">
                          <summary className="cursor-pointer text-sm font-medium">Policy Checks and Router Payload</summary>
                          <div className="mt-3 space-y-3">
                            <JsonBlock value={selectedRun.policyChecks} maxHeight="max-h-56" />
                            <JsonBlock value={selectedRun.router} maxHeight="max-h-72" />
                          </div>
                        </details>
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Bot className="h-4 w-4" />
                          Context Packet
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {selectedRun.packet ? (
                          <>
                            <KeyValueGrid
                              items={[
                                {
                                  label: "Allowed Tools",
                                  value: formatCount(getPacketToolAllowlist(selectedRun.packet).length),
                                },
                                {
                                  label: "Memory Hits",
                                  value: formatCount(asRecord(selectedRun.packet)?.memoryResults ? (asRecord(selectedRun.packet)?.memoryResults as unknown[] | undefined)?.length ?? 0 : 0),
                                },
                                {
                                  label: "Vault Hits",
                                  value: formatCount(asRecord(selectedRun.packet)?.vaultResults ? (asRecord(selectedRun.packet)?.vaultResults as unknown[] | undefined)?.length ?? 0 : 0),
                                },
                                {
                                  label: "Packet Chars",
                                  value: formatCount(
                                    typeof asRecord(selectedRun.packet)?.packetText === "string"
                                      ? String(asRecord(selectedRun.packet)?.packetText).length
                                      : 0,
                                  ),
                                },
                              ]}
                            />
                            <BadgeList
                              label="Tool Allowlist"
                              values={getPacketToolAllowlist(selectedRun.packet)}
                              emptyLabel="No packet allowlist stored"
                            />
                            <TextBlock
                              label="Packet Text"
                              value={typeof (selectedRun.packet as Record<string, unknown>).packetText === "string"
                                ? String((selectedRun.packet as Record<string, unknown>).packetText)
                                : ""}
                            />
                            <details className="rounded-lg border bg-muted/20 p-3">
                              <summary className="cursor-pointer text-sm font-medium">Memory and Vault Retrieval</summary>
                              <div className="mt-3 space-y-3">
                                <JsonBlock value={(selectedRun.packet as Record<string, unknown>).memoryResults} maxHeight="max-h-60" />
                                <JsonBlock value={(selectedRun.packet as Record<string, unknown>).vaultResults} maxHeight="max-h-60" />
                              </div>
                            </details>
                            <details className="rounded-lg border bg-muted/20 p-3">
                              <summary className="cursor-pointer text-sm font-medium">Raw Packet</summary>
                              <div className="mt-3">
                                <JsonBlock value={selectedRun.packet} maxHeight="max-h-[30rem]" />
                              </div>
                            </details>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">No packetized context was stored for this run.</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Send className="h-4 w-4" />
                          Outcome
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <KeyValueGrid
                          items={[
                            { label: "Status", value: String(selectedRun.status ?? "unknown") },
                            { label: "Dispatch Steps", value: formatCount(summary.dispatchSteps) },
                            { label: "LLM Outputs", value: formatCount(summary.llmOutputs) },
                            { label: "Output Tokens", value: formatCount(summary.outputTokens) },
                          ]}
                        />
                        <details className="rounded-lg border bg-muted/20 p-3">
                          <summary className="cursor-pointer text-sm font-medium">Outcome Payload</summary>
                          <div className="mt-3">
                            <JsonBlock
                              value={{
                                status: selectedRun.status,
                                outcome: selectedRun.outcome,
                                replyResult: selectedRun.replyResult,
                                counts: selectedRun.counts,
                                error: selectedRun.error,
                              }}
                              maxHeight="max-h-[28rem]"
                            />
                          </div>
                        </details>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4">
                  {detailQuery.data?.steps?.length ? (
                    <div className="space-y-4 pr-2">
                      <TimelineGuideCard />
                      <NarrativeCard lines={traceNarrative} />
                      {phaseGroups.map((group) => (
                        <HumanPhaseCard
                          key={group.key}
                          label={group.label}
                          icon={group.icon}
                          steps={group.steps}
                          run={selectedRun}
                          routerPromptSummary={routerPromptSummary}
                          executionPromptSummary={executionPromptSummary}
                        />
                      ))}
                      <RawTraceSection phaseGroups={phaseGroups} />
                    </div>
                  ) : (
                    <EmptyState
                      icon={<Workflow className="h-10 w-10" />}
                      title="No step timeline recorded"
                      description="This run has a snapshot but no discrete step events."
                    />
                  )}
                </TabsContent>

                <TabsContent value="prompts" className="space-y-4">
                  {promptsByRun.length ? (
                    promptsByRun.map(([runId, prompts]) => (
                      <div key={runId} className="space-y-3">
                        <div className="flex items-center gap-2">
                          {runId.startsWith("router-") ? <Cpu className="h-4 w-4" /> : <Brain className="h-4 w-4" />}
                          <h3 className="text-sm font-semibold">
                            {runId.startsWith("router-") ? "Router" : "Execution"} prompt set
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2">
                          {prompts.map((prompt) => (
                            <PromptCard key={prompt.path} prompt={prompt} onOpenRaw={openRaw} />
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<FileJson className="h-10 w-10" />}
                      title="No prompt snapshots recorded"
                      description="Prompt input/output files were not found for this trace."
                    />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      <Dialog open={saveEvalOpen} onOpenChange={setSaveEvalOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Save as eval case</DialogTitle>
            <DialogDescription>
              Capture this real orchestration trace as a reusable deterministic eval case in a custom suite.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Case name</label>
                  <Input value={draftCaseName} onChange={(event) => setDraftCaseName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Custom suite</label>
                  <Select value={selectedSuiteId} onValueChange={setSelectedSuiteId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {customEvalSuites.map((suite) => (
                        <SelectItem key={suite.id} value={suite.id}>{suite.name}</SelectItem>
                      ))}
                      <SelectItem value="__new__">Create new suite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedSuiteId === "__new__" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">New suite name</label>
                    <Input value={newSuiteName} onChange={(event) => setNewSuiteName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">New suite description</label>
                    <Input value={newSuiteDescription} onChange={(event) => setNewSuiteDescription(event.target.value)} />
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Observed input</h3>
                <div className="rounded-xl border bg-muted/20 p-4 text-sm whitespace-pre-wrap">
                  {draft.case.input_text || "No inbound input found on this trace."}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Suggested assertions</h3>
                <div className="grid gap-2">
                  {draft.case.assertion_options.map((option) => {
                    const checked = selectedAssertionKeys.includes(option.key)
                    return (
                      <label key={option.key} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedAssertionKeys((current) =>
                              event.target.checked
                                ? Array.from(new Set([...current, option.key]))
                                : current.filter((entry) => entry !== option.key),
                            )
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <PageLoading variant="spinner" message="Building eval draft..." />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveEvalOpen(false)} disabled={buildEvalDraftMut.isPending || createEvalSuiteMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => { void saveTraceAsEvalCase() }}
              disabled={
                !draft ||
                buildEvalDraftMut.isPending ||
                createEvalSuiteMut.isPending ||
                selectedAssertionKeys.length === 0 ||
                !draftCaseName.trim() ||
                (selectedSuiteId === "__new__" && !newSuiteName.trim())
              }
            >
              {buildEvalDraftMut.isPending || createEvalSuiteMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Beaker className="mr-2 h-4 w-4" />
              )}
              Save case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
