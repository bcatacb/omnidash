import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { Link } from "react-router-dom"
import { Pause, Play, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FrCampaign } from "@/api-types"
import FrCampaignWizard from "./FrCampaignWizard"

export interface FrCampaignsTableHandle {
  openWizard: () => void
}

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  running:   "bg-emerald-500/15 text-emerald-500",
  paused:    "bg-amber-500/15 text-amber-500",
  draft:     "bg-muted text-muted-foreground",
  completed: "bg-blue-500/15 text-blue-400",
}

const MODE_LABELS: Record<string, string> = {
  fr_only:    "FR only",
  dm_then_fr: "DM → FR",
  fr_then_dm: "FR → DM",
}

const FrCampaignsTable = forwardRef<FrCampaignsTableHandle>((_props, ref) => {
  const [rows, setRows] = useState<FrCampaign[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = () =>
    fetch("/api/fr-campaigns")
      .then((r) => r.json())
      .then((j) => setRows(Array.isArray(j) ? j : []))
      .catch(() => {})

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [])

  useImperativeHandle(ref, () => ({ openWizard: () => setWizardOpen(true) }), [])

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: status as FrCampaign["status"] } : r)))
    try {
      await fetch(`/api/fr-campaigns/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    } finally {
      setBusyId(null)
      refresh()
    }
  }

  if (rows.length === 0) return (
    <>
      {wizardOpen && (
        <FrCampaignWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => { setWizardOpen(false); refresh() }}
        />
      )}
    </>
  )

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10">
          <UserPlus className="h-3.5 w-3.5 text-blue-500" />
        </div>
        <h2 className="text-[13px] font-semibold text-foreground">Friend Request</h2>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
          {rows.length}
        </span>
      </div>

      <table className="w-full text-[12px]">
        <thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left">Campaign</th>
            <th className="px-4 py-2 text-left">Mode</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Cap / day</th>
            <th className="px-4 py-2 text-left">Interval</th>
            <th className="px-4 py-2 text-right pr-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="group hover:bg-accent/30 transition-colors">
              <td className="px-4 py-3">
                <Link
                  to={`/app/campaigns/fr/${r.id}`}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {r.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
                  {MODE_LABELS[r.mode] ?? r.mode}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold capitalize", CAMPAIGN_STATUS_STYLES[r.status] ?? "bg-muted text-muted-foreground")}>
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {r.fr_per_account_per_day} FR
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {r.min_interval_seconds}–{r.max_interval_seconds}s
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {r.status === "running" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 text-[11px]"
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, "paused")}
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </Button>
                  ) : r.status !== "completed" ? (
                    <Button
                      size="sm"
                      className="h-6 gap-1 text-[11px]"
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, "running")}
                    >
                      <Play className="h-3 w-3" />
                      {r.status === "paused" ? "Resume" : "Start"}
                    </Button>
                  ) : null}
                  <Link
                    to={`/app/campaigns/fr/${r.id}`}
                    className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Open →
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {wizardOpen && (
        <FrCampaignWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => { setWizardOpen(false); refresh() }}
        />
      )}
    </section>
  )
})
FrCampaignsTable.displayName = "FrCampaignsTable"
export default FrCampaignsTable
