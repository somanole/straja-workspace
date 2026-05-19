import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FolderPlus,
  FilePlus,
  HardDrive,
  Folder,
  FileText,
  ChevronUp,
  Check,
  Loader2,
} from "lucide-react"
import { useCreateCollection, useAddFiles } from "@/hooks/use-collections"
import { useVaultStatus } from "@/hooks/use-vault-status"
import { useDriveStatus, useDriveImport } from "@/hooks/use-gdrive"
import { browse, browseDrive, type BrowseItem } from "@/lib/api"
import type { DriveBrowseItem } from "@/lib/types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select "add-files" mode and target this collection */
  targetCollection?: string | null
}

export function ImportDialog({ open, onOpenChange, targetCollection }: ImportDialogProps) {
  const [mode, setMode] = useState<"folder" | "files" | "drive">(targetCollection ? "files" : "folder")
  const { data: driveStatus } = useDriveStatus()
  const driveConnected = driveStatus?.status === "connected"

  // Folder mode state
  const [folderPath, setFolderPath] = useState("")
  const [name, setName] = useState("")
  const [pattern, setPattern] = useState("**/*")

  // Files mode state
  const [collection, setCollection] = useState(targetCollection ?? "")
  const [newCollectionName, setNewCollectionName] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])

  // Shared file browser state
  const [browsePath, setBrowsePath] = useState("")
  const [browseItems, setBrowseItems] = useState<BrowseItem[]>([])
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseInitialized, setBrowseInitialized] = useState(false)

  // Drive mode state
  const [driveItems, setDriveItems] = useState<DriveBrowseItem[]>([])
  const [driveCurrent, setDriveCurrent] = useState<{ id: string; name: string } | null>(null)
  const [driveParent, setDriveParent] = useState<string | null>(null)
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveInitialized, setDriveInitialized] = useState(false)
  const [driveSelected, setDriveSelected] = useState<{ id: string; name: string; isFolder: boolean }[]>([])
  const [driveCollection, setDriveCollection] = useState("_gdrive")
  const [driveNewCollectionName, setDriveNewCollectionName] = useState("")

  const create = useCreateCollection()
  const addFiles = useAddFiles()
  const driveImport = useDriveImport()
  const { data: status } = useVaultStatus()

  const collections = (status?.collections ?? []).filter((c) => c.type !== "system")

  // Sync targetCollection when dialog opens
  useEffect(() => {
    if (open) {
      if (targetCollection) {
        setMode("files")
        setCollection(targetCollection)
      } else {
        setMode("folder")
      }
    } else {
      setBrowseInitialized(false)
    }
  }, [open, targetCollection])

  // Load file browser
  const loadBrowse = useCallback(async (path?: string, filterType?: "dir" | "all") => {
    setBrowseLoading(true)
    try {
      const result = await browse(path, filterType ?? "all")
      setBrowsePath(result.path)
      setBrowseItems(result.items)
      setBrowseParent(result.parent)
      setBrowseInitialized(true)
    } catch (err) {
      toast.error(`Cannot browse: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
    setBrowseLoading(false)
  }, [])

  // Initialize browser when dialog opens or mode changes
  useEffect(() => {
    if (open && !browseInitialized) {
      loadBrowse(undefined, mode === "folder" ? "dir" : "all")
    }
  }, [open, browseInitialized, loadBrowse, mode])

  // Drive browser
  const loadDriveBrowse = useCallback(async (folderId?: string) => {
    setDriveLoading(true)
    try {
      const result = await browseDrive(folderId)
      setDriveItems(result.items)
      setDriveCurrent(result.current)
      setDriveParent(result.parent)
      setDriveInitialized(true)
    } catch (err) {
      toast.error(`Cannot browse Drive: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
    setDriveLoading(false)
  }, [])

  // Initialize drive browser when switching to drive mode
  useEffect(() => {
    if (open && mode === "drive" && !driveInitialized && driveConnected) {
      loadDriveBrowse()
    }
  }, [open, mode, driveInitialized, driveConnected, loadDriveBrowse])

  // Re-load browser with correct filter when switching modes
  const handleModeChange = (newMode: "folder" | "files" | "drive") => {
    setMode(newMode)
    if (newMode === "drive") return // Drive browse handled by useEffect
    // Re-browse current path with the appropriate filter
    loadBrowse(browsePath || undefined, newMode === "folder" ? "dir" : "all")
  }

  const resetForm = () => {
    setFolderPath("")
    setName("")
    setPattern("**/*")
    setCollection(targetCollection ?? "")
    setNewCollectionName("")
    setSelectedFiles([])
    setBrowseItems([])
    setBrowseInitialized(false)
    setDriveItems([])
    setDriveInitialized(false)
    setDriveSelected([])
    setDriveCollection("_gdrive")
    setDriveNewCollectionName("")
  }

  const toggleDriveItem = (item: DriveBrowseItem) => {
    setDriveSelected((prev) =>
      prev.some((s) => s.id === item.id)
        ? prev.filter((s) => s.id !== item.id)
        : [...prev, { id: item.id, name: item.name, isFolder: item.isFolder }]
    )
  }

  const effectiveDriveCollection = driveCollection === "__new__" ? driveNewCollectionName.trim() : driveCollection

  const handleSubmitDrive = async (e: React.FormEvent) => {
    e.preventDefault()
    if (driveSelected.length === 0 || !effectiveDriveCollection) return

    try {
      const coll = effectiveDriveCollection === "_gdrive" ? undefined : effectiveDriveCollection
      const result = await driveImport.mutateAsync({
        fileIds: driveSelected.map((s) => s.id),
        collection: coll,
      })
      if (result.errors.length > 0) {
        toast.warning(`Imported ${result.imported}, ${result.errors.length} errors`)
      } else {
        toast.success(
          `Imported ${result.imported} files from Drive into "${effectiveDriveCollection}" (${result.skipped} already synced) — embedding in background`
        )
      }
      onOpenChange(false)
      resetForm()
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }

  const handleSubmitFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderPath.trim() || !name.trim()) return

    try {
      const result = await create.mutateAsync({
        path: folderPath.trim(),
        name: name.trim(),
        pattern: pattern.trim() || undefined,
      })
      toast.success(`Collection "${name}" created with ${result.documents} documents — embedding in background`)
      onOpenChange(false)
      resetForm()
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }

  const handleSubmitFiles = async (e: React.FormEvent) => {
    e.preventDefault()
    const coll = collection === "__new__" ? newCollectionName.trim() : collection.trim()
    if (!coll || selectedFiles.length === 0) return

    try {
      if (collection === "__new__") {
        const result = await addFiles.mutateAsync({ collection: coll, paths: selectedFiles })
        toast.success(`Added ${result.added} files to new collection "${coll}" (${result.documents} total) — embedding in background`)
      } else {
        const result = await addFiles.mutateAsync({ collection: coll, paths: selectedFiles })
        toast.success(`Added ${result.added} files to "${coll}" (${result.documents} total) — embedding in background`)
      }
      onOpenChange(false)
      resetForm()
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  const selectFolder = (item: BrowseItem) => {
    setFolderPath(item.path)
    setName(item.name)
  }

  const navigateBrowse = (path?: string) => {
    loadBrowse(path, mode === "folder" ? "dir" : "all")
  }

  const isPending = create.isPending || addFiles.isPending || driveImport.isPending
  const effectiveCollection = collection === "__new__" ? newCollectionName.trim() : collection.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Import a folder as a new collection, or add files to an existing one.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => handleModeChange(v as "folder" | "files" | "drive")}>
          <TabsList className="w-full">
            <TabsTrigger value="folder" className="flex-1 gap-1.5 text-xs">
              <FolderPlus className="h-3.5 w-3.5" />
              Import Folder
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-1 gap-1.5 text-xs">
              <FilePlus className="h-3.5 w-3.5" />
              Add Files
            </TabsTrigger>
            {driveConnected && (
              <TabsTrigger value="drive" className="flex-1 gap-1.5 text-xs">
                <HardDrive className="h-3.5 w-3.5" />
                Google Drive
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        {mode === "drive" ? (
          <form onSubmit={handleSubmitDrive} className="gap-3 flex flex-col min-h-0 flex-1 overflow-hidden">
            {/* Collection selector */}
            <div className="space-y-2 shrink-0">
              <label className="text-sm font-medium">Collection</label>
              <Select value={driveCollection} onValueChange={setDriveCollection}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select a collection..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_gdrive">_gdrive (default)</SelectItem>
                  {collections.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name} ({c.documents} docs)
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__">
                    + Create new collection
                  </SelectItem>
                </SelectContent>
              </Select>
              {driveCollection === "__new__" && (
                <Input
                  placeholder="new-collection-name"
                  value={driveNewCollectionName}
                  onChange={(e) => setDriveNewCollectionName(e.target.value)}
                  autoFocus
                />
              )}
            </div>

            {/* Drive browser */}
            <div className="gap-2 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Select Files or Folders</label>
                {driveSelected.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {driveSelected.length} selected
                  </Badge>
                )}
              </div>

              {/* Current folder + up button */}
              <div className="flex items-center gap-1.5">
                {driveParent !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => loadDriveBrowse(driveParent || undefined)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                )}
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {driveCurrent?.name || "My Drive"}
                </span>
              </div>

              {/* Drive file list */}
              <div className="flex-1 min-h-0 border rounded-md overflow-auto">
                {driveLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-1.5" />
                    Loading...
                  </div>
                ) : driveItems.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Empty folder
                  </div>
                ) : (
                  <div className="p-1">
                    {driveItems.map((item) => {
                      const isSelected = driveSelected.some((s) => s.id === item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-secondary/50"
                          )}
                          onClick={() => {
                            if (item.isFolder) {
                              loadDriveBrowse(item.id)
                            } else {
                              toggleDriveItem(item)
                            }
                          }}
                        >
                          {item.isFolder ? (
                            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate flex-1">{item.name}</span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Selected items summary */}
              {driveSelected.length > 0 && (
                <div className="flex flex-wrap gap-1 shrink-0">
                  {driveSelected.slice(0, 5).map((s) => (
                    <Badge
                      key={s.id}
                      variant="secondary"
                      className="text-[10px] cursor-pointer hover:bg-destructive/20"
                      onClick={() => toggleDriveItem({ id: s.id, name: s.name, isFolder: s.isFolder, mimeType: "" })}
                    >
                      {s.isFolder ? "📁 " : ""}{s.name} ×
                    </Badge>
                  ))}
                  {driveSelected.length > 5 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{driveSelected.length - 5} more
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground shrink-0">
              Selecting a folder imports all text-extractable files inside it.
            </p>

            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={driveSelected.length === 0 || !effectiveDriveCollection || isPending}>
                {driveImport.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Importing...
                  </>
                ) : (
                  `Import ${driveSelected.length} Item${driveSelected.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : mode === "folder" ? (
          <form onSubmit={handleSubmitFolder} className="gap-3 flex flex-col min-h-0 flex-1 overflow-hidden">
            {/* Folder browser */}
            <div className="gap-2 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Select Folder</label>
                {folderPath && (
                  <Badge variant="secondary" className="text-xs truncate max-w-[200px]">
                    {folderPath.split("/").pop()}
                  </Badge>
                )}
              </div>

              {/* Current path + up button */}
              <div className="flex items-center gap-1.5">
                {browseParent && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => navigateBrowse(browseParent)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                )}
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {browsePath}
                </span>
              </div>

              {/* Directory list */}
              <div className="flex-1 min-h-0 border rounded-md overflow-auto">
                {browseLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Loading...
                  </div>
                ) : browseItems.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No subfolders
                  </div>
                ) : (
                  <div className="p-1">
                    {browseItems.map((item) => {
                      const isSelected = folderPath === item.path
                      return (
                        <button
                          key={item.path}
                          type="button"
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-secondary/50"
                          )}
                          onClick={() => selectFolder(item)}
                          onDoubleClick={() => navigateBrowse(item.path)}
                        >
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{item.name}</span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Collection name + pattern */}
            <div className="space-y-2 shrink-0">
              <label className="text-sm font-medium">Collection Name</label>
              <Input
                placeholder="my-documents"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2 shrink-0">
              <label className="text-sm font-medium">File Pattern</label>
              <Input
                placeholder="**/*"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Glob pattern to filter files (default: all files)
              </p>
            </div>

            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!folderPath.trim() || !name.trim() || isPending}>
                {create.isPending ? "Importing..." : "Import"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleSubmitFiles} className="gap-3 flex flex-col min-h-0 flex-1 overflow-hidden">
            {/* Collection selector */}
            <div className="space-y-2 shrink-0">
              <label className="text-sm font-medium">Collection</label>
              {targetCollection ? (
                <Input value={targetCollection} disabled />
              ) : (
                <Select value={collection} onValueChange={setCollection}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select a collection..." />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name} ({c.documents} docs)
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">
                      + Create new collection
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {collection === "__new__" && (
                <Input
                  placeholder="new-collection-name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  autoFocus
                />
              )}
            </div>

            {/* File browser */}
            <div className="gap-2 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Select Files</label>
                {selectedFiles.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedFiles.length} selected
                  </Badge>
                )}
              </div>

              {/* Current path + up button */}
              <div className="flex items-center gap-1.5">
                {browseParent && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => navigateBrowse(browseParent)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                )}
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {browsePath}
                </span>
              </div>

              {/* File list */}
              <div className="flex-1 min-h-0 border rounded-md overflow-auto">
                {browseLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Loading...
                  </div>
                ) : browseItems.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Empty directory
                  </div>
                ) : (
                  <div className="p-1">
                    {browseItems.map((item) => {
                      const isSelected = selectedFiles.includes(item.path)
                      const isDir = item.type === "directory"
                      return (
                        <button
                          key={item.path}
                          type="button"
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-secondary/50"
                          )}
                          onClick={() => {
                            if (isDir) {
                              navigateBrowse(item.path)
                            } else {
                              toggleFile(item.path)
                            }
                          }}
                        >
                          {isDir ? (
                            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate flex-1">{item.name}</span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Selected files summary */}
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1 shrink-0">
                  {selectedFiles.slice(0, 5).map((f) => (
                    <Badge
                      key={f}
                      variant="secondary"
                      className="text-[10px] cursor-pointer hover:bg-destructive/20"
                      onClick={() => toggleFile(f)}
                    >
                      {f.split("/").pop()} ×
                    </Badge>
                  ))}
                  {selectedFiles.length > 5 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{selectedFiles.length - 5} more
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!effectiveCollection || selectedFiles.length === 0 || isPending}
              >
                {addFiles.isPending ? "Adding..." : `Add ${selectedFiles.length} File${selectedFiles.length !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
