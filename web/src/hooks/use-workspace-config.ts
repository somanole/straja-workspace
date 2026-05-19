import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getWorkspaceConfig, updateWorkspaceConfig } from "@/lib/api"

export function useWorkspaceConfig() {
  return useQuery({
    queryKey: ["workspace", "config"],
    queryFn: getWorkspaceConfig,
    staleTime: 30_000,
  })
}

export function useWorkspaceConfigUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateWorkspaceConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", "config"] })
    },
  })
}
