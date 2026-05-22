import { NavLink, useLocation } from "react-router"
import {
  LayoutDashboard,
  Database,
  Search,
  Terminal,
  Globe,
  Plug,
  MessageCircle,
  Bot,
  KeyRound,
  Cpu,
  Package,
  Shield,
  ShieldCheck,
  HeartPulse,
  Settings,
  BarChart3,
  Rocket,
  RefreshCw,
  ListTodo,
  GitBranch,
  Beaker,
  Workflow,
  LockKeyhole,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { StrajaLogoAnimated } from "@/components/shared/straja-logo-animated"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { ConnectionStatus } from "@/components/shared/connection-status"
import { useOnboardingProgress } from "@/pages/onboarding"
import { useVaultHealth } from "@/hooks/use-vault-status"
import { useLockVaultEncryption } from "@/hooks/use-vault-encryption"
import { toast } from "sonner"

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  end?: boolean
  badge?: React.ReactNode
  labelBadge?: React.ReactNode
}

function OnboardingBadge() {
  const { completedCount, totalSteps, dismissed } = useOnboardingProgress()
  const remaining = totalSteps - completedCount
  if (dismissed || remaining === 0) return null
  return (
    <SidebarMenuBadge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25">
      {remaining}
    </SidebarMenuBadge>
  )
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/onboarding", icon: Rocket, label: "Onboarding", badge: <OnboardingBadge /> },
      { to: "/home", icon: LayoutDashboard, label: "Workspace" },
    ],
  },
  {
    label: "Work",
    items: [
      { to: "/tasks", icon: ListTodo, label: "Tasks" },
      { to: "/flows", icon: GitBranch, label: "Flows" },
      {
        to: "/evals",
        icon: Beaker,
        label: "Evals",
        labelBadge: (
          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Beta
          </span>
        ),
      },
      { to: "/orchestration", icon: Workflow, label: "Orchestration" },
    ],
  },
  {
    label: "Vault",
    items: [
      { to: "/search", icon: Search, label: "Search" },
      { to: "/collections", icon: Database, label: "Collections" },
      { to: "/artifacts", icon: Package, label: "Artifacts" },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/exec", icon: Terminal, label: "Execute" },
      { to: "/browser", icon: Globe, label: "Web" },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/connections", icon: Plug, label: "Connections" },
      { to: "/agents", icon: Bot, label: "Agents" },
      { to: "/providers", icon: KeyRound, label: "Providers" },
      { to: "/channels", icon: MessageCircle, label: "Channels" },
      { to: "/models", icon: Cpu, label: "Models" },
      { to: "/guard", icon: Shield, label: "Guard" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/usage", icon: BarChart3, label: "Usage" },
      { to: "/health", icon: HeartPulse, label: "Health" },
      { to: "/audit", icon: ShieldCheck, label: "Audit" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
]

export function AppSidebar() {
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const { data: health } = useVaultHealth()
  const lockEncryptionMut = useLockVaultEncryption()

  const isActive = (to: string, end?: boolean) => {
    if (end) return location.pathname === to
    return location.pathname === to || location.pathname.startsWith(to + "/")
  }

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  const handleRefresh = () => {
    if (typeof window !== "undefined") {
      window.location.reload()
    }
  }

  const canLockVault = health?.encryption?.initialized && health.encryption.unlocked

  return (
    <Sidebar collapsible="icon">
      {/* Header: Logo + Search */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2">
              <SidebarMenuButton size="lg" asChild className="min-w-0 flex-1 !gap-0">
                <NavLink to="/" onClick={handleNavClick}>
                  <div className="flex items-center justify-center" style={{ width: 24, height: 24, flexShrink: 0 }}>
                    <StrajaLogoAnimated className="h-6 w-6" />
                  </div>
                  <span className="group-data-[collapsible=icon]:hidden" style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 16, letterSpacing: '0.02em' }}>straja</span>
                  <span className="group-data-[collapsible=icon]:hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400, fontSize: 14, opacity: 0.5, marginLeft: 4 }}>workspace</span>
                </NavLink>
              </SidebarMenuButton>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 group-data-[collapsible=icon]:hidden"
                onClick={handleRefresh}
                title="Refresh workspace"
                aria-label="Refresh workspace"
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>

      </SidebarHeader>

      {/* Navigation Groups */}
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.to, item.end)}
                    tooltip={item.label}
                  >
                    <NavLink to={item.to} onClick={handleNavClick}>
                      <item.icon className="size-4" />
                      <span className="flex items-center gap-2">
                        <span>{item.label}</span>
                        {item.labelBadge}
                      </span>
                    </NavLink>
                  </SidebarMenuButton>
                  {item.badge}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Footer: Vault actions + connection */}
      <SidebarFooter>
        <SidebarMenu>
          {canLockVault ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Lock Workspace"
                onClick={async () => {
                  try {
                    await lockEncryptionMut.mutateAsync()
                    window.location.reload()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to lock workspace")
                  }
                }}
                disabled={lockEncryptionMut.isPending}
              >
                {lockEncryptionMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LockKeyhole className="size-4" />
                )}
                <span>{lockEncryptionMut.isPending ? "Locking..." : "Lock Workspace"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Connection status" className="cursor-default">
              <div>
                <ConnectionStatus />
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
