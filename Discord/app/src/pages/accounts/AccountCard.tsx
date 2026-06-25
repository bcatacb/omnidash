import { useEffect, useState } from "react"
import { ClipboardList, MoreHorizontal, LogOut, Trash2, Users, ServerCog, UserCog, KeyRound, Eye, EyeOff, Zap, Globe, ChevronDown, CheckCircle2 } from "lucide-react"
import type { DiscordAccount, AccountStatus } from "@/api-types"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import AccountLogModal from "./AccountLogModal"
import { useConfirm } from "@/components/ui/confirm"

/**
 * Discord-styled account card.
 *
 * Avatar (initials fallback) + label + username + status pill,
 * stats row, footer actions (Rename / Disconnect / overflow menu).
 */

type StatusPresentation = {
  label: string
  dotClass: string
  textClass: string
  pillClass: string
}

const STATUS_PRESENTATION: Record<AccountStatus, StatusPresentation> = {
  connected: {
    label: "Connected",
    dotClass: "bg-green",
    textClass: "text-green",
    pillClass: "bg-green/10 text-green",
  },
  connecting: {
    label: "Connecting",
    dotClass: "bg-yellow",
    textClass: "text-yellow",
    pillClass: "bg-yellow/10 text-yellow",
  },
  captcha: {
    label: "Captcha required",
    dotClass: "bg-yellow",
    textClass: "text-yellow",
    pillClass: "bg-yellow/10 text-yellow",
  },
  disconnected: {
    label: "Disconnected",
    dotClass: "bg-red",
    textClass: "text-red",
    pillClass: "bg-red/10 text-red",
  },
  banned: {
    label: "Banned",
    dotClass: "bg-red",
    textClass: "text-red",
    pillClass: "bg-red/10 text-red",
  },
  // v0.36: Discord forced re-auth (gateway 4004). Operator must log into
  // Discord in their browser, complete the verification challenge, then paste
  // the fresh token via the Add account → Token tab.
  token_revoked: {
    label: "Token revoked — needs re-onboard",
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-300",
    pillClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
  },
}


function initialsFor(account: DiscordAccount): string {
  const source = account.label || account.username || "?"
  const trimmed = source.trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

interface AccountCardProps {
  account: DiscordAccount
  onRename: (account: DiscordAccount) => void
  onDisconnect: (account: DiscordAccount) => void
  onDelete: (account: DiscordAccount) => void
  onShowRelationships?: (account: DiscordAccount) => void
  onJoinInvite?: (account: DiscordAccount) => void
  onReonboard?: (account: DiscordAccount) => void
  onEditProfile?: (account: DiscordAccount) => void
  onSetCredentials?: (account: DiscordAccount) => void
}

export default function AccountCard({
  account,
  onRename: _onRename,
  onDisconnect,
  onDelete,
  onShowRelationships,
  onJoinInvite,
  onReonboard,
  onEditProfile,
  onSetCredentials,
}: AccountCardProps) {
  void _onRename; // kept on the prop list for backward compat; UI no longer triggers it
  const presentation = STATUS_PRESENTATION[account.status]
  const initials = initialsFor(account)

  // The DiscordAccount payload's friendsCount / pendingOutgoing come from the
  // backend's REST poller, which can lag (or sit at 0 when the poller's
  // /users/@me/relationships call has been 401/429ed). Pull live counts from
  // /api/accounts/:id/relationships once on mount so the stats block reflects
  // reality. Falls back to the stale prop value while loading or on error.
  const [live, setLive] = useState<{ friends: number; pendingOutgoing: number } | null>(null)
  const [email, setEmail] = useState<string | null>(account.cachedEmail ?? null)
  const [quarantining, setQuarantining] = useState(false)
  const [creds, setCreds] = useState<{ email: string | null; password: string; totpSecret: string | null } | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [loadingCreds, setLoadingCreds] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const [guildsOpen, setGuildsOpen] = useState(false)
  const [guilds, setGuilds] = useState<{ id: string; name: string }[] | null>(null)
  const [guildsLoading, setGuildsLoading] = useState(false)
  const [guildsError, setGuildsError] = useState<string | null>(null)
  const [credsError, setCredsError] = useState<string | null>(null)
  const confirm = useConfirm()

  const handleActivate = () => {
    const extensionId = localStorage.getItem("gg-extension-id") || ""
    if (!extensionId) {
      setActivateMsg("× No extension configured")
      setTimeout(() => setActivateMsg(null), 4000)
      return
    }
    const sessionToken = localStorage.getItem("tg_saas_session") || ""
    const msg = { type: "activate", groupId: `account-${account.id}`, accountId: account.id, sessionToken }
    try {
      const cr = (window as any).chrome?.runtime
      if (cr?.sendMessage) cr.sendMessage(extensionId, msg)
      else window.postMessage({ ...msg, type: "gg-activate" }, "*")
      setActivateMsg("✓ Activating…")
    } catch (err: any) {
      setActivateMsg(`× ${err?.message || "Failed"}`)
    }
    setTimeout(() => setActivateMsg(null), 4000)
  }

  const fetchGuilds = async () => {
    if (guildsLoading) return
    setGuildsLoading(true)
    setGuildsError(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12_000)
    try {
      const r = await fetch(`/api/accounts/${account.id}/guilds`, { signal: ctrl.signal })
      if (r.ok) {
        const j = await r.json()
        setGuilds(Array.isArray(j.guilds) ? j.guilds : [])
      } else {
        const j = await r.json().catch(() => null)
        setGuildsError(j?.error || `HTTP ${r.status}`)
        setGuilds(null)
      }
    } catch (e: any) {
      setGuildsError(e?.name === 'AbortError' ? 'Request timed out' : (e?.message || 'fetch failed'))
      setGuilds(null)
    } finally {
      clearTimeout(timer)
      setGuildsLoading(false)
    }
  }

  const handleToggleGuilds = () => {
    if (!guildsOpen) {
      setGuildsOpen(true)
      if (guilds === null || guildsError) fetchGuilds()
    } else if (guildsError) {
      // retry without closing
      fetchGuilds()
    } else {
      setGuildsOpen(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/accounts/${account.id}/relationships`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return
        setLive({
          friends: Array.isArray(j.friends) ? j.friends.length : 0,
          pendingOutgoing: Array.isArray(j.outgoing) ? j.outgoing.length : 0,
        })
      })
      .catch(() => { /* keep fallback */ })
    return () => { cancelled = true }
  }, [account.id])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/accounts/${account.id}/email`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.email) setEmail(j.email) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [account.id])

  const friendsShown = live?.friends ?? account.friendsCount

  const isRevoked = account.status === "token_revoked"
  return (
    <>
    <div className={`flex flex-col rounded-card border p-5 shadow-sm transition-colors duration-100 ${
      isRevoked
        ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
        : "border-bg-tertiary bg-bg-secondary hover:bg-bg-message-hover"
    }`}>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt={account.label}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
              {initials}
            </div>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg-secondary ${presentation.dotClass}`}
            aria-hidden
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-base font-semibold text-text-normal">
              {account.label || "Unnamed"}
            </h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="rounded p-1 text-text-muted transition-colors duration-100 hover:bg-bg-tertiary hover:text-text-normal"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-bg-tertiary bg-bg-floating text-text-normal"
              >
                <DropdownMenuItem
                  className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                  onSelect={() => setShowLog(true)}
                >
                  <ClipboardList className="mr-2 h-4 w-4" /> View activity log
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-bg-tertiary" />
                {onEditProfile && (
                  <DropdownMenuItem
                    className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                    onSelect={() => onEditProfile(account)}
                  >
                    <UserCog className="mr-2 h-4 w-4" /> Edit Discord profile
                  </DropdownMenuItem>
                )}
                {onSetCredentials && (
                  <DropdownMenuItem
                    className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                    onSelect={() => onSetCredentials(account)}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    {account.hasCredentials ? "Update credentials" : "Save credentials"}
                  </DropdownMenuItem>
                )}
                {onShowRelationships && (
                  <DropdownMenuItem
                    className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                    onSelect={() => onShowRelationships(account)}
                  >
                    <Users className="mr-2 h-4 w-4" /> View friends &amp; FRs
                  </DropdownMenuItem>
                )}
                {onJoinInvite && (
                  <DropdownMenuItem
                    className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                    onSelect={() => onJoinInvite(account)}
                  >
                    <ServerCog className="mr-2 h-4 w-4" /> Join server (invite)
                  </DropdownMenuItem>
                )}
                {account.status === "token_revoked" && (
                  <DropdownMenuItem
                    className="text-amber-700 dark:text-amber-400 focus:bg-bg-message-hover"
                    onSelect={async () => {
                      const ok = await confirm({
                        title: "Quarantine account?",
                        description: "This account will be marked quarantined globally and removed from all active warmup campaigns immediately.",
                        confirmLabel: "Quarantine",
                        variant: "danger",
                      })
                      if (!ok) return
                      setQuarantining(true)
                      await fetch(`/api/accounts/${account.id}/quarantine`, { method: "POST" }).catch(() => {})
                      setQuarantining(false)
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {quarantining ? "Quarantining…" : "Quarantine account"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-text-normal focus:bg-bg-message-hover focus:text-text-normal"
                  onSelect={() => onDisconnect(account)}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Disconnect
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-bg-tertiary" />
                <DropdownMenuItem
                  className="text-red focus:bg-red/10 focus:text-red"
                  onSelect={() => onDelete(account)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="truncate text-sm text-text-muted flex items-center gap-1">
            @{account.username}
            {account.hasCredentials && (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" title="Credentials saved" />
            )}
          </p>
          {email && <p className="truncate text-[11px] text-text-muted/70">{email}</p>}
          {account.hasProxy === false && (
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">⚠ No proxy assigned</p>
          )}
          {account.isScraperDecoy && (
            <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400" title="This account is reserved as a member scraper decoy and is excluded from all campaigns">🔒 Scraper decoy — excluded from campaigns</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-[11px] font-medium ${presentation.pillClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${presentation.dotClass}`} />
              {presentation.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-card bg-bg-tertiary px-4 py-3">
        <div className="text-lg font-semibold text-text-normal">{friendsShown}</div>
        <div className="text-[11px] uppercase tracking-wide text-text-muted">Friends</div>
      </div>

      {/* Server list */}
      <div className="mt-2">
        <button
          type="button"
          onClick={handleToggleGuilds}
          className="flex w-full items-center gap-1.5 rounded-chip px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-normal"
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="flex-1 text-left">
            {guildsLoading ? "Loading servers…" : guildsError ? "Retry loading servers" : guilds !== null ? `Servers (${guilds.length})` : "View servers"}
          </span>
          <ChevronDown className={`h-3 w-3 transition-transform ${guildsOpen ? "rotate-180" : ""}`} />
        </button>
        {guildsOpen && (
          <div className="mt-1 max-h-36 overflow-y-auto rounded-card border border-bg-tertiary bg-bg-floating px-2 py-1.5">
            {guildsLoading ? (
              <p className="text-[11px] text-text-muted py-1">Loading…</p>
            ) : guildsError ? (
              <p className="text-[11px] text-red py-1">Error: {guildsError} — click button to retry</p>
            ) : guilds && guilds.length > 0 ? (
              guilds.map((g) => (
                <div key={g.id} className="truncate py-0.5 text-[11px] text-text-normal">{g.name}</div>
              ))
            ) : (
              <p className="text-[11px] text-text-muted py-1">Not in any servers yet</p>
            )}
          </div>
        )}
      </div>

      {/* Credential reveal — available for any account with saved credentials */}
      {account.hasCredentials && !creds && (
        <>
          <button
            type="button"
            disabled={loadingCreds}
            onClick={async () => {
              setLoadingCreds(true)
              setCredsError(null)
              const ctrl = new AbortController()
              const timer = setTimeout(() => ctrl.abort(), 10_000)
              try {
                const r = await fetch(`/api/accounts/${account.id}/credentials/reveal`, { signal: ctrl.signal })
                if (r.ok) {
                  setCreds(await r.json())
                } else {
                  const j = await r.json().catch(() => null)
                  setCredsError(j?.error || `HTTP ${r.status}`)
                }
              } catch (e: any) {
                setCredsError(e?.name === 'AbortError' ? 'Request timed out — try again' : (e?.message || 'fetch failed'))
              } finally {
                clearTimeout(timer)
                setLoadingCreds(false)
              }
            }}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-chip bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-bg-message-hover hover:text-text-normal disabled:opacity-60"
          >
            {loadingCreds ? "Loading…" : "🔑 Show credentials"}
          </button>
          {credsError && (
            <p className="mt-1 text-[11px] text-red text-center">{credsError}</p>
          )}
        </>
      )}
      {creds && (
        <div className="mt-2 rounded-card border border-bg-tertiary bg-bg-floating px-3 py-2 space-y-1 text-[11px]">
          <p className="text-text-muted font-semibold uppercase tracking-wide text-[10px]">Stored credentials — use to get a fresh token</p>
          {creds.email && <p className="font-mono text-text-normal break-all">{creds.email}</p>}
          <div className="flex items-center gap-2">
            <p className="font-mono text-text-normal break-all flex-1">
              {showPw ? creds.password : "•".repeat(Math.min(creds.password.length, 16))}
            </p>
            <button type="button" onClick={() => setShowPw((v) => !v)} className="shrink-0 text-text-muted hover:text-text-normal">
              {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>
          {creds.totpSecret && <p className="text-text-muted">2FA: <span className="font-mono">{creds.totpSecret}</span></p>}
        </div>
      )}

      {isRevoked && onReonboard && (
        <button
          type="button"
          onClick={() => onReonboard(account)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-chip bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors duration-100 hover:bg-amber-500/30 dark:text-amber-300"
        >
          🔁 Re-onboard with fresh token
        </button>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleActivate}
          className={`flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-xs font-medium transition-colors duration-100 ${
            activateMsg
              ? activateMsg.startsWith("×") ? "bg-red/10 text-red" : "bg-green/10 text-green"
              : "text-text-muted hover:bg-brand/10 hover:text-brand"
          }`}
        >
          <Zap className="h-3 w-3" />
          {activateMsg || "Activate"}
        </button>
        <button
          type="button"
          onClick={() => onDisconnect(account)}
          className="ml-auto rounded-chip px-3 py-1.5 text-xs font-medium text-text-muted transition-colors duration-100 hover:bg-red/10 hover:text-red"
        >
          Disconnect
        </button>
      </div>
    </div>

    {showLog && (
      <AccountLogModal
        accountId={account.id}
        accountName={account.username || account.label || account.id.slice(0, 8)}
        onClose={() => setShowLog(false)}
      />
    )}
    </>
  )
}
