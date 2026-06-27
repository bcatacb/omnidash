import { useCallback, useEffect, useRef, useState } from "react"
import { subscribeRealtime } from "@/lib/realtime"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Link, useNavigate } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import { AlertTriangle, Flame, Megaphone, MoreHorizontal, Pause, Play, Plus, Rocket, Sparkles, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Campaign } from "@/api-types"

let _campaignsCache: Campaign[] | null = null
import StatusPill from "./campaigns/StatusPill"
import WarmupCampaignsTable, { type WarmupCampaignsTableHandle } from "@/components/warmup/WarmupCampaignsTable"
import FrCampaignsTable, { type FrCampaignsTableHandle } from "@/components/fr/FrCampaignsTable"
import NewCampaignWizard from "./campaigns/NewCampaignWizard"

function progressPct(c: Campaign): number {
  // Same model as CampaignDetail: queued is the immutable original count and
  // sent + declined are disjoint terminal states (accepted is a sub-state of
  // sent in FR mode, so don't double-count). "Finished" status overrides to
  // 100 so the badge and progress agree.
  if (c.status === "finished") return 100
  const total = c.totals.queued
  if (total === 0) return 0
  const progressed = c.totals.sent + c.totals.failed
  return Math.round((Math.min(progressed, total) / total) * 100)
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

export default function Campaigns() {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>(_campaignsCache ?? [])
  const [loading, setLoading] = useState(_campaignsCache === null)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [chooserOpen, setChooserOpen] = useState(false)
  const warmupTableRef = useRef<WarmupCampaignsTableHandle | null>(null)
  const frTableRef = useRef<FrCampaignsTableHandle | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/campaigns", { cache: "no-cache" })
      if (!res.ok) throw new Error(`Failed to load campaigns (${res.status})`)
      const data: Campaign[] = await res.json()
      _campaignsCache = data
      setCampaigns(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 30_000)

  // SSE — refresh on campaign activity events
  useEffect(() => subscribeRealtime((e) => {
    try {
      const ev = JSON.parse(e.data) as { type: string }
      if (ev.type === "dm_sent" || ev.type === "dm_replied" || ev.type === "dm_failed" || ev.type === "campaign_finished" || ev.type === "fr_sent" || ev.type === "fr_accepted") {
        void refresh()
      }
    } catch { /* ignore */ }
  }), [refresh])

  // v0.37: Start/Resume now ALSO kicks off async wave-prepare (spaced 5s/call
  // so accounts don't burn) and immediately navigates the operator to the
  // unibox. Resuming a paused campaign does the same — pending leads still
  // need empty DM channels if they didn't get opened the first round.
  const startCampaign = async (c: Campaign) => {
    setBusyId(c.id)
    setCampaigns(prev => prev.map(x => (x.id === c.id ? { ...x, status: "running" } : x)))
    try {
      // v0.71.3 — wave-prepare removed. The warmup engine + extension handle
      // channel creation now (operator IP, not backend). Just flip status →
      // running and the engine auto-fires templates as accounts wave their leads.
      const res = await fetch(`/api/campaigns/${c.id}/start`, { method: "POST" })
      if (!res.ok) throw new Error(`Failed to start (${res.status})`)
      const updated: Campaign = await res.json()
      setCampaigns(prev => prev.map(x => (x.id === c.id ? updated : x)))
      // Drop the operator into the unibox where new empty DMs will show up.
      navigate(`/app/unibox`)
    } catch (err: any) {
      console.warn("[campaigns] start failed:", err?.message || err)
      void refresh()
    } finally {
      setBusyId(null)
    }
  }

  const pauseCampaign = async (c: Campaign) => {
    setBusyId(c.id)
    setCampaigns(prev => prev.map(x => (x.id === c.id ? { ...x, status: "paused" } : x)))
    try {
      const res = await fetch(`/api/campaigns/${c.id}/pause`, { method: "POST" })
      if (!res.ok) throw new Error(`Failed to pause (${res.status})`)
      const updated: Campaign = await res.json()
      setCampaigns(prev => prev.map(x => (x.id === c.id ? updated : x)))
    } catch {
      void refresh()
    } finally {
      setBusyId(null)
    }
  }

  // Two-step typed confirm lives in <DeleteCampaignDialog/>. The menu item
  // opens it via setPendingDelete; the dialog calls performDelete on confirm.
  const deleteCampaign = (c: Campaign) => {
    setPendingDelete(c)
  }
  const performDelete = async (c: Campaign) => {
    setBusyId(c.id)
    setPendingDelete(null)
    // Optimistic remove
    setCampaigns(prev => prev.filter(x => x.id !== c.id))
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete campaign")
      void refresh()
    } finally {
      setBusyId(null)
    }
  }

  const onCreated = (c: Campaign) => {
    setCampaigns(prev => [c, ...prev.filter(x => x.id !== c.id)])
    navigate(`/app/campaigns/${c.id}`)
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Outreach</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Outreach campaigns to scraped leads, run by accounts that have completed warmup. Track delivery, replies, and per-account throughput.
          </p>
        </div>
        <Button onClick={() => setChooserOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New campaign
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 space-y-4">
        <FrCampaignsTable ref={frTableRef} />
        <WarmupCampaignsTable ref={warmupTableRef} />
        {loading && <div className="text-sm text-muted-foreground">Loading campaigns…</div>}

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && campaigns.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-card-foreground shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-[15px] font-medium text-foreground">No outreach campaigns yet</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Create a warmup first, then an outreach campaign to send DMs to your leads.
            </p>
            <Button onClick={() => setChooserOpen(true)} className="mt-4 gap-2">
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </div>
        )}

        {!loading && !error && campaigns.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1 pt-2">
              <Rocket className="h-4 w-4 text-primary" />
              <h2 className="text-[13px] font-semibold text-foreground">Outreach campaigns</h2>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">{campaigns.length}</span>
            </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm mt-1">
            <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground z-10">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Accounts</th>
                  <th className="px-6 py-3 font-medium">Queued</th>
                  <th className="px-6 py-3 font-medium">Sent</th>
                  <th className="px-6 py-3 font-medium">Accepted</th>
                  <th className="px-6 py-3 font-medium">Progress</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.map(c => {
                  const pct = progressPct(c)
                  return (
                    <tr
                      key={c.id}
                      className="group cursor-pointer transition-colors hover:bg-accent/40"
                      onClick={() => navigate(`/app/campaigns/${c.id}`)}
                    >
                      <td className="px-6 py-4">
                        <Link
                          to={`/app/campaigns/${c.id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-[13px] font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-6 py-4 text-[13px] text-foreground">{c.accountIds.length}</td>
                      <td className="px-6 py-4 text-[13px] text-muted-foreground">{c.totals.queued}</td>
                      <td className="px-6 py-4 text-[13px] font-medium text-foreground">{c.totals.sent}</td>
                      <td className="px-6 py-4 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                        {c.totals.replied}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                c.status === "running" ? "bg-primary" : "bg-muted-foreground/40"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[12px] text-muted-foreground">{formatRelative(c.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {c.status === "running" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyId === c.id}
                              onClick={() => pauseCampaign(c)}
                              className="h-7 gap-1 text-[12px]"
                            >
                              <Pause className="h-3.5 w-3.5" /> Pause
                            </Button>
                          ) : c.status === "finished" ? (
                            <span className="px-2 text-[11px] text-muted-foreground">Done</span>
                          ) : (
                            <Button
                              size="sm"
                              disabled={busyId === c.id}
                              onClick={() => startCampaign(c)}
                              className="h-7 gap-1 text-[12px]"
                            >
                              {c.status === "paused" ? (
                                <>
                                  <Play className="h-3.5 w-3.5" /> Resume
                                </>
                              ) : (
                                <>
                                  <Rocket className="h-3.5 w-3.5" /> Start
                                </>
                              )}
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => navigate(`/app/campaigns/${c.id}`)}>
                                View details
                              </DropdownMenuItem>
                              {c.status !== "running" && c.status !== "finished" && (
                                <DropdownMenuItem onClick={() => startCampaign(c)}>
                                  <Play className="h-4 w-4" /> Start
                                </DropdownMenuItem>
                              )}
                              {c.status === "running" && (
                                <DropdownMenuItem onClick={() => pauseCampaign(c)}>
                                  <Pause className="h-4 w-4" /> Pause
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={busyId === c.id}
                                onSelect={(e) => {
                                  e.preventDefault()
                                  void deleteCampaign(c)
                                }}
                              >
                                <Trash2 className="h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
          </>
        )}
      </div>

      <NewCampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={onCreated} />

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>Pick the campaign type.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => { setChooserOpen(false); setWizardOpen(true) }}
              className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <Megaphone className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-semibold">Outreach</div>
              <div className="text-[12px] text-muted-foreground">Send cold DMs to scraped leads using warmed accounts.</div>
            </button>
            <button
              type="button"
              onClick={() => { setChooserOpen(false); warmupTableRef.current?.openWizard() }}
              className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <Flame className="mb-2 h-5 w-5 text-amber-500" />
              <div className="text-sm font-semibold">Warmup</div>
              <div className="text-[12px] text-muted-foreground">Run inter-account chatter to age accounts before outreach.</div>
            </button>
            <button
              type="button"
              onClick={() => { setChooserOpen(false); frTableRef.current?.openWizard() }}
              className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <UserPlus className="mb-2 h-5 w-5 text-blue-500" />
              <div className="text-sm font-semibold">Friend Request</div>
              <div className="text-[12px] text-muted-foreground">Send FRs to server members and DM on acceptance.</div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <DeleteCampaignDialog
        campaign={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={performDelete}
      />
    </div>
  )
}

// ───── DeleteCampaignDialog ──────────────────────────────────────────────────
// v0.59 — simplified to a single-click confirm. Was previously a two-step
// typed-name confirmation; operator found it annoying. Single-button click
// is enough friction for a draft-table delete that's reversible via recreate.
function DeleteCampaignDialog({
  campaign,
  onCancel,
  onConfirm,
}: {
  campaign: Campaign | null
  onCancel: () => void
  onConfirm: (c: Campaign) => void
}) {
  const open = campaign !== null
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-chip bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
              <AlertTriangle className="h-3 w-3" /> Destructive
            </span>
          </div>
          <DialogTitle>Delete warmup</DialogTitle>
          <DialogDescription>
            {campaign && (
              <>Permanently delete <strong>"{campaign.name}"</strong> and its {campaign.totals.queued.toLocaleString()} queued / {campaign.totals.sent.toLocaleString()} sent leads. Existing Unibox conversations stay.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 flex justify-end gap-2"
          onKeyDown={(e) => {
            if (e.key === "Enter" && campaign) onConfirm(campaign)
            if (e.key === "Escape") onCancel()
          }}
        >
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant="destructive"
            autoFocus
            onClick={() => { if (campaign) onConfirm(campaign) }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
