import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { FileText, FileSpreadsheet, FileIcon, ArrowUpDown, Trash2, FolderOpen, Folder, FolderPlus, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EmptyState } from "@/components/shared/empty-state"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import type { GroupedFileInfo } from "@/lib/types"

type SortField = "name" | "date" | "size"
type SortDir = "asc" | "desc"

interface FileListProps {
  files: GroupedFileInfo[] | undefined
  isLoading: boolean
  selected: GroupedFileInfo | null
  collectionName: string | null
  prefix?: string
  onSelect: (file: GroupedFileInfo) => void
  onNavigate?: (prefix: string) => void
  onCreateFolder?: (name: string) => void
  onDelete?: (file: GroupedFileInfo) => void
  onDeleteMany?: (files: GroupedFileInfo[]) => void
  onDeleteFolder?: (folder: GroupedFileInfo) => void
}

function getFileIcon(file: GroupedFileInfo) {
  if (file.type === "folder") {
    return <Folder className="h-4 w-4 shrink-0 text-blue-500/70" />
  }
  const ext = file.path.split(".").pop()?.toLowerCase()
  const mime = file.mimeType
  if (ext === "pdf" || mime === "application/pdf") {
    return <FileIcon className="h-4 w-4 shrink-0 text-red-500/70" />
  }
  if (ext === "xlsx" || ext === "xls" || ext === "csv" || mime?.includes("spreadsheet")) {
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600/70" />
  }
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileList({
  files,
  isLoading,
  selected,
  collectionName,
  prefix,
  onSelect,
  onNavigate,
  onCreateFolder,
  onDelete,
  onDeleteMany,
  onDeleteFolder,
}: FileListProps) {
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Clear selection when collection or prefix changes
  useEffect(() => {
    setSelectedPaths(new Set())
  }, [collectionName, prefix, files])

  // Separate folders from files for sorting
  const sorted = useMemo(() => {
    if (!files) return []
    const folders = files.filter(f => f.type === "folder")
    const regularFiles = files.filter(f => f.type !== "folder")

    const sortItems = (items: GroupedFileInfo[]) =>
      [...items].sort((a, b) => {
        let cmp = 0
        switch (sortField) {
          case "name":
            cmp = a.path.localeCompare(b.path)
            break
          case "date":
            cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
            break
          case "size":
            cmp = a.size - b.size
            break
        }
        return sortDir === "asc" ? cmp : -cmp
      })

    // Folders always first, then sorted files
    return [...sortItems(folders), ...sortItems(regularFiles)]
  }, [files, sortField, sortDir])

  const selectableFiles = useMemo(() => files?.filter(f => f.type !== "folder") ?? [], [files])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const toggleFile = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (!selectableFiles.length) return
    setSelectedPaths((prev) => {
      if (prev.size === selectableFiles.length) {
        return new Set()
      }
      return new Set(selectableFiles.map((f) => f.path))
    })
  }, [selectableFiles])

  const handleBulkDelete = useCallback(() => {
    if (!selectableFiles.length || !onDeleteMany) return
    const selected = selectableFiles.filter((f) => selectedPaths.has(f.path))
    if (selected.length > 0) {
      onDeleteMany(selected)
    }
  }, [selectableFiles, selectedPaths, onDeleteMany])

  // Manage indeterminate state on the select-all checkbox
  const allSelected = selectableFiles.length > 0 && selectedPaths.size === selectableFiles.length
  const someSelected = selectedPaths.size > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  const hasSelection = selectedPaths.size > 0

  // Build breadcrumb segments from prefix
  const breadcrumbs = useMemo(() => {
    if (!prefix) return []
    const parts = prefix.split("/").filter(Boolean)
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join("/"),
    }))
  }, [prefix])

  if (isLoading) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (!files || files.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Show breadcrumbs even in empty folders */}
        {prefix && onNavigate && (
          <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0 text-xs">
            <button
              onClick={() => onNavigate("")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {collectionName}
            </button>
            {breadcrumbs.map((bc) => (
              <span key={bc.path} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                <button
                  onClick={() => onNavigate(bc.path)}
                  className={cn(
                    bc.path === prefix
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground transition-colors"
                  )}
                >
                  {bc.label}
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Header with create folder action */}
        {collectionName && onCreateFolder && (
          <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
            <span className="flex-1 text-xs text-muted-foreground">Empty</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    setCreatingFolder(true)
                    setNewFolderName("")
                    setTimeout(() => folderInputRef.current?.focus(), 50)
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create folder</TooltipContent>
            </Tooltip>
          </div>
        )}
        {/* Inline new folder row in empty state */}
        {creatingFolder && (
          <div className="flex items-center gap-2 mx-1.5 mt-1.5 rounded-md bg-secondary/50 px-2 py-1.5">
            <Folder className="h-4 w-4 shrink-0 text-blue-500/70" />
            <Input
              ref={folderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolderName.trim()) {
                  onCreateFolder?.(newFolderName.trim())
                  setCreatingFolder(false)
                  setNewFolderName("")
                } else if (e.key === "Escape") {
                  setCreatingFolder(false)
                  setNewFolderName("")
                }
              }}
              onBlur={() => {
                if (!newFolderName.trim()) {
                  setCreatingFolder(false)
                }
              }}
              placeholder="Folder name…"
              className="h-7 text-sm flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!newFolderName.trim()}
              onClick={() => {
                if (newFolderName.trim()) {
                  onCreateFolder?.(newFolderName.trim())
                  setCreatingFolder(false)
                  setNewFolderName("")
                }
              }}
            >
              Create
            </Button>
          </div>
        )}
        <EmptyState
          icon={<FolderOpen className="h-10 w-10" />}
          title={collectionName ? "No files" : "Select a collection"}
          description={
            collectionName
              ? prefix
                ? "This folder is empty"
                : "This collection is empty"
              : "Choose a collection from the sidebar to browse files"
          }
        />
      </div>
    )
  }

  const fileCount = files.filter(f => f.type !== "folder").length
  const folderCount = files.filter(f => f.type === "folder").length

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Breadcrumb navigation */}
      {prefix && onNavigate && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0 text-xs">
          <button
            onClick={() => onNavigate("")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {collectionName}
          </button>
          {breadcrumbs.map((bc) => (
            <span key={bc.path} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              <button
                onClick={() => onNavigate(bc.path)}
                className={cn(
                  bc.path === prefix
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground transition-colors"
                )}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Header: sort controls or selection toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
        {hasSelection ? (
          <>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer"
            />
            <span className="text-xs font-medium ml-1">
              {allSelected
                ? `All ${selectableFiles.length} selected`
                : `${selectedPaths.size} selected`}
            </span>
            <span className="flex-1" />
            {onDeleteMany && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground mr-1">Sort:</span>
            {(["name", "date", "size"] as SortField[]).map((field) => (
              <Button
                key={field}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 px-2 text-xs",
                  sortField === field && "text-foreground font-medium"
                )}
                onClick={() => toggleSort(field)}
              >
                {field}
                {sortField === field && (
                  <ArrowUpDown className="h-3 w-3 ml-0.5" />
                )}
              </Button>
            ))}
            <span className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {folderCount > 0 && `${folderCount} folders`}
              {folderCount > 0 && fileCount > 0 && ", "}
              {fileCount > 0 && `${fileCount} files`}
              {folderCount === 0 && fileCount === 0 && "Empty"}
            </span>
            {onCreateFolder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-1"
                    onClick={() => {
                      setCreatingFolder(true)
                      setNewFolderName("")
                      setTimeout(() => folderInputRef.current?.focus(), 50)
                    }}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Create folder</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-1.5">
          {/* Inline new folder row */}
          {creatingFolder && (
            <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1.5 mb-1">
              <Folder className="h-4 w-4 shrink-0 text-blue-500/70" />
              <Input
                ref={folderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim()) {
                    onCreateFolder?.(newFolderName.trim())
                    setCreatingFolder(false)
                    setNewFolderName("")
                  } else if (e.key === "Escape") {
                    setCreatingFolder(false)
                    setNewFolderName("")
                  }
                }}
                onBlur={() => {
                  if (!newFolderName.trim()) {
                    setCreatingFolder(false)
                  }
                }}
                placeholder="Folder name…"
                className="h-7 text-sm flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!newFolderName.trim()}
                onClick={() => {
                  if (newFolderName.trim()) {
                    onCreateFolder?.(newFolderName.trim())
                    setCreatingFolder(false)
                    setNewFolderName("")
                  }
                }}
              >
                Create
              </Button>
            </div>
          )}
          {sorted.map((file) => {
            const isFolder = file.type === "folder"
            const isChecked = selectedPaths.has(file.path)
            const sizeStr = isFolder ? "" : formatFileSize(file.size)
            const fileName = file.path.split("/").pop() || file.path
            return (
              <div
                key={file.path}
                className={cn(
                  "flex items-center gap-1 rounded-md transition-colors group",
                  isFolder
                    ? "hover:bg-secondary/50"
                    : selected?.path === file.path
                      ? "bg-secondary text-secondary-foreground"
                      : isChecked
                        ? "bg-primary/5"
                        : "hover:bg-secondary/50"
                )}
              >
                {/* Checkbox — only for files */}
                {isFolder ? (
                  <div className="w-8 shrink-0" />
                ) : (
                  <label
                    className="flex items-center justify-center w-8 h-full shrink-0 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleFile(file.path)}
                      className={cn(
                        "h-3.5 w-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer",
                        !isChecked && !hasSelection && "opacity-0 group-hover:opacity-100 transition-opacity"
                      )}
                    />
                  </label>
                )}

                {/* Row body */}
                <button
                  onClick={() => {
                    if (isFolder && onNavigate) {
                      onNavigate(file.path)
                    } else if (!isFolder) {
                      onSelect(file)
                    }
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 py-2 pr-2.5 text-left"
                >
                  {getFileIcon(file)}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">
                      {isFolder ? (
                        <span className="font-medium">{fileName}</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{file.title || fileName}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-80">
                            {file.title || file.path}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {isFolder ? (
                      <span className="text-[11px] text-muted-foreground">
                        {file.childCount} {file.childCount === 1 ? "item" : "items"}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] text-muted-foreground truncate">
                          {fileName !== file.path ? file.path : ""}
                        </span>
                        {sizeStr && (
                          <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                            {sizeStr}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFolder ? (
                      <div className="flex items-center gap-1">
                        {onDeleteFolder && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteFolder(file)
                            }}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    ) : (
                      <>
                        {file.indexEntries > 0 && !file.isTextOnly && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                            {file.indexEntries} indexed
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {file.modifiedAt && format(new Date(file.modifiedAt), "MMM d, yyyy")}
                        </span>
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation()
                              onDelete(file)
                            }}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
