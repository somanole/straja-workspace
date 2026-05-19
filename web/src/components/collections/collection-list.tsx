import { useState, useMemo } from "react"
import { Database, Plus, FolderSync, FolderSymlink, Layers, Lock, StickyNote, Import, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { CollectionInfo } from "@/lib/types"

interface CollectionListProps {
  collections: CollectionInfo[] | undefined
  isLoading: boolean
  selected: string | null
  totalDocuments?: number
  needsEmbedding?: number
  embedding?: boolean
  onSelect: (name: string | null) => void
  onImport: () => void
  onCreateNote: () => void
  onCreateCollection: () => void
  onRefresh: () => Promise<unknown> | void
}

export function CollectionList({
  collections,
  isLoading,
  selected,
  totalDocuments,
  needsEmbedding,
  embedding,
  onSelect,
  onImport,
  onCreateNote,
  onCreateCollection,
  onRefresh,
}: CollectionListProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [systemExpanded, setSystemExpanded] = useState(false)
  const selectedInfo = selected
    ? collections?.find((c) => c.name === selected)
    : null
  const displayDocCount = selectedInfo ? selectedInfo.fileCount : totalDocuments ?? 0
  const displayLabel = selectedInfo ? selectedInfo.name : "All collections"

  const { userCollections, systemCollections } = useMemo(() => {
    if (!collections) return { userCollections: [], systemCollections: [] }
    const user: CollectionInfo[] = []
    const system: CollectionInfo[] = []
    for (const col of collections) {
      if (col.type === "system") {
        system.push(col)
      } else {
        user.push(col)
      }
    }
    const sort = (a: CollectionInfo, b: CollectionInfo) => a.name.localeCompare(b.name)
    return { userCollections: user.sort(sort), systemCollections: system.sort(sort) }
  }, [collections])

  if (isLoading) {
    return (
      <div className="p-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  const collectionButton = (col: CollectionInfo) => (
    <button
      key={col.name}
      onClick={() => onSelect(col.name)}
      className={cn(
        "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors text-left",
        selected === col.name
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
      )}
    >
      <Database className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{col.name}</span>
      {col.linked && (
        <Tooltip>
          <TooltipTrigger asChild>
            <FolderSymlink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-56 text-xs">
            Linked to a local folder. New or modified files will be picked up on sync.
          </TooltipContent>
        </Tooltip>
      )}
      {!col.deletable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            Protected collection
          </TooltipContent>
        </Tooltip>
      )}
      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
        {col.fileCount}
      </Badge>
    </button>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="p-3 pb-2 flex items-center justify-between shrink-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Collections
        </h2>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  try {
                    await onRefresh()
                    toast.success("Collections synced")
                  } catch {
                    toast.error("Sync failed")
                  } finally {
                    setRefreshing(false)
                  }
                }}
              >
                <FolderSync className={cn("h-3 w-3", refreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sync collection folders for changes</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onCreateNote} className="text-xs gap-2">
                <StickyNote className="h-3.5 w-3.5" />
                Create Note
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCreateCollection} className="text-xs gap-2">
                <Database className="h-3.5 w-3.5" />
                Create Collection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onImport} className="text-xs gap-2">
                <Import className="h-3.5 w-3.5" />
                Import
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 px-2">
        {/* All collections */}
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors text-left",
            selected === null
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}
        >
          <Layers className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1">All</span>
          {totalDocuments != null && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              {totalDocuments}
            </Badge>
          )}
        </button>

        {/* User collections */}
        {userCollections.length > 0 && (
          <div className="mt-3">
            <div className="px-2.5 pb-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              User
            </div>
            {userCollections.map(collectionButton)}
          </div>
        )}

        {/* System collections (collapsed by default) */}
        {systemCollections.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setSystemExpanded((v) => !v)}
              className="w-full flex items-center gap-1 px-2.5 pb-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider hover:text-muted-foreground transition-colors"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform duration-150",
                  systemExpanded && "rotate-90"
                )}
              />
              System
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto">
                {systemCollections.reduce((sum, c) => sum + c.fileCount, 0)}
              </Badge>
            </button>
            {systemExpanded && systemCollections.map(collectionButton)}
          </div>
        )}
      </ScrollArea>

      {/* Footer stats */}
      <div className="border-t p-3 shrink-0">
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <div>{displayDocCount} files · {displayLabel}</div>
          {(needsEmbedding ?? 0) > 0 && (
            <div className={embedding ? "text-blue-500" : "text-amber-500"}>
              {embedding ? `Embedding… ${needsEmbedding} remaining` : `${needsEmbedding} pending embedding`}
            </div>
          )}
          {embedding && needsEmbedding === 0 && (
            <div className="text-blue-500">Embedding… finishing up</div>
          )}
        </div>
      </div>
    </div>
  )
}
