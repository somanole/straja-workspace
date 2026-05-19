import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteOllamaModel,
  embed,
  getModelsStatus,
  getOllamaRuntimeStatus,
  installOllamaRuntime,
  pullModels,
  pullOllamaModel,
  restartOllamaRuntime,
  removeOllamaRuntime,
  startOllamaRuntime,
  stopOllamaRuntime,
} from "@/lib/api"

function refreshOllamaQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["models", "ollama-runtime"] })
  qc.invalidateQueries({ queryKey: ["agents", "ollama-models"] })
}

function scheduleOllamaRefreshes(qc: ReturnType<typeof useQueryClient>, delaysMs: number[]) {
  for (const delayMs of delaysMs) {
    setTimeout(() => {
      refreshOllamaQueries(qc)
    }, delayMs)
  }
}

export function useModelsStatus() {
  return useQuery({
    queryKey: ["models", "status"],
    queryFn: getModelsStatus,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.pulling) {
        return 3_000
      }
      return 30_000
    },
  })
}

export function usePullModels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (refresh?: boolean) => pullModels(refresh),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useOllamaRuntimeStatus(enabled = true) {
  return useQuery({
    queryKey: ["models", "ollama-runtime"],
    queryFn: getOllamaRuntimeStatus,
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 5_000
      return data.available ? 30_000 : 5_000
    },
  })
}

export function useInstallOllamaRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => installOllamaRuntime(),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000, 6000])
    },
  })
}

export function useRemoveOllamaRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => removeOllamaRuntime(),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000])
    },
  })
}

export function useStartOllamaRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => startOllamaRuntime(),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000, 6000])
    },
  })
}

export function useStopOllamaRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => stopOllamaRuntime(),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000])
    },
  })
}

export function useRestartOllamaRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => restartOllamaRuntime(),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000, 6000])
    },
  })
}

export function useEmbed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force?: boolean) => embed(force),
    onSuccess: () => {
      // Immediately refetch status, then the faster polling interval
      // in useVaultStatus will track progress until embedding completes
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function usePullOllamaModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (model: string) => pullOllamaModel(model),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000, 6000])
    },
  })
}

export function useDeleteOllamaModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (model: string) => deleteOllamaModel(model),
    onSuccess: () => {
      scheduleOllamaRefreshes(qc, [0, 1000, 3000])
    },
  })
}
