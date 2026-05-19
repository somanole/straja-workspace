import { useMutation, useQueryClient } from "@tanstack/react-query"
import { lockEncryption } from "@/lib/api"

export function useLockVaultEncryption() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: lockEncryption,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] })
      queryClient.invalidateQueries({ queryKey: ["status"] })
      queryClient.invalidateQueries({ queryKey: ["browser", "status"] })
      queryClient.invalidateQueries({ queryKey: ["gmail", "status"] })
      queryClient.invalidateQueries({ queryKey: ["gdrive", "status"] })
      queryClient.invalidateQueries({ queryKey: ["gcalendar", "status"] })
      queryClient.invalidateQueries({ queryKey: ["gcontacts", "status"] })
    },
  })
}
