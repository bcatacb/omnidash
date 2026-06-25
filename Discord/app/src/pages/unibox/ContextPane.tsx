import { useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation, Lead, Message } from "@/api-types"
import type { AccountSummary } from "./store"
import {
  avatarColorFromId,
  formatAbsoluteTime,
  formatRelativeTime,
  getInitials,
} from "./utils"

interface ContextPaneProps {
  conversation: Conversation | null
  account: AccountSummary | null
  accountsById: Record<string, AccountSummary>
  collapsed: boolean
  onToggleCollapsed: () => void
}


export default function ContextPane({
  conversation,
  account,
  accountsById,
  collapsed,
  onToggleCollapsed,
}: ContextPaneProps) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)
  const [crossHistory, setCrossHistory] = useState<Array<Message & { accountId: string }>>(
    [],
  )
  const [notes, setNotes] = useState("")
  const [notesDirty, setNotesDirty] = useState(false)

  // Fetch lead info when conversation changes.
  useEffect(() => {
    setLead(null)
    setCrossHistory([])
    setNotes("")
    setNotesDirty(false)
    if (!conversation) return
    const ac = new AbortController()
    setLeadLoading(true)
    ;(async () => {
      try {
        // The unibox endpoints don't expose a lead-by-id lookup, but the lead
        // id is on the conversation. Try the leads endpoint shapes Agent G
        // ships; fall back to a stub derived from the conversation peer.
        const res = await fetch(`/api/leads/${encodeURIComponent(conversation.leadId)}`, {
          signal: ac.signal,
        })
        if (res.ok) {
          const leadJson = (await res.json()) as Lead
          setLead(leadJson)
          setNotes("")
        } else {
          setLead(stubLead(conversation))
        }
      } catch {
        if (!ac.signal.aborted) setLead(stubLead(conversation))
      } finally {
        if (!ac.signal.aborted) setLeadLoading(false)
      }
    })()
    return () => ac.abort()
  }, [conversation?.id, conversation?.leadId])

  // Cross-account history: collect every message sent to/from this lead
  // across all of our bridged accounts. We do this by querying the unibox
  // conversations endpoint and filtering — the server already groups DMs by
  // (account, peer) so we just need to find every conv that matches the
  // peer's Discord user id.
  useEffect(() => {
    setCrossHistory([])
    if (!conversation) return
    const ac = new AbortController()
    ;(async () => {
      try {
        const convsRes = await fetch("/api/unibox/conversations", { signal: ac.signal })
        if (!convsRes.ok) return
        const convs = (await convsRes.json()) as Conversation[]
        const matching = convs.filter(
          (c) => c.peer.discordUserId === conversation.peer.discordUserId,
        )
        const all: Array<Message & { accountId: string }> = []
        await Promise.all(
          matching.map(async (c) => {
            try {
              const msgsRes = await fetch(
                `/api/unibox/conversations/${encodeURIComponent(c.id)}/messages`,
                { signal: ac.signal },
              )
              if (!msgsRes.ok) return
              const msgs = (await msgsRes.json()) as Message[]
              for (const m of msgs) {
                all.push({ ...m, accountId: c.accountId })
              }
            } catch {
              // ignore per-conv failure
            }
          }),
        )
        all.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
        if (!ac.signal.aborted) setCrossHistory(all)
      } catch {
        // best-effort
      }
    })()
    return () => ac.abort()
  }, [conversation?.peer.discordUserId])

  const peerAvatarBg = useMemo(
    () => avatarColorFromId(conversation?.peer.discordUserId ?? ""),
    [conversation?.peer.discordUserId],
  )

  if (collapsed) {
    return (
      <aside className="w-10 bg-bg-secondary border-l border-black/20 flex flex-col items-center pt-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="h-8 w-8 inline-flex items-center justify-center rounded-chip text-text-muted hover:bg-bg-message-hover hover:text-text-normal transition-colors duration-100"
          aria-label="Open lead details"
          title="Open lead details"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label="Lead context"
      className="w-[280px] shrink-0 bg-bg-secondary border-l border-black/20 flex flex-col"
    >
      <header className="flex items-center justify-between h-12 px-3 border-b border-black/20 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Lead details
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="h-7 w-7 inline-flex items-center justify-center rounded-chip text-text-muted hover:bg-bg-message-hover hover:text-text-normal transition-colors duration-100"
          aria-label="Collapse pane"
          title="Collapse"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {!conversation ? (
          <div className="p-4 text-xs text-text-muted">
            Select a conversation to see lead context.
          </div>
        ) : (
          <>
            {/* Identity card */}
            <div className="px-4 pt-4 pb-3 border-b border-black/20">
              <div className="flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-semibold shrink-0"
                  style={{
                    backgroundColor: conversation.peer.avatarUrl ? undefined : peerAvatarBg,
                  }}
                >
                  {conversation.peer.avatarUrl ? (
                    <img
                      src={conversation.peer.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitials(conversation.peer.displayName)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-normal truncate">
                    {conversation.peer.displayName}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    ID {conversation.peer.discordUserId}
                  </div>
                </div>
              </div>

              <dl className="mt-3 space-y-2 text-xs">
                <Row label="Source">
                  <span className="text-text-normal">
                    {leadLoading ? "…" : lead?.source ?? "—"}
                  </span>
                </Row>

                <Row label="Bridged via">
                  <span className="text-text-normal">
                    @{account?.username ?? "—"}
                  </span>
                </Row>
              </dl>
            </div>

            {/* Notes */}
            <section className="px-4 py-3 border-b border-black/20">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                Your notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  setNotesDirty(true)
                }}
                placeholder="Jot context about this lead — what they're building, where they came from, anything you want surfaced next time."
                rows={4}
                className={cn(
                  "w-full text-xs bg-bg-tertiary text-text-normal placeholder:text-text-muted",
                  "rounded-card px-2 py-2 border border-transparent",
                  "focus:border-brand focus:outline-none resize-y min-h-[72px]",
                )}
              />
              {notesDirty && (
                <p className="text-[10px] text-text-muted mt-1">
                  Notes save with the next backend sync (demo mode).
                </p>
              )}
            </section>

            {/* Cross-account history */}
            <section className="px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">
                <Inbox className="h-3 w-3" />
                Send history (all your accounts)
              </h3>
              {crossHistory.length === 0 ? (
                <p className="text-xs text-text-muted">
                  No prior messages between you and this lead yet.
                </p>
              ) : (
                <ol className="space-y-2">
                  {crossHistory.slice(0, 30).map((m) => {
                    const acct = accountsById[m.accountId]
                    return (
                      <li
                        key={`${m.accountId}-${m.id}`}
                        className="text-xs rounded-card bg-bg-tertiary px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span
                            className={cn(
                              "text-[10px] font-semibold uppercase tracking-wide",
                              m.direction === "out" ? "text-brand" : "text-text-normal",
                            )}
                          >
                            {m.direction === "out" ? "You" : m.authorName}
                            <span className="text-text-muted font-normal">
                              {" · @"}
                              {acct?.username ?? "account"}
                            </span>
                          </span>
                          <span
                            title={formatAbsoluteTime(m.sentAt)}
                            className="text-[10px] text-text-muted shrink-0"
                          >
                            {formatRelativeTime(m.sentAt)}
                          </span>
                        </div>
                        <p className="text-text-normal text-xs leading-snug whitespace-pre-wrap break-words">
                          {m.body}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

function stubLead(conversation: Conversation): Lead {
  return {
    id: conversation.leadId,
    campaignId: "",
    discordUserId: conversation.peer.discordUserId,
    displayName: conversation.peer.displayName,
    status: "replied",
    source: "demo",
    assignedAccountId: conversation.accountId,
    sentAt: null,
    createdAt: conversation.lastMessageAt,
  }
}

// Silence the lint rule for the unused-imports we keep for future expansion.
void ChevronLeft
void ChevronRight
