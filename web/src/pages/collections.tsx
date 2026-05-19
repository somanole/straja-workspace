import { useState, useCallback, useRef, useEffect } from "react"
import { useParams, useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { CollectionList } from "@/components/collections/collection-list"
import { ImportDialog } from "@/components/collections/import-dialog"
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog"
import { DeleteDialog } from "@/components/collections/delete-dialog"
import { NoteDialog } from "@/components/notes/note-dialog"
import { FileList } from "@/components/files/file-list"
import { DocumentViewer } from "@/components/viewer/document-viewer"
import { useVaultStatus } from "@/hooks/use-vault-status"
import { useFileList, useFileContent } from "@/hooks/use-files"
import { useDeleteCollection, useDeleteFiles, useDeleteFolder, useCreateFolder } from "@/hooks/use-collections"
import { sync } from "@/lib/api"
import { toast } from "sonner"
import type { GroupedFileInfo } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageShell } from "@/components/shared/page-shell"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FolderSync, Trash2, Lock, ArrowLeft, Plus, StickyNote, Import, Database } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function isCollectionDeletable(collections: { name: string; deletable: boolean }[] | undefined, name: string | null): boolean {
  if (!name || !collections) return false
  const col = collections.find((c) => c.name === name)
  return col?.deletable ?? false
}

function isEditableMarkdownFile(file: GroupedFileInfo | null | undefined): boolean {
  if (!file?.path) return false
  return file.path.toLowerCase().endsWith(".md")
}

type MobilePanel = "collections" | "files" | "viewer"

export function CollectionsPage() {
  const { name: urlCollection, "*": rawUrlPath } = useParams()
  const navigate = useNavigate()
  const [isCompact, setIsCompact] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1299px)")
    const onChange = () => setIsCompact(mql.matches)
    mql.addEventListener("change", onChange)
    setIsCompact(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  // Decode %23 → # and other URL-encoded chars in the file path
  const urlPath = rawUrlPath ? decodeURIComponent(rawUrlPath) : undefined

  const queryClient = useQueryClient()
  const selectedCollection = urlCollection ?? null
  const [folderPrefix, setFolderPrefix] = useState("")
  const { data: status, isLoading: statusLoading, refetch } = useVaultStatus()
  const { data: files, isLoading: filesLoading } = useFileList(selectedCollection, folderPrefix || undefined)

  const [syncing, setSyncing] = useState(false)
  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await sync()
    } catch {
      // sync may fail — still refresh UI
    }
    refetch()
    queryClient.invalidateQueries({ queryKey: ["collections"] })
    setSyncing(false)
  }, [refetch, queryClient])

  const [selectedFile, setSelectedFile] = useState<GroupedFileInfo | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<"folder" | "files">("folder")
  const [deleteTarget, setDeleteTarget] = useState<{ type: "collection" | "file" | "files" | "folder"; name: string; file?: GroupedFileInfo; files?: GroupedFileInfo[] } | null>(null)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(
    urlPath ? "viewer" : selectedCollection ? "files" : "collections"
  )

  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [noteDialogMode, setNoteDialogMode] = useState<"create" | "edit">("create")
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false)
  const [fileListWidth, setFileListWidth] = useState(() =>
    // 40% of estimated available space (viewport minus ~304px for nav + collection sidebars)
    Math.round(Math.max(250, Math.min(600, (window.innerWidth - 304) * 0.4)))
  )
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const deleteCollectionMut = useDeleteCollection()
  const deleteFilesMut = useDeleteFiles()
  const deleteFolderMut = useDeleteFolder()
  const createFolderMut = useCreateFolder()

  // If URL has a file path, try to find it in the loaded file list.
  // If files haven't loaded yet, create a minimal GroupedFileInfo placeholder from the URL path
  // so the DocumentViewer can start fetching content immediately.
  const matchedFile = urlPath
    ? files?.find((f) => f.path === urlPath) ?? null
    : null

  const effectiveFile = matchedFile
    ?? (urlPath
      ? selectedFile?.path === urlPath
        ? selectedFile
        : { path: urlPath, displayPath: `${selectedCollection}/${urlPath}`, title: "", size: 0, modifiedAt: "", docid: "", indexEntries: 0, isTextOnly: true } as GroupedFileInfo
      : selectedFile)
  const selectedCollectionIsDeletable = isCollectionDeletable(status?.collections, selectedCollection)

  const isEditableMarkdown = isEditableMarkdownFile(effectiveFile)
  const editingNotePath = isEditableMarkdown ? (effectiveFile?.path ?? null) : null
  const { data: editingNoteContent } = useFileContent(
    isEditableMarkdown ? selectedCollection : null,
    editingNotePath
  )

  const handleSelectCollection = useCallback(
    (name: string | null) => {
      setSelectedFile(null)
      setFolderPrefix("")
      if (name) {
        navigate(`/collections/${name}`)
        if (isCompact) setMobilePanel("files")
      } else {
        navigate("/collections")
        if (isCompact) setMobilePanel("collections")
      }
    },
    [navigate, isCompact]
  )

  const handleNavigateFolder = useCallback(
    (prefix: string) => {
      setFolderPrefix(prefix)
      setSelectedFile(null)
    },
    []
  )

  const handleCreateFolder = useCallback(
    async (folderName: string) => {
      if (!selectedCollection) return
      const fullPath = folderPrefix ? `${folderPrefix}/${folderName}` : folderName
      try {
        await createFolderMut.mutateAsync({ collection: selectedCollection, path: fullPath })
        toast.success(`Folder "${folderName}" created`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create folder")
      }
    },
    [selectedCollection, folderPrefix, createFolderMut]
  )

  const handleDeleteMany = useCallback(
    (filesToDelete: GroupedFileInfo[]) => {
      setDeleteTarget({
        type: "files",
        name: `${filesToDelete.length} files`,
        files: filesToDelete,
      })
    },
    []
  )

  const handleSelectFile = useCallback(
    (file: GroupedFileInfo) => {
      setSelectedFile(file)
      if (selectedCollection) {
        // Encode # so it becomes part of the URL path, not a fragment
        navigate(`/collections/${selectedCollection}/${file.path.replace(/#/g, "%23")}`)
      }
      if (isCompact) setMobilePanel("viewer")
    },
    [navigate, selectedCollection, isCompact]
  )

  // Compute file list constraints from available space (excluding 220px collection sidebar)
  const getFilePanelBounds = useCallback(() => {
    const available = (containerRef.current?.offsetWidth ?? 800) - 256
    const minW = Math.round(available * 0.25)
    const maxW = Math.round(available * 0.60)
    const midW = Math.round(available * 0.40)
    return { minW, maxW, midW }
  }, [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const { minW, maxW } = getFilePanelBounds()
    const startWidth = fileListWidth

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const next = startWidth + (ev.clientX - startX)
      setFileListWidth(Math.max(minW, Math.min(next, maxW)))
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [fileListWidth, getFilePanelBounds])

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === "collection") {
        if (!isCollectionDeletable(status?.collections, deleteTarget.name)) {
          toast.error(`Collection "${deleteTarget.name}" is protected and cannot be removed`)
          setDeleteTarget(null)
          return
        }
        await deleteCollectionMut.mutateAsync(deleteTarget.name)
        toast.success(`Collection "${deleteTarget.name}" deleted`)
        navigate("/collections")
        setSelectedFile(null)
        if (isCompact) setMobilePanel("collections")
      } else if (deleteTarget.type === "files" && selectedCollection && deleteTarget.files) {
        const paths = deleteTarget.files.map((f) => f.path)
        await deleteFilesMut.mutateAsync({
          collection: selectedCollection,
          paths,
        })
        toast.success(`Removed ${paths.length} files`)
        if (selectedFile && paths.includes(selectedFile.path)) setSelectedFile(null)
      } else if (deleteTarget.type === "folder" && selectedCollection) {
        await deleteFolderMut.mutateAsync({
          collection: selectedCollection,
          prefix: deleteTarget.name,
        })
        toast.success("Folder removed")
        // If selected file was inside the deleted folder, clear it
        if (selectedFile?.path.startsWith(deleteTarget.name + "/") || selectedFile?.path.startsWith(deleteTarget.name)) {
          setSelectedFile(null)
        }
      } else if (deleteTarget.type === "file" && selectedCollection) {
        await deleteFilesMut.mutateAsync({
          collection: selectedCollection,
          paths: [deleteTarget.name],
        })
        toast.success("File removed")
        if (selectedFile?.path === deleteTarget.name) setSelectedFile(null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
    setDeleteTarget(null)
  }

  /* ── Collection actions bar (shared between desktop sidebar & mobile) ── */
  const collectionActions = selectedCollection && (
    <div className="border-t p-2 flex flex-wrap gap-1 shrink-0">
      {!selectedCollectionIsDeletable && (
        <Badge
          variant="outline"
          className="h-7 px-2 text-[10px] gap-1"
          title="Protected collection"
        >
          <Lock className="h-3 w-3" />
          Protected
        </Badge>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        title={
          !selectedCollectionIsDeletable
            ? "This collection cannot be removed"
            : "Remove collection"
        }
        disabled={!selectedCollectionIsDeletable}
        onClick={() =>
          setDeleteTarget({
            type: "collection",
            name: selectedCollection,
          })
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  /* ── Mobile layout: single panel with back navigation ── */
  if (isCompact) {
    return (
      <>
        <PageShell variant="full">
          {/* Back navigation header */}
          {mobilePanel !== "collections" && (
            <div className="flex items-center gap-1 px-4 py-3 border-b shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 px-2 text-muted-foreground"
                onClick={() => {
                  if (mobilePanel === "viewer") {
                    setMobilePanel("files")
                  } else {
                    setMobilePanel("collections")
                  }
                }}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                {mobilePanel === "viewer"
                  ? `Back to ${selectedCollection ?? "files"}`
                  : "Back to collections"}
              </Button>
              <span className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    <FolderSync className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync collection folders for changes</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setNoteDialogMode("create"); setNoteDialogOpen(true) }} className="text-xs gap-2">
                    <StickyNote className="h-3.5 w-3.5" />
                    Create Note
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCreateCollectionOpen(true)} className="text-xs gap-2">
                    <Database className="h-3.5 w-3.5" />
                    Create Collection
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setImportMode("folder"); setImportOpen(true) }} className="text-xs gap-2">
                    <Import className="h-3.5 w-3.5" />
                    Import
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {mobilePanel === "collections" && (
              <>
                <CollectionList
                  collections={status?.collections}
                  isLoading={statusLoading}
                  selected={selectedCollection}
                  totalDocuments={status?.totalFileCount}
                  needsEmbedding={status?.needsEmbedding}
                  embedding={status?.embedding}
                  onSelect={handleSelectCollection}
                  onImport={() => { setImportMode("folder"); setImportOpen(true) }}
                  onCreateNote={() => { setNoteDialogMode("create"); setNoteDialogOpen(true) }}
                  onCreateCollection={() => setCreateCollectionOpen(true)}
                  onRefresh={handleSync}
                />
                {collectionActions}
              </>
            )}

            {mobilePanel === "files" && (
              <>
                <FileList
                  files={files}
                  isLoading={filesLoading}
                  selected={effectiveFile ?? null}
                  collectionName={selectedCollection}
                  prefix={folderPrefix || undefined}
                  onSelect={handleSelectFile}
                  onNavigate={handleNavigateFolder}
                  onCreateFolder={handleCreateFolder}
                  onDelete={(file) =>
                    setDeleteTarget({
                      type: "file",
                      name: file.path,
                      file,
                    })
                  }
                  onDeleteMany={handleDeleteMany}
                  onDeleteFolder={(folder) =>
                    setDeleteTarget({
                      type: "folder",
                      name: folder.path,
                      file: folder,
                    })
                  }
                />
                {collectionActions}
              </>
            )}

            {mobilePanel === "viewer" && (
              <DocumentViewer
                collection={selectedCollection}
                file={effectiveFile ?? null}
                onEdit={isEditableMarkdown && effectiveFile ? () => {
                  setNoteDialogMode("edit")
                  setNoteDialogOpen(true)
                } : undefined}
              />
            )}
          </div>
        </PageShell>

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          targetCollection={importMode === "files" ? selectedCollection : null}
        />
        <CreateCollectionDialog
          open={createCollectionOpen}
          onOpenChange={setCreateCollectionOpen}
        />
        <DeleteDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={
            deleteTarget?.type === "collection"
              ? `Delete "${deleteTarget.name}"?`
              : deleteTarget?.type === "folder"
                ? `Remove folder "${deleteTarget.name.split("/").pop()}"?`
                : `Remove file?`
          }
          description={
            deleteTarget?.type === "collection"
              ? "This will remove the collection and all its documents from the index. Source files are not affected."
              : deleteTarget?.type === "folder"
                ? "This will remove the folder and all files inside it from the collection index."
                : "This will remove this file from the collection index."
          }
          highlight={deleteTarget?.type === "file" ? deleteTarget.name : deleteTarget?.type === "folder" ? deleteTarget.name : undefined}
          onConfirm={handleDeleteConfirm}
          isPending={deleteCollectionMut.isPending || deleteFilesMut.isPending || deleteFolderMut.isPending}
        />
        <NoteDialog
          open={noteDialogOpen}
          onOpenChange={setNoteDialogOpen}
          mode={noteDialogMode}
          initialTitle={noteDialogMode === "edit" ? (editingNoteContent?.title || effectiveFile?.title || "") : ""}
          initialContent={noteDialogMode === "edit" ? (editingNoteContent?.content || "") : ""}
          notePath={noteDialogMode === "edit" ? editingNotePath ?? undefined : undefined}
          noteCollection={noteDialogMode === "edit" ? selectedCollection : undefined}
          collections={status?.collections}
          defaultCollection={selectedCollection}
          folderPrefix={folderPrefix || undefined}
        />
      </>
    )
  }

  /* ── Desktop layout: sidebar + resizable file list / viewer ── */
  return (
    <>
    <div ref={containerRef} className="h-[calc(100vh-3rem)] flex overflow-hidden">
      {/* Sidebar — fixed width */}
      <div className="w-[256px] shrink-0 border-r overflow-hidden flex flex-col">
        <CollectionList
          collections={status?.collections}
          isLoading={statusLoading}
          selected={selectedCollection}
          totalDocuments={status?.totalFileCount}
          needsEmbedding={status?.needsEmbedding}
          embedding={status?.embedding}
          onSelect={handleSelectCollection}
          onImport={() => { setImportMode("folder"); setImportOpen(true) }}
          onCreateNote={() => { setNoteDialogMode("create"); setNoteDialogOpen(true) }}
          onCreateCollection={() => setCreateCollectionOpen(true)}
          onRefresh={handleSync}
        />
        {collectionActions}
      </div>

      {/* File list — resizable width */}
      <div style={{ width: fileListWidth }} className="shrink-0 overflow-hidden flex flex-col">
        <FileList
          files={files}
          isLoading={filesLoading}
          selected={effectiveFile ?? null}
          collectionName={selectedCollection}
          prefix={folderPrefix || undefined}
          onSelect={handleSelectFile}
          onNavigate={handleNavigateFolder}
          onCreateFolder={handleCreateFolder}
          onDelete={(file) =>
            setDeleteTarget({
              type: "file",
              name: file.path,
              file,
            })
          }
          onDeleteMany={handleDeleteMany}
          onDeleteFolder={(folder) =>
            setDeleteTarget({
              type: "folder",
              name: folder.path,
              file: folder,
            })
          }
        />
      </div>

      {/* Drag handle */}
      <div
        className="w-px bg-border relative shrink-0 cursor-col-resize group"
        onMouseDown={onDragStart}
      >
        <div className="absolute inset-y-0 -left-1 w-2.5" />
      </div>

      {/* Document viewer — fills remaining space */}
      <div className="flex-1 min-w-[300px] overflow-hidden flex flex-col">
          <DocumentViewer
            collection={selectedCollection}
            file={effectiveFile ?? null}
            onEdit={isEditableMarkdown && effectiveFile ? () => {
              setNoteDialogMode("edit")
              setNoteDialogOpen(true)
            } : undefined}
          />
      </div>

    </div>

    <ImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      targetCollection={importMode === "files" ? selectedCollection : null}
    />
    <CreateCollectionDialog
      open={createCollectionOpen}
      onOpenChange={setCreateCollectionOpen}
    />
    <DeleteDialog
      open={!!deleteTarget}
      onOpenChange={(open) => !open && setDeleteTarget(null)}
      title={
        deleteTarget?.type === "collection"
          ? `Delete "${deleteTarget.name}"?`
          : deleteTarget?.type === "files"
            ? `Remove ${deleteTarget?.files?.length ?? 0} files?`
            : deleteTarget?.type === "folder"
              ? `Remove folder "${deleteTarget.name.split("/").pop()}"?`
              : `Remove file?`
      }
      description={
        deleteTarget?.type === "collection"
          ? "This will remove the collection and all its documents from the index. Source files are not affected."
          : deleteTarget?.type === "files"
            ? "This will remove the selected files from the collection index."
            : deleteTarget?.type === "folder"
              ? "This will remove the folder and all files inside it from the collection index."
              : "This will remove this file from the collection index."
      }
      highlight={deleteTarget?.type === "file" ? deleteTarget.name : deleteTarget?.type === "folder" ? deleteTarget.name : undefined}
      onConfirm={handleDeleteConfirm}
      isPending={deleteCollectionMut.isPending || deleteFilesMut.isPending || deleteFolderMut.isPending}
    />
    <NoteDialog
      open={noteDialogOpen}
      onOpenChange={setNoteDialogOpen}
      mode={noteDialogMode}
      initialTitle={noteDialogMode === "edit" ? (editingNoteContent?.title || effectiveFile?.title || "") : ""}
      initialContent={noteDialogMode === "edit" ? (editingNoteContent?.content || "") : ""}
      notePath={noteDialogMode === "edit" ? editingNotePath ?? undefined : undefined}
      noteCollection={noteDialogMode === "edit" ? selectedCollection : undefined}
      collections={status?.collections}
      defaultCollection={selectedCollection}
      folderPrefix={folderPrefix || undefined}
    />
    </>
  )
}
