import { useVaultHealth } from "@/hooks/use-vault-status"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function ConnectionStatus() {
  const { data, isError } = useVaultHealth()
  const connected = !!data && !isError

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              connected
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]"
            )}
          />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {connected
          ? `Vault daemon running (uptime: ${Math.floor((data?.uptime ?? 0) / 60)}m)`
          : "Vault daemon not reachable. Start with: straja-vault mcp --http"}
      </TooltipContent>
    </Tooltip>
  )
}
