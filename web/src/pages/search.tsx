import { useState, useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router"
import {
  Search,
  MessageSquare,
  List,
  FileText,
  Loader2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownRenderer } from "@/components/viewer/markdown-renderer"
import { EmptyState } from "@/components/shared/empty-state"
import { PageShell } from "@/components/shared/page-shell"
import { useSearch, useAnswer } from "@/hooks/use-search"
import { useVaultStatus } from "@/hooks/use-vault-status"
import type { DetailLevel, SearchResult } from "@/lib/types"

export function SearchPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: status } = useVaultStatus()

  const [query, setQuery] = useState(searchParams.get("q") ?? "")
  const [mode, setMode] = useState<"ask" | "search">("ask")
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("balanced")
  const [collectionFilter, setCollectionFilter] = useState<string>("all")

  const searchMut = useSearch()
  const answerMut = useAnswer()

  const isSearching = searchMut.isPending || answerMut.isPending

  // Clear stale results when switching modes
  const handleModeChange = (newMode: "ask" | "search") => {
    setMode(newMode)
    searchMut.reset()
    answerMut.reset()
  }

  // Auto-search if query comes from URL
  useEffect(() => {
    const q = searchParams.get("q")
    if (q && q.trim()) {
      setQuery(q)
      handleSubmit(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (q?: string) => {
    const searchQuery = (q ?? query).trim()
    if (!searchQuery) return

    const collections =
      collectionFilter === "all" ? undefined : [collectionFilter]

    if (mode === "ask") {
      searchMut.reset()
      answerMut.mutate({
        question: searchQuery,
        collections,
        detailLevel,
        limit: 5,
      })
    } else {
      answerMut.reset()
      searchMut.mutate({
        searches: [
          { type: "lex", query: searchQuery },
          { type: "vec", query: searchQuery },
          { type: "hyde", query: searchQuery },
        ],
        collections,
        limit: 20,
      })
    }
  }

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSubmit()
  }

  // Only show results from the active mode
  const results = mode === "ask"
    ? answerMut.data?.sources ?? []
    : searchMut.data?.results ?? []
  const answerText = mode === "ask" ? answerMut.data?.answer : undefined

  return (
    <PageShell>
      {/* Search input */}
      <form onSubmit={onFormSubmit} className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder={
              mode === "ask"
                ? "Ask a question about your documents..."
                : "Search across all documents..."
            }
            className="pl-11 h-12 text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Tabs
            value={mode}
            onValueChange={(v) => handleModeChange(v as "ask" | "search")}
          >
            <TabsList className="h-8">
              <TabsTrigger value="ask" className="text-xs gap-1.5 px-3">
                <MessageSquare className="h-3.5 w-3.5" />
                Ask
              </TabsTrigger>
              <TabsTrigger value="search" className="text-xs gap-1.5 px-3">
                <List className="h-3.5 w-3.5" />
                Search
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select
            value={collectionFilter}
            onValueChange={setCollectionFilter}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="All collections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All collections</SelectItem>
              {status?.collections.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mode === "ask" && (
            <Select
              value={detailLevel}
              onValueChange={(v) => setDetailLevel(v as DetailLevel)}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={!query.trim() || isSearching}
            className="ml-auto"
          >
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "ask" ? (
              "Ask"
            ) : (
              "Search"
            )}
          </Button>
        </div>
      </form>

      {/* Loading state */}
      {isSearching && (
        <div className="space-y-3">
          {mode === "ask" && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          )}
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {/* Answer panel */}
      {!isSearching && answerText && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Answer</span>
            </div>
            <MarkdownRenderer content={answerText} />
            {results.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <span className="text-xs font-medium text-muted-foreground">
                  Sources
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {results.map((r, i) => (
                    <Badge
                      key={r.docid}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-secondary/80"
                      onClick={() => {
                        const parts = r.file.split("/")
                        const collection = parts[0]
                        const filePath = parts.slice(1).join("/")
                        // Encode # so it becomes part of the URL path, not a fragment
                        navigate(
                          `/collections/${collection}/${filePath.replace(/#/g, "%23")}`
                        )
                      }}
                    >
                      [{i + 1}] {r.title || r.file}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search results */}
      {!isSearching && results.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {answerText ? "Source Documents" : "Results"} ({results.length})
          </h3>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2">
              {results.map((result) => (
                <ResultCard
                  key={result.docid + result.file}
                  result={result}
                  onClick={() => {
                    const parts = result.file.split("/")
                    if (parts.length >= 2) {
                      const collection = parts[0]
                      const filePath = parts.slice(1).join("/")
                      navigate(
                        `/collections/${collection}/${filePath.replace(/#/g, "%23")}`
                      )
                    }
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Empty state */}
      {!isSearching &&
        !answerText &&
        results.length === 0 &&
        (mode === "search" ? searchMut.isSuccess : answerMut.isSuccess) && (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="No results found"
            description="Try a different query or broaden your search"
          />
        )}

      {/* Initial state */}
      {!isSearching &&
        !(mode === "search" ? searchMut.isSuccess : answerMut.isSuccess) && (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="Search your vault"
            description={
              mode === "ask"
                ? "Ask a question and get an AI-generated answer from your documents"
                : "Find documents across all your collections using hybrid search"
            }
          />
        )}
    </PageShell>
  )
}

function ResultCard({
  result,
  onClick,
}: {
  result: SearchResult
  onClick: () => void
}) {
  return (
    <Card
      className="cursor-pointer hover:bg-secondary/30 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">
                {result.title || result.file}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground truncate">
                {result.file}
              </span>
              <Badge variant="outline" className="text-[10px] font-mono h-4 px-1">
                {result.docid}
              </Badge>
            </div>
            {result.snippet && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {result.snippet.replace(/^\d+:\s*/gm, "")}
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <div
              className="h-1.5 rounded-full bg-primary/20"
              style={{ width: 48 }}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round(result.score * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-8 text-right">
              {Math.round(result.score * 100)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
