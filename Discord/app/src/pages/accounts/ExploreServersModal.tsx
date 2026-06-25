/**
 * Explore Servers modal — browses Discord's Server Discovery directory
 * using one of the connected accounts' tokens through the residential proxy.
 * Search by keyword, filter by category, click any card to join with that
 * account. Joined servers immediately become scrape targets in the campaign
 * wizard.
 */

import { useEffect, useMemo, useState } from "react"
import { Compass, Search, Users, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import type { DiscordAccount } from "@/api-types"

interface Props {
  open: boolean
  accounts: DiscordAccount[]
  onOpenChange: (open: boolean) => void
  defaultAccountId?: string | null
}

interface Category {
  id: number
  name: string
  isPrimary: boolean
}

interface Guild {
  id: string
  name: string
  iconUrl: string | null
  description: string | null
  approximateMemberCount: number | null
  approximatePresenceCount: number | null
  vanityUrlCode: string | null
  primaryCategoryId: number | null
}

export default function ExploreServersModal({ open, accounts, onOpenChange, defaultAccountId }: Props) {
  const connected = useMemo(() => accounts.filter((a) => a.status === "connected"), [accounts])
  const [accountId, setAccountId] = useState<string>("")
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<number | "">("")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [joining, setJoining] = useState<string | null>(null) // guild id currently joining
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set())
  const [joinError, setJoinError] = useState<{ guildId: string; msg: string } | null>(null)

  // Pick a default account when opened.
  useEffect(() => {
    if (!open) return
    setAccountId(defaultAccountId || connected[0]?.id || "")
    setError("")
    setJoinError(null)
    setJoinedIds(new Set())
  }, [open, defaultAccountId, connected])

  // Debounce the search input so we don't spam Discord on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  // Load categories when an account is picked.
  useEffect(() => {
    if (!accountId) return
    fetch(`/api/discord/discover/categories?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((j) => setCategories(Array.isArray(j.categories) ? j.categories : []))
      .catch(() => setCategories([]))
  }, [accountId])

  // Run a search whenever account, category, or debounced query changes.
  useEffect(() => {
    if (!accountId || !open) return
    let cancelled = false
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ accountId, limit: "24" })
    if (categoryId) params.set("category", String(categoryId))
    if (debouncedQuery) params.set("q", debouncedQuery)
    fetch(`/api/discord/discover?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setGuilds(Array.isArray(j.guilds) ? j.guilds : [])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || "search failed")
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [accountId, categoryId, debouncedQuery, open])

  const joinGuild = async (guildId: string) => {
    if (!accountId) return
    setJoining(guildId)
    setJoinError(null)
    try {
      const r = await fetch(`/api/accounts/${accountId}/join-discoverable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        setJoinError({ guildId, msg: body?.error || `HTTP ${r.status}` })
        return
      }
      setJoinedIds((prev) => new Set(prev).add(guildId))
    } catch (e: any) {
      setJoinError({ guildId, msg: e?.message || "request failed" })
    } finally {
      setJoining(null)
    }
  }

  if (!open) return null

  // Filter to size range users care about most for outreach (we make it
  // adjustable later if needed; for now show all results from Discord).
  const visible = guilds

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="my-auto w-full max-w-3xl max-h-[90vh] flex flex-col rounded-card border border-bg-tertiary bg-bg-floating shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bg-tertiary px-5 py-3">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-brand" />
            <h2 className="text-base font-semibold text-text-normal">Explore Discord servers</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-chip px-2 py-1 text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="space-y-2.5 border-b border-bg-tertiary px-5 py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers (e.g. poker, crypto, design)"
                className="w-full rounded-card border border-bg-tertiary bg-bg-tertiary py-1.5 pl-9 pr-3 text-sm text-text-normal placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </div>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-card border border-bg-tertiary bg-bg-tertiary px-2 py-1.5 text-sm text-text-normal"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="rounded-card border border-bg-tertiary bg-bg-tertiary px-2 py-1.5 text-sm text-text-normal"
            >
              {connected.length === 0 && <option value="">No connected account</option>}
              {connected.map((a) => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-text-muted/80">
            Live from Discord's official directory · only servers with the Community
            feature enabled · join with whichever account makes sense, then scrape members
            from the Campaign wizard.
          </p>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!accountId && (
            <div className="rounded-card border border-yellow/30 bg-yellow/10 p-3 text-sm text-yellow">
              Connect a Discord account first — its token is used to query Discord's directory.
            </div>
          )}
          {accountId && loading && (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading from Discord…
            </div>
          )}
          {accountId && !loading && error && (
            <div className="flex items-center gap-2 rounded-card border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          {accountId && !loading && !error && visible.length === 0 && (
            <div className="py-12 text-center text-sm text-text-muted">
              No servers matched. Try different keywords or a category.
            </div>
          )}
          {accountId && !loading && visible.length > 0 && (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {visible.map((g) => {
                const joined = joinedIds.has(g.id)
                const isJoining = joining === g.id
                const errorForThis = joinError?.guildId === g.id ? joinError.msg : null
                return (
                  <li
                    key={g.id}
                    className="flex gap-3 rounded-card border border-bg-tertiary bg-bg-secondary p-3 hover:border-brand/40 transition-colors duration-100"
                  >
                    {g.iconUrl ? (
                      <img src={g.iconUrl} alt="" className="h-12 w-12 shrink-0 rounded-full" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-sm text-text-muted">
                        {g.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="truncate text-sm font-semibold text-text-normal">{g.name}</div>
                      {g.description && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">{g.description}</div>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                        <Users className="h-3 w-3" />
                        {g.approximateMemberCount?.toLocaleString() ?? "?"} members
                        {g.approximatePresenceCount != null && (
                          <span className="text-green">
                            · {g.approximatePresenceCount.toLocaleString()} online
                          </span>
                        )}
                      </div>
                      {errorForThis && (
                        <div className="mt-1 text-[11px] text-red">{errorForThis}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={joined || isJoining || !accountId}
                      onClick={() => joinGuild(g.id)}
                      className={
                        joined
                          ? "self-center rounded-chip border border-green/40 bg-green/10 px-3 py-1 text-[11px] font-medium text-green"
                          : "self-center rounded-chip bg-brand px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                      }
                    >
                      {joined ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Joined
                        </span>
                      ) : isJoining ? "Joining…" : "Join"}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-bg-tertiary px-5 py-2.5 text-[11px] text-text-muted">
          Tip: filter by member count visually — for outreach, 500–2000 member servers usually scrape cleanest.
        </div>
      </div>
    </div>
  )
}
