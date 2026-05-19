import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getContactsStatus,
  authorizeContacts,
  syncContacts,
  updateContactsConfig,
  disconnectContacts,
} from "@/lib/api"

export function useContactsStatus() {
  return useQuery({
    queryKey: ["gcontacts", "status"],
    queryFn: getContactsStatus,
    staleTime: 30_000,
  })
}

export function useContactsAuthorize() {
  return useMutation({
    mutationFn: authorizeContacts,
  })
}

export function useContactsSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncContacts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcontacts", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["gcontacts", "status"] })
    },
  })
}

export function useContactsConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: {
      pollEnabled?: boolean
      pollIntervalMinutes?: number
    }) => updateContactsConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcontacts", "status"] })
    },
  })
}

export function useContactsDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectContacts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcontacts", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}
