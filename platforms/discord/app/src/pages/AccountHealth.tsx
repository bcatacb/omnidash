import { useCallback, useEffect, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { subscribeRealtime } from "@/lib/realtime"
import { AlertTriangle, BedDouble, ChevronDown, ChevronRight, Clock, RefreshCw, ShieldOff, Zap, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityLogRow {
  id: string
  account_id: string
  action: string
  detail: Record<string, any>
  ts: string
}

interface AccountHealthRow {
  id: string
  username: string
  label: string | null
  status: string
  warmup_status: string | null
  avatar_url: string | null
  fr_sent_24h: number
  dm_sent_24h: number
  warmup_sent_24h: number
  scrape_sessions_24h: number
  last_4004_at: string | null
  last_event_at: string | null
  rest_recommended: boolean
  recent_events: ActivityLogRow[]
}

// ── Thresholds ────────────────────────────────────────────────────────────────
const FR_LIMIT = 6
const DM_LIMIT = 5
const WARMUP_LIMIT = 15

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return "—"
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function accountStatusDot(status: string) {
  if (status === "connected") return "bg-green-500"
  if (status === "token_revoked") return "bg-amber-500"
  return "bg-zinc-500"
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    fr_sent: "FR sent",
    dm_sent: "DM sent",
    warmup_sent: "Warmup msg",
    scrape_session: "Scrape session",
    gateway_4004: "Gateway 4004",
    token_revoked: "Token revoked",
    quarantined: "Quarantined",
    server_join: "Server join",
  }
  return map[action] ?? action
}

function actionColor(action: string): string {
  if (action === "fr_sent" || action === "dm_sent" || action === "warmup_sent" || action === "server_join") return "text-green-400"
  if (action === "scrape_session") return "text-blue-400"
  if (action === "gateway_4004" || action === "token_revoked" || action === "quarantined") return "text-red-400"
  return "text-zinc-400"
}

// ── Bar meter ─────────────────────────────────────────────────────────────────

function Meter({ value, limit, label }: { value: number; limit: number; label: string }) {
  const pct = Math.min((value / limit) * 100, 100)
  const over = value >= limit
  const warn = !over && value >= limit * 0.7
  return (
    <div className="flex flex-col gap-0.5 min-w-[60px]">
      <div className="flex items-end justify-between gap-1">
        <span className={`text-[11px] font-semibold ${over ? "text-red-400" : warn ? "text-amber-400" : "text-text-normal"}`}>
          {value}
        </span>
        <span className="text-[10px] text-text-muted">/{limit}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-text-muted">{label}</span>
    </div>
  )
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({
  row,
  onRest,
  onActivate,
}: {
  row: AccountHealthRow
  onRest: (id: string) => Promise<void>
  onActivate: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  const ws = row.warmup_status
  const isResting = ws === "resting"
  const isQuarantined = ws === "quarantined" || ws === "retired"
  const isConnected = row.status === "connected"

  // Can put to rest: connected, not already resting/quarantined/retired
  const canRest = isConnected && !isResting && !isQuarantined
  // Can activate: currently resting (not hard-quarantined)
  const canActivate = isResting

  const handleRest = async () => {
    setBusy(true)
    try { await onRest(row.id) } finally { setBusy(false) }
  }
  const handleActivate = async () => {
    setBusy(true)
    try { await onActivate(row.id) } finally { setBusy(false) }
  }

  // Overall status label for the badge column
  const statusBadge = () => {
    if (isQuarantined) return (
      <span className="flex items-center gap-1 rounded-full bg-red/15 px-2.5 py-1 text-[11px] font-semibold text-red-400">
        <ShieldOff className="h-3 w-3" /> Quarantined
      </span>
    )
    if (isResting) return (
      <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-[11px] font-semibold text-blue-400">
        <BedDouble className="h-3 w-3" /> Resting
      </span>
    )
    if (row.rest_recommended) return (
      <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400">
        <BedDouble className="h-3 w-3" /> Rest now
      </span>
    )
    if (isConnected) return (
      <span className="flex items-center gap-1 rounded-full bg-green/10 px-2.5 py-1 text-[11px] font-semibold text-green-400">
        <Zap className="h-3 w-3" /> Active
      </span>
    )
    return (
      <span className="flex items-center gap-1 rounded-full bg-zinc-500/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
        <ShieldOff className="h-3 w-3" /> Offline
      </span>
    )
  }

  const rowBorder = isResting
    ? "border-blue-500/25 bg-blue-500/5"
    : row.rest_recommended
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-bg-tertiary bg-bg-secondary"

  return (
    <div className={`rounded-card border ${rowBorder} transition-colors`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand */}
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-text-muted hover:text-text-normal">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {/* Name */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`h-2 w-2 shrink-0 rounded-full ${accountStatusDot(row.status)}`} />
          <span className="text-[13px] font-medium text-text-normal truncate">{row.label || row.username}</span>
          {row.label && <span className="text-[11px] text-text-muted shrink-0">@{row.username}</span>}
        </div>

        {/* Meters */}
        <div className="hidden lg:flex items-end gap-4 shrink-0">
          <Meter value={row.fr_sent_24h} limit={FR_LIMIT} label="FRs" />
          <Meter value={row.dm_sent_24h} limit={DM_LIMIT} label="DMs" />
          <Meter value={row.warmup_sent_24h} limit={WARMUP_LIMIT} label="Warmup" />
          <div className="flex flex-col gap-0.5 min-w-[40px]">
            <span className="text-[11px] font-semibold text-text-normal">{row.scrape_sessions_24h}</span>
            <span className="text-[10px] text-text-muted">Scrapes</span>
          </div>
        </div>

        {/* Status badge */}
        <div className="shrink-0 w-28 flex justify-center">{statusBadge()}</div>

        {/* Last active */}
        <div className="hidden xl:flex items-center gap-1 shrink-0 w-20 text-[11px] text-text-muted">
          <Clock className="h-3 w-3" />
          {timeAgo(row.last_event_at)}
        </div>

        {/* Action button */}
        <div className="shrink-0 w-24 flex justify-end">
          {canActivate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleActivate}
              disabled={busy}
              className="text-[11px] text-green-400 hover:bg-green/10 gap-1"
            >
              <PlayCircle className="h-3.5 w-3.5" />
              {busy ? "…" : "Activate"}
            </Button>
          )}
          {canRest && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRest}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-blue-400 hover:bg-blue-500/10"
            >
              {busy ? "…" : "Put to rest"}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile meters */}
      <div className="lg:hidden flex items-end gap-3 px-4 pb-3">
        <Meter value={row.fr_sent_24h} limit={FR_LIMIT} label="FRs" />
        <Meter value={row.dm_sent_24h} limit={DM_LIMIT} label="DMs" />
        <Meter value={row.warmup_sent_24h} limit={WARMUP_LIMIT} label="Warmup" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-text-normal">{row.scrape_sessions_24h}</span>
          <span className="text-[10px] text-text-muted">Scrapes</span>
        </div>
      </div>

      {/* Expanded activity */}
      {expanded && (
        <div className="border-t border-bg-tertiary px-4 py-3">
          {row.last_4004_at && (
            <div className="mb-2 flex items-center gap-1.5 rounded bg-red/10 px-3 py-1.5 text-[11px] text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Last gateway 4004: {timeAgo(row.last_4004_at)} — token was revoked, account needed re-onboarding
            </div>
          )}
          {isResting && (
            <div className="mb-2 flex items-center gap-1.5 rounded bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-400">
              <BedDouble className="h-3.5 w-3.5 shrink-0" />
              Account is resting — excluded from all campaigns. Gateway stays connected. Click "Activate" when ready.
            </div>
          )}
          <p className="text-[11px] text-text-muted mb-2">Last 7 days activity</p>
          {row.recent_events.length === 0 ? (
            <p className="text-[12px] text-text-muted py-2">No activity recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {row.recent_events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 py-0.5">
                  <span className={`shrink-0 text-[11px] font-medium ${actionColor(ev.action)}`}>
                    {actionLabel(ev.action)}
                  </span>
                  <span className="text-[11px] text-text-muted shrink-0">{timeAgo(ev.ts)}</span>
                  {ev.detail && Object.keys(ev.detail).length > 0 && (
                    <span className="text-[10px] text-text-muted truncate">
                      {ev.action === 'server_join' 
                        ? `guild=${ev.detail.guildName || ev.detail.guildId} code=${ev.detail.inviteCode} status=${ev.detail.status} ${ev.detail.error ? 'err=' + ev.detail.error : ''} ${ev.detail.httpStatus ? 'http=' + ev.detail.httpStatus : ''}`
                        : Object.entries(ev.detail)
                            .filter(([k]) => !["leadId"].includes(k))
                            .map(([k, v]) => `${k}=${v}`)
                            .join(" · ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

let _healthCache: AccountHealthRow[] | null = null

export default function AccountHealth() {
  const [rows, setRows] = useState<AccountHealthRow[]>(_healthCache ?? [])
  const [loading, setLoading] = useState(_healthCache === null)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/account-health", { cache: "no-cache" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      _healthCache = data
      setRows(data)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 30_000)

  useEffect(() => subscribeRealtime((raw) => {
    if (!raw.data) return
    try {
      const ev = JSON.parse(raw.data)
      if (["fr_sent", "dm_sent", "warmup_msg_sent", "gateway_4004", "account_status"].includes(ev.type)) {
        void refresh()
      }
    } catch { /* */ }
  }), [refresh])

  const handleRest = async (accountId: string) => {
    const row = rows.find((r) => r.id === accountId)
    const name = row?.label || row?.username || accountId
    const ok = await confirm({
      title: `Put ${name} to rest?`,
      description: "The account will be excluded from all campaigns and warmup. Its token stays valid and gateway stays connected. You can activate it again any time from this page.",
      confirmLabel: "Put to rest",
      variant: "danger",
    })
    if (!ok) return
    const r = await fetch(`/api/accounts/${accountId}/rest`, { method: "POST" })
    if (!r.ok) { setError(`Failed: HTTP ${r.status}`); return }
    await refresh()
  }

  const handleActivate = async (accountId: string) => {
    const r = await fetch(`/api/accounts/${accountId}/unrest`, { method: "POST" })
    if (!r.ok) { setError(`Failed: HTTP ${r.status}`); return }
    await refresh()
  }

  const restCount = rows.filter((r) => r.rest_recommended && r.warmup_status !== "resting").length
  const restingCount = rows.filter((r) => r.warmup_status === "resting").length
  const activeCount = rows.filter((r) => r.status === "connected" && r.warmup_status !== "resting" && r.warmup_status !== "quarantined" && r.warmup_status !== "retired").length
  const quarantinedCount = rows.filter((r) => r.warmup_status === "quarantined" || r.warmup_status === "retired").length

  // Sort: need rest first, then resting, then active, then offline
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: AccountHealthRow) => {
      if (r.rest_recommended && r.warmup_status !== "resting") return 0
      if (r.warmup_status === "resting") return 1
      if (r.status === "connected") return 2
      return 3
    }
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    const at = a.last_event_at ? new Date(a.last_event_at).getTime() : 0
    const bt = b.last_event_at ? new Date(b.last_event_at).getTime() : 0
    return bt - at
  })

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Account Health</h1>
        <Button size="sm" variant="ghost" onClick={refresh} className="gap-1.5 text-[12px]">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <p className="text-[12px] text-muted-foreground mb-5">
        Tracks all sends per account. Rest is auto-recommended (and auto-enforced) at{" "}
        <strong>{FR_LIMIT} FRs</strong>, <strong>{DM_LIMIT} DMs</strong>, or{" "}
        <strong>{WARMUP_LIMIT} warmup messages</strong> in 24 hours. Resting accounts keep their gateway connection — they are just paused from all campaigns.
      </p>

      {/* Summary strip */}
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="rounded-card border border-bg-tertiary bg-bg-secondary px-4 py-2.5 text-center min-w-[72px]">
          <div className="text-xl font-bold text-green-400">{activeCount}</div>
          <div className="text-[11px] text-text-muted">Active</div>
        </div>
        <div className={`rounded-card border px-4 py-2.5 text-center min-w-[72px] ${restCount > 0 ? "border-amber-500/40 bg-amber-500/10" : "border-bg-tertiary bg-bg-secondary"}`}>
          <div className={`text-xl font-bold ${restCount > 0 ? "text-amber-400" : "text-text-normal"}`}>{restCount}</div>
          <div className="text-[11px] text-text-muted">Need rest</div>
        </div>
        <div className={`rounded-card border px-4 py-2.5 text-center min-w-[72px] ${restingCount > 0 ? "border-blue-500/30 bg-blue-500/5" : "border-bg-tertiary bg-bg-secondary"}`}>
          <div className={`text-xl font-bold ${restingCount > 0 ? "text-blue-400" : "text-text-normal"}`}>{restingCount}</div>
          <div className="text-[11px] text-text-muted">Resting</div>
        </div>
        <div className={`rounded-card border px-4 py-2.5 text-center min-w-[72px] ${quarantinedCount > 0 ? "border-red/30 bg-red/5" : "border-bg-tertiary bg-bg-secondary"}`}>
          <div className={`text-xl font-bold ${quarantinedCount > 0 ? "text-red-400" : "text-text-normal"}`}>{quarantinedCount}</div>
          <div className="text-[11px] text-text-muted">Quarantined</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-md border border-dashed border-input p-8 text-center text-sm text-muted-foreground">No accounts found.</div>
      )}

      {/* Column headers */}
      {rows.length > 0 && (
        <div className="mb-2 hidden lg:flex items-center gap-3 px-4 text-[11px] text-text-muted">
          <div className="w-4 shrink-0" />
          <div className="flex-1">Account</div>
          <div className="flex items-end gap-4 shrink-0 pr-1">
            <div className="w-[60px]">FRs (/{FR_LIMIT})</div>
            <div className="w-[60px]">DMs (/{DM_LIMIT})</div>
            <div className="w-[60px]">Warmup (/{WARMUP_LIMIT})</div>
            <div className="w-[40px]">Scrapes</div>
          </div>
          <div className="w-28 text-center shrink-0">Status</div>
          <div className="w-20 shrink-0">Last active</div>
          <div className="w-24 shrink-0" />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {sorted.map((row) => (
          <AccountRow key={row.id} row={row} onRest={handleRest} onActivate={handleActivate} />
        ))}
      </div>
    </div>
  )
}
