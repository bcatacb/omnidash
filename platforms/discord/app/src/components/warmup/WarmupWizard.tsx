import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useNotify } from "@/components/ui/confirm"
import PairMatrix, { PairMatrixAccount } from "./PairMatrix"
import MessageBankEditor from "./MessageBankEditor"

interface Props { onClose: () => void; onCreated: (id: string) => void }
interface AccountRow { id: string; username: string; proxyId: string | null; status: string }
interface BankPreset { id: string; name: string; messages: string[] }

const DEFAULT_BANK = [
  "{hey|yo|sup} {there|friend}",
  "{quick|small} ping from my side",
  "{hope|trust} your day is going well",
]

export default function WarmupWizard({ onClose, onCreated }: Props) {
  const notify = useNotify()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState("Warmup batch")
  const [allDay, setAllDay] = useState(true)
  const [startHr, setStartHr] = useState(0)
  const [endHr, setEndHr] = useState(0)
  const [intMin, setIntMin] = useState(10)
  const [intMax, setIntMax] = useState(20)
  const [betweenMin, setBetweenMin] = useState(5)
  const [dailyCap, setDailyCap] = useState(15)
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [banks, setBanks] = useState<Record<string, string[]>>({})
  const [pairs, setPairs] = useState<Set<string>>(new Set())
  const [randomN, setRandomN] = useState(3)
  const [submitting, setSubmitting] = useState(false)
  const [guildId, setGuildId] = useState("")
  const [guildsByAccount, setGuildsByAccount] = useState<Record<string, { id: string; name: string }[]>>({})
  const [guildsLoading, setGuildsLoading] = useState(false)
  const [guildsLoaded, setGuildsLoaded] = useState(0)
  const [presets, setPresets] = useState<BankPreset[]>([])
  const [savingPreset, setSavingPreset] = useState(false)

  const fetchPresets = () =>
    fetch("/api/warmup-bank-presets").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})

  useEffect(() => {
    void fetchPresets()
    fetch("/api/accounts").then((r) => r.json()).then(async (j) => {
      // /api/accounts returns a flat array (not {accounts: [...]}).
      const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.accounts) ? j.accounts : []
      const arr: AccountRow[] = list
        .filter((a: any) => a.status === "connected")
        .map((a: any) => ({
          id: a.id,
          username: a.username || a.label || a.id,
          proxyId: a.proxyId || a.proxy_id || null,
          status: a.status,
        }))
      setAccounts(arr)
      setSelected(new Set(arr.map((a) => a.id)))
      // Use saved "default" preset if available, otherwise fall back to DEFAULT_BANK.
      let startBank = DEFAULT_BANK
      try {
        const pr = await fetch("/api/warmup-bank-presets")
        const pd = await pr.json()
        if (Array.isArray(pd)) {
          setPresets(pd)
          const def = pd.find((p: BankPreset) => p.name === "default")
          if (def && def.messages.length > 0) startBank = def.messages
        }
      } catch { /* ignore */ }
      const seeded: Record<string, string[]> = {}
      for (const a of arr) seeded[a.id] = [...startBank]
      setBanks(seeded)
      // Fetch guild lists for all accounts in background so we can offer server-based selection
      setGuildsLoading(true)
      let done = 0
      for (const a of arr) {
        fetch(`/api/accounts/${a.id}/guilds`)
          .then((r) => r.json())
          .then((j) => {
            setGuildsByAccount((prev) => ({ ...prev, [a.id]: (j.guilds || []).map((g: any) => ({ id: g.id, name: g.name })) }))
            done++
            setGuildsLoaded(done)
            if (done === arr.length) setGuildsLoading(false)
          })
          .catch(() => {
            done++
            setGuildsLoaded(done)
            if (done === arr.length) setGuildsLoading(false)
          })
      }
      if (arr.length === 0) setGuildsLoading(false)
    }).catch(() => { /* */ })
  }, [])

  const togglePair = (a: string, b: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    setPairs((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next })
  }
  const matrixAccounts: PairMatrixAccount[] = accounts.filter((a) => selected.has(a.id))

  const isCrossProxy = (a: AccountRow, b: AccountRow): boolean =>
    !(a.proxyId && b.proxyId && a.proxyId === b.proxyId)

  // Guilds that appear across 2+ accounts — only these can reliably DM each other
  const sharedGuilds = useMemo(() => {
    const map = new Map<string, { name: string; accountIds: string[] }>()
    for (const [acctId, guilds] of Object.entries(guildsByAccount)) {
      for (const g of guilds) {
        const entry = map.get(g.id) ?? { name: g.name, accountIds: [] }
        entry.accountIds.push(acctId)
        map.set(g.id, entry)
      }
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.accountIds.length >= 2)
      .map(([id, v]) => ({ id, name: v.name, accountIds: v.accountIds }))
      .sort((a, b) => b.accountIds.length - a.accountIds.length)
  }, [guildsByAccount])

  const pairAll = () => {
    const next = new Set<string>()
    const xs = accounts.filter((a) => selected.has(a.id))
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const a = xs[i]!, b = xs[j]!
        if (!isCrossProxy(a, b)) continue
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
        next.add(k)
      }
    }
    setPairs(next)
  }
  const buildPairSet = (selectedIds: Set<string>) => {
    const next = new Set<string>()
    const xs = accounts.filter((a) => selectedIds.has(a.id))
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const a = xs[i]!, b = xs[j]!
        if (!isCrossProxy(a, b)) continue
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
        next.add(k)
      }
    }
    return next
  }
  const savePreset = async (presetName: string) => {
    const sample = matrixAccounts[0] ? banks[matrixAccounts[0].id] || [] : Object.values(banks)[0] || []
    if (sample.length === 0) { void notify({ title: "No messages to save", variant: "error" }); return }
    setSavingPreset(true)
    try {
      await fetch(`/api/warmup-bank-presets/${encodeURIComponent(presetName)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: sample }),
      })
      void notify({ title: `Preset "${presetName}" saved`, variant: "success" })
      void fetchPresets()
    } catch { void notify({ title: "Save failed", variant: "error" }) }
    finally { setSavingPreset(false) }
  }

  const applyPreset = (preset: BankPreset) => {
    setBanks((prev) => {
      const next = { ...prev }
      for (const a of matrixAccounts) next[a.id] = [...preset.messages]
      return next
    })
  }
  const clearAll = () => setPairs(new Set())
  const applyBankToAll = (fromId: string) => {
    const src = banks[fromId]
    if (!src || src.length === 0) return
    setBanks((prev) => {
      const next = { ...prev }
      for (const a of matrixAccounts) next[a.id] = [...src]
      return next
    })
  }
  const pairEachWithN = (n: number) => {
    // Always starts from scratch — replaces any existing pairs so the result
    // is exactly N partners per account, not "N more on top of what's already there".
    const next = new Set<string>()
    const xs = accounts.filter((a) => selected.has(a.id))
    for (const a of xs) {
      const candidates = xs.filter((b) => b.id !== a.id && isCrossProxy(a, b))
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
          ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
      }
      const want = Math.min(n, candidates.length)
      let added = 0
      for (const b of candidates) {
        if (added >= want) break
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
        if (!next.has(k)) { next.add(k); added += 1 }
      }
    }
    setPairs(next)
  }
  const toggleRow = (accountId: string) => {
    const me = accounts.find((a) => a.id === accountId)
    if (!me) return
    const partners = accounts.filter((b) => b.id !== accountId && selected.has(b.id) && isCrossProxy(me, b))
    const allOn = partners.every((b) => {
      const k = me.id < b.id ? `${me.id}|${b.id}` : `${b.id}|${me.id}`
      return pairs.has(k)
    })
    const next = new Set(pairs)
    for (const b of partners) {
      const k = me.id < b.id ? `${me.id}|${b.id}` : `${b.id}|${me.id}`
      if (allOn) next.delete(k); else next.add(k)
    }
    setPairs(next)
  }

  const submit = async () => {
    if (!name.trim()) { void notify({ title: "Name required", variant: "error" }); return }
    if (selected.size < 2) { void notify({ title: "Pick at least 2 accounts", variant: "error" }); return }
    if (pairs.size === 0) { void notify({ title: "Add at least one pair", variant: "error" }); return }
    for (const id of selected) {
      if (!banks[id] || banks[id].length === 0) { void notify({ title: `Account ${id} has empty message bank`, variant: "error" }); return }
    }
    setSubmitting(true)
    try {
      const r = await fetch("/api/warmup-campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, active_hours_start_utc: startHr, active_hours_end_utc: endHr,
          per_account_interval_min_minutes: intMin, per_account_interval_max_minutes: intMax,
          between_account_interval_minutes: betweenMin, daily_send_cap: dailyCap,
          ...(guildId ? { guild_id: guildId } : {}),
        }),
      })
      const cj = await r.json()
      if (!r.ok || !cj.id) throw new Error(cj.error || "create failed")
      const id = cj.id as string

      // Single bulk request — all accounts and pairs in one round-trip.
      const setupRes = await fetch(`/api/warmup-campaigns/${id}/setup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accounts: [...selected].map((acctId) => ({ accountId: acctId, messageBank: banks[acctId] || [] })),
          pairs: [...pairs].map((k) => { const [a, b] = k.split("|"); return { acctA: a, acctB: b } }),
        }),
      })
      const sj = await setupRes.json().catch(() => ({}))
      if (sj.skippedPairs?.length) {
        void notify({ title: `${sj.skippedPairs.length} pair(s) skipped (same proxy)`, variant: "error" })
      }

      await fetch(`/api/warmup-campaigns/${id}/start`, { method: "POST" })
      onCreated(id)
      onClose()
    } catch (err: any) {
      void notify({ title: "Create failed", description: err?.message || String(err), variant: "error" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-card border border-bg-tertiary bg-bg-secondary p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">New warmup — step {step}/3</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-normal">✕</button>
        </div>
        {step === 1 && (
          <div className="space-y-3">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls()} /></Field>
            {guildId ? (
              <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-400">
                <span className="font-semibold">Server selected:</span>
                <span className="font-mono">{sharedGuilds.find(g => g.id === guildId)?.name || guildId}</span>
                <button onClick={() => setGuildId("")} className="ml-auto text-text-muted hover:text-text-normal">✕</button>
              </div>
            ) : (
              <p className="text-[11px] text-amber-400/90 bg-amber-500/10 rounded px-2 py-1.5">No server selected — pick one in step 2. Without a mutual server, Discord will challenge every warmup DM with a captcha.</p>
            )}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Field label="Per-account min (min)"><input type="number" min={1} value={intMin} onChange={(e) => setIntMin(+e.target.value || 10)} className={fieldCls()} /></Field>
                <p className="mt-1 text-[10px] text-text-muted">Recommended: <strong>10</strong></p>
              </div>
              <div>
                <Field label="Per-account max (min)"><input type="number" min={1} value={intMax} onChange={(e) => setIntMax(+e.target.value || 20)} className={fieldCls()} /></Field>
                <p className="mt-1 text-[10px] text-text-muted">Recommended: <strong>20</strong></p>
              </div>
              <div>
                <Field label="Between accounts (min)"><input type="number" min={1} value={betweenMin} onChange={(e) => setBetweenMin(+e.target.value || 5)} className={fieldCls()} /></Field>
                <p className="mt-1 text-[10px] text-text-muted">Recommended: <strong>5</strong></p>
              </div>
              <div>
                <Field label="Daily sends / account"><input type="number" min={1} max={500} value={dailyCap} onChange={(e) => setDailyCap(+e.target.value || 15)} className={fieldCls()} /></Field>
                <p className="mt-1 text-[10px] text-text-muted">Recommended: <strong>15</strong></p>
              </div>
            </div>
            <p className="text-[11px] text-amber-500/90 bg-amber-500/10 rounded px-2 py-1.5">
              Per-account = cooldown per account after each send. Between-accounts = global gap before any other account sends. Daily cap = max sends per account per 24h. Higher intervals = safer tokens.
            </p>
            <label className="flex items-center gap-2 text-[12px] text-text-normal cursor-pointer select-none">
              <input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); if (e.target.checked) { setStartHr(0); setEndHr(0); } }} className="rounded" />
              Run 24/7 (recommended)
            </label>
            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Active hours UTC (start)"><input type="number" min={0} max={23} value={startHr} onChange={(e) => setStartHr(+e.target.value || 0)} className={fieldCls()} /></Field>
                <Field label="Active hours UTC (end)"><input type="number" min={1} max={24} value={endHr || 24} onChange={(e) => setEndHr(+e.target.value || 24)} className={fieldCls()} /></Field>
              </div>
            )}
            <p className="text-[11px] text-text-muted">Warmup runs continuously until you stop it. Accounts rotate messages within the interval range.</p>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-[11px] text-text-muted">Pick accounts to enrol. Accounts must share a mutual Discord server to DM each other.</p>

            {/* Anti-ban constraint info */}
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200 space-y-0.5">
              <div className="font-semibold">Discord DM constraints</div>
              <div>· <strong>Mutual server required</strong> — accounts without a shared server get 50009 errors (pair auto-paused)</div>
              <div>· <strong>Cross-proxy required</strong> — same-proxy pairs are rejected to prevent fingerprint burns</div>
              <div>· <strong>401 = dead account</strong> — token revoked; engine skips it automatically until operator refreshes token</div>
            </div>

            {/* Server-based account loading */}
            <div className="rounded border border-input bg-muted/30 p-2">
              <label className="text-[11px] font-medium text-foreground">
                Select a server — only accounts in that server will be enrolled
              </label>
              {guildsLoading ? (
                <div className="mt-1 text-[11px] text-text-muted">Loading server data… ({guildsLoaded}/{accounts.length})</div>
              ) : sharedGuilds.length > 0 ? (
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[12px] text-foreground"
                  defaultValue=""
                  onChange={(e) => {
                    const guild = sharedGuilds.find((g) => g.id === e.target.value)
                    if (!guild) return
                    const ids = new Set(guild.accountIds)
                    setSelected(ids)
                    setGuildId(guild.id)
                    const def = presets.find((p) => p.name === "default")
                    const fallback = def && def.messages.length > 0 ? def.messages : DEFAULT_BANK
                    setBanks((prev) => {
                      const next = { ...prev }
                      for (const id of ids) { if (!next[id] || next[id].length === 0) next[id] = [...fallback] }
                      return next
                    })
                  }}
                >
                  <option value="">— pick a server to auto-select its accounts —</option>
                  {sharedGuilds.map((g) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.accountIds.length} accounts)</option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 text-[11px] text-amber-400">No shared servers found — make sure accounts are connected and in the same server.</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const auto = accounts
                  setSelected(new Set(auto.map((a) => a.id)))
                }}
              >
                Auto-select ready accounts
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
            <div className="grid grid-cols-2 gap-1 max-h-96 overflow-auto rounded border border-bg-tertiary p-2">
              {accounts.map((a) => {
                const checked = selected.has(a.id)
                const accountGuilds = guildsByAccount[a.id]
                const notInServer = !!(guildId && accountGuilds && accountGuilds.length > 0 && !accountGuilds.some((g) => g.id === guildId))
                return (
                  <label key={a.id} className={`flex items-center gap-2 text-[11px] ${notInServer ? "opacity-40 cursor-not-allowed" : ""}`}>
                    <input type="checkbox" checked={checked && !notInServer} disabled={notInServer} onChange={() => {
                      if (notInServer) return
                      setSelected((p) => { const n = new Set(p); if (checked) n.delete(a.id); else n.add(a.id); return n })
                      if (!checked) {
                        const def = presets.find((p) => p.name === "default")
                        const fallback = def && def.messages.length > 0 ? def.messages : DEFAULT_BANK
                        setBanks((prev) => ({ ...prev, [a.id]: prev[a.id] || [...fallback] }))
                      }
                    }} />
                    <span className="font-mono">@{a.username}</span>
                    <span className="text-text-muted">(proxy={a.proxyId ?? "none"})</span>
                    {notInServer && <span className="text-rose-500 text-[10px]">not in server</span>}
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-text-muted">{selected.size} selected</p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[11px] text-text-muted">Click cells, click a row username to toggle the whole row, or use bulk actions below. Red cells are same-proxy and disabled.</p>
            <div className="flex flex-wrap items-center gap-2 rounded border border-bg-tertiary bg-bg-tertiary/30 p-2 text-[11px]">
              <span className="text-text-muted">Bulk:</span>
              <Button size="sm" variant="ghost" type="button" onClick={pairAll} disabled={submitting}>Pair all (cross-proxy)</Button>
              <Button size="sm" variant="ghost" type="button" onClick={clearAll} disabled={submitting}>Clear all</Button>
              <span className="ml-2 text-text-muted">Each account with</span>
              <input
                type="number" min={1} max={50} value={randomN}
                onChange={(e) => setRandomN(Math.max(1, Math.min(50, +e.target.value || 1)))}
                disabled={submitting}
                className="w-14 rounded-md border border-bg-tertiary bg-bg-tertiary/50 px-2 py-1 text-[11px]"
              />
              <span className="text-text-muted">random partners</span>
              <Button size="sm" type="button" onClick={() => pairEachWithN(randomN)} disabled={submitting}>Pair</Button>
              <span className="ml-auto font-mono text-text-muted">{pairs.size} pairs</span>
            </div>
            {/* Bank preset save / load */}
            <div className="flex flex-wrap items-center gap-2 rounded border border-bg-tertiary bg-bg-tertiary/20 p-2 text-[11px]">
              <span className="text-text-muted font-medium">Message banks:</span>
              {presets.length > 0 && (
                <select
                  className="rounded-md border border-bg-tertiary bg-bg-tertiary/50 px-2 py-1 text-[11px]"
                  defaultValue=""
                  onChange={(e) => {
                    const p = presets.find((x) => x.id === e.target.value)
                    if (p) applyPreset(p)
                  }}
                >
                  <option value="">Load saved preset…</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.messages.length} msgs)</option>)}
                </select>
              )}
              <Button size="sm" variant="ghost" onClick={() => void savePreset("default")} disabled={savingPreset}>
                {savingPreset ? "Saving…" : "Save banks as default"}
              </Button>
            </div>
            <PairMatrix accounts={matrixAccounts} pairs={pairs} onTogglePair={togglePair} onToggleRow={toggleRow} disabled={submitting} />
            <div className="flex flex-wrap gap-2 rounded border border-bg-tertiary bg-bg-tertiary/20 p-2 text-[11px]">
              <Button size="sm" variant="ghost" onClick={pairAll} disabled={submitting}>Auto-generate best-effort pairs</Button>
              <span className="self-center text-text-muted">Message bank defaults are prefilled for selected accounts.</span>
            </div>
            <div className="space-y-2 max-h-96 overflow-auto">
              {matrixAccounts.map((a) => (
                <div key={a.id} className="rounded border border-bg-tertiary p-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
                    <span>@{a.username} <span className="text-text-muted">({a.id})</span></span>
                    <Button size="sm" variant="ghost" onClick={() => applyBankToAll(a.id)} disabled={submitting}>Apply this bank to all</Button>
                  </div>
                  <MessageBankEditor value={banks[a.id] || []} onChange={(v) => setBanks((p) => ({ ...p, [a.id]: v }))} disabled={submitting} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="ghost" onClick={() => setStep(((step - 1) as 1 | 2))} disabled={submitting}>Back</Button>}
            {step < 3 && <Button onClick={() => {
              if (step === 2) pairEachWithN(randomN)
              setStep(((step + 1) as 2 | 3))
            }}>{step === 2 ? "Customize pairs & messages" : "Next"}</Button>}
            {step === 3 && <Button onClick={() => void submit()} disabled={submitting}>{submitting ? "Creating…" : "Create & start"}</Button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-text-muted">{label}<div className="mt-0.5">{children}</div></label>
}
function fieldCls() { return "block w-full rounded-md border border-bg-tertiary bg-bg-tertiary/50 px-2 py-1.5 text-[12px] text-text-normal" }
