import { NavLink } from "react-router"
import {
  Search,
  Database,
  Terminal,
  Settings,
  Cpu,
  LayoutDashboard,
  Plug,
  Globe,
  Moon,
  Sun,
  Monitor,
  Package,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConnectionStatus } from "@/components/shared/connection-status"
import { useUIStore } from "@/stores/ui-store"
import { cn } from "@/lib/utils"

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Workspace" },
  { to: "/collections", icon: Database, label: "Collections" },
  { to: "/search", icon: Search, label: "Search" },
  { to: "/exec", icon: Terminal, label: "Execute" },
  { to: "/browser", icon: Globe, label: "Web" },
  { to: "/connections", icon: Plug, label: "Connections" },
  { to: "/artifacts", icon: Package, label: "Artifacts" },
  { to: "/audit", icon: ShieldCheck, label: "Audit" },
  { to: "/models", icon: Cpu, label: "Models" },
  { to: "/settings", icon: Settings, label: "Settings" },
]

export function Header() {
  const { theme, setTheme, setCommandPaletteOpen } = useUIStore()

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6">
      {/* Logo */}
      <NavLink to="/" className="flex items-center mr-2" style={{ gap: 0 }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" style={{ width: 24, height: 24, flexShrink: 0 }}>
          <circle cx="12" cy="20" r="5.6" fill="#059669"/>
          <circle cx="25" cy="13" r="5.6" fill="#F97316"/>
          <circle cx="25" cy="27" r="5.6" fill="#F97316"/>
        </svg>
        <span className="hidden sm:inline" style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 16, letterSpacing: '0.02em' }}>straja</span>
        <span className="hidden sm:inline" style={{ fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400, fontSize: 14, opacity: 0.5, marginLeft: 4 }}>workspace</span>
      </NavLink>

      {/* Navigation */}
      <nav className="flex items-center gap-1">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            <span className="hidden md:inline">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Search shortcut */}
      <Button
        variant="outline"
        size="sm"
        className="hidden sm:flex items-center gap-2 text-muted-foreground w-56 justify-start"
        onClick={() => setCommandPaletteOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="text-sm">Search...</span>
        <kbd className="ml-auto pointer-events-none text-[10px] font-medium text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
          ⌘K
        </kbd>
      </Button>

      {/* Theme Toggle */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            {theme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : theme === "light" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="h-4 w-4 mr-2" /> Light
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="h-4 w-4 mr-2" /> Dark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="h-4 w-4 mr-2" /> System
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Connection Status */}
      <ConnectionStatus />
    </header>
  )
}
