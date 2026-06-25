'use client'

import { useEffect, useMemo, useRef, useState, memo, useLayoutEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { useAuth, type MessageConversation, type MessageItem, type CampaignLead, type CampaignRecord, type CustomFolder, type FolderChatEntry, type GroupPreset, type GroupScraperGroup, type StoredMessage } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  Search,
  RefreshCw,
  Send,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Video,
  UserRound,
  MessageSquare,
  ArrowLeft,
  LogOut,
  Folder,
  Plus,
  Target,
  Users,
  Bot,
  Volume2,
  Edit3,
  FileEdit,
  Trash2,
  MoreHorizontal,
  Ban,
  ListChecks,
  ChevronDown,
  Forward,
  Star,
  Bookmark,
  Check,
} from 'lucide-react'
import { Spinner, BrandedLoader } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CreateGroupDialog } from '@/components/groups/CreateGroupDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const CONVERSATION_PAGE_SIZE = 200
const THREAD_PAGE_SIZE = 30

// Per-member filter labels (mirrors the scraper page); drives the in-folder filter tabs.
// "unknown"/untagged is not a stored tag — it's represented by filterTag == null.
type FolderFilterTag = 'excluded' | 'important' | 'known' | 'caution'
const FOLDER_FILTER_TAGS: { key: FolderFilterTag; label: string; dot: string }[] = [
  { key: 'excluded', label: 'Excluded', dot: 'bg-red-500' },
  { key: 'important', label: 'Important', dot: 'bg-amber-400' },
  { key: 'known', label: 'Known', dot: 'bg-emerald-500' },
  { key: 'caution', label: 'Caution', dot: 'bg-black border border-slate-500' },
]

function formatTime(ts?: string | null) {
  if (!ts) return '--'
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(ts?: string | null) {
  if (!ts) return 'Unknown'
  return new Date(ts).toLocaleString()
}

const MediaAttachment = memo(function MediaAttachment({
  msg,
  fetchMessageMediaUrl,
}: {
  msg: MessageItem
  fetchMessageMediaUrl: (accountId: string, chatId: string, messageId: number) => Promise<string>
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objUrl: string | null = null
    setUrl(null)
    setFailed(false)
    fetchMessageMediaUrl(msg.accountId, msg.chatId, msg.id)
      .then((u) => {
        if (active) {
          objUrl = u
          setUrl(u)
        } else {
          URL.revokeObjectURL(u)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [msg.accountId, msg.chatId, msg.id, fetchMessageMediaUrl])

  if (failed) {
    return <div className="text-xs text-slate-500">Failed to load attachment</div>
  }
  if (!url) {
    return <div className="text-xs text-slate-500"><Spinner className="inline mr-1 w-3 h-3" /> Loading attachment…</div>
  }
  if (msg.mediaType === 'photo') {
    return (
      <img
        src={url}
        alt={msg.mediaFileName || 'Photo'}
        className="max-h-72 rounded-lg border border-slate-700 object-cover"
      />
    )
  }
  if (msg.mediaType === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="max-h-72 rounded-lg border border-slate-700"
      />
    )
  }
  return (
    <a
      href={url}
      download={msg.mediaFileName || undefined}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700/40"
    >
      <FileText className="w-4 h-4" />
      {msg.mediaFileName || 'Open attachment'}
    </a>
  )
})

const MessageBubble = memo(function MessageBubble({
  msg,
  fetchMessageMediaUrl,
  isRead,
  onForward,
}: {
  msg: MessageItem
  fetchMessageMediaUrl: (accountId: string, chatId: string, messageId: number) => Promise<string>
  isRead: boolean
  onForward: (msg: MessageItem) => void
}) {
  return (
    <div className={`group flex items-end gap-1 ${msg.outgoing ? 'justify-end' : 'justify-start'}`}>
      {!msg.outgoing && (
        <button
          onClick={() => onForward(msg)}
          title="Forward"
          className="opacity-0 group-hover:opacity-100 transition mb-1 shrink-0 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700"
        >
          <Forward className="w-3.5 h-3.5" />
        </button>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 border ${
          msg.outgoing
            ? 'ml-auto bg-blue-600/20 border-blue-500/30'
            : 'bg-slate-800/80 border-slate-700'
        }`}
      >
      {!msg.outgoing && msg.senderName && (
        <p className="text-[11px] font-medium text-blue-300 mb-1">{msg.senderName}</p>
      )}
      {msg.hasMedia && (
        <div className="mb-2">
          <MediaAttachment msg={msg} fetchMessageMediaUrl={fetchMessageMediaUrl} />
        </div>
      )}
      {msg.text && <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>}
      <div className="flex items-center justify-end gap-1 mt-1">
        <span className="text-[11px] text-slate-400">{formatDateTime(msg.timestamp)}</span>
        {msg.outgoing && (
          <span className={`text-[11px] ${isRead ? 'text-blue-400' : 'text-slate-500'}`}>
            {isRead ? '✓✓' : '✓'}
          </span>
        )}
      </div>
      </div>
      {msg.outgoing && (
        <button
          onClick={() => onForward(msg)}
          title="Forward"
          className="opacity-0 group-hover:opacity-100 transition mb-1 shrink-0 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700"
        >
          <Forward className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
})

// Telegram-style avatar: shows the contact's real profile photo when available, otherwise a
// colored circle with the title's initial. The `hasPhoto` gate + lazy loading keep requests
// cheap across long conversation lists, and image errors fall back to the initial.
const ConversationAvatar = memo(function ConversationAvatar({
  accountId,
  chatId,
  title,
  hasPhoto,
  isBot,
  isChannel,
  isGroup,
  color,
  photoUrl,
  size = 'md',
}: {
  accountId: string
  chatId: string
  title: string
  hasPhoto?: boolean
  isBot?: boolean
  isChannel?: boolean
  isGroup?: boolean
  color: string
  photoUrl: (accountId: string, chatId: string) => string
  size?: 'sm' | 'md'
}) {
  const [errored, setErrored] = useState(false)
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'
  const showImg = !!hasPhoto && !errored && !!chatId
  const Icon = isBot ? Bot : isChannel ? Volume2 : isGroup ? Users : null
  const initial = (title || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <div
      className={`${dim} shrink-0 rounded-full overflow-hidden flex items-center justify-center text-white`}
      style={{ backgroundColor: showImg ? undefined : color }}
    >
      {showImg ? (
        <img
          src={photoUrl(accountId, chatId)}
          alt={title}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : Icon ? (
        <Icon className="w-4 h-4 text-white/90" />
      ) : (
        <span className="text-sm font-semibold leading-none">{initial}</span>
      )}
    </div>
  )
})

function UniboxWorkspace() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, fetchMessages, fetchFolderConversations, fetchThread, sendMessage, sendFileMessage, forwardMessageBatch, resolveUser, fetchMessageMediaUrl, getConversationPhotoUrl, leaveChat, batchLeaveChats, blockUser, batchBlockUsers, fetchCampaignLeads, fetchCampaignLeadsById, markConversation, listCampaigns, refreshCampaignReplyStats, refreshCampaignSeenStats, createFolder, listCustomFolders, updateFolder, deleteFolder, listFolderChats, addChatToFolder, setFolderChatFilter, removeChatFromFolder, moveChatToFolder, batchMoveChatsToFolder, listGroupPresets, listGroupsForAccount, listStoredMessages, getStoredMessageFileUrl } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [leftBarTab, setLeftBarTab] = useState<'inbox' | 'campaigns'>('inbox')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<CustomFolder[]>([])
  const [folderChatMap, setFolderChatMap] = useState<Map<string, Set<string>>>(new Map<string, Set<string>>())
  // Fully-resolved conversations for the currently open folder (all members, not just recent dialogs).
  const [folderConversations, setFolderConversations] = useState<MessageConversation[]>([])
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderType, setNewFolderType] = useState<'standard' | 'draft' | 'group_chat'>('standard')
  const [newFolderDraftText, setNewFolderDraftText] = useState('')
  const [newFolderWatchAccountId, setNewFolderWatchAccountId] = useState('')
  const [newFolderWatchGroupId, setNewFolderWatchGroupId] = useState('')
  const [newFolderWatchGroups, setNewFolderWatchGroups] = useState<GroupScraperGroup[]>([])
  const [newFolderWatchGroupsLoading, setNewFolderWatchGroupsLoading] = useState(false)
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [renameFolderType, setRenameFolderType] = useState<'standard' | 'draft' | 'group_chat'>('standard')
  const [renameFolderDraftText, setRenameFolderDraftText] = useState('')
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null)
  const [leadStatusFilter, setLeadStatusFilter] = useState<'all' | 'no_reply' | 'replied' | 'favorites'>('all')
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('unibox_favorites') || '[]')) } catch { return new Set<string>() }
  })
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'users' | 'groups' | 'channels' | 'bots' | 'drafts'>('all')
  // Per-member filter label tab, used only inside a (non-draft) custom folder.
  const [folderTagFilter, setFolderTagFilter] = useState<'all' | FolderFilterTag | 'untagged'>('all')
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())

  const [conversations, setConversations] = useState<MessageConversation[]>([])
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [nextConversationsOffset, setNextConversationsOffset] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())
  const [isSelecting, setIsSelecting] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [quickGroupUser, setQuickGroupUser] = useState<{
    id: string
    accountId: string
    chatId: string
    chatTitle?: string
    username?: string | null
  } | null>(null)
  const [presets, setPresets] = useState<GroupPreset[]>([])
  const [thread, setThread] = useState<MessageItem[]>([])
  const [hasMoreOlderThread, setHasMoreOlderThread] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [composer, setComposer] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [storedMessages, setStoredMessages] = useState<StoredMessage[]>([])
  const [storedPopoverOpen, setStoredPopoverOpen] = useState(false)
  const [sendingStoredId, setSendingStoredId] = useState<string | null>(null)

  const [isLoadingFolder, setIsLoadingFolder] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false)
  const [isLoadingThread, setIsLoadingThread] = useState(false)
  const [isLoadingOlderThread, setIsLoadingOlderThread] = useState(false)
  const [threadLoadedOnce, setThreadLoadedOnce] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [forwardMsg, setForwardMsg] = useState<MessageItem | null>(null)
  const [forwardSearch, setForwardSearch] = useState('')
  const [isForwarding, setIsForwarding] = useState(false)
  const [forwardSelected, setForwardSelected] = useState<Set<string>>(new Set())
  const [forwardLeads, setForwardLeads] = useState<CampaignLead[]>([])
  const [forwardManual, setForwardManual] = useState<Array<{ key: string; toChatId: string; title: string; sub: string }>>([])
  const [isResolving, setIsResolving] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [pendingLeaveChat, setPendingLeaveChat] = useState<{ accountId: string; chatId: string } | null>(null)
const [pendingLeaveChats, setPendingLeaveChats] = useState<Array<{ account_id: string; chat_id: string }> | null>(null)
const [isLeavingBatch, setIsLeavingBatch] = useState(false)
const [pendingDeleteChat, setPendingDeleteChat] = useState<{ accountId: string; chatId: string } | null>(null)
const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [markedAsRead, setMarkedAsRead] = useState(false)
  const [leads, setLeads] = useState<CampaignLead[]>([])
  const [isLoadingLeads, setIsLoadingLeads] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [campaignLeads, setCampaignLeads] = useState<CampaignLead[]>([])

  const [leadsError, setLeadsError] = useState<string | null>(null)

  const [isRefreshingReplies, setIsRefreshingReplies] = useState(false)

  const previousConversationMap = useRef<Record<string, string>>({})
  const conversationsRef = useRef<MessageConversation[]>([])
  const conversationsHashRef = useRef<string>('')
  const selectedIdRef = useRef<string | null>(null)
  const threadContainerRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const prependAnchorRef = useRef<{ prevHeight: number; prevTop: number } | null>(null)
  const deepLinkHandledRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxKnownIdRef = useRef<number | undefined>(undefined)
  const threadLoadIdRef = useRef<string | null>(null)
  const notificationAudioCtxRef = useRef<AudioContext | null>(null)
  const loadedForFilterRef = useRef(false)
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const savedScrollTopRef = useRef(0)
  const topConversationIdRef = useRef<string | null>(null)
  const lastClickedIdxRef = useRef<number | null>(null)

  const computeAccountColor = (accountId: string) => {
    let hash = 0
    for (let i = 0; i < accountId.length; i++)
      hash = accountId.charCodeAt(i) + ((hash << 5) - hash)
    return `hsl(${Math.abs(hash) % 360}, 55%, 55%)`
  }
  // Cache colors per account so the hash isn't recomputed for every row on every render.
  const accountColorCacheRef = useRef<Map<string, string>>(new Map())
  const accountColor = useCallback((accountId: string) => {
    const cache = accountColorCacheRef.current
    let c = cache.get(accountId)
    if (!c) { c = computeAccountColor(accountId); cache.set(accountId, c) }
    return c
  }, [])

  const deepLinkAccountId = searchParams.get('account_id')
  const deepLinkChatId = searchParams.get('chat_id')
  const deepLinkTarget = searchParams.get('target')
  const directConversationId = deepLinkAccountId && deepLinkChatId
    ? `${deepLinkAccountId}::${deepLinkChatId}`
    : null

  const selectedConversation = useMemo(
    () => {
      const existing = conversations.find((item) => item.id === selectedId)
        || (selectedFolderId ? folderConversations.find((item) => item.id === selectedId) : undefined)
      if (existing) return existing
      if (directConversationId && selectedId === directConversationId && deepLinkAccountId && deepLinkChatId) {
        return {
          id: directConversationId,
          accountId: deepLinkAccountId,
          accountLabel: 'Campaign account',
          chatId: deepLinkChatId,
          chatTitle: deepLinkTarget || deepLinkChatId,
          chatUsername: deepLinkTarget && !deepLinkTarget.startsWith('-') ? deepLinkTarget.replace(/^@/, '') : null,
          lastMessage: '',
          lastSenderName: null,
          lastMessageOutgoing: false,
          timestamp: null,
          unreadCount: 0,
          isGroup: false,
          isChannel: false,
          isUser: true,
          isBot: false,
        } satisfies MessageConversation
      }
      if (selectedId?.startsWith('lead:')) {
        const lead = leads.find((l) => `lead:${l.accountId}:${l.chatId}` === selectedId)
          || campaignLeads.find((l) => `lead:${l.accountId}:${l.chatId}` === selectedId)
        if (lead) {
          return {
            id: selectedId,
            accountId: lead.accountId || '',
            accountLabel: lead.accountLabel || 'Unknown',
            chatId: lead.chatId || '',
            chatTitle: lead.target,
            chatUsername: lead.target.startsWith('@') ? lead.target.slice(1) : null,
            lastMessage: '',
            lastSenderName: null,
            lastMessageOutgoing: false,
            timestamp: lead.sentAt || null,
            unreadCount: 0,
            isGroup: false,
            isChannel: false,
            isUser: true,
            isBot: false,
          } satisfies MessageConversation
        }
      }
      return null
    },
    [conversations, folderConversations, selectedId, selectedFolderId, directConversationId, deepLinkAccountId, deepLinkChatId, deepLinkTarget, leads, campaignLeads]
  )

  const selectedLeadError = useMemo(() => {
    if (!selectedId?.startsWith('lead:')) return null
    const lead = leads.find((l) => `lead:${l.accountId}:${l.chatId}` === selectedId)
      || campaignLeads.find((l) => `lead:${l.accountId}:${l.chatId}` === selectedId)
    return (lead as any)?.error ?? null
  }, [selectedId, leads, campaignLeads])

  const entityTypeCounts = useMemo(() => {
    const currentFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) : null
    const isDraftFolder = currentFolder?.folder_type === 'draft'
    let list: typeof conversations
    if (isDraftFolder) {
      const pattern = (currentFolder?.draft_text || '').toLowerCase()
      list = pattern ? conversations.filter(c => (c.draft || '').toLowerCase() === pattern) : []
    } else if (selectedFolderId) {
      // Non-draft folder: the membership-resolved list already contains exactly its members.
      list = folderConversations
    } else {
      list = conversations
    }
    let users = 0, groups = 0, channels = 0, bots = 0, drafts = 0
    for (const c of list) {
      if (c.draft) drafts++
      if (c.isBot) bots++
      else if (c.isChannel) channels++
      else if (c.isGroup) groups++
      else users++
    }
    return { users, groups, channels, bots, drafts, allCount: list.length }
  }, [conversations, folderConversations, selectedFolderId, folders])

  // Per-tag counts for the in-folder filter tabs (non-draft folders only).
  const folderTagCounts = useMemo(() => {
    const counts: Record<'all' | FolderFilterTag | 'untagged', number> = {
      all: folderConversations.length, excluded: 0, important: 0, known: 0, caution: 0, untagged: 0,
    }
    for (const c of folderConversations) {
      const tag = c.filterTag
      if (tag === 'excluded' || tag === 'important' || tag === 'known' || tag === 'caution') {
        counts[tag]++
      } else {
        counts.untagged++
      }
    }
    return counts
  }, [folderConversations])

  const filteredConversations = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const currentFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) : null
    const isDraftFolder = currentFolder?.folder_type === 'draft'
    // For a non-draft folder, render the full membership list (resolved server-side) so members
    // without a recent dialog still appear. Inbox and draft folders filter the global list.
    const base = selectedFolderId && !isDraftFolder ? folderConversations : conversations
    return base.filter((item) => {
      if (selectedFolderId && isDraftFolder) {
        const pattern = (currentFolder?.draft_text || '').toLowerCase()
        if (!pattern || (item.draft || '').toLowerCase() !== pattern) return false
      }
      if (entityTypeFilter === 'drafts') return !!item.draft
      const baseStr = `${item.chatTitle} ${item.chatUsername || ''} ${item.draft || ''} ${item.lastMessage} ${item.accountLabel}`
      const matchesSearch = !needle || baseStr.toLowerCase().includes(needle)
      const matchesAccount = selectedAccountIds.size === 0 || selectedAccountIds.has(item.accountId)
      const matchesType = entityTypeFilter === 'all'
        || (entityTypeFilter === 'users' && !item.isBot && !item.isChannel && !item.isGroup)
        || (entityTypeFilter === 'groups' && item.isGroup)
        || (entityTypeFilter === 'channels' && item.isChannel)
        || (entityTypeFilter === 'bots' && item.isBot)
      // Inside a non-draft folder, also filter by the member's saved filter label.
      const matchesTag = !(selectedFolderId && !isDraftFolder) || folderTagFilter === 'all'
        || (folderTagFilter === 'untagged' ? !item.filterTag : item.filterTag === folderTagFilter)
      return matchesSearch && matchesAccount && matchesType && matchesTag
    })
  }, [conversations, folderConversations, search, selectedAccountIds, entityTypeFilter, folderTagFilter, selectedFolderId, folders])

  const displayConversations = useMemo(() => {
    const chatMap = new Map<string, MessageConversation[]>()
    for (const conv of filteredConversations) {
      const arr = chatMap.get(conv.chatId)
      if (arr) arr.push(conv)
      else chatMap.set(conv.chatId, [conv])
    }

    const merged: MessageConversation[] = []
    const singles: MessageConversation[] = []
    for (const [, entries] of chatMap) {
      // Only merge shared chats (groups/channels) that several of your accounts
      // belong to. Direct messages with a person/bot are a distinct conversation
      // per account, so keep them separate instead of collapsing to "N accounts".
      const isSharedChat = entries[0].isGroup || entries[0].isChannel
      if (entries.length === 1 || !isSharedChat) {
        for (const entry of entries) singles.push(entry)
      } else {
        entries.sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
          return tb - ta
        })
        const best = { ...entries[0], unreadCount: entries.reduce((s, e) => s + e.unreadCount, 0) } as MessageConversation & { _mergedAccounts?: MessageConversation[] }
        best._mergedAccounts = entries
        merged.push(best)
      }
    }

    // Decorate with a parsed timestamp once, then sort, to avoid re-parsing dates in the comparator.
    const all = [...merged, ...singles].map((c) => ({
      c,
      ts: c.timestamp ? new Date(c.timestamp).getTime() : 0,
    }))
    all.sort((a, b) => b.ts - a.ts)

    return all.map((x) => x.c)
  }, [filteredConversations])

  // Load campaign leads once when the forward dialog opens, so the recipient
  // picker can include people we've contacted but may not have a thread with.
  useEffect(() => {
    if (forwardMsg === null) return
    let cancelled = false
    fetchCampaignLeads()
      .then((data) => { if (!cancelled) setForwardLeads(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [forwardMsg, fetchCampaignLeads])

  // Unified recipient list: manually-resolved usernames + existing conversations + campaign leads
  // (deduped by chatId).
  const forwardRecipients = useMemo(() => {
    const list: Array<{ key: string; toChatId: string; title: string; sub: string }> = []
    const seenChatIds = new Set<string>()
    for (const m of forwardManual) {
      list.push(m)
      seenChatIds.add(m.toChatId)
    }
    for (const c of displayConversations) {
      if (seenChatIds.has(c.chatId)) continue
      list.push({ key: `conv:${c.id}`, toChatId: c.chatId, title: c.chatTitle, sub: c.accountLabel })
      seenChatIds.add(c.chatId)
    }
    for (const lead of forwardLeads) {
      const toChatId = lead.chatId || lead.target
      if (!toChatId) continue
      if (lead.chatId && seenChatIds.has(lead.chatId)) continue
      list.push({
        key: `lead:${lead.campaignId}:${toChatId}`,
        toChatId,
        title: lead.target || toChatId,
        sub: lead.campaignName || 'Campaign lead',
      })
    }
    return list
  }, [displayConversations, forwardLeads, forwardManual])

  const forwardFiltered = useMemo(() => {
    const q = forwardSearch.trim().toLowerCase()
    if (!q) return forwardRecipients
    return forwardRecipients.filter((r) => `${r.title} ${r.sub}`.toLowerCase().includes(q))
  }, [forwardRecipients, forwardSearch])

  // Resolve a typed @username / phone via Telegram and add it as a selectable recipient.
  const handleResolveForwardUser = async () => {
    const query = forwardSearch.trim()
    if (!query || isResolving || !selectedConversation) return
    setIsResolving(true)
    try {
      const resolved = await resolveUser(selectedConversation.accountId, query)
      const key = `manual:${resolved.chatId}`
      setForwardManual((prev) => (prev.some((m) => m.toChatId === resolved.chatId) ? prev : [
        { key, toChatId: resolved.chatId, title: resolved.name, sub: resolved.username ? `@${resolved.username}` : 'Resolved via username' },
        ...prev,
      ]))
      setForwardSelected((prev) => new Set(prev).add(key))
      setForwardSearch('')
    } catch (err: any) {
      toast.error(err?.message || 'Could not find that user')
    } finally {
      setIsResolving(false)
    }
  }

  // Folders that a chat can be assigned to (excludes the current folder and draft folders).
  const assignableFolders = useMemo(
    () => folders.filter(f => f.id !== selectedFolderId && f.folder_type !== 'draft' && f.folder_type !== 'group_chat'),
    [folders, selectedFolderId]
  )

  // Campaign leads filtered by the active status tab — memoized so we don't re-filter per render.
  const filteredLeads = useMemo(() => {
    const source = selectedCampaignId ? campaignLeads : leads
    if (leadStatusFilter === 'no_reply') return source.filter(l => l.success !== false && !l.replied)
    if (leadStatusFilter === 'replied') return source.filter(l => l.replied && l.success !== false)
    if (leadStatusFilter === 'favorites') return source.filter(l => favorites.has(`lead:${l.accountId}:${l.chatId}`))
    return source
  }, [selectedCampaignId, campaignLeads, leads, leadStatusFilter])

  // Counts for each campaign status tab, computed once per data change.
  const leadTabCounts = useMemo(() => {
    const source = selectedCampaignId ? campaignLeads : leads
    return {
      all: source.length,
      no_reply: source.filter(l => l.success !== false && !l.replied).length,
      replied: source.filter(l => l.replied && l.success !== false).length,
      favorites: source.filter(l => favorites.has(`lead:${l.accountId}:${l.chatId}`)).length,
    }
  }, [selectedCampaignId, campaignLeads, leads, favorites])

  // Export the currently-selected campaign leads as CSV (mirrors campaign/page.tsx exportCsv).
  const exportSelectedLeads = () => {
    const source = selectedCampaignId ? campaignLeads : leads
    const rows = source.filter(l => selectedChatIds.has(`${l.accountId}::${l.chatId}`))
    if (rows.length === 0) { toast.error('No leads selected'); return }
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ['target', 'account', 'campaign', 'sentAt', 'replied', 'replyMessages', 'lastReplyAt']
    const lines = [header.join(',')]
    for (const l of rows) {
      lines.push([
        esc(l.target), esc(l.accountLabel), esc(l.campaignName), esc(l.sentAt),
        esc(l.replied ? 'yes' : 'no'), esc(l.replyMessages ?? 0), esc(l.lastReplyAt ?? ''),
      ].join(','))
    }
    const BOM = '﻿'
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(rows[0]?.campaignName || 'campaign').replace(/[^a-z0-9]+/gi, '_')}_leads.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${rows.length} lead(s)`)
    setSelectedChatIds(new Set())
    setIsSelecting(false)
  }

  const selectedChatsForGroup = useMemo(() => {
    return displayConversations.filter(c => selectedChatIds.has(c.id))
  }, [displayConversations, selectedChatIds])

  // Set the filter label on the currently selected folder members, then reflect it locally.
  const applyFolderTagToSelected = async (tag: FolderFilterTag | null) => {
    if (!selectedFolderId || selectedChatsForGroup.length === 0) return
    const byAccount = new Map<string, string[]>()
    for (const c of selectedChatsForGroup) {
      const arr = byAccount.get(c.accountId)
      if (arr) arr.push(c.chatId)
      else byAccount.set(c.accountId, [c.chatId])
    }
    try {
      await Promise.all(
        Array.from(byAccount.entries()).map(([accountId, chatIds]) =>
          setFolderChatFilter(selectedFolderId, accountId, chatIds, tag),
        ),
      )
      const selectedIds = new Set(selectedChatsForGroup.map(c => c.id))
      setFolderConversations(prev =>
        prev.map(c => (selectedIds.has(c.id) ? { ...c, filterTag: tag } : c)),
      )
      toast.success(tag ? `Set ${selectedChatsForGroup.length} to ${tag}` : `Cleared filter on ${selectedChatsForGroup.length}`)
      setSelectedChatIds(new Set())
      setIsSelecting(false)
    } catch {
      toast.error('Failed to update filter')
    }
  }

  const selectedChatsArePeople = useMemo(() => {
    const selected = selectedChatsForGroup
    return selected.length > 0 && selected.every(c => c.isUser || c.isBot)
  }, [selectedChatsForGroup])

  const selectedChatsAreGroups = useMemo(() => {
    const selected = selectedChatsForGroup
    return selected.length > 0 && selected.some(c => c.isGroup || c.isChannel)
  }, [selectedChatsForGroup])

  const mergedChatsMap = useMemo(() => {
    const map = new Map<string, MessageConversation[]>()
    for (const item of displayConversations) {
      const accs = (item as any)._mergedAccounts as MessageConversation[] | undefined
      if (accs) {
        map.set(item.chatId, accs)
      }
    }
    return map
  }, [displayConversations])

  const loadConversations = useCallback(async (showSpinner = false, offset = 0, append = false) => {
    if (!append) {
      const container = leftScrollRef.current
      savedScrollTopRef.current = container?.scrollTop ?? 0
      if (container) {
        const items = container.querySelectorAll<HTMLElement>('[data-conv-id]')
        for (const el of items) {
          if (el.offsetTop + el.offsetHeight > container.scrollTop) {
            topConversationIdRef.current = el.dataset.convId ?? null
            break
          }
        }
      }
    } else {
      savedScrollTopRef.current = 0
      topConversationIdRef.current = null
    }
    if (showSpinner) { setIsLoadingList(true) }
    if (append) setIsLoadingMoreConversations(true)
    let payload: Awaited<ReturnType<typeof fetchMessages>> | null = null
    try {
      payload = await fetchMessages(CONVERSATION_PAGE_SIZE, offset, null)
      setErrors(payload.errors.filter((e: string) => !e.toLowerCase().includes('timed out')))
      setHasMoreConversations(payload.hasMore)
      setNextConversationsOffset(payload.nextOffset ?? null)
      if (payload.refreshing && !append) {
        refreshRetryRef.current = setTimeout(() => {
          loadConversations(false, 0, false)
        }, 2500)
      }

      const existingConversations = conversationsRef.current
      const freshConversations = payload?.conversations ?? []
      const hasPaginatedData = !append && offset === 0 && existingConversations.length > CONVERSATION_PAGE_SIZE
      const mergedConversations = append
        ? [
            ...existingConversations,
            ...freshConversations.filter(
              (item) => !existingConversations.some((existing) => existing.id === item.id)
            ),
          ]
        : hasPaginatedData
          ? [
              ...freshConversations,
              ...existingConversations.filter(
                (item) => !freshConversations.some((fresh) => fresh.id === item.id)
              ),
            ]
          : freshConversations

      // If an append page produced no new conversations, we've reached the real end of the
      // list. The backend's hasMore flag can stay true here (duplicates dropped above), so stop
      // paginating ourselves — otherwise the infinite-scroll footer spins forever as if more
      // chats are still loading.
      if (append && mergedConversations.length === existingConversations.length) {
        setHasMoreConversations(false)
        setNextConversationsOffset(null)
      }

      const newHash = mergedConversations.map(c => `${c.id}|${c.timestamp}|${c.lastMessage}|${c.draft || ''}|${c.unreadCount}`).join(',')
      if (!append && newHash === conversationsHashRef.current) {
        return
      }
      conversationsHashRef.current = newHash

       const currentMap: Record<string, string> = {}
       for (const conv of mergedConversations) {
         currentMap[conv.id] = `${conv.timestamp || ''}|${conv.lastMessage}|${conv.unreadCount}`
       }

       for (const conv of mergedConversations) {
         const prev = previousConversationMap.current[conv.id]
         const now = currentMap[conv.id]
          const isSelected = conv.id === selectedIdRef.current
           if (prev && prev !== now && !isSelected) {
             const accountId = conv.accountId
             const chatId = conv.chatId
              toast.custom((id) => (
                <div
                  onClick={() => {
                    toast.dismiss(id)
                    router.push(`/dashboard/unibox?account_id=${encodeURIComponent(accountId)}&chat_id=${encodeURIComponent(chatId)}`)
                  }}
                  className="cursor-pointer select-none bg-popover text-popover-foreground border border-border rounded-lg p-3 shadow-lg"
                >
                  <div className="text-sm font-medium">New message &bull; {conv.chatTitle}</div>
                  <div className="text-xs text-muted-foreground truncate">{conv.lastMessage}</div>
                </div>
              ), { position: 'top-right', duration: 5000 })
           }
       }

       previousConversationMap.current = currentMap
       setConversations(mergedConversations)
     } catch (err) {
       setError(err instanceof Error ? err.message : 'Failed to load conversations')
     } finally {
        if (!(payload?.refreshing && conversationsRef.current.length === 0)) {
          setIsLoadingList(false)
        }
        setIsLoadingMoreConversations(false)
      }
  }, [fetchMessages])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || isSelecting) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        if (hasMoreConversations && nextConversationsOffset !== null && !isLoadingMoreConversations) {
          loadConversations(false, nextConversationsOffset, true)
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMoreConversations, nextConversationsOffset, isLoadingMoreConversations, isSelecting, loadConversations])

  useEffect(() => {
    if (entityTypeFilter === 'all') {
      loadedForFilterRef.current = false
      return
    }
    if (filteredConversations.length > 0) {
      loadedForFilterRef.current = true
      return
    }
    if (hasMoreConversations && nextConversationsOffset !== null && !loadedForFilterRef.current) {
      loadedForFilterRef.current = true
      loadConversations(false, nextConversationsOffset, true)
    }
  }, [entityTypeFilter, filteredConversations.length, hasMoreConversations, nextConversationsOffset, loadConversations])

  const accountOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: Array<{ id: string; label: string }> = []
    for (const item of conversations) {
      if (seen.has(item.accountId)) continue
      seen.add(item.accountId)
      options.push({ id: item.accountId, label: item.accountLabel })
    }
    return options
  }, [conversations])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const loadThread = async (
    conversation: MessageConversation,
    showLoadingState = false,
    beforeId?: number,
    prepend = false
  ) => {
    if (showLoadingState) setIsLoadingThread(true)
    if (prepend) setIsLoadingOlderThread(true)

    try {
      const payload = await fetchThread(
        conversation.accountId,
        conversation.chatId,
        THREAD_PAGE_SIZE,
        beforeId
      )
      // Discard stale response if user already navigated away
      if (threadLoadIdRef.current !== conversation.id) return
      setHasMoreOlderThread(payload.items.length === THREAD_PAGE_SIZE)
      setThread((prev) => {
        if (!prepend) return payload.items
        if (payload.items.length === 0) return prev
        return [...payload.items, ...prev]
      })
      setThreadLoadedOnce(true)
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to load conversation thread')
    } finally {
      if (showLoadingState) setIsLoadingThread(false)
      if (prepend) setIsLoadingOlderThread(false)
    }
  }

  useEffect(() => {
    if (leftBarTab === 'campaigns') return
    setError(null)
    if (directConversationId) {
      setSelectedId(directConversationId)
      setIsLoadingList(false)
      deepLinkHandledRef.current = true
      return
    }
    setSelectedId(null)
    setSelectedFolderId(null)
    loadConversations(true, 0, false)
    let intervalId: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (intervalId) clearInterval(intervalId)
      intervalId = setInterval(() => {
        if (!document.hidden && conversationsRef.current.length <= 500 && !isSelecting) loadConversations(false, 0, false)
      }, 10000)
    }
    startPolling()
    const onVisibility = () => {
      if (document.hidden) {
        if (intervalId) clearInterval(intervalId)
        intervalId = null
      } else {
        startPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftBarTab, directConversationId])

  useEffect(() => {
    listCustomFolders().then(res => {
      setFolders(res.folders)
      const loaded = res.folders.find(f => f.id === selectedFolderId)
      if (!loaded) setSelectedFolderId(null)
    }).catch(() => toast.error('Failed to load folders'))
    listCampaigns().then(setCampaigns).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedFolderId) return
    const folderId = selectedFolderId
    const isDraftFolder = folders.find(f => f.id === folderId)?.folder_type === 'draft'
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    setIsLoadingFolder(true)
    setFolderConversations([])
    setFolderTagFilter('all')

    // Membership set (used for add/remove checkmarks elsewhere).
    listFolderChats(folderId).then(res => {
      if (cancelled) return
      setFolderChatMap(prev => {
        const next = new Map(prev)
        next.set(folderId, new Set(res.chats.map(e => `${e.account_id}::${e.chat_id}`)))
        return next
      })
    }).catch(() => toast.error('Failed to load folder chats'))

    // Draft folders are derived from the global conversation list, so there's nothing to resolve.
    if (isDraftFolder) {
      setIsLoadingFolder(false)
      return () => { cancelled = true }
    }

    // Resolve the folder's full membership (including members with no recent dialog).
    const loadFolderConvs = () => {
      fetchFolderConversations(folderId).then(res => {
        if (cancelled || folderId !== selectedFolderId) return
        setFolderConversations(res.conversations)
        // Server still warming the cache and nothing to show yet — keep the spinner and retry.
        if (res.refreshing && res.conversations.length === 0) {
          retryTimer = setTimeout(loadFolderConvs, 2500)
        } else {
          setIsLoadingFolder(false)
        }
      }).catch(() => {
        if (cancelled) return
        toast.error('Failed to load folder chats')
        setIsLoadingFolder(false)
      })
    }
    loadFolderConvs()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId])

  // Group-chat folders auto-populate from a background listener; poll their membership so
  // newly-added users appear without a manual refresh.
  useEffect(() => {
    if (!selectedFolderId) return
    const folder = folders.find(f => f.id === selectedFolderId)
    if (folder?.folder_type !== 'group_chat') return
    const timer = setInterval(() => {
      if (document.hidden) return
      listFolderChats(selectedFolderId).then(res => {
        setFolderChatMap(prev => {
          const next = new Map(prev)
          next.set(selectedFolderId, new Set(res.chats.map(e => `${e.account_id}::${e.chat_id}`)))
          return next
        })
      }).catch(() => {})
      fetchFolderConversations(selectedFolderId).then(res => {
        setFolderConversations(res.conversations)
      }).catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId, folders])

  // Reset selection whenever the campaign tab area changes.
  useEffect(() => {
    if (leftBarTab !== 'campaigns') return
    setSelectedId(null)
  }, [leftBarTab, selectedCampaignId])

  // Load lead data once per campaign/tab-area change. The status tabs
  // (all/no_reply/replied/favorites) are purely client-side filters over
  // this same dataset, so we deliberately DON'T re-fetch when leadStatusFilter changes —
  // re-fetching there briefly replaced corrected in-memory data with a stale DB read,
  // which flashed failed leads into the "Replied" tab.
  useEffect(() => {
    if (leftBarTab !== 'campaigns') return
    setIsLoadingLeads(true)
    setLeadsError(null)
    savedScrollTopRef.current = leftScrollRef.current?.scrollTop ?? 0
    if (selectedCampaignId) {
      // Load leads immediately from DB, then refresh reply stats in background
      fetchCampaignLeadsById(selectedCampaignId)
        .then((data) => setCampaignLeads(data))
        .catch((err) => setLeadsError(err instanceof Error ? err.message : 'Failed to load leads'))
        .finally(() => setIsLoadingLeads(false))
      Promise.allSettled([
        refreshCampaignReplyStats(selectedCampaignId),
        refreshCampaignSeenStats(selectedCampaignId),
      ])
        .then(() => fetchCampaignLeadsById(selectedCampaignId))
        .then((data) => { if (data.length) setCampaignLeads(data) })
        .catch(() => {})
    } else {
      fetchCampaignLeads()
        .then((data) => setLeads(data))
        .catch((err) => setLeadsError(err instanceof Error ? err.message : 'Failed to load leads'))
        .finally(() => setIsLoadingLeads(false))
    }
  }, [leftBarTab, selectedCampaignId, fetchCampaignLeads, fetchCampaignLeadsById, refreshCampaignReplyStats, refreshCampaignSeenStats])

  useEffect(() => {
    if (!selectedConversation) {
      setThread([])
      setThreadLoadedOnce(false)
      setThreadError(null)
      return
    }
    maxKnownIdRef.current = undefined
    setHasMoreOlderThread(true)
    setThreadLoadedOnce(false)
    setMarkedAsRead(false)
    setError(null)
    setThreadError(null)

    if (!selectedConversation.chatId) {
      setThread([])
      setThreadLoadedOnce(true)
      setIsLoadingThread(false)
      setThreadError('This message failed to send — no conversation was established.')
      return
    }

    threadLoadIdRef.current = selectedConversation.id
    loadThread(selectedConversation, true, undefined, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation?.id])

  useEffect(() => {
    if (deepLinkHandledRef.current) return
    if (!deepLinkAccountId || !deepLinkChatId) {
      deepLinkHandledRef.current = true
      return
    }
    if (conversations.length === 0) {
      // Wait for conversations to load — but mark handled so this runs only once per deep link
      return
    }
    const match = conversations.find(
      (item) => item.accountId === deepLinkAccountId && item.chatId === deepLinkChatId
    )
    if (!match) return
    setSelectedId(match.id)
    deepLinkHandledRef.current = true
  }, [conversations, deepLinkAccountId, deepLinkChatId])

  useEffect(() => {
    if (!selectedConversation || !selectedConversation.chatId) return
    const intervalId = setInterval(async () => {
      if (document.hidden) return
      try {
        const latest = await fetchThread(
          selectedConversation.accountId,
          selectedConversation.chatId,
          10,
          undefined,
          maxKnownIdRef.current
        )
        if (latest.items.length === 0) return
        setThread((prev) => {
          if (prev.length === 0) return latest.items
          const seen = new Set(prev.map((m) => m.id))
          const incoming = latest.items.filter((m) => !seen.has(m.id))
          if (incoming.length === 0) return prev
          const maxNewId = Math.max(...incoming.map(m => m.id))
          if (maxKnownIdRef.current === undefined || maxNewId > maxKnownIdRef.current) {
            maxKnownIdRef.current = maxNewId
          }
          const hasIncoming = incoming.some(m => !m.outgoing)
          if (hasIncoming) {
            try {
              if (!notificationAudioCtxRef.current) {
                notificationAudioCtxRef.current = new AudioContext()
              }
              const ctx = notificationAudioCtxRef.current
              const now = ctx.currentTime
              const osc1 = ctx.createOscillator()
              const gain1 = ctx.createGain()
              osc1.connect(gain1)
              gain1.connect(ctx.destination)
              osc1.type = 'sine'
              osc1.frequency.setValueAtTime(660, now)
              gain1.gain.setValueAtTime(0.3, now)
              gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
              osc1.start(now)
              osc1.stop(now + 0.15)
              const osc2 = ctx.createOscillator()
              const gain2 = ctx.createGain()
              osc2.connect(gain2)
              gain2.connect(ctx.destination)
              osc2.type = 'sine'
              osc2.frequency.setValueAtTime(880, now + 0.1)
              gain2.gain.setValueAtTime(0.3, now + 0.1)
              gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35)
              osc2.start(now + 0.1)
              osc2.stop(now + 0.35)
            } catch {}
          }
          return [...prev, ...incoming]
        })
      } catch {
      }
    }, 5000)
    return () => clearInterval(intervalId)
  }, [selectedConversation?.id, fetchThread])

  useEffect(() => {
    const container = threadContainerRef.current
    if (!container) return

    if (prependAnchorRef.current) {
      const { prevHeight, prevTop } = prependAnchorRef.current
      const delta = container.scrollHeight - prevHeight
      container.scrollTop = prevTop + delta
      prependAnchorRef.current = null
      return
    }

    if (shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [thread])

  useLayoutEffect(() => {
    const container = leftScrollRef.current
    if (!container) return
    if (topConversationIdRef.current) {
      const target = container.querySelector<HTMLElement>(`[data-conv-id="${topConversationIdRef.current}"]`)
      if (target) {
        target.scrollIntoView({ block: 'nearest' })
        topConversationIdRef.current = null
        return
      }
    }
    if (savedScrollTopRef.current > 0) {
      container.scrollTop = savedScrollTopRef.current
      savedScrollTopRef.current = 0
    }
  }, [conversations, leads])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(value), 250)
  }

  useEffect(() => {
    listGroupPresets().then(res => setPresets(res.presets)).catch(() => {})
  }, [listGroupPresets])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (refreshRetryRef.current) clearTimeout(refreshRetryRef.current)
    }
  }, [])

  const handleLeaveChatConfirm = async () => {
    if (!pendingLeaveChat) return
    setIsLeaving(true)
    setError(null)
    try {
      await leaveChat(pendingLeaveChat.accountId, pendingLeaveChat.chatId)
      toast.success('Left chat')
      const leftId = `${pendingLeaveChat.accountId}::${pendingLeaveChat.chatId}`
      setConversations((prev) => prev.filter((c) => c.id !== leftId))
      setSelectedId(null)
      setThread([])
      loadConversations(false, 0, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave chat')
      toast.error('Failed to leave chat')
    } finally {
      setIsLeaving(false)
      setPendingLeaveChat(null)
    }
  }

  const handleBatchLeaveConfirm = async () => {
    if (!pendingLeaveChats || pendingLeaveChats.length === 0) return
    setIsLeavingBatch(true)
    setError(null)
    try {
      const result = await batchLeaveChats(pendingLeaveChats)
      if (result.left > 0) {
        const leftIds = new Set(pendingLeaveChats.map(c => `${c.account_id}::${c.chat_id}`))
        setConversations((prev) => prev.filter((c) => !leftIds.has(c.id)))
        if (selectedId && leftIds.has(selectedId)) {
          setSelectedId(null)
          setThread([])
        }
        toast.success(`Left ${result.left} chat${result.left > 1 ? 's' : ''}`)
      }
      if (result.errors.length > 0) {
        toast.error(result.errors.slice(0, 3).join(', ') + (result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''))
      }
      loadConversations(false, 0, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave chats')
      toast.error('Failed to leave chats')
    } finally {
      setIsLeavingBatch(false)
      setPendingLeaveChats(null)
      setSelectedChatIds(new Set())
      setIsSelecting(false)
    }
  }

  const handleDeleteChatConfirm = async () => {
    if (!pendingDeleteChat) return
    setIsDeleting(true)
    try {
      await leaveChat(pendingDeleteChat.accountId, pendingDeleteChat.chatId)
      toast.success('Chat deleted')
      const deletedId = `${pendingDeleteChat.accountId}::${pendingDeleteChat.chatId}`
      setConversations((prev) => prev.filter((c) => c.id !== deletedId))
      if (selectedId === deletedId) {
        setSelectedId(null)
        setThread([])
      }
      loadConversations(false, 0, false)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete chat')
    } finally {
      setIsDeleting(false)
      setPendingDeleteChat(null)
    }
  }

  const handleSend = async () => {
    if (!selectedConversation) return
    const clean = composer.trim()
    if (!clean && !selectedFile) return

    setIsSending(true)
    setError(null)
    try {
      shouldStickToBottomRef.current = true
      const sent = selectedFile
        ? await sendFileMessage(
            selectedConversation.accountId,
            selectedConversation.chatId,
            selectedFile,
            clean
          )
        : await sendMessage(
            selectedConversation.accountId,
            selectedConversation.chatId,
            clean
          )
      setThread((prev) => [...prev, sent])
      if (sent.id > (maxKnownIdRef.current ?? 0)) {
        maxKnownIdRef.current = sent.id
      }
      setComposer('')
      setSelectedFile(null)
      // Auto-mark as conversation if sending a reply to a campaign lead
      if (selectedId?.startsWith('lead:')) {
        const lead = leads.find(l => `lead:${l.accountId}:${l.chatId}` === selectedId)
        if (lead && lead.campaignId && lead.accountId && lead.chatId) {
          markConversation({ campaign_id: lead.campaignId, account_id: lead.accountId, chat_id: lead.chatId, target: lead.target }).catch(() => {})
        }
      }
      await loadConversations(false, 0, false)
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  const loadStoredMessages = useCallback(async () => {
    try {
      const res = await listStoredMessages()
      setStoredMessages(res.messages)
    } catch {
      // silently fail
    }
  }, [listStoredMessages])

  const handleStoredMessageClick = async (msg: StoredMessage) => {
    if (!selectedConversation) return
    setStoredPopoverOpen(false)
    if (msg.type === 'text') {
      setComposer((prev) => (prev ? prev + '\n' : '') + msg.content)
      return
    }
    setSendingStoredId(msg.id)
    try {
      const resp = await fetch(getStoredMessageFileUrl(msg.id))
      const blob = await resp.blob()
      const file = new File([blob], msg.fileName || msg.content, { type: msg.fileMimeType || undefined })
      shouldStickToBottomRef.current = true
      const sent = await sendFileMessage(selectedConversation.accountId, selectedConversation.chatId, file, '')
      setThread((prev) => [...prev, sent])
      if (sent.id > (maxKnownIdRef.current ?? 0)) {
        maxKnownIdRef.current = sent.id
      }
      await loadConversations(false, 0, false)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send stored file')
    } finally {
      setSendingStoredId(null)
    }
  }

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="flex-1 flex overflow-hidden">
          {/* Inner Left Bar — Folders + Accounts */}
          <div className="hidden lg:flex w-[180px] border-r border-slate-800 flex-col shrink-0">
            <div className="p-2 space-y-1 overflow-y-auto min-h-0 flex-1">
              <button
                onClick={() => { setLeftBarTab('inbox'); setSelectedFolderId(null) }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                  leftBarTab === 'inbox' && !selectedFolderId
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Folder className="w-4 h-4" />
                All Chats
              </button>
              {folders.map((f) => {
                const active = leftBarTab === 'inbox' && selectedFolderId === f.id
                return (
                  <div key={f.id} className="group flex items-center">
                    <button
                      onClick={() => { setLeftBarTab('inbox'); setSelectedFolderId(f.id) }}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {f.folder_type === 'draft' ? <FileEdit className="w-4 h-4 shrink-0" /> : f.folder_type === 'group_chat' ? <Users className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0" />}
                      <span className="truncate">{f.name}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="opacity-60 group-hover:opacity-100 shrink-0 p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[120px]">
                        <DropdownMenuItem onClick={() => { setRenameFolderId(f.id); setRenameFolderName(f.name); setRenameFolderType(f.folder_type === 'draft' ? 'draft' : f.folder_type === 'group_chat' ? 'group_chat' : 'standard'); setRenameFolderDraftText(f.draft_text || '') }}>
                          <Edit3 className="w-3.5 h-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleteFolderId(f.id)} className="text-rose-400">
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
              <button
                onClick={() => setShowCreateFolder(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Plus className="w-4 h-4" />
                New Folder
              </button>
              <div className="border-t border-slate-700 my-1" />
              <p className="text-[11px] text-slate-500 px-3 py-1 font-medium uppercase tracking-wider">
                Campaigns
              </p>
              {campaigns.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-500">No campaigns</p>
              ) : (
                campaigns.map((c) => {
                  const active = leftBarTab === 'campaigns' && selectedCampaignId === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setLeftBarTab('campaigns'); setSelectedCampaignId(c.id); setSelectedFolderId(null); setLeadStatusFilter('all') }}
                      className={`w-full flex flex-col items-start gap-0 px-3 py-2 rounded-md text-sm font-medium transition ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate text-sm">{c.name}</span>
                      <span className="text-[11px] opacity-60">
                        {c.sentCount ?? 0} sent · {c.seenCount ?? 0} seen · {c.repliedCount ?? 0} replied
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="border-t border-slate-800 flex flex-col min-h-0 flex-1">
              <p className="text-[11px] text-slate-500 px-3 pt-3 pb-1 font-medium uppercase tracking-wider shrink-0">
                Accounts
              </p>
              <div className="overflow-y-auto px-2 pb-2 space-y-0.5">
                <button
                  onClick={() => setSelectedAccountIds(new Set())}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    selectedAccountIds.size === 0
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  All
                </button>
                {accountOptions.map((acc) => {
                  const active = selectedAccountIds.has(acc.id)
                  return (
                    <button
                      key={acc.id}
                      onClick={() => {
                        setSelectedAccountIds(new Set([acc.id]))
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-medium truncate transition ${
                        active
                          ? 'bg-blue-600/20 text-blue-300'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {acc.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Conversations / Leads List */}
          <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} lg:max-w-[340px] w-full border-r border-slate-800 flex-col`}>
            {/* Toolbar */}
            <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
              {isSelecting ? (
                <>
                  <span className="text-xs text-slate-400 shrink-0">{selectedChatIds.size} selected</span>
                  <div className="flex-1" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="border-slate-700 hover:bg-slate-800 shrink-0 px-2 h-8 text-xs" disabled={selectedChatIds.size === 0}>
                        <ListChecks className="w-3.5 h-3.5 mr-1" /> Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      <DropdownMenuLabel className="text-xs text-slate-400 font-medium">Move to folder</DropdownMenuLabel>
                      {folders.length > 0 ? (
                        assignableFolders.map(f => (
                          <DropdownMenuItem key={f.id} onClick={async () => {
                            try {
                              const chats = Array.from(selectedChatIds).map(id => {
                                const [a, c] = id.split('::')
                                return { account_id: a, chat_id: c }
                              })
                              await batchMoveChatsToFolder(f.id, selectedFolderId, chats)
                              if (selectedFolderId) {
                                const res = await listFolderChats(selectedFolderId)
                                setFolderChatMap(prev => {
                                  const next = new Map(prev)
                                  next.set(selectedFolderId, new Set(res.chats.map(e => `${e.account_id}::${e.chat_id}`)))
                                  return next
                                })
                              }
                              setSelectedChatIds(new Set())
                              setIsSelecting(false)
                              toast.success(`Moved ${chats.length} chats to ${f.name}`)
                            } catch { toast.error('Failed to move chats') }
                          }}>
                            <Folder className="w-3.5 h-3.5 mr-2" /> {f.name}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>No folders</DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={!selectedChatsArePeople} onClick={() => setShowCreateGroup(true)} title={!selectedChatsArePeople ? 'Only users and bots can be added to a group' : ''}>
                        <Users className="w-3.5 h-3.5 mr-2" /> Create Group
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!selectedChatsArePeople} onClick={async () => {
                        const items = Array.from(selectedChatIds).map(id => {
                          const [a, c] = id.split('::')
                          return { account_id: a, chat_id: c }
                        })
                        try {
                          const result = await batchBlockUsers(items)
                          toast.success(`Blocked ${result.blocked} user(s)`)
                          if (result.errors.length > 0) {
                            toast.error(result.errors.slice(0, 3).join(', ') + (result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''))
                          }
                        } catch (err: any) {
                          toast.error(err?.message || 'Failed to block users')
                        }
                      }} title={!selectedChatsArePeople ? 'Only users can be blocked' : ''}>
                        <Ban className="w-3.5 h-3.5 mr-2" /> Block
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={selectedChatIds.size === 0} onClick={() => {
                        const chats = Array.from(selectedChatIds).map(id => {
                          const [a, c] = id.split('::')
                          return { account_id: a, chat_id: c }
                        })
                        setPendingLeaveChats(chats)
                      }}>
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                      {leftBarTab === 'campaigns' && (
                        <DropdownMenuItem disabled={selectedChatIds.size === 0} onClick={exportSelectedLeads}>
                          <FileText className="w-3.5 h-3.5 mr-2" /> Export CSV
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" className="shrink-0 h-8 text-xs text-slate-400" onClick={() => { setSelectedChatIds(new Set()); setIsSelecting(false) }}>Cancel</Button>
                </>
              ) : (
                <>
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      value={searchInput}
                      onChange={handleSearchChange}
                      placeholder="Search..."
                      className="pl-9 bg-slate-900 border-slate-700 h-8 text-sm"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 hover:bg-slate-800 shrink-0 px-2"
                    onClick={async () => {
                      if (leftBarTab === 'campaigns') {
                        setIsRefreshingReplies(true)
                        try {
                          const campaigns = await listCampaigns()
                          for (const c of campaigns) {
                            if (c.status === 'running' || c.status === 'completed') {
                              try { await refreshCampaignReplyStats(c.id) } catch {}
                            }
                          }
                          savedScrollTopRef.current = leftScrollRef.current?.scrollTop ?? 0
                          const data = await fetchCampaignLeads()
                          setLeads(data)
                        } catch {}
                        setIsRefreshingReplies(false)
                      } else {
                        loadConversations(true, 0, false)
                      }
                    }}
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingList || isRefreshingReplies ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="sm" className="shrink-0 h-8 px-2 text-xs text-slate-400" onClick={() => setIsSelecting(true)}>
                    Select
                  </Button>
                </>
              )}
            </div>

            {error && (
              <div className="mx-3 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {errors.length > 0 && (
              <div className="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200 space-y-1">
                {errors.map((msg, idx) => (
                  <p key={`${msg}-${idx}`}>{msg}</p>
                ))}
              </div>
            )}

            {leftBarTab === 'inbox' && !isLoadingList && conversations.length > 0 && (
              <div className="relative overflow-hidden border-b border-slate-800 shrink-0">
                <div className="flex gap-1 px-3 py-2 overflow-x-auto pb-[20px] mb-[-20px]">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'users', label: 'People', icon: UserRound },
                  { key: 'groups', label: 'Groups', icon: Users },
                  { key: 'channels', label: 'Channels', icon: Volume2 },
                  { key: 'bots', label: 'Bots', icon: Bot },
                  { key: 'drafts', label: 'Drafts', icon: Edit3 },
                ].map(({ key, label, icon: Icon }) => {
                  const count = key === 'all'
                    ? entityTypeCounts.allCount
                    : key === 'drafts' ? entityTypeCounts.drafts
                    : key === 'users' ? entityTypeCounts.users
                    : key === 'groups' ? entityTypeCounts.groups
                    : key === 'channels' ? entityTypeCounts.channels
                    : entityTypeCounts.bots
                  return (
                    <button
                      key={key}
                      onClick={() => setEntityTypeFilter(key as typeof entityTypeFilter)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                        entityTypeFilter === key
                          ? 'bg-blue-600/20 text-blue-300'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {Icon && <Icon className="w-3.5 h-3.5" />}
                      {label}
                      <span className="text-[11px] opacity-60">({count})</span>
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {leftBarTab === 'inbox' && selectedFolderId
              && folders.find(f => f.id === selectedFolderId)?.folder_type !== 'draft'
              && folderConversations.length > 0 && (
              <div className="border-b border-slate-800 shrink-0 overflow-x-auto">
                <div className="flex items-center gap-1 px-3 py-2 min-w-max">
                  {([{ key: 'all' as const, label: 'All', dot: '' }, ...FOLDER_FILTER_TAGS, { key: 'untagged' as const, label: 'Untagged', dot: '' }]).map(({ key, label, dot }) => {
                    const count = folderTagCounts[key]
                    const active = folderTagFilter === key
                    return (
                      <button
                        key={key}
                        onClick={() => setFolderTagFilter(key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                          active ? 'bg-blue-600/20 text-blue-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
                        {label}
                        <span className="text-[11px] opacity-60">({count})</span>
                      </button>
                    )
                  })}
                  {isSelecting && selectedChatIds.size > 0 && (
                    <span className="ml-2 pl-2 border-l border-slate-700 inline-flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">Tag {selectedChatIds.size}:</span>
                      {FOLDER_FILTER_TAGS.map(t => (
                        <button
                          key={t.key}
                          title={`Set ${t.label}`}
                          onClick={() => applyFolderTagToSelected(t.key)}
                          className={`w-3.5 h-3.5 rounded-full ${t.dot} opacity-60 hover:opacity-100 transition`}
                        />
                      ))}
                      <button
                        onClick={() => applyFolderTagToSelected(null)}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Clear
                      </button>
                    </span>
                  )}
                </div>
              </div>
            )}
            <div ref={leftScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
              {leftBarTab === 'campaigns' && (
                <div className="flex gap-1 px-3 py-2 border-b border-slate-800 overflow-x-auto">
                  {([{key:'all',label:'All'},{key:'no_reply',label:'No reply'},{key:'replied',label:'Replied'},{key:'favorites',label:'⭐ Favorites'}] as const).map(({key,label}) => {
                    const count = key === 'favorites' ? leadTabCounts.favorites
                      : key === 'replied' ? leadTabCounts.replied
                      : key === 'no_reply' ? leadTabCounts.no_reply
                      : leadTabCounts.all
                    return (
                      <button
                        key={key}
                        onClick={() => setLeadStatusFilter(key)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                          leadStatusFilter === key
                            ? 'bg-blue-600/20 text-blue-300'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        {label}
                        <span className="ml-1 text-[11px] opacity-60">({count})</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {leftBarTab === 'campaigns' ? (
                <>
                  {isLoadingLeads ? (
                    <div className="p-6"><BrandedLoader label="Loading leads" /></div>
                  ) : leadsError ? (
                    <div className="m-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{leadsError}</div>
                  ) : (selectedCampaignId ? campaignLeads : leads).length === 0 ? (
                    <div className="p-4 text-xs text-slate-400">No campaign leads yet.</div>
                  ) : (
                    <div className="divide-y divide-slate-800">
                      {filteredLeads.map((lead, idx) => {
                      const leadId = `lead:${lead.accountId}:${lead.chatId}`
                      const sel = `${lead.accountId}::${lead.chatId}`
                      const selectable = isSelecting && !!lead.chatId
                      const isChecked = selectedChatIds.has(sel)
                      const active = leadId === selectedId
                      const isFav = favorites.has(leadId)
                      return (
                        <button
                          key={leadId}
                          onClick={(e) => {
                            if (selectable) {
                              if (e.shiftKey && lastClickedIdxRef.current !== null) {
                                const [start, end] = lastClickedIdxRef.current < idx
                                  ? [lastClickedIdxRef.current, idx]
                                  : [idx, lastClickedIdxRef.current]
                                const rangeIds = filteredLeads.slice(start, end + 1)
                                  .filter(l => !!l.chatId)
                                  .map(l => `${l.accountId}::${l.chatId}`)
                                setSelectedChatIds(prev => {
                                  const next = new Set(prev)
                                  for (const id of rangeIds) next.add(id)
                                  return next
                                })
                              } else {
                                lastClickedIdxRef.current = idx
                                setSelectedChatIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(sel)) next.delete(sel)
                                  else next.add(sel)
                                  return next
                                })
                              }
                            } else {
                              setSelectedId(leadId)
                            }
                          }}
                          className={`w-full text-left px-3 py-3 transition ${
                            active ? 'bg-blue-500/15' : 'hover:bg-slate-800/50'
                          } ${isChecked ? 'bg-blue-500/10' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-start gap-2">
                              {selectable && (
                                <div className={`w-4 h-4 mt-0.5 rounded border-2 shrink-0 flex items-center justify-center transition ${isChecked ? 'bg-blue-500 border-blue-500' : 'border-slate-500'}`}>
                                  {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                                </div>
                              )}
                              <div className="min-w-0">
                              <p className="font-semibold truncate text-sm flex items-center gap-1.5">
                                {lead.target}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setFavorites(prev => {
                                    const next = new Set(prev)
                                    if (next.has(leadId)) next.delete(leadId); else next.add(leadId)
                                    localStorage.setItem('unibox_favorites', JSON.stringify([...next]))
                                    return next
                                  }) }}
                                  className="shrink-0"
                                >
                                  <Star size={14} className={isFav ? 'fill-yellow-400 text-yellow-400' : 'text-slate-600 hover:text-slate-400'} />
                                </button>
                              </p>
                              <p className="text-xs text-slate-400 truncate">
                                Campaign: {lead.campaignName}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-1 truncate">
                                {lead.accountLabel}
                              </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] text-slate-500">{formatTime(lead.sentAt)}</p>
                              {lead.seen ? (
                                <span className="inline-flex mt-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300">
                                  Seen
                                </span>
                              ) : null}
                              {lead.success === false ? (
                                <span className="inline-flex mt-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
                                  Failed
                                </span>
                              ) : lead.replied ? (
                                <span className="inline-flex mt-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                                  Replied{lead.replyMessages ? ` (${lead.replyMessages})` : ''}
                                </span>
                              ) : (
                                <span className="inline-flex mt-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                                  No reply
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  )}
                </>
              ) : isLoadingList ? (
                <div className="p-6">
                  <BrandedLoader label="Loading chats" />
                </div>
              ) : isLoadingFolder ? (
                <div className="p-6">
                  <BrandedLoader label="Loading folder" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">No chats found.</div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {displayConversations.map((conv, idx) => {
                    const isMerged = (conv as any)._mergedAccounts
                    const mergedAccounts = isMerged ? (conv as any)._mergedAccounts as MessageConversation[] : null
                    const active = conv.id === selectedId
                    const inFolder = selectedFolderId
                      ? mergedAccounts
                        ? mergedAccounts.some(e => folderChatMap.get(selectedFolderId)?.has(e.id))
                        : folderChatMap.get(selectedFolderId)?.has(conv.id)
                      : false
                    const isChecked = !mergedAccounts && selectedChatIds.has(conv.id)
                    return (
                      <div key={mergedAccounts ? `merged::${conv.chatId}` : conv.id} data-conv-id={conv.id} className="group relative">
                         <button
                           onClick={(e) => {
                            if (isSelecting) {
                              if (e.shiftKey && lastClickedIdxRef.current !== null) {
                                const [start, end] = lastClickedIdxRef.current < idx
                                  ? [lastClickedIdxRef.current, idx]
                                  : [idx, lastClickedIdxRef.current]
                                const rangeIds = displayConversations.slice(start, end + 1).map(c => c.id)
                                setSelectedChatIds(prev => {
                                  const next = new Set(prev)
                                  for (const id of rangeIds) next.add(id)
                                  return next
                                })
                              } else {
                                lastClickedIdxRef.current = idx
                                setSelectedChatIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(conv.id)) next.delete(conv.id)
                                  else next.add(conv.id)
                                  return next
                                })
                              }
                            } else {
                              setSelectedId(conv.id)
                            }
                          }}
                          className={`w-full text-left px-3 py-3 transition ${
                            active ? 'bg-blue-500/15' : 'hover:bg-slate-800/50'
                          } ${isChecked ? 'bg-blue-500/10' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              {isSelecting && !mergedAccounts && (
                                <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition ${isChecked ? 'bg-blue-500 border-blue-500' : 'border-slate-500'}`}>
                                  {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                                </div>
                              )}
                              <ConversationAvatar
                                accountId={conv.accountId}
                                chatId={conv.chatId}
                                title={conv.chatTitle}
                                hasPhoto={conv.chatPhoto}
                                isBot={conv.isBot}
                                isChannel={conv.isChannel}
                                isGroup={conv.isGroup}
                                color={accountColor(conv.chatId)}
                                photoUrl={getConversationPhotoUrl}
                              />
                              <div className="min-w-0 space-y-1">
                                <p className="font-semibold truncate text-sm flex items-center gap-1.5">
                                  {conv.isBot ? (
                                    <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                  ) : conv.isChannel ? (
                                    <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  ) : conv.isGroup ? (
                                    <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  ) : (
                                    <UserRound className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                  )}
                                  {conv.chatTitle}
                                  {selectedFolderId && conv.filterTag && (() => {
                                    const t = FOLDER_FILTER_TAGS.find(x => x.key === conv.filterTag)
                                    return t ? <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} title={t.label} /> : null
                                  })()}
                                  {mergedAccounts ? (
                                    <span className="font-normal text-[10px] text-slate-400 ml-auto">
                                      {mergedAccounts.length} accounts
                                    </span>
                                  ) : (
                                    <span className="font-normal text-xs" style={{ color: accountColor(conv.accountId) }}>
                                      ({conv.accountLabel})
                                    </span>
                                  )}
                                </p>
                                {conv.draft ? (
                                  <p className="text-xs text-amber-400/80 truncate italic">
                                    <span className="font-medium not-italic text-amber-400">Draft: </span>
                                    {conv.draft}
                                  </p>
                                ) : (
                                  <p className="text-xs text-slate-400 truncate">
                                    {conv.lastSenderName ? (
                                      <span className="text-slate-300">{conv.lastMessageOutgoing ? 'You' : conv.lastSenderName}: </span>
                                    ) : null}
                                    {conv.lastMessage}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex flex-col items-end min-h-0">
                              <p className="text-[11px] text-slate-500">{formatTime(conv.timestamp)}</p>
                              {conv.unreadCount > 0 && (
                                <span className="inline-flex mt-1.5 rounded-xl bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold leading-none">
                                  {conv.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        {!mergedAccounts && (
                        <div className="absolute top-2 right-1 opacity-0 group-hover:opacity-100 transition">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[140px]">
                              {selectedFolderId && (
                                <>
                                  <DropdownMenuLabel className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">
                                    Set filter
                                  </DropdownMenuLabel>
                                  {FOLDER_FILTER_TAGS.map(t => {
                                    const active = conv.filterTag === t.key
                                    return (
                                      <DropdownMenuItem key={t.key} onClick={async () => {
                                        try {
                                          await setFolderChatFilter(selectedFolderId, conv.accountId, [conv.chatId], t.key)
                                          setFolderConversations(prev => prev.map(c => c.id === conv.id ? { ...c, filterTag: t.key } : c))
                                          toast.success(`Set ${t.label}`)
                                        } catch { toast.error('Failed to update filter') }
                                      }}>
                                        <span className={`w-2.5 h-2.5 rounded-full mr-2 shrink-0 ${t.dot}`} />
                                        {t.label}
                                        {active && <Check className="w-3.5 h-3.5 ml-auto text-blue-400" />}
                                      </DropdownMenuItem>
                                    )
                                  })}
                                  {conv.filterTag && (
                                    <DropdownMenuItem onClick={async () => {
                                      try {
                                        await setFolderChatFilter(selectedFolderId, conv.accountId, [conv.chatId], null)
                                        setFolderConversations(prev => prev.map(c => c.id === conv.id ? { ...c, filterTag: null } : c))
                                        toast.success('Cleared filter')
                                      } catch { toast.error('Failed to update filter') }
                                    }} className="text-slate-400">
                                      Clear filter
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {assignableFolders.length > 0 ? (
                                assignableFolders.map(f => (
                                  <DropdownMenuItem key={f.id} onClick={async () => {
                                    try {
                                      await addChatToFolder(f.id, conv.accountId, conv.chatId)
                                      if (selectedFolderId) {
                                        await removeChatFromFolder(selectedFolderId, conv.accountId, conv.chatId)
                                      }
                                      const res = await listFolderChats(f.id)
                                      setFolderChatMap(prev => {
                                        const next = new Map(prev)
                                        next.set(f.id, new Set(res.chats.map(e => `${e.account_id}::${e.chat_id}`)))
                                        if (selectedFolderId) {
                                          const src = next.get(selectedFolderId)
                                          if (src) {
                                            src.delete(conv.id)
                                            next.set(selectedFolderId, src)
                                          }
                                        }
                                        return next
                                      })
                                      toast.success(`Moved to ${f.name}`)
                                    } catch { toast.error('Failed to move chat') }
                                  }}>
                                    <Folder className="w-3.5 h-3.5 mr-2" />
                                    Move to {f.name}
                                  </DropdownMenuItem>
                                ))
                              ) : (
                                <DropdownMenuItem disabled>No other folders</DropdownMenuItem>
                              )}
                              {!inFolder && selectedFolderId && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={async () => {
                                    try {
                                      await removeChatFromFolder(selectedFolderId, conv.accountId, conv.chatId)
                                      const res = await listFolderChats(selectedFolderId)
                                      setFolderChatMap(prev => {
                                        const next = new Map(prev)
                                        next.set(selectedFolderId, new Set(res.chats.map(e => `${e.account_id}::${e.chat_id}`)))
                                        return next
                                      })
                                      toast.success('Removed from folder')
                                    } catch { toast.error('Failed to remove') }
                                  }} className="text-rose-400">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Remove from folder
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(conv.isUser || conv.isBot) ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => {
                                    setQuickGroupUser({
                                      id: conv.id,
                                      accountId: conv.accountId,
                                      chatId: conv.chatId,
                                      chatTitle: conv.chatTitle,
                                      username: conv.chatUsername,
                                    })
                                    setShowCreateGroup(true)
                                  }}>
                                    <Users className="w-3.5 h-3.5 mr-2" /> Create Group
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={async () => {
                                    try {
                                      await blockUser(conv.accountId, conv.chatId)
                                      toast.success('User blocked')
                                    } catch (err: any) {
                                      toast.error(err?.message || 'Failed to block user')
                                    }
                                  }}>
                                    <Ban className="w-3.5 h-3.5 mr-2" /> Block
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setPendingDeleteChat({ accountId: conv.accountId, chatId: conv.chatId })}
                                    className="text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Chat
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {leftBarTab !== 'campaigns' && !isLoadingList && hasMoreConversations && (
                <div className="p-3 border-t border-slate-800">
                  {isSelecting ? (
                    <div className="flex justify-center py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-700 hover:bg-slate-800 text-xs"
                        disabled={isLoadingMoreConversations}
                        onClick={() => loadConversations(false, nextConversationsOffset ?? 0, true)}
                      >
                        {isLoadingMoreConversations ? <Spinner className="w-3 h-3 mr-2" /> : null}
                        Load more
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div ref={sentinelRef} className="h-4" />
                      {isLoadingMoreConversations && (
                        <div className="flex justify-center py-2">
                          <Spinner className="w-4 h-4" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Message Thread */}
          <div className={`${selectedId ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0`}>
            <div className="border-b border-slate-800 px-3 sm:px-4 py-3 shrink-0 flex items-center gap-2">
              <button
                onClick={() => setSelectedId(null)}
                className="lg:hidden inline-flex items-center justify-center h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              {selectedConversation ? (() => {
                const mergedForSelected = mergedChatsMap.get(selectedConversation.chatId)
                return (
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  <ConversationAvatar
                    accountId={selectedConversation.accountId}
                    chatId={selectedConversation.chatId}
                    title={selectedConversation.chatTitle}
                    hasPhoto={selectedConversation.chatPhoto}
                    isBot={selectedConversation.isBot}
                    isChannel={selectedConversation.isChannel}
                    isGroup={selectedConversation.isGroup}
                    color={accountColor(selectedConversation.chatId)}
                    photoUrl={getConversationPhotoUrl}
                  />
                  <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm sm:text-base truncate">{selectedConversation.chatTitle}</p>
                  <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                    {mergedForSelected ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-1.5 hover:text-slate-200 transition">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accountColor(selectedConversation.accountId) }} />
                            {selectedConversation.accountLabel}
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[160px]">
                          {mergedForSelected.map(a => (
                            <DropdownMenuItem key={a.id} onClick={() => setSelectedId(a.id)}>
                              <span className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ backgroundColor: accountColor(a.accountId) }} />
                              {a.accountLabel}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accountColor(selectedConversation.accountId) }} />
                        {selectedConversation.accountLabel}
                      </span>
                    )}
                    {selectedConversation.chatUsername
                      ? ` • @${selectedConversation.chatUsername}`
                      : ''}
                  </p>
                  </div>
                </div>
                )
              })() : (
                <p className="text-slate-400 text-sm">Select a conversation</p>
              )}
              {selectedConversation && !selectedConversation.isGroup && !selectedConversation.isChannel && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-slate-400 hover:text-white hover:bg-slate-800 shrink-0 h-8 w-8 flex items-center justify-center rounded-md">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem onClick={() => {
                      setQuickGroupUser({
                        id: selectedConversation.id,
                        accountId: selectedConversation.accountId,
                        chatId: selectedConversation.chatId,
                        chatTitle: selectedConversation.chatTitle,
                        username: selectedConversation.chatUsername,
                      })
                      setShowCreateGroup(true)
                    }}>
                      <Users className="w-3.5 h-3.5 mr-2" /> Create Group
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => {
                      try {
                        await blockUser(selectedConversation.accountId, selectedConversation.chatId)
                        toast.success('User blocked')
                      } catch (err: any) {
                        toast.error(err?.message || 'Failed to block user')
                      }
                    }}>
                      <Ban className="w-3.5 h-3.5 mr-2" /> Block
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setPendingDeleteChat({
                        accountId: selectedConversation.accountId,
                        chatId: selectedConversation.chatId,
                      })}
                      className="text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Chat
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {selectedConversation && (selectedConversation.isGroup || selectedConversation.isChannel) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 shrink-0 h-8 w-8 p-0"
                  onClick={() => setPendingLeaveChat({
                    accountId: selectedConversation.accountId,
                    chatId: selectedConversation.chatId,
                  })}
                  disabled={isLeaving}
                  title={`Leave ${selectedConversation.isChannel ? 'channel' : 'group'}`}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div
              ref={threadContainerRef}
              className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
              onScroll={(e) => {
                const el = e.currentTarget
                const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                shouldStickToBottomRef.current = distanceToBottom < 80

                if (
                  el.scrollTop < 40 &&
                  selectedConversation &&
                  thread.length > 0 &&
                  hasMoreOlderThread &&
                  !isLoadingOlderThread &&
                  !isLoadingThread
                ) {
                  prependAnchorRef.current = {
                    prevHeight: el.scrollHeight,
                    prevTop: el.scrollTop,
                  }
                  loadThread(selectedConversation, false, thread[0].id, true)
                }
              }}
            >
              {!selectedConversation ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-4">
                  <MessageSquare className="w-12 h-12 text-slate-600" />
                  <p className="text-sm text-center">Select a conversation to start messaging</p>
                </div>
              ) : isLoadingThread && !threadLoadedOnce ? (
                <div className="h-full flex items-center justify-center text-slate-400">
                  <BrandedLoader label="Loading conversation" />
                </div>
              ) : threadError && thread.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
                  <div className="rounded-full bg-rose-500/10 p-4">
                    <MessageSquare className="w-8 h-8 text-rose-400" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-200">Message not delivered</p>
                    <p className="text-xs text-slate-400">{threadError}</p>
                    {selectedLeadError && (
                      <p className="text-xs text-slate-500 mt-2 italic">{selectedLeadError}</p>
                    )}
                  </div>
                </div>
              ) : thread.length === 0 ? (
                <div className="text-slate-400 text-sm">No messages yet.</div>
              ) : (
                <>
                  {isLoadingOlderThread && (
                    <div className="text-center text-xs text-slate-400 py-2">
                      <Spinner className="inline mr-1 w-3 h-3" /> Loading older messages...
                    </div>
                  )}
                  {thread.map((msg) => (
                    <MessageBubble
                      key={`${msg.id}-${msg.timestamp}`}
                      msg={msg}
                      fetchMessageMediaUrl={fetchMessageMediaUrl}
                      isRead={msg.outgoing && markedAsRead}
                      onForward={setForwardMsg}
                    />
                  ))}
                </>
              )}
            </div>

            <div className="border-t border-slate-800 p-3">
              {threadError && thread.length > 0 && (
                <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                  {threadError}
                </div>
              )}
              {selectedFile && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200">
                  {selectedFile.type.startsWith('image/') ? (
                    <ImageIcon className="w-4 h-4" />
                  ) : selectedFile.type.startsWith('video/') ? (
                    <Video className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  <span className="truncate max-w-[340px]">{selectedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-slate-400 hover:text-white"
                    disabled={isSending}
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="inline-flex">
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => { setSelectedFile(e.target.files?.[0] || null); e.target.value = '' }}
                    disabled={!selectedConversation || isSending}
                  />
                  <span className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800">
                    <Paperclip className="w-4 h-4" />
                  </span>
                </label>
                <Popover open={storedPopoverOpen} onOpenChange={(open) => { setStoredPopoverOpen(open); if (open) loadStoredMessages() }}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!selectedConversation || isSending}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40"
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-1 bg-slate-900 border-slate-700">
                    <div className="max-h-72 overflow-y-auto">
                      {storedMessages.length === 0 ? (
                        <p className="text-gray-500 text-xs text-center py-4">No stored messages</p>
                      ) : (
                        storedMessages.map((msg) => (
                          <button
                            key={msg.id}
                            onClick={() => handleStoredMessageClick(msg)}
                            disabled={sendingStoredId === msg.id}
                            className="w-full text-left px-2 py-2 rounded hover:bg-slate-800 flex items-start gap-2 disabled:opacity-50"
                          >
                            {msg.type === 'text' ? (
                              <FileText className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                            ) : msg.type === 'photo' ? (
                              <ImageIcon className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                            ) : (
                              <Paperclip className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs text-gray-200 truncate">
                                {msg.type === 'text' ? msg.content : msg.fileName || msg.content}
                              </p>
                              <p className="text-[10px] text-gray-500">
                                {msg.type === 'text' ? 'Text' : msg.type === 'photo' ? 'Photo' : 'File'} · {new Date(msg.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder={
                    selectedConversation ? 'Write a message...' : 'Select a chat to start messaging'
                  }
                  className="bg-slate-900 border-slate-700"
                  disabled={!selectedConversation || isSending}
                />
                <Button
                  onClick={handleSend}
                  disabled={!selectedConversation || isSending || (!composer.trim() && !selectedFile)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={(open) => { if (!open) { setShowCreateFolder(false); setNewFolderName(''); setNewFolderType('standard'); setNewFolderDraftText(''); setNewFolderWatchAccountId(''); setNewFolderWatchGroupId(''); setNewFolderWatchGroups([]) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="bg-slate-900 border-slate-700"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('create-folder-btn')?.click() } }}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setNewFolderType('standard')}
                className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition ${
                  newFolderType === 'standard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Standard
              </button>
              <button
                onClick={() => setNewFolderType('draft')}
                className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition ${
                  newFolderType === 'draft'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Draft
              </button>
              <button
                onClick={() => setNewFolderType('group_chat')}
                className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition ${
                  newFolderType === 'group_chat'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Group chat
              </button>
            </div>
            {newFolderType === 'draft' && (
              <Input
                value={newFolderDraftText}
                onChange={(e) => setNewFolderDraftText(e.target.value)}
                placeholder="Draft text to match (exact, case-insensitive)"
                className="bg-slate-900 border-slate-700"
              />
            )}
            {newFolderType === 'group_chat' && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">
                  Pick a group to watch. Any message forwarded into it adds its original author to this folder.
                </p>
                <select
                  value={newFolderWatchAccountId}
                  onChange={async (e) => {
                    const accId = e.target.value
                    setNewFolderWatchAccountId(accId)
                    setNewFolderWatchGroupId('')
                    setNewFolderWatchGroups([])
                    if (!accId) return
                    setNewFolderWatchGroupsLoading(true)
                    try {
                      const groups = await listGroupsForAccount(accId)
                      setNewFolderWatchGroups(groups)
                    } catch { toast.error('Failed to load groups') }
                    finally { setNewFolderWatchGroupsLoading(false) }
                  }}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                >
                  <option value="">Select account…</option>
                  {(user?.connectedAccounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>{acc.displayName || acc.username || acc.id.slice(0, 8)}</option>
                  ))}
                </select>
                {newFolderWatchAccountId && (
                  <select
                    value={newFolderWatchGroupId}
                    onChange={(e) => setNewFolderWatchGroupId(e.target.value)}
                    disabled={newFolderWatchGroupsLoading}
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                  >
                    <option value="">{newFolderWatchGroupsLoading ? 'Loading groups…' : 'Select group…'}</option>
                    {newFolderWatchGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowCreateFolder(false); setNewFolderName(''); setNewFolderType('standard'); setNewFolderDraftText(''); setNewFolderWatchAccountId(''); setNewFolderWatchGroupId(''); setNewFolderWatchGroups([]) }}>Cancel</Button>
            <Button id="create-folder-btn" onClick={async () => {
              const name = newFolderName.trim()
              if (!name) return
              if (newFolderType === 'draft' && !newFolderDraftText.trim()) {
                toast.error('Enter draft text to match')
                return
              }
              if (newFolderType === 'group_chat' && (!newFolderWatchAccountId || !newFolderWatchGroupId)) {
                toast.error('Pick an account and a group to watch')
                return
              }
              try {
                const watch = newFolderType === 'group_chat'
                  ? {
                      accountId: newFolderWatchAccountId,
                      chatId: newFolderWatchGroupId,
                      chatTitle: newFolderWatchGroups.find(g => g.id === newFolderWatchGroupId)?.title || '',
                    }
                  : undefined
                await createFolder(name, 'folder', 0, newFolderType, newFolderDraftText.trim(), watch)
                const res = await listCustomFolders()
                setFolders(res.folders)
                setShowCreateFolder(false)
                setNewFolderName('')
                setNewFolderType('standard')
                setNewFolderDraftText('')
                setNewFolderWatchAccountId('')
                setNewFolderWatchGroupId('')
                setNewFolderWatchGroups([])
                toast.success(`Folder "${name}" created`)
              } catch { toast.error('Failed to create folder') }
            }} disabled={!newFolderName.trim() || (newFolderType === 'draft' && !newFolderDraftText.trim()) || (newFolderType === 'group_chat' && (!newFolderWatchAccountId || !newFolderWatchGroupId))}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={renameFolderId !== null} onOpenChange={(open) => {
        if (!open) { setRenameFolderId(null); setRenameFolderName(''); setRenameFolderType('standard'); setRenameFolderDraftText('') }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Input
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              placeholder="Folder name"
              className="bg-slate-900 border-slate-700"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('rename-folder-btn')?.click() } }}
              autoFocus
            />
            {renameFolderType === 'group_chat' ? (
              <p className="text-[11px] text-slate-400">Group-chat folder — auto-populated from forwarded messages. Rename only.</p>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setRenameFolderType('standard')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition ${
                    renameFolderType === 'standard'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Standard
                </button>
                <button
                  onClick={() => setRenameFolderType('draft')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition ${
                    renameFolderType === 'draft'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Draft
                </button>
              </div>
            )}
            {renameFolderType === 'draft' && (
              <Input
                value={renameFolderDraftText}
                onChange={(e) => setRenameFolderDraftText(e.target.value)}
                placeholder="Draft text to match (exact, case-insensitive)"
                className="bg-slate-900 border-slate-700"
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRenameFolderId(null); setRenameFolderName(''); setRenameFolderType('standard'); setRenameFolderDraftText('') }}>Cancel</Button>
            <Button id="rename-folder-btn" onClick={async () => {
              const name = renameFolderName.trim()
              if (!name || !renameFolderId) return
              if (renameFolderType === 'draft' && !renameFolderDraftText.trim()) {
                toast.error('Enter draft text to match')
                return
              }
              try {
                await updateFolder(renameFolderId, { name, folder_type: renameFolderType, draft_text: renameFolderDraftText.trim() })
                setFolders(prev => prev.map(f => f.id === renameFolderId ? { ...f, name, folder_type: renameFolderType, draft_text: renameFolderDraftText.trim() } : f))
                setRenameFolderId(null)
                setRenameFolderName('')
                setRenameFolderType('standard')
                setRenameFolderDraftText('')
                toast.success('Folder updated')
              } catch { toast.error('Failed to update folder') }
            }} disabled={!renameFolderName.trim() || (renameFolderType === 'draft' && !renameFolderDraftText.trim())}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <ConfirmDialog
        open={deleteFolderId !== null}
        onOpenChange={(open) => { if (!open) setDeleteFolderId(null) }}
        title="Delete Folder"
        description={`Are you sure you want to delete this folder? Chats in this folder will not be deleted, only removed from the folder.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteFolderId) return
          try {
            await deleteFolder(deleteFolderId)
            setFolders(prev => prev.filter(f => f.id !== deleteFolderId))
            if (selectedFolderId === deleteFolderId) setSelectedFolderId(null)
            setDeleteFolderId(null)
            toast.success('Folder deleted')
          } catch { toast.error('Failed to delete folder') }
        }}
        destructive
      />

      <ConfirmDialog
        open={pendingLeaveChat !== null}
        onOpenChange={(open) => { if (!open) setPendingLeaveChat(null) }}
        title={selectedConversation?.isChannel ? 'Leave Channel' : 'Leave Group'}
        description={`Are you sure you want to leave "${selectedConversation?.chatTitle || ''}"?`}
        confirmLabel={isLeaving ? 'Leaving...' : 'Leave'}
        onConfirm={handleLeaveChatConfirm}
        destructive
        disabled={isLeaving}
      />

      <ConfirmDialog
        open={pendingLeaveChats !== null && pendingLeaveChats.length > 0}
        onOpenChange={(open) => { if (!open) setPendingLeaveChats(null) }}
        title={`Leave ${pendingLeaveChats?.length === 1 ? 'Chat' : 'Chats'}`}
        description={`Are you sure you want to leave ${pendingLeaveChats?.length || 0} selected group${(pendingLeaveChats?.length || 0) > 1 ? 's' : ''} or channel${(pendingLeaveChats?.length || 0) > 1 ? 's' : ''}?`}
        confirmLabel={isLeavingBatch ? 'Leaving...' : 'Leave'}
        onConfirm={handleBatchLeaveConfirm}
        destructive
        disabled={isLeavingBatch}
      />

      <ConfirmDialog
        open={!!pendingDeleteChat}
        onOpenChange={(open) => { if (!open) setPendingDeleteChat(null) }}
        title="Delete Chat"
        description="Delete this conversation? This cannot be undone."
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        onConfirm={handleDeleteChatConfirm}
        destructive
        disabled={isDeleting}
      />

      <CreateGroupDialog
        open={showCreateGroup}
        onOpenChange={(open) => {
          if (!open) setQuickGroupUser(null)
          setShowCreateGroup(open)
        }}
        selectedChats={quickGroupUser
          ? [quickGroupUser]
          : displayConversations.filter(c => selectedChatIds.has(c.id)).map(c => ({
              id: c.id,
              accountId: c.accountId,
              chatId: c.chatId,
              chatTitle: c.chatTitle,
              username: c.chatUsername,
            }))}
        presets={presets}
        folders={folders}
        onLoadFolder={async (folderId) => {
          const res = await listFolderChats(folderId)
          return res.chats.map(entry => {
            const conv = conversations.find(c => c.accountId === entry.account_id && c.chatId === entry.chat_id)
            return {
              id: `${entry.account_id}::${entry.chat_id}`,
              accountId: entry.account_id,
              chatId: entry.chat_id,
              chatTitle: conv?.chatTitle || entry.chat_id,
              username: conv?.chatUsername,
            }
          })
        }}
        onCreated={() => {
          setSelectedChatIds(new Set())
          setIsSelecting(false)
          setShowCreateGroup(false)
          setQuickGroupUser(null)
        }}
        onPresetsChange={() => {
          listGroupPresets().then(res => setPresets(res.presets)).catch(() => {})
        }}
      />

      {/* Forward Message Dialog */}
      <Dialog open={forwardMsg !== null} onOpenChange={(open) => { if (!open) { setForwardMsg(null); setForwardSearch(''); setForwardSelected(new Set()); setForwardManual([]) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Forward to...</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleResolveForwardUser() } }}
                placeholder="Search people, or type @username..."
                className="pl-9 bg-slate-900 border-slate-700 h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-800 rounded-md border border-slate-800">
              {forwardSearch.trim() && (
                <button
                  disabled={isResolving || isForwarding}
                  onClick={handleResolveForwardUser}
                  className="w-full flex items-center gap-3 text-left px-3 py-2.5 hover:bg-slate-800/60 transition disabled:opacity-50"
                >
                  {isResolving ? <Spinner className="w-4 h-4" /> : <Search className="w-4 h-4 text-blue-400 shrink-0" />}
                  <span className="text-sm truncate">Search Telegram for &lsquo;{forwardSearch.trim()}&rsquo;</span>
                </button>
              )}
              {(() => {
                const filtered = forwardFiltered
                if (filtered.length === 0) {
                  return <p className="px-3 py-4 text-xs text-slate-400 text-center">No recipients found</p>
                }
                return filtered.slice(0, 60).map((r) => {
                  const checked = forwardSelected.has(r.key)
                  return (
                    <button
                      key={r.key}
                      disabled={isForwarding}
                      onClick={() => {
                        setForwardSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(r.key)) next.delete(r.key)
                          else next.add(r.key)
                          return next
                        })
                      }}
                      className="w-full flex items-center gap-3 text-left px-3 py-2.5 hover:bg-slate-800/60 transition disabled:opacity-50"
                    >
                      <Checkbox checked={checked} className="pointer-events-none" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        <p className="text-xs text-slate-400 truncate">{r.sub}</p>
                      </div>
                    </button>
                  )
                })
              })()}
            </div>
            <Button
              disabled={isForwarding || forwardSelected.size === 0}
              onClick={async () => {
                if (!forwardMsg || !selectedConversation) return
                const toChatIds = forwardRecipients
                  .filter((r) => forwardSelected.has(r.key))
                  .map((r) => r.toChatId)
                if (toChatIds.length === 0) return
                setIsForwarding(true)
                try {
                  const results = await forwardMessageBatch(
                    selectedConversation.accountId,
                    forwardMsg.chatId,
                    forwardMsg.id,
                    toChatIds
                  )
                  const succeeded = results.filter((r) => r.ok)
                  // Append any forward that landed in the currently open conversation.
                  for (const res of succeeded) {
                    if (res.item && res.toChatId === selectedConversation.chatId) {
                      setThread((prev) => [...prev, res.item as MessageItem])
                    }
                  }
                  if (succeeded.length === results.length) {
                    toast.success(`Forwarded to ${succeeded.length} recipient${succeeded.length === 1 ? '' : 's'}`)
                  } else {
                    toast.warning(`Forwarded to ${succeeded.length} of ${results.length} recipients`)
                  }
                  setForwardMsg(null)
                  setForwardSearch('')
                  setForwardSelected(new Set())
                } catch (err: any) {
                  toast.error(err?.message || 'Failed to forward message')
                } finally {
                  setIsForwarding(false)
                }
              }}
              className="w-full"
            >
              {isForwarding ? (
                <span className="flex items-center justify-center gap-2"><Spinner className="w-3 h-3" /> Forwarding...</span>
              ) : (
                `Forward${forwardSelected.size > 0 ? ` (${forwardSelected.size})` : ''}`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export default function UniboxPage() {
  return (
    <AuthGuard>
      <UniboxWorkspace />
    </AuthGuard>
  )
}
