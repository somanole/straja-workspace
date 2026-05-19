import type { ScheduleConfig } from "./schedule-types"

// Task data model — stored in vault _tasks collection

export type TaskStatus = "scheduled" | "running" | "completed" | "failed"

export type ActivityType =
  | "instruction"
  | "reasoning"
  | "tool_call"
  | "output"
  | "delegation"
  | "error"
  | "status_change"

export interface TaskMeta {
  id: string
  title: string
  instruction: string
  agentId: string
  status: TaskStatus
  sessionKey: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  error: string | null
  schedule?: ScheduleConfig
}

export interface ActivityEntry {
  ts: string
  type: ActivityType
  summary: string
  detail?: string
  meta?: Record<string, unknown>
}

export interface TaskListItem {
  id: string
  title: string
  agentId: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  schedule?: ScheduleConfig
}

export interface TaskOutput {
  collection: string
  path: string
  title: string
  size: number
  createdAt: string
}

export interface TaskDetailResponse {
  meta: TaskMeta
  activity: ActivityEntry[]
  activityTotal: number
  outputs: TaskOutput[]
}

export interface CreateTaskRequest {
  title?: string
  instruction: string
  agentId?: string
  schedule?: ScheduleConfig
}
