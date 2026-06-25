import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import {
  Download, Globe, Pause, Play, Plus, RefreshCw, Trash2, Users, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfirm } from "@/components/ui/confirm"
import type { DiscordAccount, FrCampaign, ScrapedMember, ScraperJob } from "@/api-types"

type Guild = { id: string; name: string }
type ScraperGuild = { guild_id: string; guild_name: string | null; total: number; pending: number }

function fmtRelative(iso: string | null) {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

function fmtNextScrape(iso: string | null) {
  if (!iso) return "soon"
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return "now"
  if (diff < 60_000) return `in ${Math.round(diff / 1_000)}s`
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`
  return `in ${Math.round(diff / 3_600_000)}h`
}

function fmtInterval(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

// ─── Push wizard modal ────────────────────────────────────────────────────────

function PushModal({
  stats,
  accounts,
  frCampaigns,
  initialGuildId,
  initialGuildName,
  onClose,
  onPushed,
}: {
  stats: { pending: number; fr_queued: number; fr_sent: number }
  accounts: DiscordAccount[]
  frCampaigns: FrCampaign[]
  initialGuildId?: string
  initialGuildName?: string | null
  onClose: () => void
  onPushed: () => void
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing")
  const [campaignId, setCampaignId] = useState("")
  const [newName, setNewName] = useState("")
  const [frPerDay, setFrPerDay] = useState(20)
  const [minInterval, setMinInterval] = useState(120)
  const [maxInterval, setMaxInterval] = useState(300)
  const [limit, setLimit] = useState(Math.min(500, stats.pending))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scopeLabel = initialGuildName || (initialGuildId ? `server ${initialGuildId.slice(0, 8)}` : null)

  // When existing campaign is selected, mirror its settings into the preview
  const selectedCampaign = frCampaigns.find((c) => c.id === campaignId)
  const previewFrPerDay = mode === "existing" && selectedCampaign
    ? selectedCampaign.fr_per_account_per_day
    : frPerDay
  const previewMinInterval = mode === "existing" && selectedCampaign
    ? selectedCampaign.min_interval_seconds
    : minInterval
  const previewMaxInterval = mode === "existing" && selectedCampaign
    ? selectedCampaign.max_interval_seconds
    : maxInterval

  // Available accounts: connected, not reserved as scraper decoys
  const eligibleAccounts = accounts.filter((a) => a.status === "connected" && !a.isScraperDecoy)
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(accounts.filter((a) => a.status === "connected" && !a.isScraperDecoy).map((a) => a.id))
  )
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)

  const availableAccounts = eligibleAccounts.filter((a) => selectedAccountIds.has(a.id))

  // Distribution preview — round-robin N leads across M accounts
  const distribution = useMemo(() => {
    if (availableAccounts.length === 0 || limit === 0) return []
    const each = Math.floor(limit / availableAccounts.length)
    const remainder = limit % availableAccounts.length
    return availableAccounts.map((a, i) => ({
      account: a,
      leads: each + (i < remainder ? 1 : 0),
    }))
  }, [availableAccounts, limit])

  const totalPerDay = availableAccounts.length * previewFrPerDay
  const daysToComplete = distribution.length > 0
    ? Math.ceil(Math.max(...distribution.map((d) => d.leads)) / previewFrPerDay)
    : 0

  const canSubmit = mode === "existing" ? !!campaignId : !!newName.trim()

  const submit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      let targetCampaignId = campaignId
      if (mode === "new") {
        const r = await fetch("/api/fr-campaigns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            mode: "fr_only",
            fr_per_account_per_day: frPerDay,
            min_interval_seconds: minInterval,
            max_interval_seconds: maxInterval,
            combo_interval_seconds: 0,
            inter_send_seconds: 60,
          }),
        })
        if (!r.ok) throw new Error(await r.text())
        const created = await r.json()
        targetCampaignId = created.id
      }
      const pushRes = await fetch("/api/scraper/members/push-to-campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: targetCampaignId, guild_id: initialGuildId, limit }),
      })
      if (!pushRes.ok) throw new Error(await pushRes.text())
      const j = await pushRes.json()
      setResult(j.pushed)
      onPushed()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-bg-tertiary bg-bg-secondary shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-bg-tertiary">
          <h2 className="text-base font-semibold">Push members to FR campaign</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats.pending.toLocaleString()} pending{scopeLabel ? ` in ${scopeLabel}` : ""} · pick a campaign or create one
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {result !== null ? (
            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-[13px] text-emerald-500 text-center">
              ✓ {result.toLocaleString()} member{result !== 1 ? "s" : ""} pushed to campaign
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div className="flex rounded-lg border border-bg-tertiary overflow-hidden text-[12px] font-medium">
                {(["existing", "new"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 transition-colors ${
                      mode === m
                        ? "bg-brand text-white"
                        : "bg-bg-tertiary text-muted-foreground hover:text-text-normal"
                    }`}
                  >
                    {m === "existing" ? "Use existing campaign" : "Create new campaign"}
                  </button>
                ))}
              </div>

              {/* Campaign picker or creator */}
              {mode === "existing" ? (
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">FR Campaign</label>
                  <select
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    className="w-full rounded-md border border-input bg-bg-tertiary px-3 py-2 text-[12px] text-text-normal focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    <option value="">Select campaign…</option>
                    {frCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.fr_per_account_per_day}/day · {c.status}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Campaign name</label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Poker server scrape batch 1"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">FRs / account / day</label>
                      <Input type="number" value={frPerDay} min={1} max={50}
                        onChange={(e) => setFrPerDay(Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Min interval (sec)</label>
                      <Input type="number" value={minInterval} min={30}
                        onChange={(e) => setMinInterval(Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Max interval (sec)</label>
                      <Input type="number" value={maxInterval} min={minInterval}
                        onChange={(e) => setMaxInterval(Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              )}

              {/* Members to push */}
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Members to push</label>
                  <Input type="number" value={limit} min={1} max={2000}
                    onChange={(e) => setLimit(Math.max(1, Number(e.target.value)))}
                    className="w-28" />
                </div>
                <p className="text-[11px] text-muted-foreground mt-4">
                  of {stats.pending.toLocaleString()} pending
                </p>
              </div>

              {/* Account picker */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">
                    Accounts to use
                    <span className="ml-1 font-semibold text-text-normal">
                      {availableAccounts.length} / {eligibleAccounts.length}
                    </span>
                    {eligibleAccounts.length < accounts.filter(a => a.status === "connected").length && (
                      <span className="ml-1 text-violet-400">(decoys excluded)</span>
                    )}
                  </label>
                  <div className="flex gap-2 text-[10px]">
                    <button type="button" className="text-brand hover:underline"
                      onClick={() => setSelectedAccountIds(new Set(eligibleAccounts.map((a) => a.id)))}>
                      All
                    </button>
                    <button type="button" className="text-muted-foreground hover:underline"
                      onClick={() => setSelectedAccountIds(new Set())}>
                      None
                    </button>
                    <button type="button" className="text-muted-foreground hover:underline"
                      onClick={() => setAccountPickerOpen((v) => !v)}>
                      {accountPickerOpen ? "▲ Hide" : "▼ Pick"}
                    </button>
                  </div>
                </div>
                {accountPickerOpen && (
                  <div className="rounded-md border border-bg-tertiary bg-bg-tertiary/30 max-h-40 overflow-y-auto">
                    {eligibleAccounts.map((a) => {
                      const checked = selectedAccountIds.has(a.id)
                      return (
                        <label key={a.id}
                          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-bg-tertiary cursor-pointer text-[12px]">
                          <input type="checkbox" checked={checked}
                            onChange={() => setSelectedAccountIds((prev) => {
                              const next = new Set(prev)
                              next.has(a.id) ? next.delete(a.id) : next.add(a.id)
                              return next
                            })}
                            className="h-3.5 w-3.5 rounded border-input accent-brand cursor-pointer" />
                          <span className="text-text-normal truncate">{a.label || a.username}</span>
                          <span className="text-muted-foreground ml-auto shrink-0">@{a.username}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Distribution preview */}
              <div className="rounded-md border border-bg-tertiary bg-bg-tertiary/30 p-3 space-y-2">
                <div className="text-[11px] font-semibold text-text-normal uppercase tracking-wide">
                  Distribution preview
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-bg-secondary px-2 py-1.5">
                    <div className="text-[15px] font-bold text-text-normal">{availableAccounts.length}</div>
                    <div className="text-[10px] text-muted-foreground">accounts used</div>
                  </div>
                  <div className="rounded bg-bg-secondary px-2 py-1.5">
                    <div className="text-[15px] font-bold text-text-normal">{totalPerDay.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">FRs / day total</div>
                  </div>
                  <div className="rounded bg-bg-secondary px-2 py-1.5">
                    <div className="text-[15px] font-bold text-text-normal">
                      {daysToComplete > 0 ? `~${daysToComplete}d` : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">to complete</div>
                  </div>
                </div>

                {/* Per-account breakdown */}
                {distribution.length > 0 ? (
                  <div className="max-h-36 overflow-y-auto space-y-1 mt-1">
                    {distribution.map(({ account, leads }) => {
                      const daysForThis = Math.ceil(leads / previewFrPerDay)
                      const avgIntervalSec = Math.round((previewMinInterval + previewMaxInterval) / 2)
                      return (
                        <div key={account.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-text-normal truncate min-w-0 flex-1">
                            {account.label || account.username}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {leads} leads · {previewFrPerDay}/day · ~{fmtInterval(avgIntervalSec)} apart · ~{daysForThis}d
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-red py-1">No connected accounts available.</p>
                )}

                {availableAccounts.length > 0 && (
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-bg-tertiary">
                    Interval shown is the average of {fmtInterval(previewMinInterval)}–{fmtInterval(previewMaxInterval)} range · {previewFrPerDay} FRs/account/day
                  </p>
                )}
              </div>

              {error && (
                <p className="text-[12px] text-red">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-bg-tertiary flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {result !== null ? "Close" : "Cancel"}
          </Button>
          {result === null && (
            <Button onClick={submit} disabled={loading || !canSubmit || availableAccounts.length === 0}
              title={availableAccounts.length === 0 ? "Select at least one account" : undefined}>
              <Zap className="h-3.5 w-3.5" />
              {loading ? "Working…" : mode === "new" ? "Create & push" : "Push members"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 100

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MemberScraper() {
  const [jobs, setJobs] = useState<ScraperJob[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [frCampaigns, setFrCampaigns] = useState<FrCampaign[]>([])
  const [scraperGuilds, setScraperGuilds] = useState<ScraperGuild[]>([])
  const [stats, setStats] = useState<{ pending: number; fr_queued: number; fr_sent: number }>({
    pending: 0, fr_queued: 0, fr_sent: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()

  const [formOpen, setFormOpen] = useState(false)
  const [formAccountId, setFormAccountId] = useState("")
  const [formGuildId, setFormGuildId] = useState("")
  const [formGuilds, setFormGuilds] = useState<Guild[]>([])
  const [formGuildsLoading, setFormGuildsLoading] = useState(false)
  const [formInterval, setFormInterval] = useState(60)
  const [formCreating, setFormCreating] = useState(false)

  const [pushOpen, setPushOpen] = useState(false)
  const [pushGuildId, setPushGuildId] = useState<string | undefined>()

  const [memberGuildFilter, setMemberGuildFilter] = useState<string>("")
  const [members, setMembers] = useState<ScrapedMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [membersHasMore, setMembersHasMore] = useState(false)
  const [membersOffset, setMembersOffset] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const sentinelRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [jRes, aRes, frRes, gRes] = await Promise.all([
        fetch("/api/scraper/jobs"),
        fetch("/api/accounts"),
        fetch("/api/fr-campaigns"),
        fetch("/api/scraper/guilds"),
      ])
      const [jJson, aJson, frJson, gJson] = await Promise.all([
        jRes.json(), aRes.json(), frRes.json(), gRes.json(),
      ])
      setJobs(Array.isArray(jJson) ? jJson : [])
      setAccounts(Array.isArray(aJson) ? aJson : [])
      setFrCampaigns(Array.isArray(frJson) ? frJson : [])
      setScraperGuilds(Array.isArray(gJson) ? gJson : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 60_000)

  // Fetch stats scoped to current guild filter (or global if no filter).
  const fetchStats = useCallback(async (guildId?: string) => {
    try {
      const params = new URLSearchParams()
      if (guildId) params.set("guild_id", guildId)
      const r = await fetch(`/api/scraper/stats?${params}`)
      const j = await r.json()
      setStats(j && typeof j === "object"
        ? { pending: j.pending ?? 0, fr_queued: j.fr_queued ?? 0, fr_sent: j.fr_sent ?? 0 }
        : { pending: 0, fr_queued: 0, fr_sent: 0 })
    } catch { /* silent */ }
  }, [])

  useEffect(() => { void fetchStats(memberGuildFilter || undefined) }, [memberGuildFilter, fetchStats])
  useAutoRefresh(() => fetchStats(memberGuildFilter || undefined), 60_000)

  const loadMemberPool = useCallback(async (guildId?: string) => {
    setMembersLoading(true)
    setMembersOffset(0)
    setMembersHasMore(false)
    setSelectedIds(new Set())
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: "0" })
      if (guildId) params.set("guild_id", guildId)
      const r = await fetch(`/api/scraper/members?${params}`)
      const j = await r.json()
      const page: ScrapedMember[] = Array.isArray(j) ? j : []
      const hasMore = page.length > PAGE_SIZE
      setMembers(hasMore ? page.slice(0, PAGE_SIZE) : page)
      setMembersHasMore(hasMore)
      setMembersOffset(PAGE_SIZE)
    } catch { /* silent */ }
    finally { setMembersLoading(false) }
  }, [])

  const loadMoreMembers = useCallback(async () => {
    if (loadingMore || !membersHasMore) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: String(membersOffset) })
      if (memberGuildFilter) params.set("guild_id", memberGuildFilter)
      const r = await fetch(`/api/scraper/members?${params}`)
      const j = await r.json()
      const page: ScrapedMember[] = Array.isArray(j) ? j : []
      const hasMore = page.length > PAGE_SIZE
      setMembers((prev) => [...prev, ...(hasMore ? page.slice(0, PAGE_SIZE) : page)])
      setMembersHasMore(hasMore)
      setMembersOffset((prev) => prev + PAGE_SIZE)
    } catch { /* silent */ }
    finally { setLoadingMore(false) }
  }, [loadingMore, membersHasMore, membersOffset, memberGuildFilter])

  // Infinite scroll — fire loadMoreMembers when the sentinel enters the viewport.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMoreMembers()
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMoreMembers])

  useEffect(() => { void loadMemberPool(memberGuildFilter || undefined) }, [memberGuildFilter, loadMemberPool])

  const loadGuildsForAccount = async (accountId: string) => {
    if (!accountId) { setFormGuilds([]); return }
    setFormGuildsLoading(true)
    try {
      const r = await fetch(`/api/accounts/${accountId}/guilds`)
      const j = r.ok ? await r.json() : { guilds: [] }
      setFormGuilds(Array.isArray(j.guilds) ? j.guilds : [])
    } catch { setFormGuilds([]) }
    finally { setFormGuildsLoading(false) }
  }

  const createJob = async () => {
    if (!formAccountId || !formGuildId) return
    setFormCreating(true)
    try {
      const selectedGuild = formGuilds.find((g) => g.id === formGuildId)
      const r = await fetch("/api/scraper/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: formAccountId,
          guild_id: formGuildId,
          guild_name: selectedGuild?.name ?? null,
          interval_minutes: formInterval,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      setFormOpen(false)
      setFormAccountId("")
      setFormGuildId("")
      setFormGuilds([])
      setFormInterval(60)
      await refresh()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setFormCreating(false)
    }
  }

  const toggleJob = async (job: ScraperJob) => {
    const newStatus = job.status === "running" ? "paused" : "running"
    await fetch(`/api/scraper/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    await refresh()
  }

  const deleteJob = async (job: ScraperJob) => {
    const ok = await confirm({
      title: "Delete this scraper job?",
      description: `This will also delete all ${job.members_total} scraped members for "${job.guild_name || job.guild_id}". This cannot be undone.`,
      confirmLabel: "Delete job",
      variant: "danger",
    })
    if (!ok) return
    await fetch(`/api/scraper/jobs/${job.id}`, { method: "DELETE" })
    await refresh()
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Member Scraper</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Dedicate one account to watch Discord servers, then push scraped members into FR campaigns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setFormOpen((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> New scraper job
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
          <strong>Error:</strong> {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Stats bar — scoped to selected server when filtered */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending", value: stats.pending, color: "text-text-normal" },
          { label: "Queued for FR", value: stats.fr_queued, color: "text-yellow-400" },
          { label: "FR Sent", value: stats.fr_sent, color: "text-emerald-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-card border border-bg-tertiary bg-bg-secondary p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {s.label}
              {memberGuildFilter && <span className="ml-1 opacity-60">· filtered</span>}
            </div>
          </div>
        ))}
      </div>

      {/* New job form */}
      {formOpen && (
        <div className="rounded-card border border-brand/30 bg-brand/5 p-4 space-y-3">
          <h2 className="text-[13px] font-semibold">New scraper job</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Scraper account</label>
              <select
                value={formAccountId}
                onChange={(e) => {
                  setFormAccountId(e.target.value)
                  setFormGuildId("")
                  loadGuildsForAccount(e.target.value)
                }}
                className="w-full rounded-md border border-input bg-bg-secondary px-3 py-2 text-[12px] text-text-normal focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">Select account…</option>
                {accounts.filter((a) => a.status === "connected").map((a) => (
                  <option key={a.id} value={a.id}>{a.label || a.username} (@{a.username})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">
                Server {formGuildsLoading ? "(loading…)" : formGuilds.length > 0 ? `(${formGuilds.length} joined)` : ""}
              </label>
              <select
                value={formGuildId}
                onChange={(e) => setFormGuildId(e.target.value)}
                disabled={!formAccountId || formGuildsLoading}
                className="w-full rounded-md border border-input bg-bg-secondary px-3 py-2 text-[12px] text-text-normal focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
              >
                <option value="">Select server…</option>
                {formGuilds.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Interval (minutes)</label>
              <Input type="number" value={formInterval} min={15} max={1440}
                onChange={(e) => setFormInterval(Number(e.target.value))} className="w-32" />
            </div>
            <div className="mt-5 flex gap-2">
              <Button onClick={createJob} disabled={formCreating || !formAccountId || !formGuildId}>
                {formCreating ? "Creating…" : "Create job"}
              </Button>
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Jobs */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">Scraper jobs</h2>
        {loading && <div className="text-[12px] text-muted-foreground">Loading…</div>}
        {!loading && jobs.length === 0 && (
          <div className="rounded-md border border-dashed border-input p-6 text-center text-[12px] text-muted-foreground">
            No scraper jobs yet. Click "New scraper job" to set one up.
          </div>
        )}
        {jobs.map((job) => {
          const acct = accounts.find((a) => a.id === job.account_id)
          const statusDot = job.status === "running" ? "bg-green animate-pulse" : job.status === "paused" ? "bg-yellow-500" : job.status === "error" ? "bg-red" : "bg-muted-foreground"
          return (
            <div key={job.id} className="rounded-card border border-bg-tertiary bg-bg-secondary p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{job.guild_name || job.guild_id}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {acct ? `@${acct.username}` : job.account_id.slice(0, 8)} · every {job.interval_minutes}m
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                    {job.status}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => toggleJob(job)}>
                    {job.status === "running" ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Start</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteJob(job)} className="text-red hover:bg-red/10 hover:text-red">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                <span><Users className="inline h-3 w-3 mr-0.5" />{job.members_total.toLocaleString()} total · {job.members_new} new last run</span>
                <span>Last: {fmtRelative(job.last_scraped_at)}</span>
                {job.status === "running" && <span>Next: {fmtNextScrape(job.next_scrape_at)}</span>}
                {job.error_message && <span className="text-red truncate max-w-xs">⚠ {job.error_message}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Member pool */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">Member pool</h2>
          <div className="flex items-center gap-2">
            <select
              value={memberGuildFilter}
              onChange={(e) => setMemberGuildFilter(e.target.value)}
              className="rounded-md border border-input bg-bg-secondary px-2 py-1.5 text-[11px] text-text-normal focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">All servers</option>
              {scraperGuilds.map((g) => (
                <option key={g.guild_id} value={g.guild_id}>
                  {g.guild_name || g.guild_id} · {g.pending.toLocaleString()} pending / {g.total.toLocaleString()} total
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={members.length === 0}
              onClick={() => {
                const params = new URLSearchParams()
                if (selectedIds.size > 0) {
                  params.set("ids", [...selectedIds].join(","))
                } else {
                  if (memberGuildFilter) params.set("guild_id", memberGuildFilter)
                }
                const a = document.createElement("a")
                a.href = `/api/scraper/members/export.csv?${params}`
                a.download = ""
                a.click()
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {selectedIds.size > 0 ? `Export ${selectedIds.size} selected` : "Export CSV"}
            </Button>
            <Button size="sm" onClick={() => { setPushGuildId(memberGuildFilter || undefined); setPushOpen(true) }} disabled={stats.pending === 0}>
              <Zap className="h-3.5 w-3.5" /> Push to FR campaign
            </Button>
          </div>
        </div>

        {membersLoading && <div className="text-[12px] text-muted-foreground">Loading members…</div>}
        {!membersLoading && members.length === 0 && (
          <div className="rounded-md border border-dashed border-input p-4 text-center text-[12px] text-muted-foreground">
            No members scraped yet.
          </div>
        )}
        {!membersLoading && members.length > 0 && (
          <div className="rounded-card border border-bg-tertiary overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-bg-tertiary bg-bg-tertiary/40">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === members.length}
                      ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < members.length }}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(members.map((m) => m.id)) : new Set())}
                      className="h-4 w-4 rounded border border-text-muted/40 bg-bg-secondary accent-brand cursor-pointer"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">User</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Job</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">First seen</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const checked = selectedIds.has(m.id)
                  return (
                    <tr
                      key={m.id}
                      className={`border-b border-bg-tertiary/50 hover:bg-bg-tertiary/20 cursor-pointer ${checked ? "bg-brand/5" : ""}`}
                      onClick={() => setSelectedIds((prev) => {
                        const next = new Set(prev)
                        next.has(m.id) ? next.delete(m.id) : next.add(m.id)
                        return next
                      })}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedIds((prev) => {
                            const next = new Set(prev)
                            next.has(m.id) ? next.delete(m.id) : next.add(m.id)
                            return next
                          })}
                          className="h-4 w-4 rounded border border-text-muted/40 bg-bg-secondary accent-brand cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-text-normal">{m.global_name || m.username}</span>
                        <span className="ml-1.5 text-muted-foreground">@{m.username}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {m.guild_name || m.guild_id?.slice(0, 10) || <span className="italic opacity-60">unknown</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-medium ${
                          m.fr_status === "pending" ? "bg-bg-tertiary text-muted-foreground" :
                          m.fr_status === "fr_queued" ? "bg-yellow-500/10 text-yellow-400" :
                          "bg-emerald-500/10 text-emerald-500"
                        }`}>
                          {m.fr_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtRelative(m.first_seen_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* Sentinel — IntersectionObserver triggers loadMoreMembers when visible */}
            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="px-3 py-3 text-center text-[11px] text-muted-foreground border-t border-bg-tertiary">
                Loading more…
              </div>
            )}
            {!membersHasMore && members.length >= PAGE_SIZE && (
              <div className="px-3 py-2 text-center text-[11px] text-muted-foreground border-t border-bg-tertiary">
                All {members.length.toLocaleString()} members loaded
              </div>
            )}
          </div>
        )}
      </div>

      {pushOpen && (
        <PushModal
          stats={stats}
          accounts={accounts}
          frCampaigns={frCampaigns}
          initialGuildId={pushGuildId}
          initialGuildName={scraperGuilds.find((g) => g.guild_id === pushGuildId)?.guild_name}
          onClose={() => setPushOpen(false)}
          onPushed={() => { void refresh(); void fetchStats(memberGuildFilter || undefined); void loadMemberPool(memberGuildFilter || undefined) }}
        />
      )}
    </div>
  )
}
