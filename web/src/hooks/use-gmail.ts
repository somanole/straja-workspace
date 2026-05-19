import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getGmailStatus,
  authorizeGmail,
  syncGmail,
  updateGmailConfig,
  disconnectGmail,
  createGmailDraft,
  type CreateDraftRequest,
} from "@/lib/api"

export function useGmailStatus() {
  return useQuery({
    queryKey: ["gmail", "status"],
    queryFn: getGmailStatus,
    staleTime: 30_000,
  })
}

export function useGmailAuthorize() {
  return useMutation({
    mutationFn: authorizeGmail,
  })
}

export function useGmailSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncGmail,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "status"] })
    },
  })
}

export function useGmailConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: {
      labels?: string[]
      includeThreads?: boolean
      pollEnabled?: boolean
      pollIntervalMinutes?: number
      syncMode?: "labels" | "all"
      syncDaysBack?: number
    }) =>
      updateGmailConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "status"] })
    },
  })
}

export function useGmailDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectGmail,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useCreateGmailDraft() {
  return useMutation({
    mutationFn: (draft: CreateDraftRequest) => createGmailDraft(draft),
  })
}
