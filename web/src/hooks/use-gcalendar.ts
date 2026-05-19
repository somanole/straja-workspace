import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getCalendarStatus,
  authorizeCalendar,
  syncCalendar,
  updateCalendarConfig,
  disconnectCalendar,
  listCalendars,
} from "@/lib/api"

export function useCalendarStatus() {
  return useQuery({
    queryKey: ["gcalendar", "status"],
    queryFn: getCalendarStatus,
    staleTime: 30_000,
  })
}

export function useCalendarAuthorize() {
  return useMutation({
    mutationFn: authorizeCalendar,
  })
}

export function useCalendarSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncCalendar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcalendar", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["gcalendar", "status"] })
    },
  })
}

export function useCalendarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: {
      calendars?: { id: string; name: string }[]
      syncWindowPastDays?: number
      syncWindowFutureDays?: number
      pollEnabled?: boolean
      pollIntervalMinutes?: number
    }) => updateCalendarConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcalendar", "status"] })
    },
  })
}

export function useCalendarDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectCalendar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcalendar", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useCalendarList() {
  return useMutation({
    mutationFn: listCalendars,
  })
}
