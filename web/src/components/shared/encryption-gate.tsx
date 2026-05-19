import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2, LockKeyhole, RefreshCw, Shield, Sparkles } from "lucide-react"
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
  initializeEncryption,
  unlockEncryption,
  VaultUnavailableError,
} from "@/lib/api"

type GateState = "checking" | "setup" | "locked" | "ready" | "unavailable"

function normalizePinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Failed to read Workspace encryption status"
}

function PinCodeInput({
  id,
  value,
  disabled,
  autoFocus,
  invalid,
  onChange,
}: {
  id: string
  value: string
  disabled?: boolean
  autoFocus?: boolean
  invalid?: boolean
  onChange: (nextValue: string) => void
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "")

  useEffect(() => {
    if (!autoFocus || disabled) {
      return
    }
    const targetIndex = Math.min(value.length, 5)
    inputRefs.current[targetIndex]?.focus()
  }, [autoFocus, disabled, value])

  function focusIndex(index: number) {
    const clampedIndex = Math.max(0, Math.min(5, index))
    inputRefs.current[clampedIndex]?.focus()
    inputRefs.current[clampedIndex]?.select()
  }

  function updateAt(index: number, nextDigit: string) {
    const nextDigits = digits.slice()
    nextDigits[index] = nextDigit
    onChange(nextDigits.join(""))
  }

  function handleDigitChange(index: number, rawValue: string) {
    const normalized = rawValue.replace(/\D/g, "")
    if (!normalized) {
      updateAt(index, "")
      return
    }

    const nextDigits = digits.slice()
    const incomingDigits = normalized.slice(0, 6 - index).split("")
    incomingDigits.forEach((digit, offset) => {
      nextDigits[index + offset] = digit
    })
    onChange(nextDigits.join(""))
    focusIndex(index + incomingDigits.length)
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault()
      if (digits[index]) {
        updateAt(index, "")
        return
      }
      updateAt(Math.max(0, index - 1), "")
      focusIndex(index - 1)
      return
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusIndex(index - 1)
      return
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusIndex(index + 1)
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (!pasted) {
      return
    }
    onChange(pasted)
    focusIndex(pasted.length)
  }

  return (
    <div className="grid w-full grid-cols-6 gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <Input
          key={`${id}-${index}`}
          ref={(node) => {
            inputRefs.current[index] = node
          }}
          id={index === 0 ? id : undefined}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "current-password" : "one-time-code"}
          maxLength={6}
          value={digit}
          aria-invalid={invalid ? "true" : undefined}
          disabled={disabled}
          className="h-14 min-w-0 w-full px-0 text-center text-2xl tabular-nums"
          onChange={(event) => handleDigitChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.currentTarget.select()}
          onPaste={handlePaste}
        />
      ))}
    </div>
  )
}

export function VaultEncryptionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking")
  const [pinInput, setPinInput] = useState("")
  const [confirmPinInput, setConfirmPinInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [setupStep, setSetupStep] = useState<"choose" | "confirm">("choose")

  async function bootstrap(): Promise<void> {
    setState("checking")
    setError(null)

    try {
      const health = await getHealth()
      const encryption = health.encryption
      if (!encryption?.initialized) {
        setState("setup")
        return
      }
      if (encryption.unlocked) {
        setState("ready")
        return
      }
      setState("locked")
    } catch (err) {
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

  async function performSetupSubmit(): Promise<void> {
    if (pinInput.length !== 6) {
      setError("Enter a 6-digit PIN.")
      setSetupStep("choose")
      return
    }
    if (confirmPinInput.length !== 6) {
      setError("Confirm the 6-digit PIN.")
      return
    }
    if (pinInput !== confirmPinInput) {
      setError("PINs don't match. Try again.")
      setConfirmPinInput("")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await initializeEncryption(pinInput)
      setPinInput("")
      setConfirmPinInput("")
      setSetupStep("choose")
      setState("ready")
    } catch (err) {
      if (err instanceof VaultUnavailableError) {
        setState("unavailable")
        setError(err.message)
      } else {
        setState("setup")
        setError(getErrorMessage(err))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await performSetupSubmit()
  }

  // Auto-advance from "choose" to "confirm" once the first PIN is fully entered
  useEffect(() => {
    if (state !== "setup" || setupStep !== "choose") {
      return
    }
    if (pinInput.length !== 6) {
      return
    }
    const timer = setTimeout(() => {
      setSetupStep("confirm")
      setError(null)
    }, 200)
    return () => clearTimeout(timer)
  }, [state, setupStep, pinInput])

  // Auto-submit when the confirm PIN reaches 6 digits
  useEffect(() => {
    if (state !== "setup" || setupStep !== "confirm") {
      return
    }
    if (confirmPinInput.length !== 6 || isSubmitting) {
      return
    }
    void performSetupSubmit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, setupStep, confirmPinInput, isSubmitting])

  async function submitUnlockPin(pin: string): Promise<void> {
    if (pin.length !== 6) {
      setError("Enter the 6-digit PIN.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await unlockEncryption(pin)
      setPinInput("")
      setState("ready")
    } catch (err) {
      if (err instanceof VaultUnavailableError) {
        setState("unavailable")
        setError(err.message)
      } else {
        setState("locked")
        setError(getErrorMessage(err))
        setPinInput("")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await submitUnlockPin(pinInput)
  }

  useEffect(() => {
    if (state !== "locked" || isSubmitting || pinInput.length !== 6) {
      return
    }
    void submitUnlockPin(pinInput)
  }, [isSubmitting, pinInput, state])

  if (state === "ready") {
    return <>{children}</>
  }

  const isChecking = state === "checking"
  const isUnavailable = state === "unavailable"
  const isSetup = state === "setup"

  if (isSetup) {
    const isChooseStep = setupStep === "choose"
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <Card className="w-full max-w-md overflow-hidden">
          {isSubmitting && (
            <div className="h-1 w-full bg-primary/10">
              <div className="h-full w-1/3 rounded-full bg-primary/40 animate-[indeterminate-progress_1.5s_ease-in-out_infinite]" />
            </div>
          )}
          <CardHeader className="gap-1 pb-2 pt-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted/60">
              <StrajaLogoAnimated animate={isSubmitting} className="h-9 w-9" />
            </div>
            <CardTitle className="text-2xl">
              {isChooseStep ? "Welcome to Straja" : "Confirm your PIN"}
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground/90">
              {isChooseStep
                ? "Your private, AI-powered workspace"
                : "Enter the same PIN once more to make sure it's remembered."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2">
              <span
                className={`h-1.5 w-8 rounded-full transition-colors ${
                  isChooseStep ? "bg-primary" : "bg-primary/40"
                }`}
              />
              <span
                className={`h-1.5 w-8 rounded-full transition-colors ${
                  isChooseStep ? "bg-muted" : "bg-primary"
                }`}
              />
            </div>

            {isChooseStep ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Your data is encrypted</p>
                    <p className="text-xs text-muted-foreground">
                      Everything is stored on your machine using bank-grade encryption. No cloud, no third parties.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <LockKeyhole className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Only you have access</p>
                    <p className="text-xs text-muted-foreground">
                      A 6-digit PIN locks your workspace. You'll use it each time you open Straja.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Ready in seconds</p>
                    <p className="text-xs text-muted-foreground">
                      Pick a PIN and you're in. You can start connecting your accounts right away.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={(event) => void handleSetup(event)}>
              {isChooseStep ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="vault-pin">
                    Choose a 6-digit PIN
                  </label>
                  <PinCodeInput
                    id="vault-pin"
                    value={pinInput}
                    onChange={(nextValue) => {
                      setError(null)
                      setPinInput(normalizePinInput(nextValue))
                    }}
                    disabled={isSubmitting}
                    autoFocus
                    invalid={Boolean(error)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll ask you to confirm it next.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="vault-pin-confirm">
                    Confirm PIN
                  </label>
                  <PinCodeInput
                    id="vault-pin-confirm"
                    value={confirmPinInput}
                    onChange={(nextValue) => {
                      setError(null)
                      setConfirmPinInput(normalizePinInput(nextValue))
                    }}
                    disabled={isSubmitting}
                    autoFocus
                    invalid={Boolean(error)}
                  />
                </div>
              )}

              {isChooseStep ? (
                <Button
                  className="w-full"
                  type="button"
                  disabled={isSubmitting || pinInput.length !== 6}
                  onClick={() => {
                    if (pinInput.length === 6) {
                      setSetupStep("confirm")
                      setError(null)
                    }
                  }}
                >
                  Continue
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    type="submit"
                    disabled={isSubmitting || confirmPinInput.length !== 6}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Setting up your workspace...
                      </>
                    ) : (
                      "Secure & Get Started"
                    )}
                  </Button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    disabled={isSubmitting}
                    onClick={() => {
                      setSetupStep("choose")
                      setConfirmPinInput("")
                      setError(null)
                    }}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Choose a different PIN
                  </button>
                </div>
              )}
            </form>

            <VaultTips active={isSubmitting} />
          </CardContent>
        </Card>
      </div>
    )
  }

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
            <div className="relative size-12 shrink-0 rounded-xl border bg-muted/60">
              {isUnavailable ? (
                <div className="flex size-full items-center justify-center">
                  <RefreshCw className="h-5 w-5 text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="flex size-full items-center justify-center">
                    <StrajaLogoAnimated
                      animate={isChecking || isSubmitting}
                      className="h-8 w-8"
                    />
                  </div>
                  {!isChecking && (
                    <div
                      className={`absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background shadow-sm transition-all duration-300 ${
                        isSubmitting
                          ? "scale-0 opacity-0"
                          : "scale-100 opacity-100"
                      }`}
                    >
                      <LockKeyhole className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <CardTitle>
                {isChecking
                  ? "Connecting to workspace"
                  : isUnavailable
                    ? "Workspace unavailable"
                    : "Welcome back"}
              </CardTitle>
              <CardDescription>
                {isChecking
                  ? "One moment while we check things out."
                  : isUnavailable
                    ? "The workspace server is not reachable right now."
                    : "Enter your 6-digit PIN to continue."}
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
            </div>
          ) : isUnavailable ? (
            <p className="text-sm text-muted-foreground">
              Make sure the workspace is running, then try again.
            </p>
          ) : (
            <form className="space-y-3" onSubmit={(event) => void handleUnlock(event)}>
              <div>
                <PinCodeInput
                  id="vault-pin"
                  value={pinInput}
                  onChange={(nextValue) => {
                    setError(null)
                    setPinInput(normalizePinInput(nextValue))
                  }}
                  disabled={isSubmitting}
                  autoFocus
                  invalid={Boolean(error)}
                />
              </div>
              <Button className="w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Unlocking workspace...
                  </>
                ) : (
                  "Unlock"
                )}
              </Button>
            </form>
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
