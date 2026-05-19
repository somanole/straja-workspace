import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getHealthStats,
  cleanupVectors,
  cleanupContent,
  purgeInactive,
  clearLLMCache,
  vacuumDB,
} from "@/lib/api"

export function useHealthStats() {
  return useQuery({
    queryKey: ["health-stats"],
    queryFn: getHealthStats,
    refetchInterval: 30_000,
    staleTime: 5_000,
  })
}

export function useCleanupVectors() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: cleanupVectors,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-stats"] })
    },
  })
}

export function useCleanupContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: cleanupContent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-stats"] })
    },
  })
}

export function usePurgeInactive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: purgeInactive,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-stats"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useClearLLMCache() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clearLLMCache,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-stats"] })
    },
  })
}

export function useVacuumDB() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vacuumDB,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-stats"] })
    },
  })
}
