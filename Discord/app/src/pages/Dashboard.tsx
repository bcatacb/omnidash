import { useCallback, useEffect, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Link } from "react-router-dom"
import { AlertTriangle, ArrowRight, CheckCircle2, Inbox, MessageSquare, Send, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CampaignStatus } from "@/api-types"

type Window = "24h" | "7d" | "all"

interface DashboardData {
  kpis: {
    dmsSent: number; dmsSentTrendPct: number;
    repliesReceived: number; replyRatePct: number;
    pendingLeads: number;
    activeAccounts: number; totalAccounts: number;
  }
  alerts: Array<{
    severity: "info" | "warn" | "error"
    kind: string
    message: string
    linkTo?: string
  }>
  recentActivity: Array<{
    ts: string
    accountUsername: string
    leadName: string
    campaignName: string
    campaignId: string
    type: "sent" | "replied" | "paused" | "failed"
  }>
  campaigns: Array<{
    id: string; name: string; status: CampaignStatus
    todaySent: number; repliedTotal: number
    progressPct: number; accountCount: number
  }>
  waveQueueSummary: Array<{
    campaignId: string; campaignName: string
    cold: number; accountUsername: string
  }>
  quickStats: { friendsTotal: number; conversationsTotal: number; accountsInGroups: number; accountsTotal: number }
}

export default function Dashboard() {
  const [window, setWindow] = useState<Window>("24h")
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard?window=${window}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (err) {
      console.error("dashboard load failed", err)
    } finally {
      setLoading(false)
    }
  }, [window])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 30_000)

  if (loading && !data) return <div className="p-6 text-text-muted">Loading…</div>
  if (!data) return <div className="p-6 text-red">Could not load dashboard.</div>

  return (
    <div className="p-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex gap-1 rounded-chip bg-bg-tertiary p-1 text-[12px]">
          {(["24h", "7d", "all"] as Window[]).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                "rounded-chip px-3 py-1 font-medium transition-colors",
                window === w ? "bg-bg-floating text-text-normal" : "text-text-muted hover:text-text-normal",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile icon={<Send className="h-4 w-4" />} label="DMs sent" value={data.kpis.dmsSent.toLocaleString()} sub={`${data.kpis.dmsSentTrendPct > 0 ? "+" : ""}${data.kpis.dmsSentTrendPct}% vs prev`} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Replies" value={data.kpis.repliesReceived.toLocaleString()} sub={`${data.kpis.replyRatePct}% reply rate`} />
        <KpiTile icon={<Inbox className="h-4 w-4" />} label="Pending leads" value={data.kpis.pendingLeads.toLocaleString()} />
        <KpiTile icon={<Users className="h-4 w-4" />} label="Active accounts" value={`${data.kpis.activeAccounts}/${data.kpis.totalAccounts}`} link="/app/accounts" />
      </div>

      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a, i) => (
            <Link
              key={i}
              to={a.linkTo || "#"}
              className={cn(
                "flex items-center justify-between gap-3 rounded-card border px-4 py-2.5 text-[13px] transition-colors hover:bg-bg-message-hover",
                a.severity === "error" && "border-red/40 bg-red/10 text-red",
                a.severity === "warn"  && "border-yellow/40 bg-yellow/10 text-yellow",
                a.severity === "info"  && "border-bg-tertiary bg-bg-tertiary/30",
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{a.message}</span>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
            </Link>
          ))}
        </div>
      )}
      {data.alerts.length === 0 && (
        <div className="flex items-center gap-2 rounded-card border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-[13px] text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> All systems healthy
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <h2 className="text-base font-semibold">Campaigns</h2>
          {data.campaigns.length === 0 && (
            <div className="rounded-card border border-dashed border-bg-tertiary p-8 text-center text-text-muted">
              No active campaigns. <Link to="/app/campaigns" className="text-brand hover:underline">Create one →</Link>
            </div>
          )}
          {data.campaigns.map((c) => (
            <Link
              key={c.id}
              to={`/app/campaigns/${c.id}`}
              className="block rounded-card border border-bg-tertiary bg-bg-secondary p-4 transition-colors hover:bg-bg-message-hover"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-base font-semibold">{c.name}</h3>
                <span className={cn(
                  "rounded-chip px-2 py-0.5 text-[11px] font-medium",
                  c.status === "running"  && "bg-emerald-500/15 text-emerald-600",
                  c.status === "waving"   && "bg-yellow-500/15 text-yellow-700",
                  c.status === "paused"   && "bg-rose-500/15 text-rose-700",
                  c.status === "draft"    && "bg-muted text-muted-foreground",
                  c.status === "finished" && "bg-blue-500/15 text-blue-700",
                )}>{c.status}</span>
              </div>
              <div className="text-[12px] text-text-muted">
                {c.todaySent} sent · {c.repliedTotal} replied · {c.accountCount} account{c.accountCount === 1 ? "" : "s"}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                <div className="h-full bg-brand transition-all" style={{ width: `${c.progressPct}%` }} />
              </div>
            </Link>
          ))}

          {data.waveQueueSummary.length > 0 && (
            <div className="rounded-card border border-yellow/40 bg-yellow/10 p-4">
              <h3 className="text-[13px] font-semibold text-yellow">
                Wave Queue · {data.waveQueueSummary.length} campaign{data.waveQueueSummary.length === 1 ? "" : "s"} waiting
              </h3>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {data.waveQueueSummary.map((w) => (
                  <li key={w.campaignId}>
                    <Link to={`/app/campaigns/${w.campaignId}`} className="text-text-normal hover:underline">
                      <strong>{w.campaignName}</strong> · {w.cold} leads to wave · @{w.accountUsername}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col rounded-card border border-bg-tertiary bg-bg-secondary">
          <div className="border-b border-bg-tertiary px-4 py-2.5 text-[13px] font-medium">Activity feed</div>
          <div className="max-h-[600px] flex-1 space-y-0.5 overflow-y-auto p-3 text-[12px]">
            {data.recentActivity.length === 0 && (
              <p className="text-text-muted">No activity in this window.</p>
            )}
            {data.recentActivity.map((e, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="text-text-muted/60 tabular-nums">
                  {new Date(e.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={cn(
                  "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                  e.type === "sent"    && "bg-blue-400",
                  e.type === "replied" && "bg-emerald-400",
                  e.type === "paused"  && "bg-yellow",
                  e.type === "failed"  && "bg-rose-400",
                )} />
                <span className="text-text-normal/90">
                  <strong>{e.accountUsername || "—"}</strong> {e.type} {e.leadName ? `→ ${e.leadName}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted/80">
        <span>Friends: {data.quickStats.friendsTotal.toLocaleString()}</span>
        <span>·</span>
        <span>Conversations: {data.quickStats.conversationsTotal.toLocaleString()}</span>
        <span>·</span>
        <span>Accounts in groups: {data.quickStats.accountsInGroups}/{data.quickStats.accountsTotal}</span>
      </div>
    </div>
  )
}

function KpiTile({ icon, label, value, sub, link }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; link?: string }) {
  const inner = (
    <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-4 transition-colors hover:bg-bg-message-hover">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}<span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div>}
    </div>
  )
  return link ? <Link to={link} className="block">{inner}</Link> : inner
}
