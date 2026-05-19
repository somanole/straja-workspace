import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { listArtifacts, buildPresentation } from "@/lib/api"

export function useArtifacts(prefix?: string) {
  return useQuery({
    queryKey: ["artifacts", prefix],
    queryFn: () => listArtifacts(prefix),
    refetchInterval: 10_000,
  })
}

export function useBuildPresentation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => buildPresentation(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artifacts"] })
    },
  })
}
