import { useCallback, useState } from "react"
import { useNavigate } from "react-router"
import {
  Download,
  KeyRound,
  MessageSquare,
  Plug,
  Database,
  Globe,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Rocket,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/shared/empty-state"
import { StrajaLogoAnimated } from "@/components/shared/straja-logo-animated"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { statusBadgeClass } from "@/lib/utils"
import { useModelsStatus, usePullModels } from "@/hooks/use-models"
import { useAgentsStatus, useAgentChannels } from "@/hooks/use-agents"
import { useGmailStatus } from "@/hooks/use-gmail"
import { useDriveStatus } from "@/hooks/use-gdrive"
import { useCalendarStatus } from "@/hooks/use-gcalendar"
import { useContactsStatus } from "@/hooks/use-gcontacts"
import { useVaultStatus } from "@/hooks/use-vault-status"
import { useBrowserStatus } from "@/hooks/use-browser"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/* ── Step definitions ── */

interface StepDef {
  id: string
  stepNumber: number
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  navigateTo: string
  ctaLabel: string
}

interface StepStatus extends StepDef {
  completed: boolean
  inProgress?: boolean
}

const STEPS: StepDef[] = [
  {
    id: "download-models",
    stepNumber: 1,
    title: "Download Models",
    description:
      "Download the embedding, reranking, and generation models needed for search and AI features.",
    icon: Download,
    navigateTo: "/models",
    ctaLabel: "Go to Models",
  },
  {
    id: "add-agent",
    stepNumber: 2,
    title: "Create Agents",
    description:
      "Create your starter team so Straja has agents ready to handle tasks on your behalf.",
    icon: Rocket,
    navigateTo: "/agents",
    ctaLabel: "Go to Agents",
  },
  {
    id: "auth-agent",
    stepNumber: 3,
    title: "Authenticate Agent",
    description:
      "Configure upstream API credentials (Anthropic or OpenAI) so your agent can think.",
    icon: KeyRound,
    navigateTo: "/providers",
    ctaLabel: "Go to Providers",
  },
  {
    id: "setup-channels",
    stepNumber: 4,
    title: "Set Up Channels",
    description:
      "Connect WhatsApp or Telegram so you can interact with your agent via messaging.",
    icon: MessageSquare,
    navigateTo: "/channels",
    ctaLabel: "Go to Channels",
  },
  {
    id: "add-connections",
    stepNumber: 5,
    title: "Add Connections",
    description:
      "Connect Gmail, Google Drive, Calendar, or Contacts to import and sync your data.",
    icon: Plug,
    navigateTo: "/connections",
    ctaLabel: "Go to Connections",
  },
  {
    id: "import-collections",
    stepNumber: 6,
    title: "Import Collections",
    description:
      "Create your first document collection from local files or Google Drive.",
    icon: Database,
    navigateTo: "/collections",
    ctaLabel: "Go to Collections",
  },
  {
    id: "configure-browser",
    stepNumber: 7,
    title: "Configure Web Browsing",
    description:
      "Set up browser capabilities and domain policies so your agent can browse the web securely.",
    icon: Globe,
    navigateTo: "/browser",
    ctaLabel: "Go to Web Settings",
  },
]

/* ── Onboarding progress hook (exported for sidebar badge) ── */

export function useOnboardingProgress() {
  const { data: models, isLoading: modelsLoading } = useModelsStatus()
  const { data: agents, isLoading: agentsLoading } = useAgentsStatus()
  const { data: gmail, isLoading: gmailLoading } = useGmailStatus()
  const { data: drive, isLoading: driveLoading } = useDriveStatus()
  const { data: calendar, isLoading: calendarLoading } = useCalendarStatus()
  const { data: contacts, isLoading: contactsLoading } = useContactsStatus()
  const { data: vaultStatus, isLoading: vaultLoading } = useVaultStatus()
  const { data: browserStatus, isLoading: browserLoading } = useBrowserStatus()

  const firstAgentId = agents?.agents?.[0]?.id ?? ""
  const { data: channels, isLoading: channelsLoading } = useAgentChannels(firstAgentId)

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("straja-onboarding-dismissed") === "true"
    } catch {
      return false
    }
  })

  const dismiss = useCallback(() => {
    localStorage.setItem("straja-onboarding-dismissed", "true")
    setDismissed(true)
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem("straja-onboarding-dismissed")
    setDismissed(false)
  }, [])

  const isLoading =
    modelsLoading ||
    agentsLoading ||
    gmailLoading ||
    driveLoading ||
    calendarLoading ||
    contactsLoading ||
    vaultLoading ||
    browserLoading ||
    channelsLoading

  const agentList = agents?.agents ?? []

  const steps: StepStatus[] = [
    {
      ...STEPS[0],
      completed: !!models?.downloaded,
      inProgress: !!models?.pulling && !models?.downloaded,
    },
    {
      ...STEPS[1],
      completed: agentList.length > 0,
    },
    {
      ...STEPS[2],
      completed: agentList.some(
        (a) =>
          a.upstreamAuth?.anthropic?.configured ||
          a.upstreamAuth?.openai?.configured,
      ),
    },
    {
      ...STEPS[3],
      completed: !!(
        channels?.whatsapp?.status === "connected" ||
        channels?.telegram?.status === "connected"
      ),
    },
    {
      ...STEPS[4],
      completed: [gmail, drive, calendar, contacts].some(
        (s) => s?.status === "connected",
      ),
    },
    {
      ...STEPS[5],
      completed: (vaultStatus?.collections?.filter((c) => c.type === "user" && c.documents > 0)?.length ?? 0) > 0,
    },
    {
      ...STEPS[6],
      completed: !!browserStatus && browserStatus.status !== "not_configured",
    },
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const totalSteps = steps.length
  const allComplete = completedCount === totalSteps

  return {
    steps,
    completedCount,
    totalSteps,
    allComplete,
    isLoading,
    dismissed,
    dismiss,
    reset,
  }
}

/* ── Page component ── */

export function OnboardingPage() {
  const navigate = useNavigate()
  const {
    steps,
    completedCount,
    totalSteps,
    allComplete,
    dismissed,
    dismiss,
    reset,
  } = useOnboardingProgress()
  const pullMut = usePullModels()
  const progressPercent = Math.round((completedCount / totalSteps) * 100)

  if (dismissed) {
    return (
      <PageShell>
        <EmptyState
          icon={<Rocket className="h-10 w-10" />}
          title="Onboarding dismissed"
          description="You've dismissed the setup checklist. Click below to show it again."
          action={
            <Button variant="outline" onClick={reset} className="gap-1.5">
              Show Onboarding
            </Button>
          }
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="Get Started"
        description="Complete these steps to set up your Straja Workspace."
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={dismiss}
          >
            Dismiss
          </Button>
        }
      />

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {completedCount} of {totalSteps} completed
          </span>
          <span className="text-xs text-muted-foreground">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Celebration when all complete */}
      {allComplete && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex items-center gap-4 p-6">
            <StrajaLogoAnimated animate className="h-12 w-12 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                All set! Your workspace is fully configured.
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                You're ready to search, chat with your agent, and manage your
                documents.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step list */}
      <div className="space-y-3">
        {steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            onNavigate={() => navigate(step.navigateTo)}
            pullMut={step.id === "download-models" ? pullMut : undefined}
          />
        ))}
      </div>
    </PageShell>
  )
}

/* ── Step card ── */

function StepCard({
  step,
  onNavigate,
  pullMut,
}: {
  step: StepStatus
  onNavigate: () => void
  pullMut?: ReturnType<typeof usePullModels>
}) {
  const Icon = step.icon
  const downloadInProgress = step.id === "download-models" && !step.completed && !!(step.inProgress || pullMut?.isPending)

  return (
    <Card className={cn("transition-colors", step.completed && "opacity-70")}>
      <CardContent className="flex items-center gap-4 p-4">
        {/* Step number or checkmark */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            step.completed
              ? statusBadgeClass("completed")
              : "bg-muted text-muted-foreground",
          )}
        >
          {step.completed ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            step.stepNumber
          )}
        </div>

        {/* Icon + text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold">{step.title}</span>
            {step.completed && (
              <Badge
                variant="secondary"
                className={`text-[10px] h-4 px-1.5 border-0 ${statusBadgeClass("completed")}`}
              >
                Done
              </Badge>
            )}
            {!step.completed && step.inProgress && (
              <Badge
                variant="secondary"
                className={`text-[10px] h-4 px-1.5 border-0 ${statusBadgeClass("warning")}`}
              >
                In progress
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {step.description}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Inline download button for step 1 */}
          {step.id === "download-models" && !step.completed && pullMut && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  await pullMut.mutateAsync(false)
                  toast.success("Models downloaded successfully")
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Download failed",
                  )
                }
              }}
              disabled={downloadInProgress}
            >
              {downloadInProgress ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {downloadInProgress ? "Downloading..." : "Download"}
            </Button>
          )}

          {/* Navigate CTA */}
          {!step.completed && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-7 text-xs"
              onClick={onNavigate}
            >
              {step.ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
