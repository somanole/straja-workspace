import { useState, useEffect } from "react"
import { Loader2, Plus, Trash2, Download, Search as SearchIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { statusBadgeClass } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { PageLoading } from "@/components/shared/page-loading"
import { useBrowserStatus } from "@/hooks/use-browser"
import { useWebFetchPolicy, useWebFetchPolicyUpdate, useWebFetchPolicyReset } from "@/hooks/use-web-fetch-policy"
import { useWebSearchPolicy, useWebSearchPolicyUpdate } from "@/hooks/use-web-search-policy"
import { BrowserCard } from "@/pages/connections"
import type { WebFetchDomainRule } from "@/lib/types"

// ---------------------------------------------------------------------------
// Web Fetch Policy Card
// ---------------------------------------------------------------------------

function WebFetchPolicyCard() {
  const policyQuery = useWebFetchPolicy()
  const policyMut = useWebFetchPolicyUpdate()
  const resetMut = useWebFetchPolicyReset()

  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [allowAllDomains, setAllowAllDomains] = useState(false)
  const [domainsDraft, setDomainsDraft] = useState<WebFetchDomainRule[]>([])

  const applyDraft = (policy?: { allowAllDomains: boolean; allowedDomains: WebFetchDomainRule[] }) => {
    setAllowAllDomains(policy?.allowAllDomains ?? false)
    setDomainsDraft(
      (policy?.allowedDomains ?? []).map((r) => ({
        domain: r.domain,
        includeSubdomains: r.includeSubdomains,
        schemes: r.schemes ? [...r.schemes] : undefined,
      }))
    )
  }

  useEffect(() => {
    if (policyQuery.data && !editing) applyDraft(policyQuery.data)
  }, [policyQuery.data, editing])

  const openEdit = () => {
    applyDraft(policyQuery.data)
    setEditing(true)
  }

  const addRow = () => {
    setDomainsDraft((prev) => [...prev, { domain: "", includeSubdomains: true }])
  }

  const updateRow = (index: number, updater: (r: WebFetchDomainRule) => WebFetchDomainRule) => {
    setDomainsDraft((prev) => prev.map((r, i) => (i === index ? updater(r) : r)))
  }

  const removeRow = (index: number) => {
    setDomainsDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    const cleaned = domainsDraft
      .map((r) => ({ ...r, domain: r.domain.trim() }))
      .filter((r) => r.domain)
    policyMut.mutate(
      { allowAllDomains, allowedDomains: cleaned },
      { onSuccess: () => setEditing(false) }
    )
  }

  const handleReset = () => setConfirmReset(true)

  const confirmResetAction = () => {
    resetMut.mutate(undefined, {
      onSuccess: () => {
        setEditing(false)
        setConfirmReset(false)
      },
    })
  }

  const policy = policyQuery.data

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Download className="h-4 w-4" />
          Domain Policy
          {policy && (
            <Badge
              variant="outline"
              className={`ml-auto text-[10px] ${
                policy.allowAllDomains
                  ? statusBadgeClass("active")
                  : ""
              }`}
            >
              {policy.allowAllDomains
                ? "All domains"
                : `${policy.allowedDomains.length} domain${policy.allowedDomains.length !== 1 ? "s" : ""}`}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compact summary */}
        {!editing && policy && (
          <div className="space-y-1">
            <div className="flex items-center gap-x-2 gap-y-0.5 text-xs flex-wrap">
              <span className="text-muted-foreground">
                {policy.allowAllDomains ? "All domains allowed" : "Allowlist only"}
              </span>
              {!policy.allowAllDomains && policy.allowedDomains.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {policy.allowedDomains.map((r) => r.includeSubdomains ? `*.${r.domain}` : r.domain).join(", ")}
                  </span>
                </>
              )}
              {!policy.allowAllDomains && policy.allowedDomains.length === 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">All fetches blocked</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Action bar */}
        {!editing && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={openEdit}
            >
              Settings
            </Button>
          </div>
        )}

        {/* Editing */}
        {editing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="wf-allow-all"
                checked={allowAllDomains}
                onChange={(e) => setAllowAllDomains(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="wf-allow-all" className="text-sm">
                Allow all domains
              </label>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Allowed domains</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={addRow}
                disabled={allowAllDomains}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add domain
              </Button>
            </div>

            {domainsDraft.length === 0 ? (
              <div className="text-xs text-muted-foreground rounded border border-dashed p-2">
                {allowAllDomains
                  ? "All domains allowed. Allowlist is ignored."
                  : "No allowed domains. All web fetches will be blocked."}
              </div>
            ) : (
              <div className="space-y-2">
                {domainsDraft.map((rule, index) => (
                  <div key={`wf-domain-${index}`} className="rounded border p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={rule.domain}
                        onChange={(e) => updateRow(index, (r) => ({ ...r, domain: e.target.value }))}
                        placeholder="example.com"
                        className="h-8 text-sm"
                        disabled={allowAllDomains}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={() => removeRow(index)}
                        disabled={allowAllDomains}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={rule.includeSubdomains !== false}
                        onChange={(e) =>
                          updateRow(index, (r) => ({ ...r, includeSubdomains: e.target.checked }))
                        }
                        className="rounded"
                        disabled={allowAllDomains}
                      />
                      Include subdomains
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={policyMut.isPending}
              >
                {policyMut.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleReset}
                disabled={resetMut.isPending}
              >
                {resetMut.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Reset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset fetch policy?"
        description="This will reset all domain rules to defaults. This cannot be undone."
        confirmLabel="Reset"
        variant="destructive"
        isPending={resetMut.isPending}
        onConfirm={confirmResetAction}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Web Search Policy Card
// ---------------------------------------------------------------------------

function WebSearchPolicyCard() {
  const policyQuery = useWebSearchPolicy()
  const policyMut = useWebSearchPolicyUpdate()
  const [editing, setEditing] = useState(false)

  const policy = policyQuery.data

  const toggleEnabled = (enabled: boolean) => {
    policyMut.mutate({ enabled })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <SearchIcon className="h-4 w-4" />
          Search
          {policy && (
            <Badge
              variant="outline"
              className={`ml-auto text-[10px] ${
                policy.enabled
                  ? statusBadgeClass("active")
                  : ""
              }`}
            >
              {policy.enabled ? "Enabled" : "Disabled"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compact summary */}
        {!editing && policy && (
          <div className="flex items-center gap-x-2 gap-y-0.5 text-xs flex-wrap">
            <span className="text-muted-foreground">
              {policy.enabled ? "Search enabled" : "Search disabled"}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">DuckDuckGo</span>
          </div>
        )}

        {/* Action bar */}
        {!editing && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing(true)}
            >
              Settings
            </Button>
          </div>
        )}

        {/* Editing */}
        {editing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ws-enabled"
                checked={policy?.enabled ?? true}
                onChange={(e) => toggleEnabled(e.target.checked)}
                className="rounded"
                disabled={policyMut.isPending}
              />
              <label htmlFor="ws-enabled" className="text-sm">
                Web search enabled
              </label>
              {policyMut.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Provider</label>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  DuckDuckGo
                </Badge>
                <span className="text-xs text-muted-foreground">Only provider available</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditing(false)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BrowsePage() {
  const { data: browser, isLoading } = useBrowserStatus()

  return (
    <PageShell>
      <PageHeader
        title="Web"
        description="Browser runtime, web fetch, and web search controls."
      />

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Browser Runtime</h2>
        <p className="text-muted-foreground text-xs -mt-2">
          Start or stop Chromium and configure navigation, egress, upload boundaries, and upload constraints.
        </p>
        {isLoading ? (
          <PageLoading variant="spinner" message="Loading browser settings..." />
        ) : (
          <BrowserCard status={browser} />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Web Fetch</h2>
        <p className="text-muted-foreground text-xs -mt-2">
          Domain allowlist for URL fetching. Domains not on the list are blocked and logged in the audit.
        </p>
        <WebFetchPolicyCard />
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Web Search</h2>
        <p className="text-muted-foreground text-xs -mt-2">
          Search provider configuration and enable/disable toggle.
        </p>
        <WebSearchPolicyCard />
      </section>
    </PageShell>
  )
}
