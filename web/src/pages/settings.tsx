import {
  Wifi,
  CheckCircle2,
  XCircle,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Monitor,
  Moon,
  Sun,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { useVaultStatus, useVaultHealth } from "@/hooks/use-vault-status"
import { useLockVaultEncryption } from "@/hooks/use-vault-encryption"
import { useUIStore } from "@/stores/ui-store"
import { statusBadgeClass } from "@/lib/utils"
import { toast } from "sonner"

export function SettingsPage() {
  const { theme, setTheme } = useUIStore()
  const { data: status } = useVaultStatus()
  const { data: health } = useVaultHealth()
  const lockEncryptionMut = useLockVaultEncryption()

  const encryption = health?.encryption

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Manage appearance, security, and connection."
      />

      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Appearance</h2>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Theme
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose how the workspace looks on this device.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setTheme("light")}
              >
                <Sun className="h-3.5 w-3.5" />
                Light
              </Button>
              <Button
                type="button"
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setTheme("dark")}
              >
                <Moon className="h-3.5 w-3.5" />
                Dark
              </Button>
              <Button
                type="button"
                variant={theme === "system" ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setTheme("system")}
              >
                <Monitor className="h-3.5 w-3.5" />
                System
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Connection */}
      <section className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Connection</h2>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              Vault Daemon
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                {health ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span>Disconnected</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Address</span>
              <span className="font-mono text-xs">localhost:8181</span>
            </div>
            {health && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uptime</span>
                <span>
                  {Math.floor(health.uptime / 3600)}h{" "}
                  {Math.floor((health.uptime % 3600) / 60)}m
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Vector Index</span>
              <Badge
                variant="outline"
                className={`text-[10px] ${status?.hasVectorIndex ? statusBadgeClass("active") : ""}`}
              >
                {status?.hasVectorIndex ? "Active" : "Not built"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Encryption</h2>
          {encryption?.initialized && encryption.unlocked ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={lockEncryptionMut.isPending}
              onClick={async () => {
                try {
                  await lockEncryptionMut.mutateAsync()
                  window.location.reload()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to lock workspace")
                }
              }}
            >
              {lockEncryptionMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LockKeyhole className="h-3.5 w-3.5" />
              )}
              {lockEncryptionMut.isPending ? "Locking..." : "Lock Workspace"}
            </Button>
          ) : null}
        </div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Vault Encryption
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!encryption ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Encryption</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${encryption.initialized ? statusBadgeClass("active") : ""}`}
                  >
                    {encryption.initialized ? "Initialized" : "Not initialized"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Storage</span>
                  <span>{encryption.storage === "sqlcipher-keychain" ? "SQLCipher + Keychain" : "Not configured"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Vault state</span>
                  <div className="flex items-center gap-1.5">
                    {encryption.unlocked ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>Unlocked</span>
                      </>
                    ) : (
                      <>
                        <LockKeyhole className="h-4 w-4 text-amber-500" />
                        <span>Locked</span>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The Vault database stays encrypted on disk with SQLCipher. When Vault is locked,
                  the database is unmounted; entering the 6-digit PIN unlocks it on this machine
                  and remounts the database.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  )
}
