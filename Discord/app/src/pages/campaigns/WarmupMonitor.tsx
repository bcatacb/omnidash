import { useEffect, useRef, useState } from "react"
import { subscribeRealtime } from "@/lib/realtime"
import { useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm"

interface Campaign { id: string; name: string; status: string; started_at: string | null; active_hours_start_utc: number; active_hours_end_utc: number; per_account_interval_min_minutes: number; per_account_interval_max_minutes: number; guild_id: string | null }
interface MutualGuild { id: string; name: string }
interface AcctRow { account_id: string; msgs_sent_count: number; partners_reached_count: number; last_sent_at: string | null; next_eligible_at: string | null; dead_since: string | null }
interface PairRow { account_a_id: string; account_b_id: string; msgs_a_to_b: number; msgs_b_to_a: number; paused_reason: string | null }
interface MsgRow { id: number; sender_account_id: string; recipient_account_id: string; ok: boolean; http_status: number | null; captcha_solved: boolean; cost_cents: number; sent_at: string; error: string | null; content: string }
interface AllAccount { id: string; username: string; label: string; status: string }

const DEFAULT_BANK = ["{hey|yo|sup} {there|friend}", "{quick|small} ping from my side", "{hope|trust} your day is going well"]

function timeUntil(iso: string | null): string {
  if (!iso) return "ready"
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "ready"
  const sec = Math.ceil(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.ceil(sec / 60)}m`
}

export default function WarmupMonitor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [c, setC] = useState<Campaign | null>(null)
  const [accts, setAccts] = useState<AcctRow[]>([])
  const [pairs, setPairs] = useState<PairRow[]>([])
  const [msgs, setMsgs] = useState<MsgRow[]>([])
  const [feed, setFeed] = useState<Array<{ ts: string; text: string; dot: string }>>([])
  const feedEndRef = useRef<HTMLDivElement>(null)
  // Hot-swap state
  const [allAccounts, setAllAccounts] = useState<AllAccount[]>([])
  const [addingAccount, setAddingAccount] = useState(false)
  const [selectedAddId, setSelectedAddId] = useState("")
  const [addBusy, setAddBusy] = useState(false)
  const [eligibleAccounts, setEligibleAccounts] = useState<AllAccount[]>([])
  const [removeBusy, setRemoveBusy] = useState<string | null>(null)
  const [quarantineBusy, setQuarantineBusy] = useState<string | null>(null)
  const [pairAllBusy, setPairAllBusy] = useState(false)
  const [mutualGuilds, setMutualGuilds] = useState<MutualGuild[]>([])
  const [guildBusy, setGuildBusy] = useState(false)
  const confirm = useConfirm()

  const refresh = async () => {
    if (!id) return
    const [det, ms] = await Promise.all([
      fetch(`/api/warmup-campaigns/${id}`).then((r) => r.json()),
      fetch(`/api/warmup-campaigns/${id}/messages?limit=50`).then((r) => r.json()),
    ])
    setC(det.campaign); setAccts(det.accounts || []); setPairs(det.pairs || []); setMsgs(ms.messages || [])
  }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5_000); return () => clearInterval(t) }, [id])

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setAllAccounts(d.map((a: any) => ({ id: a.id, username: a.username, label: a.label, status: a.status })))
    }).catch(() => {})
    if (id) {
      fetch(`/api/warmup-campaigns/${id}/mutual-guilds`).then((r) => r.json())
        .then((d) => { if (Array.isArray(d.guilds)) setMutualGuilds(d.guilds) }).catch(() => {})
      fetch(`/api/warmup-campaigns/${id}/eligible-accounts`).then((r) => r.json())
        .then((d) => { if (Array.isArray(d.accounts)) setEligibleAccounts(d.accounts.map((a: any) => ({ id: a.id, username: a.username, label: a.label || "", status: "connected" }))) }).catch(() => {})
    }
  }, [id])

  // SSE feed — warmup-specific events
  useEffect(() => {
    if (!id) return
    const push = (text: string, dot: string) => {
      setFeed(prev => [...prev.slice(-199), { ts: new Date().toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }), text, dot }])
    }
    return subscribeRealtime((raw) => {
      try {
        const ev = JSON.parse(raw.data)
        if (ev.campaignId !== id) return
        if (ev.type === "warmup_msg_sent") { push(`@${ev.senderLabel} → @${ev.partnerLabel}`, "bg-emerald-500"); void refresh() }
        else if (ev.type === "warmup_account_dead") push(`${ev.reason}`, "bg-rose-500")
        else if (ev.type === "warmup_rate_limited") push(`${ev.reason}`, "bg-amber-500")
        else if (ev.type === "warmup_pair_paused") push(`${ev.reason}`, "bg-orange-400")
        else if (ev.type === "warmup_daily_cap") push(`Daily cap hit (${ev.sendsToday}/${ev.cap}) — resumes tomorrow`, "bg-sky-400")
        else if (ev.type === "warmup_browser_failed") push(`@${ev.senderLabel} browser send failed — retry in 5m (${(ev.error || "").slice(0, 60)})`, "bg-violet-500")
      } catch { /* ignore parse errors */ }
    })
  }, [id])

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [feed.length])

  const removeAccount = async (accountId: string) => {
    if (!id) return
    const ok = await confirm({
      title: "Remove account from warmup?",
      description: "This account and all its pairs will be removed from the campaign. The campaign continues running with the remaining accounts.",
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!ok) return
    setRemoveBusy(accountId)
    await fetch(`/api/warmup-campaigns/${id}/accounts/${accountId}`, { method: "DELETE" }).catch(() => {})
    setRemoveBusy(null)
    void refresh()
  }

  const quarantineAccount = async (accountId: string) => {
    const ok = await confirm({
      title: "Quarantine this account?",
      description: "The account will be marked quarantined globally and removed from all active warmup campaigns.",
      confirmLabel: "Quarantine",
      variant: "danger",
    })
    if (!ok) return
    setQuarantineBusy(accountId)
    await fetch(`/api/accounts/${accountId}/quarantine`, { method: "POST" }).catch(() => {})
    setQuarantineBusy(null)
    void refresh()
  }

  const addAccount = async () => {
    if (!id || !selectedAddId) return
    setAddBusy(true)
    const r = await fetch(`/api/warmup-campaigns/${id}/accounts/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: selectedAddId, messageBank: DEFAULT_BANK }),
    }).catch(() => null)
    setAddBusy(false)
    if (r && !r.ok) {
      const body = await r.json().catch(() => ({}))
      alert(body.error || "Failed to add account")
      return
    }
    setAddingAccount(false)
    setSelectedAddId("")
    void refresh()
  }

  if (!c) return <div className="p-6 text-text-muted">Loading…</div>
  const action = async (verb: "pause" | "resume" | "cancel") => {
    await fetch(`/api/warmup-campaigns/${id}/${verb}`, { method: "POST" }); void refresh()
  }

  const enrolledIds = new Set(accts.map((a) => a.account_id))
  const deleteSession = async () => {
    const ok = await confirm({
      title: "Delete warmup session permanently?",
      description: "All accounts, pairs, and message history for this session will be deleted. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!ok) return
    await fetch(`/api/warmup-campaigns/${id}`, { method: "DELETE" })
    navigate("/app/campaigns")
  }
  const setGuild = async (guildId: string | null) => {
    if (!id) return
    setGuildBusy(true)
    try {
      await fetch(`/api/warmup-campaigns/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      })
      void refresh()
    } finally { setGuildBusy(false) }
  }

  const totalCost = msgs.reduce((s, m) => s + Number(m.cost_cents || 0), 0)
  const alive = accts.filter((a) => !a.dead_since).length
  const tenureHours = c.started_at ? Math.floor((Date.now() - new Date(c.started_at).getTime()) / 3_600_000) : 0

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{c.name}</h1>
          <div className="text-[12px] text-text-muted">id={c.id} · status={c.status} · running {tenureHours}h · {alive}/{accts.length} alive · UTC {c.active_hours_start_utc}–{c.active_hours_end_utc} · interval {c.per_account_interval_min_minutes}–{c.per_account_interval_max_minutes}m</div>
        </div>
        <div className="flex gap-2">
          {c.status === "running" && <Button size="sm" onClick={() => void action("pause")}>Pause</Button>}
          {c.status === "paused" && <Button size="sm" onClick={() => void action("resume")}>Resume</Button>}
          {(c.status === "running" || c.status === "paused") && <Button size="sm" variant="ghost" onClick={() => void action("cancel")}>Stop</Button>}
          <Button size="sm" variant="destructive" onClick={() => void deleteSession()}>Delete</Button>
        </div>
      </div>

      <section className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
          <div className="text-[11px] text-text-muted">Active window (UTC)</div>
          <div className="text-sm font-semibold">{c.active_hours_start_utc}:00 - {c.active_hours_end_utc}:00</div>
        </div>
        <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
          <div className="text-[11px] text-text-muted">Interval / account</div>
          <div className="text-sm font-semibold">{c.per_account_interval_min_minutes}-{c.per_account_interval_max_minutes} min</div>
        </div>
        <div className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
          <div className="text-[11px] text-text-muted">Recent message cost</div>
          <div className="text-sm font-semibold">${(totalCost / 100).toFixed(3)}</div>
        </div>
        <div className={`rounded-card border p-3 ${c.guild_id ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="text-[11px] text-text-muted mb-1">Discord Server</div>
          {c.guild_id ? (
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold truncate">
                {mutualGuilds.find(g => g.id === c.guild_id)?.name || c.guild_id}
              </span>
              <button onClick={() => void setGuild(null)} disabled={guildBusy} className="ml-auto text-[10px] text-text-muted hover:text-text-normal shrink-0">✕</button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-[11px] text-amber-400">No server — captcha likely</div>
              {mutualGuilds.length > 0 ? (
                <select
                  className="w-full rounded border border-input bg-background px-1.5 py-1 text-[11px]"
                  defaultValue=""
                  disabled={guildBusy}
                  onChange={(e) => { if (e.target.value) void setGuild(e.target.value) }}
                >
                  <option value="">Pick a server…</option>
                  {mutualGuilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              ) : (
                <div className="text-[10px] text-text-muted">Waiting for gateway guild data…</div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Accounts ({accts.length})</h2>
          <div className="flex items-center gap-3">
            {c.status === "running" && (() => {
              const pairedIds = new Set(pairs.flatMap((p) => [p.account_a_id, p.account_b_id]))
              const unpaired = accts.filter((a) => !a.dead_since && !pairedIds.has(a.account_id)).length
              return unpaired > 0 ? (
                <button
                  type="button"
                  disabled={pairAllBusy}
                  onClick={async () => {
                    setPairAllBusy(true)
                    const r = await fetch(`/api/warmup-campaigns/${id}/pair-all`, { method: "POST" }).then((r) => r.json()).catch(() => ({}))
                    setPairAllBusy(false)
                    void refresh()
                    alert(`Paired ${r.created ?? 0} new pairs (${r.skippedSameProxy ?? 0} skipped same-proxy). ${unpaired} accounts now have partners.`)
                  }}
                  className="text-[11px] font-semibold text-amber-600 hover:underline disabled:opacity-50"
                >
                  {pairAllBusy ? "Pairing…" : `Pair all (${unpaired} unpaired)`}
                </button>
              ) : null
            })()}
            {c.status === "running" && (
              <button
                type="button"
                onClick={() => {
                  setAddingAccount((v) => !v)
                  if (id) {
                    fetch(`/api/warmup-campaigns/${id}/eligible-accounts`).then((r) => r.json())
                      .then((d) => { if (Array.isArray(d.accounts)) setEligibleAccounts(d.accounts.map((a: any) => ({ id: a.id, username: a.username, label: a.label || "", status: "connected" }))) }).catch(() => {})
                  }
                }}
                className="text-[11px] text-brand hover:underline"
              >
                + Add account
              </button>
            )}
          </div>
        </div>

        {/* Hot-add form */}
        {addingAccount && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-input bg-muted/30 p-2">
            <select
              value={selectedAddId}
              onChange={(e) => setSelectedAddId(e.target.value)}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-[12px]"
            >
              <option value="">— pick an account —</option>
              {eligibleAccounts.length === 0 && (
                <option disabled value="">
                  {c.guild_id ? "No eligible accounts (not in server or all enrolled)" : "No connected accounts available"}
                </option>
              )}
              {eligibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label || a.username} (@{a.username})</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void addAccount()}
              disabled={!selectedAddId || addBusy}
              className="rounded-chip bg-brand px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {addBusy ? "Adding…" : "Add & auto-pair"}
            </button>
            <button type="button" onClick={() => setAddingAccount(false)} className="text-[11px] text-text-muted hover:text-text-normal">Cancel</button>
          </div>
        )}

        <table className="w-full text-[12px]">
          <thead className="text-text-muted">
            <tr><th className="text-left">Account</th><th>Sent</th><th>Pairs</th><th>Last sent</th><th>Next send</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {accts.map((a) => {
              const label = allAccounts.find((x) => x.id === a.account_id)
              const name = label ? (label.label || label.username || a.account_id.slice(0, 10)) : a.account_id.slice(0, 10)
              const nextIn = timeUntil(a.next_eligible_at)
              const pairCount = pairs.filter((p) => p.account_a_id === a.account_id || p.account_b_id === a.account_id).length
              return (
                <tr key={a.account_id} className="border-t border-bg-tertiary">
                  <td className="py-1.5 font-medium">@{name}</td>
                  <td className="text-center">{a.msgs_sent_count}</td>
                  <td className="text-center">{pairCount}</td>
                  <td className="text-center text-text-muted">{a.last_sent_at ? new Date(a.last_sent_at).toLocaleTimeString() : "—"}</td>
                  <td className="text-center text-text-muted tabular-nums">
                    {a.dead_since ? "—" : <span className={nextIn === "ready" ? "text-emerald-500" : ""}>{nextIn}</span>}
                  </td>
                  <td>
                    {a.dead_since
                      ? <span className="text-rose-600 font-medium">Dead</span>
                      : <span className="text-emerald-600">Active</span>}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {a.dead_since && (
                        <button
                          type="button"
                          onClick={() => void quarantineAccount(a.account_id)}
                          disabled={quarantineBusy === a.account_id}
                          className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50"
                        >
                          {quarantineBusy === a.account_id ? "…" : "Quarantine"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeAccount(a.account_id)}
                        disabled={removeBusy === a.account_id}
                        className="text-[10px] text-rose-600 hover:underline disabled:opacity-50"
                      >
                        {removeBusy === a.account_id ? "…" : "Remove"}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Live event feed */}
      <section className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
        <h2 className="text-sm font-semibold mb-2">Live activity</h2>
        {feed.length === 0 ? (
          <p className="text-[12px] text-text-muted">No events yet — issues will appear here as they happen.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {feed.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className="shrink-0 text-text-muted tabular-nums">{f.ts}</span>
                <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${f.dot}`} />
                <span>{f.text}</span>
              </li>
            ))}
            <div ref={feedEndRef} />
          </ul>
        )}
      </section>

      <details className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
        <summary className="cursor-pointer text-sm font-semibold">Pairs ({pairs.length})</summary>
        <table className="mt-2 w-full text-[12px]">
          <thead className="text-text-muted"><tr><th className="text-left">A</th><th className="text-left">B</th><th>A→B</th><th>B→A</th><th>Status</th></tr></thead>
          <tbody>{pairs.map((p, i) => (
            <tr key={i} className="border-t border-bg-tertiary">
              <td className="font-mono">{p.account_a_id}</td><td className="font-mono">{p.account_b_id}</td>
              <td className="text-center">{p.msgs_a_to_b}</td><td className="text-center">{p.msgs_b_to_a}</td>
              <td>{p.paused_reason ? <span className="text-rose-600">paused: {p.paused_reason}</span> : "ok"}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>

      <details className="rounded-card border border-bg-tertiary bg-bg-secondary p-3">
        <summary className="cursor-pointer text-sm font-semibold">Recent messages ({msgs.length})</summary>
        <ul className="mt-2 space-y-1 text-[11px] font-mono max-h-96 overflow-auto">
          {msgs.map((m) => (
            <li key={m.id} className={m.ok ? "text-emerald-600" : "text-rose-600"}>
              {new Date(m.sent_at).toLocaleTimeString()} · {m.sender_account_id} → {m.recipient_account_id} · http={m.http_status || "?"} {m.captcha_solved && "🔓"} {m.error ? `· ${m.error.slice(0, 80)}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
