import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getWebSearchPolicy,
  updateWebSearchPolicy,
} from "@/lib/api"
import type { WebSearchPolicy } from "@/lib/types"

export function useWebSearchPolicy() {
  return useQuery({
    queryKey: ["web-search", "policy"],
    queryFn: getWebSearchPolicy,
    staleTime: 10_000,
  })
}

export function useWebSearchPolicyUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<WebSearchPolicy>) => updateWebSearchPolicy(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["web-search", "policy"] })
    },
  })
}
