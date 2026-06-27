import { cn } from "@/lib/utils"
import type { CampaignStatus } from "@/api-types"

interface StatusPillProps {
  status: CampaignStatus
  className?: string
  pulse?: boolean
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft:
    "border-border/60 bg-muted text-muted-foreground",
  waving:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  running:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  paused:
    "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  finished:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  waving: "Waving",
  running: "Running",
  paused: "Paused",
  finished: "Completed",
}

export default function StatusPill({ status, className, pulse }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status],
        className
      )}
    >
      {status === "running" && (
        <span className="relative flex h-2 w-2">
          {pulse !== false && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {STATUS_LABEL[status]}
    </span>
  )
}
