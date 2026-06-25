'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, type GroupScraperGroup, type CustomFolder, type MessageItem, type StoredMessage } from '@/lib/auth-context'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AuthGuard } from '@/components/auth-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandedLoader } from '@/components/ui/spinner'
import { Download, Users, Loader2, AtSign, Phone, User, Hash, Contact, MessageCircle, Database, Send, X, FolderPlus, Check, Layers, Tag, ChevronLeft, ChevronRight, ChevronDown, Bookmark, FileText, Image } from 'lucide-react'
import { toast } from 'sonner'

interface ScrapedMember {
  user_id: string
  username: string
  full_name: string
  phone: string
  access_hash?: string
}

type FilterTag = 'excluded' | 'important' | 'known' | 'caution'

// Shared filter labels + colors, reused by the folder view in the Unibox.
// "unknown" is not a stored tag — it just means untagged (null). The four keys below map to the
// number keys 1–4 (excluded, important, known, caution) for keyboard tagging.
const FILTER_TAGS: { key: FilterTag; label: string; dot: string; pill: string }[] = [
  { key: 'excluded', label: 'Excluded', dot: 'bg-red-500', pill: 'bg-red-500/20 text-red-300 border-red-600' },
  { key: 'important', label: 'Important', dot: 'bg-amber-400', pill: 'bg-amber-400/20 text-amber-200 border-amber-500' },
  { key: 'known', label: 'Known', dot: 'bg-emerald-500', pill: 'bg-emerald-500/20 text-emerald-300 border-emerald-600' },
  { key: 'caution', label: 'Caution', dot: 'bg-black border border-slate-500', pill: 'bg-slate-900 text-slate-200 border-slate-500' },
]
const FILTER_TAG_MAP: Record<FilterTag, (typeof FILTER_TAGS)[number]> = Object.fromEntries(
  FILTER_TAGS.map(t => [t.key, t]),
) as Record<FilterTag, (typeof FILTER_TAGS)[number]>

// Compact 4-dot filter picker. Clicking the active tag clears it. With showLabel, the active tag is
// also rendered as a labeled pill so the row's state is readable, not color-only.
function TagDots({
  value,
  onChange,
  size = 'sm',
  showLabel = false,
}: {
  value: FilterTag | null
  onChange: (tag: FilterTag | null) => void
  size?: 'sm' | 'md'
  showLabel?: boolean
}) {
  const dim = size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
  return (
    <div className="inline-flex items-center gap-1.5">
      {FILTER_TAGS.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            title={t.label}
            onClick={(e) => { e.stopPropagation(); onChange(active ? null : t.key) }}
            className={`${dim} rounded-full ${t.dot} transition ${
              active ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-white/70' : 'opacity-35 hover:opacity-80'
            }`}
          />
        )
      })}
      {showLabel && value && (
        <span className={`ml-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] ${FILTER_TAG_MAP[value].pill}`}>
          {FILTER_TAG_MAP[value].label}
        </span>
      )}
    </div>
  )
}

interface ForwardJobState {
  jobId?: string
  status: string
  groupTitle?: string | null
  total: number
  processed: number
  forwarded: number
  added: number
  kicked: number
  skipped: number
  failed: number
  error?: string
  log?: { at: string; message: string }[]
}

const TERMINAL_FORWARD_STATUSES = new Set(['completed', 'stopped', 'failed'])

interface GroupScrapeResult {
  groupId: string
  groupTitle: string
  memberCount: number
  error: string | null
}

type SourceType = 'group' | 'contacts' | 'messaged' | 'all'

function DataExtractorContent() {
  const { user, listGroupsForAccount, createFolder, listCustomFolders, addChatToFolder, fetchThread, listFolderChats, setFolderChatFilter, listStoredMessages, sendMessage } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [sourceType, setSourceType] = useState<SourceType>('group')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedGroupTitles, setSelectedGroupTitles] = useState<Record<string, string>>({})
  const [groupOptions, setGroupOptions] = useState<GroupScraperGroup[]>([])
  const [isLoadingGroups, setIsLoadingGroups] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [scrapeProgress, setScrapeProgress] = useState<{ current: number; total: number } | null>(null)
  const [scrapedMembers, setScrapedMembers] = useState<ScrapedMember[]>([])
  const [groupResults, setGroupResults] = useState<GroupScrapeResult[]>([])
  const [error, setError] = useState('')
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [csvFilter, setCsvFilter] = useState<'all' | 'phone' | 'username' | 'none'>('all')
  const [manualInput, setManualInput] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)

  // Forward Contacts feature
  const [showForwardModal, setShowForwardModal] = useState(false)
  const [forwardGroups, setForwardGroups] = useState<GroupScraperGroup[]>([])
  const [forwardGroupId, setForwardGroupId] = useState('')
  const [forwardInterval, setForwardInterval] = useState(5)
  const [forwardLoadingGroups, setForwardLoadingGroups] = useState(false)
  const [forwardJob, setForwardJob] = useState<ForwardJobState | null>(null)
  const forwardJobIdRef = useRef<string | null>(null)

  // Add to Folder feature
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderMode, setFolderMode] = useState<'new' | 'existing'>('new')
  const [newFolderName, setNewFolderName] = useState('')
  const [existingFolders, setExistingFolders] = useState<CustomFolder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [selectedFolderUserIds, setSelectedFolderUserIds] = useState<Set<string>>(new Set())
  const [folderSaving, setFolderSaving] = useState(false)
  const [folderResult, setFolderResult] = useState<{ added: number; failed: number } | null>(null)
  // Members offered in the Add-to-Folder modal (the multi-selected subset, or all scraped users).
  const [folderCandidates, setFolderCandidates] = useState<ScrapedMember[]>([])

  // Per-user filter labels (local until the user is added to a folder).
  const [memberTags, setMemberTags] = useState<Record<string, FilterTag>>({})

  // Keyboard navigation: highlighted row index + refs for scroll-into-view. Arrow keys move the
  // highlight; number keys 1–4 tag the highlighted user (see FILTER_TAGS order).
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])

  // Messages popup: shows live Telegram history with a user + lets you edit their filter.
  const [messagesUserId, setMessagesUserId] = useState<string | null>(null)
  const [threadItems, setThreadItems] = useState<MessageItem[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState('')

  // Compose popup (keyboard "5"): pick a saved message, edit it, and send it to the user.
  const [composeUserId, setComposeUserId] = useState<string | null>(null)
  const [storedMessages, setStoredMessages] = useState<StoredMessage[]>([])
  const [storedLoading, setStoredLoading] = useState(false)
  const [storedError, setStoredError] = useState('')
  const [selectedStoredId, setSelectedStoredId] = useState<string | null>(null)
  const [composeText, setComposeText] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  const [composeError, setComposeError] = useState('')

  // Persist scrape results/selections to localStorage so they survive tab
  // navigation (Next.js unmounts the page) and full refreshes.
  const storageKey = `scrape-state:${user?.id ?? 'anon'}`
  const hasHydrated = useRef(false)

  // Which folders each scraped user (by user_id == folder chat_id) belongs to.
  // Used to push Scrape-tab tag edits back to the Unibox folders they're in.
  const [folderTagIndex, setFolderTagIndex] = useState<Map<string, { folderId: string; accountId: string }[]>>(new Map())

  // Pull the canonical filter tags from the Unibox folders so changes made there
  // show up here, and index folder membership for the reverse (Scrape -> folder) push.
  // Declared before the rehydrate effect that depends on it (avoids a TDZ error).
  const syncTagsFromFolders = useCallback(async () => {
    try {
      const { folders } = await listCustomFolders()
      // setFolderChatFilter only accepts standard folders; draft/group_chat carry no user tags.
      const standard = folders.filter(f => !f.folder_type || f.folder_type === 'standard')
      const indexByChat = new Map<string, { folderId: string; accountId: string }[]>()
      const tagByChat = new Map<string, FilterTag>()
      const latestByChat = new Map<string, string>()
      const results = await Promise.all(
        standard.map(async f => ({ folderId: f.id, chats: (await listFolderChats(f.id)).chats })),
      )
      for (const { folderId, chats } of results) {
        for (const c of chats) {
          const arr = indexByChat.get(c.chat_id) ?? []
          arr.push({ folderId, accountId: c.account_id })
          indexByChat.set(c.chat_id, arr)
          if (c.filter_tag && c.filter_tag in FILTER_TAG_MAP) {
            const prev = latestByChat.get(c.chat_id)
            if (!prev || (c.added_at ?? '') > prev) {
              latestByChat.set(c.chat_id, c.added_at ?? '')
              tagByChat.set(c.chat_id, c.filter_tag as FilterTag)
            }
          }
        }
      }
      setFolderTagIndex(indexByChat)
      if (tagByChat.size > 0) {
        setMemberTags(prev => ({ ...prev, ...Object.fromEntries(tagByChat) }))
      }
    } catch {
      // Offline / unauthorized — leave local tags as-is.
    }
  }, [listCustomFolders, listFolderChats])

  useEffect(() => {
    // Rehydrate once when the user (and thus the key) is known.
    if (hasHydrated.current) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        if (Array.isArray(saved.scrapedMembers)) setScrapedMembers(saved.scrapedMembers)
        if (Array.isArray(saved.groupResults)) setGroupResults(saved.groupResults)
        if (saved.memberTags && typeof saved.memberTags === 'object') setMemberTags(saved.memberTags)
        if (typeof saved.sourceType === 'string') setSourceType(saved.sourceType as SourceType)
        if (typeof saved.selectedAccountId === 'string') setSelectedAccountId(saved.selectedAccountId)
        if (Array.isArray(saved.selectedGroupIds)) setSelectedGroupIds(saved.selectedGroupIds)
        if (saved.selectedGroupTitles && typeof saved.selectedGroupTitles === 'object') setSelectedGroupTitles(saved.selectedGroupTitles)
      }
    } catch {
      // Corrupt or incompatible saved data — ignore and start fresh.
    }
    hasHydrated.current = true
    // Override stale local tags with whatever is currently set in the Unibox folders.
    syncTagsFromFolders()
  }, [storageKey, syncTagsFromFolders])

  useEffect(() => {
    // Skip the first run so the empty initial state can't overwrite saved
    // data before rehydration completes.
    if (!hasHydrated.current) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        scrapedMembers,
        groupResults,
        memberTags,
        sourceType,
        selectedAccountId,
        selectedGroupIds,
        selectedGroupTitles,
      }))
    } catch {
      // Storage full or unavailable — non-fatal.
    }
  }, [storageKey, scrapedMembers, groupResults, memberTags, sourceType, selectedAccountId, selectedGroupIds, selectedGroupTitles])

  const accounts = useMemo(() => user?.connectedAccounts || [], [user])

  const sourceLabels: Record<SourceType, string> = {
    group: 'Group Members',
    contacts: 'Contacts',
    messaged: 'Messaged Users',
    all: 'All',
  }

  const sourceIcons: Record<SourceType, typeof Users> = {
    group: Users,
    contacts: Contact,
    messaged: MessageCircle,
    all: Layers,
  }

  const loadGroups = useCallback(async () => {
    if (!selectedAccountId) {
      setGroupOptions([])
      return
    }
    setIsLoadingGroups(true)
    setError('')
    try {
      const timeout = setTimeout(() => {
        setError('Loading groups timed out. Try manually entering the group ID below.')
        setIsLoadingGroups(false)
      }, 15000)
      const groups = await listGroupsForAccount(selectedAccountId, 50)
      clearTimeout(timeout)
      setGroupOptions(groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
      setGroupOptions([])
    } finally {
      setIsLoadingGroups(false)
    }
  }, [selectedAccountId, listGroupsForAccount])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  useEffect(() => {
    if (!selectAllRef.current) return
    const allSelected = groupOptions.length > 0 && selectedGroupIds.length === groupOptions.length
    const someSelected = selectedGroupIds.length > 0 && selectedGroupIds.length < groupOptions.length
    selectAllRef.current.indeterminate = someSelected
    selectAllRef.current.checked = allSelected
  }, [selectedGroupIds, groupOptions])

  const handleScrape = async () => {
    if (!selectedAccountId) {
      setError('Please select an account')
      return
    }
    if (sourceType === 'group' && selectedGroupIds.length === 0) {
      setError('Please select or add at least one group')
      return
    }

    setIsScraping(true)
    setError('')
    setScrapedMembers([])
    setGroupResults([])
    setMemberTags({})

    const token = localStorage.getItem('sessionToken') || ''
    if (!token) {
      setError('Please log in again')
      setIsScraping(false)
      return
    }

    const allMembers: ScrapedMember[] = []
    const seenIds = new Set<string>()
    const results: GroupScrapeResult[] = []

    const mergeMembers = (members: ScrapedMember[]): number => {
      let addedCount = 0
      for (const member of members || []) {
        if (!seenIds.has(member.user_id)) {
          seenIds.add(member.user_id)
          allMembers.push(member)
          addedCount++
        }
      }
      return addedCount
    }

    // Scrape a single non-group source (contacts / messaged-users) and record the result.
    const scrapeSimpleSource = async (endpoint: 'contacts' | 'messaged-users', label: string) => {
      try {
        const response = await fetch(
          `${apiBase}/scrape/${endpoint}?account_id=${encodeURIComponent(selectedAccountId)}`,
          { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
        )
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.detail || `Failed with status ${response.status}`)
        }
        const data = await response.json()
        const added = mergeMembers(data.members || [])
        results.push({ groupId: endpoint, groupTitle: label, memberCount: added, error: null })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        results.push({ groupId: endpoint, groupTitle: label, memberCount: 0, error: errMsg })
      }
    }

    const scrapeSelectedGroups = async () => {
      for (let i = 0; i < selectedGroupIds.length; i++) {
        setScrapeProgress({ current: i + 1, total: selectedGroupIds.length })
        const groupId = selectedGroupIds[i]
        const groupTitle = getGroupTitle(groupId)
        try {
          const response = await fetch(
            `${apiBase}/scrape-group/members?account_id=${encodeURIComponent(selectedAccountId)}&group_id=${encodeURIComponent(groupId)}`,
            { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
          )
          if (!response.ok) {
            const data = await response.json().catch(() => null)
            const errMsg = data?.detail || `Failed with status ${response.status}`
            results.push({ groupId, groupTitle, memberCount: 0, error: errMsg })
            continue
          }
          const data = await response.json()
          const added = mergeMembers(data.members || [])
          results.push({ groupId, groupTitle, memberCount: added, error: null })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          results.push({ groupId, groupTitle, memberCount: 0, error: errMsg })
        }
      }
    }

    if (sourceType === 'group') {
      await scrapeSelectedGroups()
    } else if (sourceType === 'contacts') {
      setScrapeProgress({ current: 1, total: 1 })
      await scrapeSimpleSource('contacts', sourceLabels.contacts)
    } else if (sourceType === 'messaged') {
      setScrapeProgress({ current: 1, total: 1 })
      await scrapeSimpleSource('messaged-users', sourceLabels.messaged)
    } else {
      // 'all' — contacts + messaged users, plus any selected groups, merged & deduped.
      if (selectedGroupIds.length > 0) await scrapeSelectedGroups()
      setScrapeProgress({ current: 1, total: 1 })
      await scrapeSimpleSource('contacts', sourceLabels.contacts)
      await scrapeSimpleSource('messaged-users', sourceLabels.messaged)
    }

    setScrapedMembers(allMembers)
    setGroupResults(results)
    // Reflect tags already set in Unibox folders for any freshly scraped users.
    syncTagsFromFolders()

    if (results.some(r => r.error)) {
      const failed = results.filter(r => r.error).map(r => r.groupTitle)
      setError(`Failed to scrape: ${failed.join(', ')}`)
    }
    setIsScraping(false)
    setScrapeProgress(null)
  }

  const handleDownloadCSV = async () => {
    if (scrapedMembers.length === 0) return

    try {
      const members = scrapedMembers.filter(m =>
        csvFilter === 'phone' ? !!m.phone :
        csvFilter === 'username' ? !!m.username :
        csvFilter === 'none' ? (!m.phone && !m.username) :
        true
      )

      if (members.length === 0) {
        const filterLabel = csvFilter === 'none' ? 'no phone & no username' : csvFilter
        setError(`No members found with ${filterLabel}`)
        return
      }

      // 'none' users have neither field, so drop both columns and keep just the identity columns.
      const showUsername = csvFilter !== 'phone' && csvFilter !== 'none'
      const showPhone = csvFilter !== 'username' && csvFilter !== 'none'
      const headers = ['Source', 'User ID', 'Full Name', ...(showUsername ? ['Username'] : []), ...(showPhone ? ['Phone'] : [])]
      const rows = members.map(m => {
        const base = [sourceLabels[sourceType], m.user_id, m.full_name]
        if (showUsername) base.push(m.username || '')
        if (showPhone) base.push(m.phone || '')
        return base
      })

      const csvContent = [
        headers.map(h => `"${h}"`).join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n')

      const account = accounts.find(a => a.id === selectedAccountId)
      const safeUsername = (account?.username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
      const safeSource = sourceLabels[sourceType].replace(/\s+/g, '_').toLowerCase()
      const filename = `${safeUsername}_${safeSource}.csv`

      const BOM = '\uFEFF'
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file')
    }
  }

  // Users with no username AND no phone — only reachable via this account.
  const forwardableMembers = useMemo(
    () => scrapedMembers.filter(m => !m.username && !m.phone),
    [scrapedMembers]
  )

  // How many users would actually be added to a folder: every scraped member that carries a
  // filter label, except "excluded" (never added) and those already saved in a folder. Ignores
  // the search box so the count reflects all labeled users, not just the ones matching a search.
  const taggedCount = useMemo(() => {
    return scrapedMembers.filter(m => {
      if (folderTagIndex.has(m.user_id)) return false // already saved in a folder — don't count
      const t = memberTags[m.user_id]
      return t && t !== 'excluded'
    }).length
  }, [scrapedMembers, memberTags, folderTagIndex])

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'

  const openForwardModal = async () => {
    setError('')
    setForwardJob(null)
    setForwardGroupId('')
    setShowForwardModal(true)
    if (!selectedAccountId) return
    setForwardLoadingGroups(true)
    try {
      const groups = await listGroupsForAccount(selectedAccountId)
      setForwardGroups(groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
    } finally {
      setForwardLoadingGroups(false)
    }
  }

  const openFolderModal = async () => {
    setError('')
    setFolderResult(null)
    setFolderMode('new')
    setNewFolderName('')
    setSelectedFolderId('')
    // Offer every scraped user that carries a filter label and isn't excluded or already foldered
    // (untagged/excluded users are never added).
    const candidates = scrapedMembers.filter(m => {
      if (folderTagIndex.has(m.user_id)) return false // already saved in a folder — don't offer again
      const t = memberTags[m.user_id]
      return t && t !== 'excluded'
    })
    setFolderCandidates(candidates)
    // Pre-check all candidates; the user can deselect any inside the modal before adding.
    setSelectedFolderUserIds(new Set(candidates.map(m => m.user_id)))
    setShowFolderModal(true)
    setFoldersLoading(true)
    try {
      const res = await listCustomFolders()
      // addChatToFolder only works on standard folders (draft/group_chat are rejected by the API).
      setExistingFolders((res.folders || []).filter(f => !f.folder_type || f.folder_type === 'standard'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load folders')
    } finally {
      setFoldersLoading(false)
    }
  }

  const toggleFolderUser = (userId: string) => {
    setSelectedFolderUserIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleAllFolderUsers = () => {
    setSelectedFolderUserIds(prev =>
      prev.size === folderCandidates.length
        ? new Set()
        : new Set(folderCandidates.map(m => m.user_id))
    )
  }

  const submitAddToFolder = async () => {
    setError('')
    setFolderResult(null)
    if (!selectedAccountId) {
      setError('Select an account first')
      return
    }
    const chosen = folderCandidates.filter(m => selectedFolderUserIds.has(m.user_id))
    if (chosen.length === 0) {
      setError('Select at least one user to add')
      return
    }
    setFolderSaving(true)
    try {
      let folderId = selectedFolderId
      let folderName = ''
      if (folderMode === 'new') {
        const name = newFolderName.trim()
        if (!name) {
          setError('Enter a folder name')
          setFolderSaving(false)
          return
        }
        const folder = await createFolder(name)
        folderId = folder.id
        folderName = name
      } else if (!folderId) {
        setError('Select a folder')
        setFolderSaving(false)
        return
      } else {
        folderName = existingFolders.find(f => f.id === folderId)?.name || 'folder'
      }

      const results = await Promise.allSettled(
        chosen.map(m => addChatToFolder(folderId, selectedAccountId, m.user_id, {
          username: m.username || null,
          displayName: m.full_name || null,
          accessHash: m.access_hash || null,
          filterTag: memberTags[m.user_id] ?? null,
        }))
      )
      const added = results.filter(r => r.status === 'fulfilled').length
      const failed = results.length - added
      setFolderResult({ added, failed })
      if (failed > 0) {
        setError(`${failed} user${failed === 1 ? '' : 's'} could not be added`)
        if (added > 0) {
          toast.warning(`Added ${added} of ${results.length} to ${folderName} — ${failed} failed`)
        } else {
          toast.error(`Could not add ${failed} user${failed === 1 ? '' : 's'} to ${folderName}`)
        }
      } else {
        // All users added successfully — confirm, then close the modal and clear the selection so
        // it can't carry over into the next "Add to Folder".
        toast.success(`Added ${added} user${added === 1 ? '' : 's'} to ${folderName}`)
        setShowFolderModal(false)
        setSelectedFolderUserIds(new Set())
        setFolderCandidates([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add users to folder')
    } finally {
      setFolderSaving(false)
    }
  }

  const startForward = async () => {
    if (!forwardGroupId || forwardableMembers.length === 0) return
    const token = localStorage.getItem('sessionToken') || ''
    const groupTitle = forwardGroups.find(g => g.id === forwardGroupId)?.title || ''
    try {
      const response = await fetch(`${apiBase}/forward-contacts/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          accountId: selectedAccountId,
          groupId: forwardGroupId,
          groupTitle,
          intervalSeconds: Math.max(1, Number(forwardInterval) || 5),
          targets: forwardableMembers.map(m => ({
            userId: m.user_id,
            accessHash: m.access_hash || null,
            fullName: m.full_name,
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || `Failed with status ${response.status}`)
      }
      const data = await response.json()
      forwardJobIdRef.current = data.jobId
      setForwardJob({
        jobId: data.jobId,
        status: 'running',
        groupTitle,
        total: data.total ?? forwardableMembers.length,
        processed: 0,
        forwarded: 0,
        added: 0,
        kicked: 0,
        skipped: 0,
        failed: 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start forwarding')
    }
  }

  const stopForward = async () => {
    const jobId = forwardJobIdRef.current
    if (!jobId) return
    const token = localStorage.getItem('sessionToken') || ''
    try {
      await fetch(`${apiBase}/forward-contacts/${encodeURIComponent(jobId)}/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
    } catch {
      // best-effort; polling will reflect the terminal status
    }
  }

  // Poll the forward job status until it reaches a terminal state.
  useEffect(() => {
    const jobId = forwardJob?.jobId
    if (!jobId || (forwardJob && forwardJob.status !== 'running')) return
    const token = localStorage.getItem('sessionToken') || ''
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${apiBase}/forward-contacts/${encodeURIComponent(jobId)}/status`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!response.ok) return
        const data = await response.json()
        setForwardJob({
          jobId,
          status: data.status,
          groupTitle: data.groupTitle,
          total: data.total ?? 0,
          processed: data.processed ?? 0,
          forwarded: data.forwarded ?? 0,
          added: data.added ?? 0,
          kicked: data.kicked ?? 0,
          skipped: data.skipped ?? 0,
          failed: data.failed ?? 0,
          error: data.error,
          log: data.log,
        })
      } catch {
        // transient network error; keep polling
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [forwardJob?.jobId, forwardJob?.status, apiBase])

  // Reattach to an in-flight job after a page refresh: the job runs in the background and
  // is persisted in the DB, so look for a running/paused one and reopen the progress view.
  useEffect(() => {
    let cancelled = false
    const token = localStorage.getItem('sessionToken') || ''
    ;(async () => {
      try {
        const res = await fetch(`${apiBase}/forward-contacts/jobs`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        const jobs: ForwardJobState[] = data.jobs || []
        const active = jobs.find(j => j.status === 'running' || j.status === 'paused')
        if (active && !cancelled) {
          forwardJobIdRef.current = active.jobId || null
          setForwardJob(active)
          setShowForwardModal(true)
        }
      } catch {
        // best-effort reattach; ignore failures
      }
    })()
    return () => { cancelled = true }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendJobAction = async (action: 'pause' | 'resume' | 'stop') => {
    const jobId = forwardJobIdRef.current
    if (!jobId) return
    const token = localStorage.getItem('sessionToken') || ''
    try {
      const res = await fetch(`${apiBase}/forward-contacts/${encodeURIComponent(jobId)}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.ok) {
        if (action === 'resume') setForwardJob(prev => prev ? { ...prev, status: 'running' } : prev)
        if (action === 'pause') setForwardJob(prev => prev ? { ...prev, status: 'paused' } : prev)
      }
    } catch {
      // best-effort; polling will reflect the terminal status
    }
  }

  const exportJobTargets = async (kind: 'passed' | 'failed') => {
    const jobId = forwardJobIdRef.current
    if (!jobId) return
    const token = localStorage.getItem('sessionToken') || ''
    try {
      const res = await fetch(`${apiBase}/forward-contacts/${encodeURIComponent(jobId)}/targets?kind=${kind}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Failed with status ${res.status}`)
      const data = await res.json()
      const targets: { member_id: string; full_name?: string; username?: string; phone?: string; status: string; result?: string }[] = data.targets || []
      if (targets.length === 0) {
        setError(`No ${kind} contacts to export`)
        return
      }
      const headers = ['User ID', 'Full Name', 'Username', 'Phone', 'Status', 'Reason']
      const rows = targets.map(t => [t.member_id, t.full_name || '', t.username || '', t.phone || '', t.status, t.result || ''])
      const csvContent = [
        headers.map(h => `"${h}"`).join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n')
      const safeGroup = (forwardJob?.groupTitle || 'group').replace(/[^a-zA-Z0-9_-]/g, '_')
      const BOM = '﻿'
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeGroup}_${kind}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export contacts')
    }
  }

  const toggleGroup = (groupId: string, title: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    )
    setSelectedGroupTitles(prev => ({ ...prev, [groupId]: title }))
  }

  const removeGroup = (groupId: string) => {
    setSelectedGroupIds(prev => prev.filter(id => id !== groupId))
    setSelectedGroupTitles(prev => {
      const next = { ...prev }
      delete next[groupId]
      return next
    })
  }

  const addManualGroup = () => {
    const id = manualInput.trim()
    if (!id || selectedGroupIds.includes(id)) return
    setSelectedGroupIds(prev => [...prev, id])
    setSelectedGroupTitles(prev => ({ ...prev, [id]: id }))
    setManualInput('')
  }

  const getGroupTitle = (groupId: string): string => {
    const found = groupOptions.find(g => g.id === groupId || `@${g.username}` === groupId)
    return found?.title || selectedGroupTitles[groupId] || groupId
  }

  const stats = useMemo(() => {
    const withUsername = scrapedMembers.filter(m => m.username).length
    const withPhone = scrapedMembers.filter(m => m.phone).length
    const uniqueNames = new Set(scrapedMembers.map(m => m.full_name)).size
    return { total: scrapedMembers.length, withUsername, withPhone, uniqueNames }
  }, [scrapedMembers])

  const filteredMembers = useMemo(() => {
    if (!searchFilter.trim()) return scrapedMembers
    const needle = searchFilter.toLowerCase()
    return scrapedMembers.filter(
      m =>
        m.full_name.toLowerCase().includes(needle) ||
        (m.username && m.username.toLowerCase().includes(needle)) ||
        m.user_id.includes(needle) ||
        (m.phone && m.phone.includes(needle))
    )
  }, [scrapedMembers, searchFilter])

  const handleSourceChange = (newSource: SourceType) => {
    setSourceType(newSource)
    setScrapedMembers([])
    setGroupResults([])
    setMemberTags({})
    setError('')
  }

  // Push a tag change back to every Unibox folder this user belongs to, so the
  // two views stay in sync. No-op for users not in any folder. Fire-and-forget.
  const pushTagToFolders = (userId: string, tag: FilterTag | null) => {
    const memberships = folderTagIndex.get(userId)
    if (!memberships?.length) return
    for (const { folderId, accountId } of memberships) {
      setFolderChatFilter(folderId, accountId, [userId], tag).catch(() => {})
    }
  }

  const setMemberTag = (userId: string, tag: FilterTag | null) => {
    setMemberTags(prev => {
      const next = { ...prev }
      if (tag) next[userId] = tag
      else delete next[userId]
      return next
    })
    pushTagToFolders(userId, tag)
  }

  // Reset every tag on this screen so the Add-to-Folder count returns to 0. Local only —
  // tags already saved inside Unibox folders are left untouched.
  const clearAllTags = () => {
    setMemberTags({})
  }

  // Keep the highlighted row valid as the list shrinks (search/scrape changes).
  useEffect(() => {
    setFocusedIndex(i => (i >= filteredMembers.length ? filteredMembers.length - 1 : i))
  }, [filteredMembers.length])

  // Keyboard control over the scraped-user list: ↑/↓ move the highlight, 1–4 tag the highlighted
  // user (excluded/important/known/caution), 0 clears to untagged, 5 opens the compose popup.
  // Ignored while typing or when a modal/popup is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showFolderModal || messagesUserId || showForwardModal || composeUserId) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (filteredMembers.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(i => {
          const next = Math.min((i < 0 ? -1 : i) + 1, filteredMembers.length - 1)
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' })
          return next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(i => {
          const next = Math.max((i < 0 ? filteredMembers.length : i) - 1, 0)
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' })
          return next
        })
      } else if (focusedIndex >= 0 && focusedIndex < filteredMembers.length && e.key === '5') {
        e.preventDefault()
        openCompose(filteredMembers[focusedIndex].user_id)
      } else if (focusedIndex >= 0 && focusedIndex < filteredMembers.length && ['0', '1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        const member = filteredMembers[focusedIndex]
        if (e.key === '0') {
          setMemberTag(member.user_id, null)
        } else {
          const tag = FILTER_TAGS[Number(e.key) - 1]?.key ?? null
          const current = memberTags[member.user_id] ?? null
          setMemberTag(member.user_id, current === tag ? null : tag)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filteredMembers, focusedIndex, memberTags, showFolderModal, messagesUserId, showForwardModal, composeUserId])

  const messagesMember = useMemo(
    () => scrapedMembers.find(m => m.user_id === messagesUserId) || null,
    [scrapedMembers, messagesUserId]
  )

  const openMessages = (userId: string) => {
    setMessagesUserId(userId)
    setThreadItems([])
    setThreadError('')
  }

  // Load the live Telegram thread whenever the messages popup targets a new user.
  useEffect(() => {
    if (!messagesUserId || !selectedAccountId) return
    let cancelled = false
    setThreadLoading(true)
    setThreadError('')
    setThreadItems([])
    fetchThread(selectedAccountId, messagesUserId, 50)
      .then(res => {
        if (cancelled) return
        setThreadItems(res.items || [])
      })
      .catch(err => {
        if (cancelled) return
        setThreadError(err instanceof Error ? err.message : 'Failed to load messages')
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false)
      })
    return () => { cancelled = true }
  }, [messagesUserId, selectedAccountId, fetchThread])

  const composeMember = useMemo(
    () => scrapedMembers.find(m => m.user_id === composeUserId) || null,
    [scrapedMembers, composeUserId]
  )

  const openCompose = (userId: string) => {
    setComposeUserId(userId)
    setSelectedStoredId(null)
    setComposeText('')
    setComposeError('')
  }

  const pickStored = (m: StoredMessage) => {
    setSelectedStoredId(m.id)
    // Text snippets prefill directly; photo/file entries contribute their caption (content).
    setComposeText(m.content || '')
  }

  const submitCompose = async () => {
    if (!composeUserId) return
    setComposeError('')
    if (!selectedAccountId) {
      setComposeError('Select an account first')
      return
    }
    const text = composeText.trim()
    if (!text) {
      setComposeError('Message cannot be empty')
      return
    }
    setComposeSending(true)
    try {
      await sendMessage(selectedAccountId, composeUserId, text)
      toast.success('Message sent')
      setComposeUserId(null)
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setComposeSending(false)
    }
  }

  // Lazy-load saved messages the first time the compose popup opens.
  useEffect(() => {
    if (!composeUserId || storedMessages.length > 0) return
    let cancelled = false
    setStoredLoading(true)
    setStoredError('')
    listStoredMessages()
      .then(res => {
        if (cancelled) return
        setStoredMessages(res.messages || [])
      })
      .catch(err => {
        if (cancelled) return
        setStoredError(err instanceof Error ? err.message : 'Failed to load saved messages')
      })
      .finally(() => {
        if (!cancelled) setStoredLoading(false)
      })
    return () => { cancelled = true }
  }, [composeUserId, storedMessages.length, listStoredMessages])

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <Database className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold">Data Extractor</h1>

          <div className="ml-auto flex gap-1 bg-slate-800/40 rounded-lg p-1">
            {(Object.entries(sourceLabels) as [SourceType, string][]).map(([key, label]) => {
              const Icon = sourceIcons[key]
              return (
                <button
                  key={key}
                  onClick={() => handleSourceChange(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    sourceType === key
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 p-4">
          <div className="h-full rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden grid grid-cols-1 lg:grid-cols-[300px_1fr_280px]">
            {/* Left Panel - Controls */}
            <aside className="border-r border-slate-800 overflow-y-auto p-4 space-y-5">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500 mb-2 block">Account</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Choose account...</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName || account.username || account.id}
                    </option>
                  ))}
                </select>
              </div>

              {(sourceType === 'group' || sourceType === 'all') && (
                <>
                  <div>
                    <label className="text-xs font-semibold uppercase text-slate-500 mb-2 block">
                      {sourceType === 'all' ? 'Groups (optional)' : 'Groups'}
                    </label>
                    {isLoadingGroups ? (
                      <BrandedLoader label="Loading groups" className="py-3" />
                    ) : groupOptions.length > 0 ? (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        <label className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 border-b border-slate-700 mb-1 sticky top-0 bg-slate-900/90">
                          <input
                            type="checkbox"
                            ref={selectAllRef}
                            onChange={() => {
                              if (selectedGroupIds.length === groupOptions.length) {
                                setSelectedGroupIds([])
                                setSelectedGroupTitles({})
                              } else {
                                setSelectedGroupIds(groupOptions.map(g => g.id))
                                setSelectedGroupTitles(Object.fromEntries(groupOptions.map(g => [g.id, g.title])))
                              }
                            }}
                            className="accent-blue-500"
                          />
                          Select All ({groupOptions.length} groups)
                        </label>
                        {groupOptions.map((group) => (
                          <label
                            key={group.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition ${
                              selectedGroupIds.includes(group.id)
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'hover:bg-slate-800/50 text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedGroupIds.includes(group.id)}
                              onChange={() => toggleGroup(group.id, group.title)}
                              className="accent-blue-500"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{group.title}</p>
                              {group.username && <p className="text-[10px] text-slate-500">@{group.username}</p>}
                            </div>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No groups loaded</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase text-slate-500 mb-2 block">Add Group ID</label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="@groupname or -100..."
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm flex-1"
                      />
                      <Button
                        onClick={addManualGroup}
                        size="sm"
                        variant="outline"
                        disabled={!manualInput.trim()}
                        className="border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0"
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  {selectedGroupIds.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold uppercase text-slate-500 mb-2 block">
                        Selected ({selectedGroupIds.length})
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedGroupIds.map(id => (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full"
                          >
                            <span className="truncate max-w-[120px]">{getGroupTitle(id)}</span>
                            <button onClick={() => removeGroup(id)} className="hover:text-white ml-0.5">&times;</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {sourceType !== 'group' && (
                <div className="text-xs text-slate-400 space-y-3">
                  <p className="flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
                    <span>
                      {sourceType === 'contacts'
                        ? "Scrapes all contacts saved in this Telegram account's address book."
                        : sourceType === 'messaged'
                        ? 'Scrapes all users this account has one-on-one DM conversations with.'
                        : 'Scrapes contacts and messaged users (plus any selected groups), merged with duplicates removed.'}
                    </span>
                  </p>
                </div>
              )}

              <Button
                onClick={handleScrape}
                disabled={isScraping || !selectedAccountId || (sourceType === 'group' && selectedGroupIds.length === 0)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {scrapeProgress
                      ? `Scraping ${scrapeProgress.current}/${scrapeProgress.total}...`
                      : 'Scraping...'}
                  </>
                ) : (
                  <>
                    {sourceType === 'group' ? (
                      <Users className="w-4 h-4 mr-2" />
                    ) : sourceType === 'contacts' ? (
                      <Contact className="w-4 h-4 mr-2" />
                    ) : sourceType === 'messaged' ? (
                      <MessageCircle className="w-4 h-4 mr-2" />
                    ) : (
                      <Layers className="w-4 h-4 mr-2" />
                    )}
                    {sourceType === 'group' && selectedGroupIds.length > 1
                      ? `Scrape ${selectedGroupIds.length} Groups`
                      : `Scrape ${sourceLabels[sourceType]}`}
                  </>
                )}
              </Button>
            </aside>

            {/* Middle Panel - Members List */}
            <section className="flex flex-col min-h-0">
              <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3">
                <Input
                  placeholder="Search members..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm h-8 max-w-xs"
                />
                <span className="text-xs text-slate-500 ml-auto">
                  {filteredMembers.length} / {scrapedMembers.length} members
                </span>
              </div>

              {scrapedMembers.length > 0 && (
                <div className="border-b border-slate-800 px-4 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Filters</span>
                  {FILTER_TAGS.map((t, i) => (
                    <span key={t.key} className="inline-flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} />
                      <kbd className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">{i + 1}</kbd>
                      {t.label}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5">
                    <Bookmark className="w-2.5 h-2.5" />
                    <kbd className="rounded bg-slate-800 px-1 text-[10px] text-slate-300">5</kbd>
                    Message
                  </span>
                  <span className="text-slate-500">↑/↓ move · 0 clear</span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {!scrapedMembers.length ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    <div className="text-center">
                      <Database className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                      <p>Select an account and source, then click Scrape</p>
                    </div>
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">No members match your search</div>
                ) : (
                  <table className="w-full text-sm text-left text-slate-300">
                    <thead className="text-xs uppercase bg-slate-800/60 text-slate-500 sticky top-0">
                      <tr>
                        <th className="px-4 py-2">Profile</th>
                        <th className="px-4 py-2">Phone</th>
                        <th className="px-4 py-2">Filter</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredMembers.map((member, idx) => {
                        const focused = idx === focusedIndex
                        const name = member.full_name?.trim() || (member.username ? `@${member.username}` : 'Unknown')
                        const initials = name.replace(/^@/, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
                        return (
                          <tr
                            key={member.user_id}
                            ref={(el) => { rowRefs.current[idx] = el }}
                            onMouseDown={() => setFocusedIndex(idx)}
                            className={`transition hover:bg-slate-800/30 ${focused ? 'ring-1 ring-inset ring-blue-400/60' : ''}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-200">
                                  {initials}
                                </span>
                                <span className="min-w-0">
                                  <button
                                    onClick={() => openMessages(member.user_id)}
                                    className="block max-w-[14rem] truncate text-left text-sm font-medium text-blue-300 hover:text-blue-200 hover:underline"
                                    title="View messages"
                                  >
                                    {name}
                                  </button>
                                  <span className="block text-xs text-slate-400">
                                    {member.username ? `@${member.username}` : '—'}
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs">{member.phone || '-'}</td>
                            <td className="px-4 py-3">
                              <TagDots
                                value={memberTags[member.user_id] ?? null}
                                onChange={(tag) => setMemberTag(member.user_id, tag)}
                                showLabel
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Right Panel - Stats */}
            <aside className="border-l border-slate-800 overflow-y-auto p-4 space-y-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Results</div>

              {scrapedMembers.length > 0 || groupResults.length > 0 ? (
                <>
                  {groupResults.length > 0 && (
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setSourcesExpanded(v => !v)}
                        className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase text-slate-500 hover:text-slate-300 transition"
                      >
                        {sourcesExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        Sources ({groupResults.length})
                      </button>
                      {sourcesExpanded && (
                        <div className="max-h-48 overflow-y-auto">
                          {groupResults.map((r, i) => (
                            <div key={`${r.groupId}-${i}`} className="flex items-center gap-2 text-xs py-1">
                              {r.error ? (
                                <span className="text-red-400 shrink-0" title={r.error}>✕</span>
                              ) : (
                                <span className="text-emerald-400 shrink-0">✓</span>
                              )}
                              <span className="truncate text-slate-300 flex-1">{r.groupTitle}</span>
                              <span className="text-slate-500 shrink-0">{r.memberCount}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <Hash className="w-4 h-4 mx-auto mb-1 text-slate-500" />
                      <p className="text-xl font-bold">{stats.total}</p>
                      <p className="text-[10px] text-slate-500 uppercase">Total</p>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <User className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                      <p className="text-xl font-bold">{stats.uniqueNames}</p>
                      <p className="text-[10px] text-slate-500 uppercase">Unique</p>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <AtSign className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                      <p className="text-xl font-bold">{stats.withUsername}</p>
                      <p className="text-[10px] text-slate-500 uppercase">Usernames</p>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <Phone className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                      <p className="text-xl font-bold">{stats.withPhone}</p>
                      <p className="text-[10px] text-slate-500 uppercase">Phones</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">With username</span>
                      <span className="text-slate-300">
                        {stats.total > 0 ? Math.round((stats.withUsername / stats.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{
                          width: `${stats.total > 0 ? (stats.withUsername / stats.total) * 100 : 0}%`,
                        }}
                      />
                    </div>

                    <div className="flex justify-between text-xs mt-2">
                      <span className="text-slate-400">With phone</span>
                      <span className="text-slate-300">
                        {stats.total > 0 ? Math.round((stats.withPhone / stats.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all"
                        style={{
                          width: `${stats.total > 0 ? (stats.withPhone / stats.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase text-slate-500">CSV Filter</label>
                    <select
                      value={csvFilter}
                      onChange={(e) => setCsvFilter(e.target.value as 'all' | 'phone' | 'username' | 'none')}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All members</option>
                      <option value="phone">Phone only</option>
                      <option value="username">Username only</option>
                      <option value="none">No phone & no username</option>
                    </select>
                    <Button
                      onClick={handleDownloadCSV}
                      variant="outline"
                      className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download CSV
                    </Button>
                    {forwardableMembers.length > 0 && (
                      <Button
                        onClick={openForwardModal}
                        variant="outline"
                        className="w-full border-blue-700 text-blue-300 hover:bg-blue-900/30"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Save Users ({forwardableMembers.length})
                      </Button>
                    )}
                    {scrapedMembers.length > 0 && (
                      <Button
                        onClick={openFolderModal}
                        variant="outline"
                        className="w-full border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
                      >
                        <FolderPlus className="w-4 h-4 mr-2" />
                        Add to Folder ({taggedCount})
                      </Button>
                    )}
                    {scrapedMembers.length > 0 && taggedCount > 0 && (
                      <Button
                        onClick={clearAllTags}
                        variant="outline"
                        className="w-full border-slate-700 text-slate-400 hover:bg-slate-800"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Clear all filters
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <p>No results yet</p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>

      {showForwardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-400" />
                Save Users
              </h2>
              <button
                onClick={() => setShowForwardModal(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Saves the {forwardableMembers.length} users who have no username or phone — the only way
              to reach them later — by adding them to a group you control, then removing them, so their
              contact stays accessible from this account. Requires admin rights to remove. Telegram may
              skip users whose privacy settings block adding.
            </p>

            {!forwardJob ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-slate-500">Destination group</label>
                  {forwardLoadingGroups ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading groups...
                    </div>
                  ) : (
                    <select
                      value={forwardGroupId}
                      onChange={(e) => setForwardGroupId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a group...</option>
                      {forwardGroups.map(g => (
                        <option key={g.id} value={g.id}>{g.title}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-slate-500">Interval (seconds)</label>
                  <Input
                    type="number"
                    min={1}
                    value={forwardInterval}
                    onChange={(e) => setForwardInterval(Number(e.target.value))}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <Button
                  onClick={startForward}
                  disabled={!forwardGroupId}
                  className="w-full bg-blue-600 hover:bg-blue-500"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Start Saving
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Status</span>
                  <span className="font-semibold capitalize">{forwardJob.status}</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${forwardJob.total > 0 ? (forwardJob.processed / forwardJob.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  <div className="bg-slate-800/40 rounded-lg p-2">
                    <p className="text-lg font-bold">{forwardJob.processed}/{forwardJob.total}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Done</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2">
                    <p className="text-lg font-bold text-blue-400">{forwardJob.forwarded}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Forwarded</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2">
                    <p className="text-lg font-bold text-emerald-400">{forwardJob.added}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Added</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2">
                    <p className="text-lg font-bold text-amber-400">{forwardJob.skipped}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Skipped</p>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2">
                    <p className="text-lg font-bold text-red-400">{forwardJob.failed}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Failed</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 text-center">
                  Kicked after adding: <span className="text-slate-200 font-semibold">{forwardJob.kicked}</span>
                </p>
                {forwardJob.error && (
                  <p className="text-xs text-red-400">{forwardJob.error}</p>
                )}
                {forwardJob.log && forwardJob.log.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase text-slate-500">Activity</label>
                    <div className="max-h-40 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/50 p-2 space-y-1">
                      {[...forwardJob.log].reverse().map((entry, i) => (
                        <p
                          key={i}
                          className={`text-[11px] leading-snug ${
                            entry.message.startsWith('Failed') || entry.message.startsWith('Stopping')
                              ? 'text-red-400'
                              : entry.message.startsWith('Skipped') || entry.message.startsWith('Could not kick') || entry.message.startsWith('Forward from')
                              ? 'text-amber-400'
                              : entry.message.startsWith('Added')
                              ? 'text-emerald-400'
                              : entry.message.startsWith('Kicked') || entry.message.startsWith('Forwarded')
                              ? 'text-blue-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {entry.message}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {forwardJob.status === 'running' && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => sendJobAction('pause')}
                        variant="outline"
                        className="flex-1 border-amber-700 text-amber-300 hover:bg-amber-900/30"
                      >
                        Pause
                      </Button>
                      <Button
                        onClick={stopForward}
                        variant="outline"
                        className="flex-1 border-red-700 text-red-300 hover:bg-red-900/30"
                      >
                        Stop
                      </Button>
                    </div>
                  )}
                  {forwardJob.status === 'paused' && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => sendJobAction('resume')}
                        className="flex-1 bg-blue-600 hover:bg-blue-500"
                      >
                        Resume
                      </Button>
                      <Button
                        onClick={stopForward}
                        variant="outline"
                        className="flex-1 border-red-700 text-red-300 hover:bg-red-900/30"
                      >
                        Stop
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => exportJobTargets('passed')}
                      variant="outline"
                      className="flex-1 border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
                    >
                      <Download className="w-4 h-4 mr-1" /> Passed
                    </Button>
                    <Button
                      onClick={() => exportJobTargets('failed')}
                      variant="outline"
                      className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      <Download className="w-4 h-4 mr-1" /> Failed
                    </Button>
                  </div>
                  {(forwardJob.status === 'paused' || TERMINAL_FORWARD_STATUSES.has(forwardJob.status)) && (
                    <Button
                      onClick={() => { setShowForwardModal(false); setForwardJob(null); forwardJobIdRef.current = null }}
                      variant="outline"
                      className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      Close
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-emerald-400" />
                Add to Folder
              </h2>
              <button
                onClick={() => setShowFolderModal(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              File these users into a folder so you can reach them later from the Unibox. Each user&apos;s
              filter label is saved with them and drives the folder&apos;s filter tabs. Pick which users to add below.
            </p>

            {/* Folder picker */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-slate-500">Folder</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFolderMode('new')}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                    folderMode === 'new'
                      ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  New folder
                </button>
                <button
                  onClick={() => setFolderMode('existing')}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                    folderMode === 'existing'
                      ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Existing folder
                </button>
              </div>

              {folderMode === 'new' ? (
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              ) : foldersLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading folders…
                </div>
              ) : existingFolders.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  No folders yet — switch to “New folder” to create one.
                </p>
              ) : (
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select a folder…</option>
                  {existingFolders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* User selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase text-slate-500">
                  Users ({selectedFolderUserIds.size}/{folderCandidates.length})
                </label>
                <button
                  onClick={toggleAllFolderUsers}
                  className="text-[11px] text-emerald-300 hover:text-emerald-200"
                >
                  {selectedFolderUserIds.size === folderCandidates.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
                {folderCandidates.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-slate-500">
                    No tagged users — set a filter on at least one user first.
                  </p>
                )}
                {folderCandidates.map(m => {
                  const checked = selectedFolderUserIds.has(m.user_id)
                  const tag = memberTags[m.user_id] ?? null
                  return (
                    <button
                      key={m.user_id}
                      onClick={() => toggleFolderUser(m.user_id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/50"
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          checked ? 'border-emerald-500 bg-emerald-600' : 'border-slate-600'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-slate-200">
                          {m.full_name || 'Unknown'}
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">{m.user_id}</span>
                      </span>
                      {tag && (
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${FILTER_TAG_MAP[tag].pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${FILTER_TAG_MAP[tag].dot}`} />
                          {FILTER_TAG_MAP[tag].label}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
            {folderResult && (
              <p className="text-xs text-emerald-300">
                Added {folderResult.added} user{folderResult.added === 1 ? '' : 's'} to the folder
                {folderResult.failed > 0 ? ` (${folderResult.failed} failed)` : ''}.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => { setShowFolderModal(false); setSelectedFolderUserIds(new Set()); setFolderCandidates([]) }}
                variant="outline"
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Close
              </Button>
              <Button
                onClick={submitAddToFolder}
                disabled={
                  folderSaving ||
                  selectedFolderUserIds.size === 0 ||
                  (folderMode === 'new' ? !newFolderName.trim() : !selectedFolderId)
                }
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
              >
                {folderSaving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding…</>
                ) : (
                  <><FolderPlus className="w-4 h-4 mr-2" /> Add to Folder</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {messagesUserId && messagesMember && (() => {
        // Walk prev/next through the currently visible (search-filtered) list.
        const visibleIds = filteredMembers.map(m => m.user_id)
        const navList = visibleIds.includes(messagesUserId) ? visibleIds : [messagesUserId]
        const navIdx = navList.indexOf(messagesUserId)
        const currentTag = memberTags[messagesUserId] ?? null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between p-5 pb-3 border-b border-slate-800">
                <div className="min-w-0">
                  <h2 className="text-base font-bold flex items-center gap-2 truncate">
                    <MessageCircle className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="truncate">{messagesMember.full_name || 'Unknown'}</span>
                  </h2>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {messagesMember.username ? `@${messagesMember.username} · ` : ''}{messagesMember.user_id}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {navList.length > 1 && (
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <button
                        onClick={() => navIdx > 0 && openMessages(navList[navIdx - 1])}
                        disabled={navIdx <= 0}
                        className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"
                        aria-label="Previous user"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="tabular-nums">{navIdx + 1}/{navList.length}</span>
                      <button
                        onClick={() => navIdx < navList.length - 1 && openMessages(navList[navIdx + 1])}
                        disabled={navIdx >= navList.length - 1}
                        className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"
                        aria-label="Next user"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => setMessagesUserId(null)}
                    className="text-slate-400 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-800 bg-slate-800/30">
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Filter:
                </span>
                <TagDots
                  value={currentTag}
                  onChange={(tag) => setMemberTag(messagesUserId, tag)}
                  size="md"
                />
                {currentTag && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${FILTER_TAG_MAP[currentTag].pill}`}>
                    {FILTER_TAG_MAP[currentTag].label}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[200px]">
                {threadLoading ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading messages…
                  </div>
                ) : threadError ? (
                  <div className="text-center text-sm text-red-400 py-8">{threadError}</div>
                ) : threadItems.length === 0 ? (
                  <div className="text-center text-sm text-slate-500 py-8">No messages with this user</div>
                ) : (
                  threadItems.map(msg => (
                    <div key={msg.id} className={`flex ${msg.outgoing ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          msg.outgoing
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        {msg.text
                          ? <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                          : <p className="italic opacity-70">{msg.hasMedia ? `[${msg.mediaType || 'media'}]` : '[no text]'}</p>}
                        {msg.timestamp && (
                          <p className={`text-[10px] mt-1 ${msg.outgoing ? 'text-blue-200' : 'text-slate-500'}`}>
                            {new Date(msg.timestamp).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {composeUserId && composeMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-5 pb-3 border-b border-slate-800">
              <div className="min-w-0">
                <h2 className="text-base font-bold flex items-center gap-2 truncate">
                  <Bookmark className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Message {composeMember.full_name || 'Unknown'}</span>
                </h2>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {composeMember.username ? `@${composeMember.username} · ` : ''}{composeMember.user_id}
                </p>
              </div>
              <button
                onClick={() => setComposeUserId(null)}
                className="text-slate-400 hover:text-white shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Saved messages picker */}
            <div className="px-5 py-3 border-b border-slate-800 space-y-2">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Saved messages</span>
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
                {storedLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading saved messages…
                  </div>
                ) : storedError ? (
                  <div className="px-3 py-4 text-center text-xs text-red-400">{storedError}</div>
                ) : storedMessages.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-500">
                    No saved messages — create one in Stored Messages first.
                  </p>
                ) : (
                  storedMessages.map(m => {
                    const picked = selectedStoredId === m.id
                    const Icon = m.type === 'photo' ? Image : m.type === 'file' ? FileText : MessageCircle
                    return (
                      <button
                        key={m.id}
                        onClick={() => pickStored(m)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/50 ${picked ? 'bg-emerald-900/20' : ''}`}
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${picked ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                          {picked ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-slate-200">
                            {m.content?.trim() || m.fileName || `[${m.type}]`}
                          </span>
                          {m.fileName && (
                            <span className="block truncate text-[10px] text-slate-500">{m.fileName}</span>
                          )}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* Editable compose */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Draft</span>
              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder="Pick a saved message above, or type a message…"
                rows={5}
                className="w-full resize-y rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {!selectedAccountId && (
                <p className="text-[11px] text-amber-400">Select an account to send from.</p>
              )}
              {composeError && <p className="text-xs text-red-400">{composeError}</p>}
            </div>

            <div className="flex gap-2 p-5 pt-3 border-t border-slate-800">
              <Button
                onClick={() => setComposeUserId(null)}
                variant="outline"
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={submitCompose}
                disabled={composeSending || !composeText.trim() || !selectedAccountId}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
              >
                {composeSending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Send</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DataExtractorPage() {
  return (
    <AuthGuard>
      <DataExtractorContent />
    </AuthGuard>
  )
}
