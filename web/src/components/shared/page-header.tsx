import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string | React.ReactNode
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div>
        {typeof title === "string" ? (
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        ) : (
          title
        )}
        {description && (
          <p className="text-muted-foreground text-sm mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
