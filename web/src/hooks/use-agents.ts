import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getAgentsStatus,
  getAgentProfiles,
  detectOpenclawAgent,
  createStarterTeam,
  getOllamaModelsStatus,
  updateAgentConfig,
  removeAgent,
  testAgentConnection,
  startAgent,
  stopAgent,
  restartAgent,
  issueAgentVaultAccessToken,
  revokeAgentVaultAccess,
  updateAgentUpstreamAuth,
  clearAgentUpstreamAuth,
  authorizeAgentOpenAIOAuth,
  getAgentChannels,
  getAgentLogs,
  startWhatsAppLogin,
  pollWhatsAppLogin,
  updateTelegramConfig,
  updateAgentChannelPolicy,
  approveAgentChannelPairing,
  disconnectAgentChannel,
  resetAgentChannel,
} from "@/lib/api"

function invalidateAgentCardQueries(qc: ReturnType<typeof useQueryClient>, agentId: string) {
  qc.invalidateQueries({ queryKey: ["agents", "status"] })
  qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
  qc.invalidateQueries({ queryKey: ["agents", agentId, "logs"] })
}

function scheduleAgentCardRefreshes(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string,
  delaysMs: number[],
) {
  for (const delayMs of delaysMs) {
    setTimeout(() => {
      invalidateAgentCardQueries(qc, agentId)
    }, delayMs)
  }
}

export function useAgentsStatus() {
  return useQuery({
    queryKey: ["agents", "status"],
    queryFn: getAgentsStatus,
    staleTime: 30_000,
  })
}

export function useAgentProfiles() {
  return useQuery({
    queryKey: ["agents", "profiles"],
    queryFn: getAgentProfiles,
    staleTime: 60_000,
  })
}

export function useDetectOpenclawAgent(enabled: boolean) {
  return useQuery({
    queryKey: ["agents", "detect-openclaw"],
    queryFn: detectOpenclawAgent,
    enabled,
    staleTime: 60_000,
  })
}

export function useOllamaModelsStatus(enabled = true) {
  return useQuery({
    queryKey: ["agents", "ollama-models"],
    queryFn: getOllamaModelsStatus,
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data?.available) return 5_000
      return 30_000
    },
  })
}

export function useStarterTeamCreate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => createStarterTeam(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agent: {
      id: string
      name: string
      type: string
      gatewayUrl: string
      token?: string
      gatewayToken?: string
      hooksPath: string
      enabled: boolean
      notifications: { gmail: boolean; gcalendar: boolean }
      autoPair?: boolean
      profile?: string
      networkAllowlist?: string[]
      customTools?: string[]
      model?: string
      modelFallbacks?: string[]
      modelPolicy?: import("@/lib/types").AgentModelRoutingPolicy
      memoryPromptInjectionMode?: import("@/lib/types").AgentMemoryPromptInjectionMode
      routingProfile?: import("@/lib/types").AgentRoutingProfile
    }) => updateAgentConfig(agent),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentRemove() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => removeAgent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => testAgentConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentRestart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => restartAgent(id),
    onSuccess: (_data, agentId) => {
      scheduleAgentCardRefreshes(qc, agentId, [0, 1000, 3000, 6000, 10_000, 15_000])
    },
  })
}

export function useAgentStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => startAgent(id),
    onSuccess: (_data, agentId) => {
      scheduleAgentCardRefreshes(qc, agentId, [0, 1000, 3000, 6000, 10_000, 15_000])
    },
  })
}

export function useAgentStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stopAgent(id),
    onSuccess: (_data, agentId) => {
      scheduleAgentCardRefreshes(qc, agentId, [0, 1000, 3000])
    },
  })
}

export function useAgentVaultAccessIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => issueAgentVaultAccessToken(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentVaultAccessRevoke() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeAgentVaultAccess(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentUpstreamAuthUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      agentId,
      provider,
      mode,
      secret,
    }: {
      agentId: string
      provider: "anthropic" | "openai"
      mode: "api_key" | "token" | "oauth"
      secret: string
    }) => updateAgentUpstreamAuth(agentId, { provider, mode, secret }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentOpenAIOAuthAuthorize() {
  return useMutation({
    mutationFn: ({ agentId, desktopApp }: { agentId: string; desktopApp?: boolean }) =>
      authorizeAgentOpenAIOAuth(agentId, { desktopApp }),
  })
}

export function useAgentUpstreamAuthClear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      agentId,
      provider,
    }: {
      agentId: string
      provider: "anthropic" | "openai"
    }) => clearAgentUpstreamAuth(agentId, provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "status"] })
    },
  })
}

export function useAgentChannels(agentId: string) {
  return useQuery({
    queryKey: ["agents", agentId, "channels"],
    queryFn: () => getAgentChannels(agentId),
    staleTime: 30_000,
    enabled: !!agentId,
    retry: false,
  })
}

export function useAgentLogs(agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["agents", agentId, "logs"],
    queryFn: () => getAgentLogs(agentId),
    staleTime: 5_000,
    enabled: !!agentId && enabled,
    retry: false,
  })
}

export function useWhatsAppLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => startWhatsAppLogin(agentId),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
    },
  })
}

export function useWhatsAppLoginPoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => pollWhatsAppLogin(agentId),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
    },
  })
}

export function useTelegramConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ agentId, botToken }: { agentId: string; botToken: string }) =>
      updateTelegramConfig(agentId, { botToken }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
    },
  })
}

export function useAgentChannelPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      agentId,
      channel,
      dmPolicy,
      allowFrom,
    }: {
      agentId: string
      channel: string
      dmPolicy: "open" | "pairing" | "allowlist" | "disabled"
      allowFrom: string[]
    }) => updateAgentChannelPolicy(agentId, channel, { dmPolicy, allowFrom }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
    },
  })
}

export function useChannelDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ agentId, channel }: { agentId: string; channel: string }) =>
      disconnectAgentChannel(agentId, channel),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agents", agentId, "channels"] })
    },
  })
}

export function useChannelReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ agentId, channel }: { agentId: string; channel: string }) =>
      resetAgentChannel(agentId, channel),
    onSuccess: (_data, { agentId }) => {
      scheduleAgentCardRefreshes(qc, agentId, [0, 1000, 3000, 6000])
    },
  })
}

export function useChannelPairingApprove() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      agentId,
      channel,
      code,
      owner,
    }: {
      agentId: string
      channel: string
      code: string
      owner?: boolean
    }) => approveAgentChannelPairing(agentId, channel, code, owner),
    onSuccess: (_data, { agentId }) => {
      scheduleAgentCardRefreshes(qc, agentId, [0, 1000, 3000, 6000])
    },
  })
}
