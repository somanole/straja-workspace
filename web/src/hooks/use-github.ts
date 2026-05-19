import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getGitHubStatus,
  authorizeGitHub,
  getGitHubRepos,
  syncGitHub,
  updateGitHubConfig,
  disconnectGitHub,
} from "@/lib/api"

export function useGitHubStatus() {
  return useQuery({
    queryKey: ["github", "status"],
    queryFn: getGitHubStatus,
    staleTime: 30_000,
  })
}

export function useGitHubAuthorize() {
  return useMutation({
    mutationFn: authorizeGitHub,
  })
}

export function useGitHubRepos() {
  const { data: status } = useGitHubStatus()
  return useQuery({
    queryKey: ["github", "repos"],
    queryFn: getGitHubRepos,
    enabled: status?.status === "connected",
    staleTime: 60_000,
  })
}

export function useGitHubSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncGitHub,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["github"] })
    },
  })
}

export function useGitHubConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: {
      selectedRepos?: { owner: string; name: string; fullName: string }[]
      pollEnabled?: boolean
      pollIntervalMinutes?: number
      syncIssues?: boolean
      syncPRs?: boolean
    }) => updateGitHubConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "status"] })
    },
  })
}

export function useGitHubDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectGitHub,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}
