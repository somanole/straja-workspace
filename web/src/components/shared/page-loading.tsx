import { Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface PageLoadingProps {
  /** "skeleton" = card grid skeletons; "spinner" = centered spinner */
  variant?: "skeleton" | "spinner"
  /** Number of skeleton cards to show (default 3) */
  count?: number
  /** Text to show next to spinner (default "Loading...") */
  message?: string
}

export function PageLoading({
  variant = "skeleton",
  count = 3,
  message = "Loading...",
}: PageLoadingProps) {
  if (variant === "spinner") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {message}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  )
}
