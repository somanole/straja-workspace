import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  listSessions,
  execCommand,
  pollSession,
  getSessionLog,
  killSession,
  deleteSession,
  writeToSession,
} from "@/lib/api"
import type { ExecRequest } from "@/lib/types"

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ["exec", "sessions"],
    queryFn: listSessions,
    refetchInterval: 5000,
    enabled,
  })
}

export function useSessionLog(id: string | null) {
  return useQuery({
    queryKey: ["exec", "sessions", id, "log"],
    queryFn: () => getSessionLog(id!, 0, 1000),
    enabled: !!id,
    refetchInterval: 3000,
  })
}

export function useSessionPoll(id: string | null, enabled = false) {
  return useQuery({
    queryKey: ["exec", "sessions", id, "poll"],
    queryFn: () => pollSession(id!, 0),
    enabled: !!id && enabled,
    refetchInterval: 2000,
  })
}

export function useExecCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: ExecRequest) => execCommand(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exec", "sessions"] })
    },
  })
}

export function useKillSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => killSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exec", "sessions"] })
    },
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exec", "sessions"] })
    },
  })
}

export function useWriteToSession() {
  return useMutation({
    mutationFn: (vars: { id: string; data?: string; eof?: boolean }) =>
      writeToSession(vars.id, vars.data, vars.eof),
  })
}
