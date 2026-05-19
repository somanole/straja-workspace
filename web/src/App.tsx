import { BrowserRouter, Routes, Route } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/shared/theme-provider"
import { RootLayout } from "@/components/layout/root-layout"
import { DashboardPage } from "@/pages/dashboard"
import { CollectionsPage } from "@/pages/collections"
import { SearchPage } from "@/pages/search"
import { ExecPage } from "@/pages/exec"
import { SettingsPage } from "@/pages/settings"
import { ModelsPage } from "@/pages/models"
import { ConnectionsPage } from "@/pages/connections"
import { AgentsPage, ProvidersPage, ChannelsPage } from "@/pages/agents"
import { GuardPage } from "@/pages/guard"
import { BrowsePage } from "@/pages/browser"
import { ArtifactsPage } from "@/pages/artifacts"
import { TasksPage } from "@/pages/tasks"
import { FlowsPage } from "@/pages/flows"
import { EvalsPage, EvalRunPage } from "@/pages/evals"
import { AuditPage } from "@/pages/audit"
import { HealthPage } from "@/pages/health"
import { OrchestrationPage } from "@/pages/orchestration"
import { UsagePage } from "@/pages/usage"
import { OnboardingPage, useOnboardingProgress } from "@/pages/onboarding"
import { VaultHttpAuthGate } from "@/components/shared/http-auth-gate"
import { VaultEncryptionGate } from "@/components/shared/encryption-gate"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function IndexPage() {
  const { allComplete, dismissed, isLoading } = useOnboardingProgress()
  if (dismissed || (!isLoading && allComplete)) return <DashboardPage />
  return <OnboardingPage />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <VaultHttpAuthGate>
            <VaultEncryptionGate>
              <BrowserRouter>
                <Routes>
                  <Route element={<RootLayout />}>
                    <Route index element={<IndexPage />} />
                    <Route path="home" element={<DashboardPage />} />
                    <Route path="onboarding" element={<OnboardingPage />} />
                    <Route path="tasks" element={<TasksPage />} />
                    <Route path="tasks/:id" element={<TasksPage />} />
                    <Route path="flows" element={<FlowsPage />} />
                    <Route path="evals" element={<EvalsPage />} />
                    <Route path="evals/suites/:suiteId" element={<EvalsPage />} />
                    <Route path="evals/runs/:runId" element={<EvalRunPage />} />
                    <Route path="orchestration" element={<OrchestrationPage />} />
                    <Route path="orchestration/:traceId" element={<OrchestrationPage />} />
                    <Route path="usage" element={<UsagePage />} />
                    <Route path="collections" element={<CollectionsPage />} />
                    <Route path="collections/:name" element={<CollectionsPage />} />
                    <Route path="collections/:name/*" element={<CollectionsPage />} />
                    <Route path="search" element={<SearchPage />} />
                    <Route path="exec" element={<ExecPage />} />
                    <Route path="browser" element={<BrowsePage />} />
                    <Route path="connections" element={<ConnectionsPage />} />
                    <Route path="agents" element={<AgentsPage />} />
                    <Route path="providers" element={<ProvidersPage />} />
                    <Route path="channels" element={<ChannelsPage />} />
                    <Route path="guard" element={<GuardPage />} />
                    <Route path="artifacts" element={<ArtifactsPage />} />
                    <Route path="audit" element={<AuditPage />} />
                    <Route path="health" element={<HealthPage />} />
                    <Route path="models" element={<ModelsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </VaultEncryptionGate>
          </VaultHttpAuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
