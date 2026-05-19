import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FlowScheduleConfig, ScheduleConfig, ScheduleMode } from "@/lib/schedule-types"
import {
  fromLocalDateTimeInputValue,
  getDefaultTimezone,
  getEveryMinutes,
  getEveryUnit,
  toLocalDateTimeInputValue,
} from "@/lib/schedule"

type AgentOption = {
  id: string
  name: string
}

function patchSchedule<T extends ScheduleConfig>(
  schedule: T,
  patch: Partial<T>,
): T {
  return { ...schedule, ...patch }
}

function getModeDefaults<T extends ScheduleConfig>(schedule: T, mode: ScheduleMode): Partial<T> {
  if (mode === "every") {
    return {
      mode,
      everyMinutes: getEveryMinutes(schedule),
      everyUnit: getEveryUnit(schedule),
    } as Partial<T>
  }
  if (mode === "daily") {
    return {
      mode,
      dailyTime: schedule.dailyTime ?? "10:00",
      timezone: schedule.timezone || getDefaultTimezone(),
    } as Partial<T>
  }
  if (mode === "once") {
    return {
      mode,
      onceAt:
        schedule.onceAt ??
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as Partial<T>
  }
  if (mode === "cron") {
    return {
      mode,
      cronExpr: schedule.cronExpr ?? "0 10 * * *",
      timezone: schedule.timezone || getDefaultTimezone(),
    } as Partial<T>
  }
  return {
    mode,
    timezone: schedule.timezone || getDefaultTimezone(),
  } as Partial<T>
}

export function ScheduleFields({
  schedule,
  onChange,
}: {
  schedule: ScheduleConfig
  onChange: (next: ScheduleConfig) => void
}) {
  const mode = schedule.mode
  const everyMinutes = getEveryMinutes(schedule)
  const everyUnit = getEveryUnit(schedule)
  const everyValue = everyUnit === "hours" ? Math.max(1, Math.round(everyMinutes / 60)) : everyMinutes

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Schedule</label>
        <Select
          value={schedule.mode}
          onValueChange={(value) =>
            onChange(
              patchSchedule(schedule, getModeDefaults(schedule, value as ScheduleMode)),
            )
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="every">Every N minutes or hours</SelectItem>
            <SelectItem value="daily">Daily at time</SelectItem>
            <SelectItem value="once">One-off run</SelectItem>
            <SelectItem value="cron">Custom cron</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "every" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Repeat every</label>
            <Input
              type="number"
              min={1}
              value={String(everyValue)}
              onChange={(event) => {
                const raw = Number.parseInt(event.target.value || "1", 10) || 1
                onChange(
                  patchSchedule(schedule, {
                    everyMinutes: everyUnit === "hours" ? raw * 60 : raw,
                    everyUnit,
                  }),
                )
              }}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Unit</label>
            <Select
              value={everyUnit}
              onValueChange={(value) => {
                const nextUnit = value === "hours" ? "hours" : "minutes"
                const nextEveryMinutes =
                  nextUnit === "hours"
                    ? Math.max(1, everyValue) * 60
                    : Math.max(1, everyValue)
                onChange(
                  patchSchedule(schedule, {
                    everyMinutes: nextEveryMinutes,
                    everyUnit: nextUnit,
                  }),
                )
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {mode === "daily" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Time</label>
            <Input
              type="time"
              value={schedule.dailyTime ?? "10:00"}
              onChange={(event) =>
                onChange(patchSchedule(schedule, { dailyTime: event.target.value || "10:00" }))
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Timezone</label>
            <Input
              value={schedule.timezone ?? getDefaultTimezone()}
              onChange={(event) =>
                onChange(
                  patchSchedule(schedule, { timezone: event.target.value || getDefaultTimezone() }),
                )
              }
              className="h-8 text-sm"
              placeholder="Europe/Berlin"
            />
          </div>
        </div>
      ) : null}

      {mode === "once" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Run at</label>
            <Input
              type="datetime-local"
              value={toLocalDateTimeInputValue(schedule.onceAt)}
              onChange={(event) =>
                onChange(
                  patchSchedule(schedule, {
                    onceAt:
                      fromLocalDateTimeInputValue(event.target.value) ??
                      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  }),
                )
              }
              className="h-8 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Uses your local timezone: {getDefaultTimezone()}
          </p>
        </div>
      ) : null}

      {mode === "cron" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Cron expression</label>
            <Input
              value={schedule.cronExpr ?? "0 10 * * *"}
              onChange={(event) =>
                onChange(patchSchedule(schedule, { cronExpr: event.target.value || "0 10 * * *" }))
              }
              className="h-8 text-sm"
              placeholder="0 10 * * *"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Timezone (optional)</label>
            <Input
              value={schedule.timezone ?? ""}
              onChange={(event) =>
                onChange(patchSchedule(schedule, { timezone: event.target.value || undefined }))
              }
              className="h-8 text-sm"
              placeholder="Europe/Berlin"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function FlowScheduleFields({
  schedule,
  onChange,
  agents,
}: {
  schedule: FlowScheduleConfig
  onChange: (next: FlowScheduleConfig) => void
  agents: AgentOption[]
}) {
  return (
    <div className="space-y-3">
      <ScheduleFields schedule={schedule} onChange={(next) => onChange({ ...schedule, ...next })} />

      {schedule.mode !== "off" ? (
        <>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Agent</label>
            <Select
              value={schedule.agentId}
              onValueChange={(value) => onChange({ ...schedule, agentId: value })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Channel</label>
              <Input
                value={schedule.channel ?? "whatsapp"}
                onChange={(event) => onChange({ ...schedule, channel: event.target.value || "whatsapp" })}
                className="h-8 text-sm"
                placeholder="whatsapp"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Sender (optional)</label>
              <Input
                value={schedule.sender ?? ""}
                onChange={(event) => onChange({ ...schedule, sender: event.target.value || undefined })}
                className="h-8 text-sm"
                placeholder="+49123456789"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Synthetic message</label>
            <textarea
              value={schedule.message ?? "Run scheduled flow"}
              onChange={(event) => onChange({ ...schedule, message: event.target.value || "Run scheduled flow" })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[72px] resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Run scheduled flow"
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
