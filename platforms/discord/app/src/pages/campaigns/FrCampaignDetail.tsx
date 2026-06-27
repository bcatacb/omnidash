import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { subscribeRealtime } from "@/lib/realtime"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Loader2, MessageCircle, Pause, Play, RefreshCw, Send, Trash2, UserPlus, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm"
import { cn } from "@/lib/utils"
import type { DiscordAccount, FrCampaign, FrLead, FrLeadStatus } from "@/api-types"
import { CaptchaSolveModal, type CaptchaChallenge } from "@/components/ui/CaptchaSolveModal"

const STATUS_COLORS: Record<FrLeadStatus, string> = {
  pending:     "bg-muted text-muted-foreground",
  fr_sent:     "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  fr_accepted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  dm_sent:     "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  failed:      "bg-destructive/15 text-destructive",
  fr_disabled: "bg-zinc-500/15 text-zinc-500",
}

const STATUS_LABELS: Record<FrLeadStatus, string> = {
  pending:     "Pending",
  fr_sent:     "FR sent",
  fr_accepted: "Accepted",
  dm_sent:     "DM sent",
  failed:      "Failed",
  fr_disabled: "FRs disabled",
}

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  running:   "bg-emerald-500/15 text-emerald-500",
  paused:    "bg-amber-500/15 text-amber-500",
  draft:     "bg-muted text-muted-foreground",
  completed: "bg-blue-500/15 text-blue-500",
}

const MODE_LABELS: Record<string, string> = {
  fr_only:    "FR only",
  dm_then_fr: "DM → FR",
  fr_then_dm: "FR → DM",
}

type FilterTab = "all" | FrLeadStatus

interface FeedItem {
  id: string
  type: "fr_sent" | "fr_accepted" | "fr_dm_sent" | "fr_failed" | "fr_captcha_required"
  displayName: string | null
  accountId?: string
  ts: string
  error?: string
}

export default function FrCampaignDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [campaign, setCampaign] = useState<FrCampaign | null>(null)
  const [leads, setLeads] = useState<FrLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyStatus, setBusyStatus] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [sendingLeads, setSendingLeads] = useState<Set<string>>(new Set())
  const [captchaChallenge, setCaptchaChallenge] = useState<(CaptchaChallenge & { leadId: string; rqtoken?: string }) | null>(null)
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false)
  const feedEndRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const [cRes, lRes] = await Promise.all([
        fetch(`/api/fr-campaigns/${id}`),
        fetch(`/api/fr-campaigns/${id}/leads?limit=500`),
      ])
      if (!cRes.ok) throw new Error(`Campaign not found (${cRes.status})`)
      const c: FrCampaign = await cRes.json()
      const ls: FrLead[] = lRes.ok ? await lRes.json() : []
      setCampaign(c)
      setLeads(ls)
      setFeed((prev) => {
        if (prev.length > 0) return prev
        const synth: FeedItem[] = []
        for (const l of ls) {
          if (l.fr_sent_at && (l.status === "fr_sent" || l.status === "fr_accepted" || l.status === "dm_sent")) {
            synth.push({ id: `init-sent-${l.id}`, type: "fr_sent", displayName: l.display_name, accountId: l.assigned_account_id ?? undefined, ts: l.fr_sent_at })
          }
          if (l.fr_accepted_at) {
            synth.push({ id: `init-acc-${l.id}`, type: "fr_accepted", displayName: l.display_name, accountId: l.assigned_account_id ?? undefined, ts: l.fr_accepted_at })
          }
          if (l.dm_sent_at && l.status === "dm_sent") {
            synth.push({ id: `init-dm-${l.id}`, type: "fr_dm_sent", displayName: l.display_name, accountId: l.assigned_account_id ?? undefined, ts: l.dm_sent_at })
          }
          if (l.status === "failed") {
            synth.push({ id: `init-fail-${l.id}`, type: "fr_failed", displayName: l.display_name, accountId: l.assigned_account_id ?? undefined, ts: l.fr_sent_at ?? l.dm_sent_at ?? new Date().toISOString(), error: l.error ?? undefined })
          }
        }
        synth.sort((a, b) => a.ts.localeCompare(b.ts))
        return synth.slice(-100)
      })
    } catch (err: any) {
      setError(err?.message || "Failed to load campaign")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.ok ? r.json() : [])
      .then((data: DiscordAccount[]) => { if (Array.isArray(data)) setAccounts(data) })
      .catch(() => {})
  }, [])

  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of accounts) map[a.id] = a.username || a.label || a.id.slice(0, 8)
    return map
  }, [accounts])

  const accountLeadStats = useMemo(() => {
    const map = new Map<string, { sent: number; accepted: number; dmSent: number; failed: number; pending: number }>()
    for (const l of leads) {
      const aid = l.assigned_account_id
      if (!aid) continue
      const s = map.get(aid) ?? { sent: 0, accepted: 0, dmSent: 0, failed: 0, pending: 0 }
      if (l.status === "fr_sent") s.sent++
      else if (l.status === "fr_accepted") s.accepted++
      else if (l.status === "dm_sent") s.dmSent++
      else if (l.status === "failed") s.failed++
      else s.pending++
      map.set(aid, s)
    }
    return map
  }, [leads])

  useAutoRefresh(refresh, 30_000)

  useEffect(() => {
    if (!id) return
    return subscribeRealtime((raw) => {
      try {
        const ev = JSON.parse(raw.data) as { type: string; campaignId?: string; leadId?: string; displayName?: string | null; accountId?: string; ts?: string; error?: string; sitekey?: string; rqdata?: string; rqtoken?: string }
        if (ev.campaignId !== id) return

        const ts = ev.ts ?? new Date().toISOString()
        const item: FeedItem = {
          id: `${ts}-${ev.type}-${ev.leadId ?? ""}`,
          type: ev.type as FeedItem["type"],
          displayName: ev.displayName ?? null,
          accountId: ev.accountId,
          ts,
          error: ev.error,
        }

        if (ev.type === "fr_captcha_required" && ev.sitekey && ev.leadId) {
          setCaptchaChallenge({ sitekey: ev.sitekey, rqdata: ev.rqdata, rqtoken: ev.rqtoken, leadId: ev.leadId })
        }

        if (ev.type === "fr_sent" || ev.type === "fr_accepted" || ev.type === "fr_dm_sent" || ev.type === "fr_failed" || ev.type === "fr_captcha_required") {
          setFeed((prev) => [...prev, item].slice(-100))
          if (ev.leadId) {
            setLeads((prev) => prev.map((l) => {
              if (l.id !== ev.leadId) return l
              if (ev.type === "fr_sent") return { ...l, status: "fr_sent" as FrLeadStatus, assigned_account_id: ev.accountId ?? l.assigned_account_id, fr_sent_at: ts }
              if (ev.type === "fr_accepted") return { ...l, status: "fr_accepted" as FrLeadStatus }
              if (ev.type === "fr_dm_sent") return { ...l, status: "dm_sent" as FrLeadStatus, dm_sent_at: ts }
              if (ev.type === "fr_failed") return { ...l, status: "failed" as FrLeadStatus, assigned_account_id: ev.accountId ?? l.assigned_account_id }
              return l
            }))
          }
        }
      } catch { /* ignore */ }
    })
  }, [id])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [feed.length])

  const sendFrNow = async (leadId: string) => {
    if (!id || sendingLeads.has(leadId)) return
    setSendingLeads((prev) => new Set(prev).add(leadId))
    try {
      await fetch(`/api/fr-campaigns/${id}/leads/${leadId}/send-fr`, { method: "POST" })
      void refresh()
    } finally {
      setSendingLeads((prev) => { const s = new Set(prev); s.delete(leadId); return s })
    }
  }

  const setStatus = async (status: string) => {
    if (!campaign) return
    setBusyStatus(true)
    try {
      await fetch(`/api/fr-campaigns/${campaign.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      setCampaign((c) => c ? { ...c, status: status as FrCampaign["status"] } : c)
    } finally {
      setBusyStatus(false)
      void refresh()
    }
  }

  const deleteCampaign = async () => {
    if (!campaign || busyDelete) return
    if (!await confirm({
      title: `Delete campaign "${campaign.name}"?`,
      description: "This cannot be undone.",
      variant: "danger",
    })) return
    setBusyDelete(true)
    try {
      await fetch(`/api/fr-campaigns/${campaign.id}`, { method: "DELETE" })
      navigate("/app/campaigns")
    } finally {
      setBusyDelete(false)
    }
  }

  const stats = leads.reduce(
    (acc, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )
  const total    = leads.length
  const pending  = stats.pending     ?? 0
  const sent     = stats.fr_sent     ?? 0
  const accepted = stats.fr_accepted ?? 0
  const dmSent   = stats.dm_sent     ?? 0
  const failed   = stats.failed      ?? 0
  const acceptRate = sent + accepted + dmSent > 0
    ? Math.round((accepted + dmSent) / (sent + accepted + dmSent) * 100)
    : 0

  const filteredLeads = filter === "all" ? leads : leads.filter((l) => l.status === filter)

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all",         label: "All",     count: total    },
    { key: "pending",     label: "Pending",  count: pending  },
    { key: "fr_sent",     label: "FR sent",  count: sent     },
    { key: "fr_accepted", label: "Accepted", count: accepted },
    { key: "dm_sent",     label: "DM sent",  count: dmSent   },
    { key: "failed",      label: "Failed",   count: failed   },
  ]

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading…</div>
    </div>
  )
  if (error || !campaign) return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-destructive">{error ?? "Campaign not found"}</div>
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <CaptchaSolveModal
        open={!!captchaChallenge}
        challenge={captchaChallenge}
        title="Discord CAPTCHA — FR send"
        description="Discord challenged the friend request. Solve it once and we'll continue automatically."
        submitting={captchaSubmitting}
        onSolved={async (token) => {
          if (!captchaChallenge) return
          setCaptchaSubmitting(true)
          try {
            const r = await fetch(`/api/fr/leads/${captchaChallenge.leadId}/captcha`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ captcha_key: token, captcha_rqtoken: captchaChallenge.rqtoken }),
            })
            if (r.ok) setCaptchaChallenge(null)
          } finally {
            setCaptchaSubmitting(false)
          }
        }}
        onError={() => setCaptchaChallenge(null)}
        onClose={() => setCaptchaChallenge(null)}
      />
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/app/campaigns")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
              <UserPlus className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold leading-none">{campaign.name}</h1>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize", CAMPAIGN_STATUS_STYLES[campaign.status] ?? "bg-muted text-muted-foreground")}>
                  {campaign.status}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {MODE_LABELS[campaign.mode] ?? campaign.mode} · {campaign.fr_per_account_per_day} FR/account/day · {campaign.min_interval_seconds}–{campaign.max_interval_seconds}s interval · {campaign.inter_send_seconds}s inter-send
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={busyDelete} onClick={deleteCampaign} title="Delete campaign">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {campaign.status === "running" ? (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[12px]" disabled={busyStatus} onClick={() => setStatus("paused")}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          ) : campaign.status !== "completed" ? (
            <Button size="sm" className="h-7 gap-1 text-[12px]" disabled={busyStatus} onClick={() => setStatus("running")}>
              <Play className="h-3.5 w-3.5" /> {campaign.status === "paused" ? "Resume" : "Start"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Total",       value: total,            color: "text-foreground"    },
              { label: "Pending",     value: pending,          color: "text-muted-foreground" },
              { label: "FR sent",     value: sent,             color: "text-blue-500"      },
              { label: "Accepted",    value: accepted + dmSent, color: "text-emerald-500"  },
              { label: "Accept rate", value: `${acceptRate}%`, color: acceptRate > 30 ? "text-emerald-500" : "text-foreground" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className={cn("text-2xl font-bold tabular-nums leading-none", s.color)}>{s.value}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {total > 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground">Campaign progress</span>
                <span className="text-[11px] text-muted-foreground">{total - pending} / {total} contacted</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="flex h-full">
                  <div className="bg-blue-500 transition-all" style={{ width: `${total > 0 ? (sent / total) * 100 : 0}%` }} />
                  <div className="bg-emerald-500 transition-all" style={{ width: `${total > 0 ? (accepted / total) * 100 : 0}%` }} />
                  <div className="bg-purple-500 transition-all" style={{ width: `${total > 0 ? (dmSent / total) * 100 : 0}%` }} />
                  <div className="bg-destructive/50 transition-all" style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />FR sent ({sent})</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Accepted ({accepted})</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />DM sent ({dmSent})</span>
                {failed > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive/60" />Failed ({failed})</span>}
              </div>
            </div>
          )}

          {accountLeadStats.size > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-4 py-2.5 text-[12px] font-semibold text-foreground">
                Sending accounts ({accountLeadStats.size})
              </div>
              <div className="max-h-[240px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground z-10">
                  <tr>
                    <th className="px-4 py-2 text-left">Account</th>
                    <th className="px-4 py-2 text-right">Pending</th>
                    <th className="px-4 py-2 text-right">FR sent</th>
                    <th className="px-4 py-2 text-right">Accepted</th>
                    <th className="px-4 py-2 text-right">DM sent</th>
                    <th className="px-4 py-2 text-right">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Array.from(accountLeadStats.entries()).map(([accountId, s]) => {
                    const label = accountLabelById[accountId] ?? accountId.slice(0, 8) + "…"
                    const isConnected = accounts.find((a) => a.id === accountId)?.status === "connected"
                    return (
                      <tr key={accountId} className="hover:bg-accent/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isConnected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                            <span className="font-medium text-foreground">@{label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{s.pending}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-blue-500">{s.sent}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-500">{s.accepted}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-purple-500">{s.dmSent}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-destructive">{s.failed > 0 ? s.failed : <span className="text-muted-foreground">0</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-0 border-b border-border overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors",
                    filter === tab.key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    filter === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {filteredLeads.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-muted-foreground">
                {filter === "all" ? "No leads yet. Create the campaign with a server scrape to add leads." : `No ${filter.replace("_", " ")} leads.`}
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">User</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Account</th>
                      <th className="px-4 py-2 text-left">FR sent</th>
                      <th className="px-4 py-2 text-left">Accepted</th>
                      <th className="px-4 py-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLeads.map((l) => (
                      <tr key={l.id} className="hover:bg-accent/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground">{l.display_name ?? <span className="text-muted-foreground">—</span>}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{l.discord_user_id}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", STATUS_COLORS[l.status])}>
                              {STATUS_LABELS[l.status]}
                            </span>
                            {l.status === "pending" && (
                              <button
                                type="button"
                                disabled={sendingLeads.has(l.id)}
                                onClick={() => sendFrNow(l.id)}
                                title="Send FR now"
                                className="flex items-center justify-center h-5 w-5 rounded hover:bg-blue-500/15 text-muted-foreground hover:text-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {sendingLeads.has(l.id)
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Send className="h-3 w-3" />}
                              </button>
                            )}
                            {(l.status === "fr_accepted" || l.status === "dm_sent") && (
                              <button
                                type="button"
                                title="Open in Unibox"
                                onClick={async () => {
                                  try {
                                    const r = await fetch(`/api/unibox/by-peer/${l.discord_user_id}`)
                                    if (r.ok) {
                                      const j = await r.json()
                                      navigate(`/app/unibox/c/${j.conversationId}`)
                                    } else {
                                      navigate("/app/unibox")
                                    }
                                  } catch { navigate("/app/unibox") }
                                }}
                                className="flex items-center justify-center h-5 w-5 rounded hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-500 transition-colors"
                              >
                                <MessageCircle className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {l.assigned_account_id
                            ? <span className="font-medium text-foreground">@{accountLabelById[l.assigned_account_id] ?? l.assigned_account_id.slice(0, 8)}</span>
                            : <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {l.fr_sent_at ? <time title={l.fr_sent_at}>{fmtRelative(l.fr_sent_at)}</time> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {l.fr_accepted_at ? <time title={l.fr_accepted_at}>{fmtRelative(l.fr_accepted_at)}</time> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-destructive text-[11px] max-w-[180px] truncate" title={l.error ?? undefined}>
                          {l.error ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="w-72 shrink-0 border-l border-border flex flex-col bg-[#0b0f17] text-emerald-300">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[12px] font-medium text-foreground">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={cn(
                  "absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60",
                  campaign.status === "running" && "animate-ping"
                )} />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              Activity
            </span>
            <span className="text-[11px] text-muted-foreground">{feed.length} events</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed space-y-0.5">
            {feed.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-muted-foreground">
                {campaign.status === "running"
                  ? "Engine is running. FR events will appear here."
                  : "Start the campaign to see live events."}
              </p>
            ) : (
              feed.map((item) => {
                const acctLabel = item.accountId ? accountLabelById[item.accountId] : undefined
                return (
                  <FeedLine key={item.id} item={item} acctLabel={acctLabel} />
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

function FeedLine({ item, acctLabel }: { item: FeedItem; acctLabel?: string }) {
  const time = (() => {
    try { return new Date(item.ts).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) }
    catch { return "" }
  })()

  const name = item.displayName
    ? <strong className="text-foreground/90">{item.displayName}</strong>
    : null
  const by = acctLabel
    ? <span className="text-foreground/60"> via <span className="text-foreground/80">@{acctLabel}</span></span>
    : null

  let dot = "bg-emerald-400"
  let body: React.ReactNode

  switch (item.type) {
    case "fr_sent":
      dot = "bg-blue-400"
      body = <>FR sent{name ? <> to {name}</> : ""}{by}.</>
      break
    case "fr_accepted":
      dot = "bg-emerald-400"
      body = <>{name ? <>{name} accepted</> : <>FR accepted</>} ✓{by}.</>
      break
    case "fr_dm_sent":
      dot = "bg-purple-400"
      body = <>DM sent{name ? <> to {name}</> : ""}{by}.</>
      break
    case "fr_failed":
      dot = "bg-rose-400"
      body = <>❌ Failed{name ? <> — {name}</> : ""}{by}.{item.error && <span className="text-foreground/60 ml-1">{item.error.slice(0, 60)}</span>}</>
      break
    case "fr_captcha_required":
      dot = "bg-amber-400 animate-pulse"
      body = <>⚠ Discord challenged{by} with CAPTCHA — solve window opened.</>
      break
    default:
      body = <span className="text-muted-foreground">{item.type}</span>
  }

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-muted-foreground/60 tabular-nums shrink-0">{time}</span>
      <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="text-foreground/90 min-w-0">{body}</span>
    </div>
  )
}

function fmtRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return new Date(iso).toLocaleDateString()
  } catch { return iso }
}
