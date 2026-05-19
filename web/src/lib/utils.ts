import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Consistent status → color class mapping used across the entire app.
 * Returns Tailwind classes for bg, text, and border.
 */
export function statusColor(
  status: string,
): { bg: string; text: string; border: string; dot: string } {
  switch (status) {
    case "allowed":
    case "connected":
    case "completed":
    case "enabled":
    case "active":
    case "ready":
    case "healthy":
    case "success":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-700 dark:text-emerald-400",
        border: "border-emerald-500/25",
        dot: "bg-emerald-500",
      }
    case "blocked":
    case "failed":
    case "error":
    case "auth_error":
    case "destructive":
      return {
        bg: "bg-red-500/10",
        text: "text-red-700 dark:text-red-400",
        border: "border-red-500/25",
        dot: "bg-red-500",
      }
    case "running":
    case "in_progress":
    case "pending":
    case "info":
      return {
        bg: "bg-sky-500/10",
        text: "text-sky-700 dark:text-sky-400",
        border: "border-sky-500/25",
        dot: "bg-sky-500",
      }
    case "warning":
    case "scheduled":
    case "paused":
    case "locked":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-700 dark:text-amber-400",
        border: "border-amber-500/25",
        dot: "bg-amber-500",
      }
    default:
      return {
        bg: "bg-muted",
        text: "text-muted-foreground",
        border: "border-border",
        dot: "bg-muted-foreground/30",
      }
  }
}

/** Shorthand: returns combined badge classes for a status string */
export function statusBadgeClass(status: string): string {
  const c = statusColor(status)
  return `${c.bg} ${c.text} ${c.border}`
}
