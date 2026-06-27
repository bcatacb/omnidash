// Central Unibox state hook.
//
// We deliberately avoid a third-party state library (zustand/jotai/etc) since
// they're not in the bundle. Instead this hook owns the data the four panes
// share: account list, conversations, the currently-open conversation's
// messages, and the SSE subscription that keeps it all live.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { subscribeRealtime } from "@/lib/realtime"
import type {
  Conversation,
  DiscordAccount,
  Message,
  RealtimeEvent,
} from "@/api-types"

export interface AccountSummary {
  id: string
  label: string
  username: string
  avatarUrl: string | null
  status: DiscordAccount["status"]
  discordUserId?: string | null
}

// Lightweight per-conversation row used ONLY to compute the filter-chip totals
// across the full dataset (not just the paginated/loaded page). Mirrors the
// summary shape the backend ships in the conversations response.
export interface ConvSummary {
  id: string
  accountId: string
  label: string
  inboundCount: number
  outboundCount: number
  lastMessageDirection: "in" | "out" | null
  interested: boolean
  lastMessagePreview: string
  // v0.48: peer discord id so we can exclude Discord's system account
  // (643945264868098049) from the Needs reply filter + chip count.
  peerDiscordUserId: string
}

export interface UniboxState {
  accounts: AccountSummary[]
  conversations: Conversation[]
  // Full-dataset summary for chip counts. Empty until first load resolves.
  conversationsSummary: ConvSummary[]
  // Messages keyed by conversationId.
  messagesByConv: Record<string, Message[]>
  // Conversation ids that should briefly flash in the list (FR accepted).
  flashConvIds: Set<string>
  // In-app toast notifications (FR accepted, etc.).
  toasts: Array<{ id: string; message: string }>
  loadingConversations: boolean
  loadingMoreConversations: boolean
  conversationsHasMore: boolean
  conversationsTotal: number
  loadingMessages: boolean
  selectedConvId: string | null
  error: string | null
}

// Page size for the conversation list. 100 is enough for "newest stuff visible
// instantly" and the IntersectionObserver-driven sentinel loads the next page
// as the operator scrolls. Hardcoded here so backend + frontend agree.
const CONV_PAGE_SIZE = 100

// Discord's official system account (Trust & Safety, gift receipts, etc.).
// These DMs are auto-archived and never belong in the live inbox.
const DISCORD_SYSTEM_USER_ID = "643945264868098049"

// Frontend safety net for the "hide empty conversations" backend fix: drop any
// conversation that has no message preview so stale rows that slipped through
// before the backend deploy don't render as blank.
function hasMessages(c: Conversation): boolean {
  return c.lastMessagePreview != null && c.lastMessagePreview !== ""
}

interface ConversationPage {
  items: Conversation[]
  total: number
  hasMore: boolean
  summary: ConvSummary[] | null
}

// Demo persona fallback so when the backend hasn't seeded an account yet, the
// rail still shows the operator's first identity.
const FALLBACK_OPERATOR: AccountSummary = {
  id: "self",
  label: "Operator",
  username: "operator",
  avatarUrl: null,
  status: "connected",
}

type FetchJsonOpts = RequestInit & { signal?: AbortSignal }

async function fetchJson<T>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

function playPing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch { /* autoplay policy or unsupported */ }
}

export function useUniboxStore(activeConvId: string | null) {
  const [state, setState] = useState<UniboxState>({
    accounts: [],
    conversations: [],
    conversationsSummary: [],
    messagesByConv: {},
    flashConvIds: new Set(),
    toasts: [],
    loadingConversations: true,
    loadingMoreConversations: false,
    conversationsHasMore: false,
    conversationsTotal: 0,
    loadingMessages: false,
    selectedConvId: activeConvId,
    error: null,
  })
  // Re-entrancy guard for loadMoreConversations: if the sentinel re-fires
  // before the previous page resolves, we'd otherwise double-fetch the same
  // offset and double-append.
  const loadingMoreRef = useRef(false)

  // Keep latest selection in a ref so SSE handlers see it without re-binding.
  const selectedConvRef = useRef<string | null>(activeConvId)
  selectedConvRef.current = activeConvId

  // ---- Initial loads ----------------------------------------------------
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const [accounts, convPage] = await Promise.all([
          fetchJson<DiscordAccount[]>("/api/accounts", { signal: ac.signal }).catch(() => [] as DiscordAccount[]),
          fetchJson<ConversationPage>(`/api/unibox/conversations?limit=${CONV_PAGE_SIZE}`, { signal: ac.signal }),
        ])
        const accountSummaries: AccountSummary[] = accounts.map((a) => ({
          id: a.id,
          label: a.label,
          username: a.username,
          avatarUrl: a.avatarUrl,
          status: a.status,
          discordUserId: a.discordUserId ?? null,
        }))
        setState((prev) => ({
          ...prev,
          accounts: accountSummaries.length > 0 ? accountSummaries : [FALLBACK_OPERATOR],
          conversations: convPage.items.filter(hasMessages),
          conversationsSummary: convPage.summary || [],
          conversationsHasMore: convPage.hasMore,
          conversationsTotal: convPage.total,
          loadingConversations: false,
        }))
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setState((prev) => ({
          ...prev,
          loadingConversations: false,
          error: (err as Error).message,
        }))
      }
    })()
    return () => ac.abort()
  }, [])

  // ---- Messages for the active conversation -----------------------------
  useEffect(() => {
    if (!activeConvId) return
    const ac = new AbortController()
    setState((prev) => ({ ...prev, loadingMessages: true, selectedConvId: activeConvId }))
    ;(async () => {
      try {
        const messages = await fetchJson<Message[]>(
          `/api/unibox/conversations/${encodeURIComponent(activeConvId)}/messages`,
          { signal: ac.signal },
        )
        setState((prev) => ({
          ...prev,
          loadingMessages: false,
          messagesByConv: { ...prev.messagesByConv, [activeConvId]: messages },
          // Clear unread on the active row.
          conversations: prev.conversations.map((c) =>
            c.id === activeConvId ? { ...c, unreadCount: 0 } : c,
          ),
        }))
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setState((prev) => ({
          ...prev,
          loadingMessages: false,
          error: (err as Error).message,
        }))
      }
    })()
    return () => ac.abort()
  }, [activeConvId])

  // ---- Short poll for active conversation to make updates feel realtime (fallback if SSE lags)
  useEffect(() => {
    if (!activeConvId) return
    const timer = setInterval(async () => {
      try {
        const latest = await fetchJson<Message[]>(
          `/api/unibox/conversations/${encodeURIComponent(activeConvId)}/messages?limit=10`
        )
        setState((prev) => {
          const current = prev.messagesByConv[activeConvId] || []
          const newOnes = latest.filter(m => !current.some(c => c.id === m.id))
          if (newOnes.length === 0) return prev
          const updated = [...current, ...newOnes].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
          return {
            ...prev,
            messagesByConv: { ...prev.messagesByConv, [activeConvId]: updated },
            conversations: prev.conversations.map((c) =>
              c.id === activeConvId ? { ...c, lastMessagePreview: updated[updated.length-1]?.body?.slice(0,80) || c.lastMessagePreview, lastMessageAt: updated[updated.length-1]?.sentAt || c.lastMessageAt } : c
            ),
          }
        })
      } catch {}
    }, 1500) // poll every 1.5s for the open chat
    return () => clearInterval(timer)
  }, [activeConvId])

  // ---- SSE realtime feed ------------------------------------------------
  // Uses the app-wide singleton connection so switching away from Unibox
  // and back doesn't require a fresh SSE handshake.
  useEffect(() => subscribeRealtime((ev) => {
    if (!ev.data) return
    let evt: RealtimeEvent
    try {
      evt = JSON.parse(ev.data) as RealtimeEvent
    } catch {
      return
    }
    handleRealtime(evt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // ---- Realtime handler -------------------------------------------------
  const handleRealtime = useCallback((evt: RealtimeEvent) => {
    if (evt.type === "message_deleted") {
      const { conversationId, messageId } = evt as any
      setState((prev) => {
        const remaining = (prev.messagesByConv[conversationId] ?? []).filter((m) => m.id !== messageId);
        const last = remaining.length > 0
          ? remaining.reduce((a, b) => new Date(a.sentAt) > new Date(b.sentAt) ? a : b)
          : null;
        return {
          ...prev,
          messagesByConv: {
            ...prev.messagesByConv,
            [conversationId]: remaining,
          },
          conversations: prev.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessagePreview: last ? last.body : '',
                  lastMessageAt: last ? last.sentAt : c.lastMessageAt,
                }
              : c
          ),
          conversationsSummary: prev.conversationsSummary.map((s) =>
            s.id === conversationId
              ? {
                  ...s,
                  lastMessagePreview: last ? last.body : '',
                }
              : s
          ),
        };
      });
      return
    }
    if (evt.type === "message_in" || evt.type === "message_out") {
      const { conversationId, message } = evt
      const isActive = selectedConvRef.current === conversationId
      setState((prev) => {
        const list = prev.messagesByConv[conversationId]
        // De-dupe by id (server may echo our optimistic send).
        const exists = list?.some((m) => m.id === message.id)
        const nextList = exists ? list : [...(list ?? []), message]

        // Re-sort and bump in conv list.
        let conversations = prev.conversations
        const idx = conversations.findIndex((c) => c.id === conversationId)
        if (idx !== -1) {
          const conv = conversations[idx]!
          // Keep inbound/outbound counts + last direction in sync so the
          // Unibox filters (Replied / Needs reply / No reply) move the row
          // to the right chip immediately — not just on next refresh.
          const isOut = evt.type === "message_out"
          const updated: Conversation = {
            ...conv,
            lastMessagePreview: message.body,
            lastMessageAt: message.sentAt,
            lastMessageDirection: isOut ? "out" : "in",
            inboundCount: (conv.inboundCount ?? 0) + (isOut ? 0 : 1),
            outboundCount: (conv.outboundCount ?? 0) + (isOut ? 1 : 0),
            unreadCount:
              evt.type === "message_in" && !isActive
                ? conv.unreadCount + 1
                : isActive
                  ? 0
                  : conv.unreadCount,
          }
          conversations = [updated, ...conversations.filter((c) => c.id !== conversationId)]
        } else if (conversationId) {
          // Activity (new reply or message) on a conversation that isn't in the currently
          // loaded page slice (older convs beyond first page, or brand-new external DM).
          // Fetch the full row so it surfaces at the top of the Unibox list in realtime.
          // This eliminates multi-minute delays for real DM replies to appear.
          fetchJson<Conversation>(`/api/unibox/conversations/${encodeURIComponent(conversationId)}`).then((loadedConv) => {
            setState((p) => {
              if (p.conversations.some((c) => c.id === conversationId)) return p
              const isIn = evt.type === "message_in"
              return {
                ...p,
                conversations: [{
                  ...loadedConv,
                  unreadCount: isIn ? (loadedConv.unreadCount || 0) + 1 : loadedConv.unreadCount || 0,
                }, ...p.conversations],
                conversationsTotal: Math.max(p.conversationsTotal, p.conversations.length + 1),
              }
            })
          }).catch(() => {})
        }

        // Mirror the same count updates into conversationsSummary so filter
        // chip counts (Outreach / Needs reply / Replied) stay accurate
        // in real-time rather than drifting until the next manual refresh.
        const msgIsOut = evt.type === "message_out"
        const conversationsSummary = prev.conversationsSummary.map((s) => {
          if (s.id !== conversationId) return s
          return {
            ...s,
            inboundCount: (s.inboundCount ?? 0) + (msgIsOut ? 0 : 1),
            outboundCount: (s.outboundCount ?? 0) + (msgIsOut ? 1 : 0),
            lastMessageDirection: (msgIsOut ? "out" : "in") as "in" | "out",
            lastMessagePreview: message.body,
          }
        })

        return {
          ...prev,
          messagesByConv: { ...prev.messagesByConv, [conversationId]: nextList ?? [] },
          conversations,
          conversationsSummary,
        }
      })
    } else if (evt.type === "conversation_removed") {
      // The DM was closed in real Discord (or the backend's REST poll noticed
      // it disappeared from /users/@me/channels for 2 consecutive polls).
      // Drop it from the list, the messages cache, and the summary used for
      // filter-chip counts. If the operator was viewing this conversation,
      // their pane will just show the empty state on next render.
      setState((prev) => {
        const { [evt.conversationId]: _drop, ...messagesByConv } = prev.messagesByConv
        return {
          ...prev,
          conversations: prev.conversations.filter((c) => c.id !== evt.conversationId),
          conversationsSummary: prev.conversationsSummary.filter((s) => s.id !== evt.conversationId),
          conversationsTotal: Math.max(0, prev.conversationsTotal - 1),
          messagesByConv,
        }
      })
    } else if (evt.type === "fr_accepted") {
      // Fetch the new conversation and prepend it; flash the row.
      ;(async () => {
        try {
          const conv = await fetchJson<Conversation>(
            `/api/unibox/conversations/${encodeURIComponent(evt.conversationId)}`,
          )
          const peerName = conv.peer?.displayName ?? conv.peer?.username ?? "Someone"
          // Ping sound + browser notification.
          playPing()
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification("Friend request accepted", {
                body: `${peerName} accepted your friend request`,
                icon: "/favicon.ico",
                tag: `fr-accepted-${conv.id}`,
              })
              window.setTimeout(() => n.close(), 6000)
            } catch { /* browser policy */ }
          }
          // In-app toast.
          const toastId = `fr-${conv.id}-${Date.now()}`
          setState((prev) => {
            const without = prev.conversations.filter((c) => c.id !== conv.id)
            const nextFlash = new Set(prev.flashConvIds)
            nextFlash.add(conv.id)
            return {
              ...prev,
              conversations: [conv, ...without],
              flashConvIds: nextFlash,
              toasts: [...prev.toasts, { id: toastId, message: `🎉 ${peerName} accepted your friend request` }],
            }
          })
          // Clear the flash after 1.5s.
          window.setTimeout(() => {
            setState((prev) => {
              if (!prev.flashConvIds.has(evt.conversationId)) return prev
              const nextFlash = new Set(prev.flashConvIds)
              nextFlash.delete(evt.conversationId)
              return { ...prev, flashConvIds: nextFlash }
            })
          }, 1500)
          // Auto-dismiss toast after 5s.
          window.setTimeout(() => {
            setState((prev) => ({ ...prev, toasts: prev.toasts.filter((t) => t.id !== toastId) }))
          }, 5000)
        } catch {
          // best-effort
        }
      })()
    } else if (evt.type === "conversation_created") {
      // v0.38: wave-prepare opened a new empty DM channel. Prepend the
      // conversation so it appears under the "Needs wave" chip immediately
      // (no page refresh needed). Also seed the summary so chip counts stay
      // accurate, and bump conversationsTotal for the inbox header.
      // Discord system DMs are auto-archived — never prepend them to the inbox.
      if (evt.conversation.peer?.discordUserId === DISCORD_SYSTEM_USER_ID) {
        return
      }
      setState((prev) => {
        const conv = evt.conversation
        // De-dupe — if the REST poller already imported this conv we'd
        // double-insert. Keep the existing row, just refresh its fields.
        const already = prev.conversations.find((c) => c.id === conv.id)
        const conversations = already
          ? prev.conversations.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
          : [conv, ...prev.conversations]
        const summaryExists = prev.conversationsSummary.some((s) => s.id === conv.id)
        const conversationsSummary = summaryExists
          ? prev.conversationsSummary
          : [
              {
                id: conv.id,
                accountId: conv.accountId,
                label: conv.label,
                inboundCount: 0,
                outboundCount: 0,
                lastMessageDirection: null,
                interested: !!conv.interested,
                lastMessagePreview: conv.lastMessagePreview || '',
                peerDiscordUserId: conv.peer?.discordUserId || '',
              },
              ...prev.conversationsSummary,
            ]
        return {
          ...prev,
          conversations,
          conversationsSummary,
          conversationsTotal: already ? prev.conversationsTotal : prev.conversationsTotal + 1,
        }
      })
    } else if (evt.type === "conversation_updated") {
      setState((prev) => {
        const isArchived = evt.conversation.label === "archived"
        return {
          ...prev,
          // Remove from inbox when archived so the change is instant in all tabs.
          conversations: isArchived
            ? prev.conversations.filter((c) => c.id !== evt.conversationId)
            : prev.conversations.map((c) =>
                c.id === evt.conversationId ? { ...c, ...evt.conversation } : c,
              ),
          conversationsSummary: prev.conversationsSummary.map((s) =>
            s.id === evt.conversationId
              ? { ...s, interested: evt.conversation.interested ?? s.interested }
              : s,
          ),
        }
      })
    } else if (evt.type === "account_status") {
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) =>
          a.id === evt.accountId ? { ...a, status: evt.status } : a,
        ),
      }))
    }
  }, [])

  // ---- Mutations exposed to panes ---------------------------------------
  const sendMessage = useCallback(async (conversationId: string, body: string): Promise<void> => {
    const trimmed = body.trim()
    if (!trimmed) return
    // Optimistic.
    const optimistic: Message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      direction: "out",
      body: trimmed,
      sentAt: new Date().toISOString(),
      authorName: "You",
      authorAvatarUrl: null,
    }
    setState((prev) => ({
      ...prev,
      messagesByConv: {
        ...prev.messagesByConv,
        [conversationId]: [...(prev.messagesByConv[conversationId] ?? []), optimistic],
      },
      conversations: prev.conversations
        .map((c) =>
          c.id === conversationId
            ? { ...c, lastMessagePreview: trimmed, lastMessageAt: optimistic.sentAt }
            : c,
        )
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)),
    }))
    try {
      const real = await fetchJson<Message>(
        `/api/unibox/conversations/${encodeURIComponent(conversationId)}/send`,
        { method: "POST", body: JSON.stringify({ body: trimmed }) },
      )
      // Swap optimistic for server copy.
      setState((prev) => ({
        ...prev,
        messagesByConv: {
          ...prev.messagesByConv,
          [conversationId]: (prev.messagesByConv[conversationId] ?? []).map((m) =>
            m.id === optimistic.id ? real : m,
          ),
        },
      }))
    } catch (err) {
      // Mark the optimistic message as failed by appending a sentinel — we
      // keep it visible so the user knows the send didn't land.
      setState((prev) => ({
        ...prev,
        error: (err as Error).message,
      }))
    }
  }, [])

  const deleteMessage = useCallback(async (conversationId: string, messageId: string): Promise<void> => {
    try {
      await fetch(`/api/unibox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" })
      setState((prev) => {
        const remaining = (prev.messagesByConv[conversationId] ?? []).filter((m) => m.id !== messageId);
        const last = remaining.length > 0
          ? remaining.reduce((a, b) => new Date(a.sentAt) > new Date(b.sentAt) ? a : b)
          : null;
        return {
          ...prev,
          messagesByConv: {
            ...prev.messagesByConv,
            [conversationId]: remaining,
          },
          conversations: prev.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessagePreview: last ? last.body : '',
                  lastMessageAt: last ? last.sentAt : c.lastMessageAt,
                }
              : c
          ),
          conversationsSummary: prev.conversationsSummary.map((s) =>
            s.id === conversationId
              ? {
                  ...s,
                  lastMessagePreview: last ? last.body : '',
                }
              : s
          ),
        };
      });
    } catch (err) {
      setState((prev) => ({ ...prev, error: (err as Error).message }))
    }
  }, [])

  const deleteConversation = useCallback(async (conversationId: string): Promise<void> => {
    setState((prev) => {
      const { [conversationId]: _drop, ...messagesByConv } = prev.messagesByConv
      return {
        ...prev,
        conversations: prev.conversations.filter((c) => c.id !== conversationId),
        conversationsSummary: prev.conversationsSummary.filter((s) => s.id !== conversationId),
        conversationsTotal: Math.max(0, prev.conversationsTotal - 1),
        messagesByConv,
      }
    })
    try {
      await fetchJson<{ ok: boolean }>(
        `/api/unibox/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      )
    } catch {
      // best-effort
    }
  }, [])

  const archiveConversation = useCallback(async (conversationId: string): Promise<void> => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, label: "archived" } : c,
      ),
    }))
    try {
      await fetchJson<Conversation>(
        `/api/unibox/conversations/${encodeURIComponent(conversationId)}/archive`,
        { method: "POST" },
      )
    } catch {
      // best-effort; the SSE feed would correct us in a live system.
    }
  }, [])

  const toggleInterested = useCallback(async (conversationId: string) => {
    // Optimistic flip; revert on error.
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, interested: !c.interested } : c,
      ),
      conversationsSummary: prev.conversationsSummary.map((s) =>
        s.id === conversationId ? { ...s, interested: !s.interested } : s,
      ),
    }))
    try {
      const target = state.conversations.find((c) => c.id === conversationId)
      const next = !(target?.interested ?? false)
      const r = await fetch(`/api/unibox/conversations/${encodeURIComponent(conversationId)}/interested`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interested: next }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch {
      // Revert.
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversationId ? { ...c, interested: !c.interested } : c,
        ),
        conversationsSummary: prev.conversationsSummary.map((s) =>
          s.id === conversationId ? { ...s, interested: !s.interested } : s,
        ),
      }))
    }
  }, [state.conversations])

  const dismissToast = useCallback((id: string): void => {
    setState((prev) => ({ ...prev, toasts: prev.toasts.filter((t) => t.id !== id) }))
  }, [])

  const markRead = useCallback((conversationId: string): void => {
    // Optimistic local update first; then persist to backend so unread count
    // survives a page reload (fire-and-forget, failure is non-critical).
    fetch(`/api/unibox/conversations/${encodeURIComponent(conversationId)}/mark-read`, {
      method: "POST",
    }).catch(() => { /* non-critical */ })
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    }))
  }, [])

  const markAllRead = useCallback(async (accountId?: string): Promise<void> => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        !accountId || c.accountId === accountId ? { ...c, unreadCount: 0 } : c,
      ),
    }))
    try {
      await fetchJson('/api/unibox/mark-all-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
    } catch { /* best-effort */ }
  }, [])

  // ---- Pagination -------------------------------------------------------
  // Called by ConvList's IntersectionObserver when the bottom sentinel scrolls
  // into view. Fetches the next page using offset=current.length so the same
  // sort (lastMessageAt DESC) applies — appended rows are strictly older than
  // what we already show. Re-entrant calls during an in-flight fetch are no-ops.
  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current) return
    if (!state.conversationsHasMore) return
    loadingMoreRef.current = true
    setState((prev) => ({ ...prev, loadingMoreConversations: true }))
    try {
      const offset = state.conversations.length
      // summary=0 because we already have the full summary from the initial
      // load; no need to re-ship 100s of rows on every scroll-page.
      const page = await fetchJson<ConversationPage>(
        `/api/unibox/conversations?limit=${CONV_PAGE_SIZE}&offset=${offset}&summary=0`,
      )
      setState((prev) => {
        // Dedup defensively in case a new conversation was inserted into the
        // backend between pages (e.g. a fresh inbound DM bumped the sort).
        const seen = new Set(prev.conversations.map((c) => c.id))
        const fresh = page.items.filter((c) => !seen.has(c.id) && hasMessages(c))
        return {
          ...prev,
          conversations: [...prev.conversations, ...fresh],
          conversationsHasMore: page.hasMore,
          conversationsTotal: page.total,
          loadingMoreConversations: false,
        }
      })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingMoreConversations: false,
        error: (err as Error).message,
      }))
    } finally {
      loadingMoreRef.current = false
    }
  }, [state.conversationsHasMore, state.conversations.length])

  // v0.41 — soft refresh: re-fetch /api/accounts and /api/unibox/conversations
  // and overwrite the local state without a full page reload. Wired to a
  // Refresh button in ConvList so the operator doesn't need a hard refresh
  // when SSE missed an event or the page got stale.
  const refreshConversations = useCallback(async () => {
    setState((prev) => ({ ...prev, loadingConversations: true, error: null }))
    try {
      const [accounts, convPage] = await Promise.all([
        fetchJson<DiscordAccount[]>("/api/accounts").catch(() => [] as DiscordAccount[]),
        fetchJson<ConversationPage>(`/api/unibox/conversations?limit=${CONV_PAGE_SIZE}`),
      ])
      const accountSummaries: AccountSummary[] = accounts.map((a) => ({
        id: a.id, label: a.label, username: a.username, avatarUrl: a.avatarUrl, status: a.status,
      }))
      setState((prev) => ({
        ...prev,
        accounts: accountSummaries.length > 0 ? accountSummaries : prev.accounts,
        conversations: convPage.items.filter(hasMessages),
        conversationsSummary: convPage.summary || [],
        conversationsHasMore: convPage.hasMore,
        conversationsTotal: convPage.total,
        loadingConversations: false,
      }))
    } catch (err: any) {
      setState((prev) => ({ ...prev, loadingConversations: false, error: err?.message || String(err) }))
    }
  }, [])

  // ---- Derived ----------------------------------------------------------
  const accountsById = useMemo(() => {
    const map: Record<string, AccountSummary> = {}
    for (const a of state.accounts) map[a.id] = a
    return map
  }, [state.accounts])

  return {
    state,
    accountsById,
    sendMessage,
    deleteMessage,
    deleteConversation,
    archiveConversation,
    toggleInterested,
    markRead,
    markAllRead,
    dismissToast,
    loadMoreConversations,
    refreshConversations,
  }
}
