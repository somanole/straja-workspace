import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getUsageOverview, getUsagePricing, updateUsagePricing } from "@/lib/api"

export function useUsageOverview(params: {
  days?: number
  startDate?: string
  endDate?: string
}) {
  return useQuery({
    queryKey: ["usage", "overview", params.days ?? null, params.startDate ?? null, params.endDate ?? null],
    queryFn: () => getUsageOverview(params),
    staleTime: 30_000,
  })
}

export function useUsagePricing() {
  return useQuery({
    queryKey: ["usage", "pricing"],
    queryFn: () => getUsagePricing(),
    staleTime: 30_000,
  })
}

export function useUpdateUsagePricing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateUsagePricing,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["usage", "pricing"] }),
        queryClient.invalidateQueries({ queryKey: ["usage", "overview"] }),
      ])
    },
  })
}
