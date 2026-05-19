import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import {
  GitBranch,
  ListTodo,
  Loader2,
  Minus,
  Save,
  Trash2,
  CopyPlus,
  MessageCircle,
  Brain,
  FileText,
  Send,
  Signpost,
  Database,
  Square,
  Link2,
  X,
  Plus,
  ScanSearch,
  Play,
  Variable,
  Split,
  FilePlus2,
  Globe2,
  Repeat,
  Clock3,
  MessageCircleQuestion,
  Wrench,
  Workflow,
  CalendarClock,
  ArrowLeft,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PageLoading } from "@/components/shared/page-loading"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDeleteFlow, useFlowRuns, useFlows, useSaveFlow } from "@/hooks/use-flows"
import { useTasksList } from "@/hooks/use-tasks"
import { getAgentProfiles, getAgentsStatus, getStatus, listFiles, testFlow as testFlowApi } from "@/lib/api"
import type {
  FlowDefinition,
  FlowGraph,
  FlowGraphEdge,
  FlowGraphNode,
  FlowNodeType,
  FlowPromptCustomization,
  FlowRunRecord,
  FlowTestMode,
} from "@/lib/flow-types"
import type { TaskListItem } from "@/lib/task-types"
import type { AgentConnection, AgentLatestUsage, AgentProfilesResponse, GroupedFileInfo } from "@/lib/types"
import type { FlowScheduleConfig } from "@/lib/schedule-types"
import { createDefaultFlowSchedule, formatScheduleLabel, isScheduleEnabled } from "@/lib/schedule"
import { FlowScheduleFields } from "@/components/shared/schedule-fields"

type EditorState = {
  id: string
  name: string
  enabled: boolean
  priority: string
  graph: FlowGraph
  schedule: FlowScheduleConfig
}

type PendingConnection = {
  sourceId: string
  label: string
}

type DragState = {
  nodeId: string
  offsetX: number
  offsetY: number
}

type ViewportState = {
  scale: number
  x: number
  y: number
}

type PanState = {
  startClientX: number
  startClientY: number
  originX: number
  originY: number
}

type MessageReceivedConfig = {
  channel?: string
  senderMode?: "any" | "explicit" | "registry"
  sendersText?: string
  registryCollection?: string
  registryPath?: string
  registryMatchInstruction?: string
}

type LookupFileConfig = {
  collection?: string
  path?: string
  outputVar?: string
  instruction?: string
}

type LlmTaskConfig = {
  name?: string
  outputVar?: string
  job?: string
  agentId?: string
}

type SetVariablesConfig = {
  assignments?: string
}

type IfConfig = {
  sourceVar?: string
  operator?: "equals" | "not_equals" | "contains"
  value?: string
}

type SwitchConfig = {
  sourceVar?: string
  casesText?: string
}

type SearchConfig = {
  collection?: string
  query?: string
  outputVar?: string
  instruction?: string
}

type CreateFileConfig = {
  collection?: string
  path?: string
  format?: "markdown" | "text" | "json"
  content?: string
}

type UpdateFileConfig = {
  collection?: string
  path?: string
  instruction?: string
}

type HttpRequestConfig = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  url?: string
  headers?: string
  body?: string
  outputVar?: string
}

type ForEachConfig = {
  inputVar?: string
  itemVar?: string
}

type WaitConfig = {
  duration?: string
  until?: string
}

type AskQuestionConfig = {
  channel?: string
  target?: "sender" | "owner" | "explicit"
  explicitTarget?: string
  question?: string
  outputVar?: string
  timeout?: string
}

type RunTaskConfig = {
  taskId?: string
  titleOverride?: string
  instructionOverride?: string
  outputVar?: string
}

type CallToolConfig = {
  toolName?: string
  argsJson?: string
  outputVar?: string
}

type RunSubflowConfig = {
  flowId?: string
  inputVar?: string
  outputVar?: string
  mode?: "await_result" | "fire_and_forget"
}

type SendMessageConfig = {
  channel?: string
  target?: "sender" | "owner" | "explicit"
  explicitTarget?: string
  message?: string
}

type FlowTestFormState = {
  agentId: string
  mode: FlowTestMode
  channel: string
  sender: string
  conversationId: string
  accountId: string
  message: string
}

type FlowStepSummary = {
  nodeId: string
  label: string
  status: "success" | "partial" | "failed" | "skipped"
  detail: string
  lines?: string[]
}

const NODE_DEFS: Array<{
  type: FlowNodeType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { type: "message_received", label: "Message received", description: "Inbound trigger", icon: MessageCircle },
  { type: "lookup_file", label: "Lookup in file", description: "Resolve data from Vault", icon: Database },
  { type: "llm_task", label: "LLM task", description: "Semantic reasoning step", icon: Brain },
  { type: "set_variables", label: "Set variables", description: "Map or template values", icon: Variable },
  { type: "if", label: "If", description: "Branch on state", icon: Signpost },
  { type: "switch", label: "Switch", description: "Multi-branch routing", icon: Split },
  { type: "search", label: "Search", description: "Query vault content", icon: ScanSearch },
  { type: "create_file", label: "Create file", description: "Create a new vault document", icon: FilePlus2 },
  { type: "update_file", label: "Update file", description: "Write to Vault file", icon: FileText },
  { type: "http_request", label: "HTTP request", description: "Call an external endpoint", icon: Globe2 },
  { type: "for_each", label: "For each", description: "Iterate over items", icon: Repeat },
  { type: "wait", label: "Wait", description: "Delay or resume later", icon: Clock3 },
  { type: "ask_question", label: "Ask question", description: "Request input and continue", icon: MessageCircleQuestion },
  { type: "run_task", label: "Run task", description: "Start a task from an existing one", icon: ListTodo },
  { type: "call_tool", label: "Call tool", description: "Invoke a named tool directly", icon: Wrench },
  { type: "run_subflow", label: "Run subflow", description: "Reuse another flow", icon: Workflow },
  { type: "send_message", label: "Send message", description: "Reply or notify", icon: Send },
  { type: "end", label: "End", description: "Stop branch", icon: Square },
]

const FLOW_CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "whatsapp" },
  { value: "telegram", label: "telegram" },
  { value: "webui", label: "webUI" },
  { value: "email", label: "email" },
] as const

function getSenderPlaceholder(channel?: string): string {
  switch (String(channel ?? "").trim().toLowerCase()) {
    case "email":
      return "parent@example.com, teacher@example.com"
    case "telegram":
      return "8425169799, 1234567890"
    case "webui":
      return "alice, bob"
    case "whatsapp":
    default:
      return "+49123456789, +49123456780"
  }
}

const FLOW_REQUIRED_TOOLS_BY_NODE: Partial<Record<FlowNodeType, string[]>> = {
  message_received: ["vault_get", "vault_spreadsheet_match"],
  lookup_file: ["vault_get", "vault_spreadsheet_get"],
  search: ["vault_search"],
  create_file: ["vault_collection_write"],
  update_file: ["vault_collection_write", "vault_spreadsheet_update"],
  ask_question: ["message"],
  send_message: ["message"],
}

function getRequiredToolsForGraph(graph: FlowGraph): string[] {
  const required = new Set<string>()
  for (const node of graph.nodes) {
    const tools = FLOW_REQUIRED_TOOLS_BY_NODE[node.type] ?? []
    for (const tool of tools) required.add(tool)
  }
  return Array.from(required)
}

function flowTestModeLabel(mode: FlowTestMode): string {
  switch (mode) {
    case "match_only":
      return "Match only"
    case "dry_run":
      return "Dry run"
    case "apply":
      return "Production run"
  }
}

function flowRunTriggerLabel(trigger: FlowRunRecord["trigger"]): string {
  switch (trigger) {
    case "scheduled":
      return "Scheduled"
    case "manual_apply":
      return "Manual apply"
    case "manual_test":
      return "Manual test"
  }
}

function formatFlowRunTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatFlowRunDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs / 1000)}s`
}

function formatFlowUsageTokens(value?: number): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}k`
  return `${numeric}`
}

function formatFlowUsageUsd(value: number): string {
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

function FlowRunRow({ run }: { run: FlowRunRecord }) {
  const usage = isAgentLatestUsage(run.usage) ? run.usage : null
  return (
    <div className="rounded-2xl border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{flowRunTriggerLabel(run.trigger)}</div>
            <Badge
              variant="outline"
              className={
                run.status === "ok"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
              }
            >
              {run.status}
            </Badge>
            <Badge variant="outline">{run.mode === "apply" ? "Apply" : "Dry run"}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatFlowRunTimestamp(run.startedAt)}</span>
            <span>·</span>
            <span>{run.agentId}</span>
            <span>·</span>
            <span>{run.channel}</span>
            <span>·</span>
            <span>{formatFlowRunDuration(run.durationMs)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-muted/35 px-3 py-2 text-sm">
        {run.message}
      </div>

      {run.summary ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {run.summary}
        </div>
      ) : null}

      {usage ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px]">
            {usage.local ? "Local" : "Cloud"}
          </Badge>
          <span className="font-medium text-foreground/80">{usage.provider}/{usage.model}</span>
          {(usage.inputTokens || usage.outputTokens) ? (
            <span>{formatFlowUsageTokens(usage.inputTokens)} in / {formatFlowUsageTokens(usage.outputTokens)} out</span>
          ) : null}
          {typeof usage.estimatedCostUsd === "number" ? (
            <span>{formatFlowUsageUsd(usage.estimatedCostUsd)}</span>
          ) : null}
          {usage.fallbackFrom ? (
            <span>fallback from {usage.fallbackFrom.provider}/{usage.fallbackFrom.model}</span>
          ) : null}
        </div>
      ) : null}

      {run.error ? (
        <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {run.error}
        </div>
      ) : null}
    </div>
  )
}

function getProfileToolSet(
  agent: AgentConnection | undefined,
  profilesData: AgentProfilesResponse | undefined,
): Set<string> {
  if (!agent) return new Set<string>()
  if (agent.profile === "custom") {
    return new Set(agent.customTools ?? [])
  }
  if (agent.profile && profilesData?.profileTools[agent.profile]) {
    return new Set(profilesData.profileTools[agent.profile] ?? [])
  }
  return new Set<string>()
}

function extractTextFromPayload(payload: Record<string, unknown>): string {
  const text = payload.text
  return typeof text === "string" ? text : ""
}

function normalizeMessageTargets(channel: string | undefined, target: string | undefined): string[] {
  const normalizedChannel = String(channel ?? "").trim().toLowerCase()
  const normalizedTarget = String(target ?? "").trim().toLowerCase()
  if (!normalizedTarget) return []
  const targets = new Set<string>([normalizedTarget])
  if (normalizedChannel && !normalizedTarget.includes(":")) {
    targets.add(`${normalizedChannel}:${normalizedTarget}`)
  }
  return Array.from(targets)
}

function summarizeFlowRun(
  graph: FlowGraph,
  result: {
    inboundPrependContext?: string
    finalPayloads: Array<Record<string, unknown>>
    messageActions: Array<Record<string, unknown>>
    toolCalls?: Array<Record<string, unknown>>
    toolStarts?: Array<Record<string, unknown>>
    toolResults?: Array<Record<string, unknown>>
    vaultMutations: Array<Record<string, unknown>>
  },
): {
  overall: "success" | "partial" | "failed"
  summary: string
  steps: FlowStepSummary[]
  senderReplies: string[]
  ownerActions: Array<Record<string, unknown>>
} {
  const toolCalls = result.toolCalls ?? []
  const toolCallNames = new Set(
    toolCalls
      .map((entry) => (typeof entry.name === "string" ? entry.name : ""))
      .filter(Boolean),
  )
  const toolStartNames = new Set(
    (result.toolStarts ?? [])
      .map((entry) => (typeof entry.name === "string" ? entry.name : ""))
      .filter(Boolean),
  )
  const toolResultText = (result.toolResults ?? [])
    .map((entry) => extractTextFromPayload(entry))
    .filter(Boolean)
    .join("\n")
  const spreadsheetUpdateCall = toolCalls.find((entry) => entry.name === "vault_spreadsheet_update")
  const spreadsheetUpdateParams = spreadsheetUpdateCall && typeof spreadsheetUpdateCall === "object"
    ? (spreadsheetUpdateCall.params as Record<string, unknown> | undefined)
    : undefined
  const spreadsheetUpdateResult = spreadsheetUpdateCall && typeof spreadsheetUpdateCall === "object"
    ? (spreadsheetUpdateCall.result as Record<string, unknown> | undefined)
    : undefined
  const senderReplies = result.finalPayloads
    .map((payload) => extractTextFromPayload(payload))
    .filter(Boolean)
  const senderReplyWarnings = senderReplies.filter((reply) => reply.includes("Session Send:") || reply.startsWith("⚠️"))
  const ownerActionEntries = result.messageActions

  const steps: FlowStepSummary[] = graph.nodes.map((node) => {
    if (node.type === "message_received") {
      return {
        nodeId: node.id,
        label: "Message received",
        status: result.inboundPrependContext ? "success" : "failed",
        detail: result.inboundPrependContext ? "Flow matched and injected context." : "Flow did not inject context.",
        lines: [
          `channel: ${String((node.config as MessageReceivedConfig)?.channel ?? "unknown")}`,
        ],
      }
    }
    if (node.type === "llm_task") {
      const hadReasoning = senderReplies.length > 0 || toolCalls.length > 0
      const cfg = (node.config as LlmTaskConfig) ?? {}
      const lines = [
        cfg.outputVar ? `output variable: ${cfg.outputVar}` : "",
        cfg.job ? `job: ${cfg.job}` : "",
      ].filter(Boolean)
      if (spreadsheetUpdateParams?.updates && typeof spreadsheetUpdateParams.updates === "object") {
        lines.push(`downstream updates: ${JSON.stringify(spreadsheetUpdateParams.updates)}`)
      } else {
        lines.push("captured output: unavailable in current runtime")
      }
      return {
        nodeId: node.id,
        label: `LLM task: ${String(cfg.name ?? "task")}`,
        status: hadReasoning ? "success" : "failed",
        detail: hadReasoning ? "Model produced a turn after flow injection." : "No downstream model activity observed.",
        lines,
      }
    }
    if (node.type === "update_file") {
      const usedSpreadsheetUpdate =
        toolCallNames.has("vault_spreadsheet_update") || toolStartNames.has("vault_spreadsheet_update")
      const usedCollectionWrite =
        toolCallNames.has("vault_collection_write") || toolStartNames.has("vault_collection_write") ||
        toolCallNames.has("vault_agent_collection_write") || toolStartNames.has("vault_agent_collection_write")
      const appliedMutation = result.vaultMutations.some((entry) =>
        String(entry.url ?? "").includes("/spreadsheets/update") || String(entry.url ?? "").includes("/raw/"),
      )
      const toolResultMentionsUpdate =
        toolResultText.includes("Updated spreadsheet row") || toolResultText.includes("Spreadsheet update")
      const status = appliedMutation || usedSpreadsheetUpdate || usedCollectionWrite ? "success" : "failed"
      return {
        nodeId: node.id,
        label: `Update file: ${String((node.config as UpdateFileConfig)?.collection ?? "")}/${String((node.config as UpdateFileConfig)?.path ?? "")}`,
        status,
        detail:
          appliedMutation
            ? "Captured a Vault write for this step."
            : toolResultMentionsUpdate
              ? "Spreadsheet update tool reported a successful update."
            : usedSpreadsheetUpdate
              ? "Spreadsheet update tool executed. The file likely updated even though no explicit mutation payload was captured."
              : usedCollectionWrite
              ? "Collection write tool executed."
              : "No file update tool execution was captured.",
        lines: [
          spreadsheetUpdateParams ? `params: ${JSON.stringify(spreadsheetUpdateParams)}` : "",
          spreadsheetUpdateResult ? `result: ${JSON.stringify(spreadsheetUpdateResult)}` : "",
        ].filter(Boolean),
      }
    }
    if (node.type === "create_file") {
      const cfg = (node.config as CreateFileConfig) ?? {}
      const usedCollectionWrite =
        toolCallNames.has("vault_collection_write") || toolStartNames.has("vault_collection_write") ||
        toolCallNames.has("vault_agent_collection_write") || toolStartNames.has("vault_agent_collection_write")
      const appliedMutation = result.vaultMutations.some((entry) =>
        String(entry.url ?? "").includes("/raw/"),
      )
      return {
        nodeId: node.id,
        label: `Create file: ${String(cfg.collection ?? "")}/${String(cfg.path ?? "")}`,
        status: appliedMutation || usedCollectionWrite ? "success" : "failed",
        detail:
          appliedMutation
            ? "Captured a Vault write for this step."
            : usedCollectionWrite
              ? "Collection write tool executed."
              : "No file creation tool execution was captured.",
        lines: [
          cfg.format ? `format: ${cfg.format}` : "",
          cfg.content ? `initial content configured: yes` : "initial content configured: no",
        ].filter(Boolean),
      }
    }
    if (node.type === "send_message") {
      const cfg = (node.config as SendMessageConfig) ?? {}
      if (cfg.target === "sender") {
        const senderStatus =
          senderReplies.length === 0 ? "failed" : senderReplyWarnings.length > 0 ? "partial" : "success"
        return {
          nodeId: node.id,
          label: "Send message: sender",
          status: senderStatus,
          detail:
            senderReplies.length === 0
              ? "No sender reply was captured."
              : senderReplyWarnings.length > 0
                ? "Reply was produced, but a cross-session send warning was also emitted."
                : "Reply to sender was produced.",
          lines: senderReplies.length > 0 ? senderReplies.map((reply) => `reply: ${reply}`) : undefined,
        }
      }
      if (cfg.target === "owner") {
        const ownerText = String(cfg.message ?? "").trim()
        const ownerTarget = String(cfg.explicitTarget ?? "").trim()
        const expectedTargets = normalizeMessageTargets(cfg.channel, ownerTarget)
        const ownerActions = ownerActionEntries.filter((entry) => {
          const entryChannel = String(entry.channel ?? "").trim().toLowerCase()
          const entryTarget = String(entry.target ?? "").trim().toLowerCase()
          return (!cfg.channel || entryChannel === String(cfg.channel).trim().toLowerCase()) &&
            (expectedTargets.length === 0 || expectedTargets.includes(entryTarget))
        })
        const ownerDryRun = ownerActions.length > 0 && ownerActions.every((entry) => {
          const payload = entry.payload
          return entry.dryRun === true ||
            (typeof payload === "object" && payload !== null && (payload as Record<string, unknown>).dryRun === true)
        })
        const foldedIntoReply = ownerText
          ? senderReplies.some((reply) => reply.includes(ownerText))
          : false
        const ownerAttempted =
          ownerActions.length > 0 || toolCallNames.has("sessions_send") || toolStartNames.has("sessions_send")
        const ownerWarning = senderReplyWarnings.find((reply) =>
          ownerTarget ? reply.includes(ownerTarget) : reply.includes("Session Send:"),
        )
        return {
          nodeId: node.id,
          label: "Send message: owner",
          status:
            !ownerTarget
              ? "failed"
              : ownerActions.length > 0
                ? "success"
                : ownerWarning
                  ? "failed"
                  : foldedIntoReply
                    ? "partial"
                    : ownerAttempted
                      ? "partial"
                      : "failed",
          detail:
            !ownerTarget
              ? "Owner target is not configured, so no separate owner notification could be delivered."
              : ownerActions.length > 0
              ? ownerDryRun
                ? "Owner notification action was captured in dry-run. Flow tests do not actually deliver external messages."
                : "Separate owner notification action was captured."
              : ownerWarning
                ? "Owner notification delivery was attempted but failed."
              : foldedIntoReply
                ? "Owner message text appears to have been folded into the sender reply instead of sent separately."
                : ownerAttempted
                  ? "Owner notification was attempted, but current runtime did not capture a confirmed delivery."
                : "No owner notification action was captured.",
          lines: [
            `configured channel: ${cfg.channel || "unknown"}`,
            ownerTarget ? `configured target: ${ownerTarget}` : "",
            ownerText ? `configured message: ${ownerText}` : "",
            ownerActions[0] ? `captured action: ${JSON.stringify(ownerActions[0])}` : "",
            ownerWarning ? `warning: ${ownerWarning}` : "",
          ].filter(Boolean),
        }
      }
      return {
        nodeId: node.id,
        label: `Send message: ${cfg.target ?? "explicit"}`,
        status: result.messageActions.length > 0 ? "success" : "failed",
        detail: result.messageActions.length > 0 ? "Outbound message action captured." : "No outbound message action captured.",
        lines: [
          cfg.channel ? `configured channel: ${cfg.channel}` : "",
          cfg.message ? `configured message: ${cfg.message}` : "",
        ].filter(Boolean),
      }
    }
    if (node.type === "lookup_file") {
      const usedLookup = toolCallNames.has("vault_get") || toolCallNames.has("vault_spreadsheet_get") || toolCallNames.has("vault_spreadsheet_match")
      return {
        nodeId: node.id,
        label: `Lookup file: ${String((node.config as LookupFileConfig)?.collection ?? "")}/${String((node.config as LookupFileConfig)?.path ?? "")}`,
        status: usedLookup ? "success" : "failed",
        detail: usedLookup ? "Lookup tools were executed." : "No lookup tool execution was captured.",
        lines: [
          toolCallNames.has("vault_spreadsheet_match") || toolStartNames.has("vault_spreadsheet_match")
            ? "spreadsheet match was used"
            : "",
          toolCallNames.has("vault_spreadsheet_get") || toolStartNames.has("vault_spreadsheet_get")
            ? "spreadsheet get was used"
            : "",
        ].filter(Boolean),
      }
    }
    if (node.type === "end") {
      return {
        nodeId: node.id,
        label: "End",
        status: "success",
        detail: "Terminal node in graph.",
      }
    }
    return {
      nodeId: node.id,
      label: node.type,
      status: "skipped",
      detail: "No summary available.",
    }
  })

  const hasFailure = steps.some((step) => step.status === "failed")
  const hasPartial = steps.some((step) => step.status === "partial")
  const overall = hasFailure ? (steps.some((step) => step.status === "success") ? "partial" : "failed") : hasPartial ? "partial" : "success"
  const summary =
    overall === "success"
      ? "Flow completed with all observed steps succeeding."
      : overall === "partial"
        ? "Flow partially succeeded; at least one expected side effect was missing or ambiguous."
        : "Flow did not complete the expected actions."

  const ownerNodeTargets = graph.nodes
    .filter((node) => node.type === "send_message" && (node.config as SendMessageConfig | undefined)?.target === "owner")
    .map((node) => {
      const cfg = (node.config ?? {}) as SendMessageConfig
      return {
        channel: String(cfg.channel ?? "").trim().toLowerCase(),
        targets: normalizeMessageTargets(String(cfg.channel ?? ""), String(cfg.explicitTarget ?? "")),
      }
    })
    .filter((entry) => entry.targets.length > 0)
  const ownerActions = result.messageActions.filter((entry) => {
    const entryChannel = String(entry.channel ?? "").trim().toLowerCase()
    const entryTarget = String(entry.target ?? "").trim().toLowerCase()
    return ownerNodeTargets.some((candidate) =>
      candidate.targets.includes(entryTarget) && (!candidate.channel || candidate.channel === entryChannel),
    )
  })

  return { overall, summary, steps, senderReplies, ownerActions }
}

function defaultNodeConfig(type: FlowNodeType): Record<string, unknown> {
  switch (type) {
    case "message_received":
      return {
        channel: "whatsapp",
        senderMode: "registry",
        registryCollection: "contacts",
        registryPath: "contacts.md",
        registryMatchInstruction:
          "Match the inbound sender phone number or sender identifier against the contact information in this file and identify the associated record.",
      } satisfies MessageReceivedConfig
    case "lookup_file":
      return {
        collection: "",
        path: "",
        outputVar: "lookup",
        instruction: "",
      } satisfies LookupFileConfig
    case "llm_task":
      return {
        name: "classification",
        outputVar: "classification",
        job: "",
      } satisfies LlmTaskConfig
    case "set_variables":
      return {
        assignments: "contact_name = lookup.name\npriority = classification.status",
      } satisfies SetVariablesConfig
    case "if":
      return {
        sourceVar: "classification.status",
        operator: "equals",
        value: "unclear",
      } satisfies IfConfig
    case "switch":
      return {
        sourceVar: "classification.status",
        casesText: "urgent\nroutine\nunclear",
      } satisfies SwitchConfig
    case "search":
      return {
        collection: "",
        query: "",
        outputVar: "search_results",
        instruction: "",
      } satisfies SearchConfig
    case "create_file":
      return {
        collection: "",
        path: "",
        format: "markdown",
        content: "",
      } satisfies CreateFileConfig
    case "update_file":
      return {
        collection: "operations",
        path: "requests.xlsx",
        instruction: "Update the matching request or contact row with the latest classification result and any relevant notes from this run.",
      } satisfies UpdateFileConfig
    case "http_request":
      return {
        method: "POST",
        url: "",
        headers: "",
        body: "",
        outputVar: "http_response",
      } satisfies HttpRequestConfig
    case "for_each":
      return {
        inputVar: "search_results.items",
        itemVar: "item",
      } satisfies ForEachConfig
    case "wait":
      return {
        duration: "1 hour",
        until: "",
      } satisfies WaitConfig
    case "ask_question":
      return {
        channel: "whatsapp",
        target: "sender",
        question: "",
        outputVar: "user_reply",
        timeout: "24 hours",
      } satisfies AskQuestionConfig
    case "run_task":
      return {
        taskId: "",
        titleOverride: "",
        instructionOverride: "",
        outputVar: "task_run",
      } satisfies RunTaskConfig
    case "call_tool":
      return {
        toolName: "",
        argsJson: "{}",
        outputVar: "tool_result",
      } satisfies CallToolConfig
    case "run_subflow":
      return {
        flowId: "",
        inputVar: "",
        outputVar: "subflow_result",
        mode: "await_result",
      } satisfies RunSubflowConfig
    case "send_message":
      return {
        channel: "whatsapp",
        target: "sender",
        message: "Mulțumesc pentru mesaj, luăm notă de informație.",
      } satisfies SendMessageConfig
    case "end":
      return {}
  }
}

function makeNode(type: FlowNodeType, index: number): FlowGraphNode {
  return {
    id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
    type,
    position: {
      x: 80 + (index % 3) * 260,
      y: 80 + Math.floor(index / 3) * 170,
    },
    config: defaultNodeConfig(type),
  }
}

function createDefaultGraph(): FlowGraph {
  const trigger = makeNode("message_received", 0)
  const llm = makeNode("llm_task", 1)
  const end = makeNode("end", 2)
  return {
    nodes: [trigger, llm, end],
    edges: [
      { id: `edge-${trigger.id}-${llm.id}`, source: trigger.id, target: llm.id, label: "next" },
      { id: `edge-${llm.id}-${end.id}`, source: llm.id, target: end.id, label: "next" },
    ],
    prompt: { mode: "auto" },
  }
}

function createBlankEditor(): EditorState {
  return {
    id: "",
    name: "",
    enabled: true,
    priority: "100",
    graph: createDefaultGraph(),
    schedule: createDefaultFlowSchedule(),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizePromptCustomization(value: unknown): FlowPromptCustomization | undefined {
  if (!isObject(value)) return undefined
  const mode = value.mode
  const appendText = typeof value.appendText === "string" ? value.appendText : undefined
  const overrideText = typeof value.overrideText === "string" ? value.overrideText : undefined
  if (mode !== "auto" && mode !== "append" && mode !== "override" && !appendText && !overrideText) {
    return undefined
  }
  return {
    mode: mode === "auto" || mode === "append" || mode === "override" ? mode : "auto",
    appendText,
    overrideText,
  }
}

function sanitizeGraph(value: unknown, fallbackInstruction?: string): FlowGraph {
  if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    if (fallbackInstruction?.trim()) {
      const graph = createDefaultGraph()
      const llmNode = graph.nodes.find((node) => node.type === "llm_task")
      if (llmNode) {
        llmNode.config = {
          ...(llmNode.config ?? {}),
          job: fallbackInstruction.trim(),
        }
      }
      return graph
    }
    return createDefaultGraph()
  }

  const nodes: FlowGraphNode[] = value.nodes
    .filter((node): node is Record<string, unknown> => isObject(node))
    .map((node, index) => ({
      id: typeof node.id === "string" && node.id.trim() ? node.id : `node-${index}`,
      type: typeof node.type === "string" ? (node.type as FlowNodeType) : "llm_task",
      position: {
        x: isObject(node.position) && typeof node.position.x === "number" ? node.position.x : 80 + index * 220,
        y: isObject(node.position) && typeof node.position.y === "number" ? node.position.y : 80,
      },
      config: isObject(node.config) ? node.config : defaultNodeConfig("llm_task"),
      prompt: normalizePromptCustomization(node.prompt),
    }))

  const edges: FlowGraphEdge[] = value.edges
    .filter((edge): edge is Record<string, unknown> => isObject(edge))
    .map((edge, index) => ({
      id: typeof edge.id === "string" && edge.id.trim() ? edge.id : `edge-${index}`,
      source: typeof edge.source === "string" ? edge.source : "",
      target: typeof edge.target === "string" ? edge.target : "",
      label: typeof edge.label === "string" ? edge.label : "next",
    }))
    .filter((edge) => edge.source && edge.target)

  if (nodes.length === 0) {
    return createDefaultGraph()
  }

  return {
    nodes,
    edges,
    prompt: normalizePromptCustomization(value.prompt),
  }
}

function flowToEditor(flow: FlowDefinition): EditorState {
  return {
    id: flow.id,
    name: flow.name,
    enabled: flow.enabled,
    priority: String(flow.priority),
    graph: sanitizeGraph(flow.graph, flow.instruction),
    schedule: flow.schedule ?? createDefaultFlowSchedule(),
  }
}

function splitCommaSeparated(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

function stripCollectionPrefix(path: string, collection: string): string {
  const trimmedPath = path.trim()
  const trimmedCollection = collection.trim()
  if (!trimmedPath || !trimmedCollection) return trimmedPath
  const prefix = `${trimmedCollection.toLowerCase()}/`
  return trimmedPath.toLowerCase().startsWith(prefix)
    ? trimmedPath.slice(trimmedCollection.length + 1)
    : trimmedPath
}

function stripSpreadsheetExtension(path: string): string {
  return path.replace(/\.(xlsx|xls|csv)$/i, "")
}

function resolveCanonicalCollectionPath(
  collection: string,
  rawPath: string,
  files: GroupedFileInfo[] | undefined,
): string {
  const normalizedInput = stripSpreadsheetExtension(
    stripCollectionPrefix(rawPath, collection),
  ).trim()
  if (!normalizedInput || !files?.length) return normalizedInput

  const exact = files.find((file) => file.path === normalizedInput)
  if (exact) return exact.path

  const lowered = normalizedInput.toLowerCase()
  const exactLower = files.find((file) => file.path.toLowerCase() === lowered)
  if (exactLower) return exactLower.path

  const loweredStem = stripSpreadsheetExtension(lowered)
  const stemMatch = files.find(
    (file) => stripSpreadsheetExtension(file.path).toLowerCase() === loweredStem,
  )
  if (stemMatch) return stemMatch.path

  const titleMatch = files.find((file) => (file.title || "").trim().toLowerCase() === lowered)
  if (titleMatch) return titleMatch.path

  const titleStemMatch = files.find(
    (file) =>
      stripSpreadsheetExtension((file.title || "").trim()).toLowerCase() === loweredStem,
  )
  if (titleStemMatch) return titleStemMatch.path

  return normalizedInput
}

function canonicalizeGraphPaths(
  graph: FlowGraph,
  fileMap: Record<string, GroupedFileInfo[] | undefined>,
): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => {
      if (node.type === "message_received") {
        const cfg = (node.config ?? {}) as MessageReceivedConfig
        const collection = String(cfg.registryCollection ?? "").trim()
        const path = String(cfg.registryPath ?? "")
        if (!collection || !path.trim()) return node
        return {
          ...node,
          config: {
            ...cfg,
            registryPath: resolveCanonicalCollectionPath(collection, path, fileMap[collection]),
          },
        }
      }

      if (node.type === "lookup_file") {
        const cfg = (node.config ?? {}) as LookupFileConfig
        const collection = String(cfg.collection ?? "").trim()
        const path = String(cfg.path ?? "")
        if (!collection || !path.trim()) return node
        return {
          ...node,
          config: {
            ...cfg,
            path: resolveCanonicalCollectionPath(collection, path, fileMap[collection]),
          },
        }
      }

      if (node.type === "update_file") {
        const cfg = (node.config ?? {}) as UpdateFileConfig
        const collection = String(cfg.collection ?? "").trim()
        const path = String(cfg.path ?? "")
        if (!collection || !path.trim()) return node
        return {
          ...node,
          config: {
            ...cfg,
            path: resolveCanonicalCollectionPath(collection, path, fileMap[collection]),
          },
        }
      }

      if (node.type === "create_file") {
        const cfg = (node.config ?? {}) as CreateFileConfig
        const collection = String(cfg.collection ?? "").trim()
        const path = String(cfg.path ?? "").trim()
        if (!collection || !path) return node
        return {
          ...node,
          config: {
            ...cfg,
            path: stripCollectionPrefix(path, collection),
          },
        }
      }

      return node
    }),
    edges: graph.edges,
    prompt: graph.prompt,
  }
}

function escapePromptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}

function allowsMultipleEdgesForLabel(nodeType: FlowNodeType, label: string): boolean {
  return nodeType === "switch" && label === "case"
}

function getOutgoingEdges(graph: FlowGraph, sourceId: string): FlowGraphEdge[] {
  return graph.edges.filter((edge) => edge.source === sourceId)
}

function getNodeById(graph: FlowGraph, id: string): FlowGraphNode | undefined {
  return graph.nodes.find((node) => node.id === id)
}

function getStartNode(graph: FlowGraph): FlowGraphNode | undefined {
  return graph.nodes.find((node) => node.type === "message_received") ?? graph.nodes[0]
}

function getGraphBounds(graph: FlowGraph): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (graph.nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  const NODE_WIDTH = 224
  const NODE_HEIGHT = 88

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of graph.nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH)
    maxY = Math.max(maxY, node.position.y + NODE_HEIGHT)
  }

  return { minX, minY, maxX, maxY }
}

function compileNodeSummary(node: FlowGraphNode): string {
  switch (node.type) {
    case "message_received": {
      const cfg = (node.config ?? {}) as MessageReceivedConfig
      return `${cfg.channel || "any channel"} · ${cfg.senderMode || "any sender"}`
    }
    case "lookup_file": {
      const cfg = (node.config ?? {}) as LookupFileConfig
      return cfg.collection && cfg.path ? `${cfg.collection}/${cfg.path}` : "configure file lookup"
    }
    case "llm_task": {
      const cfg = (node.config ?? {}) as LlmTaskConfig
      return cfg.name || cfg.outputVar || "LLM task"
    }
    case "set_variables": {
      const cfg = (node.config ?? {}) as SetVariablesConfig
      return cfg.assignments?.split("\n").filter(Boolean)[0]?.trim() || "assign values"
    }
    case "if": {
      const cfg = (node.config ?? {}) as IfConfig
      return `${cfg.sourceVar || "value"} ${cfg.operator || "equals"} ${cfg.value || ""}`.trim()
    }
    case "switch": {
      const cfg = (node.config ?? {}) as SwitchConfig
      return cfg.sourceVar || "route by variable"
    }
    case "search": {
      const cfg = (node.config ?? {}) as SearchConfig
      return cfg.collection ? `${cfg.collection} · ${cfg.query || "query"}` : "configure search"
    }
    case "create_file": {
      const cfg = (node.config ?? {}) as CreateFileConfig
      return cfg.collection && cfg.path ? `${cfg.collection}/${cfg.path}` : "create new document"
    }
    case "update_file": {
      const cfg = (node.config ?? {}) as UpdateFileConfig
      return cfg.collection && cfg.path ? `${cfg.collection}/${cfg.path}` : "configure target file"
    }
    case "http_request": {
      const cfg = (node.config ?? {}) as HttpRequestConfig
      return `${cfg.method || "GET"} ${cfg.url || ""}`.trim() || "configure request"
    }
    case "for_each": {
      const cfg = (node.config ?? {}) as ForEachConfig
      return `${cfg.itemVar || "item"} in ${cfg.inputVar || "items"}`
    }
    case "wait": {
      const cfg = (node.config ?? {}) as WaitConfig
      return cfg.duration || cfg.until || "pause flow"
    }
    case "ask_question": {
      const cfg = (node.config ?? {}) as AskQuestionConfig
      return `${cfg.channel || "channel"} → ${cfg.target || "sender"}`
    }
    case "run_task": {
      const cfg = (node.config ?? {}) as RunTaskConfig
      return cfg.taskId || cfg.titleOverride || "select task"
    }
    case "call_tool": {
      const cfg = (node.config ?? {}) as CallToolConfig
      return cfg.toolName || "configure tool call"
    }
    case "run_subflow": {
      const cfg = (node.config ?? {}) as RunSubflowConfig
      return cfg.flowId || "select subflow"
    }
    case "send_message": {
      const cfg = (node.config ?? {}) as SendMessageConfig
      const target =
        cfg.target === "explicit"
          ? cfg.explicitTarget?.trim() || "explicit"
          : cfg.target === "owner"
            ? cfg.explicitTarget?.trim() || "owner"
            : "sender"
      return `${cfg.channel || "channel"} → ${target}`
    }
    case "end":
      return "stop branch"
  }
}

function applyPromptCustomization(
  baseText: string,
  customization?: FlowPromptCustomization,
): string {
  const mode = customization?.mode ?? "auto"
  const appendText = customization?.appendText?.trim()
  const overrideText = customization?.overrideText?.trim()
  if (mode === "override" && overrideText) {
    return overrideText
  }
  if (mode === "append" && appendText) {
    return `${baseText.trim()}\n${appendText}`.trim()
  }
  return baseText.trim()
}

function compileNodeAutoPrompt(node: FlowGraphNode): string {
  switch (node.type) {
    case "message_received": {
      const cfg = (node.config ?? {}) as MessageReceivedConfig
      const lines = [`Trigger on inbound ${cfg.channel || "message"} messages.`]
      if (cfg.senderMode === "explicit" && cfg.sendersText?.trim()) {
        lines.push(`Only continue when the sender matches one of: ${cfg.sendersText.trim()}.`)
      } else if (cfg.senderMode === "registry" && cfg.registryCollection && cfg.registryPath) {
        lines.push(
          `Before continuing, read the collection document ${cfg.registryCollection}/${cfg.registryPath} and determine whether the sender is mapped there.`,
        )
        lines.push(
          "Use that canonical collection path exactly. Do not switch to _source_asset, gdrive/, or original spreadsheet artifact paths unless explicitly required.",
        )
        lines.push(
          'For spreadsheet-backed registry files, prefer vault_spreadsheet_match with mode "phone" for phone numbers instead of vault_exec.',
        )
        if (cfg.registryMatchInstruction?.trim()) lines.push(cfg.registryMatchInstruction.trim())
        lines.push("If the sender is not mapped, ignore this workflow and continue normal agent behavior.")
      }
      return lines.join("\n")
    }
    case "lookup_file": {
      const cfg = (node.config ?? {}) as LookupFileConfig
      const lines = [
        `Read the collection document ${cfg.collection || "<collection>"}/${cfg.path || "<path>"} using vault tools.`,
        "Use the canonical collection path above, not any _source_asset or gdrive original artifact path.",
        "If this is spreadsheet-backed data, use vault_spreadsheet_get or vault_spreadsheet_match instead of vault_exec.",
      ]
      if (cfg.instruction?.trim()) lines.push(cfg.instruction.trim())
      if (cfg.outputVar?.trim()) lines.push(`Store the structured result as "${cfg.outputVar.trim()}".`)
      return lines.join("\n")
    }
    case "llm_task": {
      const cfg = (node.config ?? {}) as LlmTaskConfig
      const lines = [`Run an LLM reasoning step${cfg.name?.trim() ? ` named "${cfg.name.trim()}"` : ""}.`]
      if (cfg.agentId?.trim()) lines.push(`Use agent "${cfg.agentId.trim()}" for this step.`)
      if (cfg.job?.trim()) lines.push(cfg.job.trim())
      if (cfg.outputVar?.trim()) lines.push(`Store the result as "${cfg.outputVar.trim()}".`)
      return lines.join("\n")
    }
    case "set_variables": {
      const cfg = (node.config ?? {}) as SetVariablesConfig
      const lines = ["Set or normalize working variables for the next steps."]
      if (cfg.assignments?.trim()) {
        lines.push("Apply these assignments exactly:")
        for (const assignment of cfg.assignments.split("\n").map((line) => line.trim()).filter(Boolean)) {
          lines.push(`- ${assignment}`)
        }
      }
      return lines.join("\n")
    }
    case "if": {
      const cfg = (node.config ?? {}) as IfConfig
      return `Evaluate whether "${cfg.sourceVar || "<value>"}" ${cfg.operator || "equals"} "${cfg.value || ""}".`
    }
    case "switch": {
      const cfg = (node.config ?? {}) as SwitchConfig
      const lines = [`Route based on the value of "${cfg.sourceVar || "<value>"}".`]
      if (cfg.casesText?.trim()) {
        lines.push("Expected cases:")
        for (const entry of cfg.casesText.split("\n").map((line) => line.trim()).filter(Boolean)) {
          lines.push(`- ${entry}`)
        }
      }
      return lines.join("\n")
    }
    case "search": {
      const cfg = (node.config ?? {}) as SearchConfig
      const lines = [
        `Search ${cfg.collection?.trim() || "<collection>"}${cfg.query?.trim() ? ` for "${cfg.query.trim()}"` : ""}.`,
      ]
      if (cfg.instruction?.trim()) lines.push(cfg.instruction.trim())
      if (cfg.outputVar?.trim()) lines.push(`Store the results as "${cfg.outputVar.trim()}".`)
      lines.push("Prefer vault_search or structured collection tools over vault_exec for this search.")
      return lines.join("\n")
    }
    case "create_file": {
      const cfg = (node.config ?? {}) as CreateFileConfig
      const lines = [
        `Create a new file in ${cfg.collection || "<collection>"}/${cfg.path || "<path>"}.`,
        'Call vault_collection_write to create the document directly at that collection path.',
        "Do not use vault_agent_collection_write unless the target collection was explicitly created as an agent collection.",
      ]
      if (cfg.format?.trim()) lines.push(`Format: ${cfg.format}.`)
      if (cfg.content?.trim()) lines.push(`Initial content:\n- ${cfg.content.trim()}`)
      return lines.join("\n")
    }
    case "update_file": {
      const cfg = (node.config ?? {}) as UpdateFileConfig
      const lines = [
        `Update the collection document ${cfg.collection || "<collection>"}/${cfg.path || "<path>"} using vault tools.`,
        "Write to that collection path directly. Do not update any gdrive/ or _source_asset artifact unless the task explicitly requires the binary original.",
        "If this is spreadsheet-backed data, use vault_spreadsheet_update so the structured document is updated and the downloadable spreadsheet is regenerated.",
      ]
      if (cfg.instruction?.trim()) lines.push(cfg.instruction.trim())
      return lines.join("\n")
    }
    case "http_request": {
      const cfg = (node.config ?? {}) as HttpRequestConfig
      const lines = [`Make an HTTP ${cfg.method || "GET"} request to ${cfg.url || "<url>"}.`]
      if (cfg.headers?.trim()) lines.push(`Headers: ${cfg.headers.trim()}`)
      if (cfg.body?.trim()) lines.push(`Request body: ${cfg.body.trim()}`)
      if (cfg.outputVar?.trim()) lines.push(`Store the response as "${cfg.outputVar.trim()}".`)
      return lines.join("\n")
    }
    case "for_each": {
      const cfg = (node.config ?? {}) as ForEachConfig
      return `Iterate over "${cfg.inputVar || "<items>"}" as "${cfg.itemVar || "item"}".`
    }
    case "wait": {
      const cfg = (node.config ?? {}) as WaitConfig
      return `Pause before continuing${cfg.duration?.trim() ? ` for ${cfg.duration.trim()}` : ""}${cfg.until?.trim() ? ` until ${cfg.until.trim()}` : ""}.`
    }
    case "ask_question": {
      const cfg = (node.config ?? {}) as AskQuestionConfig
      const target =
        cfg.target === "explicit"
          ? cfg.explicitTarget?.trim() || "<target>"
          : cfg.target === "owner"
            ? cfg.explicitTarget?.trim() || "owner"
            : "the original sender"
      const lines = [
        `Ask ${target} on ${cfg.channel || "the current channel"}: ${cfg.question?.trim() || "<question>"}.`,
        `Store the reply as "${cfg.outputVar?.trim() || "user_reply"}".`,
      ]
      if (cfg.timeout?.trim()) lines.push(`Wait up to ${cfg.timeout.trim()} for an answer.`)
      return lines.join("\n")
    }
    case "run_task": {
      const cfg = (node.config ?? {}) as RunTaskConfig
      const lines = [
        `Start a new task using the existing task "${cfg.taskId || "<task_id>"}" as the template.`,
        "Reuse the original task's agent and instruction unless an override is specified here.",
      ]
      if (cfg.titleOverride?.trim()) lines.push(`New task title override: ${cfg.titleOverride.trim()}.`)
      if (cfg.instructionOverride?.trim()) lines.push(`New task instruction override: ${cfg.instructionOverride.trim()}`)
      if (cfg.outputVar?.trim()) lines.push(`Store the created task metadata as "${cfg.outputVar.trim()}".`)
      return lines.join("\n")
    }
    case "call_tool": {
      const cfg = (node.config ?? {}) as CallToolConfig
      const lines = [`Call the tool "${cfg.toolName || "<tool_name>"}" exactly once.`]
      if (cfg.argsJson?.trim()) lines.push(`Arguments JSON: ${cfg.argsJson.trim()}`)
      if (cfg.outputVar?.trim()) lines.push(`Store the tool result as "${cfg.outputVar.trim()}".`)
      return lines.join("\n")
    }
    case "run_subflow": {
      const cfg = (node.config ?? {}) as RunSubflowConfig
      const lines = [
        `Run the subflow "${cfg.flowId || "<flow_id>"}"${cfg.mode === "fire_and_forget" ? " without waiting for a result" : ""}.`,
      ]
      if (cfg.inputVar?.trim()) lines.push(`Pass "${cfg.inputVar.trim()}" into the subflow as input.`)
      if (cfg.outputVar?.trim() && cfg.mode !== "fire_and_forget") {
        lines.push(`Store the subflow result as "${cfg.outputVar.trim()}".`)
      }
      return lines.join("\n")
    }
    case "send_message": {
      const cfg = (node.config ?? {}) as SendMessageConfig
      const channel = cfg.channel || "the current channel"
      const explicitTarget = cfg.explicitTarget?.trim() || ""
      const lines: string[] = []
      if (cfg.target === "sender") {
        lines.push(`Reply to the original sender on the current inbound ${channel} conversation only.`)
        lines.push("Do not use sessions_send, do not use the message tool for this reply, do not switch channels, do not send to telegram, and do not include any owner notification text in this reply.")
        if (cfg.message?.trim()) lines.push(`Message: ${cfg.message.trim()}`)
      } else if (cfg.target === "owner") {
        if (explicitTarget) {
          lines.push("Send a separate owner notification using the message tool.")
          lines.push(`Call message with action="send", channel="${channel}", to="${explicitTarget}", and message="${escapePromptString(cfg.message?.trim() || "")}".`)
          lines.push("Do not use sessions_send. Use the configured owner target exactly, and do not include this notification in the sender reply.")
        } else {
          lines.push(`Owner notification target is not configured for ${channel}. Do not guess a session label and do not attempt owner delivery.`)
        }
      } else if (explicitTarget) {
        lines.push("Send a separate message using the message tool.")
        lines.push(`Call message with action="send", channel="${channel}", to="${explicitTarget}", and message="${escapePromptString(cfg.message?.trim() || "")}".`)
        lines.push("Do not use sessions_send. Use the configured target exactly.")
      } else {
        lines.push("Explicit target is missing. Do not guess another session label or send this message.")
      }
      return lines.join("\n")
    }
    case "end":
      return "End this branch."
  }
}

function compileNodePrompt(node: FlowGraphNode): string {
  return applyPromptCustomization(compileNodeAutoPrompt(node), node.prompt)
}

function promptModeLabel(customization?: FlowPromptCustomization): string {
  const mode = customization?.mode ?? "auto"
  if (mode === "append") return "Prompt append"
  if (mode === "override") return "Prompt override"
  return "Auto prompt"
}

function promptModeBadgeClass(customization?: FlowPromptCustomization): string {
  const mode = customization?.mode ?? "auto"
  if (mode === "append") {
    return "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-300"
  }
  if (mode === "override") {
    return "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300"
  }
  return "border-border bg-muted text-muted-foreground"
}

function compileInstructionAuto(graph: FlowGraph): string {
  const startNode = getStartNode(graph)
  if (!startNode) {
    return "No workflow nodes configured."
  }

  const visited = new Set<string>()

  function walk(nodeId: string, indent = 0): string[] {
    const node = getNodeById(graph, nodeId)
    if (!node) return []
    if (visited.has(`${nodeId}:${indent}`)) {
      return [`${"  ".repeat(indent)}- Avoid looping back indefinitely from node "${nodeId}".`]
    }
    visited.add(`${nodeId}:${indent}`)

    const prefix = `${"  ".repeat(indent)}- `
    const outgoing = getOutgoingEdges(graph, node.id)
    const actionLines = compileNodePrompt(node)
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)

    switch (node.type) {
      case "message_received": {
        const lines = actionLines.map((line) => `${prefix}${line}`)
        for (const edge of outgoing.filter((edge) => edge.label !== "false" && edge.label !== "true")) {
          lines.push(...walk(edge.target, indent))
        }
        return lines
      }
      case "lookup_file":
      case "llm_task":
      case "set_variables":
      case "search":
      case "create_file":
      case "update_file":
      case "wait":
      case "run_task":
      case "send_message": {
        const lines = actionLines.map((line) => `${prefix}${line}`)
        for (const edge of outgoing) lines.push(...walk(edge.target, indent))
        return lines
      }
      case "if": {
        const trueEdge = outgoing.find((edge) => edge.label === "true")
        const falseEdge = outgoing.find((edge) => edge.label === "false")
        const defaultEdge = outgoing.find((edge) => !edge.label || edge.label === "next" || edge.label === "default")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (trueEdge) {
          lines.push(`${prefix}If true:`)
          lines.push(...walk(trueEdge.target, indent + 1))
        }
        if (falseEdge) {
          lines.push(`${prefix}If false:`)
          lines.push(...walk(falseEdge.target, indent + 1))
        }
        if (defaultEdge) {
          lines.push(`${prefix}Otherwise:`)
          lines.push(...walk(defaultEdge.target, indent + 1))
        }
        return lines
      }
      case "switch": {
        const defaultEdge = outgoing.find((edge) => !edge.label || edge.label === "default")
        const caseEdges = outgoing.filter((edge) => edge !== defaultEdge)
        const lines = actionLines.map((line) => `${prefix}${line}`)
        for (const edge of caseEdges) {
          lines.push(`${prefix}If the value matches "${edge.label || "case"}":`)
          lines.push(...walk(edge.target, indent + 1))
        }
        if (defaultEdge) {
          lines.push(`${prefix}Otherwise:`)
          lines.push(...walk(defaultEdge.target, indent + 1))
        }
        return lines
      }
      case "http_request": {
        const successEdge = outgoing.find((edge) => edge.label === "success")
        const errorEdge = outgoing.find((edge) => edge.label === "error")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (successEdge) {
          lines.push(`${prefix}If the request succeeds:`)
          lines.push(...walk(successEdge.target, indent + 1))
        }
        if (errorEdge) {
          lines.push(`${prefix}If the request fails:`)
          lines.push(...walk(errorEdge.target, indent + 1))
        }
        if (!successEdge && !errorEdge) {
          for (const edge of outgoing) lines.push(...walk(edge.target, indent))
        }
        return lines
      }
      case "for_each": {
        const itemEdge = outgoing.find((edge) => edge.label === "item")
        const emptyEdge = outgoing.find((edge) => edge.label === "empty")
        const doneEdge = outgoing.find((edge) => edge.label === "done")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (itemEdge) {
          lines.push(`${prefix}For each item:`)
          lines.push(...walk(itemEdge.target, indent + 1))
        }
        if (emptyEdge) {
          lines.push(`${prefix}If there are no items:`)
          lines.push(...walk(emptyEdge.target, indent + 1))
        }
        if (doneEdge) {
          lines.push(`${prefix}After the loop finishes:`)
          lines.push(...walk(doneEdge.target, indent + 1))
        }
        return lines
      }
      case "ask_question": {
        const answeredEdge = outgoing.find((edge) => edge.label === "answered")
        const timeoutEdge = outgoing.find((edge) => edge.label === "timeout")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (answeredEdge) {
          lines.push(`${prefix}If an answer arrives:`)
          lines.push(...walk(answeredEdge.target, indent + 1))
        }
        if (timeoutEdge) {
          lines.push(`${prefix}If the question times out:`)
          lines.push(...walk(timeoutEdge.target, indent + 1))
        }
        return lines
      }
      case "call_tool": {
        const successEdge = outgoing.find((edge) => edge.label === "success")
        const errorEdge = outgoing.find((edge) => edge.label === "error")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (successEdge) {
          lines.push(`${prefix}If the tool call succeeds:`)
          lines.push(...walk(successEdge.target, indent + 1))
        }
        if (errorEdge) {
          lines.push(`${prefix}If the tool call fails:`)
          lines.push(...walk(errorEdge.target, indent + 1))
        }
        if (!successEdge && !errorEdge) {
          for (const edge of outgoing) lines.push(...walk(edge.target, indent))
        }
        return lines
      }
      case "run_subflow": {
        const successEdge = outgoing.find((edge) => edge.label === "success")
        const errorEdge = outgoing.find((edge) => edge.label === "error")
        const lines = actionLines.map((line) => `${prefix}${line}`)
        if (successEdge) {
          lines.push(`${prefix}If the subflow succeeds:`)
          lines.push(...walk(successEdge.target, indent + 1))
        }
        if (errorEdge) {
          lines.push(`${prefix}If the subflow fails:`)
          lines.push(...walk(errorEdge.target, indent + 1))
        }
        if (!successEdge && !errorEdge) {
          for (const edge of outgoing) lines.push(...walk(edge.target, indent))
        }
        return lines
      }
      case "end":
        return actionLines.map((line) => `${prefix}${line}`)
    }
  }

  return [
    "Follow this flow graph for the current inbound message.",
    "",
    ...walk(startNode.id),
    "",
    "Use the graph state between steps. Do not execute branches whose conditions are not satisfied.",
  ].join("\n")
}

function compileInstruction(graph: FlowGraph): string {
  return applyPromptCustomization(compileInstructionAuto(graph), graph.prompt)
}

function compileFlow(
  editor: EditorState,
  fileMap: Record<string, GroupedFileInfo[] | undefined>,
): FlowDefinition {
  const canonicalGraph = canonicalizeGraphPaths(editor.graph, fileMap)
  const triggerNode = getStartNode(canonicalGraph)
  const triggerCfg = ((triggerNode?.config ?? {}) as MessageReceivedConfig) || {}
  const priority = Number.parseInt(editor.priority.trim(), 10)
  return {
    id: editor.id.trim(),
    enabled: editor.enabled,
    kind: "inbound_message",
    name: editor.name.trim(),
    priority: Number.isFinite(priority) ? priority : 0,
    trigger: {
      channels: splitCommaSeparated(triggerCfg.channel || ""),
      senders:
        triggerCfg.senderMode === "explicit"
          ? splitCommaSeparated(triggerCfg.sendersText || "")
          : undefined,
    },
    vars: {},
    instruction: compileInstruction(canonicalGraph),
    graph: canonicalGraph,
    schedule: isScheduleEnabled(editor.schedule) ? editor.schedule : { mode: "off" },
  }
}

function nodeIcon(type: FlowNodeType) {
  return NODE_DEFS.find((entry) => entry.type === type)?.icon ?? GitBranch
}

function nodeLabel(type: FlowNodeType) {
  return NODE_DEFS.find((entry) => entry.type === type)?.label ?? type
}

function edgeColor(label?: string) {
  if (label === "true" || label === "success" || label === "answered" || label === "done") return "#16a34a"
  if (label === "false" || label === "error" || label === "timeout") return "#dc2626"
  if (label === "item" || label === "case") return "#2563eb"
  if (label === "empty") return "#d97706"
  return "rgba(148,163,184,0.9)"
}

function nodeOutputLabels(type: FlowNodeType): string[] {
  if (type === "if") return ["true", "false", "default"]
  if (type === "switch") return ["case", "default"]
  if (type === "for_each") return ["item", "empty", "done"]
  if (type === "http_request" || type === "call_tool" || type === "run_subflow") return ["success", "error"]
  if (type === "ask_question") return ["answered", "timeout"]
  if (type === "end") return []
  return ["next"]
}

function clampScale(scale: number): number {
  return Math.min(1.8, Math.max(0.3, Number(scale.toFixed(2))))
}

function hydrateOwnerTargetsInGraph(
  graph: FlowGraph,
  ownerTargets?: Record<string, string>,
): FlowGraph {
  if (!ownerTargets || Object.keys(ownerTargets).length === 0) {
    return graph
  }
  return {
    nodes: graph.nodes.map((node) => {
      if (node.type !== "send_message") return node
      const cfg = (node.config ?? {}) as SendMessageConfig
      if (cfg.target !== "owner" || String(cfg.explicitTarget ?? "").trim()) {
        return node
      }
      const channel = String(cfg.channel ?? "").trim().toLowerCase()
      const detectedTarget = ownerTargets[channel]
      if (!detectedTarget) return node
      return {
        ...node,
        config: {
          ...cfg,
          explicitTarget: detectedTarget,
        },
      }
    }),
    edges: graph.edges,
  }
}

function getTriggerChannel(graph: FlowGraph): string {
  const trigger = getStartNode(graph)
  const cfg = (trigger?.config ?? {}) as MessageReceivedConfig
  return String(cfg.channel ?? "").trim() || "whatsapp"
}

function createDefaultFlowTestForm(channel = "whatsapp"): FlowTestFormState {
  return {
    agentId: "",
    mode: "dry_run",
    channel,
    sender: "+49123456789",
    conversationId: "",
    accountId: "",
    message: "Mâine Maria nu vine la școală.",
  }
}

function CanvasNode({
  node,
  selected,
  pendingConnection,
  onMouseDown,
  onSelect,
  onStartConnection,
}: {
  node: FlowGraphNode
  selected: boolean
  pendingConnection: PendingConnection | null
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>, node: FlowGraphNode) => void
  onSelect: (node: FlowGraphNode) => void
  onStartConnection: (node: FlowGraphNode, label: string) => void
}) {
  const Icon = nodeIcon(node.type)
  const connectHint = pendingConnection && pendingConnection.sourceId !== node.id
  const outputLabels = nodeOutputLabels(node.type)
  return (
    <div
      onMouseDown={(event) => onMouseDown(event, node)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(node)
      }}
      className={`absolute w-56 rounded-xl border bg-card p-3 shadow-sm cursor-pointer select-none ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      } ${connectHint ? "hover:border-emerald-500" : ""}`}
      style={{ left: node.position.x, top: node.position.y }}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg border bg-muted/40 p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{nodeLabel(node.type)}</div>
            {(node.prompt?.mode ?? "auto") !== "auto" ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${promptModeBadgeClass(node.prompt)}`}
                title={promptModeLabel(node.prompt)}
              >
                {node.prompt?.mode}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{compileNodeSummary(node)}</div>
        </div>
      </div>
      {connectHint ? (
        <div className="mt-3 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-600">
          Click to connect {pendingConnection.label} branch here
        </div>
      ) : null}
      {outputLabels.length > 0 ? (
        <div className="absolute -right-5 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          {outputLabels.map((label) => {
            const active = pendingConnection?.sourceId === node.id && pendingConnection.label === label
            return (
              <button
                key={label}
                type="button"
                title={`Connect ${label}`}
                onMouseDown={(event) => {
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onStartConnection(node, label)
                }}
                className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold uppercase shadow-sm ${
                  active
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {label === "next" ? <Link2 className="h-3.5 w-3.5" /> : label.slice(0, 1)}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function NodeInspector({
  node,
  edge,
  onPatchNode,
  onDeleteNode,
  onPatchEdge,
  onDeleteEdge,
  onStartConnection,
  collectionFileMap,
  availableCollections,
  ownerTargets,
  availableTasks,
  availableAgents,
}: {
  node: FlowGraphNode | null
  edge: FlowGraphEdge | null
  onPatchNode: (patch: Partial<FlowGraphNode>) => void
  onDeleteNode: () => void
  onPatchEdge: (patch: Partial<FlowGraphEdge>) => void
  onDeleteEdge: () => void
  onStartConnection: (label: string) => void
  collectionFileMap: Record<string, GroupedFileInfo[] | undefined>
  availableCollections: string[]
  ownerTargets?: Record<string, string>
  availableTasks: TaskListItem[]
  availableAgents: Array<{ id: string; name: string }>
}) {
  if (edge) {
    return (
      <div className="space-y-4">
        <div>
          <div className="text-sm font-semibold">Edge</div>
          <div className="text-xs text-muted-foreground">Configure branch label</div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Label</label>
          <Input
            value={edge.label || "next"}
            onChange={(event) => onPatchEdge({ label: event.target.value || "next" })}
            placeholder="next"
          />
          <div className="text-[11px] text-muted-foreground">
            Use labels like <span className="font-mono">next</span>, <span className="font-mono">true</span>, <span className="font-mono">false</span>, <span className="font-mono">default</span>, or custom case names such as <span className="font-mono">urgent</span>.
          </div>
        </div>
        <Button variant="outline" className="w-full gap-2 text-red-600 hover:text-red-700" onClick={onDeleteEdge}>
          <Trash2 className="h-4 w-4" />
          Delete edge
        </Button>
      </div>
    )
  }

  if (!node) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Inspector</div>
        <p>Select a node or edge to configure it.</p>
        <p>To connect nodes, select a node and use the connect buttons here.</p>
      </div>
    )
  }

  const patchConfig = (patch: Record<string, unknown>) => {
    onPatchNode({ config: { ...(node.config ?? {}), ...patch } })
  }
  const patchPrompt = (prompt: FlowPromptCustomization) => {
    onPatchNode({ prompt })
  }

  const resolvePathInput = (collection: string, path: string): string =>
    resolveCanonicalCollectionPath(collection, path, collectionFileMap[collection.trim()])
  const currentFilesForCollection = (collection: string) =>
    (collectionFileMap[collection.trim()] ?? []).filter((file) => file.type !== "folder")
  const nodeAutoPrompt = compileNodeAutoPrompt(node)
  const nodeEffectivePrompt = compileNodePrompt(node)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{nodeLabel(node.type)}</div>
          <div className="text-xs text-muted-foreground">{node.id}</div>
        </div>
        <Button variant="outline" size="sm" className="gap-2 text-red-600 hover:text-red-700" onClick={onDeleteNode}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {node.type !== "if" && node.type !== "switch" && node.type !== "for_each" && node.type !== "ask_question" && node.type !== "run_task" && node.type !== "http_request" && node.type !== "call_tool" && node.type !== "run_subflow" ? (
        <Button variant="outline" className="w-full gap-2" onClick={() => onStartConnection("next")}>
          <Link2 className="h-4 w-4" />
          Connect next node
        </Button>
      ) : node.type === "switch" ? (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("case")}>
            Connect case branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("default")}>
            Connect default branch
          </Button>
        </div>
      ) : node.type === "for_each" ? (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("item")}>
            Connect item branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("empty")}>
            Connect empty branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("done")}>
            Connect done branch
          </Button>
        </div>
      ) : node.type === "ask_question" ? (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("answered")}>
            Connect answered branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("timeout")}>
            Connect timeout branch
          </Button>
        </div>
      ) : node.type === "run_task" ? (
        <Button variant="outline" className="w-full gap-2" onClick={() => onStartConnection("next")}>
          <Link2 className="h-4 w-4" />
          Connect next node
        </Button>
      ) : node.type === "http_request" || node.type === "call_tool" || node.type === "run_subflow" ? (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("success")}>
            Connect success branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("error")}>
            Connect error branch
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("true")}>
            Connect true branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("false")}>
            Connect false branch
          </Button>
          <Button variant="outline" className="w-full" onClick={() => onStartConnection("default")}>
            Connect default branch
          </Button>
        </div>
      )}

      {node.type === "message_received" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
            <select
              value={String((node.config as MessageReceivedConfig)?.channel ?? "")}
              onChange={(event) => patchConfig({ channel: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {FLOW_CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Sender rule</label>
            <select
              value={String((node.config as MessageReceivedConfig)?.senderMode ?? "any")}
              onChange={(event) => patchConfig({ senderMode: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="any">Any sender</option>
              <option value="explicit">Explicit sender list</option>
              <option value="registry">Map sender from file</option>
            </select>
          </div>
          {(node.config as MessageReceivedConfig)?.senderMode === "explicit" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Senders</label>
              <Input
                value={String((node.config as MessageReceivedConfig)?.sendersText ?? "")}
                onChange={(event) => patchConfig({ sendersText: event.target.value })}
                placeholder={getSenderPlaceholder((node.config as MessageReceivedConfig)?.channel)}
              />
            </div>
          ) : null}
          {(node.config as MessageReceivedConfig)?.senderMode === "registry" ? (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Registry collection</label>
                <select
                  value={String((node.config as MessageReceivedConfig)?.registryCollection ?? "")}
                  onChange={(event) =>
                    patchConfig({
                      registryCollection: event.target.value,
                      registryPath: "",
                    })
                  }
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Select collection</option>
                  {availableCollections.map((collection) => (
                    <option key={collection} value={collection}>
                      {collection}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Registry file</label>
                <select
                  value={String((node.config as MessageReceivedConfig)?.registryPath ?? "")}
                  onChange={(event) =>
                    patchConfig({
                      registryPath: resolvePathInput(
                        String((node.config as MessageReceivedConfig)?.registryCollection ?? ""),
                        event.target.value,
                      ),
                    })
                  }
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  disabled={!String((node.config as MessageReceivedConfig)?.registryCollection ?? "").trim()}
                >
                  <option value="">Select file</option>
                  {currentFilesForCollection(
                    String((node.config as MessageReceivedConfig)?.registryCollection ?? ""),
                  ).map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.title || file.path}
                    </option>
                  ))}
                </select>
                <div className="text-[11px] text-muted-foreground">
                  Pick the collection document path shown in Collections, not the original `.xlsx` filename.
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Match instruction</label>
                <textarea
                  value={String((node.config as MessageReceivedConfig)?.registryMatchInstruction ?? "")}
                  onChange={(event) => patchConfig({ registryMatchInstruction: event.target.value })}
                  className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {node.type === "lookup_file" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Collection</label>
            <select
              value={String((node.config as LookupFileConfig)?.collection ?? "")}
              onChange={(event) =>
                patchConfig({
                  collection: event.target.value,
                  path: "",
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select collection</option>
              {availableCollections.map((collection) => (
                <option key={collection} value={collection}>
                  {collection}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Path</label>
            <select
              value={String((node.config as LookupFileConfig)?.path ?? "")}
              onChange={(event) =>
                patchConfig({
                  path: resolvePathInput(
                    String((node.config as LookupFileConfig)?.collection ?? ""),
                    event.target.value,
                  ),
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              disabled={!String((node.config as LookupFileConfig)?.collection ?? "").trim()}
            >
              <option value="">Select file</option>
              {currentFilesForCollection(String((node.config as LookupFileConfig)?.collection ?? "")).map((file) => (
                <option key={file.path} value={file.path}>
                  {file.title || file.path}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-muted-foreground">
              Use the collection document path, not `gdrive/...` or a source filename ending in `.xlsx`.
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as LookupFileConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="lookup"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Instruction</label>
            <textarea
              value={String((node.config as LookupFileConfig)?.instruction ?? "")}
              onChange={(event) => patchConfig({ instruction: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "llm_task" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <select
              value={String((node.config as LlmTaskConfig)?.agentId ?? "")}
              onChange={(event) => patchConfig({ agentId: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Flow default agent</option>
              {availableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-muted-foreground">
              Leave empty to use the flow run agent. Choose an agent here only if this reasoning step should use a different one.
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={String((node.config as LlmTaskConfig)?.name ?? "")}
              onChange={(event) => patchConfig({ name: event.target.value })}
              placeholder="classification"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as LlmTaskConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="classification"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Job</label>
            <textarea
              value={String((node.config as LlmTaskConfig)?.job ?? "")}
              onChange={(event) => patchConfig({ job: event.target.value })}
              className="min-h-40 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder="Classify from the message whether the request is urgent, routine, or unclear."
            />
          </div>
        </div>
      ) : null}

      {node.type === "set_variables" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Assignments</label>
            <textarea
              value={String((node.config as SetVariablesConfig)?.assignments ?? "")}
              onChange={(event) => patchConfig({ assignments: event.target.value })}
              className="min-h-40 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder={"contact_name = lookup.name\npriority = classification.status"}
            />
            <div className="text-[11px] text-muted-foreground">
              One assignment per line using <span className="font-mono">name = value</span>.
            </div>
          </div>
        </div>
      ) : null}

      {node.type === "if" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Source variable</label>
            <Input
              value={String((node.config as IfConfig)?.sourceVar ?? "")}
              onChange={(event) => patchConfig({ sourceVar: event.target.value })}
              placeholder="classification.status"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Operator</label>
            <select
              value={String((node.config as IfConfig)?.operator ?? "equals")}
              onChange={(event) => patchConfig({ operator: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Value</label>
            <Input
              value={String((node.config as IfConfig)?.value ?? "")}
              onChange={(event) => patchConfig({ value: event.target.value })}
              placeholder="unclear"
            />
          </div>
        </div>
      ) : null}

      {node.type === "switch" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Source variable</label>
            <Input
              value={String((node.config as SwitchConfig)?.sourceVar ?? "")}
              onChange={(event) => patchConfig({ sourceVar: event.target.value })}
              placeholder="classification.status"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Suggested cases</label>
            <textarea
              value={String((node.config as SwitchConfig)?.casesText ?? "")}
              onChange={(event) => patchConfig({ casesText: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder={"urgent\nroutine\nunclear"}
            />
            <div className="text-[11px] text-muted-foreground">
              Add multiple <span className="font-mono">case</span> edges, then rename each edge label to the concrete case value.
            </div>
          </div>
        </div>
      ) : null}

      {node.type === "search" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Collection</label>
            <select
              value={String((node.config as SearchConfig)?.collection ?? "")}
              onChange={(event) => patchConfig({ collection: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select collection</option>
              {availableCollections.map((collection) => (
                <option key={collection} value={collection}>
                  {collection}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Query</label>
            <Input
              value={String((node.config as SearchConfig)?.query ?? "")}
              onChange={(event) => patchConfig({ query: event.target.value })}
              placeholder="Iuliana absence"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as SearchConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="search_results"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Instruction</label>
            <textarea
              value={String((node.config as SearchConfig)?.instruction ?? "")}
              onChange={(event) => patchConfig({ instruction: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "create_file" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Collection</label>
            <select
              value={String((node.config as CreateFileConfig)?.collection ?? "")}
              onChange={(event) => patchConfig({ collection: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select collection</option>
              {availableCollections.map((collection) => (
                <option key={collection} value={collection}>
                  {collection}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Path</label>
            <Input
              value={String((node.config as CreateFileConfig)?.path ?? "")}
              onChange={(event) => patchConfig({ path: event.target.value })}
              placeholder="daily/2026-03-22-report.md"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Format</label>
            <select
              value={String((node.config as CreateFileConfig)?.format ?? "markdown")}
              onChange={(event) => patchConfig({ format: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="markdown">markdown</option>
              <option value="text">text</option>
              <option value="json">json</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Initial content</label>
            <textarea
              value={String((node.config as CreateFileConfig)?.content ?? "")}
              onChange={(event) => patchConfig({ content: event.target.value })}
              className="min-h-32 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "update_file" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Collection</label>
            <select
              value={String((node.config as UpdateFileConfig)?.collection ?? "")}
              onChange={(event) =>
                patchConfig({
                  collection: event.target.value,
                  path: "",
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select collection</option>
              {availableCollections.map((collection) => (
                <option key={collection} value={collection}>
                  {collection}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Path</label>
            <select
              value={String((node.config as UpdateFileConfig)?.path ?? "")}
              onChange={(event) =>
                patchConfig({
                  path: resolvePathInput(
                    String((node.config as UpdateFileConfig)?.collection ?? ""),
                    event.target.value,
                  ),
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              disabled={!String((node.config as UpdateFileConfig)?.collection ?? "").trim()}
            >
              <option value="">Select file</option>
              {currentFilesForCollection(String((node.config as UpdateFileConfig)?.collection ?? "")).map((file) => (
                <option key={file.path} value={file.path}>
                  {file.title || file.path}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-muted-foreground">
              This updates the parsed collection document, not the original binary spreadsheet artifact.
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Instruction</label>
            <textarea
              value={String((node.config as UpdateFileConfig)?.instruction ?? "")}
              onChange={(event) => patchConfig({ instruction: event.target.value })}
              className="min-h-40 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {node.type === "http_request" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Method</label>
              <select
                value={String((node.config as HttpRequestConfig)?.method ?? "GET")}
                onChange={(event) => patchConfig({ method: event.target.value })}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">URL</label>
              <Input
                value={String((node.config as HttpRequestConfig)?.url ?? "")}
                onChange={(event) => patchConfig({ url: event.target.value })}
                placeholder="https://api.example.com/items"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Headers</label>
            <textarea
              value={String((node.config as HttpRequestConfig)?.headers ?? "")}
              onChange={(event) => patchConfig({ headers: event.target.value })}
              className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder={"Authorization: Bearer {{token}}\nContent-Type: application/json"}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <textarea
              value={String((node.config as HttpRequestConfig)?.body ?? "")}
              onChange={(event) => patchConfig({ body: event.target.value })}
              className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as HttpRequestConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="http_response"
            />
          </div>
        </div>
      ) : null}

      {node.type === "for_each" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Input variable</label>
            <Input
              value={String((node.config as ForEachConfig)?.inputVar ?? "")}
              onChange={(event) => patchConfig({ inputVar: event.target.value })}
              placeholder="search_results.items"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Item variable</label>
            <Input
              value={String((node.config as ForEachConfig)?.itemVar ?? "")}
              onChange={(event) => patchConfig({ itemVar: event.target.value })}
              placeholder="item"
            />
          </div>
        </div>
      ) : null}

      {node.type === "wait" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Duration</label>
            <Input
              value={String((node.config as WaitConfig)?.duration ?? "")}
              onChange={(event) => patchConfig({ duration: event.target.value })}
              placeholder="1 hour"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Or wait until</label>
            <Input
              value={String((node.config as WaitConfig)?.until ?? "")}
              onChange={(event) => patchConfig({ until: event.target.value })}
              placeholder="tomorrow 08:00"
            />
          </div>
        </div>
      ) : null}

      {node.type === "ask_question" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
            <select
              value={String((node.config as AskQuestionConfig)?.channel ?? "")}
              onChange={(event) => patchConfig({ channel: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {FLOW_CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Target</label>
            <select
              value={String((node.config as AskQuestionConfig)?.target ?? "sender")}
              onChange={(event) => patchConfig({ target: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="sender">Original sender</option>
              <option value="owner">Owner</option>
              <option value="explicit">Explicit target</option>
            </select>
          </div>
          {(node.config as AskQuestionConfig)?.target !== "sender" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Explicit target</label>
              <Input
                value={String((node.config as AskQuestionConfig)?.explicitTarget ?? "")}
                onChange={(event) => patchConfig({ explicitTarget: event.target.value })}
                placeholder={
                  (node.config as AskQuestionConfig)?.target === "owner"
                    ? ownerTargets?.[String((node.config as AskQuestionConfig)?.channel ?? "").toLowerCase()] ?? "telegram:5232990709"
                    : "telegram:5232990709"
                }
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Question</label>
            <textarea
              value={String((node.config as AskQuestionConfig)?.question ?? "")}
              onChange={(event) => patchConfig({ question: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Output variable</label>
              <Input
                value={String((node.config as AskQuestionConfig)?.outputVar ?? "")}
                onChange={(event) => patchConfig({ outputVar: event.target.value })}
                placeholder="user_reply"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Timeout</label>
              <Input
                value={String((node.config as AskQuestionConfig)?.timeout ?? "")}
                onChange={(event) => patchConfig({ timeout: event.target.value })}
                placeholder="24 hours"
              />
            </div>
          </div>
        </div>
      ) : null}

      {node.type === "run_task" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Existing task</label>
            <select
              value={String((node.config as RunTaskConfig)?.taskId ?? "")}
              onChange={(event) => patchConfig({ taskId: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select task</option>
              {availableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} · {task.id}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-muted-foreground">
              This starts a new task using the selected task as the template, not the old run itself.
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Title override</label>
            <Input
              value={String((node.config as RunTaskConfig)?.titleOverride ?? "")}
              onChange={(event) => patchConfig({ titleOverride: event.target.value })}
              placeholder="Optional new task title"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Instruction override</label>
            <textarea
              value={String((node.config as RunTaskConfig)?.instructionOverride ?? "")}
              onChange={(event) => patchConfig({ instructionOverride: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder="Optional replacement instruction for the new task"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as RunTaskConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="task_run"
            />
          </div>
        </div>
      ) : null}

      {node.type === "call_tool" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Tool name</label>
            <Input
              value={String((node.config as CallToolConfig)?.toolName ?? "")}
              onChange={(event) => patchConfig({ toolName: event.target.value })}
              placeholder="vault_search"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Arguments JSON</label>
            <textarea
              value={String((node.config as CallToolConfig)?.argsJson ?? "")}
              onChange={(event) => patchConfig({ argsJson: event.target.value })}
              className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
              placeholder='{"collection":"elevi","query":"Iuliana"}'
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as CallToolConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="tool_result"
            />
          </div>
        </div>
      ) : null}

      {node.type === "run_subflow" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Flow id</label>
            <Input
              value={String((node.config as RunSubflowConfig)?.flowId ?? "")}
              onChange={(event) => patchConfig({ flowId: event.target.value })}
              placeholder="elevi/prezenta"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Input variable</label>
              <Input
                value={String((node.config as RunSubflowConfig)?.inputVar ?? "")}
                onChange={(event) => patchConfig({ inputVar: event.target.value })}
                placeholder="student_payload"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Mode</label>
              <select
                value={String((node.config as RunSubflowConfig)?.mode ?? "await_result")}
                onChange={(event) => patchConfig({ mode: event.target.value })}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="await_result">Await result</option>
                <option value="fire_and_forget">Fire and forget</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Output variable</label>
            <Input
              value={String((node.config as RunSubflowConfig)?.outputVar ?? "")}
              onChange={(event) => patchConfig({ outputVar: event.target.value })}
              placeholder="subflow_result"
            />
          </div>
        </div>
      ) : null}

      {node.type === "send_message" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Channel</label>
            <select
              value={String((node.config as SendMessageConfig)?.channel ?? "")}
              onChange={(event) => patchConfig({ channel: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {FLOW_CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {(node.config as SendMessageConfig)?.target === "owner" ? (
              <div className="text-[11px] text-muted-foreground">
                Owner notifications are usually better on <span className="font-mono">telegram</span> so they stay separate from the sender reply.
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Target</label>
            <select
              value={String((node.config as SendMessageConfig)?.target ?? "sender")}
              onChange={(event) => patchConfig({ target: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="sender">Original sender</option>
              <option value="owner">Owner</option>
              <option value="explicit">Explicit target</option>
            </select>
          </div>
          {(node.config as SendMessageConfig)?.target !== "sender" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {(node.config as SendMessageConfig)?.target === "owner" ? "Owner target" : "Explicit target"}
              </label>
              <Input
                value={String((node.config as SendMessageConfig)?.explicitTarget ?? "")}
                onChange={(event) => patchConfig({ explicitTarget: event.target.value })}
                placeholder={
                  (node.config as SendMessageConfig)?.target === "owner"
                    ? `Detected: ${ownerTargets?.[String((node.config as SendMessageConfig)?.channel ?? "").toLowerCase()] ?? "telegram:5232990709"}`
                    : "telegram:5232990709"
                }
              />
              {(node.config as SendMessageConfig)?.target === "owner" ? (
                <div className="space-y-1">
                  {ownerTargets?.[String((node.config as SendMessageConfig)?.channel ?? "").toLowerCase()] ? (
                    <div className="text-[11px] text-muted-foreground">
                      Detected owner target for this channel:{" "}
                      <span className="font-mono">
                        {ownerTargets[String((node.config as SendMessageConfig)?.channel ?? "").toLowerCase()]}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-600">
                      No detected owner target for this channel yet. Approve Telegram pairing or enter the target manually.
                    </div>
                  )}
                  {ownerTargets?.[String((node.config as SendMessageConfig)?.channel ?? "").toLowerCase()] &&
                  !String((node.config as SendMessageConfig)?.explicitTarget ?? "").trim() ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() =>
                        patchConfig({
                          explicitTarget:
                            ownerTargets[String((node.config as SendMessageConfig)?.channel ?? "").toLowerCase()],
                        })
                      }
                    >
                      Use detected owner target
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <textarea
              value={String((node.config as SendMessageConfig)?.message ?? "")}
              onChange={(event) => patchConfig({ message: event.target.value })}
              className="min-h-32 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      <div className="border-t border-border/70 pt-4">
        <PromptCustomizationEditor
          title="Node prompt"
          description="This is the exact prompt fragment this node contributes to the compiled flow."
          customization={node.prompt}
          autoPrompt={nodeAutoPrompt}
          finalPrompt={nodeEffectivePrompt}
          onChange={patchPrompt}
        />
      </div>
    </div>
  )
}

function TestResultPanel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-card/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function PromptCustomizationEditor({
  customization,
  autoPrompt,
  finalPrompt,
  onChange,
  title = "Prompt",
  description,
}: {
  customization: FlowPromptCustomization | undefined
  autoPrompt: string
  finalPrompt: string
  onChange: (next: FlowPromptCustomization) => void
  title?: string
  description?: string
}) {
  const mode = customization?.mode ?? "auto"

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Mode</label>
        <select
          value={mode}
          onChange={(event) =>
            onChange({
              ...customization,
              mode: event.target.value as FlowPromptCustomization["mode"],
            })
          }
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="auto">Auto</option>
          <option value="append">Append custom text</option>
          <option value="override">Override compiled prompt</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Auto compiled prompt</label>
        <textarea
          value={autoPrompt}
          readOnly
          className="min-h-28 w-full rounded-md border bg-muted/20 px-3 py-2 text-xs font-mono text-muted-foreground"
        />
      </div>

      {mode === "append" ? (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Append text</label>
          <textarea
            value={customization?.appendText ?? ""}
            onChange={(event) =>
              onChange({
                ...customization,
                mode: "append",
                appendText: event.target.value,
              })
            }
            className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      {mode === "override" ? (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Override prompt</label>
          <textarea
            value={customization?.overrideText ?? ""}
            onChange={(event) =>
              onChange({
                ...customization,
                mode: "override",
                overrideText: event.target.value,
              })
            }
            className="min-h-36 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Effective prompt</label>
        <textarea
          value={finalPrompt}
          readOnly
          className="min-h-28 w-full rounded-md border bg-muted/20 px-3 py-2 text-xs font-mono text-foreground"
        />
      </div>
    </div>
  )
}

function stepStatusBadgeClass(status: FlowStepSummary["status"]): string {
  switch (status) {
    case "success":
      return "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    case "partial":
      return "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "failed":
      return "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300"
    case "skipped":
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

export function FlowsPage() {
  const { data, isLoading } = useFlows()
  const { data: tasksData } = useTasksList()
  const saveMut = useSaveFlow()
  const deleteMut = useDeleteFlow()
  const flows = data?.flows ?? []
  const availableTasks = tasksData?.tasks ?? []
  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    staleTime: 15_000,
  })
  const agentsQuery = useQuery({
    queryKey: ["agents-status"],
    queryFn: getAgentsStatus,
    staleTime: 15_000,
  })
  const agentProfilesQuery = useQuery({
    queryKey: ["agents-profiles"],
    queryFn: getAgentProfiles,
    staleTime: 60_000,
  })
  const testMut = useMutation({
    mutationFn: testFlowApi,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftMode, setDraftMode] = useState(false)
  const [editor, setEditor] = useState<EditorState>(createBlankEditor())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [inspectorNodeDraft, setInspectorNodeDraft] = useState<FlowGraphNode | null>(null)
  const [inspectorEdgeDraft, setInspectorEdgeDraft] = useState<FlowGraphEdge | null>(null)
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [panState, setPanState] = useState<PanState | null>(null)
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 32, y: 32 })
  const [testPanelOpen, setTestPanelOpen] = useState(false)
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [runsDialogOpen, setRunsDialogOpen] = useState(false)
  const [flowFilter, setFlowFilter] = useState<"all" | "scheduled" | "unscheduled">("all")
  const [flowToDelete, setFlowToDelete] = useState<string | null>(null)
  const [flowTestForm, setFlowTestForm] = useState<FlowTestFormState>(() =>
    createDefaultFlowTestForm(getTriggerChannel(createBlankEditor().graph)),
  )

  // Match orchestration's breakpoint (min-[1200px]) so the canvas has enough room.
  const [isCompact, setIsCompact] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1299px)")
    const onChange = () => setIsCompact(mql.matches)
    mql.addEventListener("change", onChange)
    setIsCompact(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const agents = agentsQuery.data?.agents ?? []
  const selectedFlowTestAgent = agents.find((agent) => agent.id === flowTestForm.agentId)
  const availableCollections = (statusQuery.data?.collections ?? []).map((collection) => collection.name)
  const referencedCollections = useMemo(() => {
    const names = new Set<string>()
    for (const node of editor.graph.nodes) {
      if (node.type === "message_received") {
        const collection = String(((node.config ?? {}) as MessageReceivedConfig).registryCollection ?? "").trim()
        if (collection) names.add(collection)
      } else if (node.type === "lookup_file") {
        const collection = String(((node.config ?? {}) as LookupFileConfig).collection ?? "").trim()
        if (collection) names.add(collection)
      } else if (node.type === "update_file") {
        const collection = String(((node.config ?? {}) as UpdateFileConfig).collection ?? "").trim()
        if (collection) names.add(collection)
      }
    }
    return Array.from(names).sort()
  }, [editor.graph.nodes])
  const collectionQueries = useQueries({
    queries: referencedCollections.map((collection) => ({
      queryKey: ["flow-builder-files", collection],
      queryFn: () => listFiles(collection),
      staleTime: 30_000,
    })),
  })
  const collectionFileMap = useMemo<Record<string, GroupedFileInfo[] | undefined>>(() => {
    const out: Record<string, GroupedFileInfo[] | undefined> = {}
    referencedCollections.forEach((collection, index) => {
      out[collection] = collectionQueries[index]?.data
    })
    return out
  }, [collectionQueries, referencedCollections])
  const compiledForTest = useMemo(() => compileFlow(editor, collectionFileMap), [editor, collectionFileMap])
  const autoCompiledFlowPrompt = useMemo(
    () => compileInstructionAuto(canonicalizeGraphPaths(editor.graph, collectionFileMap)),
    [editor.graph, collectionFileMap],
  )
  const effectiveCompiledFlowPrompt = useMemo(
    () => compileInstruction(canonicalizeGraphPaths(editor.graph, collectionFileMap)),
    [editor.graph, collectionFileMap],
  )
  const detectedOwnerTargets = selectedFlowTestAgent?.ownerTargets ?? {}
  const requiredTools = useMemo(() => getRequiredToolsForGraph(editor.graph), [editor.graph])
  const availableToolSet = useMemo(
    () => getProfileToolSet(selectedFlowTestAgent, agentProfilesQuery.data),
    [agentProfilesQuery.data, selectedFlowTestAgent],
  )
  const missingRequiredTools = useMemo(
    () => requiredTools.filter((tool) => !availableToolSet.has(tool)),
    [availableToolSet, requiredTools],
  )
  const flowRunSummary = useMemo(
    () =>
      testMut.data
        ? summarizeFlowRun(compiledForTest.graph ?? editor.graph, {
            inboundPrependContext: testMut.data.inboundPrependContext,
            finalPayloads: testMut.data.finalPayloads,
            messageActions: testMut.data.messageActions,
            toolCalls: testMut.data.toolCalls,
            toolStarts: testMut.data.toolStarts,
            toolResults: testMut.data.toolResults,
            vaultMutations: testMut.data.vaultMutations,
          })
        : null,
    [compiledForTest.graph, editor.graph, testMut.data],
  )
  const visibleFlows = useMemo(() => {
    if (flowFilter === "scheduled") {
      return flows.filter((flow) => isScheduleEnabled(flow.schedule))
    }
    if (flowFilter === "unscheduled") {
      return flows.filter((flow) => !isScheduleEnabled(flow.schedule))
    }
    return flows
  }, [flowFilter, flows])
  const flowRunsQuery = useFlowRuns(
    !draftMode && selectedId ? selectedId : null,
    runsDialogOpen && !draftMode && Boolean(selectedId),
  )

  useEffect(() => {
    if (draftMode) return
    if (selectedId) {
      const selected = flows.find((flow) => flow.id === selectedId)
      if (selected) {
        if (editor.id !== selected.id) {
          const nextEditor = flowToEditor(selected)
          setEditor(nextEditor)
          scheduleCenterViewport(nextEditor.graph)
        }
        return
      }
    }
    // On compact screens, don't auto-select — the user may be viewing the list
    if (isCompact) return
    if (flows.length > 0) {
      const first = flows[0]!
      const nextEditor = flowToEditor(first)
      setSelectedId(first.id)
      setEditor(nextEditor)
      scheduleCenterViewport(nextEditor.graph)
    } else {
      const blank = createBlankEditor()
      setSelectedId(null)
      setEditor(blank)
      scheduleCenterViewport(blank.graph)
    }
  }, [flows, selectedId, draftMode, editor.id, isCompact])

  useEffect(() => {
    setFlowTestForm((prev) =>
      prev.channel.trim()
        ? prev
        : {
            ...prev,
            channel: getTriggerChannel(editor.graph),
          },
    )
  }, [editor.graph])

  useEffect(() => {
    if (!agents.length) return
    setFlowTestForm((prev) =>
      prev.agentId
        ? prev
        : {
            ...prev,
            agentId:
              agents.find((agent) => agent.enabled && agent.profile === "chief-of-staff")?.id
              ?? agents.find((agent) => agent.enabled)?.id
              ?? agents[0]?.id
          ?? "",
        },
    )
  }, [agents])

  useEffect(() => {
    if (!agents.length) return
    setEditor((prev) =>
      prev.schedule.agentId
        ? prev
        : {
            ...prev,
            schedule: {
              ...prev.schedule,
              agentId:
                agents.find((agent) => agent.enabled && agent.profile === "chief-of-staff")?.id
                ?? agents.find((agent) => agent.enabled)?.id
                ?? agents[0]?.id
                ?? "",
            },
          },
    )
  }, [agents])

  useEffect(() => {
    if (!dragState) return
    const activeDrag = dragState

    function handleMove(event: MouseEvent) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = (event.clientX - rect.left - viewport.x - activeDrag.offsetX) / viewport.scale
      const y = (event.clientY - rect.top - viewport.y - activeDrag.offsetY) / viewport.scale
      setEditor((prev) => ({
        ...prev,
        graph: {
          ...prev.graph,
          nodes: prev.graph.nodes.map((node) =>
            node.id === activeDrag.nodeId
              ? {
                  ...node,
                  position: {
                    x: Math.max(16, x),
                    y: Math.max(16, y),
                  },
                }
              : node,
          ),
        },
      }))
    }

    function handleUp() {
      setDragState(null)
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
  }, [dragState, viewport])

  useEffect(() => {
    if (!panState) return
    const activePan = panState

    function handleMove(event: MouseEvent) {
      setViewport((prev) => ({
        ...prev,
        x: activePan.originX + (event.clientX - activePan.startClientX),
        y: activePan.originY + (event.clientY - activePan.startClientY),
      }))
    }

    function handleUp() {
      setPanState(null)
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
  }, [panState])

  const selectedNode = useMemo(
    () => editor.graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [editor.graph.nodes, selectedNodeId],
  )
  const selectedEdge = useMemo(
    () => editor.graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [editor.graph.edges, selectedEdgeId],
  )
  const persistedSelectedFlow = useMemo(
    () => (selectedId ? flows.find((flow) => flow.id === selectedId) ?? null : null),
    [flows, selectedId],
  )
  const inspectorNodeDirty = useMemo(
    () => Boolean(selectedNode && inspectorNodeDraft && JSON.stringify(selectedNode) !== JSON.stringify(inspectorNodeDraft)),
    [inspectorNodeDraft, selectedNode],
  )
  const inspectorEdgeDirty = useMemo(
    () => Boolean(selectedEdge && inspectorEdgeDraft && JSON.stringify(selectedEdge) !== JSON.stringify(inspectorEdgeDraft)),
    [inspectorEdgeDraft, selectedEdge],
  )

  const isExistingFlow = !draftMode && Boolean(selectedId)

  useEffect(() => {
    setInspectorNodeDraft(
      selectedNode
        ? {
            ...selectedNode,
            config: { ...(selectedNode.config ?? {}) },
            prompt: selectedNode.prompt ? { ...selectedNode.prompt } : undefined,
          }
        : null,
    )
  }, [selectedNode])

  useEffect(() => {
    setInspectorEdgeDraft(selectedEdge ? { ...selectedEdge } : null)
  }, [selectedEdge])

  function clearSelection() {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setInspectorNodeDraft(null)
    setInspectorEdgeDraft(null)
  }

  function beginCanvasPan(clientX: number, clientY: number) {
    clearSelection()
    setPanState({
      startClientX: clientX,
      startClientY: clientY,
      originX: viewport.x,
      originY: viewport.y,
    })
  }

  function centerViewportForGraph(graph: FlowGraph) {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const bounds = getGraphBounds(graph)
    const graphCenterX = (bounds.minX + bounds.maxX) / 2
    const graphCenterY = (bounds.minY + bounds.maxY) / 2
    const topSafeArea = 150
    const bottomSafeArea = 80
    const horizontalPadding = 72
    const usableWidth = Math.max(rect.width - horizontalPadding * 2, rect.width * 0.5)
    const usableHeight = Math.max(rect.height - topSafeArea - bottomSafeArea, rect.height * 0.45)
    const targetCenterX = horizontalPadding + usableWidth / 2
    const targetCenterY = topSafeArea + usableHeight / 2

    setViewport((prev) => ({
      ...prev,
      x: targetCenterX - graphCenterX * prev.scale,
      y: targetCenterY - graphCenterY * prev.scale,
    }))
  }

  function scheduleCenterViewport(graph: FlowGraph) {
    window.requestAnimationFrame(() => {
      centerViewportForGraph(graph)
    })
  }

  function loadFlow(flow: FlowDefinition) {
    const nextEditor = flowToEditor(flow)
    setDraftMode(false)
    setSelectedId(flow.id)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setPendingConnection(null)
    setEditor(nextEditor)
    scheduleCenterViewport(nextEditor.graph)
  }

  function handleCreateFlow() {
    const blank = createBlankEditor()
    setDraftMode(true)
    setSelectedId(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setPendingConnection(null)
    setEditor(blank)
    scheduleCenterViewport(blank.graph)
  }

  function handleCloneFlow() {
    setDraftMode(true)
    setSelectedId(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setPendingConnection(null)
    setEditor((prev) => ({
      ...prev,
      id: prev.id ? `${prev.id}-copy` : "",
      name: prev.name ? `${prev.name} Copy` : "",
    }))
  }

  function addNode(type: FlowNodeType) {
    setEditor((prev) => {
      const node = makeNode(type, prev.graph.nodes.length)
      return {
        ...prev,
        graph: {
          ...prev.graph,
          nodes: [...prev.graph.nodes, node],
        },
      }
    })
  }

  function selectNode(node: FlowGraphNode) {
    if (pendingConnection && pendingConnection.sourceId !== node.id) {
      setEditor((prev) => ({
        ...prev,
        graph: {
          ...prev.graph,
          edges: [
            ...prev.graph.edges.filter((edge) => {
              if (edge.source !== pendingConnection.sourceId || edge.label !== pendingConnection.label) {
                return true
              }
              const sourceNode = getNodeById(prev.graph, pendingConnection.sourceId)
              if (!sourceNode) return true
              return allowsMultipleEdgesForLabel(sourceNode.type, pendingConnection.label)
            }),
            {
              id: `edge-${pendingConnection.sourceId}-${node.id}-${pendingConnection.label}`,
              source: pendingConnection.sourceId,
              target: node.id,
              label: pendingConnection.label,
            },
          ],
        },
      }))
      setPendingConnection(null)
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
      return
    }
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
  }

  function patchInspectorNodeDraft(patch: Partial<FlowGraphNode>) {
    setInspectorNodeDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function patchInspectorEdgeDraft(patch: Partial<FlowGraphEdge>) {
    setInspectorEdgeDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function persistGraphChanges(nextGraph: FlowGraph) {
    if (!persistedSelectedFlow || draftMode) {
      return
    }
    const persistedEditor = flowToEditor(persistedSelectedFlow)
    const payload = compileFlow(
      {
        ...persistedEditor,
        graph: nextGraph,
      },
      collectionFileMap,
    )
    saveMut.mutate(
      { id: persistedSelectedFlow.id, flow: payload },
      {
        onSuccess: ({ flow }) => {
          setEditor((prev) => ({
            ...prev,
            graph: sanitizeGraph(flow.graph, flow.instruction),
            schedule: flow.schedule ?? prev.schedule,
          }))
          toast.success("Node changes saved")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Failed to save node changes")
        },
      },
    )
  }

  function applyInspectorChanges() {
    if (selectedNodeId && inspectorNodeDraft) {
      const nextGraph = {
        ...editor.graph,
        nodes: editor.graph.nodes.map((node) => (node.id === selectedNodeId ? inspectorNodeDraft : node)),
      }
      setEditor((prev) => ({
        ...prev,
        graph: nextGraph,
      }))
      persistGraphChanges(nextGraph)
      return
    }

    if (selectedEdgeId && inspectorEdgeDraft) {
      const nextGraph = {
        ...editor.graph,
        edges: editor.graph.edges.map((edge) => (edge.id === selectedEdgeId ? inspectorEdgeDraft : edge)),
      }
      setEditor((prev) => ({
        ...prev,
        graph: nextGraph,
      }))
      persistGraphChanges(nextGraph)
    }
  }

  function resetInspectorDraft() {
    setInspectorNodeDraft(
      selectedNode
        ? {
            ...selectedNode,
            config: { ...(selectedNode.config ?? {}) },
            prompt: selectedNode.prompt ? { ...selectedNode.prompt } : undefined,
          }
        : null,
    )
    setInspectorEdgeDraft(selectedEdge ? { ...selectedEdge } : null)
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return
    setEditor((prev) => ({
      ...prev,
      graph: {
        nodes: prev.graph.nodes.filter((node) => node.id !== selectedNodeId),
        edges: prev.graph.edges.filter(
          (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
        ),
      },
    }))
    setSelectedNodeId(null)
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return
    setEditor((prev) => ({
      ...prev,
      graph: {
        ...prev.graph,
        edges: prev.graph.edges.filter((edge) => edge.id !== selectedEdgeId),
      },
    }))
    setSelectedEdgeId(null)
  }

  function handleSave(onSuccess?: () => void) {
    const payload = compileFlow(editor, collectionFileMap)
    if (!payload.id) {
      toast.error("Flow id/path is required")
      return
    }
    if (!payload.name) {
      toast.error("Flow name is required")
      return
    }
    if (payload.graph?.nodes.length === 0) {
      toast.error("Add at least one node")
      return
    }
    saveMut.mutate(
      { id: payload.id, flow: payload },
      {
        onSuccess: ({ flow }) => {
          const nextEditor = flowToEditor(flow)
          setDraftMode(false)
          setSelectedId(flow.id)
          setEditor(nextEditor)
          scheduleCenterViewport(nextEditor.graph)
          onSuccess?.()
          toast.success("Flow saved")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Failed to save flow")
        },
      },
    )
  }

  function disableFlowSchedule() {
    setEditor((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        mode: "off",
      },
    }))
  }

  function handleDeleteFlow() {
    if (!selectedId) return
    setFlowToDelete(selectedId)
  }

  function handleRunFlowTest() {
    const compiled = compileFlow(
      {
        ...editor,
        graph: hydrateOwnerTargetsInGraph(editor.graph, selectedFlowTestAgent?.ownerTargets),
      },
      collectionFileMap,
    )
    setEditor((prev) => ({
      ...prev,
      graph: compiled.graph ?? prev.graph,
    }))
    if (!compiled.name) {
      toast.error("Flow name is required before testing")
      return
    }
    if (!flowTestForm.agentId) {
      toast.error("Select an agent for the flow test")
      return
    }
    if (!flowTestForm.channel.trim()) {
      toast.error("Channel is required for the test message")
      return
    }
    if (!flowTestForm.message.trim()) {
      toast.error("Message is required for the test")
      return
    }
    if (missingRequiredTools.length > 0) {
      const agentLabel = selectedFlowTestAgent?.name || flowTestForm.agentId
      toast.error(
        `Selected agent "${agentLabel}" is missing required tools: ${missingRequiredTools.join(", ")}`,
      )
      return
    }
    testMut.mutate(
      {
        agentId: flowTestForm.agentId,
        flowId: !draftMode && selectedId ? selectedId : undefined,
        mode: flowTestForm.mode,
        channel: flowTestForm.channel.trim() || getTriggerChannel(editor.graph),
        sender: flowTestForm.sender.trim() || undefined,
        conversationId: flowTestForm.conversationId.trim() || undefined,
        accountId: flowTestForm.accountId.trim() || undefined,
        message: flowTestForm.message,
        flow: compiled,
      },
      {
        onSuccess: () => {
          toast.success("Flow test finished")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Flow test failed")
        },
      },
    )
  }

  function zoomBy(delta: number) {
    setViewport((prev) => ({ ...prev, scale: clampScale(prev.scale + delta) }))
  }

  function resetViewport() {
    setViewport((prev) => ({ ...prev, scale: 1 }))
    window.requestAnimationFrame(() => {
      centerViewportForGraph(editor.graph)
    })
  }

  const canPanCanvas = !pendingConnection

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_24%),radial-gradient(circle_at_85%_12%,rgba(34,197,94,0.08),transparent_18%),hsl(var(--background))]">
      <aside className={cn(
        "w-64 shrink-0 border-r border-border/70 bg-background/80 backdrop-blur-xl min-[1300px]:flex min-[1300px]:flex-col",
        isCompact && (selectedId || draftMode) ? "hidden" : "flex flex-col",
        isCompact && !selectedId && !draftMode && "flex-1",
      )}>
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-3">
          <h1 className="text-sm font-semibold">Flows</h1>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleCreateFlow}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
        <div className="h-[calc(100%-73px)] overflow-auto p-3">
          <div className="mb-3 flex items-center gap-1 rounded-2xl border border-border/70 bg-card/35 p-1">
            <Button
              type="button"
              size="sm"
              variant={flowFilter === "all" ? "secondary" : "ghost"}
              className="h-7 flex-1 rounded-xl px-2 text-xs"
              onClick={() => setFlowFilter("all")}
            >
              All
            </Button>
            <Button
              type="button"
              size="sm"
              variant={flowFilter === "scheduled" ? "secondary" : "ghost"}
              className="h-7 flex-1 rounded-xl px-2 text-xs"
              onClick={() => setFlowFilter("scheduled")}
            >
              Scheduled
            </Button>
            <Button
              type="button"
              size="sm"
              variant={flowFilter === "unscheduled" ? "secondary" : "ghost"}
              className="h-7 flex-1 rounded-xl px-2 text-xs"
              onClick={() => setFlowFilter("unscheduled")}
            >
              Unscheduled
            </Button>
          </div>
          {isLoading ? (
            <PageLoading variant="spinner" message="Loading flows..." />
          ) : visibleFlows.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {flows.length === 0 ? "No flows yet. Create one." : "No flows match this filter."}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleFlows.map((flow) => {
                const selected = !draftMode && selectedId === flow.id
                return (
                  <div
                    key={flow.id}
                    onClick={() => loadFlow(flow)}
                    className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${
                      selected ? "bg-accent" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{flow.name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{flow.id}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isScheduleEnabled(flow.schedule) ? (
                          <div className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                            <CalendarClock className="h-3 w-3" />
                            <span>{formatScheduleLabel(flow.schedule)}</span>
                          </div>
                        ) : null}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive"
                            title="Delete flow"
                            onClick={() => setFlowToDelete(flow.id)}
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      <main className={cn(
        "flex min-w-0 flex-1 flex-col",
        isCompact && !selectedId && !draftMode ? "hidden" : "flex",
      )}>
        <div className="border-b border-border/70 bg-background/75 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
            <div className="space-y-2">
              {isCompact && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 px-2 text-muted-foreground"
                  onClick={() => { setSelectedId(null); setDraftMode(false) }}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back to flows
                </Button>
              )}
              <div className="flex items-center gap-3">
                <div className="hidden min-[1300px]:block rounded-xl border border-border/70 bg-card/60 p-2 shadow-sm">
                  <GitBranch className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-lg font-semibold tracking-tight xl:text-xl">
                      {draftMode ? "New flow" : editor.name || "Flow builder"}
                    </h1>
                    {(editor.graph.prompt?.mode ?? "auto") !== "auto" ? (
                      <Badge variant="outline" className={promptModeBadgeClass(editor.graph.prompt)}>
                        {promptModeLabel(editor.graph.prompt)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Canvas-first editor.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 min-[1300px]:gap-2">
              <Button
                variant="outline"
                className="gap-2 rounded-xl"
                size={isCompact ? "icon" : "default"}
                onClick={() => setPromptPanelOpen(true)}
                title="Prompt"
              >
                <Brain className="h-4 w-4" />
                <span className="hidden min-[1300px]:inline">Prompt</span>
              </Button>
              <Button
                variant="outline"
                className="gap-2 rounded-xl border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                size={isCompact ? "icon" : "default"}
                onClick={() => setTestPanelOpen(true)}
                title="Test"
              >
                <Play className="h-4 w-4" />
                <span className="hidden min-[1300px]:inline">Test</span>
              </Button>
              <Button
                variant="outline"
                className="gap-2 rounded-xl"
                size={isCompact ? "icon" : "default"}
                onClick={() => setRunsDialogOpen(true)}
                disabled={draftMode || !selectedId}
                title="Runs"
              >
                <Clock3 className="h-4 w-4" />
                <span className="hidden min-[1300px]:inline">Runs</span>
              </Button>
              {isExistingFlow ? (
                <>
                  <Button variant="outline" className="gap-2 rounded-xl" size={isCompact ? "icon" : "default"} onClick={handleCloneFlow} title="Clone">
                    <CopyPlus className="h-4 w-4" />
                    <span className="hidden min-[1300px]:inline">Clone</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={handleDeleteFlow}
                    disabled={deleteMut.isPending}
                    title="Delete flow"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : null}
              <Button className="gap-2 rounded-xl" size={isCompact ? "icon" : "default"} onClick={() => handleSave()} disabled={saveMut.isPending} title="Save">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="hidden min-[1300px]:inline">Save</span>
              </Button>
            </div>
          </div>

          <div className="border-t border-border/70 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-card/45 px-2.5 py-1.5">
                <span className="shrink-0 uppercase tracking-[0.16em] text-muted-foreground">ID</span>
                <Input
                  value={editor.id}
                  onChange={(event) => setEditor((prev) => ({ ...prev, id: event.target.value }))}
                  placeholder="inbound/triage"
                  className="h-6 min-w-0 w-full border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 min-[1300px]:min-w-[220px]"
                />
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/70 bg-card/45 px-2.5 py-1.5">
                <span className="shrink-0 uppercase tracking-[0.16em] text-muted-foreground">Name</span>
                <Input
                  value={editor.name}
                  onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Inbound request triage"
                  className="h-6 min-w-0 w-full border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/45 px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  onChange={(event) => setEditor((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
                <span className="text-xs text-foreground">{editor.enabled ? "Active" : "Paused"}</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/45 px-2.5 py-1.5">
                <span className="shrink-0 uppercase tracking-[0.16em] text-muted-foreground">P</span>
                <Input
                  type="number"
                  value={editor.priority}
                  onChange={(event) => setEditor((prev) => ({ ...prev, priority: event.target.value }))}
                  className="h-6 w-14 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-xl border-border/70 bg-card/45 px-3 text-xs"
                onClick={() => setScheduleDialogOpen(true)}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>{formatScheduleLabel(editor.schedule)}</span>
              </Button>
            </div>
          </div>
        </div>

        <section className="min-h-0 min-w-0 flex-1 p-2">
          <div
            ref={canvasRef}
            className={`relative h-full min-w-0 overflow-hidden rounded-[26px] border border-border/60 bg-background shadow-[0_24px_60px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.35)] ${panState ? "cursor-grabbing" : canPanCanvas ? "cursor-grab" : "cursor-default"}`}
            style={{
              backgroundImage:
                "radial-gradient(circle at top left, hsl(var(--primary) / 0.10), transparent 28%), radial-gradient(circle at 80% 10%, hsl(142 71% 45% / 0.08), transparent 18%), radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.14) 1px, transparent 0), linear-gradient(180deg, hsl(var(--background)), hsl(var(--muted) / 0.45))",
              backgroundSize: "auto, auto, 24px 24px, auto",
            }}
            onMouseDown={(event) => {
              if (!canPanCanvas) return
              if (event.target !== event.currentTarget) return
              clearSelection()
              beginCanvasPan(event.clientX, event.clientY)
            }}
          >
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-3">
              <div className="pointer-events-auto max-w-[640px] rounded-[22px] border border-border/70 bg-background/90 p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Build</div>
                    <div className="mt-1 text-xs text-foreground">Add blocks and arrange the flow visually.</div>
                  </div>
                  <div className="hidden rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground min-[1300px]:block">
                    Drag empty space to pan
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {NODE_DEFS.map((entry) => {
                    const Icon = entry.icon
                    return (
                      <button
                        key={entry.type}
                        type="button"
                        onClick={() => addNode(entry.type)}
                        className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-2.5 py-1.5 text-[11px] transition hover:border-primary/40 hover:bg-card"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{entry.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="pointer-events-auto hidden w-[190px] rounded-[20px] border border-border/70 bg-background/90 p-2.5 text-xs shadow-[0_18px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl xl:block">
                {pendingConnection ? (
                  <>
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-400">Connecting</div>
                    <div className="mt-2 font-medium text-foreground">{pendingConnection.label} branch</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Click the destination node on the canvas to complete the link.
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full rounded-xl"
                      onClick={() => setPendingConnection(null)}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Cancel connection
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Canvas tips</div>
                    <div className="mt-1.5 text-xs leading-5 text-foreground">
                      Select a node to edit it. Use the small output buttons to connect blocks.
                    </div>
                  </>
                )}
              </div>
            </div>

            {selectedNode || selectedEdge ? (
              <div className="pointer-events-none absolute bottom-3 right-3 top-20 z-20">
                <div
                  className="pointer-events-auto flex h-full w-[320px] max-w-[min(320px,calc(100%-0.5rem))] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/95 shadow-[0_24px_60px_rgba(0,0,0,0.16)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Inspector</div>
                      <div className="mt-1 text-sm text-foreground">
                        {inspectorNodeDraft ? nodeLabel(inspectorNodeDraft.type) : "Edge"}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={clearSelection}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <NodeInspector
                      node={inspectorNodeDraft}
                      edge={inspectorEdgeDraft}
                      onPatchNode={patchInspectorNodeDraft}
                      onDeleteNode={deleteSelectedNode}
                      onPatchEdge={patchInspectorEdgeDraft}
                      onDeleteEdge={deleteSelectedEdge}
                      onStartConnection={(label) => {
                        if (!inspectorNodeDraft) return
                        setPendingConnection({ sourceId: inspectorNodeDraft.id, label })
                      }}
                      collectionFileMap={collectionFileMap}
                      availableCollections={availableCollections}
                      ownerTargets={detectedOwnerTargets}
                      availableTasks={availableTasks}
                      availableAgents={agents.map((agent) => ({ id: agent.id, name: agent.name || agent.id }))}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={resetInspectorDraft}
                      disabled={!inspectorNodeDirty && !inspectorEdgeDirty}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-xl"
                      onClick={applyInspectorChanges}
                      disabled={!inspectorNodeDirty && !inspectorEdgeDirty}
                    >
                      Save changes
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="pointer-events-none absolute bottom-3 right-3 z-10">
              <div className="pointer-events-auto rounded-[20px] border border-border/70 bg-background/90 p-2 text-xs shadow-[0_18px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="mb-2 text-center font-medium">{Math.round(viewport.scale * 100)}%</div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={() => zoomBy(-0.1)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={resetViewport}>
                    <ScanSearch className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={() => zoomBy(0.1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div
              className="absolute inset-0 overflow-hidden"
              onMouseDown={(event) => {
                if (!canPanCanvas) return
                if (event.target !== event.currentTarget) return
                clearSelection()
                beginCanvasPan(event.clientX, event.clientY)
              }}
            >
              <div
                className="absolute left-0 top-0 h-[1400px] w-[1800px] origin-top-left"
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                }}
                onMouseDown={(event) => {
                  if (!canPanCanvas) return
                  if (event.target !== event.currentTarget) return
                  clearSelection()
                  beginCanvasPan(event.clientX, event.clientY)
                }}
              >
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                {editor.graph.edges.map((edge) => {
                  const source = getNodeById(editor.graph, edge.source)
                  const target = getNodeById(editor.graph, edge.target)
                  if (!source || !target) return null
                  const x1 = source.position.x + 224
                  const y1 = source.position.y + 44
                  const x2 = target.position.x
                  const y2 = target.position.y + 44
                  const cx1 = x1 + 80
                  const cx2 = x2 - 80
                  const path = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
                  const midX = (x1 + x2) / 2
                  const midY = (y1 + y2) / 2
                  const selected = selectedEdgeId === edge.id
                  return (
                    <g key={edge.id}>
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        className="pointer-events-auto cursor-pointer"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedEdgeId(edge.id)
                          setSelectedNodeId(null)
                        }}
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={selected ? "#38bdf8" : edgeColor(edge.label)}
                        strokeWidth={selected ? 3 : 2}
                        strokeDasharray={edge.label === "default" ? "6 4" : undefined}
                      />
                      <rect
                        x={midX - 24}
                        y={midY - 10}
                        width={48}
                        height={20}
                        rx={10}
                        style={{
                          fill: selected ? "rgba(224, 242, 254, 0.98)" : "rgba(248, 250, 252, 0.98)",
                          stroke: selected ? "#38bdf8" : "rgba(100, 116, 139, 0.35)",
                        }}
                      />
                      <text
                        x={midX}
                        y={midY + 4}
                        textAnchor="middle"
                        fontSize="11"
                        fill="#0f172a"
                      >
                        {edge.label || "next"}
                      </text>
                    </g>
                  )
                })}
              </svg>

                {editor.graph.nodes.map((node) => (
                  <CanvasNode
                    key={node.id}
                    node={node}
                    selected={selectedNodeId === node.id}
                    pendingConnection={pendingConnection}
                    onMouseDown={(event, currentNode) => {
                      event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setDragState({
                        nodeId: currentNode.id,
                        offsetX: event.clientX - rect.left,
                        offsetY: event.clientY - rect.top,
                      })
                      selectNode(currentNode)
                    }}
                    onSelect={(currentNode) => {
                      selectNode(currentNode)
                    }}
                    onStartConnection={(currentNode, label) => {
                      setSelectedNodeId(currentNode.id)
                      setSelectedEdgeId(null)
                      setPendingConnection({ sourceId: currentNode.id, label })
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scheduled run</DialogTitle>
            <DialogDescription>
              Run this flow through the existing cron scheduler using a synthetic inbound message.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <FlowScheduleFields
              schedule={editor.schedule}
              onChange={(next) => setEditor((prev) => ({ ...prev, schedule: next }))}
              agents={agents.filter((agent) => agent.enabled).map((agent) => ({ id: agent.id, name: agent.name || agent.id }))}
            />
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Schedule changes are saved with the flow.
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={disableFlowSchedule}
                disabled={editor.schedule.mode === "off"}
              >
                Remove schedule
              </Button>
              <Button type="button" variant="outline" onClick={() => setScheduleDialogOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => handleSave(() => setScheduleDialogOpen(false))}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save flow
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runsDialogOpen} onOpenChange={setRunsDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Flow runs</DialogTitle>
            <DialogDescription>
              Execution history for this saved flow. Runs are persisted in Vault storage.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {flowRunsQuery.isLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading run history...
              </div>
            ) : (flowRunsQuery.data?.runs ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                No recorded runs yet for this flow.
              </div>
            ) : (
              <div className="space-y-3">
                {(flowRunsQuery.data?.runs ?? []).map((run) => (
                  <FlowRunRow key={run.id} run={run} />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={promptPanelOpen} onOpenChange={setPromptPanelOpen}>
        <SheetContent side="right" className="w-[min(920px,100vw)] gap-0 overflow-hidden border-l border-border/70 bg-background/96 p-0 sm:max-w-[920px]">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="text-xl">Compiled prompt</SheetTitle>
            <SheetDescription>
              The graph stays the source of truth. This panel shows and tunes the prompt artifact that actually gets injected into the model.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr),minmax(0,1.05fr)]">
              <div className="space-y-4">
                <div className="rounded-2xl border bg-card/70 p-4 shadow-sm">
                  <PromptCustomizationEditor
                    title="Flow prompt"
                    description="This layer adjusts the final compiled flow prompt after all node fragments are assembled."
                    customization={editor.graph.prompt}
                    autoPrompt={autoCompiledFlowPrompt}
                    finalPrompt={effectiveCompiledFlowPrompt}
                    onChange={(prompt) =>
                      setEditor((prev) => ({
                        ...prev,
                        graph: {
                          ...prev.graph,
                          prompt,
                        },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border bg-card/70 p-4 shadow-sm">
                  <div className="text-sm font-semibold">Node prompt fragments</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Each node compiles to a prompt fragment. Edit node prompt settings from the inspector on the canvas.
                  </div>
                  <div className="mt-4 space-y-3">
                    {editor.graph.nodes.map((node) => {
                      return (
                        <div key={node.id} className="rounded-xl border bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium">{nodeLabel(node.type)}</div>
                              <div className="text-[11px] text-muted-foreground">{node.id}</div>
                            </div>
                            <Badge variant="outline" className={`capitalize ${promptModeBadgeClass(node.prompt)}`}>
                              {promptModeLabel(node.prompt)}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3">
                            <div>
                              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Auto
                              </div>
                              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-[11px]">
                                {compileNodeAutoPrompt(node)}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Effective
                              </div>
                              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-[11px]">
                                {compileNodePrompt(node)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={testPanelOpen} onOpenChange={setTestPanelOpen}>
        <SheetContent side="right" className="w-[min(980px,100vw)] gap-0 overflow-hidden border-l border-border/70 bg-background/96 p-0 sm:max-w-[980px]">
          <SheetHeader className="border-b border-border/70 px-5 py-5">
            <SheetTitle className="text-xl">Flow test space</SheetTitle>
            <SheetDescription>
              Run the graph in a dedicated review surface without collapsing the canvas.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-border/70 px-5 py-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
                <div className="rounded-2xl border bg-card/70 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Test setup</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Synthetic inbound message plus agent/tool preflight.
                      </div>
                    </div>
                    <Badge variant="outline">{flowTestModeLabel(flowTestForm.mode)}</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Agent</label>
                      <select
                        value={flowTestForm.agentId}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({ ...prev, agentId: event.target.value }))
                        }
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                      >
                        <option value="">Select agent</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Mode</label>
                      <select
                        value={flowTestForm.mode}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({
                            ...prev,
                            mode: event.target.value as FlowTestMode,
                          }))
                        }
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                      >
                        <option value="match_only">{flowTestModeLabel("match_only")}</option>
                        <option value="dry_run">{flowTestModeLabel("dry_run")}</option>
                        <option value="apply">{flowTestModeLabel("apply")}</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Channel</label>
                      <select
                        value={flowTestForm.channel}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({ ...prev, channel: event.target.value }))
                        }
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                      >
                        {FLOW_CHANNEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Sender</label>
                      <Input
                        value={flowTestForm.sender}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({ ...prev, sender: event.target.value }))
                        }
                        placeholder={getSenderPlaceholder(flowTestForm.channel).split(",")[0]?.trim() || ""}
                        className="h-10 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Conversation id</label>
                      <Input
                        value={flowTestForm.conversationId}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({
                            ...prev,
                            conversationId: event.target.value,
                          }))
                        }
                        placeholder="optional"
                        className="h-10 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Account id</label>
                      <Input
                        value={flowTestForm.accountId}
                        onChange={(event) =>
                          setFlowTestForm((prev) => ({ ...prev, accountId: event.target.value }))
                        }
                        placeholder="optional"
                        className="h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Inbound message</label>
                    <textarea
                      value={flowTestForm.message}
                      onChange={(event) =>
                        setFlowTestForm((prev) => ({ ...prev, message: event.target.value }))
                      }
                      className="min-h-32 w-full rounded-2xl border bg-transparent px-3 py-3 text-sm"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border bg-card/70 p-4 shadow-sm">
                  <div className="text-sm font-semibold">Agent readiness</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Check tool coverage before running the test.
                  </div>
                  {selectedFlowTestAgent ? (
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="rounded-xl border bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Profile</div>
                        <div className="mt-1 font-medium">{selectedFlowTestAgent.profile ?? "unknown"}</div>
                      </div>
                      <div className="rounded-xl border bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Required tools</div>
                        <div className="mt-1 font-mono text-xs">
                          {requiredTools.length > 0 ? requiredTools.join(", ") : "none"}
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Available tools</div>
                        <div className="mt-1 font-mono text-xs">
                          {Array.from(availableToolSet).length > 0
                            ? Array.from(availableToolSet).join(", ")
                            : "none"}
                        </div>
                      </div>
                      <div
                        className={`rounded-xl border px-3 py-3 text-xs ${
                          missingRequiredTools.length > 0
                            ? "border-red-500/30 bg-red-500/10 text-red-300"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        }`}
                      >
                        {missingRequiredTools.length > 0
                          ? `Missing tools: ${missingRequiredTools.join(", ")}`
                          : "Tool preflight passed for this graph."}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      Select an agent to inspect tool coverage and owner targets.
                    </div>
                  )}

                </div>
              </div>
              </div>

              <div className="px-5 py-5">
                {testMut.data ? (
                  <Tabs defaultValue="overview" className="gap-4">
                    <TabsList variant="line" className="w-full justify-start rounded-none border-b bg-transparent p-0">
                      <TabsTrigger value="overview" className="flex-none px-4">Overview</TabsTrigger>
                      <TabsTrigger value="trace" className="flex-none px-4">Trace</TabsTrigger>
                      <TabsTrigger value="debug" className="flex-none px-4">Debug</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                      {flowRunSummary ? (
                        <TestResultPanel title="Flow result" description="High-signal outcome per step.">
                          <div
                            className={`rounded-2xl border px-4 py-3 text-sm ${
                              flowRunSummary.overall === "success"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : flowRunSummary.overall === "partial"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                  : "border-red-500/30 bg-red-500/10 text-red-300"
                            }`}
                          >
                            <div className="font-medium">{flowRunSummary.overall.toUpperCase()}</div>
                            <div className="mt-1 text-xs">{flowRunSummary.summary}</div>
                          </div>
                          <div className="mt-4 grid gap-3">
                            {flowRunSummary.steps.map((step) => (
                              <div key={step.nodeId} className="rounded-2xl border bg-background/60 px-4 py-3">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="font-medium">{step.label}</span>
                                  <Badge variant="outline" className={stepStatusBadgeClass(step.status)}>
                                    {step.status}
                                  </Badge>
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">{step.detail}</div>
                                {step.lines && step.lines.length > 0 ? (
                                  <div className="mt-3 space-y-2">
                                    {step.lines.map((line, index) => (
                                      <div key={`${step.nodeId}-${index}`} className="rounded-xl bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                                        {line}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </TestResultPanel>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-2">
                        <TestResultPanel title="Sender replies">
                          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                            {JSON.stringify(flowRunSummary?.senderReplies ?? testMut.data.finalPayloads, null, 2)}
                          </pre>
                        </TestResultPanel>
                        <TestResultPanel
                          title="Owner notifications"
                          description="Dry runs simulate delivery. Production run may send the real message."
                        >
                          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                            {JSON.stringify(flowRunSummary?.ownerActions ?? testMut.data.messageActions, null, 2)}
                          </pre>
                        </TestResultPanel>
                      </div>
                    </TabsContent>

                    <TabsContent value="trace" className="space-y-4">
                      <TestResultPanel title="Inbound envelope">
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(testMut.data.input ?? {}, null, 2)}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel title="Injected context">
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {testMut.data.inboundPrependContext || "No flow context matched."}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel title="Prompt snapshot">
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(testMut.data.promptSnapshot ?? {}, null, 2)}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel
                        title="Graph reference"
                        description="The runtime still executes flows through compiled prompt context rather than a native node engine."
                      >
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(compiledForTest.graph ?? editor.graph, null, 2)}
                        </pre>
                      </TestResultPanel>
                    </TabsContent>

                    <TabsContent value="debug" className="space-y-4">
                      <TestResultPanel title="Model + system prompt report">
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(
                            {
                              modelSelections: testMut.data.modelSelections ?? [],
                              systemPromptReport: testMut.data.systemPromptReport ?? null,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel title="Tool calls">
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(testMut.data.toolCalls ?? [], null, 2)}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel title="Tool activity">
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(
                            {
                              toolStarts: testMut.data.toolStarts,
                              toolResults: testMut.data.toolResults,
                              blockPayloads: testMut.data.blockPayloads,
                              partialPayloads: testMut.data.partialPayloads,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel title="Vault mutations">
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(testMut.data.vaultMutations, null, 2)}
                        </pre>
                      </TestResultPanel>
                      <TestResultPanel
                        title="Message actions"
                        description="External message actions are recorded here. In production run they may have been delivered."
                      >
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                          {JSON.stringify(testMut.data.messageActions, null, 2)}
                        </pre>
                      </TestResultPanel>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center py-10">
                    <div className="max-w-md rounded-[28px] border border-dashed bg-card/40 px-8 py-10 text-center shadow-sm">
                      <div className="text-lg font-semibold">No test run yet</div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Configure an inbound message and run the graph. Results will appear here in a cleaner, step-by-step view.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-border/70 bg-background/95 px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {testMut.data ? "Adjust inputs and rerun at any time." : "Run from here after filling the setup fields."}
                </div>
                <Button className="gap-2 rounded-xl" onClick={handleRunFlowTest} disabled={testMut.isPending}>
                  {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run test
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={flowToDelete !== null}
        onOpenChange={(open) => { if (!open) setFlowToDelete(null) }}
        title="Delete flow"
        description="Delete this flow? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMut.isPending}
        onConfirm={() => {
          if (!flowToDelete) return
          deleteMut.mutate(flowToDelete, {
            onSuccess: () => {
              if (selectedId === flowToDelete) handleCreateFlow()
              toast.success("Flow deleted")
              setFlowToDelete(null)
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : "Failed to delete flow")
              setFlowToDelete(null)
            },
          })
        }}
      />
    </div>
  )
}
