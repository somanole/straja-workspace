import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getBrowserStatus,
  getBrowserPolicy,
  getBrowserAudit,
  getWebSearchAudit,
  updateBrowserConfig,
  updateBrowserPolicy,
  resetBrowserPolicy,
  startBrowser,
  stopBrowser,
} from "@/lib/api"
import type { BrowserConfig, BrowserPolicy } from "@/lib/types"

export function useBrowserStatus() {
  return useQuery({
    queryKey: ["browser", "status"],
    queryFn: getBrowserStatus,
    staleTime: 10_000,
  })
}

export function useBrowserPolicy() {
  return useQuery({
    queryKey: ["browser", "policy"],
    queryFn: getBrowserPolicy,
    staleTime: 10_000,
  })
}

export function useBrowserAudit(date?: string | null) {
  return useQuery({
    queryKey: ["browser", "audit", date ?? null],
    queryFn: () => getBrowserAudit(date ?? undefined),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useWebSearchAudit(date?: string | null) {
  return useQuery({
    queryKey: ["web-search", "audit", date ?? null],
    queryFn: () => getWebSearchAudit(date ?? undefined),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useBrowserConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<BrowserConfig>) => updateBrowserConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["browser", "status"] })
    },
  })
}

export function useBrowserPolicyConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<BrowserPolicy>) => updateBrowserPolicy(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["browser", "policy"] })
    },
  })
}

export function useBrowserPolicyReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resetBrowserPolicy,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["browser", "policy"] })
    },
  })
}

export function useBrowserStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: startBrowser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["browser", "status"] })
    },
  })
}

export function useBrowserStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: stopBrowser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["browser", "status"] })
    },
  })
}
