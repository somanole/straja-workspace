import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getWebFetchPolicy,
  updateWebFetchPolicy,
  resetWebFetchPolicy,
} from "@/lib/api"
import type { WebFetchPolicy } from "@/lib/types"

export function useWebFetchPolicy() {
  return useQuery({
    queryKey: ["web-fetch", "policy"],
    queryFn: getWebFetchPolicy,
    staleTime: 10_000,
  })
}

export function useWebFetchPolicyUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<WebFetchPolicy>) => updateWebFetchPolicy(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["web-fetch", "policy"] })
    },
  })
}

export function useWebFetchPolicyReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resetWebFetchPolicy,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["web-fetch", "policy"] })
    },
  })
}
