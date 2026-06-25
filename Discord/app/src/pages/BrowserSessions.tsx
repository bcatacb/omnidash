import { useCallback, useEffect, useState } from "react"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Check, ChevronDown, Plus, Search, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfirm } from "@/components/ui/confirm"
import type { AccountGroupWithMembers, DiscordAccount } from "@/api-types"
import GroupCard from "./sessions/GroupCard"

const EXTENSION_ID_KEY = "gg-extension-id"

export default function BrowserSessions() {
  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([])
  const [accounts, setAccounts] = useState<DiscordAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  // Extension setup state — id is null until the operator pastes one, OR
  // saved before in localStorage. Setup section auto-expands when no id is set.
  const [extensionId, setExtensionId] = useState<string>(() => localStorage.getItem(EXTENSION_ID_KEY) || "")
  const [setupOpen, setSetupOpen] = useState<boolean>(() => !localStorage.getItem(EXTENSION_ID_KEY))
  const [accountSearch, setAccountSearch] = useState("")
  const [activateStatuses, setActivateStatuses] = useState<Record<string, string>>({})

  const handleActivateAccount = (accountId: string) => {
    const extId = localStorage.getItem(EXTENSION_ID_KEY) || ""
    const setStatus = (msg: string) => {
      setActivateStatuses((s) => ({ ...s, [accountId]: msg }))
      setTimeout(() => setActivateStatuses((s) => { const n = { ...s }; delete n[accountId]; return n }), 4000)
    }
    if (!extId) { setStatus("× No extension configured"); return }
    const sessionToken = localStorage.getItem("tg_saas_session") || ""
    const msg = { type: "activate", groupId: `account-${accountId}`, accountId, sessionToken }
    try {
      const cr = (window as any).chrome?.runtime
      if (cr?.sendMessage) cr.sendMessage(extId, msg)
      else window.postMessage({ ...msg, type: "gg-activate" }, "*")
      setStatus("✓ Activating…")
    } catch { setStatus("× Failed") }
  }
  const [extensionInput, setExtensionInput] = useState<string>(() => localStorage.getItem(EXTENSION_ID_KEY) || "")
  const saveExtensionId = () => {
    const id = extensionInput.trim()
    if (id) {
      localStorage.setItem(EXTENSION_ID_KEY, id)
      setExtensionId(id)
      setSetupOpen(false)
    } else {
      localStorage.removeItem(EXTENSION_ID_KEY)
      setExtensionId("")
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [gResp, aResp] = await Promise.all([
        fetch("/api/groups"),
        fetch("/api/accounts"),
      ])
      if (!gResp.ok) throw new Error(`GET /api/groups → HTTP ${gResp.status}: ${await gResp.text().then((t) => t.slice(0, 200))}`)
      if (!aResp.ok) throw new Error(`GET /api/accounts → HTTP ${aResp.status}`)
      const gJson = await gResp.json()
      const aJson = await aResp.json()
      setGroups(Array.isArray(gJson) ? gJson : [])
      setAccounts(Array.isArray(aJson) ? aJson : [])
    } catch (err: any) {
      console.error("[browser-sessions] refresh failed:", err)
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useAutoRefresh(refresh, 60_000)

  const createGroup = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const r = await fetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => "")
        throw new Error(`POST /api/groups → HTTP ${r.status}: ${body.slice(0, 300)}`)
      }
      setNewName("")
      await refresh()
    } catch (err: any) {
      console.error("[browser-sessions] createGroup failed:", err)
      setError(err?.message || String(err))
    } finally {
      setCreating(false)
    }
  }

  const deleteGroup = async (id: string) => {
    const ok = await confirm({
      title: "Delete this group?",
      description: "Accounts themselves are not deleted. They just stop being grouped here.",
      confirmLabel: "Delete group",
      variant: "danger",
    })
    if (!ok) return
    try {
      const r = await fetch(`/api/groups/${id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(`DELETE → HTTP ${r.status}`)
      await refresh()
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Browser sessions</h1>
      </div>
      <p className="text-[12px] text-muted-foreground mb-5">
        Group captured accounts here, then click any "Activate" button to load that account in your
        real Chrome via the GG extension. Tokens are fetched on demand and held only in the
        extension's memory.
      </p>

      {/* Extension setup card — collapsed when an extension id is saved. */}
      <div className={`mb-5 rounded-card border ${extensionId ? "border-bg-tertiary bg-bg-tertiary/30" : "border-yellow/40 bg-yellow/10"} p-4`}>
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              {extensionId ? <Check className="h-4 w-4 text-emerald-500" /> : <span className="text-yellow">!</span>}
              {extensionId ? "GG extension configured" : "Set up the GG extension (one-time)"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {extensionId ? `id ${extensionId.slice(0, 8)}…${extensionId.slice(-4)} · click to change` : "Activate buttons need the extension installed in your Chrome."}
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${setupOpen ? "rotate-180" : ""}`} />
        </button>

        {setupOpen && (
          <div className="mt-3 space-y-3 border-t border-bg-tertiary pt-3 text-[12px]">
            <ol className="space-y-3 list-decimal pl-5">
              <li>
                <strong>Download the GG extension zip:</strong>
                <div className="mt-1.5">
                  <a
                    href="/gg-extension.zip"
                    download="gg-extension.zip"
                    className="inline-flex items-center gap-1.5 rounded-chip bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover"
                  >
                    ⬇ Download gg-extension.zip
                  </a>
                </div>
              </li>
              <li>
                <strong>Unzip the file.</strong> Double-click <code className="rounded bg-muted px-1">gg-extension.zip</code> in your Downloads folder, or right-click → "Extract All". You'll get a <code className="rounded bg-muted px-1">gg-extension</code> folder.
              </li>
              <li>
                <strong>Open Chrome's extensions page.</strong> Paste this into the address bar: <code className="rounded bg-muted px-1">chrome://extensions</code> · then turn ON the <strong>Developer mode</strong> toggle (top-right corner).
              </li>
              <li>
                <strong>Click "Load unpacked"</strong> (top-left button that appeared) and select the <code className="rounded bg-muted px-1">gg-extension</code> folder you just unzipped.
              </li>
              <li>
                Chrome will show the extension as a card. <strong>Copy the long ID string</strong> on that card (it looks like <code className="rounded bg-muted px-1">abcdefghijklmnopqrstuvwx</code> — 32 random characters).
              </li>
              <li>
                <strong>Paste the ID here and click Save:</strong>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={extensionInput}
                    onChange={(e) => setExtensionInput(e.target.value)}
                    placeholder="paste the 32-character ID here"
                    className="max-w-md font-mono text-[12px]"
                  />
                  <Button size="sm" onClick={saveExtensionId}>Save</Button>
                  {extensionId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setExtensionInput(""); saveExtensionId() }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </li>
            </ol>
            <p className="text-[11px] text-muted-foreground">
              The extension fetches tokens from this site using your existing login cookie. Tokens stay in the extension's memory only — nothing is saved to your computer's disk.
            </p>
          </div>
        )}
      </div>

      {/* Account search — find and activate any account without hunting through groups */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted pointer-events-none" />
          <Input
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            placeholder="Search accounts by name or username…"
            className="pl-8"
          />
        </div>
        {accountSearch.trim() && (() => {
          const q = accountSearch.toLowerCase()
          const matched = accounts.filter(
            (a) => a.username.toLowerCase().includes(q) || (a.label || "").toLowerCase().includes(q)
          )
          return (
            <div className="mt-2 rounded-card border border-bg-tertiary bg-bg-secondary p-3 max-w-2xl">
              <p className="text-[11px] text-text-muted mb-2">
                {matched.length} account{matched.length !== 1 ? "s" : ""} matching "{accountSearch}"
              </p>
              {matched.length === 0 ? (
                <p className="text-[12px] text-text-muted py-1">No accounts match.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {matched.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-tertiary">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${
                          acc.status === "connected" ? "bg-green" :
                          acc.status === "token_revoked" ? "bg-amber-500" : "bg-red"
                        }`} />
                        <span className="text-[12px] font-medium text-text-normal truncate">{acc.label || acc.username}</span>
                        <span className="text-[11px] text-text-muted shrink-0">@{acc.username}</span>
                      </div>
                      {acc.status !== "token_revoked" && (
                        <button
                          type="button"
                          onClick={() => handleActivateAccount(acc.id)}
                          className={`flex shrink-0 items-center gap-1 rounded-chip px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            activateStatuses[acc.id]
                              ? activateStatuses[acc.id].startsWith("×") ? "bg-red/10 text-red" : "bg-green/10 text-green"
                              : "bg-brand/10 text-brand hover:bg-brand/20"
                          }`}
                        >
                          <Zap className="h-3 w-3" />
                          {activateStatuses[acc.id] || "Activate"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Group name (e.g. Poker outreach)"
          className="max-w-sm"
        />
        <Button onClick={createGroup} disabled={creating || !newName.trim()}>
          <Plus className="h-4 w-4" /> New group
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
          <strong>Error:</strong> {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && groups.length === 0 && (
        <div className="rounded-md border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
          No groups yet. Create one above to start grouping accounts.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            accounts={accounts}
            allGroups={groups}
            onChange={refresh}
            onDelete={() => deleteGroup(g.id)}
          />
        ))}
      </div>
    </div>
  )
}
