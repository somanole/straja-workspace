import { useEffect } from "react"
import { useUIStore } from "@/stores/ui-store"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      root.classList.add(mq.matches ? "dark" : "light")

      const handler = (e: MediaQueryListEvent) => {
        root.classList.remove("light", "dark")
        root.classList.add(e.matches ? "dark" : "light")
      }
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  return <>{children}</>
}
