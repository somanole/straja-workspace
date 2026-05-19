import { useState, useEffect, useRef } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { useCreateNote, useUpdateNote } from "@/hooks/use-collections"
import { toast } from "sonner"
import type { CollectionInfo } from "@/lib/types"

interface NoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  initialTitle?: string
  initialContent?: string
  notePath?: string
  noteCollection?: string | null
  collections?: CollectionInfo[]
  defaultCollection?: string | null
  folderPrefix?: string
}

export function NoteDialog({
  open,
  onOpenChange,
  mode,
  initialTitle = "",
  initialContent = "",
  notePath,
  noteCollection,
  collections,
  defaultCollection,
  folderPrefix,
}: NoteDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [collection, setCollection] = useState<string>("_notes")
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const isPending = createNote.isPending || updateNote.isPending

  // Build collection options: user collections + _notes
  const collectionOptions = (() => {
    const opts: { value: string; label: string }[] = [
      { value: "_notes", label: "Notes (default)" },
    ]
    if (collections) {
      for (const col of collections) {
        if (col.type === "user") {
          opts.push({ value: col.name, label: col.name })
        }
      }
    }
    return opts
  })()

  // Reset form state only when the dialog opens (open transitions false → true)
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setTitle(initialTitle)
      setContent(initialContent)
      // Default to selected collection if it's a user collection, otherwise _notes
      if (mode === "create" && defaultCollection) {
        const isUserCol = collections?.some(
          (c) => c.name === defaultCollection && c.type === "user"
        )
        setCollection(isUserCol ? defaultCollection : "_notes")
      } else if (mode === "edit" && noteCollection) {
        setCollection(noteCollection)
      } else {
        setCollection("_notes")
      }
    }
    prevOpenRef.current = open
  }, [open, initialTitle, initialContent, defaultCollection, collections, mode, noteCollection])

  const handleSave = async () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedTitle) {
      toast.error("Title is required")
      return
    }
    if (!trimmedContent) {
      toast.error("Content is required")
      return
    }

    try {
      if (mode === "edit" && notePath) {
        await updateNote.mutateAsync({
          collection,
          path: notePath,
          title: trimmedTitle,
          content: trimmedContent,
        })
        toast.success("Note updated")
      } else {
        // Determine effective prefix: only use folderPrefix when targeting the same collection it came from
        const effectivePrefix =
          folderPrefix && collection === defaultCollection ? folderPrefix : undefined
        await createNote.mutateAsync({
          title: trimmedTitle,
          content: trimmedContent,
          collection: collection === "_notes" ? undefined : collection,
          prefix: effectivePrefix,
        })
        toast.success("Note created")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save note")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Note" : "New Note"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update this note's title and content."
              : "Create a quick note to add context for the agent."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0 py-2">
          {mode === "create" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Collection</label>
              <Select value={collection} onValueChange={setCollection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {collectionOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {folderPrefix && collection === defaultCollection && (
                <p className="text-xs text-muted-foreground">
                  Location: {collection}/{folderPrefix}/
                </p>
              )}
            </div>
          )}
          <Input
            placeholder="Note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            autoFocus
          />
          <textarea
            className="flex-1 min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            placeholder="Write your note here... (supports markdown)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => { void handleSave() }} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {mode === "edit" ? "Save Changes" : "Create Note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
