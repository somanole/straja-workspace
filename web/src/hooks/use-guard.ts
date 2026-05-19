import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getGuardStatus,
  getGuardEvents,
  getGuardLogs,
  startGuard as apiStartGuard,
  stopGuard as apiStopGuard,
  restartGuard as apiRestartGuard,
  getGuardConfig,
  updateGuardConfig as apiUpdateGuardConfig,
} from "@/lib/api"

function scheduleGuardRefreshes(
  qc: ReturnType<typeof useQueryClient>,
  delaysMs: number[],
) {
  for (const delayMs of delaysMs) {
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["guard", "status"] })
      qc.invalidateQueries({ queryKey: ["guard", "events"] })
      qc.invalidateQueries({ queryKey: ["guard", "logs"] })
    }, delayMs)
  }
}

export function useGuardStatus() {
  return useQuery({
    queryKey: ["guard", "status"],
    queryFn: getGuardStatus,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useGuardConfig() {
  return useQuery({
    queryKey: ["guard", "config"],
    queryFn: getGuardConfig,
    staleTime: 30_000,
  })
}

export function useGuardEvents(date?: string) {
  return useQuery({
    queryKey: ["guard", "events", date ?? null],
    queryFn: () => getGuardEvents(date),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useGuardLogs(enabled: boolean) {
  return useQuery({
    queryKey: ["guard", "logs"],
    queryFn: getGuardLogs,
    staleTime: 5_000,
    refetchInterval: enabled ? 10_000 : false,
    enabled,
  })
}

export function useGuardStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (configOverride?: Parameters<typeof apiStartGuard>[0]) =>
      apiStartGuard(configOverride),
    onSuccess: () => {
      scheduleGuardRefreshes(qc, [0, 1000, 3000, 6000, 10_000])
    },
  })
}

export function useGuardStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiStopGuard(),
    onSuccess: () => {
      scheduleGuardRefreshes(qc, [0, 1000, 3000])
    },
  })
}

export function useGuardRestart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiRestartGuard(),
    onSuccess: () => {
      scheduleGuardRefreshes(qc, [0, 1000, 3000, 6000, 10_000])
    },
  })
}

export function useGuardConfigUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: Parameters<typeof apiUpdateGuardConfig>[0]) =>
      apiUpdateGuardConfig(updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guard", "config"] })
      qc.invalidateQueries({ queryKey: ["guard", "status"] })
    },
  })
}
