import { useEffect, useMemo, useState } from "react"
import { useConfirm } from "@/components/ui/confirm"
import { useNavigate, useParams } from "react-router-dom"
import AccountRail from "./unibox/AccountRail"
import ChatPane from "./unibox/ChatPane"
import ContextPane from "./unibox/ContextPane"
import ConvList from "./unibox/ConvList"
import { useUniboxStore } from "./unibox/store"

// Unibox page — Discord-style 3-pane (4 columns with the account rail).
//
// Route shape:
//   /app/unibox                      → no conversation selected (empty state)
//   /app/unibox/c/:conversationId    → conversation open in the chat pane
//
// Grid breakpoints:
//   - Account rail: fixed 72px (Discord-canonical)
//   - Conv list:   fixed 260px
//   - Chat pane:   flex-1 (fills remaining space)
//   - Context:     280px, collapsible to 40px
//
// The whole page lives in a `h-[calc(100vh-Xrem)]` flex row because
// AppLayout already provides the top chrome. We avoid global `overflow:hidden`
// so each pane owns its own scroll.

// Spreading a large Uint8Array into String.fromCharCode() blows the JS call
// stack for any file/audio clip beyond ~32 KB. Process in 32 KB chunks instead.
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const CHUNK = 0x8000 // 32 768 bytes
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(binary)
}

export default function Unibox() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { conversationId: routeConvId } = useParams<{ conversationId: string }>()

  const activeConvId = routeConvId ?? null
  const { state, accountsById, sendMessage, deleteMessage, deleteConversation, archiveConversation, toggleInterested, markRead, markAllRead, dismissToast, loadMoreConversations, refreshConversations } =
    useUniboxStore(activeConvId)

  // Request browser notification permission once so FR accepted pings work.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => { /* user denied or unsupported */ })
    }
  }, [])

  const [selectedAccountId, setSelectedAccountId] = useState<string | "all">("all")
  const [contextCollapsed, setContextCollapsed] = useState(false)

  // Build set of our own Discord user IDs for warmup conv detection.
  // Use a.id (always populated from in-memory state) rather than a.discordUserId
  // (from DB enrichment, which can be null if enrichment fails).
  // For real accounts id === discordUserId; filter to Discord snowflakes only.
  const ownDiscordUserIds = useMemo(
    () => new Set(
      state.accounts
        .map((a) => a.discordUserId)
        .filter((id): id is string => !!id && /^\d{15,20}$/.test(id))
    ),
    [state.accounts],
  )

  // If the URL points to a conversation we don't know about (e.g. user
  // deep-linked but the conv was dropped), don't crash — keep the route but
  // show the empty state via conversation=null below.
  const activeConv = useMemo(
    () => state.conversations.find((c) => c.id === activeConvId) ?? null,
    [state.conversations, activeConvId],
  )

  // When the active conv exists, align the rail filter to its account so the
  // operator's mental model stays consistent.
  useEffect(() => {
    if (
      activeConv &&
      selectedAccountId !== "all" &&
      selectedAccountId !== activeConv.accountId
    ) {
      setSelectedAccountId(activeConv.accountId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id])

  function handleSelectConv(id: string) {
    navigate(`/app/unibox/c/${id}`)
  }

  function handleArchive() {
    if (!activeConv) return
    void archiveConversation(activeConv.id)
    navigate("/app/unibox")
  }

  function handleDelete() {
    if (!activeConv) return
    void deleteConversation(activeConv.id)
    navigate("/app/unibox")
  }

  function handleMarkRead() {
    if (!activeConv) return
    markRead(activeConv.id)
  }

  async function handleDeleteMessage(messageId: string, shiftKey = false) {
    if (!activeConv) return
    if (shiftKey || await confirm({
      title: "Delete message?",
      description: "This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    })) {
      await deleteMessage(activeConv.id, messageId)
    }
  }

  async function handleSend(body: string) {
    if (!activeConv) return
    await sendMessage(activeConv.id, body)
  }

  async function handleSendFile(file: File) {
    if (!activeConv) return
    const arrayBuffer = await file.arrayBuffer()
    const base64 = bufferToBase64(arrayBuffer)
    const r = await fetch(`/api/unibox/conversations/${activeConv.id}/send-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, filename: file.name, mimeType: file.type }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j?.error || `HTTP ${r.status}`)
    }
  }

  async function handleSendVoice(blob: Blob, durationSecs: number) {
    if (!activeConv) return
    const arrayBuffer = await blob.arrayBuffer()
    const base64 = bufferToBase64(arrayBuffer)
    const r = await fetch(`/api/unibox/conversations/${activeConv.id}/send-voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: base64, mimeType: blob.type || "audio/webm", durationSecs }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j?.error || `HTTP ${r.status}`)
    }
  }

  const activeAccount = activeConv ? accountsById[activeConv.accountId] ?? null : null
  const messages = activeConvId ? state.messagesByConv[activeConvId] ?? [] : []

  // Mobile master-detail: when a conversation is open, hide the list panes
  // and show the chat full-screen. When no conv selected, hide the chat pane
  // and show only the list. Desktop (md+) keeps the full 4-column layout.
  const hasActive = !!activeConv

  return (
    <div
      className="relative flex h-full min-h-[400px] overflow-hidden bg-bg-primary text-text-normal font-sans md:h-[calc(100vh-3.5rem)] md:min-h-[480px]"
      data-page="unibox"
    >
      {/* Each pane is wrapped in a display:contents shell so the wrapper is
          invisible in layout — the pane stays a direct flex child of the
          outer row, preserving the original desktop flex chain exactly.
          On mobile we toggle each shell between `hidden` (display:none) and
          `contents` to drive the master-detail flow. */}
      <div className={hasActive ? "hidden md:contents" : "contents"}>
        <AccountRail
          accounts={state.accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
        />
      </div>

      <div className={hasActive ? "hidden md:contents" : "contents"}>
        <ConvList
          conversations={state.conversations}
          summary={state.conversationsSummary}
          ownDiscordUserIds={ownDiscordUserIds}
          selectedConvId={activeConvId}
          selectedAccountId={selectedAccountId}
          flashConvIds={state.flashConvIds}
          loading={state.loadingConversations}
          hasMore={state.conversationsHasMore}
          loadingMore={state.loadingMoreConversations}
          onLoadMore={loadMoreConversations}
          onRefresh={refreshConversations}
          onMarkAllRead={() => markAllRead(selectedAccountId === "all" ? undefined : selectedAccountId)}
          onSelectConv={handleSelectConv}
          onToggleInterested={toggleInterested}
          onArchiveConversation={(id) => { void archiveConversation(id); if (id === activeConvId) navigate("/app/unibox") }}
          onDeleteConversation={(id) => { void deleteConversation(id); if (id === activeConvId) navigate("/app/unibox") }}
        />
      </div>

      <div className={hasActive ? "contents" : "hidden md:contents"}>
        <ChatPane
          conversation={activeConv}
          account={activeAccount}
          messages={messages}
          loading={state.loadingMessages}
          onSend={handleSend}
          onSendFile={handleSendFile}
          onSendVoice={handleSendVoice}
          onDeleteMessage={handleDeleteMessage}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onMarkRead={handleMarkRead}
          onBack={() => navigate("/app/unibox")}
        />
      </div>

      <div className="hidden md:contents">
        <ContextPane
          conversation={activeConv}
          account={activeAccount}
          accountsById={accountsById}
          collapsed={contextCollapsed}
          onToggleCollapsed={() => setContextCollapsed((v) => !v)}
        />
      </div>

      {/* In-app toast notifications — FR accepted etc. */}
      {state.toasts.length > 0 && (
        <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {state.toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-white text-sm shadow-lg"
              style={{ animation: "slideUpToast 0.25s ease-out" }}
            >
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="ml-1 opacity-70 hover:opacity-100 text-white text-base leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

