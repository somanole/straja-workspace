import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { deleteFlow, getFlowRuns, listFlows, saveFlow } from "@/lib/api"
import type { FlowDefinition } from "@/lib/flow-types"

export function useFlows() {
  return useQuery({
    queryKey: ["flows"],
    queryFn: listFlows,
    staleTime: 15_000,
  })
}

export function useSaveFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      flow,
    }: {
      id: string
      flow: Omit<FlowDefinition, "id"> & { id?: string }
    }) => saveFlow(id, flow),
    onSuccess: ({ flow }) => {
      qc.setQueryData<{ flows: FlowDefinition[] } | undefined>(["flows"], (current) => {
        if (!current) {
          return { flows: [flow] }
        }
        const existingIndex = current.flows.findIndex((entry) => entry.id === flow.id)
        if (existingIndex === -1) {
          return { flows: [flow, ...current.flows] }
        }
        const nextFlows = [...current.flows]
        nextFlows[existingIndex] = flow
        return { flows: nextFlows }
      })
      qc.invalidateQueries({ queryKey: ["flows"] })
    },
  })
}

export function useDeleteFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFlow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flows"] })
    },
  })
}

export function useFlowRuns(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["flows", id, "runs"],
    queryFn: () => getFlowRuns(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 5_000,
  })
}
