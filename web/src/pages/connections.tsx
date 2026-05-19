import { useState, useEffect, useCallback } from "react"
import {
  Mail,
  HardDrive,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unplug,
  ExternalLink,
  Folder,
  ChevronUp,
  X,
  Plus,
  Check,
  Trash2,
  Calendar,
  Users,
  Globe,
  Play,
  Square,
  Upload,
  Github,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useGmailStatus,
  useGmailAuthorize,
  useGmailSync,
  useGmailConfig,
  useGmailDisconnect,
} from "@/hooks/use-gmail"
import {
  useDriveStatus,
  useDriveAuthorize,
  useDriveSync,
  useDriveConfig,
  useDriveDisconnect,
} from "@/hooks/use-gdrive"
import {
  useCalendarStatus,
  useCalendarAuthorize,
  useCalendarSync,
  useCalendarConfig,
  useCalendarDisconnect,
  useCalendarList,
} from "@/hooks/use-gcalendar"
import {
  useContactsStatus,
  useContactsAuthorize,
  useContactsSync,
  useContactsConfig,
  useContactsDisconnect,
} from "@/hooks/use-gcontacts"
import {
  useGitHubStatus,
  useGitHubAuthorize,
  useGitHubRepos,
  useGitHubSync,
  useGitHubConfig,
  useGitHubDisconnect,
} from "@/hooks/use-github"
import {
  useBrowserPolicy,
  useBrowserPolicyConfig,
  useBrowserPolicyReset,
  useBrowserConfig,
  useBrowserStart,
  useBrowserStop,
} from "@/hooks/use-browser"
import { useVaultStatus } from "@/hooks/use-vault-status"
import { browseDrive } from "@/lib/api"
import type {
  GmailStatus,
  DriveStatus,
  DriveBrowseItem,
  CalendarStatus,
  CalendarListEntry,
  ContactsStatus,
  GitHubStatus,
  GitHubRepo,
  BrowserStatus,
  BrowserPolicy,
  BrowserDomainRule,
  BrowserEgressRule,
} from "@/lib/types"
import { toast } from "sonner"
import { useSearchParams } from "react-router"
import { cn, statusBadgeClass } from "@/lib/utils"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { PageLoading } from "@/components/shared/page-loading"

function openOAuthWindow(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) {
    window.location.assign(url)
  }
}

export function ConnectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: gmail, isLoading: gmailLoading } = useGmailStatus()
  const { data: drive, isLoading: driveLoading } = useDriveStatus()
  const { data: calendar, isLoading: calendarLoading } = useCalendarStatus()
  const { data: contacts, isLoading: contactsLoading } = useContactsStatus()
  const { data: github, isLoading: githubLoading } = useGitHubStatus()
  // Show toast if redirected from OAuth callback
  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      toast.success("Gmail connected successfully")
      setSearchParams({}, { replace: true })
    }
    if (searchParams.get("gdrive") === "connected") {
      toast.success("Google Drive connected successfully")
      setSearchParams({}, { replace: true })
    }
    if (searchParams.get("gcalendar") === "connected") {
      toast.success("Google Calendar connected successfully")
      setSearchParams({}, { replace: true })
    }
    if (searchParams.get("gcontacts") === "connected") {
      toast.success("Google Contacts connected successfully")
      setSearchParams({}, { replace: true })
    }
    if (searchParams.get("github") === "connected") {
      toast.success("GitHub connected successfully")
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const isLoading = gmailLoading || driveLoading || calendarLoading || contactsLoading || githubLoading

  return (
    <PageShell>
      <PageHeader title="Connections" description="Connect external data sources to your vault." />

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Data Sources</h2>
        {isLoading ? (
          <PageLoading variant="spinner" message="Loading connections..." />
        ) : (
          <>
            <GitHubCard status={github} />
            <GmailCard status={gmail} />
            <DriveCard status={drive} />
            <CalendarCard status={calendar} />
            <ContactsCard status={contacts} />
          </>
        )}
      </section>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// GitHub Card
// ---------------------------------------------------------------------------

function GitHubCard({
  status,
}: {
  status: GitHubStatus | undefined
}) {
  const authMut = useGitHubAuthorize()
  const syncMut = useGitHubSync()
  const configMut = useGitHubConfig()
  const disconnectMut = useGitHubDisconnect()
  const { data: availableRepos } = useGitHubRepos()

  const [editing, setEditing] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [pollEnabled, setPollEnabled] = useState(false)
  const [pollInterval, setPollInterval] = useState(15)
  const [syncIssues, setSyncIssues] = useState(true)
  const [syncPRs, setSyncPRs] = useState(true)
  const [selectedRepoNames, setSelectedRepoNames] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (status?.status === "connected") {
      setPollEnabled(status.pollEnabled ?? false)
      setPollInterval(status.pollIntervalMinutes ?? 15)
      setSyncIssues(status.syncIssues ?? true)
      setSyncPRs(status.syncPRs ?? true)
      setSelectedRepoNames(new Set((status.selectedRepos ?? []).map((r) => r.fullName)))
    }
  }, [status])

  const handleConnect = async () => {
    try {
      const { authUrl } = await authMut.mutateAsync()
      openOAuthWindow(authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start authorization")
    }
  }

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync()
      if (result.errors.length > 0) {
        toast.warning(`Imported ${result.imported} files, ${result.errors.length} errors`)
      } else {
        toast.success(`Imported ${result.imported} files (${result.skipped} skipped)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    }
  }

  const toggleRepo = (repo: GitHubRepo) => {
    setSelectedRepoNames((prev) => {
      const next = new Set(prev)
      if (next.has(repo.fullName)) {
        next.delete(repo.fullName)
      } else {
        next.add(repo.fullName)
      }
      return next
    })
  }

  const handleSaveConfig = async () => {
    const selectedRepos = (availableRepos ?? [])
      .filter((r) => selectedRepoNames.has(r.fullName))
      .map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName }))
    try {
      await configMut.mutateAsync({
        selectedRepos,
        pollEnabled,
        pollIntervalMinutes: pollInterval,
        syncIssues,
        syncPRs,
      })
      toast.success("Settings saved")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleDisconnect = () => setConfirmDisconnect(true)

  const confirmDisconnectAction = async () => {
    try {
      await disconnectMut.mutateAsync()
      toast.success("GitHub disconnected")
      setConfirmDisconnect(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    }
  }

  const s = status?.status ?? "missing_credentials"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Github className="h-4 w-4" />
          GitHub
          {s === "connected" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Connected
            </Badge>
          )}
          {s === "not_connected" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not connected
            </Badge>
          )}
          {s === "missing_credentials" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Config missing
            </Badge>
          )}
          {s === "auth_error" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Auth error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "missing_credentials" && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                GitHub OAuth client not configured
              </p>
              <p className="text-muted-foreground mt-1">
                Add your GitHub OAuth App credentials to <code className="text-xs">_config/github-oauth.json</code> with
                {" "}<code className="text-xs">clientId</code> and <code className="text-xs">clientSecret</code>.
              </p>
            </div>
          </div>
        )}

        {s === "not_connected" && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your GitHub account to sync repositories into the vault workspace.
              The agent can read code, create issues, branches, and pull requests.
            </p>
            <Button
              className="gap-1.5"
              onClick={handleConnect}
              disabled={authMut.isPending}
            >
              {authMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Connect GitHub
            </Button>
          </>
        )}

        {s === "auth_error" && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  GitHub needs to be reconnected
                </p>
                <p className="text-muted-foreground mt-1">
                  {status?.authErrorMessage || "GitHub authorization expired or was revoked."}
                </p>
                {status?.authErrorAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Detected on {new Date(status.authErrorAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button className="gap-1.5" onClick={handleConnect} disabled={authMut.isPending}>
                {authMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                Reconnect GitHub
              </Button>
              <Button
                variant="ghost" size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDisconnect} disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {s === "connected" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono text-xs">{status?.username}</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Synced repos</span>
                <span>{status?.selectedRepos?.length ?? 0}</span>
              </div>
              {(status?.workspaceFileCount ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Workspace files</span>
                  <span>{status?.workspaceFileCount}</span>
                </div>
              )}
              {(status?.documentCount ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Issues/PRs synced</span>
                  <span>{status?.documentCount}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
              {status?.pollEnabled && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Auto-sync</span>
                  <div className="flex items-center gap-1.5">
                    {status.polling ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs">Every {status.pollIntervalMinutes}m</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {editing && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Repositories</label>
                  <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border p-2">
                    {(availableRepos ?? []).map((repo) => (
                      <label key={repo.fullName} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={selectedRepoNames.has(repo.fullName)}
                          onChange={() => toggleRepo(repo)}
                          className="rounded"
                        />
                        <span className="font-mono text-xs">{repo.fullName}</span>
                        {repo.private && <Badge variant="outline" className="text-[9px] h-4">Private</Badge>}
                        {repo.language && <span className="text-[10px] text-muted-foreground ml-auto">{repo.language}</span>}
                      </label>
                    ))}
                    {!availableRepos?.length && (
                      <p className="text-xs text-muted-foreground py-2 text-center">Loading repos...</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="ghSyncIssues" checked={syncIssues} onChange={(e) => setSyncIssues(e.target.checked)} className="rounded" />
                  <label htmlFor="ghSyncIssues" className="text-sm">Sync issues</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="ghSyncPRs" checked={syncPRs} onChange={(e) => setSyncPRs(e.target.checked)} className="rounded" />
                  <label htmlFor="ghSyncPRs" className="text-sm">Sync pull requests</label>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="ghPollEnabled" checked={pollEnabled} onChange={(e) => setPollEnabled(e.target.checked)} className="rounded" />
                  <label htmlFor="ghPollEnabled" className="text-sm">Auto-sync</label>
                </div>

                {pollEnabled && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Poll interval</label>
                    <Select value={String(pollInterval)} onValueChange={(v) => setPollInterval(Number(v))}>
                      <SelectTrigger className="h-8 text-sm w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleSaveConfig} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                    setEditing(false)
                    setPollEnabled(status?.pollEnabled ?? false)
                    setPollInterval(status?.pollIntervalMinutes ?? 15)
                    setSyncIssues(status?.syncIssues ?? true)
                    setSyncPRs(status?.syncPRs ?? true)
                    setSelectedRepoNames(new Set((status?.selectedRepos ?? []).map((r) => r.fullName)))
                  }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSync} disabled={syncMut.isPending || !status?.selectedRepos?.length}>
                {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync Now
              </Button>
              {!editing && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                  Settings
                </Button>
              )}
              <Button
                variant="ghost" size="sm"
                className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                onClick={handleDisconnect} disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect GitHub"
        description="Disconnect GitHub? You'll need to re-authenticate to use it again."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={disconnectMut.isPending}
        onConfirm={() => void confirmDisconnectAction()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Gmail Card (unchanged)
// ---------------------------------------------------------------------------

function GmailCard({
  status,
}: {
  status: GmailStatus | undefined
}) {
  const authMut = useGmailAuthorize()
  const syncMut = useGmailSync()
  const configMut = useGmailConfig()
  const disconnectMut = useGmailDisconnect()

  const [labelInput, setLabelInput] = useState("")
  const [includeThreads, setIncludeThreads] = useState(true)
  const [pollEnabled, setPollEnabled] = useState(false)
  const [pollInterval, setPollInterval] = useState(5)
  const [syncMode, setSyncMode] = useState<"labels" | "all">("labels")
  const [syncDaysBack, setSyncDaysBack] = useState<30 | 60 | 90>(30)
  const [editing, setEditing] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Sync local state when status loads
  useEffect(() => {
    if (status?.status === "connected") {
      setLabelInput(status.labels?.join(", ") ?? "")
      setIncludeThreads(status.includeThreads ?? true)
      setPollEnabled(status.pollEnabled ?? false)
      setPollInterval(status.pollIntervalMinutes ?? 5)
      setSyncMode(status.syncMode ?? "labels")
      setSyncDaysBack(status.syncDaysBack ?? 30)
    }
  }, [status])

  const handleConnect = async () => {
    try {
      const { authUrl } = await authMut.mutateAsync()
      openOAuthWindow(authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start authorization")
    }
  }

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync()
      if (result.errors.length > 0) {
        toast.warning(`Imported ${result.imported}, ${result.errors.length} errors`)
      } else {
        toast.success(
          `Imported ${result.imported} emails (${result.skipped} already synced)`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    }
  }

  const handleSaveConfig = async () => {
    const labels = labelInput
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean)
    if (syncMode === "labels" && labels.length === 0) {
      toast.error("At least one label is required")
      return
    }
    try {
      await configMut.mutateAsync({ labels, includeThreads, pollEnabled, pollIntervalMinutes: pollInterval, syncMode, syncDaysBack })
      toast.success("Settings saved")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleDisconnect = () => setConfirmDisconnect(true)

  const confirmDisconnectAction = async () => {
    try {
      await disconnectMut.mutateAsync()
      toast.success("Gmail disconnected")
      setConfirmDisconnect(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    }
  }

  const s = status?.status ?? "missing_credentials"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Gmail
          {s === "connected" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Connected
            </Badge>
          )}
          {s === "not_connected" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not connected
            </Badge>
          )}
          {s === "missing_credentials" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Config missing
            </Badge>
          )}
          {s === "auth_error" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Auth error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "missing_credentials" && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Google OAuth client not configured
              </p>
              <p className="text-muted-foreground mt-1">
                Configure the shared Google OAuth client in Vault setup so Gmail, Drive,
                Calendar, and Contacts can connect from this workspace.
              </p>
            </div>
          </div>
        )}

        {s === "not_connected" && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your Gmail account to import labeled emails into the vault.
              Only emails with the labels you choose here will be imported.
            </p>
            <Button
              className="gap-1.5"
              onClick={handleConnect}
              disabled={authMut.isPending}
            >
              {authMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Connect Gmail
            </Button>
          </>
        )}

        {s === "auth_error" && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Gmail needs to be reconnected
                </p>
                <p className="text-muted-foreground mt-1">
                  {status?.authErrorMessage || "Google rejected the stored Gmail authorization. Auto-sync has been paused until you reconnect Gmail."}
                </p>
                {status?.authErrorAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Detected on {new Date(status.authErrorAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {status?.email && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-mono text-xs">{status.email}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="gap-1.5"
                onClick={handleConnect}
                disabled={authMut.isPending}
              >
                {authMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Reconnect Gmail
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {s === "connected" && (
          <>
            {/* Scope upgrade banner */}
            {status?.needsScopeUpgrade && (
              <div className="flex items-start gap-3 p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
                <AlertTriangle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-blue-600 dark:text-blue-400">
                    Compose permission needed
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Reconnect Gmail to enable draft creation. Your sync settings will be preserved.
                  </p>
                  <Button
                    size="sm"
                    className="mt-2 h-7 text-xs gap-1"
                    onClick={handleConnect}
                    disabled={authMut.isPending}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Reconnect
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono text-xs">{status?.email}</span>
                </div>
              </div>
              {status?.documentCount != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Imported emails</span>
                  <span>{status.documentCount}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
              {status?.pollEnabled && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Auto-sync</span>
                  <div className="flex items-center gap-1.5">
                    {status.polling ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs">Every {status.pollIntervalMinutes}m</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
                    )}
                  </div>
                </div>
              )}
              {!editing && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Labels</span>
                  <span className="text-xs">
                    {status?.syncMode === "all"
                      ? `All email (last ${status?.syncDaysBack ?? 30} days)`
                      : status?.labels?.join(", ") || "—"}
                  </span>
                </div>
              )}
            </div>

            {editing && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Sync mode</label>
                  <Select
                    value={syncMode}
                    onValueChange={(v) => setSyncMode(v as "labels" | "all")}
                  >
                    <SelectTrigger className="h-8 text-sm w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labels">Selected labels</SelectItem>
                      <SelectItem value="all">All recent email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {syncMode === "labels" ? (
                  <div className="space-y-2">
                    <label className="text-xs font-medium">
                      Labels to sync (comma-separated)
                    </label>
                    <Input
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      placeholder="Important, Receipts"
                      className="text-sm h-8"
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Lookback period</label>
                    <Select
                      value={String(syncDaysBack)}
                      onValueChange={(v) => setSyncDaysBack(Number(v) as 30 | 60 | 90)}
                    >
                      <SelectTrigger className="h-8 text-sm w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">Last 30 days</SelectItem>
                        <SelectItem value="60">Last 60 days</SelectItem>
                        <SelectItem value="90">Last 90 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      Syncs up to 2,000 most recent emails within this window.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includeThreads"
                    checked={includeThreads}
                    onChange={(e) => setIncludeThreads(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="includeThreads" className="text-sm">
                    Include full threads
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pollEnabled"
                    checked={pollEnabled}
                    onChange={(e) => setPollEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="pollEnabled" className="text-sm">
                    Auto-sync
                  </label>
                </div>

                {pollEnabled && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Poll interval
                    </label>
                    <Select
                      value={String(pollInterval)}
                      onValueChange={(v) => setPollInterval(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-sm w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 minute</SelectItem>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleSaveConfig}
                    disabled={configMut.isPending}
                  >
                    {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditing(false)
                      setLabelInput(status?.labels?.join(", ") ?? "")
                      setIncludeThreads(status?.includeThreads ?? true)
                      setPollEnabled(status?.pollEnabled ?? false)
                      setPollInterval(status?.pollIntervalMinutes ?? 5)
                      setSyncMode(status?.syncMode ?? "labels")
                      setSyncDaysBack(status?.syncDaysBack ?? 30)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSync}
                disabled={syncMut.isPending}
              >
                {syncMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync Now
              </Button>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEditing(true)}
                >
                  Settings
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Gmail"
        description="Disconnect Gmail? You'll need to re-authenticate to use it again."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={disconnectMut.isPending}
        onConfirm={() => void confirmDisconnectAction()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Google Drive Card
// ---------------------------------------------------------------------------

function DriveCard({ status }: { status: DriveStatus | undefined }) {
  const authMut = useDriveAuthorize()
  const syncMut = useDriveSync()
  const configMut = useDriveConfig()
  const disconnectMut = useDriveDisconnect()

  const [includeSubfolders, setIncludeSubfolders] = useState(true)
  const [editing, setEditing] = useState(false)
  const [addingFolder, setAddingFolder] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [drivePollEnabled, setDrivePollEnabled] = useState(false)
  const [drivePollInterval, setDrivePollInterval] = useState(30)

  // Drive folder browser state
  const [browseItems, setBrowseItems] = useState<DriveBrowseItem[]>([])
  const [browseCurrent, setBrowseCurrent] = useState<{ id: string; name: string } | null>(null)
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)

  // Sync local state when status loads
  useEffect(() => {
    if (status?.status === "connected" || status?.status === "auth_error") {
      setIncludeSubfolders(status.includeSubfolders ?? true)
      setDrivePollEnabled(status.pollEnabled ?? false)
      setDrivePollInterval(status.pollIntervalMinutes ?? 30)
    }
  }, [status])

  const handleConnect = async () => {
    try {
      const { authUrl } = await authMut.mutateAsync()
      openOAuthWindow(authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start authorization")
    }
  }

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync()
      if (result.errors.length > 0) {
        toast.warning(`Imported ${result.imported}, ${result.errors.length} errors`)
      } else {
        toast.success(
          `Imported ${result.imported} files (${result.skipped} already synced)`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    }
  }

  const handleDisconnect = () => setConfirmDisconnect(true)

  const confirmDisconnectAction = async () => {
    try {
      await disconnectMut.mutateAsync()
      toast.success("Google Drive disconnected")
      setConfirmDisconnect(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    }
  }

  const handleSaveConfig = async () => {
    try {
      await configMut.mutateAsync({ includeSubfolders, pollEnabled: drivePollEnabled, pollIntervalMinutes: drivePollInterval })
      toast.success("Settings saved")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const loadBrowse = useCallback(async (folderId?: string) => {
    setBrowseLoading(true)
    try {
      const result = await browseDrive(folderId)
      setBrowseItems(result.items)
      setBrowseCurrent(result.current)
      setBrowseParent(result.parent)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to browse Drive")
    }
    setBrowseLoading(false)
  }, [])

  const handleStartAddFolder = () => {
    setAddingFolder(true)
    loadBrowse()
  }

  const handleSelectFolder = async (item: DriveBrowseItem) => {
    if (!item.isFolder) return
    const current = status?.folders || []
    if (current.some((f) => f.id === item.id)) {
      toast.error("Folder already added")
      return
    }
    try {
      await configMut.mutateAsync({
        folders: [...current, { id: item.id, name: item.name }],
      })
      toast.success(`Added folder "${item.name}"`)
      setAddingFolder(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add folder")
    }
  }

  const handleRemoveFolder = async (folderId: string) => {
    const current = status?.folders || []
    try {
      await configMut.mutateAsync({
        folders: current.filter((f) => f.id !== folderId),
      })
      toast.success("Folder removed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove folder")
    }
  }

  const s = status?.status ?? "missing_credentials"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          Google Drive
          {s === "connected" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Connected
            </Badge>
          )}
          {s === "not_connected" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not connected
            </Badge>
          )}
          {s === "missing_credentials" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Config missing
            </Badge>
          )}
          {s === "auth_error" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Auth error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "missing_credentials" && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Google OAuth client not configured
              </p>
              <p className="text-muted-foreground mt-1">
                Configure the shared Google OAuth client in Vault setup. These
                credentials power both Gmail and Drive for this workspace.
              </p>
            </div>
          </div>
        )}

        {s === "not_connected" && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your Google Drive to import documents, spreadsheets, and other files into the vault.
            </p>
            <Button
              className="gap-1.5"
              onClick={handleConnect}
              disabled={authMut.isPending}
            >
              {authMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Connect Google Drive
            </Button>
          </>
        )}

        {s === "auth_error" && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Google Drive needs to be reconnected
                </p>
                <p className="text-muted-foreground mt-1">
                  {status?.authErrorMessage || "Google rejected the stored Drive authorization. Auto-sync has been paused until you reconnect Google Drive."}
                </p>
                {status?.authErrorAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Detected on {new Date(status.authErrorAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {status?.email && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-mono text-xs">{status.email}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="gap-1.5"
                onClick={handleConnect}
                disabled={authMut.isPending}
              >
                {authMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Reconnect Google Drive
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {s === "connected" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono text-xs">{status?.email}</span>
                </div>
              </div>
              {status?.documentCount != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Imported documents</span>
                  <span>{status.documentCount}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
              {status?.pollEnabled && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Auto-sync</span>
                  <div className="flex items-center gap-1.5">
                    {status.polling ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs">Every {status.pollIntervalMinutes}m</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
                    )}
                  </div>
                </div>
              )}
              {!editing && (status?.folders?.length ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Folders</span>
                  <span className="text-xs">
                    {status?.folders?.map((f) => f.name).join(", ")}
                  </span>
                </div>
              )}
            </div>

            {editing && (
              <div className="space-y-3 pt-2 border-t">
                {/* Folder management */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">Synced Folders</label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={handleStartAddFolder}
                      disabled={addingFolder}
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                  </div>

                  {(status?.folders?.length ?? 0) === 0 && !addingFolder && (
                    <p className="text-xs text-muted-foreground">
                      No folders configured. Add a folder to start syncing.
                    </p>
                  )}

                  {status?.folders?.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 text-sm px-2 py-1.5 rounded border bg-muted/30"
                    >
                      <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <button
                        onClick={() => handleRemoveFolder(f.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  {addingFolder && (
                    <div className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Select a folder from Drive</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setAddingFolder(false)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {browseParent !== null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => loadBrowse(browseParent || undefined)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <span className="text-xs text-muted-foreground truncate flex-1">
                          {browseCurrent?.name || "My Drive"}
                        </span>
                        {browseCurrent && (
                          <Button
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() =>
                              handleSelectFolder({
                                id: browseCurrent.id,
                                name: browseCurrent.name,
                                mimeType: "application/vnd.google-apps.folder",
                                isFolder: true,
                              })
                            }
                            disabled={configMut.isPending}
                          >
                            <Check className="h-3 w-3" />
                            Select this folder
                          </Button>
                        )}
                      </div>

                      <div className="max-h-48 overflow-auto border rounded">
                        {browseLoading ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1.5" />
                            Loading...
                          </div>
                        ) : browseItems.filter((i) => i.isFolder).length === 0 ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">
                            No subfolders
                          </div>
                        ) : (
                          <div className="p-1">
                            {browseItems
                              .filter((i) => i.isFolder)
                              .map((item) => (
                                <button
                                  key={item.id}
                                  className={cn(
                                    "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/50"
                                  )}
                                  onClick={() => loadBrowse(item.id)}
                                >
                                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <span className="truncate flex-1 text-xs">{item.name}</span>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includeSubfolders"
                    checked={includeSubfolders}
                    onChange={(e) => setIncludeSubfolders(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="includeSubfolders" className="text-sm">
                    Include subfolders
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="drivePollEnabled"
                    checked={drivePollEnabled}
                    onChange={(e) => setDrivePollEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="drivePollEnabled" className="text-sm">
                    Auto-sync
                  </label>
                </div>

                {drivePollEnabled && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Poll interval
                    </label>
                    <Select
                      value={String(drivePollInterval)}
                      onValueChange={(v) => setDrivePollInterval(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-sm w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleSaveConfig} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditing(false)
                      setAddingFolder(false)
                      setIncludeSubfolders(status?.includeSubfolders ?? true)
                      setDrivePollEnabled(status?.pollEnabled ?? false)
                      setDrivePollInterval(status?.pollIntervalMinutes ?? 30)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSync}
                disabled={syncMut.isPending || (status?.folders?.length ?? 0) === 0}
              >
                {syncMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync Now
              </Button>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEditing(true)}
                >
                  Settings
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive"
        description="Disconnect Google Drive? You'll need to re-authenticate to use it again."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={disconnectMut.isPending}
        onConfirm={() => void confirmDisconnectAction()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Browser Card
// ---------------------------------------------------------------------------

export function BrowserCard({ status }: { status: BrowserStatus | undefined }) {
  const configMut = useBrowserConfig()
  const policyQuery = useBrowserPolicy()
  const policyMut = useBrowserPolicyConfig()
  const policyResetMut = useBrowserPolicyReset()
  const startMut = useBrowserStart()
  const stopMut = useBrowserStop()
  const { data: vaultStatus } = useVaultStatus()

  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState("browser")
  const [headless, setHeadless] = useState(false)
  const [cdpEndpoint, setCdpEndpoint] = useState("")
  const [isolated, setIsolated] = useState(false)
  const [allowAllDomains, setAllowAllDomains] = useState(false)
  const [uploadsEnabled, setUploadsEnabled] = useState(false)
  const [allowedUploadCollectionsInput, setAllowedUploadCollectionsInput] = useState("_uploads")
  const [blockCrossDomainRedirects, setBlockCrossDomainRedirects] = useState(true)
  const [largePasteThresholdBytesInput, setLargePasteThresholdBytesInput] = useState("4096")
  const [maxFileSizeBytesInput, setMaxFileSizeBytesInput] = useState(String(5 * 1024 * 1024))
  const [allowedExtensionsInput, setAllowedExtensionsInput] = useState("")
  const [allowedDomainsDraft, setAllowedDomainsDraft] = useState<BrowserDomainRule[]>([])
  const [egressRulesDraft, setEgressRulesDraft] = useState<BrowserEgressRule[]>([])

  useEffect(() => {
    if (status) {
      setHeadless(status.headless ?? false)
      setCdpEndpoint(status.cdpEndpoint ?? "")
    }
  }, [status])

  const s = status?.status ?? "not_configured"

  const parseCollectionList = (value: string) => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of value.split(",")) {
      const name = raw.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }

  const parseCommaList = (value: string) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)

  const toggleScheme = (
    current: Array<"http" | "https"> | undefined,
    scheme: "http" | "https",
    enabled: boolean
  ): Array<"http" | "https"> | undefined => {
    const next = new Set(current ?? [])
    if (enabled) next.add(scheme)
    else next.delete(scheme)
    const ordered = (["http", "https"] as const).filter((s) => next.has(s))
    return ordered.length > 0 ? [...ordered] : undefined
  }

  const normalizeDomainDraft = <T extends BrowserDomainRule>(rule: T): T | null => {
    const domain = (rule.domain || "").trim()
    if (!domain) return null
    return {
      ...rule,
      domain,
      schemes: rule.schemes && rule.schemes.length > 0 ? rule.schemes : undefined,
    }
  }

  const applyPolicyDraft = (policy?: BrowserPolicy) => {
    setAllowAllDomains(policy?.allowAllDomains ?? false)
    setUploadsEnabled(policy?.uploadsEnabled ?? false)
    setAllowedUploadCollectionsInput((policy?.allowedUploadCollections ?? ["_uploads"]).join(", "))
    setBlockCrossDomainRedirects(policy?.blockCrossDomainRedirects ?? true)
    setLargePasteThresholdBytesInput(String(policy?.largePasteThresholdBytes ?? 4096))
    setMaxFileSizeBytesInput(String(policy?.uploadConstraints?.maxFileSizeBytes ?? 5 * 1024 * 1024))
    setAllowedExtensionsInput((policy?.uploadConstraints?.allowedExtensions ?? []).join(", "))
    setAllowedDomainsDraft(
      (policy?.allowedDomains ?? []).map((r) => ({
        domain: r.domain,
        includeSubdomains: r.includeSubdomains,
        schemes: r.schemes ? [...r.schemes] : undefined,
      }))
    )
    setEgressRulesDraft(
      (policy?.egressRules ?? []).map((r) => ({
        domain: r.domain,
        includeSubdomains: r.includeSubdomains,
        schemes: r.schemes ? [...r.schemes] : undefined,
        allowPost: r.allowPost,
        allowUpload: r.allowUpload,
        uploadCollections: r.uploadCollections ? [...r.uploadCollections] : undefined,
      }))
    )
  }

  const syncPolicyDraft = () => applyPolicyDraft(policyQuery.data)

  const openSettings = () => {
    setHeadless(status?.headless ?? false)
    setCdpEndpoint(status?.cdpEndpoint ?? "")
    syncPolicyDraft()
    setActiveTab("browser")
    setEditing(true)
  }

  const allowedUploadCollections = parseCollectionList(allowedUploadCollectionsInput)
  const allowedUploadCollectionSet = new Set(allowedUploadCollections)
  const allCollectionNames = (vaultStatus?.collections ?? []).map((c) => c.name)
  const addableCollectionNames = allCollectionNames.filter((name) => !allowedUploadCollectionSet.has(name))

  const addAllowedDomainRow = () => {
    setAllowedDomainsDraft((prev) => [...prev, { domain: "", includeSubdomains: true, schemes: ["http", "https"] }])
  }

  const updateAllowedDomainRow = (index: number, updater: (row: BrowserDomainRule) => BrowserDomainRule) => {
    setAllowedDomainsDraft((prev) => prev.map((row, i) => (i === index ? updater(row) : row)))
  }

  const removeAllowedDomainRow = (index: number) => {
    setAllowedDomainsDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const addEgressRuleRow = () => {
    setEgressRulesDraft((prev) => [
      ...prev,
        {
          domain: "",
          includeSubdomains: true,
          schemes: ["http", "https"],
          allowPost: false,
          allowUpload: false,
        },
    ])
  }

  const updateEgressRuleRow = (index: number, updater: (row: BrowserEgressRule) => BrowserEgressRule) => {
    setEgressRulesDraft((prev) => prev.map((row, i) => (i === index ? updater(row) : row)))
  }

  const removeEgressRuleRow = (index: number) => {
    setEgressRulesDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSaveConfig = async () => {
    try {
      const maxFileSizeBytes = Number(maxFileSizeBytesInput)
      if (!Number.isFinite(maxFileSizeBytes) || maxFileSizeBytes <= 0) {
        throw new Error("Max upload file size must be a positive number")
      }
      const largePasteThresholdBytes = Number(largePasteThresholdBytesInput)
      if (!Number.isFinite(largePasteThresholdBytes) || largePasteThresholdBytes < 0) {
        throw new Error("Large paste threshold must be zero or a positive number")
      }
      const allowedDomains = allowedDomainsDraft
        .map((r) => normalizeDomainDraft(r))
        .filter((r): r is BrowserDomainRule => !!r)
      const egressRules: BrowserEgressRule[] = []
      for (const rule of egressRulesDraft) {
        const normalized = normalizeDomainDraft({
          ...rule,
          uploadCollections:
            rule.uploadCollections && rule.uploadCollections.length > 0
              ? rule.uploadCollections
              : undefined,
        })
        if (normalized) egressRules.push(normalized)
      }
      const allowedExtensions = parseCommaList(allowedExtensionsInput)

      await configMut.mutateAsync({
        enabled: true,
        headless,
        isolated,
        ...(cdpEndpoint ? { cdpEndpoint } : {}),
      })
      await policyMut.mutateAsync({
        allowAllDomains,
        uploadsEnabled,
        allowedUploadCollections,
        blockCrossDomainRedirects,
        allowedDomains,
        egressRules,
        uploadConstraints: {
          maxFileSizeBytes: Math.trunc(maxFileSizeBytes),
          allowedExtensions,
        },
        largePasteThresholdBytes: Math.trunc(largePasteThresholdBytes),
      })
      toast.success("Browser settings saved")
      setEditing(false)
      setActiveTab("browser")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleResetPolicy = async () => {
    try {
      const result = await policyResetMut.mutateAsync()
      applyPolicyDraft(result.policy)
      toast.success("Browser policy reset to defaults")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset browser policy")
    }
  }

  const handleStart = async () => {
    try {
      // If not configured yet, save default config first
      if (s === "not_configured") {
        await configMut.mutateAsync({
          enabled: true,
          headless,
          isolated,
          ...(cdpEndpoint ? { cdpEndpoint } : {}),
        })
      }
      await startMut.mutateAsync()
      toast.success("Browser started")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start browser")
    }
  }

  const handleStop = async () => {
    try {
      await stopMut.mutateAsync()
      toast.success("Browser stopped")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop browser")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Chromium Browser
          {s === "running" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Running
            </Badge>
          )}
          {s === "stopped" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Stopped
            </Badge>
          )}
          {s === "not_configured" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not configured
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "not_configured" && !editing && (
          <>
            <p className="text-sm text-muted-foreground">
              Launch a Chromium browser that agents can use for web automation,
              scraping, and browsing. Powered by Playwright.
            </p>
            <Button className="gap-1.5" onClick={openSettings}>
              <Play className="h-3.5 w-3.5" />
              Configure Browser
            </Button>
          </>
        )}

        {/* Compact status summary */}
        {(s === "running" || s === "stopped") && !editing && (
          <div className="space-y-1">
            <div className="flex items-center gap-x-2 gap-y-0.5 text-xs flex-wrap">
              <span className="text-muted-foreground">{status?.headless ? "Headless" : "Headed"}</span>
              {status?.cdpEndpoint && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-muted-foreground truncate max-w-[200px]">{status.cdpEndpoint}</span>
                </>
              )}
              {(status?.capabilities?.length ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{status?.capabilities?.join(", ")}</span>
                </>
              )}
              {policyQuery.data && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {policyQuery.data.allowAllDomains
                      ? "All domains"
                      : `${policyQuery.data.allowedDomains.length} domain${policyQuery.data.allowedDomains.length !== 1 ? "s" : ""}`}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    Uploads {policyQuery.data.uploadsEnabled ? "on" : "off"}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    Redirects {policyQuery.data.blockCrossDomainRedirects ? "blocked" : "allowed"}
                  </span>
                </>
              )}
            </div>
            {policyQuery.data && (
              <div className="flex items-center gap-x-2 text-[10px] text-muted-foreground/70 flex-wrap">
                <span>{policyQuery.data.egressRules.length} egress rule{policyQuery.data.egressRules.length !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>
                  Max upload{" "}
                  {(() => {
                    const n = policyQuery.data!.uploadConstraints.maxFileSizeBytes
                    return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`
                  })()}
                </span>
                {policyQuery.data.allowedUploadCollections.length > 0 && (
                  <>
                    <span>·</span>
                    <span>Collections: {policyQuery.data.allowedUploadCollections.join(", ")}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action bar */}
        {s !== "not_configured" && (
          <div className="flex items-center gap-2">
            {s !== "running" ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleStart}
                disabled={startMut.isPending}
              >
                {startMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Start
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleStop}
                disabled={stopMut.isPending}
              >
                {stopMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Stop
              </Button>
            )}
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={openSettings}
              >
                Settings
              </Button>
            )}
          </div>
        )}

        {/* Editing tabs */}
        {editing && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList variant="line">
              <TabsTrigger value="browser">Browser</TabsTrigger>
              <TabsTrigger value="uploads">Uploads</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
            </TabsList>

            {/* Browser tab */}
            <TabsContent value="browser">
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="browser-headless"
                    checked={headless}
                    onChange={(e) => setHeadless(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="browser-headless" className="text-sm">
                    Headless mode
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="browser-isolated"
                    checked={isolated}
                    onChange={(e) => setIsolated(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="browser-isolated" className="text-sm">
                    Isolated session (no persistent profile)
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    CDP Endpoint (optional — connect to existing Chrome)
                  </label>
                  <Input
                    value={cdpEndpoint}
                    onChange={(e) => setCdpEndpoint(e.target.value)}
                    placeholder="ws://localhost:9222"
                    className="text-sm h-8"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Uploads tab */}
            <TabsContent value="uploads">
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Browser Upload Sources</p>
                    <p className="text-xs text-muted-foreground">
                      Files are imported into collections using the normal Import Files dialog. This setting controls which collections agents may upload from.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="browser-uploads-enabled"
                    checked={uploadsEnabled}
                    onChange={(e) => setUploadsEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="browser-uploads-enabled" className="text-sm">
                    Allow browser uploads (disabled by default)
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Global upload enable is required, and the current site must also match an egress rule with{" "}
                  <code className="text-[10px] bg-muted px-1 py-0.5 rounded">allowUpload</code>.
                </p>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Allowed upload collections (comma-separated)
                  </label>
                  <Input
                    value={allowedUploadCollectionsInput}
                    onChange={(e) => setAllowedUploadCollectionsInput(e.target.value)}
                    placeholder="_uploads"
                    className="text-sm h-8"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default is <code className="text-[10px] bg-muted px-1 py-0.5 rounded">_uploads</code>. Add files to it from the Home page or Collections import dialog.
                  </p>
                </div>

                {addableCollectionNames.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Add existing collections</div>
                    <div className="flex flex-wrap gap-1">
                      {addableCollectionNames.slice(0, 12).map((name) => (
                        <Button
                          key={name}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setAllowedUploadCollectionsInput((prev) =>
                              prev.trim() ? `${prev.trim()}, ${name}` : name
                            )
                          }}
                        >
                          {name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  {allowedUploadCollections.length > 0 ? (
                    allowedUploadCollections.map((name) => (
                      <Badge key={name} variant="secondary" className="text-[10px]">
                        {name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No collections allowed</span>
                  )}
                </div>

                {policyQuery.error instanceof Error && (
                  <div className="text-xs text-destructive">
                    Failed to load browser policy: {policyQuery.error.message}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Security tab */}
            <TabsContent value="security">
              <div className="space-y-3 pt-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Domain allowlists, redirect handling, egress rules, upload limits, and paste guard.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={handleResetPolicy}
                    disabled={policyResetMut.isPending}
                  >
                    {policyResetMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Reset Policy
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="browser-allow-all-domains"
                    checked={allowAllDomains}
                    onChange={(e) => setAllowAllDomains(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="browser-allow-all-domains" className="text-sm">
                    Allow navigation to all domains
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  This only affects navigation allowlisting. POST / submit and uploads still require matching egress rules.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="browser-block-cross-domain-redirects"
                    checked={blockCrossDomainRedirects}
                    onChange={(e) => setBlockCrossDomainRedirects(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="browser-block-cross-domain-redirects" className="text-sm">
                    Block cross-domain redirects (recommended)
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Max upload file size (bytes)
                    </label>
                    <Input
                      value={maxFileSizeBytesInput}
                      onChange={(e) => setMaxFileSizeBytesInput(e.target.value)}
                      inputMode="numeric"
                      className="text-sm h-8"
                      placeholder="5242880"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Large paste threshold (bytes)
                    </label>
                    <Input
                      value={largePasteThresholdBytesInput}
                      onChange={(e) => setLargePasteThresholdBytesInput(e.target.value)}
                      inputMode="numeric"
                      className="text-sm h-8"
                      placeholder="4096"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Allowed upload extensions (comma-separated, optional)
                  </label>
                  <Input
                    value={allowedExtensionsInput}
                    onChange={(e) => setAllowedExtensionsInput(e.target.value)}
                    className="text-sm h-8"
                    placeholder=".pdf, .docx, .png"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Allowed domains
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={addAllowedDomainRow}
                      disabled={allowAllDomains}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add domain
                    </Button>
                  </div>

                  {allowedDomainsDraft.length === 0 ? (
                    <div className="text-xs text-muted-foreground rounded border border-dashed p-2">
                      {allowAllDomains
                        ? "All domains are enabled. Domain allowlist rows are ignored until you turn this off."
                        : "No allowed domains. Navigation is blocked by default until you add domains."}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allowedDomainsDraft.map((rule, index) => (
                        <div key={`allowed-domain-${index}`} className="rounded border p-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={rule.domain}
                              onChange={(e) =>
                                updateAllowedDomainRow(index, (row) => ({ ...row, domain: e.target.value }))
                              }
                              placeholder="example.com"
                              className="h-8 text-sm"
                              disabled={allowAllDomains}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-destructive hover:text-destructive"
                              onClick={() => removeAllowedDomainRow(index)}
                              title="Remove domain rule"
                              disabled={allowAllDomains}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={rule.includeSubdomains !== false}
                                onChange={(e) =>
                                  updateAllowedDomainRow(index, (row) => ({
                                    ...row,
                                    includeSubdomains: e.target.checked,
                                  }))
                                }
                                className="rounded"
                                disabled={allowAllDomains}
                              />
                              Subdomains
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={(rule.schemes ?? ["http", "https"]).includes("http")}
                                onChange={(e) =>
                                  updateAllowedDomainRow(index, (row) => ({
                                    ...row,
                                    schemes: toggleScheme(row.schemes, "http", e.target.checked),
                                  }))
                                }
                                className="rounded"
                                disabled={allowAllDomains}
                              />
                              HTTP
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={(rule.schemes ?? ["http", "https"]).includes("https")}
                                onChange={(e) =>
                                  updateAllowedDomainRow(index, (row) => ({
                                    ...row,
                                    schemes: toggleScheme(row.schemes, "https", e.target.checked),
                                  }))
                                }
                                className="rounded"
                                disabled={allowAllDomains}
                              />
                              HTTPS
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Egress rules
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={addEgressRuleRow}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add egress rule
                    </Button>
                  </div>

                  {egressRulesDraft.length === 0 ? (
                    <div className="text-xs text-muted-foreground rounded border border-dashed p-2">
                      No egress rules. POSTs and uploads remain blocked until explicitly allowed per domain.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {egressRulesDraft.map((rule, index) => (
                        <div key={`egress-rule-${index}`} className="rounded border p-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={rule.domain}
                              onChange={(e) =>
                                updateEgressRuleRow(index, (row) => ({ ...row, domain: e.target.value }))
                              }
                              placeholder="example.com"
                              className="h-8 text-sm"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-destructive hover:text-destructive"
                              onClick={() => removeEgressRuleRow(index)}
                              title="Remove egress rule"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={rule.includeSubdomains !== false}
                                onChange={(e) =>
                                  updateEgressRuleRow(index, (row) => ({
                                    ...row,
                                    includeSubdomains: e.target.checked,
                                  }))
                                }
                                className="rounded"
                              />
                              Subdomains
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={(rule.schemes ?? ["http", "https"]).includes("http")}
                                onChange={(e) =>
                                  updateEgressRuleRow(index, (row) => ({
                                    ...row,
                                    schemes: toggleScheme(row.schemes, "http", e.target.checked),
                                  }))
                                }
                                className="rounded"
                              />
                              HTTP
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={(rule.schemes ?? ["http", "https"]).includes("https")}
                                onChange={(e) =>
                                  updateEgressRuleRow(index, (row) => ({
                                    ...row,
                                    schemes: toggleScheme(row.schemes, "https", e.target.checked),
                                  }))
                                }
                                className="rounded"
                              />
                              HTTPS
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={rule.allowPost === true}
                                onChange={(e) =>
                                  updateEgressRuleRow(index, (row) => ({
                                    ...row,
                                    allowPost: e.target.checked,
                                  }))
                                }
                                className="rounded"
                              />
                              Allow POST / submit
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={rule.allowUpload === true}
                                onChange={(e) =>
                                  updateEgressRuleRow(index, (row) => ({
                                    ...row,
                                    allowUpload: e.target.checked,
                                  }))
                                }
                                className="rounded"
                              />
                              Allow upload
                            </label>
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Additional upload collections for this domain (optional, comma-separated)
                            </label>
                            <Input
                              value={(rule.uploadCollections ?? []).join(", ")}
                              onChange={(e) =>
                                updateEgressRuleRow(index, (row) => ({
                                  ...row,
                                  uploadCollections: parseCollectionList(e.target.value),
                                }))
                              }
                              placeholder="uploads, invoices"
                              className="h-8 text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                              Adds to the global allowed upload collections list for this domain (does not replace it).
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Save / Cancel — always visible outside tabs */}
            <div className="flex gap-2 pt-3">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSaveConfig}
                disabled={configMut.isPending || policyMut.isPending || policyResetMut.isPending}
              >
                {configMut.isPending || policyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setEditing(false)
                  setActiveTab("browser")
                  setHeadless(status?.headless ?? false)
                  setCdpEndpoint(status?.cdpEndpoint ?? "")
                  syncPolicyDraft()
                }}
              >
                Cancel
              </Button>
            </div>
          </Tabs>
        )}

      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Calendar Card
// ---------------------------------------------------------------------------

function CalendarCard({
  status,
}: {
  status: CalendarStatus | undefined
}) {
  const authMut = useCalendarAuthorize()
  const syncMut = useCalendarSync()
  const configMut = useCalendarConfig()
  const disconnectMut = useCalendarDisconnect()
  const calListMut = useCalendarList()

  const [availableCalendars, setAvailableCalendars] = useState<CalendarListEntry[]>([])
  const [selectedCalendars, setSelectedCalendars] = useState<{ id: string; name: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [loadedList, setLoadedList] = useState(false)
  const [calPollEnabled, setCalPollEnabled] = useState(false)
  const [calPollInterval, setCalPollInterval] = useState(15)

  useEffect(() => {
    if (status?.status === "connected" || status?.status === "auth_error") {
      setSelectedCalendars(status.calendars ?? [])
      setCalPollEnabled(status.pollEnabled ?? false)
      setCalPollInterval(status.pollIntervalMinutes ?? 15)
    }
  }, [status])

  const handleConnect = async () => {
    try {
      const { authUrl } = await authMut.mutateAsync()
      openOAuthWindow(authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start authorization")
    }
  }

  const handleLoadCalendars = async () => {
    try {
      const { calendars } = await calListMut.mutateAsync()
      setAvailableCalendars(calendars)
      setLoadedList(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load calendars")
    }
  }

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync()
      if (result.errors.length > 0) {
        toast.warning(`Synced ${result.imported} events, ${result.errors.length} error(s): ${result.errors[0]}`)
      } else {
        toast.success(`Synced ${result.imported} events (${result.skipped} unchanged)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    }
  }

  const handleSaveConfig = async () => {
    if (selectedCalendars.length === 0) {
      toast.error("Select at least one calendar")
      return
    }
    try {
      await configMut.mutateAsync({ calendars: selectedCalendars, pollEnabled: calPollEnabled, pollIntervalMinutes: calPollInterval })
      toast.success("Calendar settings saved")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleDisconnect = () => setConfirmDisconnect(true)

  const confirmDisconnectAction = async () => {
    try {
      await disconnectMut.mutateAsync()
      toast.success("Google Calendar disconnected")
      setConfirmDisconnect(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    }
  }

  const toggleCalendar = (cal: CalendarListEntry) => {
    setSelectedCalendars((prev) => {
      const exists = prev.find((c) => c.id === cal.id)
      if (exists) return prev.filter((c) => c.id !== cal.id)
      return [...prev, { id: cal.id, name: cal.name }]
    })
  }

  const s = status?.status ?? "missing_credentials"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Google Calendar
          {s === "connected" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Connected
            </Badge>
          )}
          {s === "not_connected" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not connected
            </Badge>
          )}
          {s === "missing_credentials" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Config missing
            </Badge>
          )}
          {s === "auth_error" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Auth error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "missing_credentials" && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Google OAuth client not configured
              </p>
              <p className="text-muted-foreground mt-1">
                Configure the shared Google OAuth client in Vault setup before connecting
                Calendar.
              </p>
            </div>
          </div>
        )}

        {s === "not_connected" && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect Google Calendar to sync events and allow your agent to create, update, and delete events.
            </p>
            <Button
              className="gap-1.5"
              onClick={handleConnect}
              disabled={authMut.isPending}
            >
              {authMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Connect Google Calendar
            </Button>
          </>
        )}

        {s === "auth_error" && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Google Calendar needs to be reconnected
                </p>
                <p className="text-muted-foreground mt-1">
                  {status?.authErrorMessage || "Google rejected the stored Calendar authorization. Auto-sync has been paused until you reconnect Google Calendar."}
                </p>
                {status?.authErrorAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Detected on {new Date(status.authErrorAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {status?.email && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-mono text-xs">{status.email}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="gap-1.5"
                onClick={handleConnect}
                disabled={authMut.isPending}
              >
                {authMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Reconnect Google Calendar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {s === "connected" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono text-xs">{status?.email}</span>
                </div>
              </div>
              {status?.documentCount != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Synced events</span>
                  <span>{status.documentCount}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
              {status?.pollEnabled && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Auto-sync</span>
                  <div className="flex items-center gap-1.5">
                    {status.polling ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs">Every {status.pollIntervalMinutes}m</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
                    )}
                  </div>
                </div>
              )}
              {(status?.calendars?.length ?? 0) > 0 && !editing && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Calendars</span>
                  <span className="text-xs">
                    {status?.calendars?.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
            </div>

            {editing && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">Select calendars to sync</label>
                    {!loadedList && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleLoadCalendars}
                        disabled={calListMut.isPending}
                      >
                        {calListMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Load Calendars
                      </Button>
                    )}
                  </div>
                  {loadedList && availableCalendars.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {availableCalendars.map((cal) => {
                        const isSelected = selectedCalendars.some((c) => c.id === cal.id)
                        return (
                          <button
                            key={cal.id}
                            className={cn(
                              "w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded",
                              isSelected
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted",
                            )}
                            onClick={() => toggleCalendar(cal)}
                          >
                            <div
                              className={cn(
                                "h-3 w-3 rounded-sm border flex items-center justify-center",
                                isSelected
                                  ? "bg-primary border-primary"
                                  : "border-muted-foreground/30",
                              )}
                            >
                              {isSelected && <Check className="h-2 w-2 text-primary-foreground" />}
                            </div>
                            <span className="truncate">{cal.name}</span>
                            {cal.primary && (
                              <Badge variant="secondary" className="text-[9px] ml-auto">
                                Primary
                              </Badge>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="calPollEnabled"
                    checked={calPollEnabled}
                    onChange={(e) => setCalPollEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="calPollEnabled" className="text-sm">
                    Auto-sync
                  </label>
                </div>

                {calPollEnabled && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Poll interval
                    </label>
                    <Select
                      value={String(calPollInterval)}
                      onValueChange={(v) => setCalPollInterval(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-sm w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleSaveConfig} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSync}
                disabled={syncMut.isPending || (status?.calendars?.length ?? 0) === 0}
              >
                {syncMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync Now
              </Button>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setEditing(true)
                    if (!loadedList) handleLoadCalendars()
                  }}
                >
                  Settings
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Calendar"
        description="Disconnect Google Calendar? You'll need to re-authenticate to use it again."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={disconnectMut.isPending}
        onConfirm={() => void confirmDisconnectAction()}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Contacts Card
// ---------------------------------------------------------------------------

function ContactsCard({
  status,
}: {
  status: ContactsStatus | undefined
}) {
  const authMut = useContactsAuthorize()
  const syncMut = useContactsSync()
  const configMut = useContactsConfig()
  const disconnectMut = useContactsDisconnect()

  const [ctcPollEnabled, setCtcPollEnabled] = useState(false)
  const [ctcPollInterval, setCtcPollInterval] = useState(60)
  const [editing, setEditing] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  useEffect(() => {
    if (status?.status === "connected" || status?.status === "auth_error") {
      setCtcPollEnabled(status.pollEnabled ?? false)
      setCtcPollInterval(status.pollIntervalMinutes ?? 60)
    }
  }, [status])

  const handleSaveConfig = async () => {
    try {
      await configMut.mutateAsync({ pollEnabled: ctcPollEnabled, pollIntervalMinutes: ctcPollInterval })
      toast.success("Contacts settings saved")
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const handleConnect = async () => {
    try {
      const { authUrl } = await authMut.mutateAsync()
      openOAuthWindow(authUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start authorization")
    }
  }

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync()
      if (result.errors.length > 0) {
        toast.warning(`Imported ${result.imported}, ${result.errors.length} errors`)
      } else {
        toast.success(`Synced ${result.imported} contacts (${result.skipped} unchanged)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    }
  }

  const handleDisconnect = () => setConfirmDisconnect(true)

  const confirmDisconnectAction = async () => {
    try {
      await disconnectMut.mutateAsync()
      toast.success("Google Contacts disconnected")
      setConfirmDisconnect(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    }
  }

  const s = status?.status ?? "missing_credentials"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4" />
          Google Contacts
          {s === "connected" && (
            <Badge variant="outline" className={cn("ml-auto text-[10px]", statusBadgeClass("active"))}>
              Connected
            </Badge>
          )}
          {s === "not_connected" && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Not connected
            </Badge>
          )}
          {s === "missing_credentials" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Config missing
            </Badge>
          )}
          {s === "auth_error" && (
            <Badge variant="destructive" className="ml-auto text-[10px]">
              Auth error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {s === "missing_credentials" && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Google OAuth client not configured
              </p>
              <p className="text-muted-foreground mt-1">
                Configure the shared Google OAuth client in Vault setup before connecting
                Contacts.
              </p>
            </div>
          </div>
        )}

        {s === "not_connected" && (
          <>
            <p className="text-sm text-muted-foreground">
              Connect Google Contacts to import your contacts into the vault. Read-only — your agent can look up contact details but cannot modify them.
            </p>
            <Button
              className="gap-1.5"
              onClick={handleConnect}
              disabled={authMut.isPending}
            >
              {authMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Connect Google Contacts
            </Button>
          </>
        )}

        {s === "auth_error" && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Google Contacts needs to be reconnected
                </p>
                <p className="text-muted-foreground mt-1">
                  {status?.authErrorMessage || "Google rejected the stored Contacts authorization. Auto-sync has been paused until you reconnect Google Contacts."}
                </p>
                {status?.authErrorAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Detected on {new Date(status.authErrorAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {status?.email && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-mono text-xs">{status.email}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="gap-1.5"
                onClick={handleConnect}
                disabled={authMut.isPending}
              >
                {authMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                Reconnect Google Contacts
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {s === "connected" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Account</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono text-xs">{status?.email}</span>
                </div>
              </div>
              {status?.documentCount != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Synced contacts</span>
                  <span>{status.documentCount}</span>
                </div>
              )}
              {status?.lastSync && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last sync</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(status.lastSync).toLocaleString()}
                  </span>
                </div>
              )}
              {status?.pollEnabled && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Auto-sync</span>
                  <div className="flex items-center gap-1.5">
                    {status.polling ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs">Every {status.pollIntervalMinutes}m</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {editing && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ctcPollEnabled"
                    checked={ctcPollEnabled}
                    onChange={(e) => setCtcPollEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="ctcPollEnabled" className="text-sm">
                    Auto-sync
                  </label>
                </div>

                {ctcPollEnabled && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Poll interval
                    </label>
                    <Select
                      value={String(ctcPollInterval)}
                      onValueChange={(v) => setCtcPollInterval(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-sm w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                        <SelectItem value="120">2 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleSaveConfig} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditing(false)
                      setCtcPollEnabled(status?.pollEnabled ?? false)
                      setCtcPollInterval(status?.pollIntervalMinutes ?? 60)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSync}
                disabled={syncMut.isPending}
              >
                {syncMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync Now
              </Button>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEditing(true)}
                >
                  Settings
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive ml-auto"
                onClick={handleDisconnect}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Contacts"
        description="Disconnect Google Contacts? You'll need to re-authenticate to use it again."
        confirmLabel="Disconnect"
        variant="destructive"
        isPending={disconnectMut.isPending}
        onConfirm={() => void confirmDisconnectAction()}
      />
    </Card>
  )
}
