import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { Loader2, LockKeyhole, RefreshCw } from "lucide-react"
import { StrajaLogoAnimated } from "@/components/shared/straja-logo-animated"
import { VaultTips } from "@/components/shared/vault-tips"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  getHealth,
  getStatus,
  VaultUnauthorizedError,
  VaultUnavailableError,
} from "@/lib/api"
import {
  clearStoredHttpAdminToken,
  getStoredHttpAdminToken,
  setStoredHttpAdminToken,
  VAULT_HTTP_UNAUTHORIZED_EVENT,
} from "@/lib/http-auth"

type GateState = "checking" | "locked" | "ready" | "unavailable"

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Failed to validate Workspace access"
}

export function VaultHttpAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking")
  const [adminRequired, setAdminRequired] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function bootstrap(): Promise<void> {
    setState("checking")
    setError(null)

    try {
      const health = await getHealth()
      const requiresAdminToken = health.httpAuth?.adminRequired === true
      setAdminRequired(requiresAdminToken)

      if (!requiresAdminToken) {
        setState("ready")
        return
      }

      const storedToken = getStoredHttpAdminToken()
      if (!storedToken) {
        setState("locked")
        return
      }

      await getStatus()
      setState("ready")
    } catch (err) {
      if (err instanceof VaultUnauthorizedError) {
        clearStoredHttpAdminToken()
        setAdminRequired(true)
        setState("locked")
        setError("Stored Workspace admin token was rejected. Enter the current token to continue.")
        return
      }
      if (err instanceof VaultUnavailableError) {
        setState("unavailable")
        setError(err.message)
        return
      }
      setState("locked")
      setError(getErrorMessage(err))
    }
  }

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    function handleUnauthorized(): void {
      if (!adminRequired) {
        return
      }
      clearStoredHttpAdminToken()
      setState("locked")
      setError("Workspace admin token was rejected. It may have been rotated.")
    }

    window.addEventListener(VAULT_HTTP_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => {
      window.removeEventListener(VAULT_HTTP_UNAUTHORIZED_EVENT, handleUnauthorized)
    }
  }, [adminRequired])

  async function handleUnlock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const token = tokenInput.trim()
    if (!token) {
      setError("Enter the Workspace admin token.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    setStoredHttpAdminToken(token)

    try {
      await getStatus()
      setTokenInput("")
      setAdminRequired(true)
      setState("ready")
    } catch (err) {
      clearStoredHttpAdminToken()
      if (err instanceof VaultUnauthorizedError) {
        setState("locked")
        setError("Token rejected. Check the value and try again.")
      } else if (err instanceof VaultUnavailableError) {
        setState("unavailable")
        setError(err.message)
      } else {
        setState("locked")
        setError(getErrorMessage(err))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (state === "ready") {
    return <>{children}</>
  }

  const isUnavailable = state === "unavailable"
  const isChecking = state === "checking"

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-md overflow-hidden">
        {(isChecking || isSubmitting) && (
          <div className="h-1 w-full bg-primary/10">
            <div className="h-full w-1/3 rounded-full bg-primary/40 animate-[indeterminate-progress_1.5s_ease-in-out_infinite]" />
          </div>
        )}
        <CardHeader className="gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/60">
              {isChecking || isSubmitting ? (
                <StrajaLogoAnimated animate className="h-7 w-7" />
              ) : isUnavailable ? (
                <RefreshCw className="h-5 w-5 text-muted-foreground" />
              ) : (
                <LockKeyhole className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <CardTitle>
                {isChecking
                  ? "Checking Workspace access"
                  : isUnavailable
                    ? "Workspace unavailable"
                    : "Unlock Workspace"}
              </CardTitle>
              <CardDescription>
                {isChecking
                  ? "Loading daemon status and HTTP auth policy."
                  : isUnavailable
                    ? "The Workspace server is not reachable right now."
                    : adminRequired
                      ? "Enter the admin bearer token to use the Workspace web UI."
                      : "Workspace access is not locked."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {isChecking ? (
            <div className="space-y-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            </div>
          ) : isUnavailable ? (
            <p className="text-sm text-muted-foreground">
              Restart the Workspace daemon, then retry this page.
            </p>
          ) : adminRequired ? (
            <form className="space-y-3" onSubmit={(event) => void handleUnlock(event)}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="vault-admin-token">
                  Admin token
                </label>
                <Input
                  id="vault-admin-token"
                  type="password"
                  autoComplete="off"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="Bearer token"
                  disabled={isSubmitting}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                The token is stored in this browser only and sent as an Authorization bearer
                header on API requests.
              </p>
              <Button className="w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying token...
                  </>
                ) : (
                  "Unlock Workspace"
                )}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unable to determine Workspace auth policy. Retry once the daemon is healthy.
            </p>
          )}

          <VaultTips active={isChecking || isSubmitting} />
        </CardContent>
        {isUnavailable && (
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" onClick={() => void bootstrap()}>
              Retry
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
