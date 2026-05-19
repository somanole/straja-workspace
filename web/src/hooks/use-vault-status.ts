import { useQuery } from "@tanstack/react-query"
import { getHealth, getStatus } from "@/lib/api"

export function useVaultStatus(refetchInterval = 30_000) {
  const query = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: (query) => {
      // Poll every 3s while embedding is in progress, otherwise use default
      const data = query.state.data
      if (data?.embedding || (data?.needsEmbedding ?? 0) > 0) {
        return 3_000
      }
      return refetchInterval
    },
    retry: 2,
    staleTime: 2_000,
  })
  return query
}

export function useVaultHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: 1,
  })
}
