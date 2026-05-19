import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Search,
  Database,
  FileText,
  Terminal,
  Settings,
  Cpu,
  LayoutDashboard,
  MessageSquare,
} from "lucide-react"
import { useUIStore } from "@/stores/ui-store"
import { useVaultStatus } from "@/hooks/use-vault-status"

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore()
  const navigate = useNavigate()
  const { data: status } = useVaultStatus()
  const [query, setQuery] = useState("")

  // ⌘K keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  const close = () => {
    setCommandPaletteOpen(false)
    setQuery("")
  }

  const go = (path: string) => {
    close()
    navigate(path)
  }

  const searchQuery = () => {
    if (!query.trim()) return
    close()
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={(open) => {
        if (!open) close()
        else setCommandPaletteOpen(true)
      }}
    >
      <CommandInput
        placeholder="Search or type a command..."
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            // If no item is selected by cmdk, do a search
            const selected = document.querySelector("[cmdk-item][data-selected=true]")
            if (!selected) {
              e.preventDefault()
              searchQuery()
            }
          }
        }}
      />
      <CommandList>
        <CommandEmpty>
          {query.trim() ? (
            <button
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              onClick={searchQuery}
            >
              <Search className="h-4 w-4" />
              Search for &quot;{query}&quot;
            </button>
          ) : (
            "No results found."
          )}
        </CommandEmpty>

        {query.trim() && (
          <CommandGroup heading="Actions">
            <CommandItem onSelect={searchQuery}>
              <Search className="h-4 w-4" />
              <span>Search for &quot;{query}&quot;</span>
            </CommandItem>
            <CommandItem onSelect={() => {
              close()
              navigate(`/search?q=${encodeURIComponent(query.trim())}`)
            }}>
              <MessageSquare className="h-4 w-4" />
              <span>Ask about &quot;{query}&quot;</span>
            </CommandItem>
          </CommandGroup>
        )}

        {!query.trim() && (
          <>
            <CommandGroup heading="Navigation">
              <CommandItem onSelect={() => go("/")}>
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
              </CommandItem>
              <CommandItem onSelect={() => go("/collections")}>
                <Database className="h-4 w-4" />
                <span>Collections</span>
              </CommandItem>
              <CommandItem onSelect={() => go("/search")}>
                <Search className="h-4 w-4" />
                <span>Search</span>
              </CommandItem>
              <CommandItem onSelect={() => go("/exec")}>
                <Terminal className="h-4 w-4" />
                <span>Execute</span>
              </CommandItem>
              <CommandItem onSelect={() => go("/models")}>
                <Cpu className="h-4 w-4" />
                <span>Models</span>
              </CommandItem>
              <CommandItem onSelect={() => go("/settings")}>
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </CommandItem>
            </CommandGroup>

            {status?.collections && status.collections.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Collections">
                  {status.collections.map((c) => (
                    <CommandItem
                      key={c.name}
                      onSelect={() => go(`/collections/${c.name}`)}
                    >
                      <FileText className="h-4 w-4" />
                      <span>{c.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {c.documents} docs
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
