import { Outlet } from "react-router"
import { Search } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { Toaster } from "@/components/ui/sonner"
import { CommandPalette } from "@/components/shared/command-palette"
import { useUIStore } from "@/stores/ui-store"

export function RootLayout() {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 h-8 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="pointer-events-none text-[10px] font-medium text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </button>
        </header>
        <div className="flex-1">
          <Outlet />
        </div>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
      <CommandPalette />
    </SidebarProvider>
  )
}
