export type ScheduleMode = "off" | "every" | "daily" | "once" | "cron"

export interface ScheduleConfig {
  mode: ScheduleMode
  cronJobId?: string
  everyMinutes?: number
  everyHours?: number
  everyUnit?: "minutes" | "hours"
  dailyTime?: string
  onceAt?: string
  timezone?: string
  cronExpr?: string
}

export interface FlowScheduleConfig extends ScheduleConfig {
  agentId?: string
  channel?: string
  message?: string
  sender?: string
  accountId?: string
  conversationId?: string
  to?: string
}
