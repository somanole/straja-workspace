import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getOpenclawOrchestrationSettings,
  updateOpenclawOrchestrationSettings,
} from "@/lib/api"

export function useOpenclawOrchestrationSettings() {
  return useQuery({
    queryKey: ["openclaw", "orchestration"],
    queryFn: getOpenclawOrchestrationSettings,
    staleTime: 15_000,
  })
}

export function useUpdateOpenclawOrchestrationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: { enabled?: boolean }) =>
      updateOpenclawOrchestrationSettings(updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["openclaw", "orchestration"] })
      qc.invalidateQueries({ queryKey: ["orchestration", "runs"] })
    },
  })
}
