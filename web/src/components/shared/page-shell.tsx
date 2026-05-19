import { cn } from "@/lib/utils"

interface PageShellProps {
  children: React.ReactNode
  /** "contained" = scrollable page with max-w-5xl; "full" = full-viewport with internal scroll */
  variant?: "contained" | "full"
  className?: string
}

export function PageShell({
  children,
  variant = "contained",
  className,
}: PageShellProps) {
  if (variant === "full") {
    return (
      <div className={cn("h-[calc(100vh-3rem)] flex flex-col", className)}>
        {children}
      </div>
    )
  }

  return (
    <div className={cn("max-w-5xl mx-auto px-6 py-8 space-y-6", className)}>
      {children}
    </div>
  )
}
