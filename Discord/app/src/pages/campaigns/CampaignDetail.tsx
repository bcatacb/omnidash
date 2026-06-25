import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { subscribeRealtime } from "@/lib/realtime"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Link, useNavigate, useParams } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import {
  ArrowLeft,
  ExternalLink,
  Inbox,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Rocket,
  Send,
  StopCircle,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useNotify } from "@/components/ui/confirm"
import { cn } from "@/lib/utils"
import type {
  Campaign,
  CampaignWithLeads,
  DiscordAccount,
  Lead,
  LeadStatus,
  RealtimeEvent,
} from "@/api-types"
import StatusPill from "./StatusPill"

const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  pending: "border-border/60 bg-muted text-muted-foreground",
  waving:  "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  sent:    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  replied: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed:  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

function LeadStatusPill({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        LEAD_STATUS_STYLES[status]
      )}
    >
      {status}
    </span>
  )
}

interface FeedEntry {
  id: string
  ts: string
  type: RealtimeEvent["type"] | "captcha_triggered" | "warmup_account_dead" | "warmup_rate_limited" | "warmup_pair_paused" | "warmup_daily_cap"
  leadId?: string
  conversationId?: string
  accountId?: string
  partnerId?: string
  reason?: string
  nextSendAt?: string | null
  accountsInCooldown?: number
  accountsReady?: number
  cooldownMinutes?: number
  sendsToday?: number
  cap?: number
}

const MAX_FEED = 200

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<CampaignWithLeads | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const notify = useNotify()
  // lookup: leadId -> conversationId once accepted
  const [conversationByLead, setConversationByLead] = useState<Record<string, string>>({})
  const feedEndRef = useRef<HTMLDivElement>(null)
  // v0.33 — per-account stats + suspension state. Polled alongside the main refresh.
  const [accountStats, setAccountStats] = useState<Array<{
    accountId: string
    queued: number
    sent: number
    replied: number
    failed: number
    suspended: boolean
    suspensionReason: string | null
    unassigned: boolean
  }>>([])

  const refresh = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      if (!res.ok) throw new Error(`Failed to load campaign (${res.status})`)
      const c: CampaignWithLeads = await res.json()
      setData(c)
      // Backfill the live event feed from each lead's current state. SSE only
      // streams events that fire WHILE the page is open — without this, an
      // operator navigating to a campaign whose sends already happened would
      // see an empty feed even though the totals show sent/failed/etc.
      const synth: FeedEntry[] = []
      for (const l of c.leads) {
        const ts = l.sentAt || l.createdAt
        if (l.status === "sent" || l.status === "replied") {
          synth.push({ id: `init-${l.id}-sent`, ts, type: "dm_sent", leadId: l.id })
        } else if (l.status === "failed") {
          synth.push({ id: `init-${l.id}-fail`, ts, type: "dm_failed", leadId: l.id })
        }
      }
      synth.sort((a, b) => a.ts.localeCompare(b.ts))
      setFeed(synth.slice(-MAX_FEED))
      // v0.33 — pull per-account stats. Accounts list is fetched once by the
      // existing useEffect below.
      const statsRes = await fetch(`/api/campaigns/${id}/account-stats`)
      if (statsRes.ok) {
        const j = await statsRes.json()
        setAccountStats(Array.isArray(j?.stats) ? j.stats : [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaign")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useAutoRefresh(refresh, 30_000)

  // SSE: filter to this campaign's events, update feed + lead state inline
  useEffect(() => {
    if (!id) return
    return subscribeRealtime((raw) => {
      let ev: RealtimeEvent
      try {
        ev = JSON.parse(raw.data) as RealtimeEvent
      } catch {
        return
      }
      if (!("campaignId" in ev) || ev.campaignId !== id) return

      if (ev.type === "dm_sending") {
        setFeed(prev => {
          const next: FeedEntry = {
            id: `${ev.ts}-${ev.leadId}-dm_sending`,
            ts: ev.ts,
            type: "dm_sending",
            leadId: ev.leadId,
            accountId: ev.accountId,
          }
          const merged = [...prev, next]
          return merged.length > MAX_FEED ? merged.slice(merged.length - MAX_FEED) : merged
        })
      } else if (ev.type === "campaign_waiting") {
        setFeed(prev => {
          const filtered = prev.filter(f => f.type !== "campaign_waiting")
          const next: FeedEntry = {
            id: `waiting-${ev.ts}`,
            ts: ev.ts,
            type: "campaign_waiting",
            nextSendAt: ev.nextSendAt,
            accountsInCooldown: ev.accountsInCooldown,
            accountsReady: ev.accountsReady,
          }
          return [...filtered, next].slice(-MAX_FEED)
        })
      } else if (
        ev.type === "dm_sent" ||
        ev.type === "dm_replied" ||
        ev.type === "dm_failed"
      ) {
        setFeed(prev => {
          const filtered = prev.filter(f => !(f.type === "dm_sending" && f.leadId === ev.leadId))
          const next: FeedEntry = {
            id: `${ev.ts}-${ev.leadId}-${ev.type}`,
            ts: ev.ts,
            type: ev.type,
            leadId: ev.leadId,
            accountId: "accountId" in ev ? ev.accountId : undefined,
            conversationId: ev.type === "dm_replied" ? ev.conversationId : undefined,
            reason: "reason" in ev ? (ev as any).reason : undefined,
          }
          const merged = [...filtered, next]
          return merged.length > MAX_FEED ? merged.slice(merged.length - MAX_FEED) : merged
        })
        setData(prev => {
          if (!prev) return prev
          let touched = false
          const leads = prev.leads.map(l => {
            if (l.id !== ev.leadId) return l
            touched = true
            const nextStatus: LeadStatus =
              ev.type === "dm_sent" ? "sent" : ev.type === "dm_replied" ? "replied" : "failed"
            return { ...l, status: nextStatus }
          })
          if (!touched) return prev
          const totals = { ...prev.totals }
          if (ev.type === "dm_sent") totals.sent += 1
          else if (ev.type === "dm_replied") totals.replied += 1
          else totals.failed += 1
          return { ...prev, leads, totals }
        })
        if (ev.type === "dm_replied") {
          setConversationByLead(prev => ({ ...prev, [ev.leadId]: ev.conversationId }))
        }
      } else if (ev.type === "campaign_finished") {
        setData(prev => (prev ? { ...prev, status: "finished" } : prev))
        setFeed(prev => [...prev.filter(f => f.type !== "campaign_waiting"), {
          id: `${ev.ts}-finished`,
          ts: ev.ts,
          type: "campaign_finished" as const,
        }].slice(-MAX_FEED))
      } else if (ev.type === "campaign_paused") {
        setData(prev => (prev ? { ...prev, status: "paused" } : prev))
        setFeed(prev => [...prev.filter(f => f.type !== "campaign_waiting"), {
          id: `${ev.ts}-paused`,
          ts: ev.ts,
          type: "campaign_paused" as const,
          reason: ev.reason,
        }].slice(-MAX_FEED))
      } else if (
        ev.type === "captcha_triggered" ||
        ev.type === "warmup_account_dead" ||
        ev.type === "warmup_rate_limited" ||
        ev.type === "warmup_pair_paused" ||
        ev.type === "warmup_daily_cap"
      ) {
        setFeed(prev => {
          const next: FeedEntry = {
            id: `${ev.ts}-${ev.type}-${ev.accountId ?? ""}`,
            ts: ev.ts,
            type: ev.type as FeedEntry["type"],
            accountId: ev.accountId,
            reason: ev.reason,
            ...(ev.type === "warmup_rate_limited" ? { cooldownMinutes: ev.cooldownMinutes } : {}),
            ...(ev.type === "warmup_daily_cap" ? { sendsToday: ev.sendsToday, cap: ev.cap } : {}),
          }
          const merged = [...prev, next]
          return merged.length > MAX_FEED ? merged.slice(merged.length - MAX_FEED) : merged
        })
      }
    })
  }, [id])

  // Auto-scroll feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [feed.length])

  const resumeAccount = async (accountId: string) => {
    if (!id) return
    const res = await fetch(`/api/campaigns/${id}/accounts/${accountId}/resume`, { method: "POST" })
    if (res.ok) void refresh()
  }

  // v0.37 — Click Start: kick off async DM-channel prep (spaced 5s/call so
  // accounts don't get flagged) + flip the campaign to running + bounce to
  // the unibox so the operator can wave from there.  Engine auto-fires
  // templates on warm (v0.35), so no modal needed.
  const startSimpleFlow = async () => {
    if (!data) return
    setBusy(true)
    try {
      // v0.71.3 — wave-prepare removed. Warmup engine + extension handle
      // channel creation. Just flip the campaign to running.
      await fetch(`/api/campaigns/${data.id}/start`, { method: "POST" })
      void refresh()
      setBusy(false)
    } catch (err: any) {
      void notify({
        title: "Campaign start failed",
        description: err?.message || "Unknown error",
        variant: "error",
      })
      setBusy(false)
    }
  }

  const doAction = async (action: "start" | "pause", optimisticStatus: Campaign["status"]) => {
    if (!data) return
    setBusy(true)
    setData(prev => (prev ? { ...prev, status: optimisticStatus } : prev))
    try {
      const res = await fetch(`/api/campaigns/${data.id}/${action}`, { method: "POST" })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const updated: Campaign = await res.json()
      setData(prev => (prev ? { ...prev, ...updated } : prev))
    } catch {
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  const progress = useMemo(() => {
    if (!data) return 0
    if (data.status === "finished") return 100
    const t = data.totals
    const total = t.queued
    if (total === 0) return 0
    const progressed = t.sent + t.failed  // replied is a subset of sent, don't add
    return Math.round((Math.min(progressed, total) / total) * 100)
  }, [data])

  const pendingNow = useMemo(() => {
    if (!data) return 0
    return data.leads.filter((l) => l.status === "pending" || l.status === "waving").length
  }, [data])

  // Fetch the global accounts list once so we can map accountId -> @username
  // in the activity feed (and in the leads table). Falls back to the short
  // account id if the fetch hasn't resolved or an unknown id appears.
  const [accountsList, setAccountsList] = useState<DiscordAccount[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((j: DiscordAccount[]) => { if (!cancelled && Array.isArray(j)) setAccountsList(j) })
      .catch(() => { /* ignore — fall back to ids */ })
    return () => { cancelled = true }
  }, [])
  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {}
    // Seed with short ids so callers always get a value back even before
    // /api/accounts resolves.
    if (data) for (const aid of data.accountIds) map[aid] = aid
    for (const a of accountsList) map[a.id] = a.username || a.label || a.id
    return map
  }, [data, accountsList])

  // Pull guild source from any lead — the wizard writes the SAME source string
  // to every lead during a campaign create, so the first one is representative.
  // Format: "guilds:ID1|urlencoded-NAME1,ID2|urlencoded-NAME2" (new) OR
  //         "guilds:ID1,ID2" (legacy — names absent, we fall back to ids).
  const sourceGuilds = useMemo(() => {
    if (!data || data.leads.length === 0) return [] as { id: string; name: string }[]
    const raw = data.leads[0]?.source || ""
    if (!raw.startsWith("guilds:")) return []
    return raw.slice("guilds:".length).split(",").filter(Boolean).map((piece) => {
      const [id, encName] = piece.split("|")
      let name = id
      if (encName) {
        try { name = decodeURIComponent(encName) || id } catch { name = id }
      }
      return { id: String(id || "").trim(), name: String(name || "").trim() }
    }).filter((g) => g.id)
  }, [data])
  const sourceGuildsLabel = useMemo(() => {
    if (sourceGuilds.length === 0) return ""
    return sourceGuilds.map((g) => g.name).join(", ")
  }, [sourceGuilds])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading campaign…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <Button variant="ghost" onClick={() => navigate("/app/campaigns")} className="mb-4 gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
          {error || "Campaign not found."}
        </div>
      </div>
    )
  }

  const isRunning = data.status === "running"
  const isPaused = data.status === "paused"
  const isDraft = data.status === "draft"
  const isFinished = data.status === "finished"
  const queued = data.totals.queued
  const rateHr = data.rateLimit.perHour

  // v0.33 — derive per-account state for the start UI.
  const activeAccountStats = accountStats.filter((s) => !s.unassigned)
  const suspendedAccounts = activeAccountStats.filter((s) => s.suspended)

  const queuedAcrossAccounts = activeAccountStats.reduce((n, s) => n + s.queued, 0)
  const avgPerAccount = activeAccountStats.length > 0
    ? Math.round(queuedAcrossAccounts / activeAccountStats.length)
    : 0

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border bg-background px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <button
            onClick={() => navigate("/app/campaigns")}
            className="mb-1 inline-flex h-8 items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{data.name}</h1>
            <StatusPill status={data.status} pulse />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-[12px]">
            {data.accountIds.length} account{data.accountIds.length === 1 ? "" : "s"} · {data.rateLimit.perHour}/hr ·{" "}
            {data.rateLimit.perDay}/day · created {formatDistanceToNow(new Date(data.createdAt), { addSuffix: true })}
            {sourceGuildsLabel && (
              <> · scraped from <span className="text-foreground/80">{sourceGuildsLabel}</span></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {(isDraft || isPaused) && (
            <div className="flex flex-col items-end gap-1">
              <p className="text-right text-[11px] text-muted-foreground">
                Ready to send{" "}
                <span className="font-semibold text-foreground">{queued}</span> message
                {queued === 1 ? "" : "s"}
                {activeAccountStats.length > 0 && (
                  <> across{" "}
                    <span className="font-semibold text-foreground">{activeAccountStats.length}</span> account
                    {activeAccountStats.length === 1 ? "" : "s"}
                    {avgPerAccount > 0 && <> (~{avgPerAccount} each)</>}
                  </>
                )}{" "}
                at <span className="font-semibold text-foreground">{rateHr}/hr</span>
              </p>
              {suspendedAccounts.length > 0 && (
                <p className="text-right text-[11px] text-rose-600 dark:text-rose-300">
                  ⚠ {suspendedAccounts.length} account{suspendedAccounts.length === 1 ? "" : "s"} suspended — see table below
                </p>
              )}
              <Button
                size="lg"
                disabled={busy || queued === 0}
                onClick={() => {
                  if (isPaused) {
                    doAction("start", "running")
                  } else {
                    void startSimpleFlow()
                  }
                }}
                className="gap-2 bg-primary shadow-lg shadow-primary/20 hover:bg-primary/90"
              >
                {isPaused ? (
                  <>
                    <Play className="h-4 w-4 fill-current" /> Resume
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" /> Start campaign
                  </>
                )}
              </Button>
            </div>
          )}
          {isRunning && (
            <Button
              size="lg"
              disabled={busy}
              onClick={() => doAction("pause", "paused")}
              className="gap-2 bg-primary shadow-lg shadow-primary/20 hover:bg-primary/90"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Running… <Pause className="h-4 w-4" />
            </Button>
          )}
          {isFinished && (
            <Button size="lg" variant="outline" disabled className="gap-2">
              <StopCircle className="h-4 w-4" /> Finished
            </Button>
          )}
        </div>
      </div>

      {/* Body — stats + leads (left), live feed (right) */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 sm:p-6 lg:grid-cols-[1fr_360px] lg:gap-6">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {/* Stats cards — uniform 4-card grid */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <StatCard label="Pending" value={pendingNow} icon={<Inbox className="h-4 w-4" />} tone="muted" />
            <StatCard label="Sent" value={data.totals.sent} icon={<Send className="h-4 w-4" />} tone="blue" />
            <StatCard label="Replied" value={data.totals.replied} icon={<MessageSquare className="h-4 w-4" />} tone="emerald" />
            <StatCard label="Progress" value={`${progress}%`} icon={<Users className="h-4 w-4" />} tone="muted" />
          </div>

          {/* Progress bar */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="font-medium text-foreground">Campaign progress</span>
              <span className="tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  isRunning ? "bg-primary" : "bg-muted-foreground/40"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* v0.33 — Per-account split */}
          {accountStats.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-[13px] font-medium text-foreground">Per-account split</div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Account</th>
                    <th className="pb-2 text-right font-medium">Queued</th>
                    <th className="pb-2 text-right font-medium">Sent</th>
                    <th className="pb-2 text-right font-medium">Replied</th>
                    <th className="pb-2 text-right font-medium">Failed</th>
                    <th className="pb-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {accountStats.map((s) => {
                    const acct = accountsList.find((a) => a.id === s.accountId)
                    const displayName = acct?.label || acct?.username || s.accountId.slice(0, 10)
                    const label = s.unassigned ? "unassigned" : displayName
                    return (
                      <tr
                        key={s.accountId || "_unassigned"}
                        className="border-t border-border/40"
                      >
                        <td className="py-1.5">{label}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.queued}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.sent}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.replied}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.failed}</td>
                        <td className="py-1.5 pl-3">
                          {s.unassigned ? (
                            <span className="text-amber-700 dark:text-amber-300">orphaned</span>
                          ) : s.suspended ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-rose-700 dark:text-rose-300">suspended</span>
                              <span className="text-muted-foreground text-[10px]" title={s.suspensionReason || ""}>
                                {(s.suspensionReason || "").slice(0, 40)}
                              </span>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => resumeAccount(s.accountId)}>
                                Resume
                              </Button>
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-300">active</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Leads table */}
          <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm">
            <div className="border-b border-border px-4 py-3 text-[13px] font-semibold text-foreground">
              Leads ({data.leads.length})
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Discord ID</th>
                    <th className="px-4 py-2.5 font-medium">Display name</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Account</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.leads.map(l => (
                    <LeadRow
                      key={l.id}
                      lead={l}
                      accountLabel={l.assignedAccountId ? accountLabelById[l.assignedAccountId] : null}
                      conversationId={conversationByLead[l.id] ?? null}
                    />
                  ))}
                  {data.leads.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                        No leads in this campaign.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Live feed */}
        <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-[#0b0f17] text-emerald-300 shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[12px] font-medium text-foreground">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60",
                    isRunning && "animate-ping"
                  )}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Activity
            </span>
            <span className="text-[11px] text-muted-foreground">{feed.length} {feed.length === 1 ? "event" : "events"}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed">
            {feed.length === 0 ? (
              <div className="text-muted-foreground">
                Nothing yet. {isDraft
                  ? "Click Start to begin — sends will appear here in real time."
                  : isRunning
                    ? "The engine is between sends. Each delivery and any issues will show up here as they happen."
                    : "When the campaign runs, every send and error will show up here."}
              </div>
            ) : (
              feed.map(f => {
                const lead = f.leadId ? data?.leads.find(l => l.id === f.leadId) : undefined
                // Prefer the accountId directly on the feed entry (from dm_sending/fr_sent/fr_declined),
                // fall back to the lead's assigned account for older events.
                const acctId = f.accountId ?? lead?.assignedAccountId
                const acctLabel = acctId ? accountLabelById[acctId] : undefined
                return (
                  <FeedLine
                    key={f.id}
                    entry={f}
                    leadName={lead?.displayName ?? undefined}
                    accountLabel={acctLabel}
                  />
                )
              })
            )}
            <div ref={feedEndRef} />
          </div>
        </aside>
      </div>

    </div>
  )
}

type StatTone = "muted" | "blue" | "emerald" | "rose"

function StatCard({
  label,
  value,
  icon,
  tone,
  title,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  tone: StatTone
  title?: string
}) {
  const toneClasses: Record<StatTone, string> = {
    muted: "bg-muted text-muted-foreground",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4" title={title}>
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneClasses[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  )
}

function LeadRow({
  lead,
  accountLabel,
  conversationId,
}: {
  lead: Lead
  accountLabel: string | null
  conversationId: string | null
}) {
  return (
    <tr className="transition-colors hover:bg-accent/40">
      <td className="px-4 py-2.5 font-mono text-[12px] text-foreground">{lead.discordUserId}</td>
      <td className="px-4 py-2.5 text-[13px] text-foreground">{lead.displayName || "—"}</td>
      <td className="px-4 py-2.5">
        <LeadStatusPill status={lead.status} />
      </td>
      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
        {accountLabel ? (
          <span className="font-mono">{accountLabel}</span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {conversationId ? (
          <Link
            to={`/app/unibox/c/${conversationId}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Open conversation
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <span className="text-[12px] text-muted-foreground/60">—</span>
        )}
      </td>
    </tr>
  )
}

// Translate the engine's raw Discord/Playwright error string into a single
// human sentence. Falls back to "Discord rejected the send" when nothing matches
// so the feed never shows a stack trace or a fr_error JSON blob.
function humanizeReason(raw?: string): string | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s.includes("captcha-required") || s.includes("captcha_required")) return "Discord asked for a captcha (anti-spam wall)."
  if (s.includes("invalid-response") || s.includes("invalid_response")) return "Captcha solve didn't bind to this session."
  if (s.includes("50278") || s.includes("no mutual guilds")) return "No shared server with this recipient — Discord blocks the DM."
  if (s.includes("50007") || s.includes("cannot send messages to this user")) return "Recipient has DMs disabled for non-friends."
  if (s.includes("editor not found")) return "Discord's chat input didn't load in time."
  if (s.includes("page.waitforselector") || s.includes("timeout")) return "Discord took too long to load the conversation."
  if (s.includes("401") || s.includes("unauthorized")) return "The account's session is invalid — needs re-login."
  if (s.includes("403") && (s.includes("limited") || s.includes("verify") || s.includes("phone")))
    return "Discord temporarily restricted this account."
  if (s.includes("blocked")) return "Recipient blocked you."
  if (s.includes("429")) return "Rate-limited by Discord — slowing down."
  return "Discord rejected the send."
}

function FeedLine({ entry, leadName, accountLabel }: {
  entry: FeedEntry
  leadName?: string
  accountLabel?: string
}) {
  const time = (() => {
    try {
      return new Date(entry.ts).toLocaleTimeString(undefined, {
        hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
    } catch { return entry.ts }
  })()

  const target = leadName ? <strong className="text-foreground/90">{leadName}</strong> : null
  const by = accountLabel
    ? <span className="text-foreground/60"> via <span className="text-foreground/80">@{accountLabel}</span></span>
    : null
  const reason = humanizeReason(entry.reason)

  let dot = "bg-emerald-300/60"
  let body: React.ReactNode = entry.type

  switch (entry.type) {
    case "dm_sending":
      dot = "bg-sky-300 animate-pulse"
      body = <>Sending to {target ?? "lead"}{by}…</>
      break
    case "campaign_waiting": {
      const inCooldown = entry.accountsInCooldown ?? 0
      const ready = entry.accountsReady ?? 0
      const nextAt = entry.nextSendAt ? new Date(entry.nextSendAt) : null
      const untilNext = nextAt ? formatDistanceToNow(nextAt, { addSuffix: true }) : null
      dot = "bg-yellow-400/70"
      if (inCooldown > 0 && ready === 0) {
        body = (
          <>
            ⏱ All {inCooldown} account{inCooldown !== 1 ? "s" : ""} cooling down (8-min rule).
            {untilNext && <span className="ml-1 text-foreground/60">Next send {untilNext}.</span>}
          </>
        )
      } else if (ready > 0) {
        body = (
          <>
            ⏳ {ready} account{ready !== 1 ? "s" : ""} ready but no DM channels open yet — waiting for channels.
          </>
        )
      } else {
        body = <>Engine idle — no eligible accounts or leads.</>
      }
      break
    }
    case "dm_sent":
      dot = "bg-blue-400"
      body = <>Sent the message{target ? <> to {target}</> : ""}{by}.</>
      break
    case "dm_replied":
      dot = "bg-emerald-400"
      body = <>{target ? <>{target} replied</> : <>Lead replied</>} — moved into the inbox.</>
      break
    case "dm_failed":
      dot = "bg-rose-400"
      body = (
        <>
          ❌ Failed to send{target ? <> to {target}</> : ""}{by}.{" "}
          <span className="text-foreground/70">{entry.reason || "Discord rejected the message."}</span>
        </>
      )
      break
    case "campaign_finished":
      dot = "bg-amber-400"
      body = <>Campaign finished — every lead has been processed.</>
      break
    case "campaign_paused":
      dot = "bg-rose-500"
      body = (
        <>
          🚨 Campaign paused.{" "}
          <span className="text-foreground/80">{entry.reason || "An account hit a fatal error."}</span>
        </>
      )
      break
    case "captcha_triggered":
      dot = "bg-amber-400 animate-pulse"
      body = (
        <>
          🔒 Discord asked{by} to solve a CAPTCHA — the auto-solver is working on it. This lead will be retried.
        </>
      )
      break
    case "warmup_account_dead":
      dot = "bg-rose-500"
      body = (
        <>
          💀 Warmup account{by} went offline.{" "}
          <span className="text-foreground/70">{entry.reason}</span>
        </>
      )
      break
    case "warmup_rate_limited":
      dot = "bg-amber-500"
      body = (
        <>
          ⏱ Account{by} was rate-limited by Discord — paused for {entry.cooldownMinutes ?? "a few"} minute{(entry.cooldownMinutes ?? 2) !== 1 ? "s" : ""}, then will resume automatically.
        </>
      )
      break
    case "warmup_pair_paused":
      dot = "bg-orange-400"
      body = (
        <>
          🔗 A warmup conversation was paused.{" "}
          <span className="text-foreground/70">{entry.reason}</span>
        </>
      )
      break
    case "warmup_daily_cap":
      dot = "bg-sky-400"
      body = (
        <>
          📊 Account{by} reached its daily limit ({entry.sendsToday}/{entry.cap} messages) — it will resume tomorrow.
        </>
      )
      break
    default:
      body = <span className="text-muted-foreground">{entry.type}</span>
  }

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-muted-foreground/60 tabular-nums shrink-0">{time}</span>
      <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="text-foreground/90">
        {body}
        {entry.conversationId && (
          <Link to={`/app/unibox/c/${entry.conversationId}`} className="ml-1 text-primary hover:underline">
            Open conversation →
          </Link>
        )}
      </span>
    </div>
  )
}
