'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import {
  useAuth,
  type CampaignReplyStatsResponse,
  type CampaignRecord,
  type CampaignStartPayload,
  type CampaignStartResponse,
  type CustomFolder,
  type ScrapedMember,
  type StoredMessage,
} from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { BrandedLoader } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Megaphone, Play, Pause, Pencil, BarChart3, Square, Trash2, Search, Plus,
  Activity, MessageCircle, Upload, Users, Contact2, Folder,
  CheckCircle2, XCircle, Send, DoorOpen, AlertCircle, Clock, SkipForward, PlayCircle, Bookmark, FileText,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type Mode = 'list' | 'flow' | 'stats'

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

const TERMINAL_CAMPAIGN_STATUSES = new Set([
  'completed', 'completed_with_failures', 'failed', 'stopped', 'validation_failed',
])

function RestTimer({ restUntil, restSeconds, className }: { restUntil?: string | null, restSeconds?: number | null, className?: string }) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const initialSeconds = Math.max(0, Number(restSeconds || 0))
    const tick = () => {
      if (restUntil) {
        setRemaining(Math.max(0, Math.floor((new Date(restUntil).getTime() - Date.now()) / 1000)))
        return
      }
      setRemaining(Math.max(0, initialSeconds - Math.floor((Date.now() - startedAt) / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [restUntil, restSeconds])
  if (!restUntil && !restSeconds) return <span className={className || 'text-orange-300'}>timer pending</span>
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const str = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  return <span className={(className || 'text-orange-300') + ' tabular-nums'}>{str} remaining</span>
}

const EVENT_CONFIG: Record<string, { icon: LucideIcon, label: string, color: string }> = {
  campaign_started: { icon: PlayCircle, label: 'Started', color: 'text-blue-300' },
  campaign_done: { icon: CheckCircle2, label: 'Completed', color: 'text-emerald-300' },
  campaign_failed: { icon: XCircle, label: 'Failed', color: 'text-rose-300' },
  join_success: { icon: DoorOpen, label: 'Joined group', color: 'text-blue-300' },
  join_failed: { icon: AlertCircle, label: 'Join failed', color: 'text-amber-300' },
  message_sent: { icon: Send, label: 'Sent', color: 'text-emerald-300' },
  message_failed: { icon: XCircle, label: 'Send failed', color: 'text-rose-300' },
  message_skipped: { icon: SkipForward, label: 'Skipped', color: 'text-slate-300' },
  account_rest: { icon: Clock, label: 'Resting', color: 'text-red-400' },
  scrape_done: { icon: CheckCircle2, label: 'Scraped', color: 'text-blue-300' },
  scrape_failed: { icon: AlertCircle, label: 'Scrape failed', color: 'text-amber-300' },
}

function stateChip(state: string) {
  const normalized = String(state || 'idle').toLowerCase()
  if (normalized === 'cooldown') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
  if (normalized === 'resting') return 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
  if (normalized === 'blocked' || normalized === 'failed') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
  if (normalized === 'active') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
  return 'bg-slate-500/15 text-slate-300 border border-slate-600'
}

function eventColor(type?: string) {
  if (type === 'message_sent' || type === 'campaign_done') return 'text-emerald-300'
  if (type === 'message_failed' || type === 'campaign_failed') return 'text-rose-300'
  if (type === 'join_failed' || type === 'scrape_failed') return 'text-amber-300'
  if (type === 'account_rest') return 'text-orange-300'
  if (type === 'join_success' || type === 'scrape_done' || type === 'campaign_started') return 'text-blue-300'
  return 'text-slate-300'
}

function CampaignWorkspace() {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const {
    user, listCampaigns, createCampaign, updateCampaign, deleteCampaign,
    startCampaign, pauseCampaign, removePreviouslyMessagedTargets,
    listGroupsForAccount, scrapeGroupMembers,
    scrapeCampaignContacts, refreshCampaignReplyStats,
    listCustomFolders, loadFolderCampaignTargets,
    listStoredMessages,
  } = useAuth()

  const [mode, setMode] = useState<Mode>('list')
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [campaignName, setCampaignName] = useState('')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [sourceAccountId, setSourceAccountId] = useState<string>('')
  const [selectedGroup, setSelectedGroup] = useState<{id: string, title: string, username?: string | null} | null>(null)
  const [groups, setGroups] = useState<Array<{id: string, title: string, username?: string | null}>>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [searchTriggered, setSearchTriggered] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [dailyMessageLimitPerAccount, setDailyMessageLimitPerAccount] = useState(10)
  const [messages, setMessages] = useState<string[]>([''])
  const [messageInterval, setMessageInterval] = useState(5)
  const [autoMessageInterval, setAutoMessageInterval] = useState(true)
  const [blacklistedUsers, setBlacklistedUsers] = useState<string[]>([])
  const [sourceAccountSearch, setSourceAccountSearch] = useState('')
  const [messagingAccountSearch, setMessagingAccountSearch] = useState('')
  const [scrapedMembers, setScrapedMembers] = useState<ScrapedMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [campaignType, setCampaignType] = useState<'group' | 'username' | 'contact' | 'folder'>('group')
  const [usernamesCsv, setUsernamesCsv] = useState('')
  const [parsedUsernames, setParsedUsernames] = useState<string[]>([])
  const [contactAccountId, setContactAccountId] = useState('')
  const [contactLoading, setContactLoading] = useState(false)
  const [loadedContacts, setLoadedContacts] = useState<Array<{userId: string; username?: string | null; displayName?: string; phone?: string}>>([])
  const [folders, setFolders] = useState<CustomFolder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [resolutionGroup, setResolutionGroup] = useState('')
  const [folderFilterTags, setFolderFilterTags] = useState<string[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderTargets, setFolderTargets] = useState<Array<{userId: string; username?: string | null; displayName?: string}>>([])
  const [sortByActivity, setSortByActivity] = useState<'most_recent' | 'least_recent' | null>(null)
  const [skipMessaged, setSkipMessaged] = useState(false)
  const [followUpEnabled, setFollowUpEnabled] = useState(false)
  const [followUpSteps, setFollowUpSteps] = useState<Array<{ delayHours: number; message: string }>>([{ delayHours: 24, message: '' }])
  const [storedMessages, setStoredMessages] = useState<StoredMessage[]>([])
  const [storedPopoverOpen, setStoredPopoverOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nextMsgRemaining, setNextMsgRemaining] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<CampaignStartResponse | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [selectedStatsAccountId, setSelectedStatsAccountId] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState('')
  const [lastReplyFetch, setLastReplyFetch] = useState<string | null>(null)

  const accountCount = user?.connectedAccounts.length || 0

  const sourceAccount = useMemo(() => {
    if (!user || !sourceAccountId) return null
    return user.connectedAccounts.find(a => a.id === sourceAccountId) || null
  }, [user, sourceAccountId])

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  )

  const selectedCampaignSummary = useMemo(() => {
    const campaignSummary = selectedCampaign?.lastRunSummary || null
    if (campaignSummary) return campaignSummary
    if (runResult && runResult.campaignId === selectedCampaignId) return runResult
    return null
  }, [selectedCampaign, runResult, selectedCampaignId])

  const sentItemsForSelectedStatsAccount = useMemo(() => {
    const items = selectedCampaignSummary?.sentItems || []
    if (!selectedStatsAccountId) return []
    return items.filter((item) => item.accountId === selectedStatsAccountId)
  }, [selectedCampaignSummary, selectedStatsAccountId])

  const accountHealthSummary = useMemo(() => {
    const stats = selectedCampaignSummary?.accountStats || []
    let active = 0, resting = 0, blocked = 0, idle = 0
    for (const item of stats) {
      const state = String(item.state || 'idle').toLowerCase()
      if (state === 'active') active += 1
      else if (state === 'resting' || state === 'cooldown') resting += 1
      else if (state === 'blocked') blocked += 1
      else idle += 1
    }
    return { active, resting, blocked, idle }
  }, [selectedCampaignSummary])

  const perAccountChartData = useMemo(
    () => (selectedCampaignSummary?.accountStats || []).map((item) => ({
      account: item.accountLabel,
      sent: item.sentCount || 0,
      failures: item.sendFailures || 0,
    })),
    [selectedCampaignSummary]
  )

  const statusChartData = useMemo(() => {
    if (!selectedCampaignSummary) return []
    const total = selectedCampaignSummary.totalTargets || 0
    const sent = selectedCampaignSummary.sentCount || 0
    const unresolved = selectedCampaignSummary.unresolvedTargets || 0
    const skipped = selectedCampaignSummary.skippedCount ?? 0
    const remaining = Math.max(0, total - sent - (selectedCampaignSummary.sendFailures || 0) - unresolved - skipped)
    return [
      { name: 'Sent', value: sent, color: '#22c55e' },
      { name: 'Skipped', value: skipped, color: '#fbbf24' },
      { name: 'Unresolved', value: unresolved, color: '#f59e0b' },
      { name: 'Remaining', value: remaining, color: '#60a5fa' },
    ].filter((item) => item.value > 0)
  }, [selectedCampaignSummary])

  const campaignAttemptedCount = useMemo(
    () => (selectedCampaignSummary?.sentCount || 0) + (selectedCampaignSummary?.sendFailures || 0),
    [selectedCampaignSummary]
  )

  const campaignReplyRows = useMemo(
    () => (selectedCampaignSummary?.sentItems || [])
      .filter((item) => item.replied && item.success !== false)
      .sort((a, b) => String(b.lastReplyAt || '').localeCompare(String(a.lastReplyAt || ''))),
    [selectedCampaignSummary]
  )

  const outcomeChartData = useMemo(() => {
    if (!selectedCampaignSummary) return []
    const sent = selectedCampaignSummary.sentCount || 0
    const failed = selectedCampaignSummary.sendFailures || 0
    const replied = selectedCampaignSummary.repliedTargets || 0
    const pending = Math.max(0, sent - replied)
    return [
      { name: 'Replied', value: replied, fill: '#60a5fa' },
      { name: 'No Reply', value: pending, fill: '#22c55e' },
      { name: 'Failed', value: failed, fill: '#ef4444' },
    ].filter((item) => item.value > 0)
  }, [selectedCampaignSummary])

  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: {
    cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; value: number
  }) => {
    if (!value) return null
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.55
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {value}
      </text>
    )
  }

  const openMessageThread = (accountId?: string | null, chatId?: string | null) => {
    if (!accountId || !chatId) return
    const item = campaignReplyRows.find((reply) => reply.accountId === accountId && String(reply.chatId || reply.target) === String(chatId))
    const target = item?.target ? `&target=${encodeURIComponent(item.target)}` : ''
    router.push(`/dashboard/unibox?account_id=${encodeURIComponent(accountId)}&chat_id=${encodeURIComponent(chatId)}${target}`)
  }

  const lastSenderAccountId = useMemo(() => {
    const items = selectedCampaignSummary?.sentItems || []
    if (!items.length) return null
    return items[items.length - 1]?.accountId || null
  }, [selectedCampaignSummary])

  const campaignActivityLog = useMemo(
    () => selectedCampaignSummary?.activityLog || [],
    [selectedCampaignSummary]
  )

  const accountNameLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of user?.connectedAccounts || []) {
      map.set(a.id, a.displayName || a.username || a.phone || a.id.slice(0, 8))
    }
    return map
  }, [user?.connectedAccounts])

  const filteredCampaigns = useMemo(() => {
    if (!listSearch.trim()) return campaigns
    const needle = listSearch.toLowerCase()
    return campaigns.filter((c) =>
      c.name.toLowerCase().includes(needle) || c.status.toLowerCase().includes(needle)
    )
  }, [campaigns, listSearch])

  const estimatedTimeRemaining = useMemo(() => {
    if (!selectedCampaignSummary) return null
    const remaining = Math.max(0,
      (selectedCampaignSummary.totalTargets || 0)
      - (selectedCampaignSummary.sentCount || 0)
      - (selectedCampaignSummary.sendFailures || 0)
      - (selectedCampaignSummary.unresolvedTargets || 0)
      - (selectedCampaignSummary.skippedCount || 0)
    )
    const interval = selectedCampaignSummary.messageIntervalSeconds || 5
    const totalSeconds = remaining * interval
    const minutes = Math.floor(totalSeconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`
    return `${totalSeconds}s`
  }, [selectedCampaignSummary])

  const loadCampaigns = async () => {
    setLoadingCampaigns(true)
    try {
      const items = await listCampaigns()
      setCampaigns(items)
      return items
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns')
      return []
    } finally {
      setLoadingCampaigns(false)
    }
  }

  useEffect(() => { loadCampaigns() }, [])

  const applyReplyStats = useCallback(
    (summary: CampaignStartResponse | null, replyStats: CampaignReplyStatsResponse | null): CampaignStartResponse | null => {
      if (!replyStats || !summary) return summary
      return {
        ...summary,
        repliedTargets: replyStats.repliedTargets ?? summary.repliedTargets,
        replyMessages: replyStats.replyMessages ?? summary.replyMessages,
        accountStats: (summary.accountStats || []).map((acc) => {
          const r = replyStats.accountStats.find((a) => a.accountId === acc.accountId)
          return r ? { ...acc, repliedTargets: r.repliedTargets, replyMessages: r.replyMessages } : acc
        }),
        sentItems: (summary.sentItems || []).map((item) => {
          const r = replyStats.targetStats.find((t) => t.target === item.target && t.accountId === item.accountId)
          return r ? { ...item, replied: r.replied, replyMessages: r.replyMessages, lastReplyAt: r.lastReplyAt } : item
        }),
      }
    },
    []
  )

  // Poll running campaign status
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    const isRunning = mode === 'stats' && selectedCampaignId != null && selectedCampaign?.status === 'running'
    if (!isRunning) return

    const doPoll = async () => {
      try {
        const [items, replyStats] = await Promise.all([
          listCampaigns(),
          refreshCampaignReplyStats(selectedCampaignId!),
        ])
        setCampaigns(items.map((c) =>
          c.id === selectedCampaignId
            ? { ...c, lastRunSummary: applyReplyStats(c.lastRunSummary || null, replyStats) }
            : c
        ))
        setLastReplyFetch(replyStats.generatedAt)
      } catch { /* silent */ }
    }

    doPoll()
    pollRef.current = window.setInterval(doPoll, 4000)

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [mode, selectedCampaignId, selectedCampaign?.status])

  // Live countdown for next message
  useEffect(() => {
    const tick = () => {
      const items = selectedCampaignSummary?.sentItems || []
      if (!items.length) { setNextMsgRemaining(null); return }
      const last = items[items.length - 1]
      if (!last?.sentAt) { setNextMsgRemaining(null); return }
      const interval = selectedCampaignSummary?.messageIntervalSeconds || 5
      const nextTime = new Date(last.sentAt).getTime() + interval * 1000
      setNextMsgRemaining(Math.max(0, Math.floor((nextTime - Date.now()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [selectedCampaignSummary])

  // Keep campaign list status fresh while in list view (running campaigns complete, etc.)
  useEffect(() => {
    if (mode !== 'list') return
    const id = window.setInterval(() => { loadCampaigns() }, 30_000)
    return () => window.clearInterval(id)
  }, [mode])

  const safeNumber = (value: string, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  const resetFlow = () => {
    setEditingCampaignId(null); setCampaignName('')
    setSelectedAccountIds([]); setSourceAccountId(''); setSelectedGroup(null); setGroups([])
    setDailyMessageLimitPerAccount(10); setMessages(['']); setMessageInterval(5); setAutoMessageInterval(true)
    setBlacklistedUsers([]); setScrapedMembers([])
    setCampaignType('group'); setUsernamesCsv(''); setParsedUsernames([])
    setContactAccountId(''); setContactLoading(false); setLoadedContacts([])
    setFolders([]); setSelectedFolderId(''); setResolutionGroup(''); setFolderLoading(false); setFolderTargets([]); setFolderFilterTags([])
    setFollowUpEnabled(false); setFollowUpSteps([{ delayHours: 24, message: '' }])
    setSearchTriggered(false); setGroupSearch('')
    setError(null); setRunResult(null); setSelectedCampaignId(null); setFlowTab('basics')
  }

  const openCreateFlow = () => { resetFlow(); setMode('flow') }

  const openEditFlow = (campaign: CampaignRecord) => {
    const ct = (campaign.campaignType || 'group') as 'group' | 'username' | 'contact' | 'folder'
    setEditingCampaignId(campaign.id); setCampaignName(campaign.name)
    setSelectedAccountIds(campaign.accountIds || [])
    setSourceAccountId((campaign.accountIds || [])[0] || '')
    setDailyMessageLimitPerAccount(campaign.dailyMessageLimitPerAccount || 10)
    setMessages(campaign.messages?.length ? campaign.messages : [''])
    setMessageInterval(campaign.messageIntervalSeconds || 5)
    setAutoMessageInterval(true)
    setBlacklistedUsers(campaign.blacklistedUsers || [])
    setScrapedMembers([])
    setCampaignType(ct)
    setUsernamesCsv(ct === 'username' ? campaign.targetsCsv : '')
    setParsedUsernames(ct === 'username' ? campaign.targetsCsv.split(',').map(s => s.trim()).filter(Boolean) : [])
    setContactAccountId(ct === 'contact' ? (campaign.accountIds || [])[0] || '' : '')
    setLoadedContacts(campaign.scrapedTargets || [])
    setSelectedFolderId(ct === 'folder' ? (campaign.sourceFolder || '') : '')
    setResolutionGroup(ct === 'folder' ? (campaign.resolutionGroup || '') : '')
    setFolderFilterTags(ct === 'folder' ? (campaign.folderFilterTags || []) : [])
    setFolderTargets(campaign.scrapedTargets || [])
    setFollowUpEnabled(!!campaign.followUp?.enabled)
    setFollowUpSteps(campaign.followUp?.steps?.length ? campaign.followUp.steps : [{ delayHours: 24, message: '' }])
    setSelectedGroup(campaign.sourceGroup ? {id: campaign.sourceGroup, title: campaign.sourceGroup, username: /^-?\d+$/.test(campaign.sourceGroup) ? null : campaign.sourceGroup} : null)
    setError(null); setRunResult(null); setMode('flow'); setFlowTab('basics')
  }

  const suggestedIntervalSeconds = useMemo(() => {
    // Spread messages evenly across 24 hours while rotating accounts.
    // totalMessagesPerDay = accounts * dailyLimitPerAccount
    const accountCount = selectedAccountIds.length
    const perAccount = Math.max(1, Math.floor(Number(dailyMessageLimitPerAccount) || 0))
    const totalPerDay = Math.max(1, accountCount * perAccount)
    const raw = 86400 / totalPerDay
    return Math.max(1, Math.floor(raw))
  }, [selectedAccountIds.length, dailyMessageLimitPerAccount])

  useEffect(() => {
    if (!autoMessageInterval) return
    setMessageInterval(suggestedIntervalSeconds)
  }, [autoMessageInterval, suggestedIntervalSeconds])

  const goBackToList = async () => { setMode('list'); setError(null); await loadCampaigns() }

  const loadGroups = async () => {
    const accountIdToUse = sourceAccountId || selectedAccountIds[0] || ''
    if (!accountIdToUse) {
      setError('Please select a source account first')
      return
    }
    setLoadingGroups(true)
    setError(null)
    let timedOut = false
    try {
      const timeout = setTimeout(() => {
        timedOut = true
        setError('Loading groups timed out.')
        setLoadingGroups(false)
      }, 15000)
      const groups = await listGroupsForAccount(accountIdToUse, 200)
      clearTimeout(timeout)
      if (timedOut) return
      setGroups(groups || [])
      if (!groups || groups.length === 0) {
        setError('No groups found for this account. Make sure the account has joined groups and is online.')
      } else {
        setError(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  const loadMembers = async () => {
    const accountIdToUse = sourceAccountId || selectedAccountIds[0] || ''
    if (!accountIdToUse) {
      setError('Select a source account first')
      return
    }
    if (!selectedGroup?.id) {
      setError('Select a group first')
      return
    }
    setLoadingMembers(true)
    setError(null)
    try {
      const result = await scrapeGroupMembers(accountIdToUse, selectedGroup.id)
      setScrapedMembers(result.members || [])
      if (!result.members || result.members.length === 0) {
        setError('No members found in this group')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load members')
      setScrapedMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  const toggleBlacklistMember = (memberId: string) => {
    setBlacklistedUsers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    )
  }

  const updateMessage = (index: number, value: string) => {
    setMessages((prev) => prev.map((item, i) => (i === index ? value : item)))
  }

  const addMessage = () => { setMessages((prev) => [...prev, '']) }
  const removeMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index))
  }

  const loadStoredMessages = useCallback(async () => {
    try {
      const res = await listStoredMessages()
      setStoredMessages(res.messages.filter((m) => m.type === 'text'))
    } catch {
      // silently fail
    }
  }, [listStoredMessages])

  const addStoredMessage = (msg: StoredMessage) => {
    setMessages((prev) => [...prev, msg.content])
    setStoredPopoverOpen(false)
  }

  const updateFollowUpStep = (index: number, patch: Partial<{ delayHours: number; message: string }>) => {
    setFollowUpSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }
  const addFollowUpStep = () => {
    setFollowUpSteps((prev) => [...prev, { delayHours: prev.length ? (prev[prev.length - 1].delayHours + 24) : 24, message: '' }])
  }
  const removeFollowUpStep = (index: number) => {
    setFollowUpSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const getPayload = (): CampaignStartPayload => ({
    name: campaignName,
    accountIds: selectedAccountIds,
    dailyMessageLimitPerAccount,
    messages,
    targetsCsv: campaignType === 'username' ? usernamesCsv : '',
    sourceGroup: campaignType === 'group' ? (selectedGroup?.username || selectedGroup?.id || '') : undefined,
    sourceFolder: campaignType === 'folder' ? selectedFolderId : undefined,
    resolutionGroup: campaignType === 'folder' ? resolutionGroup.trim() : undefined,
    folderFilterTags: campaignType === 'folder' ? folderFilterTags : undefined,
    blacklistedUsers,
    messageIntervalSeconds: messageInterval,
    campaignType,
    sortByActivity: sortByActivity || undefined,
    skipMessaged,
    followUp: { enabled: followUpEnabled, steps: followUpSteps },
  })

  const saveCampaign = async () => {
    const payload = getPayload()
    if (editingCampaignId) {
      const updated = await updateCampaign(editingCampaignId, payload)
      setEditingCampaignId(updated.id)
      return updated
    }
    const created = await createCampaign(payload)
    setEditingCampaignId(created.id)
    return created
  }

  const handleSaveDraft = async () => {
    setIsSubmitting(true); setError(null)
    try { await saveCampaign(); await loadCampaigns(); setMode('list') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save campaign') }
    finally { setIsSubmitting(false) }
  }

  const handleSaveAndStart = async () => {
    setIsSubmitting(true); setError(null); setRunResult(null); setMode('stats')
    try {
      const campaign = await saveCampaign()
      setSelectedCampaignId(campaign.id)
      const result = await startCampaign(campaign.id)
      setRunResult(result)
      await loadCampaigns()
    } catch (err) {
      setMode('flow')
      setError(err instanceof Error ? err.message : 'Failed to start campaign')
    }
    finally { setIsSubmitting(false) }
  }

  const handleStartFromList = async (campaignId: string) => {
    setIsSubmitting(true); setError(null); setMode('stats'); setSelectedCampaignId(campaignId)
    try { const result = await startCampaign(campaignId); setRunResult(result); await loadCampaigns() }
    catch (err) { setMode('list'); setError(err instanceof Error ? err.message : 'Failed to start campaign') }
    finally { setIsSubmitting(false) }
  }

  const handleStopFromList = async (campaignId: string) => {
    setIsSubmitting(true); setError(null); setSelectedCampaignId(campaignId)
    try { const updated = await pauseCampaign(campaignId); setRunResult(updated.lastRunSummary || null); await loadCampaigns(); setMode('stats') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to stop campaign') }
    finally { setIsSubmitting(false) }
  }

  const openCampaignStats = (campaign: CampaignRecord) => {
    setSelectedCampaignId(campaign.id); setRunResult(campaign.lastRunSummary || null)
    setSelectedStatsAccountId(null); setError(null); setMode('stats')
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || ''
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const parsed: string[] = []
      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim()).filter(Boolean)
        for (const p of parts) {
          if (p && !parsed.includes(p)) parsed.push(p)
        }
      }
      setParsedUsernames(parsed)
      setUsernamesCsv(parsed.join(','))
      setError(null)
    }
    reader.onerror = () => { setParsedUsernames([]); setUsernamesCsv(''); setError('Failed to read file') }
    reader.readAsText(file)
    // Reset the input so the same file can be re-uploaded
    e.target.value = ''
  }

  const handleLoadContacts = async () => {
    if (!contactAccountId) {
      setError('Select an account to extract contacts from')
      return
    }
    try {
      setContactLoading(true)
      setError(null)
      // Auto-save campaign first to get an ID if needed
      let campaignId = editingCampaignId
      if (!campaignId) {
        // Build payload directly to avoid stale React state issues
        const msgs = messages.some(m => m.trim()) ? messages : ['Hello']
        const payload: CampaignStartPayload = {
          name: campaignName || 'Contact Campaign',
          accountIds: selectedAccountIds,
          dailyMessageLimitPerAccount,
          messages: msgs,
          targetsCsv: '',
          blacklistedUsers,
          messageIntervalSeconds: messageInterval,
          campaignType: 'contact',
        }
        const saved = await createCampaign(payload)
        campaignId = saved.id
        setEditingCampaignId(campaignId)
        setMessages(msgs)
      }
      const result = await scrapeCampaignContacts(campaignId)
      setLoadedContacts(result.contacts || [])
      if (!result.contacts || result.contacts.length === 0) {
        setError('No contacts found for this account')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load contacts')
    } finally {
      setContactLoading(false)
    }
  }

  const toggleBlacklistContact = (contactId: string) => {
    setBlacklistedUsers(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    )
  }

  const exportCsv = useCallback((passed: boolean) => {
    const items = selectedCampaignSummary?.sentItems || []
    const filtered = items.filter(item => passed ? !item.error : item.error)
    if (!filtered.length) {
      setError(passed ? 'No passed messages to export' : 'No failed messages to export')
      return
    }
    const accountMap = new Map((user?.connectedAccounts || []).map(a => [a.id, a]))
    const header = 'target,account,telegramId,sentAt,message' + (passed ? '' : ',error')
    const rows = filtered.map(item => {
      const acct = accountMap.get(item.accountId)
      const accountLabel = acct?.displayName || acct?.username || item.accountId.slice(0, 8)
      const telegramId = acct?.telegramId || ''
      return [
        item.target,
        accountLabel,
        telegramId,
        item.sentAt,
        `"${(item.message || '').replace(/"/g, '""')}"`,
        ...(passed ? [] : [`"${(item.error || '').replace(/"/g, '""')}"`]),
      ].join(',')
    })
    const csv = '\uFEFF' + header + '\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedCampaign?.name || 'campaign'}_${passed ? 'passed' : 'failed'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [selectedCampaignSummary, selectedCampaign, user])

  const handleRemovePreviouslyMessaged = async () => {
    if (!selectedCampaignId) return
    setIsSubmitting(true); setError(null)
    try { const updated = await removePreviouslyMessagedTargets(selectedCampaignId); setRunResult(updated.lastRunSummary || null); await loadCampaigns() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to remove previously messaged targets') }
    finally { setIsSubmitting(false) }
  }

  const handleStopSelectedCampaign = async () => {
    if (!selectedCampaignId) return
    setIsSubmitting(true); setError(null)
    try { const updated = await pauseCampaign(selectedCampaignId); setRunResult(updated.lastRunSummary || null); await loadCampaigns() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to stop campaign') }
    finally { setIsSubmitting(false) }
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  // Tabbed flow navigation
  const [flowTab, setFlowTab] = useState<'basics' | 'accounts' | 'settings' | 'review'>('basics')

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return
    setIsSubmitting(true); setError(null)
    try { await deleteCampaign(pendingDeleteId); if (selectedCampaignId === pendingDeleteId) { setSelectedCampaignId(null); setRunResult(null) } await loadCampaigns(); setMode('list') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete campaign') }
    finally { setIsSubmitting(false); setPendingDeleteId(null) }
  }

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <Megaphone className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold">Campaigns</h1>
          {mode === 'list' && (
            <Button onClick={openCreateFlow} size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-1" /> New
            </Button>
          )}
          {mode !== 'list' && (
            <Button variant="outline" size="sm" onClick={goBackToList} className="ml-auto border-slate-700">
              Back
            </Button>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 p-4">
          <div className="h-full rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden grid grid-cols-1 lg:grid-cols-[280px_1fr_300px]">
            {/* Left Panel - Campaign List */}
            <aside className="border-r border-slate-800 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <Input
                    placeholder="Search campaigns..."
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    className="pl-8 bg-slate-800 border-slate-700 text-xs h-8"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
                {loadingCampaigns ? (
                  <div className="p-6"><BrandedLoader label="Loading campaigns" /></div>
                ) : filteredCampaigns.length === 0 ? (
                  <div className="p-4 text-sm text-slate-400 text-center">
                    {campaigns.length === 0 ? 'No campaigns yet' : 'No matches'}
                  </div>
                ) : (
                  filteredCampaigns.map((campaign) => {
                    const active = campaign.id === selectedCampaignId
                    return (
                      <div
                        key={campaign.id}
                        className={`px-3 py-3 cursor-pointer transition ${active ? 'bg-blue-500/15' : 'hover:bg-slate-800/50'}`}
                      >
                        <button
                          onClick={() => openCampaignStats(campaign)}
                          className="w-full text-left"
                        >
                          <p className="text-sm font-medium truncate">{campaign.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {campaign.status} • {new Date(campaign.updatedAt).toLocaleDateString()}
                          </p>
                        </button>
                        <div className="flex items-center gap-1 mt-1.5">
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-white"
                            onClick={(e) => { e.stopPropagation(); openEditFlow(campaign) }}
                          >
                            <Pencil className="w-3 h-3 mr-1" /> Edit
                          </Button>
                          {!TERMINAL_CAMPAIGN_STATUSES.has(campaign.status) && campaign.status !== 'paused' && (
                            <Button
                              variant="ghost" size="sm"
                              className={`h-6 px-1.5 text-[10px] ${campaign.status === 'running' ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                campaign.status === 'running' ? handleStopFromList(campaign.id) : handleStartFromList(campaign.id)
                              }}
                              disabled={isSubmitting}
                            >
                              {campaign.status === 'running' ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                              {campaign.status === 'running' ? 'Pause' : 'Start'}
                            </Button>
                          )}
                          {campaign.status === 'paused' && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-6 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300"
                              onClick={(e) => { e.stopPropagation(); handleStartFromList(campaign.id) }}
                              disabled={isSubmitting}
                            >
                              <Play className="w-3 h-3 mr-1" /> Resume
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 px-1.5 text-[10px] text-rose-400 hover:text-rose-300 ml-auto"
                            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(campaign.id) }}
                            disabled={isSubmitting}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </aside>

            {/* Middle Panel - Flow or Stats Content */}
            <section className="flex flex-col min-h-0 overflow-y-auto">
              {mode === 'list' && (
                <div className="h-full flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    <Megaphone className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">Select a campaign or create a new one</p>
                  </div>
                </div>
              )}

              {mode === 'flow' && (
                <div className="p-6 flex flex-col min-h-0">
                  {/* Tab Bar */}
                  <div className="flex gap-1 bg-slate-800/40 rounded-lg p-1 mb-4 shrink-0 overflow-x-auto">
                    {([
                      { key: 'basics', label: 'Basics' },
                      { key: 'accounts', label: 'Accounts' },
                      { key: 'settings', label: 'Settings' },
                      { key: 'review', label: 'Review & Launch' },
                    ] as const).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setFlowTab(tab.key)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition ${
                          flowTab === tab.key
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 overflow-y-auto space-y-8">
                    {flowTab === 'basics' && (
                      <>
                        {/* Campaign Name */}
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Campaign Name</h3>
                          <Input
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            placeholder="Spring Outreach Campaign"
                            className="max-w-xl bg-slate-800 border-slate-700"
                          />
                        </div>

                        {/* Campaign Type Selector */}
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Campaign Type</h3>
                          <div className="flex gap-2">
                            {(['group', 'username', 'contact', 'folder'] as const).map((ct) => (
                              <button
                                key={ct}
                                type="button"
                                onClick={() => {
                                  setCampaignType(ct)
                                  setError(null)
                                }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border ${
                                  campaignType === ct
                                    ? 'bg-blue-600 border-blue-500 text-white'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                                }`}
                              >
                                {ct === 'group' && <Users className="w-4 h-4" />}
                                {ct === 'username' && <Upload className="w-4 h-4" />}
                                {ct === 'contact' && <Contact2 className="w-4 h-4" />}
                                {ct === 'folder' && <Folder className="w-4 h-4" />}
                                <span className="capitalize">{ct} Campaign</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Group Mode: Source Account + Group Selector */}
                        {campaignType === 'group' && (
                          <>
                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Source Account (for group list)</h3>
                              <p className="text-sm text-slate-400">
                                This account must already be in the group. Select an account, then click &apos;Load Groups&apos; to fetch the group list.
                              </p>
                              <Input
                                value={sourceAccountSearch}
                                onChange={(e) => setSourceAccountSearch(e.target.value)}
                                placeholder="Search accounts..."
                                className="bg-slate-800 border-slate-700"
                              />
                              {accountCount === 0 ? (
                                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                                  <p>No connected accounts found.</p>
                                </div>
                              ) : (
                                <div className="grid gap-2 md:grid-cols-2 max-h-64 overflow-y-auto">
                                  {user?.connectedAccounts.filter(a =>
                                    !sourceAccountSearch ||
                                    (a.displayName || '').toLowerCase().includes(sourceAccountSearch.toLowerCase()) ||
                                    (a.username || '').toLowerCase().includes(sourceAccountSearch.toLowerCase()) ||
                                    (a.id || '').toLowerCase().includes(sourceAccountSearch.toLowerCase())
                                  ).map((account) => (
                                    <label
                                      key={account.id}
                                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                                        sourceAccountId === account.id
                                          ? 'border-blue-500 bg-blue-500/10'
                                          : 'border-slate-700 bg-slate-800/50'
                                      } ${account.status !== 'online' ? 'opacity-60' : ''}`}
                                    >
                                      <input
                                        type="radio"
                                        name="sourceAccount"
                                        checked={sourceAccountId === account.id}
                                        onChange={() => {
                                          setSourceAccountId(account.id)
                                          setGroups([])
                                          setSelectedGroup(null)
                                          setSearchTriggered(false)
                                          setGroupSearch('')
                                        }}
                                        className="text-blue-500"
                                        disabled={account.status !== 'online'}
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm font-medium">{account.displayName || account.username}</p>
                                        <p className="text-[11px] text-slate-500">@{account.username}</p>
                                        <p className="text-[10px] mt-0.5">
                                          {account.status === 'online' ? '🟢 Online' : '⚫ Offline'}
                                        </p>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              )}
                              <Button
                                onClick={() => { setSearchTriggered(true); loadGroups() }}
                                disabled={!sourceAccountId || loadingGroups}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                              >
                                {loadingGroups ? (
                                  <>Loading...</>
                                ) : (
                                  <>&#9654; Load Groups</>
                                )}
                              </Button>
                            </div>

                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Select Group</h3>
                              <p className="text-xs text-slate-500">
                                Source Account: <span className="text-white">{sourceAccount?.displayName || sourceAccount?.username || '-'}</span>
                              </p>
                              {!sourceAccountId ? (
                                <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm text-slate-300">
                                  Select a source account to load groups.
                                </div>
                              ) : loadingGroups ? (
                                <BrandedLoader label="Loading groups" className="p-3" />
                              ) : !searchTriggered && groups.length === 0 ? (
                                <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-sm text-slate-300">
                                  Click &apos;Load Groups&apos; to fetch the group list for this account.
                                </div>
                              ) : groups.length === 0 ? (
                                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                                  <p>No groups found for this account.</p>
                                  <p className="text-xs mt-1">Make sure the account has joined groups and is online.</p>
                                  <Button variant="outline" size="sm" onClick={loadGroups} disabled={loadingGroups} className="mt-2">
                                    {loadingGroups ? 'Loading...' : 'Retry'}
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    <Input
                                      placeholder="Search groups..."
                                      value={groupSearch}
                                      onChange={(e) => setGroupSearch(e.target.value)}
                                      className="pl-9"
                                    />
                                  </div>
                                  <div className="grid gap-2 max-h-56 overflow-y-auto">
                                    {groups.filter((g) =>
                                      !groupSearch ||
                                      g.title.toLowerCase().includes(groupSearch.toLowerCase()) ||
                                      (g.username && g.username.toLowerCase().includes(groupSearch.toLowerCase()))
                                    ).map((group) => (
                                      <label
                                        key={group.id}
                                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                                          selectedGroup?.id === group.id
                                            ? 'border-blue-500 bg-blue-500/10'
                                            : 'border-slate-700 bg-slate-800/50'
                                        }`}
                                      >
                                        <input
                                          type="radio"
                                          name="group"
                                          checked={selectedGroup?.id === group.id}
                                          onChange={() => setSelectedGroup(group)}
                                          className="text-blue-500"
                                        />
                                        <div className="flex-1">
                                          <p className="text-sm font-medium">{group.title}</p>
                                          <p className="text-[11px] text-slate-500">{group.username ? `@${group.username}` : group.id}</p>
                                        </div>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Group Members (blacklist)</h3>
                              <p className="text-xs text-slate-400">
                                Check members you want to <span className="text-red-400">exclude</span> from messaging.
                              </p>
                              <div className="flex gap-2">
                              <Button
                                onClick={loadMembers}
                                disabled={loadingMembers || !sourceAccountId || !selectedGroup}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                {loadingMembers ? 'Loading...' : 'Load Members'}
                              </Button>
                                {blacklistedUsers.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setBlacklistedUsers([])}
                                    className="border-slate-700 text-xs"
                                  >
                                    Clear ({blacklistedUsers.length})
                                  </Button>
                                )}
                              </div>
                              {scrapedMembers.length > 0 && (
                                <div className="rounded-lg border border-slate-700 bg-slate-800/30 max-h-64 overflow-y-auto">
                                  {scrapedMembers.map((member) => {
                                    const memberId = member.username || member.user_id
                                    const isChecked = blacklistedUsers.includes(memberId)
                                    return (
                                      <label
                                        key={member.user_id}
                                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition hover:bg-slate-700/50 ${
                                          isChecked ? 'bg-red-500/10' : ''
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => toggleBlacklistMember(memberId)}
                                          className="text-red-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm truncate">{member.full_name}</p>
                                          <p className="text-[11px] text-slate-500">
                                            {member.username ? `@${member.username}` : member.user_id}
                                          </p>
                                        </div>
                                        {isChecked && (
                                          <span className="text-[10px] text-red-400 font-medium shrink-0">Excluded</span>
                                        )}
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {/* Username Mode: File Upload */}
                        {campaignType === 'username' && (
                          <div className="space-y-3">
                            <h3 className="text-lg font-semibold">Upload Usernames</h3>
                            <p className="text-sm text-slate-400">
                              Upload a CSV or text file with usernames (one per line or comma-separated).
                            </p>
                            <label className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/30 p-8 cursor-pointer hover:border-blue-500 hover:bg-slate-800/50 transition">
                              <Upload className="w-8 h-8 text-slate-400" />
                              <span className="text-sm text-slate-300">
                                {parsedUsernames.length > 0
                                  ? `${parsedUsernames.length} usernames loaded`
                                  : 'Click to select a file'}
                              </span>
                              <input
                                type="file"
                                accept=".csv,.txt"
                                onChange={handleFileUpload}
                                className="hidden"
                              />
                            </label>
                            {parsedUsernames.length > 0 && (
                              <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-3 max-h-48 overflow-y-auto">
                                <p className="text-xs text-slate-400 mb-2">Preview ({parsedUsernames.length} total):</p>
                                <div className="flex flex-wrap gap-1">
                                  {parsedUsernames.slice(0, 50).map((u, i) => (
                                    <span key={i} className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-200">
                                      @{u}
                                    </span>
                                  ))}
                                  {parsedUsernames.length > 50 && (
                                    <span className="text-xs text-slate-500">+{parsedUsernames.length - 50} more</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Folder Mode: Folder Picker + Load Folder Targets */}
                        {campaignType === 'folder' && (
                          <>
                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Source Folder</h3>
                              <p className="text-sm text-slate-400">
                                Select a custom folder to use as the source of campaign targets.
                              </p>
                              <Button
                                onClick={async () => {
                                  try {
                                    setFolderLoading(true)
                                    setError(null)
                                    const result = await listCustomFolders()
                                    setFolders(result.folders || [])
                                    if (!result.folders || result.folders.length === 0) {
                                      setError('No folders found. Create one in Unibox or Data Extractor.')
                                    }
                                  } catch (err: any) {
                                    setError(err.message || 'Failed to load folders')
                                  } finally {
                                    setFolderLoading(false)
                                  }
                                }}
                                disabled={folderLoading}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                {folderLoading ? 'Loading...' : 'Load Folders'}
                              </Button>
                              <div className="grid gap-2 md:grid-cols-2 max-h-64 overflow-y-auto">
                                {folders.map((f) => (
                                  <label
                                    key={f.id}
                                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                                      selectedFolderId === f.id
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : 'border-slate-700 bg-slate-800/50'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="folder"
                                      checked={selectedFolderId === f.id}
                                      onChange={() => setSelectedFolderId(f.id)}
                                      className="text-blue-500"
                                    />
                                    <div className="flex-1">
                                      <p className="text-sm font-medium">{f.name}</p>
                                      <p className="text-[11px] text-slate-500">{f.id.slice(0, 8)}</p>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h3 className="text-lg font-semibold">Filter Tags <span className="text-xs font-normal text-slate-500">(optional)</span></h3>
                              <p className="text-xs text-slate-400">
                                Only message folder members with the selected tag(s). Leave empty to message everyone in the folder.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {(['excluded', 'important', 'known', 'caution'] as const).map((tag) => {
                                  const active = folderFilterTags.includes(tag)
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() =>
                                        setFolderFilterTags((prev) =>
                                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                                        )
                                      }
                                      className={`rounded-full border px-3 py-1.5 text-sm capitalize transition ${
                                        active
                                          ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                                          : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <h3 className="text-lg font-semibold">Resolution Group <span className="text-xs font-normal text-slate-500">(optional)</span></h3>
                              <p className="text-xs text-slate-400">
                                Contacts with no username can&apos;t be messaged by an account that has never interacted
                                with them. If you set a group here, the account that owns each contact temporarily adds
                                them to this group so the sending account can resolve and message them, then removes them.
                              </p>
                              <Input
                                value={resolutionGroup}
                                onChange={(e) => setResolutionGroup(e.target.value)}
                                placeholder="@your_staging_group or group id (-100...)"
                                className="bg-slate-800 border-slate-700"
                              />
                              <p className="text-[11px] text-amber-300/80">
                                Use a group your accounts admin (they need add + remove rights). Frequent add/remove is a
                                strong spam signal and may get accounts rate-limited or banned.
                              </p>
                            </div>

                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Folder Members (blacklist)</h3>
                              <p className="text-xs text-slate-400">
                                Load targets from the selected folder, then check any to <span className="text-red-400">exclude</span>.
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  onClick={async () => {
                                    if (!selectedFolderId) {
                                      setError('Select a folder first')
                                      return
                                    }
                                    if (!editingCampaignId) {
                                      setError('Save the campaign first before loading folder targets')
                                      return
                                    }
                                    try {
                                      setFolderLoading(true)
                                      setError(null)
                                      // Persist current selections (filter tags, blacklist) before loading,
                                      // since the backend reads them from the saved campaign record.
                                      await saveCampaign()
                                      const result = await loadFolderCampaignTargets(editingCampaignId)
                                      setFolderTargets(result.members || [])
                                      if (!result.members || result.members.length === 0) {
                                        setError('No members found in this folder')
                                      }
                                    } catch (err: any) {
                                      setError(err.message || 'Failed to load folder targets')
                                    } finally {
                                      setFolderLoading(false)
                                    }
                                  }}
                                  disabled={folderLoading || !selectedFolderId || !editingCampaignId}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  {folderLoading ? 'Loading...' : 'Load Folder Targets'}
                                </Button>
                                {blacklistedUsers.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setBlacklistedUsers([])}
                                    className="border-slate-700 text-xs"
                                  >
                                    Clear ({blacklistedUsers.length})
                                  </Button>
                                )}
                              </div>
                              {folderTargets.length > 0 && (
                                <div className="rounded-lg border border-slate-700 bg-slate-800/30 max-h-64 overflow-y-auto">
                                  {folderTargets.map((t) => {
                                    const tid = t.username || t.userId
                                    const isChecked = blacklistedUsers.includes(tid)
                                    return (
                                      <label
                                        key={t.userId}
                                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition hover:bg-slate-700/50 ${
                                          isChecked ? 'bg-red-500/10' : ''
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => toggleBlacklistContact(tid)}
                                          className="text-red-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm truncate">{t.displayName || t.username || t.userId}</p>
                                          <p className="text-[11px] text-slate-500">
                                            {t.username ? `@${t.username}` : t.userId}
                                          </p>
                                        </div>
                                        {isChecked && (
                                          <span className="text-[10px] text-red-400 font-medium shrink-0">Excluded</span>
                                        )}
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {/* Contact Mode: Account Picker + Load Contacts */}
                        {campaignType === 'contact' && (
                          <>
                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Account for Contact Extraction</h3>
                              <p className="text-sm text-slate-400">
                                Select which connected account to extract contacts from.
                              </p>
                              {accountCount === 0 ? (
                                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                                  <p>No connected accounts found.</p>
                                </div>
                              ) : (
                                <div className="grid gap-2 md:grid-cols-2 max-h-64 overflow-y-auto">
                                  {user?.connectedAccounts.map((account) => (
                                    <label
                                      key={account.id}
                                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                                        contactAccountId === account.id
                                          ? 'border-blue-500 bg-blue-500/10'
                                          : 'border-slate-700 bg-slate-800/50'
                                      } ${account.status !== 'online' ? 'opacity-60' : ''}`}
                                    >
                                      <input
                                        type="radio"
                                        name="contactAccount"
                                        checked={contactAccountId === account.id}
                                        onChange={() => setContactAccountId(account.id)}
                                        className="text-blue-500"
                                        disabled={account.status !== 'online'}
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm font-medium">{account.displayName || account.username}</p>
                                        <p className="text-[11px] text-slate-500">@{account.username}</p>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold">Contacts</h3>
                              <p className="text-xs text-slate-400">
                                Load contacts from the selected account, then check any to <span className="text-red-400">exclude</span>.
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  onClick={handleLoadContacts}
                                  disabled={contactLoading || !contactAccountId}
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  {contactLoading ? 'Loading...' : 'Load Contacts'}
                                </Button>
                                {blacklistedUsers.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setBlacklistedUsers([])}
                                    className="border-slate-700 text-xs"
                                  >
                                    Clear ({blacklistedUsers.length})
                                  </Button>
                                )}
                              </div>
                              {loadedContacts.length > 0 && (
                                <div className="rounded-lg border border-slate-700 bg-slate-800/30 max-h-64 overflow-y-auto">
                                  {loadedContacts.map((c) => {
                                    const contactId = c.username || c.userId
                                    const isChecked = blacklistedUsers.includes(contactId)
                                    return (
                                      <label
                                        key={c.userId}
                                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition hover:bg-slate-700/50 ${
                                          isChecked ? 'bg-red-500/10' : ''
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => toggleBlacklistContact(contactId)}
                                          className="text-red-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm truncate">{c.displayName || c.username || c.userId}</p>
                                          <p className="text-[11px] text-slate-500">
                                            {c.username ? `@${c.username}` : c.userId}
                                          </p>
                                        </div>
                                        {isChecked && (
                                          <span className="text-[10px] text-red-400 font-medium shrink-0">Excluded</span>
                                        )}
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {flowTab === 'accounts' && (
                      <div className="space-y-3">
                        <h3 className="text-lg font-semibold">Messaging Accounts (senders)</h3>
                        <p className="text-sm text-slate-400">These accounts will SEND messages.</p>
                        {accountCount === 0 ? (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                            <p>No connected accounts found.</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 border-amber-500/50"
                              onClick={() => router.push('/dashboard/settings/accounts')}
                            >
                              Connect Account
                            </Button>
                          </div>
                        ) : (
                          <>
                            <label className="flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-700/50 p-3 cursor-pointer transition hover:bg-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedAccountIds.length === user?.connectedAccounts.filter(a => a.status === 'online').length && selectedAccountIds.length > 0}
                                onChange={() => {
                                  const onlineIds = user?.connectedAccounts.filter(a => a.status === 'online').map(a => a.id) || []
                                  const allSelected = onlineIds.every(id => selectedAccountIds.includes(id))
                                  setSelectedAccountIds(allSelected ? [] : onlineIds)
                                }}
                                className="text-blue-500"
                              />
                              <span className="text-sm font-medium">Select All Online</span>
                            </label>
                            <Input
                              value={messagingAccountSearch}
                              onChange={(e) => setMessagingAccountSearch(e.target.value)}
                              placeholder="Search accounts..."
                              className="bg-slate-800 border-slate-700"
                            />
                            <div className="grid gap-2 md:grid-cols-2 max-h-56 overflow-y-auto">
                              {user?.connectedAccounts.filter(a =>
                                !messagingAccountSearch ||
                                (a.displayName || '').toLowerCase().includes(messagingAccountSearch.toLowerCase()) ||
                                (a.username || '').toLowerCase().includes(messagingAccountSearch.toLowerCase()) ||
                                (a.id || '').toLowerCase().includes(messagingAccountSearch.toLowerCase())
                              ).map((account) => (
                                <label
                                  key={account.id}
                                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                                    selectedAccountIds.includes(account.id)
                                      ? 'border-blue-500 bg-blue-500/10'
                                      : 'border-slate-700 bg-slate-800/50'
                                  } ${account.status !== 'online' ? 'opacity-60' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedAccountIds.includes(account.id)}
                                    onChange={() => {
                                      setSelectedAccountIds((prev) =>
                                        prev.includes(account.id)
                                          ? prev.filter((id) => id !== account.id)
                                          : [...prev, account.id]
                                      )
                                    }}
                                    className="text-blue-500"
                                    disabled={account.status !== 'online'}
                                  />
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{account.displayName || account.username}</p>
                                    <p className="text-[11px] text-slate-500">@{account.username}</p>
                                    <p className="text-[10px] mt-0.5">
                                      {account.status === 'online' ? '🟢 Online' : '⚫ Offline'}
                                    </p>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                        {selectedAccountIds.length > 0 && (
                          <p className="text-xs text-slate-400">{selectedAccountIds.length} account(s) selected</p>
                        )}
                      </div>
                    )}

                    {flowTab === 'settings' && (
                      <>
                        {/* Limits - shared across all types */}
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Limits</h3>
                          <div className="flex flex-wrap gap-3">
                            <div className="space-y-2">
                              <p className="text-xs text-slate-500 uppercase font-semibold">Daily limit / account</p>
                              <Input
                                type="number"
                                min={1}
                                value={dailyMessageLimitPerAccount}
                                onChange={(e) => setDailyMessageLimitPerAccount(safeNumber(e.target.value, 1))}
                                className="w-44 bg-slate-800 border-slate-700"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-slate-500 uppercase font-semibold">Interval (seconds)</p>
                                <label className="inline-flex items-center gap-2 text-xs text-slate-400 select-none">
                                  <input
                                    type="checkbox"
                                    checked={autoMessageInterval}
                                    onChange={(e) => setAutoMessageInterval(e.target.checked)}
                                    className="accent-blue-500"
                                  />
                                  Auto (24h)
                                </label>
                              </div>
                              <Input
                                type="number"
                                min={1}
                                value={messageInterval}
                                onChange={(e) => {
                                  setAutoMessageInterval(false)
                                  setMessageInterval(safeNumber(e.target.value, 1))
                                }}
                                className="w-44 bg-slate-800 border-slate-700"
                                disabled={autoMessageInterval}
                              />
                              <p className="text-[11px] text-slate-500">
                                Suggested: {suggestedIntervalSeconds}s (accounts {selectedAccountIds.length} × limit {dailyMessageLimitPerAccount}/day)
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Target Ordering */}
                        {(campaignType === 'group' || campaignType === 'contact' || campaignType === 'folder') && (
                          <div className="space-y-3">
                            <h3 className="text-lg font-semibold">Target Ordering</h3>
                            <p className="text-xs text-slate-400">
                              Choose how targets are ordered before messaging begins.
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <label className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-xs transition ${sortByActivity === null ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
                                <input type="radio" name="sortByActivity" checked={sortByActivity === null} onChange={() => setSortByActivity(null)} className="accent-blue-500" />
                                As scraped / CSV order
                              </label>
                              <label className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-xs transition ${sortByActivity === 'most_recent' ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
                                <input type="radio" name="sortByActivity" checked={sortByActivity === 'most_recent'} onChange={() => setSortByActivity('most_recent')} className="accent-blue-500" />
                                Most recently active first
                              </label>
                              <label className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-xs transition ${sortByActivity === 'least_recent' ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>
                                <input type="radio" name="sortByActivity" checked={sortByActivity === 'least_recent'} onChange={() => setSortByActivity('least_recent')} className="accent-blue-500" />
                                Least recently active first
                              </label>
                            </div>
                          </div>
                        )}

                        {/* Skip Already Messaged */}
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Duplicate Handling</h3>
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={skipMessaged}
                              onChange={(e) => setSkipMessaged(e.target.checked)}
                              className="accent-blue-500 mt-0.5"
                            />
                            <div>
                              <p className="text-sm font-medium text-slate-200">Skip already messaged users</p>
                              <p className="text-xs text-slate-400">
                                When checked, the account checks the conversation history and skips users who have already received any of your rotating messages.
                              </p>
                            </div>
                          </label>
                        </div>

                        {/* Rotating Messages */}
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold">Rotating Messages</h3>
                          {messages.map((msg, i) => (
                            <div key={i} className="flex gap-2">
                              <Input
                                value={msg}
                                onChange={(e) => updateMessage(i, e.target.value)}
                                placeholder={`Message ${i + 1}`}
                                className="bg-slate-800 border-slate-700"
                              />
                              <Button
                                variant="outline"
                                disabled={messages.length <= 1}
                                onClick={() => removeMessage(i)}
                                className="border-slate-700 shrink-0"
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={addMessage} className="border-slate-700">Add Message</Button>
                            <Popover open={storedPopoverOpen} onOpenChange={(open) => { setStoredPopoverOpen(open); if (open) loadStoredMessages() }}>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="border-slate-700 gap-1">
                                  <Bookmark className="w-4 h-4" />
                                  From Stored
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent side="top" align="start" className="w-72 p-1 bg-slate-900 border-slate-700">
                                <div className="max-h-64 overflow-y-auto">
                                  {storedMessages.length === 0 ? (
                                    <p className="text-gray-500 text-xs text-center py-4">No text messages stored</p>
                                  ) : (
                                    storedMessages.map((msg) => (
                                      <button
                                        key={msg.id}
                                        onClick={() => addStoredMessage(msg)}
                                        className="w-full text-left px-2 py-2 rounded hover:bg-slate-800 flex items-start gap-2"
                                      >
                                        <FileText className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                                        <div className="min-w-0">
                                          <p className="text-xs text-gray-200 truncate">{msg.content}</p>
                                          <p className="text-[10px] text-gray-500">{new Date(msg.createdAt).toLocaleDateString()}</p>
                                        </div>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>

                        {/* Automatic follow-up sequence */}
                        <div className="space-y-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={followUpEnabled}
                              onChange={(e) => setFollowUpEnabled(e.target.checked)}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                            />
                            <span className="text-lg font-semibold">Automatic follow-up</span>
                          </label>
                          <p className="text-xs text-slate-500">
                            Send follow-up messages to recipients who <span className="text-slate-300">read</span> your
                            message but never replied. Each step fires once, the given number of hours after the original
                            send, and the sequence stops as soon as they reply.
                          </p>
                          {followUpEnabled && (
                            <div className="space-y-3">
                              {followUpSteps.map((step, i) => (
                                <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-400">Step {i + 1}</span>
                                    <Button
                                      variant="outline"
                                      disabled={followUpSteps.length <= 1}
                                      onClick={() => removeFollowUpStep(i)}
                                      className="border-slate-700 h-7 px-2 text-xs"
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400 shrink-0">Send after</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={step.delayHours}
                                      onChange={(e) => updateFollowUpStep(i, { delayHours: Number(e.target.value) })}
                                      className="bg-slate-800 border-slate-700 w-24 h-8"
                                    />
                                    <span className="text-xs text-slate-400 shrink-0">hours (from original send)</span>
                                  </div>
                                  <Input
                                    value={step.message}
                                    onChange={(e) => updateFollowUpStep(i, { message: e.target.value })}
                                    placeholder={`Follow-up message ${i + 1}`}
                                    className="bg-slate-800 border-slate-700"
                                  />
                                </div>
                              ))}
                              <Button variant="outline" onClick={addFollowUpStep} className="border-slate-700">Add Follow-up Step</Button>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {flowTab === 'review' && (
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">Campaign Summary</p>
                            <p className="text-xs text-slate-500">
                              Review your campaign configuration and launch.
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-slate-400 space-y-0.5">
                          <p>Name: {campaignName || '-'}</p>
                          <p>Type: {campaignType === 'group' ? 'Group Campaign' : campaignType === 'username' ? 'Username Campaign' : campaignType === 'contact' ? 'Contact Campaign' : 'Folder Campaign'}</p>
                          {campaignType === 'group' && <p>Group: {selectedGroup?.title || '-'}</p>}
                          {campaignType === 'folder' && <p>Folder: {folders.find(f => f.id === selectedFolderId)?.name || selectedFolderId || '-'}</p>}
                          {campaignType === 'folder' && <p>Filter tags: {folderFilterTags.length ? folderFilterTags.join(', ') : 'All members'}</p>}
                          <p>Messaging accounts: {selectedAccountIds.length}</p>
                          <p>Messages: {messages.filter((m) => m.trim()).length}</p>
                          <p>Daily limit / account: {dailyMessageLimitPerAccount}</p>
                          <p>Interval: {messageInterval}s {autoMessageInterval ? '(auto)' : ''}</p>
                          <p>Target ordering: {sortByActivity === 'most_recent' ? 'Most recently active first' : sortByActivity === 'least_recent' ? 'Least recently active first' : 'As scraped / CSV order'}</p>
                          <p>Skip already messaged: {skipMessaged ? 'Yes' : 'No'}</p>
                          <p>Follow-up: {followUpEnabled ? `${followUpSteps.filter(s => s.message.trim()).length} step(s)` : 'Off'}</p>
                          <p>Blacklisted: {blacklistedUsers.length} entries</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Nav */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-800 shrink-0">
                    <div>
                      {flowTab !== 'basics' && (
                        <Button variant="outline" size="sm" onClick={() => {
                          const tabs = ['basics', 'accounts', 'settings', 'review']
                          const idx = tabs.indexOf(flowTab)
                          if (idx > 0) setFlowTab(tabs[idx - 1] as typeof flowTab)
                        }} className="border-slate-700">
                          Back
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={async () => {
                        setIsSubmitting(true); setError(null)
                        try { await saveCampaign(); await loadCampaigns() }
                        catch (err) { setError(err instanceof Error ? err.message : 'Failed to save campaign') }
                        finally { setIsSubmitting(false) }
                      }} disabled={isSubmitting} className="border-slate-700">
                        Save Draft
                      </Button>
                      {flowTab !== 'review' ? (
                        <Button size="sm" onClick={() => {
                          if (flowTab === 'basics') {
                            if (!campaignName.trim()) { setError('Campaign name is required'); return }
                            if (campaignType === 'group' && !selectedGroup) { setError('Select a group for group campaigns'); return }
                            if (campaignType === 'folder' && !selectedFolderId) { setError('Select a folder for folder campaigns'); return }
                          }
                          if (flowTab === 'accounts') {
                            if (selectedAccountIds.length === 0) { setError('Select at least one messaging account'); return }
                          }
                          if (flowTab === 'settings') {
                            if (!messages.some(m => m.trim())) { setError('Add at least one message'); return }
                          }
                          setError(null)
                          const tabs = ['basics', 'accounts', 'settings', 'review']
                          const idx = tabs.indexOf(flowTab)
                          if (idx < tabs.length - 1) setFlowTab(tabs[idx + 1] as typeof flowTab)
                        }}>
                          Next
                        </Button>
                      ) : (
                        <Button onClick={() => {
                          if (!campaignName.trim()) { setError('Campaign name is required'); return }
                          if (campaignType === 'group' && !selectedGroup) { setError('Select a group for group campaigns'); return }
                          if (campaignType === 'folder' && !selectedFolderId) { setError('Select a folder for folder campaigns'); return }
                          if (campaignType === 'username' && !usernamesCsv.trim()) { setError('Upload a CSV or enter usernames'); return }
                          if (selectedAccountIds.length === 0) { setError('Select at least one messaging account'); return }
                          if (!messages.some(m => m.trim())) { setError('Add at least one message'); return }
                          setError(null)
                          handleSaveAndStart()
                        }} disabled={isSubmitting}>
                          Save & Launch
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {mode === 'stats' && selectedCampaign && (
                <div className="flex flex-col min-h-0">
                  {/* Top bar with campaign name + actions */}
                  <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold">{selectedCampaign.name}</h3>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        selectedCampaign.status === 'running' ? 'bg-emerald-500/15 text-emerald-300' :
                        selectedCampaign.status === 'paused' ? 'bg-amber-500/15 text-amber-300' :
                        selectedCampaign.status === 'draft' ? 'bg-slate-500/15 text-slate-300' :
                        TERMINAL_CAMPAIGN_STATUSES.has(selectedCampaign.status) ? 'bg-blue-500/15 text-blue-300' :
                        'bg-rose-500/15 text-rose-300'
                      }`}>
                        {selectedCampaign.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedCampaign.status === 'running' ? (
                        <Button onClick={handleStopSelectedCampaign} disabled={isSubmitting} size="sm" className="bg-amber-600 hover:bg-amber-700 h-7 text-xs">
                          <Pause className="w-3 h-3 mr-1" /> Pause
                        </Button>
                      ) : selectedCampaign.status === 'paused' ? (
                        <Button onClick={() => handleStartFromList(selectedCampaign.id)} disabled={isSubmitting} size="sm" className="h-7 text-xs">
                          <Play className="w-3 h-3 mr-1" /> Resume
                        </Button>
                      ) : (
                        <Button onClick={() => handleStartFromList(selectedCampaign.id)} disabled={isSubmitting} size="sm" className="h-7 text-xs">
                          <Play className="w-3 h-3 mr-1" /> Start
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedCampaignSummary && (
                    <div className="border-b border-slate-800 p-4 space-y-4 shrink-0">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          { label: 'Targets', value: selectedCampaignSummary.totalTargets || 0, cls: '' },
                          { label: 'Sent', value: selectedCampaignSummary.sentCount || 0, cls: 'text-emerald-400' },
                          { label: 'Replies', value: selectedCampaignSummary.repliedTargets || 0, cls: 'text-blue-400' },
                          { label: 'Failed', value: selectedCampaignSummary.sendFailures || 0, cls: 'text-rose-400' },
                          { label: 'Active', value: accountHealthSummary.active, cls: 'text-emerald-300' },
                          { label: 'Resting', value: accountHealthSummary.resting, cls: 'text-rose-400' },
                          { label: 'Idle', value: accountHealthSummary.idle, cls: 'text-slate-300' },
                          { label: 'ETA', value: estimatedTimeRemaining || '-', cls: 'text-cyan-300' },
                        ].map((s) => (
                          <div key={s.label} className="rounded-lg bg-slate-800/60 p-3">
                            <p className="text-xs text-slate-500 uppercase">{s.label}</p>
                            <p className={'text-xl font-bold mt-0.5 ' + s.cls}>{s.value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Activity Feed */}
                      <div className="border border-slate-700 rounded-lg bg-slate-800/40">
                        <div className="px-4 py-2 text-xs font-semibold uppercase text-slate-500 border-b border-slate-700">Activity Log</div>
                        {campaignActivityLog.length === 0 ? (
                          <div className="flex items-center justify-center text-slate-500 text-xs py-8">
                            No activity yet — start the campaign to see events
                          </div>
                        ) : (
                          <div className="max-h-60 overflow-y-auto">
                            <table className="w-full text-sm text-left text-slate-300">
                              <tbody className="divide-y divide-slate-800/50">
                                {[...campaignActivityLog].reverse().map((item, i) => {
                                  const cfg = item.type ? EVENT_CONFIG[item.type] : undefined
                                  const Icon = cfg?.icon || Activity
                                  return (
                                    <tr key={i} className="hover:bg-slate-800/30 transition">
                                      <td className="px-4 py-1.5 text-xs text-slate-500 w-14 whitespace-nowrap">
                                        {item.at ? new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                      </td>
                                      <td className="px-4 py-1.5 text-xs text-cyan-300 font-medium w-24">
                                        {item.accountId ? (accountNameLookup.get(item.accountId) || item.accountLabel || '-') : (item.accountLabel || '-')}
                                      </td>
                                      <td className={`px-4 py-1.5 text-xs ${cfg?.color || 'text-slate-300'}`}>
                                        <span className="inline-flex items-center gap-1.5">
                                          <Icon className="h-3.5 w-3.5 shrink-0" />
                                          {cfg?.label || item.message || 'Event'}
                                          {item.message && (
                                            item.type === 'campaign_failed' ||
                                            item.type === 'message_failed' ||
                                            item.type === 'join_failed' ||
                                            item.type === 'scrape_failed' ||
                                            item.type === 'message_skipped'
                                          ) ? (
                                            <span className="text-slate-400 ml-1.5 font-normal truncate max-w-[260px]" title={item.message}>
                                              — {item.message}
                                            </span>
                                          ) : null}
                                        </span>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                          <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                            <Activity className="h-4 w-4 text-blue-300" /> Outcome Mix
                          </div>
                          <div className="h-52">
                            {outcomeChartData.length > 0 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={outcomeChartData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={65}
                                    label={renderPieLabel}
                                    labelLine={false}
                                  >
                                    {outcomeChartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                                  </Pie>
                                  <Tooltip />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="flex h-full items-center justify-center text-sm text-slate-500">No outcomes yet</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                          <h4 className="mb-3 text-sm font-medium text-slate-200">Per Account Performance</h4>
                          <div className="h-52">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={perAccountChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                <XAxis dataKey="account" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="sent" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="failures" fill="#ef4444" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* Accounts Table */}
                  <div className="border-b border-slate-800 shrink-0">
                    <div className="px-4 py-2 text-xs font-semibold uppercase text-slate-500">Accounts</div>
                    <table className="w-full text-sm text-left text-slate-300">
                      <thead className="text-[10px] uppercase bg-slate-800/40 text-slate-500">
                        <tr>
                          <th className="px-4 py-1.5">Account</th>
                          <th className="px-4 py-1.5">Status</th>
                          <th className="px-4 py-1.5 text-right">Sent</th>
                          <th className="px-4 py-1.5 text-right">Failed</th>
                          <th className="px-4 py-1.5 text-right">Skipped</th>
                          <th className="px-4 py-1.5 text-right">Replies</th>
                          <th className="px-4 py-1.5 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/30">
                        {(selectedCampaignSummary?.accountStats?.length
                          ? selectedCampaignSummary.accountStats
                          : selectedCampaign?.accountIds?.map(id => ({
                            accountId: id,
                            accountLabel: accountNameLookup.get(id) || id.slice(0, 8),
                            state: 'idle',
                            assignedTargets: 0,
                            resolvedTargets: 0,
                            unresolvedTargets: 0,
                            attemptedTargets: 0,
                            sentCount: 0,
                            sendFailures: 0,
                            skippedCount: 0,
                            restUntil: null,
                            restSeconds: 0,
                            repliedTargets: 0,
                            replyMessages: 0,
                          })) || []
                        ).map((acct) => {
                          const isLastSender = acct.accountId === lastSenderAccountId
                          const showIntervalRest = isLastSender && acct.state === 'active' && nextMsgRemaining != null && nextMsgRemaining > 0 && selectedCampaign?.status === 'running'
                          const displayState = showIntervalRest ? 'resting' : (acct.state || 'idle')
                          const isSelected = selectedStatsAccountId === acct.accountId
                          const remaining = Math.max(0, (acct.assignedTargets ?? 0) - (acct.sentCount ?? 0) - (acct.sendFailures ?? 0) - (acct.skippedCount ?? 0))
                          return (
                            <>
                              <tr
                                key={acct.accountId}
                                className={`hover:bg-slate-800/20 transition cursor-pointer ${isSelected ? 'bg-blue-500/15' : ''}`}
                                onClick={() => setSelectedStatsAccountId(isSelected ? null : acct.accountId)}
                              >
                                <td className="px-4 py-1.5 text-xs text-cyan-300">{accountNameLookup.get(acct.accountId) || acct.accountId.slice(0, 8)}</td>
                                <td className="px-4 py-1.5 text-xs">
                                  <span className={'inline-flex rounded-full px-2 py-0.5 text-xs ' + stateChip(displayState)}>
                                    {displayState.toLowerCase()}
                                  </span>
                                  {showIntervalRest && nextMsgRemaining != null && (
                                    <span className="ml-2"><RestTimer restSeconds={nextMsgRemaining} /></span>
                                  )}
                                  {!showIntervalRest && displayState === 'resting' && (
                                    <span className="ml-2"><RestTimer restUntil={acct.restUntil} restSeconds={acct.restSeconds} /></span>
                                  )}
                                  {!showIntervalRest && displayState === 'cooldown' && (
                                    <span className="ml-2"><RestTimer restUntil={acct.restUntil} restSeconds={acct.restSeconds} className="text-rose-400" /></span>
                                  )}
                                </td>
                                <td className="px-4 py-1.5 text-xs text-right text-slate-200">{acct.sentCount ?? 0}</td>
                                <td className="px-4 py-1.5 text-xs text-right text-red-300">{acct.sendFailures ?? 0}</td>
                                <td className="px-4 py-1.5 text-xs text-right text-amber-400">{acct.skippedCount ?? 0}</td>
                                <td className="px-4 py-1.5 text-xs text-right text-blue-300">{acct.repliedTargets ?? 0}</td>
                                <td className="px-4 py-1.5 text-xs text-right text-slate-400">{remaining}</td>
                              </tr>
                              {selectedStatsAccountId === acct.accountId && sentItemsForSelectedStatsAccount.length > 0 && (
                                <tr key={`${acct.accountId}-detail`} className="bg-slate-900/60">
                                  <td colSpan={7} className="px-4 py-3">
                                    <div className="text-xs space-y-1 max-h-48 overflow-y-auto">
                                      {sentItemsForSelectedStatsAccount.map((item, i) => (
                                        <div key={i} className="flex items-start gap-2 py-1 border-b border-slate-800/40 last:border-0">
                                          <span className={item.success === false ? 'text-red-400' : 'text-emerald-400 shrink-0'}>
                                            {item.success === false ? '✕' : '✓'}
                                          </span>
                                          <span className="text-slate-300">{item.target}</span>
                                          {item.error && <span className="text-red-300 break-all">{item.error}</span>}
                                        </div>
                                      ))}
                                    </div>
                                    <div className="text-xs text-slate-400 mt-2">
                                      Remaining: {remaining}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {mode === 'stats' && !selectedCampaign && (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Select a campaign from the left panel
                </div>
              )}
            </section>

            {/* Right Panel - Summary Stats */}
            <aside className="border-l border-slate-800 overflow-y-auto p-4 space-y-4">
              {mode === 'stats' && selectedCampaign ? (
                <>
                  <div className="text-xs font-semibold uppercase text-slate-500">Campaign Info</div>
                  <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 text-xs">
                    <div><span className="text-slate-500">Status:</span> <span className="text-slate-200">{selectedCampaign.status}</span></div>
                    <div><span className="text-slate-500">Updated:</span> <span className="text-slate-200">{new Date(selectedCampaign.updatedAt).toLocaleString()}</span></div>
                    <div><span className="text-slate-500">Accounts:</span> <span className="text-slate-200">{selectedCampaign.accountIds?.length || 0}</span></div>
                    <div><span className="text-slate-500">Group:</span> <span className="text-slate-200">{selectedCampaign.sourceGroup || '-'}</span></div>
                    <div><span className="text-slate-500">Daily Limit:</span> <span className="text-slate-200">{selectedCampaign.dailyMessageLimitPerAccount}</span></div>
                    <div><span className="text-slate-500">Messages:</span> <span className="text-slate-200">{selectedCampaign.messages?.length || 0}</span></div>
                    <div><span className="text-slate-500">Interval:</span> <span className="text-slate-200">{selectedCampaign.messageIntervalSeconds || 5}s</span></div>
                  </div>

                  {selectedCampaignSummary && (
                    <>
                      <div className="text-xs font-semibold uppercase text-slate-500">Summary</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold">{selectedCampaignSummary.totalTargets || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Targets</p>
                        </div>
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-emerald-400">{selectedCampaignSummary.sentCount || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Sent</p>
                        </div>
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-blue-400">{selectedCampaignSummary.repliedTargets || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Replies</p>
                        </div>
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-red-400">{selectedCampaignSummary.sendFailures || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Failed</p>
                        </div>
                      </div>

                      {(selectedCampaignSummary.sentCount || 0) > 0 && (
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>Reply rate</span>
                          <span className="text-emerald-400 font-medium">
                            {Math.round(((selectedCampaignSummary.repliedTargets || 0) / (selectedCampaignSummary.sentCount || 1)) * 100)}%
                          </span>
                        </div>
                      )}

                      {selectedCampaignSummary.totalTargets > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-400">Completion</span>
                            <span className="text-slate-300">{Math.round((campaignAttemptedCount / selectedCampaignSummary.totalTargets) * 100)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(campaignAttemptedCount / selectedCampaignSummary.totalTargets) * 100}%` }} />
                          </div>
                        </div>
                      )}

                      {estimatedTimeRemaining && (
                        <div className="text-xs text-slate-400">
                          Est. time left: <span className="text-slate-200">{estimatedTimeRemaining}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase text-slate-500">Replies</div>
                        {lastReplyFetch && (
                          <div className="text-[10px] text-slate-500">
                            Fetched {getRelativeTime(lastReplyFetch)}
                          </div>
                        )}
                      </div>
                      {campaignReplyRows.length === 0 ? (
                        <div className="rounded-lg bg-slate-800/40 p-3 text-xs text-slate-500">
                          No replies detected yet.
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700/60">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-800/80 text-slate-400 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5 text-left">User</th>
                                <th className="px-3 py-1.5 text-right">Replies</th>
                                <th className="px-3 py-1.5 text-right">Last</th>
                              </tr>
                            </thead>
                            <tbody>
                              {campaignReplyRows.map((item, index) => (
                                <tr
                                  key={`${item.accountId}-${item.chatId || item.target}-${index}`}
                                  className="border-t border-slate-800/70 text-slate-200 hover:bg-slate-800/60 cursor-pointer"
                                  onClick={() => openMessageThread(item.accountId, item.chatId || item.target)}
                                >
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <MessageCircle className="h-3.5 w-3.5 text-blue-300 shrink-0" />
                                      <span className="truncate">{item.target}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate">
                                      {accountNameLookup.get(item.accountId) || item.accountLabel}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right text-blue-300">{item.replyMessages || 0}</td>
                                  <td className="px-3 py-2 text-right text-slate-400">
                                    {item.lastReplyAt ? new Date(item.lastReplyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}



                  <div className="text-xs font-semibold uppercase text-slate-500">Export</div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 border-emerald-600/50 text-emerald-300 hover:bg-emerald-500/10 text-xs"
                      onClick={() => exportCsv(true)}>
                      Export Passed
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 border-rose-600/50 text-rose-300 hover:bg-rose-500/10 text-xs"
                      onClick={() => exportCsv(false)}>
                      Export Failed
                    </Button>
                  </div>

                  <div className="text-xs font-semibold uppercase text-slate-500">Actions</div>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full border-slate-700 text-xs"
                      onClick={() => openEditFlow(selectedCampaign)}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit Campaign
                    </Button>
                    <Button variant="outline" size="sm" className="w-full border-red-600/50 text-red-300 hover:bg-red-500/10 text-xs"
                      onClick={() => setPendingDeleteId(selectedCampaignId)} disabled={isSubmitting}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete Campaign
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <p>No campaign selected</p>
                </div>
              )}
            <ConfirmDialog
              open={pendingDeleteId !== null}
              onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
              title="Delete Campaign"
              description="Delete this campaign permanently?"
              confirmLabel="Delete Campaign"
              onConfirm={handleDeleteConfirm}
            />
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CampaignPage() {
  return (
    <AuthGuard>
      <CampaignWorkspace />
    </AuthGuard>
  )
}
