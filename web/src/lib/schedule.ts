import type { FlowScheduleConfig, ScheduleConfig } from "./schedule-types"

export function getDefaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

export function toLocalDateTimeInputValue(iso?: string | null) {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalDateTimeInputValue(value?: string | null) {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

export function getEveryMinutes(schedule?: ScheduleConfig | null) {
  if (!schedule) return 360
  if (typeof schedule.everyMinutes === "number" && Number.isFinite(schedule.everyMinutes) && schedule.everyMinutes > 0) {
    return Math.max(1, Math.round(schedule.everyMinutes))
  }
  if (typeof schedule.everyHours === "number" && Number.isFinite(schedule.everyHours) && schedule.everyHours > 0) {
    return Math.max(1, Math.round(schedule.everyHours * 60))
  }
  return 360
}

export function getEveryUnit(schedule?: ScheduleConfig | null): "minutes" | "hours" {
  if (schedule?.everyUnit === "minutes" || schedule?.everyUnit === "hours") {
    return schedule.everyUnit
  }
  const everyMinutes = getEveryMinutes(schedule)
  return everyMinutes % 60 === 0 ? "hours" : "minutes"
}

export function createDefaultSchedule(): ScheduleConfig {
  return {
    mode: "off",
    everyMinutes: 360,
    everyUnit: "hours",
    dailyTime: "10:00",
    onceAt: undefined,
    timezone: getDefaultTimezone(),
    cronExpr: "0 10 * * *",
  }
}

export function createDefaultFlowSchedule(): FlowScheduleConfig {
  return {
    ...createDefaultSchedule(),
    channel: "whatsapp",
    message: "Run scheduled flow",
  }
}

export function isScheduleEnabled(schedule?: ScheduleConfig | null) {
  return Boolean(schedule && schedule.mode !== "off")
}

export function formatScheduleLabel(schedule?: ScheduleConfig | null) {
  if (!schedule || schedule.mode === "off") {
    return "Not scheduled"
  }
  if (schedule.mode === "every") {
    const everyMinutes = getEveryMinutes(schedule)
    if (getEveryUnit(schedule) === "hours") {
      return `Every ${everyMinutes / 60}h`
    }
    return `Every ${everyMinutes}m`
  }
  if (schedule.mode === "daily") {
    return `Daily ${schedule.dailyTime || "10:00"}${schedule.timezone ? ` ${schedule.timezone}` : ""}`
  }
  if (schedule.mode === "once") {
    const date = schedule.onceAt ? new Date(schedule.onceAt) : null
    if (!date || Number.isNaN(date.getTime())) {
      return "Once"
    }
    return `Once ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`
  }
  return `Cron ${schedule.cronExpr || ""}${schedule.timezone ? ` ${schedule.timezone}` : ""}`.trim()
}
