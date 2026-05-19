import { useEffect, useRef, useState } from "react"

const TIPS = [
  "Your PIN stays on this machine. Always. We pinky-promise.",
  "Everything in the workspace is encrypted on disk. Even when you're not looking.",
  "Straja means \"guard\" in Romanian. Now you know!",
  "You can search across all your collections at once. Pretty handy.",
  "AI agents can only browse websites you've approved. No sneaky detours.",
  "Every file gets a short ID like #a1b2c3. Think of it as a speed dial for docs.",
  "The workspace locks itself every time the daemon restarts. Better safe than sorry.",
  "Fun fact: the search engine blends keyword matching with AI-powered similarity.",
  "Browser sessions are sandboxed. Cookies don't survive between tasks. Poof.",
  "Straja checks outgoing text for leaked secrets before anything leaves the workspace.",
  "You can connect any AI assistant that supports MCP. That's most of them now.",
  "Collections index your files automatically. Just point and go.",
  "The green dot means your workspace daemon is alive. The red one\u2026 less so.",
  "Uploads are disabled by default. Trust is earned, not assumed.",
  "Your workspace database uses SQLCipher. Same encryption banks use. No biggie.",
  "Straja was built for people who care about where their data lives.",
  "Every action an agent takes gets logged in the audit trail. No exceptions.",
  "The workspace runs entirely on your machine. No cloud. No surprises.",
  "Cross-domain redirects are blocked by default. Phishing? Not today.",
  "You can lock the workspace from the Settings page whenever you step away.",
  "Tip: press \u2318K from anywhere to open the quick search.",
  "Large documents get split into smart chunks that respect headings and sections.",
  "Agents can run code, but only in a sandboxed environment with no network access.",
  "Straja was designed with one rule: the workspace is the boundary.",
  "Your files, your rules. Agents are guests here.",
  "Form submissions go through a guard that catches passwords, API keys, and more.",
  "Here's a life tip: drink water. Also, your workspace is almost ready.",
  "Each collection can have its own context description to help search understand it better.",
  "Patience is a virtue. Your encrypted workspace is worth the wait.",
] as const

const TIP_INTERVAL_MS = 5_000
const FADE_DURATION_MS = 300

export function VaultTips({ active }: { active: boolean }) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * TIPS.length)
  )
  const [fading, setFading] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return

    const interval = setInterval(() => {
      setFading(true)
      timeoutRef.current = setTimeout(() => {
        setIndex((prev) => (prev + 1) % TIPS.length)
        setFading(false)
      }, FADE_DURATION_MS)
    }, TIP_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [active])

  if (!active) return null

  return (
    <div className="mt-4 flex items-start gap-2.5 min-h-[3rem]">
      <span className="text-muted-foreground/50 text-[10px] font-medium uppercase tracking-wider mt-0.5 shrink-0">
        tip
      </span>
      <p
        className={`text-xs text-muted-foreground/80 leading-relaxed transition-all duration-300 ${
          fading ? "opacity-0 -translate-y-1" : "opacity-100 translate-y-0"
        }`}
      >
        {TIPS[index]}
      </p>
    </div>
  )
}
