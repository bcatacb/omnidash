import { useCallback, useEffect, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Plus, Trash2, Shuffle, AlertTriangle, CheckCircle2, XCircle, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useNotify } from "@/components/ui/confirm"
import type { DiscordAccount, Proxy } from "@/api-types"

interface ProxyWithAssignments extends Proxy {
  accountIds: string[]
}

export default function Proxies() {
  const [proxies, setProxies] = useState<ProxyWithAssignments[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bulkInput, setBulkInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [previewLines, setPreviewLines] = useState<{ line: string; ok: boolean; host?: string; port?: string; error?: string }[]>([])
  const [previewTimer, setPreviewTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [rebalanceOpen, setRebalanceOpen] = useState(false)
  // Persists the last-used target so card colors stay meaningful after a rebalance.
  const [displayTarget, setDisplayTarget] = useState<number>(() => {
    const saved = localStorage.getItem("proxies-display-target")
    return saved ? Math.max(1, parseInt(saved, 10) || 2) : 2
  })
  const notify = useNotify()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pResp, aResp] = await Promise.all([
        fetch("/api/proxies"),
        fetch("/api/accounts"),
      ])
      if (!pResp.ok) throw new Error(`GET /api/proxies → HTTP ${pResp.status}`)
      const pJson = await pResp.json()
      const aJson = await aResp.json()
      setProxies(Array.isArray(pJson) ? pJson : [])
      setAccounts(Array.isArray(aJson) ? aJson : [])
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 60_000)

  const handleBulkInputChange = (val: string) => {
    setBulkInput(val)
    if (previewTimer) clearTimeout(previewTimer)
    if (!val.trim()) { setPreviewLines([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/proxies/parse-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: val }),
        })
        if (r.ok) setPreviewLines(await r.json())
      } catch { /* ignore preview errors */ }
    }, 400)
    setPreviewTimer(t)
  }

  const bulkAdd = async () => {
    if (!bulkInput.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch("/api/proxies/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: bulkInput }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setBulkInput("")
      if (j.failed?.length > 0) {
        setError(`${j.failed.length} line(s) failed to parse; first: ${j.failed[0].error}`)
      }
      await refresh()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteProxy = async (id: string) => {
    if (!window.confirm("Delete this proxy? Assigned accounts will lose their routing.")) return
    await fetch(`/api/proxies/${id}`, { method: "DELETE" })
    await refresh()
  }

  const assign = async (proxyId: string, accountId: string) => {
    const currentProxy = proxies.find((p) => p.accountIds.includes(accountId))
    if (currentProxy && currentProxy.id !== proxyId) {
      const ok = window.confirm(
        "⚠️ This account is already assigned to a proxy.\n\nMoving it to a different proxy mid-warmup can trigger a suspicious activity flag from Discord.\n\nContinue anyway?",
      )
      if (!ok) return
    }
    await fetch(`/api/proxies/${proxyId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    })
    await refresh()
  }

  const unassign = async (accountId: string) => {
    await fetch(`/api/proxies/assignments/${accountId}`, { method: "DELETE" })
    await refresh()
  }

  const [rebalancing, setRebalancing] = useState(false)
  const [lastRebalance, setLastRebalance] = useState<{ changed: number; removed: number; unassigned: number } | null>(null)
  // proxyId → test result
  const [testResults, setTestResults] = useState<Record<string, { testing: boolean; ok?: boolean; ip?: string; error?: string }>>({})

  const testProxy = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { testing: true } }))
    try {
      const r = await fetch(`/api/proxies/${id}/test`, { method: "POST" })
      const j = await r.json()
      setTestResults((prev) => ({ ...prev, [id]: { testing: false, ok: j.ok, ip: j.ip, error: j.error } }))
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: { testing: false, ok: false, error: err?.message || "fetch failed" } }))
    }
  }

  const doRebalance = async (accountsPerProxy: number) => {
    setRebalanceOpen(false)
    setDisplayTarget(accountsPerProxy)
    localStorage.setItem("proxies-display-target", String(accountsPerProxy))
    setRebalancing(true)
    setError(null)
    try {
      const r = await fetch("/api/admin/proxies/rebalance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountsPerProxy }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setLastRebalance({ changed: j.changed, removed: j.removed, unassigned: j.unassigned })
      void notify({
        title: "Rebalanced",
        description: `${j.changed} reassigned · ${j.removed} unassigned · ${j.unassigned} on waitlist`,
        variant: "success",
      })
      await refresh()
    } catch (err: any) {
      setError(err?.message || String(err))
      void notify({ title: "Rebalance failed", description: err?.message || String(err), variant: "error" })
    } finally {
      setRebalancing(false)
    }
  }

  const unassignedAccounts = accounts.filter(
    (a) => !proxies.some((p) => p.accountIds.includes(a.id)),
  )

  const totalAssignments = proxies.reduce((s, p) => s + p.accountIds.length, 0)
  const overloadedProxies = proxies.filter((p) => p.accountIds.length > displayTarget).length
  const balanced = proxies.length > 0 && proxies.every((p) => p.accountIds.length === displayTarget)

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-xl font-semibold">Proxies</h1>
        <div className="flex items-center gap-2">
          <Button
            onClick={async () => {
              for (const p of proxies) await testProxy(p.id)
            }}
            disabled={proxies.length === 0 || Object.values(testResults).some((t) => t.testing)}
            variant="secondary"
            size="sm"
          >
            <Wifi className="h-4 w-4" />
            Test all
          </Button>
          <Button
            onClick={() => setRebalanceOpen(true)}
            disabled={rebalancing || proxies.length === 0}
            variant={overloadedProxies > 0 ? "default" : "secondary"}
            size="sm"
          >
            <Shuffle className="h-4 w-4" />
            {rebalancing ? "Rebalancing…" : "Rebalance"}
          </Button>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground mb-3">
        Each proxy is tied to a set of accounts. Backend gateway WS + REST egress for an account
        goes through its assigned proxy (v0.66 strict). Only <code className="rounded bg-muted px-1">discord.com</code> routes
        through the proxy — <code className="rounded bg-muted px-1">gg.linktree.bond</code> stays direct.
      </p>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-chip border border-bg-tertiary bg-bg-tertiary/50 px-2 py-1 font-medium">
          {proxies.length} proxies · {totalAssignments} accounts assigned · {unassignedAccounts.length} unassigned
        </span>
        {balanced ? (
          <span className="inline-flex items-center gap-1 rounded-chip bg-emerald-500/15 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Balanced at {displayTarget}/proxy
          </span>
        ) : overloadedProxies > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-chip bg-rose-500/15 px-2 py-1 font-medium text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" /> {overloadedProxies} overloaded — click Rebalance
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-chip bg-amber-500/15 px-2 py-1 font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Under-utilized — click Rebalance to spread evenly
          </span>
        )}
        {lastRebalance && (
          <span className="text-text-muted">
            last: changed {lastRebalance.changed}, removed {lastRebalance.removed}, unassigned {lastRebalance.unassigned}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
          <strong>Error:</strong> {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-5 rounded-card border border-bg-tertiary bg-bg-secondary p-4">
        <h2 className="text-base font-semibold mb-1">Add proxies (bulk paste)</h2>
        <p className="text-[11px] text-muted-foreground mb-2">
          Paste one proxy per line. Accepts Webshare table format{" "}
          <code className="rounded bg-muted px-1">ip:port:user:pass</code> (passwords with colons are handled)
          {" "}or full URLs{" "}
          <code className="rounded bg-muted px-1">http://user:pass@ip:port</code>.
        </p>
        <textarea
          value={bulkInput}
          onChange={(e) => handleBulkInputChange(e.target.value)}
          placeholder={"9.142.43.12:5182:user:pass\n9.142.211.162:5327:user:pass\n..."}
          rows={6}
          className="w-full resize-y rounded-md border border-bg-tertiary bg-bg-tertiary/50 p-2 font-mono text-[11px] text-text-normal placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          disabled={submitting}
        />
        {/* Live parse preview */}
        {previewLines.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-bg-tertiary bg-bg-tertiary/30 divide-y divide-bg-tertiary">
            {previewLines.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1">
                {p.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-red" />
                )}
                <span className="font-mono text-[10px] truncate text-text-muted flex-1">
                  {p.ok ? `${p.host}:${p.port}` : p.line}
                </span>
                {!p.ok && (
                  <span className="text-[10px] text-red shrink-0">{p.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          {previewLines.length > 0 && (
            <span className="text-[11px] text-text-muted">
              {previewLines.filter(p => p.ok).length}/{previewLines.length} valid
              {previewLines.some(p => !p.ok) && (
                <span className="ml-1 text-red">— fix errors before adding</span>
              )}
            </span>
          )}
          <div className="ml-auto">
            <Button onClick={bulkAdd} disabled={submitting || !bulkInput.trim() || previewLines.some(p => !p.ok)}>
              <Plus className="h-4 w-4" /> {submitting ? "Adding…" : "Add proxies"}
            </Button>
          </div>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && proxies.length === 0 && (
        <div className="rounded-md border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
          No proxies yet. Paste your list above to start.
        </div>
      )}

      <div className="space-y-3">
        {proxies.map((p) => {
          const safeUrl = p.url.replace(/\/\/[^@]+@/, "//[user:pass]@")
          const assignedAccounts = p.accountIds
            .map((id) => accounts.find((a) => a.id === id))
            .filter(Boolean) as DiscordAccount[]
          const load = assignedAccounts.length
          const loadColor =
            load === displayTarget ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" :
            load > displayTarget  ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" :
                                    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
          const cardBorder = load > displayTarget ? "border-rose-500/40" : "border-bg-tertiary"
          const test = testResults[p.id]
          return (
            <div key={p.id} className={`rounded-card border ${cardBorder} bg-bg-secondary p-4`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-chip border px-2 py-0.5 text-[11px] font-semibold ${loadColor}`}>
                      {load}/{displayTarget}
                    </span>
                    <div className="font-mono text-[12px] text-text-normal truncate">{safeUrl}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{p.label || p.geo || "no label"}</span>
                    {test && !test.testing && (
                      test.ok ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3 w-3" /> {test.ip}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red font-medium" title={test.error}>
                          <XCircle className="h-3 w-3" /> {test.error}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => testProxy(p.id)}
                    disabled={test?.testing}
                    className="text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
                    title="Test proxy connectivity"
                  >
                    <Wifi className={`h-3.5 w-3.5 ${test?.testing ? "animate-pulse" : ""}`} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteProxy(p.id)} className="text-red hover:bg-red/10 hover:text-red">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {assignedAccounts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {assignedAccounts.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-chip border border-bg-tertiary bg-bg-tertiary/50 px-2 py-0.5 text-[11px]">
                      @{a.username}
                      <button onClick={() => unassign(a.id)} className="ml-0.5 text-text-muted hover:text-red">×</button>
                    </span>
                  ))}
                </div>
              )}
              {unassignedAccounts.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-text-muted hover:text-text-normal">+ Assign account</summary>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {unassignedAccounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => assign(p.id, a.id)}
                        className="rounded-chip border border-input bg-background px-2 py-0.5 hover:bg-muted"
                      >
                        @{a.username}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>

      {rebalanceOpen && (
        <RebalanceDialog
          defaultTarget={2}
          totalAccounts={accounts.length}
          unassignedCount={unassignedAccounts.length}
          totalProxies={proxies.length}
          onClose={() => setRebalanceOpen(false)}
          onConfirm={doRebalance}
        />
      )}
    </div>
  )
}

// ───── RebalanceDialog ─────────────────────────────────────────────────────────

function RebalanceDialog({
  defaultTarget,
  totalAccounts,
  unassignedCount,
  totalProxies,
  onClose,
  onConfirm,
}: {
  defaultTarget: number
  totalAccounts: number
  unassignedCount: number
  totalProxies: number
  onClose: () => void
  onConfirm: (n: number) => void
}) {
  const [raw, setRaw] = useState(String(defaultTarget))
  const target = Math.max(1, parseInt(raw, 10) || 1)
  const alreadyAssigned = totalAccounts - unassignedCount
  const totalSlots = totalProxies * target
  const remainder = unassignedCount - totalSlots
  const miss = Math.max(0, -remainder)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card border border-bg-tertiary bg-bg-floating p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(target)
          if (e.key === "Escape") onClose()
        }}
      >
        <h2 className="text-base font-semibold text-text-normal mb-1">Rebalance proxies</h2>
        <p className="text-[11px] text-text-muted mb-4">
          Already-assigned accounts <strong className="text-text-normal">stay on their current proxy</strong>. Only the {unassignedCount} unassigned account{unassignedCount === 1 ? "" : "s"} will be distributed.
        </p>

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">
          Accounts per proxy
        </label>
        <input
          autoFocus
          type="number"
          min={1}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-2 text-sm text-text-normal focus:border-brand focus:outline-none"
        />

        {/* Live preview */}
        <div className="mt-4 rounded-card border border-bg-tertiary bg-bg-secondary px-4 py-3 space-y-1 text-[12px]">
          <div className="flex justify-between text-text-muted">
            <span>Already assigned (untouched)</span>
            <span className="font-mono text-text-normal">{alreadyAssigned}</span>
          </div>
          <div className="flex justify-between text-text-muted">
            <span>Unassigned to distribute</span>
            <span className="font-mono text-text-normal">{unassignedCount}</span>
          </div>
          <div className="flex justify-between text-text-muted">
            <span>Available slots ({totalProxies} × {target})</span>
            <span className="font-mono text-text-normal">{totalSlots}</span>
          </div>
          <div className="border-t border-bg-tertiary pt-1 mt-1">
            {unassignedCount === 0 ? (
              <div className="flex items-center gap-1.5 text-text-muted font-medium">
                No unassigned accounts to distribute
              </div>
            ) : remainder > 0 ? (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {remainder} account{remainder === 1 ? "" : "s"} spread +1 across {remainder} prox{remainder === 1 ? "y" : "ies"}
              </div>
            ) : miss > 0 ? (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {miss} slot{miss === 1 ? "" : "s"} will remain empty
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                All unassigned accounts will be placed, no empty slots
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip px-3 py-2 text-sm text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(target)}
            className="rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Rebalance to {target}/proxy
          </button>
        </div>
      </div>
    </div>
  )
}
