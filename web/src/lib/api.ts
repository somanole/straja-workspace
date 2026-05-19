import type {
  VaultStatus,
  VaultHealthStats,
  HealthResponse,
  VaultEncryptionStatus,
  WorkspaceConfig,
  FileContent,
  GroupedFileInfo,
  FileIndexEntry,
  SearchRequest,
  SearchResponse,
  AnswerRequest,
  AnswerResponse,
  ModelsStatus,
  ExecRequest,
  ExecResult,
  BackgroundExecResult,
  ExecSession,
  PollResponse,
  GmailStatus,
  GmailSyncResult,
  DriveStatus,
  DriveSyncResult,
  DriveBrowseResult,
  CalendarStatus,
  CalendarSyncResult,
  CalendarListEntry,
  ContactsStatus,
  ContactsSyncResult,
  GitHubStatus,
  GitHubSyncResult,
  GitHubRepo,
  BrowserStatus,
  BrowserConfig,
  BrowserPolicy,
  BrowserAuditResponse,
  WebSearchAuditResponse,
  AgentsStatus,
  OllamaModelsStatus,
  OllamaRuntimeStatus,
  AgentVaultAccess,
  UnifiedAuditResponse,
  WebFetchPolicy,
  WebSearchPolicy,
  OpenclawOrchestrationSettings,
  UsageOverviewResponse,
  UsagePricingCost,
  UsagePricingResponse,
} from "./types"
import type {
  EvalAssertion,
  EvalCase,
  EvalCaseDraftFromTrace,
  EvalCaseResult,
  EvalMode,
  EvalRun,
  EvalSuite,
  EvalSuiteDetail,
  EvalSuiteListItem,
  EvalTargetType,
} from "./eval-types"
import {
  dispatchVaultHttpUnauthorized,
  getStoredHttpAdminToken,
} from "./http-auth"

const BASE = import.meta.env.DEV ? "/api" : ""

export class VaultUnavailableError extends Error {
  constructor() {
    super("Vault daemon is not reachable")
    this.name = "VaultUnavailableError"
  }
}

export class VaultUnauthorizedError extends Error {
  constructor(message = "Vault admin token is required") {
    super(message)
    this.name = "VaultUnauthorizedError"
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const { timeout = 120_000, ...fetchOptions } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeout}ms for ${path}`)), timeout)

  try {
    const headers = new Headers(fetchOptions.headers)
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
    const token = getStoredHttpAdminToken()
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`)
    }

    const res = await fetch(`${BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const message = (body as { error?: string }).error ?? `HTTP ${res.status}`
      if (res.status === 401) {
        dispatchVaultHttpUnauthorized()
        throw new VaultUnauthorizedError(message)
      }
      throw new Error(message)
    }

    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().includes("application/json")) {
      const text = await res.text().catch(() => "")
      const looksLikeHtml = /^\s*<!doctype html>/i.test(text) || /^\s*<html[\s>]/i.test(text)
      if (looksLikeHtml) {
        throw new Error(
          `Expected JSON from ${path} but received HTML. The Vault backend may need a restart to load this API route.`
        )
      }
      throw new Error(`Expected JSON from ${path} but received ${contentType || "unknown content type"}`)
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const reason =
        controller.signal.reason instanceof Error
          ? controller.signal.reason.message
          : typeof controller.signal.reason === "string"
            ? controller.signal.reason
            : `Request timeout after ${timeout}ms for ${path}`
      throw new Error(reason)
    }
    if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
      throw new VaultUnavailableError()
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// === Health & Status ===

export async function getHealth(): Promise<HealthResponse> {
  return request("/health")
}

export async function getEncryptionStatus(): Promise<VaultEncryptionStatus> {
  return request("/security/encryption/status")
}

export async function initializeEncryption(pin: string): Promise<VaultEncryptionStatus> {
  return request("/security/encryption/init", {
    method: "POST",
    body: JSON.stringify({ pin }),
  })
}

export async function unlockEncryption(pin: string): Promise<VaultEncryptionStatus> {
  return request("/security/encryption/unlock", {
    method: "POST",
    body: JSON.stringify({ pin }),
  })
}

export async function lockEncryption(): Promise<VaultEncryptionStatus> {
  return request("/security/encryption/lock", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function getStatus(): Promise<VaultStatus> {
  return request("/status")
}

export async function getWorkspaceConfig(): Promise<WorkspaceConfig> {
  return request("/config/workspace")
}

export async function updateWorkspaceConfig(
  config: Partial<WorkspaceConfig>
): Promise<WorkspaceConfig> {
  return request("/config/workspace", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

// === Filesystem Browse ===

export interface BrowseItem {
  name: string
  path: string
  type: "file" | "directory"
}

export interface BrowseResponse {
  path: string
  parent: string | null
  items: BrowseItem[]
}

export async function browse(
  path?: string,
  type?: "file" | "dir" | "all"
): Promise<BrowseResponse> {
  const params = new URLSearchParams()
  if (path) params.set("path", path)
  if (type) params.set("type", type)
  return request(`/browse?${params}`)
}

// === Collections ===

export async function listFiles(collection: string, prefix?: string): Promise<GroupedFileInfo[]> {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""
  return request(`/collections/${encodeURIComponent(collection)}/files${qs}`)
}

export async function listFileIndexEntries(
  collection: string,
  path: string
): Promise<FileIndexEntry[]> {
  const encodedPath = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
  return request(
    `/collections/${encodeURIComponent(collection)}/files/${encodedPath}?view=index`
  )
}

export async function getFile(
  collection: string,
  path: string
): Promise<FileContent> {
  // Encode each segment but also encode '#' which appears in PDF page paths
  const encodedPath = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
  return request(
    `/collections/${encodeURIComponent(collection)}/files/${encodedPath}`
  )
}

export async function createCollection(
  path: string,
  name: string,
  pattern?: string
): Promise<{ name: string; documents: number; embedded: boolean }> {
  return request("/collections", {
    method: "POST",
    body: JSON.stringify({ path, name, pattern }),
    timeout: 600_000,
  })
}

export async function createEmptyCollection(
  name: string
): Promise<{ name: string; documents: number }> {
  return request("/collections/empty", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export async function createFolder(
  collection: string,
  path: string
): Promise<{ ok: boolean; path: string; created: boolean }> {
  return request(`/collections/${encodeURIComponent(collection)}/folders`, {
    method: "POST",
    body: JSON.stringify({ path }),
  })
}

export async function updateCollection(
  name: string
): Promise<{ name: string; documents: number; embedded: boolean }> {
  return request(`/collections/${encodeURIComponent(name)}/update`, {
    method: "POST",
    body: JSON.stringify({}),
    timeout: 600_000,
  })
}

export async function addFiles(
  collection: string,
  paths: string[]
): Promise<{ name: string; added: number; documents: number; embedded: boolean }> {
  return request(`/collections/${encodeURIComponent(collection)}/files`, {
    method: "POST",
    body: JSON.stringify({ paths }),
    timeout: 300_000,
  })
}

export async function deleteFiles(
  collection: string,
  paths: string[]
): Promise<{ deleted: number }> {
  return request(`/collections/${encodeURIComponent(collection)}/files`, {
    method: "DELETE",
    body: JSON.stringify({ paths }),
    timeout: 300_000, // 5 min — bulk deletes with vector cleanup can be slow
  })
}

export async function deleteFolder(
  collection: string,
  prefix: string
): Promise<{ deleted: number; deactivated: number }> {
  return request(`/collections/${encodeURIComponent(collection)}/folders`, {
    method: "DELETE",
    body: JSON.stringify({ prefix }),
    timeout: 300_000,
  })
}

export async function deleteCollection(
  name: string
): Promise<{ deletedDocs: number }> {
  return request(`/collections/${encodeURIComponent(name)}`, {
    method: "DELETE",
  })
}

// === Search ===

export async function search(req: SearchRequest): Promise<SearchResponse> {
  return request("/query", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function answer(req: AnswerRequest): Promise<AnswerResponse> {
  return request("/answer", {
    method: "POST",
    body: JSON.stringify(req),
    timeout: 300_000,
  })
}

// === Models ===

export async function getModelsStatus(): Promise<ModelsStatus> {
  return request("/models/status")
}

export async function startOllamaRuntime(): Promise<{ ok: boolean }> {
  return request("/connections/agents/ollama/runtime/start", {
    method: "POST",
    body: JSON.stringify({}),
    timeout: 60_000,
  })
}

export async function stopOllamaRuntime(): Promise<{ ok: boolean }> {
  return request("/connections/agents/ollama/runtime/stop", {
    method: "POST",
    body: JSON.stringify({}),
    timeout: 60_000,
  })
}

export async function restartOllamaRuntime(): Promise<{ ok: boolean }> {
  return request("/connections/agents/ollama/runtime/restart", {
    method: "POST",
    body: JSON.stringify({}),
    timeout: 60_000,
  })
}

export async function pullModels(
  refresh = false
): Promise<{ ok: boolean; output: string }> {
  return request("/pull", {
    method: "POST",
    body: JSON.stringify({ refresh }),
    timeout: 600_000,
  })
}

export async function embed(
  force = false
): Promise<{ ok: boolean; started: boolean }> {
  return request("/embed", {
    method: "POST",
    body: JSON.stringify({ force }),
  })
}

export async function sync(): Promise<{ ok: boolean; documents: number }> {
  return request("/sync", {
    method: "POST",
    timeout: 120_000,
  })
}

// === Execution ===

export async function execCommand(
  req: ExecRequest
): Promise<ExecResult | BackgroundExecResult> {
  return request("/exec", {
    method: "POST",
    body: JSON.stringify(req),
    timeout: 600_000,
  })
}

export async function listSessions(): Promise<{ sessions: ExecSession[] }> {
  return request("/exec/sessions")
}

export async function pollSession(
  id: string,
  timeout = 0
): Promise<PollResponse> {
  return request(`/exec/sessions/${id}/poll?timeout=${timeout}`)
}

export async function getSessionLog(
  id: string,
  offset = 0,
  limit = 200
): Promise<{
  log: string
  totalLines: number
  totalChars: number
  truncated: boolean
  exited: boolean
  exitCode: number | null
}> {
  return request(`/exec/sessions/${id}/log?offset=${offset}&limit=${limit}`)
}

export async function writeToSession(
  id: string,
  data?: string,
  eof?: boolean
): Promise<{ ok: boolean; bytes: number }> {
  return request(`/exec/sessions/${id}/write`, {
    method: "POST",
    body: JSON.stringify({ data, eof }),
  })
}

export async function killSession(
  id: string
): Promise<{
  ok: boolean
  exited: boolean
  exitCode: number | null
  filesChanged: Array<{ path: string; action: string }>
}> {
  return request(`/exec/sessions/${id}/kill`, { method: "POST" })
}

export async function deleteSession(id: string): Promise<{ ok: boolean }> {
  return request(`/exec/sessions/${id}`, { method: "DELETE" })
}

// === Gmail / Connections ===

export async function getGmailStatus(): Promise<GmailStatus> {
  return request("/connections/gmail/status")
}

export async function authorizeGmail(): Promise<{ authUrl: string }> {
  return request("/connections/gmail/authorize", { method: "POST" })
}

export async function syncGmail(): Promise<GmailSyncResult> {
  return request("/connections/gmail/sync", {
    method: "POST",
    timeout: 300_000,
  })
}

export async function updateGmailConfig(config: {
  labels?: string[]
  includeThreads?: boolean
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  syncMode?: "labels" | "all"
  syncDaysBack?: number
}): Promise<{ ok: boolean }> {
  return request("/connections/gmail/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function disconnectGmail(): Promise<{ ok: boolean }> {
  return request("/connections/gmail/disconnect", { method: "POST" })
}

// === Gmail Drafts ===

export interface CreateDraftRequest {
  to: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
  threadId?: string
}

export interface CreateDraftResult {
  id: string
  message: { id: string; threadId: string }
}

export async function createGmailDraft(draft: CreateDraftRequest): Promise<CreateDraftResult> {
  return request("/connections/gmail/drafts", {
    method: "POST",
    body: JSON.stringify(draft),
  })
}

// === Google Drive / Connections ===

export async function getDriveStatus(): Promise<DriveStatus> {
  return request("/connections/gdrive/status")
}

export async function authorizeDrive(): Promise<{ authUrl: string }> {
  return request("/connections/gdrive/authorize", { method: "POST" })
}

export async function syncDrive(): Promise<DriveSyncResult> {
  return request("/connections/gdrive/sync", {
    method: "POST",
    timeout: 600_000,
  })
}

export async function updateDriveConfig(config: {
  folders?: { id: string; name: string }[]
  includeSubfolders?: boolean
  pollEnabled?: boolean
  pollIntervalMinutes?: number
}): Promise<{ ok: boolean }> {
  return request("/connections/gdrive/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function disconnectDrive(): Promise<{ ok: boolean }> {
  return request("/connections/gdrive/disconnect", { method: "POST" })
}

export async function browseDrive(folderId?: string): Promise<DriveBrowseResult> {
  const params = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""
  return request(`/connections/gdrive/browse${params}`)
}

export async function importDriveFiles(fileIds: string[], collection?: string): Promise<DriveSyncResult> {
  return request("/connections/gdrive/import", {
    method: "POST",
    body: JSON.stringify({ fileIds, collection }),
    timeout: 600_000,
  })
}

// === Google Calendar / Connections ===

export async function getCalendarStatus(): Promise<CalendarStatus> {
  return request("/connections/gcalendar/status")
}

export async function authorizeCalendar(): Promise<{ authUrl: string }> {
  return request("/connections/gcalendar/authorize", { method: "POST" })
}

export async function syncCalendar(): Promise<CalendarSyncResult> {
  return request("/connections/gcalendar/sync", {
    method: "POST",
    timeout: 300_000,
  })
}

export async function updateCalendarConfig(config: {
  calendars?: { id: string; name: string }[]
  syncWindowPastDays?: number
  syncWindowFutureDays?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
}): Promise<{ ok: boolean }> {
  return request("/connections/gcalendar/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function disconnectCalendar(): Promise<{ ok: boolean }> {
  return request("/connections/gcalendar/disconnect", { method: "POST" })
}

export async function listCalendars(): Promise<{ calendars: CalendarListEntry[] }> {
  return request("/connections/gcalendar/calendars")
}

// === Google Contacts / Connections ===

export async function getContactsStatus(): Promise<ContactsStatus> {
  return request("/connections/gcontacts/status")
}

export async function authorizeContacts(): Promise<{ authUrl: string }> {
  return request("/connections/gcontacts/authorize", { method: "POST" })
}

export async function syncContacts(): Promise<ContactsSyncResult> {
  return request("/connections/gcontacts/sync", {
    method: "POST",
    timeout: 300_000,
  })
}

export async function updateContactsConfig(config: {
  pollEnabled?: boolean
  pollIntervalMinutes?: number
}): Promise<{ ok: boolean }> {
  return request("/connections/gcontacts/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function disconnectContacts(): Promise<{ ok: boolean }> {
  return request("/connections/gcontacts/disconnect", { method: "POST" })
}

// === GitHub / Connections ===

export async function getGitHubStatus(): Promise<GitHubStatus> {
  return request("/connections/github/status")
}

export async function authorizeGitHub(): Promise<{ authUrl: string }> {
  return request("/connections/github/authorize", { method: "POST" })
}

export async function getGitHubRepos(): Promise<GitHubRepo[]> {
  return request("/connections/github/repos")
}

export async function syncGitHub(): Promise<GitHubSyncResult> {
  return request("/connections/github/sync", {
    method: "POST",
    timeout: 600_000,
  })
}

export async function updateGitHubConfig(config: {
  selectedRepos?: { owner: string; name: string; fullName: string }[]
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  syncIssues?: boolean
  syncPRs?: boolean
}): Promise<{ ok: boolean }> {
  return request("/connections/github/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function disconnectGitHub(): Promise<{ ok: boolean }> {
  return request("/connections/github/disconnect", { method: "POST" })
}

// === Browser / Connections ===

export async function getBrowserStatus(): Promise<BrowserStatus> {
  return request("/connections/browser/status")
}

export async function getBrowserPolicy(): Promise<BrowserPolicy> {
  return request("/connections/browser/policy")
}

export async function updateBrowserConfig(config: Partial<BrowserConfig>): Promise<{ ok: boolean }> {
  return request("/connections/browser/config", {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function updateBrowserPolicy(
  patch: Partial<BrowserPolicy>
): Promise<{ ok: boolean; policy: BrowserPolicy }> {
  return request("/connections/browser/policy", {
    method: "POST",
    body: JSON.stringify(patch),
  })
}

export async function resetBrowserPolicy(): Promise<{ ok: boolean; policy: BrowserPolicy }> {
  return request("/connections/browser/policy/reset", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function getBrowserAudit(date?: string): Promise<BrowserAuditResponse> {
  const params = new URLSearchParams()
  if (date) params.set("date", date)
  return request(`/connections/browser/audit${params.size ? `?${params}` : ""}`)
}

export async function getWebSearchAudit(date?: string): Promise<WebSearchAuditResponse> {
  const params = new URLSearchParams()
  if (date) params.set("date", date)
  return request(`/connections/web-search/audit${params.size ? `?${params}` : ""}`)
}

export async function startBrowser(): Promise<{ ok: boolean }> {
  return request("/connections/browser/start", {
    method: "POST",
    timeout: 30_000,
  })
}

export async function stopBrowser(): Promise<{ ok: boolean }> {
  return request("/connections/browser/stop", { method: "POST" })
}

// === Web Fetch Policy ===

export async function getWebFetchPolicy(): Promise<WebFetchPolicy> {
  return request("/connections/web-fetch/policy")
}

export async function updateWebFetchPolicy(
  patch: Partial<WebFetchPolicy>
): Promise<{ ok: boolean; policy: WebFetchPolicy }> {
  return request("/connections/web-fetch/policy", {
    method: "POST",
    body: JSON.stringify(patch),
  })
}

export async function resetWebFetchPolicy(): Promise<{ ok: boolean; policy: WebFetchPolicy }> {
  return request("/connections/web-fetch/policy/reset", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

// === Web Search Policy ===

export async function getWebSearchPolicy(): Promise<WebSearchPolicy> {
  return request("/connections/web-search/policy")
}

export async function updateWebSearchPolicy(
  patch: Partial<WebSearchPolicy>
): Promise<{ ok: boolean; policy: WebSearchPolicy }> {
  return request("/connections/web-search/policy", {
    method: "POST",
    body: JSON.stringify(patch),
  })
}

// === Unified Audit ===

export async function getUnifiedAudit(date?: string, category?: string): Promise<UnifiedAuditResponse> {
  const params = new URLSearchParams()
  if (date) params.set("date", date)
  if (category) params.set("category", category)
  return request(`/audit${params.size ? `?${params}` : ""}`)
}

export async function getWorkspaceLogs(): Promise<import("./types").WorkspaceLogsResponse> {
  return request("/logs/workspace", {
    timeout: 10_000,
  })
}

// === Agents / Connections ===

export async function getAgentsStatus(): Promise<AgentsStatus> {
  return request("/connections/agents/status")
}

export async function getAgentProfiles(): Promise<import("./types").AgentProfilesResponse> {
  return request("/connections/agents/profiles")
}

export async function detectOpenclawAgent(): Promise<import("./types").OpenclawDetection> {
  return request("/connections/agents/detect-openclaw")
}

export async function createStarterTeam(): Promise<{
  ok: boolean
  createdIds: string[]
  alreadyCreated?: boolean
}> {
  return request("/connections/agents/starter-team", {
    method: "POST",
  })
}

export async function getOpenclawOrchestrationSettings(): Promise<OpenclawOrchestrationSettings> {
  return request("/connections/openclaw/orchestration")
}

export async function updateOpenclawOrchestrationSettings(
  updates: { enabled?: boolean }
): Promise<OpenclawOrchestrationSettings> {
  return request("/connections/openclaw/orchestration", {
    method: "POST",
    body: JSON.stringify(updates),
  })
}

export async function getUsageOverview(params?: {
  days?: number
  startDate?: string
  endDate?: string
}): Promise<UsageOverviewResponse> {
  const qs = new URLSearchParams()
  if (typeof params?.days === "number" && Number.isFinite(params.days)) {
    qs.set("days", String(Math.max(1, Math.floor(params.days))))
  }
  if (params?.startDate) qs.set("startDate", params.startDate)
  if (params?.endDate) qs.set("endDate", params.endDate)
  return request(`/usage/overview${qs.size ? `?${qs.toString()}` : ""}`, {
    timeout: 120_000,
  })
}

export async function getUsagePricing(): Promise<UsagePricingResponse> {
  return request("/usage/pricing", {
    timeout: 30_000,
  })
}

export async function updateUsagePricing(params: {
  provider: string
  model: string
  cost: UsagePricingCost
}): Promise<UsagePricingResponse> {
  return request("/usage/pricing", {
    method: "POST",
    body: JSON.stringify(params),
    timeout: 30_000,
  })
}

export async function getOllamaModelsStatus(): Promise<OllamaModelsStatus> {
  return request("/connections/agents/ollama/models", {
    timeout: 10_000,
  })
}

export async function getOllamaRuntimeStatus(): Promise<OllamaRuntimeStatus> {
  return request("/connections/agents/ollama/runtime", {
    timeout: 10_000,
  })
}

export async function installOllamaRuntime(): Promise<{ ok: boolean }> {
  return request("/connections/agents/ollama/runtime/install", {
    method: "POST",
    timeout: 1_800_000,
  })
}

export async function removeOllamaRuntime(): Promise<{ ok: boolean }> {
  return request("/connections/agents/ollama/runtime/remove", {
    method: "POST",
    timeout: 120_000,
  })
}

export async function pullOllamaModel(model: string): Promise<{ ok: boolean; model: string }> {
  return request("/connections/agents/ollama/pull", {
    method: "POST",
    body: JSON.stringify({ model }),
    timeout: 1_800_000,
  })
}

export async function deleteOllamaModel(model: string): Promise<{ ok: boolean; model: string }> {
  return request("/connections/agents/ollama/delete", {
    method: "POST",
    body: JSON.stringify({ model }),
    timeout: 120_000,
  })
}

export async function updateAgentConfig(agent: {
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
  modelPolicy?: import("./types").AgentModelRoutingPolicy
  memoryPromptInjectionMode?: import("./types").AgentMemoryPromptInjectionMode
  routingProfile?: import("./types").AgentRoutingProfile
}): Promise<{ ok: boolean; autoPaired?: boolean; vaultTokenPreview?: string }> {
  return request("/connections/agents/config", {
    method: "POST",
    body: JSON.stringify(agent),
  })
}

export async function removeAgent(id: string): Promise<{ ok: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function testAgentConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  return request(`/connections/agents/${encodeURIComponent(id)}/test`, {
    method: "POST",
    timeout: 10_000,
  })
}

export async function restartAgent(id: string): Promise<{ ok: boolean; restarting?: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(id)}/restart`, {
    method: "POST",
    timeout: 15_000,
  })
}

export async function startAgent(id: string): Promise<{
  ok: boolean
  started?: boolean
  alreadyRunning?: boolean
  pending?: boolean
}> {
  return request(`/connections/agents/${encodeURIComponent(id)}/start`, {
    method: "POST",
    timeout: 30_000,
  })
}

export async function stopAgent(id: string): Promise<{
  ok: boolean
  stopped?: boolean
  alreadyStopped?: boolean
}> {
  return request(`/connections/agents/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    timeout: 15_000,
  })
}

export async function issueAgentVaultAccessToken(id: string): Promise<{
  ok: boolean
  token: string
  configUpdated?: boolean
  vaultAccess: AgentVaultAccess
}> {
  return request(`/connections/agents/${encodeURIComponent(id)}/vault-access/token`, {
    method: "POST",
  })
}

export async function revokeAgentVaultAccess(id: string): Promise<{ ok: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(id)}/vault-access`, {
    method: "DELETE",
  })
}

export async function updateAgentUpstreamAuth(
  agentId: string,
  payload: {
    provider: "anthropic" | "openai"
    mode: "api_key" | "token" | "oauth"
    secret: string
  }
): Promise<{ ok: boolean; configUpdated?: boolean; upstreamAuth: import("./types").AgentUpstreamAuthSummary }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/upstream-auth`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function clearAgentUpstreamAuth(
  agentId: string,
  provider: "anthropic" | "openai"
): Promise<{ ok: boolean; upstreamAuth: import("./types").AgentUpstreamAuthSummary }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/upstream-auth/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  })
}

export async function authorizeAgentOpenAIOAuth(
  agentId: string,
  options?: { desktopApp?: boolean }
): Promise<{ authUrl: string }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/upstream-auth/openai/authorize`, {
    method: "POST",
    body: JSON.stringify({
      desktopApp: options?.desktopApp === true,
    }),
  })
}

// === Agent Channels ===

export async function getAgentChannels(agentId: string): Promise<import("./types").AgentChannelsStatus> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels`)
}

export async function startWhatsAppLogin(agentId: string): Promise<import("./types").WhatsAppLoginResult> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/whatsapp/login`, {
    method: "POST",
    timeout: 30_000,
  })
}

export async function pollWhatsAppLogin(agentId: string): Promise<import("./types").WhatsAppPollResult> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/whatsapp/login/poll`, {
    method: "POST",
    timeout: 15_000,
  })
}

export async function updateTelegramConfig(
  agentId: string,
  config: { botToken: string }
): Promise<{ ok: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/telegram/config`, {
    method: "POST",
    body: JSON.stringify(config),
  })
}

export async function updateAgentChannelPolicy(
  agentId: string,
  channel: string,
  policy: {
    dmPolicy: "open" | "pairing" | "allowlist" | "disabled"
    allowFrom: string[]
  }
): Promise<{ ok: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channel)}/policy`, {
    method: "POST",
    body: JSON.stringify(policy),
  })
}

export async function approveAgentChannelPairing(
  agentId: string,
  channel: string,
  code: string,
  owner?: boolean
): Promise<{ ok: boolean; channel: string; approvedId?: string | null }> {
  return request(
    `/connections/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channel)}/pairing/approve`,
    {
      method: "POST",
      body: JSON.stringify({ code, owner: owner === true }),
      timeout: 20_000,
    }
  )
}

export async function disconnectAgentChannel(
  agentId: string,
  channel: string
): Promise<{ ok: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channel)}/disconnect`, {
    method: "POST",
  })
}

export async function resetAgentChannel(
  agentId: string,
  channel: string
): Promise<{ ok: boolean; cleared?: boolean; restarted?: boolean }> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channel)}/reset`, {
    method: "POST",
    timeout: 20_000,
  })
}

export async function getAgentLogs(
  agentId: string
): Promise<import("./types").AgentLogsResponse> {
  return request(`/connections/agents/${encodeURIComponent(agentId)}/logs`, {
    method: "GET",
    timeout: 10_000,
  })
}

// === Notes ===

export async function createNote(
  title: string,
  content: string,
  collection?: string,
  prefix?: string
): Promise<{ path: string; title: string; hash: string; size: number; collection?: string }> {
  return request("/notes", {
    method: "POST",
    body: JSON.stringify({
      title,
      content,
      ...(collection ? { collection } : {}),
      ...(prefix ? { prefix } : {}),
    }),
  })
}

export async function updateNote(
  collection: string,
  path: string,
  title: string,
  content: string
): Promise<{ path: string; title: string; hash: string; size: number; collection?: string }> {
  const encodedPath = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
  return request(`/notes/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({ collection, title, content }),
  })
}

// === Artifacts ===

export async function listArtifacts(
  prefix?: string
): Promise<import("./types").ArtifactListResponse> {
  const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""
  return request(`/artifacts${params}`)
}

export async function buildPresentation(
  name: string
): Promise<import("./types").ArtifactBuildResult> {
  return request("/artifacts/build", {
    method: "POST",
    body: JSON.stringify({ name }),
    timeout: 120_000,
  })
}

export async function issueArtifactDownloadUrl(
  collection: string,
  path: string
): Promise<import("./types").ArtifactDownloadUrlResponse> {
  return request("/artifacts/url", {
    method: "POST",
    body: JSON.stringify({ collection, path }),
  })
}

// === Vault Health ===

export async function getHealthStats(): Promise<VaultHealthStats> {
  return request("/health/stats")
}

export async function cleanupVectors(): Promise<{ removed: number }> {
  return request("/maintenance/cleanup-vectors", { method: "POST" })
}

export async function cleanupContent(): Promise<{ removed: number }> {
  return request("/maintenance/cleanup-content", { method: "POST" })
}

export async function purgeInactive(): Promise<{ removed: number }> {
  return request("/maintenance/purge-inactive", { method: "POST" })
}

export async function clearLLMCache(): Promise<{ removed: number }> {
  return request("/maintenance/clear-llm-cache", { method: "POST" })
}

export async function vacuumDB(): Promise<{ ok: boolean }> {
  return request("/maintenance/vacuum", { method: "POST", timeout: 300_000 })
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

import type { TaskListItem, TaskMeta, TaskDetailResponse, CreateTaskRequest, ActivityEntry, TaskOutput } from "./task-types"
import type { ScheduleConfig } from "./schedule-types"
import type { FlowDefinition, FlowRunRecord, FlowTestRequest, FlowTestResult } from "./flow-types"

export async function listTasks(): Promise<{ tasks: TaskListItem[] }> {
  return request("/tasks")
}

export async function createTask(req: CreateTaskRequest): Promise<{ task: TaskMeta }> {
  return request("/tasks", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function getTaskDetail(id: string, offset?: number, limit?: number): Promise<TaskDetailResponse> {
  const params = new URLSearchParams()
  if (offset !== undefined) params.set("offset", String(offset))
  if (limit !== undefined) params.set("limit", String(limit))
  const qs = params.toString()
  return request(`/tasks/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`)
}

export async function updateTask(id: string, patch: Partial<Pick<TaskMeta, "title" | "status" | "error">> & { schedule?: ScheduleConfig }): Promise<{ task: TaskMeta }> {
  return request(`/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function stopTask(id: string): Promise<{ task: TaskMeta }> {
  return request(`/tasks/${encodeURIComponent(id)}/stop`, { method: "POST" })
}

export async function sendTaskMessage(id: string, message: string): Promise<{ ok: boolean }> {
  return request(`/tasks/${encodeURIComponent(id)}/send`, {
    method: "POST",
    body: JSON.stringify({ message }),
  })
}

export async function getTaskActivity(id: string, offset?: number, limit?: number): Promise<{ entries: ActivityEntry[]; total: number }> {
  const params = new URLSearchParams()
  if (offset !== undefined) params.set("offset", String(offset))
  if (limit !== undefined) params.set("limit", String(limit))
  const qs = params.toString()
  return request(`/tasks/${encodeURIComponent(id)}/activity${qs ? `?${qs}` : ""}`)
}

export async function getTaskOutputs(id: string): Promise<{ outputs: TaskOutput[] }> {
  return request(`/tasks/${encodeURIComponent(id)}/outputs`)
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export async function listFlows(): Promise<{ flows: FlowDefinition[] }> {
  return request("/flows")
}

export async function saveFlow(id: string, flow: Omit<FlowDefinition, "id"> & { id?: string }): Promise<{ flow: FlowDefinition }> {
  return request(`/flows/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(flow),
  })
}

export async function deleteFlow(id: string): Promise<{ ok: boolean; id: string }> {
  return request(`/flows/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function getFlowRuns(id: string, limit = 25): Promise<{ runs: FlowRunRecord[] }> {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  return request(`/flows/${encodeURIComponent(id)}/runs?${params}`)
}

export async function testFlow(req: FlowTestRequest): Promise<FlowTestResult> {
  return request("/flows/test", {
    method: "POST",
    body: JSON.stringify(req),
    timeout: req.mode === "match_only" ? 15_000 : 600_000,
  })
}

// === Evals ===

export async function listEvalSuites(): Promise<{ suites: EvalSuiteListItem[] }> {
  return request("/evals/suites")
}

export async function getEvalSuite(id: string): Promise<{ suite: EvalSuiteDetail }> {
  return request(`/evals/suites/${encodeURIComponent(id)}`)
}

export async function createEvalSuite(req: {
  name: string
  description?: string
}): Promise<{ suite: EvalSuite }> {
  return request("/evals/suites", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function duplicateEvalSuite(id: string): Promise<{ suite: EvalSuiteDetail }> {
  return request(`/evals/suites/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function runEvalSuite(req: {
  suiteId: string
  createdBy?: string
  confirmProduction?: boolean
}): Promise<{ suite: EvalSuite; run: EvalRun; results: EvalCaseResult[] }> {
  return request(`/evals/suites/${encodeURIComponent(req.suiteId)}/run`, {
    method: "POST",
    body: JSON.stringify({
      createdBy: req.createdBy,
      confirmProduction: req.confirmProduction,
    }),
    timeout: 1_800_000,
  })
}

export async function getEvalRun(id: string): Promise<{ run: EvalRun; suite: EvalSuiteDetail | null }> {
  return request(`/evals/runs/${encodeURIComponent(id)}`)
}

export async function getEvalRunResults(id: string): Promise<{
  run: EvalRun
  suite: EvalSuiteDetail | null
  results: EvalCaseResult[]
  cases: EvalCase[]
}> {
  return request(`/evals/runs/${encodeURIComponent(id)}/results`)
}

export async function createEvalCase(req: {
  suite_id: string
  name: string
  description?: string
  target_type: EvalTargetType
  target_id: string
  mode?: EvalMode
  input_text: string
  assertions?: EvalAssertion[]
  enabled?: boolean
}): Promise<{ case: EvalCase }> {
  return request("/evals/cases", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function updateEvalCase(
  id: string,
  req: Partial<{
    name: string
    description: string
    target_type: EvalTargetType
    target_id: string
    mode: EvalMode
    input_text: string
    assertions: EvalAssertion[]
    enabled: boolean
  }>
): Promise<{ case: EvalCase }> {
  return request(`/evals/cases/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(req),
  })
}

export async function deleteEvalCase(id: string): Promise<{ ok: boolean; id: string }> {
  return request(`/evals/cases/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function buildEvalCaseFromTrace(req: {
  trace_id: string
  suite_id?: string
  name?: string
  description?: string
  target_type?: EvalTargetType
  target_id?: string
  mode?: EvalMode
  input_text?: string
  assertion_keys?: string[]
}): Promise<{ draft?: EvalCaseDraftFromTrace; suites?: EvalSuiteListItem[]; case?: EvalCase }> {
  return request("/evals/cases/from-trace", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

// === Guard ===

export async function getGuardStatus(): Promise<import("./types").GuardStatus> {
  return request("/connections/guard/status")
}

export async function getGuardConfig(): Promise<import("./types").GuardConfig | Record<string, never>> {
  return request("/connections/guard/config")
}

export async function updateGuardConfig(updates: Partial<import("./types").GuardConfig>): Promise<{ ok: boolean; config: import("./types").GuardConfig }> {
  return request("/connections/guard/config", {
    method: "POST",
    body: JSON.stringify(updates),
  })
}

export async function startGuard(configOverride?: Partial<import("./types").GuardConfig>): Promise<{ ok: boolean; error?: string }> {
  return request("/connections/guard/start", {
    method: "POST",
    body: configOverride ? JSON.stringify(configOverride) : undefined,
    timeout: 15_000,
  })
}

export async function stopGuard(): Promise<{ ok: boolean; alreadyStopped?: boolean; error?: string }> {
  return request("/connections/guard/stop", {
    method: "POST",
    timeout: 15_000,
  })
}

export async function restartGuard(): Promise<{ ok: boolean; error?: string }> {
  return request("/connections/guard/restart", {
    method: "POST",
    timeout: 15_000,
  })
}

export async function getGuardEvents(date?: string): Promise<import("./types").GuardEventsResponse> {
  const params = new URLSearchParams()
  if (date) params.set("date", date)
  return request(`/connections/guard/events${params.size ? `?${params}` : ""}`)
}

export async function getGuardLogs(): Promise<import("./types").GuardLogsResponse> {
  return request("/connections/guard/logs", {
    timeout: 10_000,
  })
}
