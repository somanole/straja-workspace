import { useQuery } from "@tanstack/react-query"
import { getUnifiedAudit, getWorkspaceLogs } from "@/lib/api"

export function useAudit(date?: string | null, category?: string | null) {
  return useQuery({
    queryKey: ["audit", date ?? null, category ?? null],
    queryFn: () => getUnifiedAudit(date ?? undefined, category ?? undefined),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useWorkspaceLogs(enabled: boolean) {
  return useQuery({
    queryKey: ["audit", "workspace-logs"],
    queryFn: getWorkspaceLogs,
    staleTime: 5_000,
    refetchInterval: enabled ? 10_000 : false,
    enabled,
  })
}
