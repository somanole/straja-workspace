import type { FlowScheduleConfig } from "./schedule-types"
import type { AgentLatestUsage } from "./types"

export interface FlowTrigger {
  channels?: string[]
  accountIds?: string[]
  senders?: string[]
  conversationIds?: string[]
}

export type FlowVarValue = string | number | boolean
export type FlowPromptMode = "auto" | "append" | "override"

export interface FlowPromptCustomization {
  mode?: FlowPromptMode
  appendText?: string
  overrideText?: string
}

export type FlowNodeType =
  | "message_received"
  | "lookup_file"
  | "llm_task"
  | "set_variables"
  | "if"
  | "switch"
  | "search"
  | "create_file"
  | "update_file"
  | "http_request"
  | "for_each"
  | "wait"
  | "ask_question"
  | "run_task"
  | "call_tool"
  | "run_subflow"
  | "send_message"
  | "end"

export interface FlowGraphNode {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  config?: Record<string, unknown>
  prompt?: FlowPromptCustomization
}

export interface FlowGraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface FlowGraph {
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
  prompt?: FlowPromptCustomization
}

export interface FlowDefinition {
  id: string
  enabled: boolean
  kind: "inbound_message"
  name: string
  priority: number
  trigger: FlowTrigger
  vars: Record<string, FlowVarValue>
  instruction: string
  updatedAt?: string
  graph?: FlowGraph
  schedule?: FlowScheduleConfig
}

export type FlowRunTrigger = "scheduled" | "manual_test" | "manual_apply"

export type FlowRunStatus = "ok" | "error"

export interface FlowRunRecord {
  id: string
  flowId: string
  flowName: string
  agentId: string
  trigger: FlowRunTrigger
  mode: Exclude<FlowTestMode, "match_only"> | "apply"
  status: FlowRunStatus
  startedAt: string
  completedAt: string
  durationMs: number
  channel: string
  message: string
  sender?: string
  accountId?: string
  conversationId?: string
  to?: string
  summary?: string
  error?: string
  usage?: AgentLatestUsage
}

export type FlowTestMode = "match_only" | "dry_run" | "apply"

export interface FlowTestRequest {
  agentId?: string
  flowId?: string
  mode: FlowTestMode
  channel: string
  message: string
  sender?: string
  senderE164?: string
  senderName?: string
  senderUsername?: string
  accountId?: string
  conversationId?: string
  to?: string
  flow?: Omit<FlowDefinition, "updatedAt">
}

export interface FlowTestResult {
  ok: true
  agentId: string
  mode: FlowTestMode
  inboundPrependContext?: string
  counts?: Record<string, number>
  input?: Record<string, unknown>
  promptSnapshot?: Record<string, unknown>
  modelSelections?: Array<Record<string, unknown>>
  systemPromptReport?: Record<string, unknown>
  finalPayloads: Array<Record<string, unknown>>
  blockPayloads: Array<Record<string, unknown>>
  partialPayloads: Array<Record<string, unknown>>
  toolStarts: Array<Record<string, unknown>>
  toolResults: Array<Record<string, unknown>>
  toolCalls?: Array<Record<string, unknown>>
  vaultMutations: Array<Record<string, unknown>>
  messageActions: Array<Record<string, unknown>>
}
