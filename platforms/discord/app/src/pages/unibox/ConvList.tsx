import { useEffect, useMemo, useRef, useState } from "react"
import { Archive, CheckCheck, RefreshCw, Search, Send, Star, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/api-types"
import type { ConvSummary } from "./store"
import { avatarColorFromId, formatRelativeTime, getInitials } from "./utils"
import BulkSendModal from "./BulkSendModal"

type Tab = "inbox" | "archived"

// Reply-status filter — sliced from message direction counts:
//   replied      = inbound>0 AND outbound>0 (real back-and-forth)
//   sent_only    = outbound>0 AND inbound=0 (we pitched, they haven't responded)
//   needs_reply  = inbound>0 AND last message is inbound (they replied to us last)
//   all          = everything in the current Tab
// v0.39 — trimmed filters. v0.40: added "Waved" — leads that operator has
// successfully waved (≥1 outbound) and haven't replied yet. This is the lane
// the operator bulk-sends templates from.
type ReplyFilter = "all" | "outreach" | "interested" | "needs_reply" | "warmup"

const REPLY_FILTERS: { id: ReplyFilter; label: string; hint: string }[] = [
  { id: "all",         label: "All",         hint: "Everything (warmup chats hidden)"                                  },
  { id: "outreach",    label: "Outreach",    hint: "Campaign messages sent, awaiting reply"                           },
  { id: "interested",  label: "Interested",  hint: "Conversations you starred"                                        },
  { id: "needs_reply", label: "Needs reply", hint: "They wrote last, we haven't replied"                              },
  { id: "warmup",      label: "Warmup",      hint: "Account-to-account warmup conversations"                          },
]

interface ConvListProps {
  conversations: Conversation[]
  // Lightweight metadata for EVERY conversation (not just the loaded page).
  // Used to compute filter-chip counts that reflect real totals instead of
  // "what we've loaded so far". Empty array is a valid degraded state.
  summary: ConvSummary[]
  // Discord user IDs of OUR OWN accounts — used to identify warmup convos.
  ownDiscordUserIds: Set<string>
  selectedConvId: string | null
  selectedAccountId: string | "all"
  flashConvIds: Set<string>
  loading: boolean
  // Pagination — only valid when the "All" reply-filter is active and no
  // account is selected (i.e. the unfiltered view). Filtering shrinks the
  // visible set anyway, so we don't want infinite-scroll to trigger then.
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  /** v0.41: soft refresh — refetches conversations + accounts without a full
   * page reload. Wired to the refresh button in the filter area. */
  onRefresh?: () => Promise<void> | void
  onMarkAllRead?: () => Promise<void> | void
  onSelectConv: (id: string) => void
  onToggleInterested: (conversationId: string) => void
  onArchiveConversation?: (id: string) => void
  onDeleteConversation?: (id: string) => void
}

function PeerAvatar({ peer }: { peer: Conversation["peer"] }) {
  const bg = avatarColorFromId(peer.discordUserId)
  return (
    <div
      className="h-10 w-10 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-semibold shrink-0"
      style={{ backgroundColor: peer.avatarUrl ? undefined : bg }}
    >
      {peer.avatarUrl ? (
        <img src={peer.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        getInitials(peer.displayName)
      )}
    </div>
  )
}

export default function ConvList({
  conversations,
  summary,
  ownDiscordUserIds,
  selectedConvId,
  selectedAccountId,
  flashConvIds,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onRefresh,
  onMarkAllRead,
  onSelectConv,
  onToggleInterested,
  onArchiveConversation,
  onDeleteConversation,
}: ConvListProps) {
  const [tab, setTab] = useState<Tab>("inbox")
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>("all")
  const [query, setQuery] = useState("")
  const [bulkOpen, setBulkOpen] = useState(false)
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; convId: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  // Sentinel for the IntersectionObserver. The list itself is the scroll
  // root, so we observe against that, not the document viewport.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRootRef = useRef<HTMLDivElement>(null)

  // Sentinel-based infinite scroll: active whenever there are more pages to
  // fetch, regardless of the active filter. On filtered views the filter-backfill
  // effect already loads pages eagerly, but the sentinel also appears so users
  // can see when more pages are loading rather than staring at a truncated list.
  const paginationActive = !!hasMore && !!onLoadMore && tab === "inbox"

  useEffect(() => {
    if (!paginationActive) return
    const sentinel = sentinelRef.current
    const root = scrollRootRef.current
    if (!sentinel || !root) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore?.()
      },
      { root, rootMargin: "200px" },
    )
    obs.observe(sentinel)
    return () => obs.disconnect()
  }, [paginationActive, onLoadMore])

  // v0.68 — filter-active backfill. When a non-"all" filter chip is selected,
  // the chip count comes from the FULL `summary` array (every conversation in
  // the dataset) but the rendered list comes from the PAGINATED `conversations`
  // array (first 100 by lastMessageAt DESC). If the matching conversations are
  // older than the 100 newest loaded, the chip says "11 Needs reply" but the
  // list is empty. Fix: as long as the chip's count > what we can currently
  // render AND there's more to load, eagerly call onLoadMore. Terminates as
  // soon as hasMore flips false OR we've found enough matches. Doesn't loop
  // because each call increases offset; the no-op pagination guard was the
  // only thing previously gating it.
  const filterBackfillNeeded =
    replyFilter !== "all" &&
    !!hasMore &&
    !!onLoadMore &&
    !loadingMore
  useEffect(() => {
    if (!filterBackfillNeeded) return
    // Tiny debounce so React batches the state update from the previous
    // loadMore before we ask for the next page.
    const t = window.setTimeout(() => { onLoadMore?.() }, 50)
    return () => window.clearTimeout(t)
  }, [filterBackfillNeeded, onLoadMore, conversations.length])

  // Close context menu on click-outside or Escape.
  useEffect(() => {
    if (!ctxMenu) return
    function onDown(e: MouseEvent) {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setCtxMenu(null); setSelectedIds(new Set()) }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [ctxMenu])

  // v0.12.2 — Exact classification using lastMessageDirection (server-tracked).
  //   replied      = both sides have sent (inboundCount>0 AND outboundCount>0)
  //   needs_reply  = MOST RECENT message direction is 'in'   ← real "owe a reply"
  //   sent_only    = we sent, no inbound at all
  // Type-loose helpers — both Conversation and ConvSummary carry the same
  // count + direction fields, so we can reuse them across the two arrays.
  const inb = (c: { inboundCount?: number }) => (c.inboundCount ?? 0) > 0
  const out = (c: { outboundCount?: number }) => (c.outboundCount ?? 0) > 0
  // v0.48 — Discord's official system account (T&S notices, safety limits,
  // gift receipts, etc.). v0.49: exclude from EVERY action filter (needs
  // wave / waved / needs reply / interested) since none of those make sense
  // for a system DM — it'd pollute the operator's action queue.
  const DISCORD_SYSTEM_USER_IDS = new Set(["643945264868098049"])
  const isSystemPeer = (c: { peerDiscordUserId?: string; peer?: { discordUserId?: string } }) => {
    const id = c.peerDiscordUserId ?? c.peer?.discordUserId ?? ""
    return DISCORD_SYSTEM_USER_IDS.has(id)
  }
  // A conversation is a warmup conv if the peer is one of our own accounts.
  const isWarmup = (c: { peerDiscordUserId?: string; peer?: { discordUserId?: string } }) => {
    const id = c.peerDiscordUserId ?? c.peer?.discordUserId ?? ""
    return id.length > 0 && ownDiscordUserIds.has(id)
  }
  const needsReply = (c: { lastMessageDirection?: "in" | "out" | null; peerDiscordUserId?: string; peer?: { discordUserId?: string } }) =>
    c.lastMessageDirection === "in" && !isSystemPeer(c)
  // "outreach" — we sent at least one message, they haven't replied yet.
  // These are campaign DMs the engine fired; operator monitors for replies here.
  const isOutreach = (c: { inboundCount?: number; outboundCount?: number; peerDiscordUserId?: string; peer?: { discordUserId?: string } }) =>
    out(c) && !inb(c) && !isSystemPeer(c)

  // Counts come from the FULL summary (every conversation in the dataset), not
  // just the paginated loaded set, so the chips show real totals.
  const counts = useMemo(() => {
    const src = summary.length > 0 ? summary : conversations
    const base = src
      .filter((c) => (tab === "inbox" ? c.label !== "archived" : c.label === "archived"))
      .filter((c) => (selectedAccountId === "all" ? true : c.accountId === selectedAccountId))
    return {
      all:         base.filter((c: any) => !isWarmup(c)).length,
      // Keep warmup out of outreach/interested/needs_reply counts to match what filtered shows
      outreach:    base.filter((c: any) => isOutreach(c) && !isWarmup(c)).length,
      interested:  base.filter((c: any) => c.interested === true && !isWarmup(c)).length,
      needs_reply: base.filter((c: any) => needsReply(c) && !isWarmup(c)).length,
      warmup:      base.filter((c: any) => isWarmup(c)).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, conversations, tab, selectedAccountId, ownDiscordUserIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations
      .filter((c) => (tab === "inbox" ? c.label !== "archived" : c.label === "archived"))
      .filter((c) => (selectedAccountId === "all" ? true : c.accountId === selectedAccountId))
      .filter((c) => {
        switch (replyFilter) {
          case "warmup":      return isWarmup(c)
          case "outreach":    return isOutreach(c) && !isWarmup(c)
          case "interested":  return c.interested === true && !isWarmup(c)
          case "needs_reply": return needsReply(c) && !isWarmup(c)
          case "all":
          default:            return !isWarmup(c)
        }
      })
      .filter((c) => {
        if (!q) return true
        return (
          c.peer.displayName.toLowerCase().includes(q) ||
          c.lastMessagePreview.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, tab, replyFilter, selectedAccountId, query, ownDiscordUserIds])

  // Full-dataset filtered IDs from summary — used for bulk send so it reaches
  // ALL matching conversations, not just the paginated loaded page.
  const bulkSendIds = useMemo(() => {
    const src = summary.length > 0 ? summary : conversations
    const q = query.trim().toLowerCase()
    return src
      .filter((c) => (tab === "inbox" ? c.label !== "archived" : c.label === "archived"))
      .filter((c) => (selectedAccountId === "all" ? true : c.accountId === selectedAccountId))
      .filter((c: any) => {
        switch (replyFilter) {
          case "warmup":      return isWarmup(c)
          case "outreach":    return isOutreach(c) && !isWarmup(c)
          case "interested":  return c.interested === true && !isWarmup(c)
          case "needs_reply": return needsReply(c) && !isWarmup(c)
          case "all":
          default:            return !isWarmup(c)
        }
      })
      .filter((c: any) => {
        if (!q) return true
        return (
          (c.peer?.displayName ?? "").toLowerCase().includes(q) ||
          (c.lastMessagePreview ?? "").toLowerCase().includes(q)
        )
      })
      .map((c) => c.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, conversations, tab, replyFilter, selectedAccountId, query, ownDiscordUserIds])

  return (
    <aside
      aria-label="Conversation list"
      className="flex flex-col bg-bg-secondary w-full md:w-[260px] border-r border-black/20"
    >
      {/* Search */}
      <div className="p-2.5 border-b border-black/20">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search
            aria-hidden
            className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted"
          />
          <input
            type="search"
            placeholder="Find a conversation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(
              "w-full pl-7 pr-2 py-1.5 rounded-chip text-xs",
              "bg-bg-tertiary text-text-normal placeholder:text-text-muted",
              "border border-transparent focus:border-brand focus:outline-none",
            )}
          />
        </label>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Conversation folders" className="flex gap-1 px-2 pt-2">
        {(["inbox", "archived"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 text-xs font-medium px-2 py-1 rounded-chip capitalize",
              "transition-colors duration-100",
              tab === t
                ? "bg-bg-message-hover text-text-normal"
                : "text-text-muted hover:bg-bg-message-hover/60 hover:text-text-normal",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Bulk-send + refresh actions. v0.41: added a refresh button so the
          operator can re-pull the conversation list without a hard browser
          refresh (e.g., to immediately pick up a wave they just clicked
          from Discord). */}
      <div className="flex items-center justify-end gap-1.5 px-2 pt-1.5">
        {onMarkAllRead && tab === "inbox" && (
          <button
            type="button"
            onClick={() => void onMarkAllRead()}
            className="inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors bg-bg-message-hover text-text-normal hover:bg-bg-tertiary"
            title="Mark all conversations as read"
          >
            <CheckCheck className="h-3 w-3" />
            Mark all read
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors",
              loading
                ? "text-text-muted/50 cursor-not-allowed"
                : "bg-bg-message-hover text-text-normal hover:bg-bg-tertiary",
            )}
            title="Re-fetch conversations from the server"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        )}
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          disabled={bulkSendIds.length === 0}
          className={cn(
            "inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors",
            bulkSendIds.length === 0
              ? "text-text-muted/50 cursor-not-allowed"
              : "bg-brand/15 text-brand hover:bg-brand/25",
          )}
          title="Send a templated message to every conversation matching the current filter"
        >
          <Send className="h-3 w-3" />
          Send template to {bulkSendIds.length}
        </button>
      </div>

      {/* Reply-status filter chips */}
      <div className="flex flex-wrap gap-1 px-2 pt-1.5 pb-1">
        {REPLY_FILTERS.map((f) => {
          const active = replyFilter === f.id
          const n = counts[f.id]
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setReplyFilter(f.id)}
              title={f.hint}
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-chip inline-flex items-center gap-1 transition-colors duration-100",
                active
                  ? "bg-brand/20 text-brand ring-1 ring-brand/30"
                  : n === 0
                    ? "text-text-muted/50 hover:bg-bg-message-hover/40 hover:text-text-muted"
                    : "text-text-muted hover:bg-bg-message-hover/60 hover:text-text-normal",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-chip px-1 text-[9px]",
                  active ? "bg-brand/25 text-brand" : n === 0 ? "bg-bg-tertiary/50 text-text-muted/50" : "bg-bg-tertiary/70",
                )}
              >
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {/* Bulk action bar — appears when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-black/20 bg-brand/10">
          <span className="text-[11px] font-semibold text-brand flex-1">{selectedIds.size} selected</span>
          {onArchiveConversation && (
            <button
              type="button"
              onClick={() => {
                selectedIds.forEach((id) => onArchiveConversation(id))
                setSelectedIds(new Set())
              }}
              className="inline-flex items-center gap-1 rounded-chip bg-bg-message-hover px-2 py-1 text-[10px] font-medium text-text-normal hover:bg-bg-tertiary transition-colors"
            >
              <Archive className="h-3 w-3" /> Archive
            </button>
          )}
          {onDeleteConversation && (
            <button
              type="button"
              onClick={() => {
                selectedIds.forEach((id) => onDeleteConversation(id))
                setSelectedIds(new Set())
              }}
              className="inline-flex items-center gap-1 rounded-chip bg-red/10 px-2 py-1 text-[10px] font-medium text-red hover:bg-red/20 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-full p-0.5 text-text-muted hover:text-text-normal transition-colors"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* List */}
      <div ref={scrollRootRef} className="flex-1 overflow-y-auto py-1.5">
        {loading ? (
          <div className="space-y-0.5 px-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2 rounded-chip animate-pulse">
                <div className="h-9 w-9 rounded-full bg-bg-message-hover shrink-0" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="h-3 bg-bg-message-hover rounded" style={{ width: `${40 + (i % 3) * 15}%` }} />
                  <div className="h-2.5 bg-bg-message-hover rounded" style={{ width: `${55 + (i % 4) * 10}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-text-muted">
              {tab === "archived"
                ? "Nothing archived."
                : replyFilter === "outreach"   ? "No pending outreach. Everyone has replied."
                : replyFilter === "interested" ? "No starred conversations yet."
                : replyFilter === "needs_reply"? "You're all caught up."
                : replyFilter === "warmup"     ? "No warmup conversations active."
                : "No conversations yet. Start a campaign to begin outreach."}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5 px-1.5">
            {filtered.map((c) => (
              <ConvRow
                key={c.id}
                conv={c}
                active={c.id === selectedConvId}
                flash={flashConvIds.has(c.id)}
                warmup={isWarmup(c)}
                selected={selectedIds.has(c.id)}
                selectionMode={selectedIds.size > 0}
                onClick={() => {
                  if (selectedIds.size > 0) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      next.has(c.id) ? next.delete(c.id) : next.add(c.id)
                      return next
                    })
                  } else {
                    onSelectConv(c.id)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id })
                }}
                onToggleInterested={() => onToggleInterested(c.id)}
              />
            ))}
          </ul>
        )}
        {paginationActive && (
          <div ref={sentinelRef} className="px-3 py-3 text-center text-[11px] text-text-muted">
            {loadingMore ? "Loading more…" : "Scroll for more"}
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-black/20 bg-bg-floating shadow-lg py-1 text-[12px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-text-normal hover:bg-bg-message-hover transition-colors"
            onClick={() => {
              setSelectedIds((prev) => {
                const next = new Set(prev)
                next.add(ctxMenu.convId)
                return next
              })
              setCtxMenu(null)
            }}
          >
            <CheckCheck className="h-3.5 w-3.5 text-text-muted" />
            Select
          </button>
          {onArchiveConversation && (
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-text-normal hover:bg-bg-message-hover transition-colors"
              onClick={() => {
                onArchiveConversation(ctxMenu.convId)
                setCtxMenu(null)
              }}
            >
              <Archive className="h-3.5 w-3.5 text-text-muted" />
              Archive
            </button>
          )}
          {onDeleteConversation && (
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-red hover:bg-red/10 transition-colors"
              onClick={() => {
                onDeleteConversation(ctxMenu.convId)
                setCtxMenu(null)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      )}

      {bulkOpen && (
        <BulkSendModal
          conversationIds={bulkSendIds}
          conversationCount={bulkSendIds.length}
          filterLabel={`${tab} · ${REPLY_FILTERS.find((f) => f.id === replyFilter)?.label || replyFilter}${selectedAccountId === "all" ? "" : ` · account ${selectedAccountId.slice(0, 10)}`}${query.trim() ? ` · "${query.trim()}"` : ""}`}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </aside>
  )
}

function ConvRow({
  conv,
  active,
  flash,
  warmup,
  selected,
  selectionMode,
  onClick,
  onContextMenu,
  onToggleInterested,
}: {
  conv: Conversation
  active: boolean
  flash: boolean
  warmup: boolean
  selected: boolean
  selectionMode: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onToggleInterested: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "group w-full flex items-start gap-2 px-2 py-2 rounded-chip text-left",
          "transition-colors duration-100",
          selected
            ? "bg-brand/10 text-text-normal ring-1 ring-inset ring-brand/20"
            : active
              ? "bg-bg-message-hover text-text-normal"
              : "hover:bg-bg-message-hover/60 text-text-normal",
          flash && !selected && "animate-[flashAccept_1.5s_ease-out_1]",
        )}
        style={
          flash && !selected
            ? ({
                animationName: "flashAccept",
                animationDuration: "1.5s",
                animationTimingFunction: "ease-out",
                backgroundColor: "rgba(88,101,242,0.18)",
              } as React.CSSProperties)
            : undefined
        }
      >
        <PeerAvatar peer={conv.peer} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-sm",
                conv.unreadCount > 0 ? "font-semibold text-text-normal" : "font-medium",
              )}
            >
              <span className="truncate">{conv.peer.displayName}</span>
              {warmup && (
                <span
                  className="shrink-0 rounded-chip bg-violet-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300"
                  title="Warmup conversation (peer is one of your own accounts)"
                >
                  W
                </span>
              )}
              {conv.peer.discordUserId === "643945264868098049" && (
                <span
                  className="shrink-0 rounded-chip bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                  title="Discord system message (Trust & Safety, gift, etc.)"
                >
                  sys
                </span>
              )}
            </span>
            <span className="text-[10px] text-text-muted shrink-0">
              {formatRelativeTime(conv.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate text-xs",
                conv.unreadCount > 0 ? "text-text-normal" : "text-text-muted",
              )}
            >
              {conv.lastMessagePreview || "—"}
            </span>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {selectionMode ? (
                <span className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  selected ? "bg-brand border-brand text-white" : "border-text-muted/40 bg-bg-secondary",
                )}>
                  {selected && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-none stroke-current stroke-2"><polyline points="1,4 4,7 9,1" /></svg>}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleInterested() }}
                  className={cn(
                    "rounded-full p-1 transition-colors",
                    conv.interested
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-text-muted/60 hover:text-text-muted opacity-0 group-hover:opacity-100",
                  )}
                  aria-label={conv.interested ? "Remove star" : "Star as interested"}
                  title={conv.interested ? "Remove star" : "Star as interested"}
                >
                  <Star className={cn("h-4 w-4", conv.interested && "fill-current")} />
                </button>
              )}
              {!selectionMode && conv.unreadCount > 0 && (
                conv.unreadCount === 1
                  ? <span aria-label="1 unread" className="inline-flex h-2 w-2 rounded-full bg-brand" />
                  : <span aria-label={`${conv.unreadCount} unread`} className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-brand px-1 text-[9px] font-bold text-white">{conv.unreadCount > 99 ? "99+" : conv.unreadCount}</span>
              )}
            </div>
          </div>
        </div>
      </button>
    </li>
  )
}
