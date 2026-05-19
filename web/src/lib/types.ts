// === API Response Types ===

export interface VaultStatus {
  totalDocuments: number
  totalFileCount: number
  needsEmbedding: number
  hasVectorIndex: boolean
  embedding: boolean
  modelPulling?: boolean
  collections: CollectionInfo[]
  writeQueue?: { docs: number; entries: number }
}

export interface CollectionInfo {
  name: string
  path: string
  pattern: string
  documents: number
  fileCount: number
  lastUpdated: string
  type: "user" | "system"
  linked: boolean
  deletable: boolean
}

export interface GroupedFileInfo {
  path: string
  displayPath: string
  title: string
  size: number
  modifiedAt: string
  docid: string
  indexEntries: number
  mimeType?: string
  isTextOnly: boolean
  type?: "file" | "folder"
  childCount?: number
}

export interface FileIndexEntry {
  path: string
  suffix: string
  title: string
  snippet: string
  size: number
  modifiedAt: string
  docid: string
}

export interface FileInfo {
  path: string
  displayPath: string
  title: string
  size: number
  modifiedAt: string
  docid: string
}

export interface FileContent {
  path: string
  displayPath: string
  title: string
  content: string
  docid: string
}

export interface SearchResult {
  docid: string
  file: string
  title: string
  score: number
  context: string | null
  snippet: string
}

export interface SearchResponse {
  results: SearchResult[]
}

export interface AnswerResponse {
  answer: string
  sources: SearchResult[]
}

export interface HealthResponse {
  status: string
  uptime: number
  httpAuth?: {
    adminRequired: boolean
  }
  encryption?: VaultEncryptionStatus
}

export interface VaultEncryptionStatus {
  initialized: boolean
  unlocked: boolean
  storage?: "sqlcipher-keychain"
  lockScope?: "vault"
  keyProvider?: "macos-keychain" | "file" | null
  protectedCollections: string[]
}

export interface WorkspaceConfig {
  name: string
}

export interface ModelsStatus {
  downloaded: boolean
  pulling?: boolean
  totalCount?: number
  downloadedCount?: number
  lastError?: string | null
  models: ModelInfo[]
}

export interface ModelInfo {
  model: string
  path: string
  size: string
  status: "downloaded" | "refreshed" | "missing" | "downloading"
}

export interface ExecSession {
  id: string
  status: "running" | "completed" | "failed" | "killed" | "timeout"
  command: string
  args: string[]
  cwd: string
  pid?: number
  startedAt: number
  endedAt?: number
  runtimeMs: number
  exitCode: number | null
  tail: string
  truncated: boolean
  timedOut?: boolean
  filesChanged?: FileChange[]
}

export interface FileChange {
  path: string
  action: "created" | "modified" | "deleted"
  hash?: string
}

export interface PollResponse {
  stdout: string
  stderr: string
  exited: boolean
  exitCode: number | null
  exitSignal: string | null
  timedOut: boolean
  filesChanged: FileChange[] | null
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  filesChanged: FileChange[]
  backend: string
  sandbox?: string
}

export interface BackgroundExecResult {
  status: "running"
  sessionId: string
  pid: number
  startedAt: number
  backend: string
}

// === Request Types ===

export interface SearchRequest {
  searches: Array<{ type: "lex" | "vec" | "hyde" | "expand"; query: string }>
  collections?: string[]
  limit?: number
  minScore?: number
}

export interface AnswerRequest {
  question: string
  collections?: string[]
  limit?: number
  detailLevel?: "concise" | "balanced" | "detailed"
}

export interface ExecRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  collection?: string
  background?: boolean
  yieldMs?: number
  stdinMode?: "pipe" | "ignore"
}

export type DetailLevel = "concise" | "balanced" | "detailed"

// === Gmail / Connections ===

export interface GmailStatus {
  status: "missing_credentials" | "not_connected" | "connected" | "auth_error"
  email?: string
  labels?: string[]
  lastSync?: string
  includeThreads?: boolean
  documentCount?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  polling?: boolean
  syncMode?: "labels" | "all"
  syncDaysBack?: 30 | 60 | 90
  needsScopeUpgrade?: boolean
  authErrorMessage?: string
  authErrorAt?: string
}

export interface GmailSyncResult {
  imported: number
  skipped: number
  total: number
  errors: string[]
}

// === Google Drive / Connections ===

export interface DriveStatus {
  status: "missing_credentials" | "not_connected" | "connected" | "auth_error"
  email?: string
  folders?: { id: string; name: string }[]
  lastSync?: string
  includeSubfolders?: boolean
  documentCount?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  polling?: boolean
  authErrorMessage?: string
  authErrorAt?: string
}

export interface DriveSyncResult {
  imported: number
  skipped: number
  total: number
  errors: string[]
}

export interface DriveBrowseItem {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
}

export interface DriveBrowseResult {
  items: DriveBrowseItem[]
  current: { id: string; name: string } | null
  parent: string | null
}

// === Google Calendar / Connections ===

export interface CalendarStatus {
  status: "missing_credentials" | "not_connected" | "connected" | "auth_error"
  email?: string
  calendars?: { id: string; name: string }[]
  lastSync?: string
  documentCount?: number
  syncWindowPastDays?: number
  syncWindowFutureDays?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  polling?: boolean
  authErrorMessage?: string
  authErrorAt?: string
}

export interface CalendarSyncResult {
  imported: number
  skipped: number
  total: number
  errors: string[]
}

export interface CalendarListEntry {
  id: string
  name: string
  primary: boolean
  backgroundColor?: string
}

// === Google Contacts / Connections ===

export interface ContactsStatus {
  status: "missing_credentials" | "not_connected" | "connected" | "auth_error"
  email?: string
  lastSync?: string
  documentCount?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  polling?: boolean
  authErrorMessage?: string
  authErrorAt?: string
}

export interface ContactsSyncResult {
  imported: number
  skipped: number
  total: number
  errors: string[]
}

// === GitHub / Connections ===

export interface GitHubStatus {
  status: "missing_credentials" | "not_connected" | "connected" | "auth_error"
  username?: string
  avatarUrl?: string
  selectedRepos?: { owner: string; name: string; fullName: string }[]
  lastSync?: string
  documentCount?: number
  workspaceFileCount?: number
  pollEnabled?: boolean
  pollIntervalMinutes?: number
  polling?: boolean
  syncIssues?: boolean
  syncPRs?: boolean
  authErrorMessage?: string
  authErrorAt?: string
}

export interface GitHubSyncResult {
  imported: number
  skipped: number
  total: number
  errors: string[]
}

export interface GitHubRepo {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  description?: string
  language?: string
  updatedAt?: string
}

// === Browser / Connections ===

export interface BrowserStatus {
  status: "not_configured" | "stopped" | "running"
  headless?: boolean
  cdpEndpoint?: string
  capabilities?: string[]
}

export interface BrowserConfig {
  enabled: boolean
  headless?: boolean
  cdpEndpoint?: string
  userDataDir?: string
  isolated?: boolean
  allowedOrigins?: string[]
  blockedOrigins?: string[]
  capabilities?: string[]
}

export interface BrowserDomainRule {
  domain: string
  includeSubdomains?: boolean
  schemes?: Array<"http" | "https">
}

export interface BrowserEgressRule extends BrowserDomainRule {
  allowPost?: boolean
  allowUpload?: boolean
  uploadCollections?: string[]
}

export interface BrowserUploadConstraints {
  maxFileSizeBytes: number
  allowedExtensions?: string[]
}

export interface BrowserPolicy {
  allowAllDomains: boolean
  allowedDomains: BrowserDomainRule[]
  blockCrossDomainRedirects: boolean
  uploadsEnabled: boolean
  allowedUploadCollections: string[]
  egressRules: BrowserEgressRule[]
  uploadConstraints: BrowserUploadConstraints
  largePasteThresholdBytes: number
}

export interface BrowserAuditEntry {
  timestamp: string
  toolName: string
  domain: string | null
  url: string | null
  action: string
  verdict: "allowed" | "blocked" | "error"
  reason: string
  collection?: string
  size?: number
  severity?: "low" | "medium" | "high"
  path?: string
  details?: Record<string, unknown>
}

export interface BrowserAuditResponse {
  dates: string[]
  date: string | null
  entries: BrowserAuditEntry[]
}

export interface WebSearchAuditEntry {
  timestamp: string
  toolName: string
  provider: "duckduckgo"
  query: string
  verdict: "allowed" | "blocked" | "error"
  reason: string
  resultCount?: number
  durationMs?: number
  severity?: "low" | "medium" | "high"
  domains?: string[]
  details?: Record<string, unknown>
}

export interface WebSearchAuditResponse {
  dates: string[]
  date: string | null
  entries: WebSearchAuditEntry[]
}

// === Unified Audit ===

export interface UnifiedAuditEntry {
  _category: string
  timestamp: string
  toolName: string
  action: string
  verdict: "allowed" | "blocked" | "error"
  reason: string
  severity?: "low" | "medium" | "high"
  details?: Record<string, unknown>
  // Category-specific fields
  command?: string
  path?: string
  channel?: string
  target?: string
  domain?: string | null
  url?: string | null
  query?: string
  exitCode?: number
  timedOut?: boolean
  contentLength?: number
  filesChangedCount?: number
  durationMs?: number
  [key: string]: unknown
}

export interface UnifiedAuditResponse {
  date: string | null
  category: string | null
  categories: Record<string, string[]>
  entries: UnifiedAuditEntry[]
}

// === Web Fetch / Web Search Policies ===

export interface WebFetchDomainRule {
  domain: string
  includeSubdomains?: boolean
  schemes?: Array<"http" | "https">
}

export interface WebFetchPolicy {
  allowAllDomains: boolean
  allowedDomains: WebFetchDomainRule[]
}

export interface WebSearchPolicy {
  provider: "duckduckgo"
  enabled: boolean
}

// === Agents / Connections ===

export interface AgentVaultAccess {
  enabled: boolean
  tokenPreview: string
  scopes: Array<
    | "vault.read"
    | "vault.write"
    | "exec.run"
    | "exec.manage"
    | "repo-exec.run"
    | "integrations.use"
    | "secrets.read"
    | "secrets.write"
    | "audit.append"
  >
  createdAt: string
  lastRotatedAt: string
  lastSeenAt?: string
}

export interface AgentUpstreamAuthState {
  configured: boolean
  profileId?: string
  mode?: "api_key" | "token" | "oauth"
  preview?: string
  expiresAt?: string
}

export interface AgentUpstreamAuthSummary {
  anthropic: AgentUpstreamAuthState
  openai: AgentUpstreamAuthState
}

export type AgentProfileId =
  | "chief-of-staff"
  | "software-engineer"
  | "researcher"
  | "marketing-expert"
  | "community-manager"
  | "customer-service"
  | "sales-assistant"
  | "operations-admin"
  | "custom"
export type AgentMemoryPromptInjectionMode = "off" | "new_sessions" | "always"

export interface AgentRoutingProfile {
  purpose?: string
  primaryDomains?: string[]
  preferredTaskTypes?: string[]
  forbiddenTaskTypes?: string[]
  toolFamiliesAvailable?: string[]
  shortExamples?: string[]
}

export interface AgentProfileDefinition {
  id: AgentProfileId
  label: string
  defaultName?: string
  description: string
  capabilities: string[]
  routingProfile?: AgentRoutingProfile
  requiresRepo?: boolean
  allowsNetwork?: boolean
  defaultNetworkAllowlist?: string[]
  reposBaseDir?: string
}

export interface AgentProfilesResponse {
  profiles: AgentProfileDefinition[]
  toolGroups: Record<string, string[]>
  profileTools: Record<AgentProfileId, string[]>
  allKnownTools: string[]
}

export interface AgentConnection {
  id: string
  name: string
  type: "openclaw" | "mcp" | "custom"
  gatewayUrl: string
  gatewayToken?: string
  hooksPath: string
  enabled: boolean
  running: boolean
  notifications: { gmail: boolean; gcalendar: boolean }
  lastNotified?: string
  lastError?: string
  vaultAccess?: AgentVaultAccess
  upstreamAuth?: AgentUpstreamAuthSummary
  profile?: AgentProfileId
  networkAllowlist?: string[]
  customTools?: string[]
  model?: string
  modelFallbacks?: string[]
  modelPolicy?: AgentModelRoutingPolicy
  latestUsage?: AgentLatestUsage
  memoryPromptInjectionMode?: AgentMemoryPromptInjectionMode
  routingProfile?: AgentRoutingProfile
  ownerTargets?: Record<string, string>
}

export interface AgentsStatus {
  agents: AgentConnection[]
}

export type AgentModelRoutingPolicy = "local_only" | "cloud_only" | "hybrid"

export interface AgentLatestUsage {
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalTokensFresh?: boolean
  estimatedCostUsd?: number
  local: boolean
  usedAt?: string
  fallbackFrom?: {
    provider: string
    model: string
  } | null
}

export interface OllamaModelEntry {
  id: string
  name: string
  sizeBytes?: number
  modifiedAt?: string
}

export interface OllamaModelsStatus {
  available: boolean
  baseUrl: string
  modelsPath?: string
  models: OllamaModelEntry[]
  error?: string
}

export interface OllamaRuntimeStatus {
  supported: boolean
  installed: boolean
  running: boolean
  available: boolean
  source: "managed" | "external" | "none"
  baseUrl: string
  platform: string
  arch: string
  installDir: string
  binaryPath?: string
  version?: string
  error?: string
}

export interface OpenclawDetection {
  detected: boolean
  configPath?: string
  gatewayUrl?: string
  gatewayToken?: string
  hooksToken?: string
  hooksPath?: string
  telegramConfigured?: boolean
  whatsappConfigured?: boolean
  hasVaultPlugin?: boolean
  existingVaultToken?: string
  memoryPromptInjectionMode?: AgentMemoryPromptInjectionMode
  error?: string
}

export interface OpenclawOrchestrationSettings {
  detected: boolean
  configPath?: string
  gatewayUrl?: string
  optimizationEnabled: boolean
  routerModel: string
  updatedAt?: string
  error?: string
}

export interface UsageBenchmarkModel {
  provider: string
  model: string
  label: string
}

export interface UsagePricingModelOption extends UsageBenchmarkModel {
  official: boolean
  sourceUrl: string
  cost: UsagePricingCost
}

export interface UsageOverviewBreakdownRow {
  provider: string
  model?: string
  label: string
  local: boolean
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  actualCostUsd: number
  estimatedSavingsUsd: number
  benchmarkEquivalentCostUsd: number
}

export interface UsageOverviewAgentRow {
  agentId: string
  agentName: string
  requests: number
  totalTokens: number
  localTokens: number
  cloudTokens: number
  actualCostUsd: number
  estimatedSavingsUsd: number
}

export interface UsageOverviewDailyRow {
  date: string
  tokens: number
  localTokens: number
  cloudTokens: number
  requests: number
  localRequests: number
  cloudRequests: number
  actualCostUsd: number
  estimatedSavingsUsd: number
  benchmarkEquivalentCostUsd: number
  messages: number
  toolCalls: number
  errors: number
}

export interface UsageOverviewResponse {
  generatedAt: string
  startDate: string
  endDate: string
  benchmarkModel: UsageBenchmarkModel | null
  totals: {
    requestCount: number
    totalTokens: number
    inputTokens: number
    outputTokens: number
    localTokens: number
    cloudTokens: number
    localRequests: number
    cloudRequests: number
    actualCostUsd: number
    estimatedSavingsUsd: number
    benchmarkEquivalentCostUsd: number
    localShare: number
  }
  byProvider: UsageOverviewBreakdownRow[]
  byModel: UsageOverviewBreakdownRow[]
  byAgent: UsageOverviewAgentRow[]
  daily: UsageOverviewDailyRow[]
}

export interface UsagePricingCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface UsagePricingResponse {
  benchmarkModel: UsageBenchmarkModel
  sourceUrl: string
  official: boolean
  cost: UsagePricingCost
  models: UsagePricingModelOption[]
}

// Agent channel status (from agent gateway)
export interface AgentChannelAccount {
  status: "not_configured" | "disconnected" | "connecting" | "connected" | "error"
  phone?: string
  botUsername?: string
  error?: string
  lastConnected?: string
  accountId?: string
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled"
  allowFrom?: string[]
}

export interface AgentChannelsStatus {
  whatsapp?: AgentChannelAccount
  telegram?: AgentChannelAccount
  [key: string]: AgentChannelAccount | undefined
}

export interface WhatsAppLoginResult {
  qrDataUrl?: string
  status: "qr_ready" | "already_connected" | "error"
  error?: string
}

export interface WhatsAppPollResult {
  status: "waiting" | "connected" | "timeout" | "error"
  error?: string
}

export interface AgentLogFile {
  id: string
  label: string
  path: string | null
  exists: boolean
  content: string
}

export interface AgentLogsResponse {
  logs: AgentLogFile[]
}

export interface WorkspaceLogsResponse {
  logs: AgentLogFile[]
}

// === Artifacts ===

export interface ArtifactItem {
  path: string
  title: string
  modifiedAt: string
  size: number
  mimeType: string
  isBinary: boolean
}

export interface ArtifactListResponse {
  items: ArtifactItem[]
}

export interface ArtifactBuildResult {
  ok: boolean
  pptxPath?: string
  size?: number
  slides?: number
  error?: string
}

export interface ArtifactDownloadUrlResponse {
  url: string
  expiresAtMs: number
}

// === Guard ===

export interface GuardHealthStatus {
  healthy: boolean
  ready: boolean
  error?: string
}

export interface GuardConfig {
  binaryPath: string
  configPath: string
  listenAddr: string
  consoleUrl: string
  autoStart: boolean
  activationWebhookUrl: string
}

export interface GuardStatus {
  running: boolean
  pid: number | null
  listenAddr: string
  consoleUrl: string
  health: GuardHealthStatus | null
  uptime: number | null
  config: GuardConfig | null
  lastError: string | null
  externallyManaged: boolean
  controlMode: "managed" | "external_restartable" | "external_readonly"
}

export interface GuardActivationEvent {
  timestamp: string
  toolName: string
  action: string
  verdict: "allowed" | "blocked" | "error"
  reason: string
  severity?: "low" | "medium" | "high"
  details?: {
    request_id?: string
    provider?: string
    model?: string
    mode?: string
    project_id?: string
    request_preview?: string | null
    response_preview?: string | null
    request_decision?: string
    response_decision?: string
    categories?: string[]
    request_scores?: Record<string, number>
    response_scores?: Record<string, number>
    request_hits?: Array<{ category: string; action: string; confidence?: number }>
    response_hits?: Array<{ category: string; action: string; confidence?: number }>
    intel_status?: string
    bundle_version?: string
    timing_ms?: { provider: number; total: number }
    request_latency_ms?: number
    response_latency_ms?: number
    [key: string]: unknown
  }
}

export interface GuardEventsResponse {
  dates: string[]
  date: string | null
  entries: GuardActivationEvent[]
}

export interface GuardLogsResponse {
  logs: AgentLogFile[]
}

// === Vault Health ===

export interface VaultHealthStats {
  // Counts
  activeDocuments: number
  inactiveDocuments: number
  totalContentHashes: number
  orphanedContentHashes: number
  // Vectors
  activeVectors: number
  orphanedVectors: number
  needsEmbedding: number
  hasVectorIndex: boolean
  // FTS
  ftsEntries: number
  // Storage
  dbSizeBytes: number
  llmCacheEntries: number
  // Runtime
  writeQueue: { docs: number; entries: number }
  embedding: boolean
  uptimeSeconds: number
}
