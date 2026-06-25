import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, Users, RefreshCw, Loader2, Compass, KeyRound } from "lucide-react"
import ExploreServersModal from "./accounts/ExploreServersModal"
import type {
  AccountStatus,
  DiscordAccount,
  RealtimeEvent,
} from "@/api-types"
// (no demo persona — v0.7+ real backend)
import AccountCard from "./accounts/AccountCard"
import EditProfileModal from "./accounts/EditProfileModal"
import AddAccountModal from "./accounts/AddAccountModal"
import RenameDialog from "./accounts/RenameDialog"
import CredentialsModal from "./accounts/CredentialsModal"
import BulkCredentialsModal from "./accounts/BulkCredentialsModal"
import { subscribeRealtime } from "@/lib/realtime"
import { useAutoRefresh } from "@/lib/use-auto-refresh"

// Module-level cache — survives tab switches so the page renders instantly
// with stale data while the background fetch completes.
let _accountsCache: DiscordAccount[] | null = null

export default function Accounts() {
  const [accounts, setAccounts] = useState<DiscordAccount[]>(_accountsCache ?? [])
  const [loading, setLoading] = useState(_accountsCache === null)
  const [loadError, setLoadError] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [exploreOpen, setExploreOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DiscordAccount | null>(null)
  const [editProfileTarget, setEditProfileTarget] = useState<DiscordAccount | null>(null)
  const [accountPendingDelete, setAccountPendingDelete] = useState<DiscordAccount | null>(null)
  const [joinInviteTarget, setJoinInviteTarget] = useState<DiscordAccount | null>(null)
  const [credentialsTarget, setCredentialsTarget] = useState<DiscordAccount | null>(null)
  const [bulkCredsOpen, setBulkCredsOpen] = useState(false)

  const fetchAccounts = useCallback(async () => {
    setLoadError("")
    try {
      const res = await fetch("/api/accounts")
      if (res.status === 404) {
        setAccounts([])
        return
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const data = (await res.json()) as DiscordAccount[]
      const list = Array.isArray(data) ? data : []
      _accountsCache = list
      setAccounts(list)
    } catch (err) {
      console.error("Failed to fetch accounts", err)
      setLoadError(err instanceof Error ? err.message : "Could not reach /api/accounts.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAccounts() }, [fetchAccounts])
  useAutoRefresh(fetchAccounts, 60_000)

  // SSE — account_status events update in-place without a full refetch.
  const esRef = useRef<EventSource | null>(null)
  void esRef // suppress unused-ref lint
  useEffect(() => subscribeRealtime((event) => {
    try {
      const parsed = JSON.parse(event.data) as RealtimeEvent
      if (parsed.type === "account_status") {
        setAccounts((prev) => {
          const next = prev.map((acc) =>
            acc.id === parsed.accountId
              ? { ...acc, status: parsed.status as AccountStatus, lastStatusAt: parsed.ts }
              : acc,
          )
          _accountsCache = next
          return next
        })
      }
    } catch { /* ignore */ }
  }), [])

  const handleCreated = useCallback((account: DiscordAccount) => {
    setAccounts((prev) => {
      const next = prev.filter((acc) => acc.id !== account.id)
      next.unshift(account)
      return next
    })
  }, [])

  const handleRenamed = useCallback((updated: DiscordAccount) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === updated.id ? { ...acc, ...updated } : acc)),
    )
    setRenameTarget(null)
  }, [])

  const handleDisconnect = useCallback(async (account: DiscordAccount) => {
    // Optimistic flip while the backend simulates.
    setAccounts((prev) =>
      prev.map((acc) =>
        acc.id === account.id ? { ...acc, status: "disconnected" } : acc,
      ),
    )
    try {
      const res = await fetch(
        `/api/accounts/${account.id}/disconnect`,
        { method: "POST" },
      )
      if (res.ok) {
        const updated = (await res.json()) as DiscordAccount
        setAccounts((prev) =>
          prev.map((acc) => (acc.id === updated.id ? updated : acc)),
        )
      }
    } catch (err) {
      console.warn(`Disconnect failed for ${account.id}`, err)
    }
  }, [])

  // Multi-step typed confirmation lives in <RemoveAccountDialog/> below.
  // AccountCard's onDelete just opens the dialog; the dialog calls performDelete on confirm.
  const handleDelete = useCallback(async (account: DiscordAccount) => {
    setAccountPendingDelete(account)
  }, [])
  const performDelete = useCallback(async (account: DiscordAccount) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== account.id))
    setAccountPendingDelete(null)
    try {
      const r = await fetch(`/api/accounts/${account.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: account.id }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        console.warn(`Delete returned ${r.status}`, body)
        // Restore card in UI so the user sees that it didn't actually delete.
        setAccounts((prev) => (prev.some((a) => a.id === account.id) ? prev : [...prev, account]))
      }
    } catch (err) {
      console.warn(`Delete failed for ${account.id}`, err)
    }
  }, [])

  const stats = useMemo(() => {
    let connected = 0
    let pending = 0
    let friends = 0
    let needsReonboard = 0
    for (const acc of accounts) {
      if (acc.status === "connected") connected += 1
      if (acc.status === "token_revoked") needsReonboard += 1
      pending += acc.pendingOutgoing
      friends += acc.friendsCount
    }
    return { connected, pending, friends, needsReonboard }
  }, [accounts])

  return (
    <div className="relative min-h-full bg-bg-primary px-6 py-6 text-text-normal">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-normal">
              Accounts
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              Connected Discord accounts. Add via the Token tab to capture
              real DMs in your Unibox.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchAccounts}
              aria-label="Refresh accounts"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-chip border border-bg-tertiary bg-bg-secondary px-3 text-sm text-text-muted transition-colors duration-100 hover:bg-bg-message-hover hover:text-text-normal"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setExploreOpen(true)}
              disabled={accounts.filter((a) => a.status === "connected").length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-chip border border-bg-tertiary bg-bg-secondary px-3 text-sm text-text-normal transition-colors duration-100 hover:bg-bg-message-hover disabled:opacity-50"
              title={accounts.filter((a) => a.status === "connected").length === 0 ? "Connect an account first" : "Browse Discord's Server Discovery"}
            >
              <Compass className="h-4 w-4" /> Explore
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-chip border border-bg-tertiary bg-bg-secondary px-3 text-sm text-text-normal transition-colors duration-100 hover:bg-bg-message-hover"
              title="Paste many tokens at once for bulk onboarding"
            >
              <Plus className="h-4 w-4" /> Bulk import
            </button>
            <button
              type="button"
              onClick={() => setBulkCredsOpen(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-chip border border-bg-tertiary bg-bg-secondary px-3 text-sm text-text-normal transition-colors duration-100 hover:bg-bg-message-hover"
              title="Save email/password for multiple accounts at once"
            >
              <KeyRound className="h-4 w-4" /> Bulk credentials
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-chip bg-brand px-4 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-hover"
            >
              <Plus className="h-4 w-4" /> Add account
            </button>
          </div>
        </div>

        {/* Stat strip */}
        {accounts.length > 0 && (
          <div className={`grid grid-cols-1 gap-3 ${stats.needsReonboard > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <StatCard label="Connected" value={stats.connected} tone="green" />
            <StatCard label="Friends" value={stats.friends} tone="brand" />
            <StatCard label="Pending FRs" value={stats.pending} tone="yellow" />
            {stats.needsReonboard > 0 && (
              <StatCard label="Needs re-onboard" value={stats.needsReonboard} tone="red" />
            )}
          </div>
        )}

        {/* Alert banner — surfaces the list of revoked accounts up-front so the
            operator doesn't have to scan the grid. Clicking jumps to the Add
            Account modal (Token tab) so they can paste fresh tokens in bulk. */}
        {stats.needsReonboard > 0 && (
          <div className="rounded-card border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  {stats.needsReonboard} account{stats.needsReonboard === 1 ? "" : "s"} need{stats.needsReonboard === 1 ? "s" : ""} a fresh token
                </div>
                <div className="mt-0.5 text-[12px] text-amber-700/80 dark:text-amber-300/80">
                  {accounts.filter((a) => a.status === "token_revoked").map((a) => `@${a.username}`).join(", ")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-chip bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-500/30 dark:text-amber-300"
              >
                Paste new tokens
              </button>
            </div>
          </div>
        )}

        {/* Error notice when we couldn't reach the backend. */}
        {loadError && !loading && (
          <div className="rounded-card border border-red/30 bg-red/10 px-4 py-3 text-sm text-red">
            <div className="font-semibold">Couldn't load accounts.</div>
            <div className="mt-0.5 text-xs text-red/90">{loadError}</div>
          </div>
        )}

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center rounded-card border border-bg-tertiary bg-bg-secondary py-16 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading accounts…
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* v0.47 — sort alphabetically by display name (falls back to handle).
                Makes duplicate names cluster together so the operator can spot
                them at a glance. */}
            {[...accounts]
              .sort((a, b) => (a.label || a.username || '').localeCompare(b.label || b.username || '', undefined, { sensitivity: 'base' }))
              .map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onRename={(acc) => setRenameTarget(acc)}
                onDisconnect={handleDisconnect}
                onDelete={handleDelete}
                onJoinInvite={(acc) => setJoinInviteTarget(acc)}
                onReonboard={() => setAddOpen(true)}
                onEditProfile={(acc) => setEditProfileTarget(acc)}
                onSetCredentials={(acc) => setCredentialsTarget(acc)}
              />
            ))}
          </div>
        )}
      </div>

      <AddAccountModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={handleCreated}
      />
      <RenameDialog
        open={renameTarget !== null}
        account={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        onRenamed={handleRenamed}
      />
      {editProfileTarget && (
        <EditProfileModal
          account={editProfileTarget}
          existingNames={accounts
            .filter((a) => a.id !== editProfileTarget.id)
            .map((a) => (a.label || a.username || '').trim())
            .filter((n) => n.length > 0)}
          onClose={() => setEditProfileTarget(null)}
          onSaved={(updated) => {
            setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
            setEditProfileTarget(null)
          }}
        />
      )}
      <RemoveAccountDialog
        account={accountPendingDelete}
        onCancel={() => setAccountPendingDelete(null)}
        onConfirm={performDelete}
      />
      <JoinInviteDialog
        account={joinInviteTarget}
        onClose={() => setJoinInviteTarget(null)}
      />
      <ExploreServersModal
        open={exploreOpen}
        onOpenChange={setExploreOpen}
        accounts={accounts}
      />
      {bulkOpen && (
        <BulkImportDialog
          onClose={() => setBulkOpen(false)}
          onDone={async () => { setBulkOpen(false); await fetchAccounts() }}
        />
      )}
      <BulkCredentialsModal
        open={bulkCredsOpen}
        onOpenChange={setBulkCredsOpen}
        onSaved={fetchAccounts}
      />
      {credentialsTarget && (
        <CredentialsModal
          account={credentialsTarget}
          open={credentialsTarget !== null}
          onOpenChange={(open) => { if (!open) setCredentialsTarget(null) }}
          onSaved={(id) => {
            setAccounts((prev) =>
              prev.map((a) => (a.id === id ? { ...a, hasCredentials: true } : a)),
            )
          }}
        />
      )}
    </div>
  )
}

// ───── JoinInviteDialog ──────────────────────────────────────────────────────
// Paste a discord.gg/<code> URL → server POSTs /invites/<code> → guild joined.
function JoinInviteDialog({
  account,
  onClose,
}: {
  account: DiscordAccount | null
  onClose: () => void
}) {
  const [invite, setInvite] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ guildName?: string; guildId?: string } | null>(null)

  useEffect(() => {
    if (account) {
      setInvite("")
      setError("")
      setSuccess(null)
      setSubmitting(false)
    }
  }, [account?.id])

  if (!account) return null

  const submit = async () => {
    if (!invite.trim() || submitting) return
    setSubmitting(true)
    setError("")
    try {
      const r = await fetch(`/api/accounts/${account.id}/join-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: invite.trim() }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        setError(body?.error || `HTTP ${r.status}`)
        return
      }
      setSuccess({ guildName: body?.guildName, guildId: body?.guildId })
    } catch (e: any) {
      setError(e?.message || "request failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-md max-h-[85vh] overflow-y-auto rounded-card border border-bg-tertiary bg-bg-floating p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-normal">Join a Discord server</h2>
            <p className="text-xs text-text-muted">As @{account.username}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-chip px-2 py-1 text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
          >
            ✕
          </button>
        </div>

        {!success && (
          <>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Invite link or code
            </label>
            <input
              autoFocus
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="discord.gg/abc123  or  https://discord.gg/abc123"
              spellCheck={false}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
                if (e.key === "Escape") onClose()
              }}
              className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
            />
            {error && (
              <p className="mt-3 rounded-chip border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                {error}
              </p>
            )}
            <p className="mt-3 text-[11px] text-text-muted/80">
              Once joined, members of this server become scrape-targets for campaigns.
              Discord may show a captcha — try a different residential IP or wait 30 min
              if you hit it.
            </p>
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
                disabled={submitting || !invite.trim()}
                onClick={submit}
                className="rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {submitting ? "Joining…" : "Join server"}
              </button>
            </div>
          </>
        )}

        {success && (
          <div className="text-center">
            <div className="mx-auto my-3 flex h-16 w-16 items-center justify-center rounded-full bg-green/15">
              <span className="text-2xl">✓</span>
            </div>
            <p className="text-sm font-medium text-text-normal">
              Joined <strong>{success.guildName || "the server"}</strong>
            </p>
            <p className="mt-1 text-xs text-text-muted">Server ID: {success.guildId || "—"}</p>
            <button
              onClick={onClose}
              className="mt-5 rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ───── RemoveAccountDialog ────────────────────────────────────────────────────
// Two-step typed confirmation. Step 1: see the impact summary, click "I understand".
// Step 2: type the username to enable the final delete button.
// v0.59 — single-click confirmation. Type-the-name pattern was overkill for
// daily account hygiene; operator can re-onboard via Token tab if they
// accidentally remove the wrong one.
function RemoveAccountDialog({
  account,
  onCancel,
  onConfirm,
}: {
  account: DiscordAccount | null
  onCancel: () => void
  onConfirm: (a: DiscordAccount) => void
}) {
  if (!account) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-card border border-red/40 bg-bg-floating p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(account)
          if (e.key === "Escape") onCancel()
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-chip bg-red/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red">
            Destructive
          </span>
          <h2 className="text-lg font-semibold text-text-normal">Remove account</h2>
        </div>
        <p className="text-sm text-text-normal">
          Permanently remove <strong>{account.label || `@${account.username}`}</strong> and its DMs, messages, and campaign references. Discord itself is unaffected — re-add via Token tab if you change your mind.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-chip px-3 py-2 text-sm text-text-muted transition-colors duration-100 hover:bg-bg-tertiary hover:text-text-normal"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onConfirm(account)}
            className="rounded-chip bg-red px-4 py-2 text-sm font-semibold text-white transition-colors duration-100 hover:brightness-110"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "green" | "yellow" | "brand" | "red"
}) {
  const toneClass =
    tone === "green"
      ? "text-green"
      : tone === "yellow"
        ? "text-yellow"
        : tone === "red"
          ? "text-red"
          : "text-brand"
  return (
    <div className="rounded-card border border-bg-tertiary bg-bg-secondary px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-bg-tertiary bg-bg-secondary px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Users className="h-8 w-8" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-text-normal">
        No Discord accounts yet
      </h2>
      <p className="mt-2 max-w-sm text-sm text-text-muted">
        Add your first account via the Token tab to start sending campaigns
        and capturing DMs in your Unibox.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 inline-flex items-center gap-2 rounded-chip bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-hover"
      >
        <Plus className="h-4 w-4" /> Add account
      </button>
    </div>
  )
}

// ───── BulkImportDialog ─────────────────────────────────────────────────────
// Paste many Discord user tokens (one per line) and the backend validates
// each via /users/@me + provisions the account. Surfaces per-token success/
// failure so the operator can re-paste just the failures next time.
function BulkImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<Array<{ token: string; ok: boolean; accountId?: string; username?: string; error?: string }> | null>(null)
  const lineCount = input.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).length

  const submit = async () => {
    setSubmitting(true)
    setResults(null)
    try {
      const r = await fetch("/api/accounts/token/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok) {
        setResults([{ token: "—", ok: false, error: j?.error || `HTTP ${r.status}` }])
      } else {
        setResults(Array.isArray(j?.results) ? j.results : [])
      }
    } catch (err: any) {
      setResults([{ token: "—", ok: false, error: err?.message || String(err) }])
    } finally {
      setSubmitting(false)
    }
  }

  const successCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results ? results.length - successCount : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card border border-bg-tertiary bg-bg-floating p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Bulk import accounts</h2>
            <p className="text-[11px] text-text-muted">Paste Discord user tokens, one per line. Up to 100 per batch.</p>
          </div>
          <button onClick={onClose} className="rounded-chip px-2 py-1 text-text-muted hover:bg-bg-tertiary hover:text-text-normal">✕</button>
        </div>

        {!results && (
          <>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"MTI0NTY...xxx.yyyy\nmfa.aaaaaaa\nMTI...xxx.yyyy\n…"}
              rows={10}
              className="w-full resize-y rounded-md border border-bg-tertiary bg-bg-tertiary/50 p-3 font-mono text-[11px] text-text-normal placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              disabled={submitting}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-muted">
                {lineCount} {lineCount === 1 ? "token" : "tokens"} ready
              </span>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-chip px-3 py-1.5 text-[12px] text-text-muted hover:text-text-normal">Cancel</button>
                <button
                  onClick={submit}
                  disabled={submitting || lineCount === 0}
                  className="rounded-chip bg-brand px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  {submitting ? `Verifying ${lineCount}…` : `Import ${lineCount}`}
                </button>
              </div>
            </div>
          </>
        )}

        {results && (
          <>
            <div className="mb-2 flex items-center gap-3 text-[12px]">
              <span className="text-emerald-500">✓ {successCount} ok</span>
              {failCount > 0 && <span className="text-red">× {failCount} failed</span>}
            </div>
            <ul className="max-h-[360px] space-y-1 overflow-y-auto rounded-md border border-bg-tertiary bg-bg-tertiary/30 p-2">
              {results.map((r, i) => (
                <li key={i} className="flex items-start gap-2 rounded px-2 py-1 text-[11px]">
                  <span className={r.ok ? "text-emerald-500" : "text-red"}>{r.ok ? "✓" : "×"}</span>
                  <span className="font-mono text-text-muted">{r.token}</span>
                  <span className="text-text-normal">
                    {r.ok ? `→ @${r.username}` : r.error}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setResults(null); setInput("") }}
                className="rounded-chip px-3 py-1.5 text-[12px] text-text-muted hover:text-text-normal"
              >
                Import more
              </button>
              <button
                onClick={onDone}
                className="rounded-chip bg-brand px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
