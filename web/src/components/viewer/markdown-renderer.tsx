import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"

interface MarkdownRendererProps {
  content: string
  className?: string
}

/** Labels to display for known frontmatter keys (in order). */
const FRONTMATTER_LABELS: Record<string, string> = {
  from: "From",
  to: "To",
  cc: "Cc",
  date: "Date",
  date_range: "Date range",
  subject: "Subject",
  participants: "Participants",
  message_count: "Messages",
  labels: "Labels",
  thread_id: "Thread ID",
  message_id: "Message ID",
}

/** Display order for frontmatter keys. */
const FRONTMATTER_ORDER = Object.keys(FRONTMATTER_LABELS)

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null

  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key && val) meta[key] = val
  }
  if (Object.keys(meta).length === 0) return null
  return { meta, body: match[2] }
}

function FrontmatterHeader({ meta }: { meta: Record<string, string> }) {
  // Sort keys by the defined display order; unknown keys go at the end.
  const keys = Object.keys(meta).sort((a, b) => {
    const ai = FRONTMATTER_ORDER.indexOf(a)
    const bi = FRONTMATTER_ORDER.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return (
    <div className="rounded-md border bg-muted/40 px-4 py-3 mb-4 text-sm space-y-1.5">
      {keys.map((key) => (
        <div key={key} className="flex gap-2">
          <span className="font-medium text-muted-foreground shrink-0 w-24 text-right">
            {FRONTMATTER_LABELS[key] ?? key}
          </span>
          <span className="text-foreground break-all">{meta[key]}</span>
        </div>
      ))}
    </div>
  )
}

/** Try to detect and pretty-print JSON or JSONL content. */
function tryFormatJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null

  // Single JSON object / array
  try {
    const obj = JSON.parse(trimmed)
    return JSON.stringify(obj, null, 2)
  } catch {
    // Fall through to JSONL detection
  }

  // JSONL — each non-empty line is a JSON object
  const lines = trimmed.split("\n").filter((l) => l.trim())
  if (lines.length < 2) return null
  try {
    const formatted = lines.map((line) => JSON.stringify(JSON.parse(line), null, 2))
    return formatted.join("\n\n")
  } catch {
    return null
  }
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const parsed = useMemo(() => parseFrontmatter(content), [content])
  const jsonFormatted = useMemo(() => (parsed ? null : tryFormatJson(content)), [content, parsed])

  // JSON content → syntax-highlighted code block
  if (jsonFormatted) {
    return (
      <div className={className}>
        <pre className="rounded-md border bg-muted p-4 overflow-auto text-sm">
          <code className="language-json">{jsonFormatted}</code>
        </pre>
      </div>
    )
  }

  const body = parsed ? parsed.body : content

  return (
    <div className={className}>
      {parsed && <FrontmatterHeader meta={parsed.meta} />}
      <div className="prose prose-neutral dark:prose-invert max-w-none prose-sm
        prose-headings:font-semibold prose-headings:tracking-tight
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-code:before:content-none prose-code:after:content-none
        prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
        prose-pre:bg-muted prose-pre:border prose-pre:border-border">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  )
}
