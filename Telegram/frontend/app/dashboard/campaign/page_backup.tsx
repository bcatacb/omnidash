'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import {
  useAuth,
  type CampaignReplyStatsResponse,
  type CampaignRecord,
  type CampaignStartPayload,
  type CampaignStartResponse,
} from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import {
  Megaphone, Play, Pencil, BarChart3, Square, Trash2, Search, Plus,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from 'recharts'

type Mode = 'list' | 'flow' | 'stats'

const FLOW_LABELS: Array<{ step: number; label: string }> = [
  { step: 1, label: 'Name' },
  { step: 2, label: 'Messaging Accounts' },
  { step: 3, label: 'Source Account' },
  { step: 4, label: 'Select Group' },
  { step: 5, label: 'Limits' },
  { step: 6, label: 'Messages' },
]

const TERMINAL_CAMPAIGN_STATUSES = new Set([
  'completed', 'completed_with_failures', 'failed', 'stopped', 'validation_failed',
])

function CampaignWorkspace() {
  const router = useRouter()
  const {
    user, listCampaigns, createCampaign, updateCampaign, deleteCampaign,
    startCampaign, stopCampaign, removePreviouslyMessagedTargets,
    refreshCampaignReplyStats,
  } = useAuth()

  const [mode, setMode] = useState<Mode>('list')
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [campaignName, setCampaignName] = useState('')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [sourceAccountId, setSourceAccountId] = useState<string>('')
  const [selectedGroup, setSelectedGroup] = useState<{id: string, title: string} | null>(null)
  const [groups, setGroups] = useState<Array<{id: string, title: string, username?: string}>>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [dailyMessageLimitPerAccount, setDailyMessageLimitPerAccount] = useState(150)
  const [messages, setMessages] = useState<string[]>([''])
  const [messageInterval, setMessageInterval] = useState(5)
  const [blacklistedUsers, setBlacklistedUsers] = useState<string[]>([])
  const [blacklistInput, setBlacklistInput] = useState('')
  const [scrapedMembers, setScrapedMembers] = useState<Array<{userId: string, username?: string, displayName: string}>>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshingReplies, setIsRefreshingReplies] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<CampaignStartResponse | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [selectedStatsAccountId, setSelectedStatsAccountId] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState('')

  const accountCount = user?.connectedAccounts.length || 0

  const sourceAccount = useMemo(() => {
    if (!user || !sourceAccountId) return null
    return user.connectedAccounts.find(a => a.id === sourceAccountId) || null
  }, [user, sourceAccountId])

  const messagingAccounts = useMemo(() => {
    if (!user) return []
    return user.connectedAccounts.filter(a => selectedAccountIds.includes(a.id))
  }, [user, selectedAccountIds])

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  )

  const selectedCampaignSummary = useMemo(() => {
    const campaignSummary = selectedCampaign?.lastRunSummary || null
    const campaignStatus = (selectedCampaign?.status || '').toLowerCase()
    if (campaignStatus === 'running') return campaignSummary || runResult
    if (!runResult) return campaignSummary
    if (!selectedCampaignId) return runResult
    if (runResult.campaignId !== selectedCampaignId) return campaignSummary
    return campaignSummary || runResult
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
      else if (state === 'resting') resting += 1
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
    const previouslyMessaged = selectedCampaignSummary.previouslyMessagedTargets || 0
    const remaining = Math.max(0, total - sent - unresolved - previouslyMessaged)
    return [
      { name: 'Sent', value: sent, color: '#22c55e' },
      { name: 'Unresolved', value: unresolved, color: '#f59e0b' },
      { name: 'Previously Messaged', value: previouslyMessaged, color: '#fb7185' },
      { name: 'Remaining', value: remaining, color: '#60a5fa' },
    ].filter((item) => item.value > 0)
  }, [selectedCampaignSummary])

  const sentTimelineData = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const item of selectedCampaignSummary?.sentItems || []) {
      const raw = item.sentAt
      if (!raw) continue
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) continue
      date.setMinutes(0, 0, 0)
      const key = date.toISOString()
      grouped.set(key, (grouped.get(key) || 0) + 1)
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, count]) => ({
        time: new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sent: count,
      }))
  }, [selectedCampaignSummary])

  const campaignActivityLog = useMemo(
    () => selectedCampaignSummary?.activityLog || [],
    [selectedCampaignSummary]
  )

  const filteredCampaigns = useMemo(() => {
    if (!listSearch.trim()) return campaigns
    const needle = listSearch.toLowerCase()
    return campaigns.filter((c) =>
      c.name.toLowerCase().includes(needle) || c.status.toLowerCase().includes(needle)
    )
  }, [campaigns, listSearch])

  const estimatedTimeRemaining = useMemo(() => {
    if (!selectedCampaignSummary) return null
    const remaining = (selectedCampaignSummary.totalTargets || 0) - (selectedCampaignSummary.sentCount || 0)
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

  useEffect(() => { loadCampaigns() }, []) // eslint-disable-line

  useEffect(() => {
    if (mode !== 'stats') return
    if (!selectedCampaignId) return
    if (selectedCampaign?.status !== 'running') return
    const timer = window.setInterval(() => { loadCampaigns() }, 2500)
    return () => window.clearInterval(timer)
  }, [mode, selectedCampaignId, selectedCampaign?.status])

  const resetFlow = () => {
    setEditingCampaignId(null); setStep(1); setCampaignName('')
    setSelectedAccountIds([]); setSourceAccountId(''); setSelectedGroup(null); setGroups([])
    setDailyMessageLimitPerAccount(150); setMessages(['']); setMessageInterval(5)
    setBlacklistedUsers([]); setBlacklistInput(''); setScrapedMembers([])
    setError(null); setRunResult(null); setSelectedCampaignId(null)
  }

  const openCreateFlow = () => { resetFlow(); setMode('flow') }

  const openEditFlow = (campaign: CampaignRecord) => {
    setEditingCampaignId(campaign.id); setStep(1); setCampaignName(campaign.name)
    setSelectedAccountIds(campaign.accountIds || [])
    setSourceAccountId((campaign.accountIds || [])[0] || '')
    setDailyMessageLimitPerAccount(campaign.dailyMessageLimitPerAccount || 150)
    setMessages(campaign.messages?.length ? campaign.messages : [''])
    setMessageInterval(campaign.messageIntervalSeconds || 5)
    setBlacklistedUsers(campaign.blacklistedUsers || [])
    setSelectedGroup(campaign.sourceGroup ? {id: campaign.sourceGroup, title: campaign.sourceGroup} : null)
    setError(null); setRunResult(null); setMode('flow')
  }

  const goBackToList = async () => { setMode('list'); setError(null); await loadCampaigns() }

  const loadGroups = async () => {
    const accountIdToUse = sourceAccountId || selectedAccountIds[0] || ''
    if (!accountIdToUse) {
      setError('Please select a source account first')
      return
    }
    setLoadingGroups(true)
    setError(null)
    try {
      const token = localStorage.getItem('sessionToken') || ''
      if (!token) {
        setError('No session token found. Please log in again.')
        return
      }
      console.log('Loading groups for account:', accountIdToUse)
      const response = await fetch(`/api/v1/group-scraper/groups?account_id=${accountIdToUse}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      console.log('Groups response status:', response.status)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Groups error:', errorText)
        let errorDetail = `HTTP ${response.status}`
        try {
          const errorData = JSON.parse(errorText)
          errorDetail = errorData?.detail || errorDetail
        } catch {}
        throw new Error(errorDetail)
      }
      const data = await response.json()
      console.log('Groups loaded:', data.groups?.length || 0)
      setGroups(data.groups || [])
      if (data.groups?.length === 0) {
        setError('No groups found for this account. Make sure the account has joined groups and is online.')
      } else {
        setError(null)
      }
    } catch (err: any) {
      console.error('loadGroups error:', err)
      setError(err.message || 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  // Auto-load groups when sourceAccountId changes
  useEffect(() => {
    if (step === 3 && sourceAccountId) {
      loadGroups()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceAccountId, step])
      console.log('Loading groups for account:', selectedAccountId)
      const response = await fetch(`/api/v1/group-scraper/groups?account_id=${selectedAccountId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      console.log('Groups response status:', response.status)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Groups error response:', errorText)
        let errorDetail = `HTTP ${response.status}`
        try {
          const errorData = JSON.parse(errorText)
          errorDetail = errorData?.detail || errorDetail
        } catch {}
        throw new Error(errorDetail)
      }
      const data = await response.json()
      console.log('Groups loaded:', data.groups?.length || 0)
      setGroups(data.groups || [])
      if (data.groups?.length === 0) {
        setError('No groups found for this account. Make sure the account has joined groups and is online.')
      }
    } catch (err: any) {
      console.error('loadGroups error:', err)
      setError(err.message || 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  const scrapeMembers = async () => {
    if (!sourceAccountId || !selectedGroup) return
    if (!editingCampaignId) {
      setError('Please save the campaign first (click Next, then Save Draft)')
      return
    }
    setLoadingMembers(true)
    setError(null)
    try {
      const token = localStorage.getItem('sessionToken') || ''
      if (!token) {
        setError('No session token found. Please log in again.')
        return
      }
      console.log('Scraping members for campaign:', editingCampaignId, 'source account:', sourceAccountId)
      const response = await fetch(`/api/v1/campaigns/${editingCampaignId}/scrape-group-members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      console.log('Scrape response status:', response.status)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Scrape error:', errorText)
        let errorDetail = `HTTP ${response.status}`
        try {
          const errorData = JSON.parse(errorText)
          errorDetail = errorData?.detail || errorDetail
        } catch {}
        throw new Error(errorDetail)
      }
      const data = await response.json()
      console.log('Members found:', data.members?.length || 0)
      setScrapedMembers(data.members || [])
      if (data.members?.length === 0) {
        setError('No members found in this group. Make sure the account has permission to view members.')
      }
    } catch (err: any) {
      console.error('scrapeMembers error:', err)
      setError(err.message || 'Failed to scrape members')
    } finally {
      setLoadingMembers(false)
    }
  }

  const addToBlacklist = () => {
    if (!blacklistInput.trim()) return
    const users = blacklistInput.split(',').map(u => u.trim()).filter(Boolean)
    setBlacklistedUsers(prev => [...prev, ...users])
    setBlacklistInput('')
  }

  const removeFromBlacklist = (user: string) => {
    setBlacklistedUsers(prev => prev.filter(u => u !== user))
  }

  const updateMessage = (index: number, value: string) => {
    setMessages((prev) => prev.map((item, i) => (i === index ? value : item)))
  }

  const addMessage = () => { setMessages((prev) => [...prev, '']) }
  const removeMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index))
  }

  const getPayload = (): CampaignStartPayload => ({
    name: campaignName,
    accountIds: selectedAccountIds,
    dailyMessageLimitPerAccount,
    messages,
    targetsCsv: scrapedMembers.map(m => m.username || m.userId).join(','),
    sourceGroup: selectedGroup?.id || '',
    blacklistedUsers,
    messageIntervalSeconds: messageInterval,
    campaignType: 'group',
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
    try { const updated = await stopCampaign(campaignId); setRunResult(updated.lastRunSummary || null); await loadCampaigns(); setMode('stats') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to stop campaign') }
    finally { setIsSubmitting(false) }
  }

  const openCampaignStats = (campaign: CampaignRecord) => {
    setSelectedCampaignId(campaign.id); setRunResult(campaign.lastRunSummary || null)
    setSelectedStatsAccountId(null); setError(null); setMode('stats')
  }

  const canGoNext = () => {
    if (step === 1) return campaignName.trim().length > 0
    if (step === 2) return selectedAccountIds.length > 0
    if (step === 3) return sourceAccountId !== '' && sourceAccountId !== null
    if (step === 4) return selectedGroup !== null
    if (step === 5) return dailyMessageLimitPerAccount > 0 && messageInterval > 0
    if (step === 6) return messages.filter(m => m.trim()).length > 0
    return false
  }

  const goNext = async () => {
    if (!canGoNext()) return
    // Step 2 → 3: Select messaging accounts → Select source account
    if (step === 2) {
      // Just go to next step, no API call needed
    }
    // Step 3 → 4: Select source account → Load groups
    if (step === 3) {
      if (!editingCampaignId) {
        try {
          const payload = getPayload()
          const campaign = await createCampaign(payload)
          setEditingCampaignId(campaign.id)
        } catch (err: any) {
          setError(err.message || 'Failed to save campaign')
          return
        }
      }
      await loadGroups()
    }
    // Step 4 → 5: Select group → Set limits
    // Step 5 → 6: Set limits → Add messages
    setStep((prev) => (prev < 6 ? prev + 1 : prev))
  }
  const goPrev = () => { setStep((prev) => (prev > 1 ? prev - 1 : prev)) }

  const applyReplyStats = (previous: CampaignStartResponse | null, replyStats: CampaignReplyStatsResponse): CampaignStartResponse | null => {
    if (!previous) return previous
    const byAccount = new Map(replyStats.accountStats.map((item) => [item.accountId, item]))
    const mergedAccountStats = (previous.accountStats || []).map((item) => {
      const next = byAccount.get(item.accountId); if (!next) return item
      return { ...item, repliedTargets: next.repliedTargets, replyMessages: next.replyMessages, lastReplyAt: next.lastReplyAt ?? null }
    })
    const latestReplyAt = mergedAccountStats.map((item) => item.lastReplyAt || '').filter(Boolean).sort().at(-1)
    const byTarget = new Map((replyStats.targetStats || []).map((item) => [`${item.accountId}|${item.target}|${item.chatId || ''}|${item.messageId || 0}`, item]))
    const mergedSentItems = (previous.sentItems || []).map((item) => {
      const key = `${item.accountId}|${item.target}|${item.chatId || ''}|${item.messageId || 0}`
      const next = byTarget.get(key); if (!next) return item
      return { ...item, replied: Boolean(next.replied), replyMessages: next.replyMessages || 0, lastReplyAt: next.lastReplyAt || null }
    })
    return { ...previous, accountStats: mergedAccountStats, sentItems: mergedSentItems, repliedTargets: replyStats.repliedTargets, replyMessages: replyStats.replyMessages, lastReplyAt: latestReplyAt || null }
  }

  const handleRefreshReplyStats = async () => {
    if (!selectedCampaignId) return
    setIsRefreshingReplies(true); setError(null)
    try { const replyStats = await refreshCampaignReplyStats(selectedCampaignId); setRunResult((prev) => applyReplyStats(prev, replyStats)); await loadCampaigns() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to refresh reply stats') }
    finally { setIsRefreshingReplies(false) }
  }

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
    try { const updated = await stopCampaign(selectedCampaignId); setRunResult(updated.lastRunSummary || null); await loadCampaigns() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to stop campaign') }
    finally { setIsSubmitting(false) }
  }

  const handleDeleteFromList = async (campaignId: string) => {
    if (!window.confirm('Delete this campaign permanently?')) return
    setIsSubmitting(true); setError(null)
    try { await deleteCampaign(campaignId); if (selectedCampaignId === campaignId) { setSelectedCampaignId(null); setRunResult(null) } await loadCampaigns(); setMode('list') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete campaign') }
    finally { setIsSubmitting(false) }
  }

  const handleDeleteSelectedCampaign = async () => {
    if (!selectedCampaignId) return
    if (!window.confirm('Delete this campaign permanently?')) return
    setIsSubmitting(true); setError(null)
    try { await deleteCampaign(selectedCampaignId); setSelectedCampaignId(null); setRunResult(null); await loadCampaigns(); setMode('list') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete campaign') }
    finally { setIsSubmitting(false) }
  }

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <DashboardSidebar />

      <div className="flex-1 border-l border-slate-800 flex flex-col min-h-0">
        <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3 flex items-center gap-3">
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
                  <div className="p-4 text-sm text-slate-400">Loading...</div>
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
                          {campaign.status !== 'completed' && (
                            <Button
                              variant="ghost" size="sm"
                              className={`h-6 px-1.5 text-[10px] ${campaign.status === 'running' ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                campaign.status === 'running' ? handleStopFromList(campaign.id) : handleStartFromList(campaign.id)
                              }}
                              disabled={isSubmitting}
                            >
                              {campaign.status === 'running' ? <Square className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                              {campaign.status === 'running' ? 'Stop' : 'Start'}
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 px-1.5 text-[10px] text-rose-400 hover:text-rose-300 ml-auto"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFromList(campaign.id) }}
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
                <div className="p-6 space-y-6">
                  <div className="flex flex-wrap gap-2">
                    {FLOW_LABELS.map((item) => (
                      <span
                        key={item.step}
                        className={`rounded-full px-3 py-1 text-xs ${
                          step === item.step ? 'bg-blue-600 text-white'
                            : step > item.step ? 'bg-emerald-600/30 text-emerald-200'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.step}. {item.label}
                      </span>
                    ))}
                  </div>

                  {step === 1 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Campaign Name</h3>
                      <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="Spring Outreach Campaign" className="max-w-xl bg-slate-800 border-slate-700" />
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Select Messaging Accounts</h3>
                      <p className="text-sm text-slate-400">Choose accounts that will SEND messages. These accounts will join the group and message members.</p>
                      {accountCount === 0 ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                          <p>No connected accounts found.</p>
                          <Button variant="outline" size="sm" className="mt-2 border-amber-500/50" onClick={() => router.push('/dashboard/settings/accounts')}>Connect Account</Button>
                        </div>
                      ) : (
                        <div className="grid gap-2 md:grid-cols-2 max-h-64 overflow-y-auto">
                          {user?.connectedAccounts.map((account) => (
                            <label key={account.id} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                              selectedAccountIds.includes(account.id) ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50'
                            } ${account.status !== 'online' ? 'opacity-60' : ''}`}>
                              <input
                                type="checkbox"
                                checked={selectedAccountIds.includes(account.id)}
                                onChange={() => {
                                  setSelectedAccountIds(prev =>
                                    prev.includes(account.id)
                                      ? prev.filter(id => id !== account.id)
                                      : [...prev, account.id]
                                  )
                                }}
                                className="text-blue-500"
                                disabled={account.status !== 'online'}
                              />
                              <div className="flex-1">
                                <p className="text-sm font-medium">{account.displayName || account.username}</p>
                                <p className="text-[11px] text-slate-500">@{account.username}</p>
                                <p className="text-[10px] mt-0.5">{account.status === 'online' ? '🟢 Online' : '⚫ Offline'}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                      {selectedAccountIds.length > 0 && (
                        <p className="text-xs text-slate-400">{selectedAccountIds.length} account(s) selected for messaging</p>
                      )}
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Select Source Account</h3>
                      <p className="text-sm text-slate-400">Choose the account that will JOIN THE GROUP first and SCRAPE members. This account needs to already be a member of the group.</p>
                      {sourceAccountId && (
                        <Button onClick={loadGroups} disabled={loadingGroups} size="sm" variant="outline" className="border-slate-700">
                          {loadingGroups ? 'Loading...' : 'Load Groups for this Account'}
                        </Button>
                      )}
                      {accountCount === 0 ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                          <p>No connected accounts found.</p>
                          <Button variant="outline" size="sm" className="mt-2 border-amber-500/50" onClick={() => router.push('/dashboard/settings/accounts')}>Connect Account</Button>
                        </div>
                      ) : (
                        <div className="grid gap-2 md:grid-cols-2 max-h-64 overflow-y-auto">
                          {user?.connectedAccounts.map((account) => (
                            <label key={account.id} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                              sourceAccountId === account.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50'
                            } ${account.status !== 'online' ? 'opacity-60' : ''}`}>
                              <input
                                type="radio"
                                name="sourceAccount"
                                checked={sourceAccountId === account.id}
                                onChange={() => {
                                  setSourceAccountId(account.id)
                                  setGroups([])
                                  setSelectedGroup(null)
                                }}
                                className="text-blue-500"
                                disabled={account.status !== 'online'}
                              />
                              <div className="flex-1">
                                <p className="text-sm font-medium">{account.displayName || account.username}</p>
                                <p className="text-[11px] text-slate-500">@{account.username}</p>
                                <p className="text-[10px] mt-0.5">{account.status === 'online' ? '🟢 Online' : '⚫ Offline'}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                      {sourceAccountId && (
                        <Button onClick={loadGroups} disabled={loadingGroups} size="sm" variant="outline" className="border-slate-700">
                          {loadingGroups ? 'Loading...' : 'Load Groups'}
                        </Button>
                      )}
                    </div>
                  )}

                  {step === 4 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Select Group</h3>
                      <p className="text-sm text-slate-400">Source Account: <span className="text-white">{sourceAccount?.displayName || sourceAccount?.username}</span></p>
                      <p className="text-xs text-slate-500">Select the group you want to scrape members from. All messaging accounts will join this group.</p>
                      {loadingGroups ? (
                        <div className="text-sm text-slate-400 p-4 text-center">Loading groups...</div>
                      ) : groups.length === 0 ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                          <p>No groups found for this account.</p>
                          <p className="text-xs mt-1">Make sure the account has joined groups and is online.</p>
                        </div>
                      ) : (
                        <div className="grid gap-2 max-h-64 overflow-y-auto">
                          {groups.map((group) => (
                            <label key={group.id} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition hover:bg-slate-800/70 ${
                              selectedGroup?.id === group.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50'
                            }`}>
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
                      )}
                      {selectedGroup && (
                        <Button onClick={scrapeMembers} disabled={loadingMembers} className="bg-emerald-600 hover:bg-emerald-700">
                          {loadingMembers ? 'Scraping...' : `Scrape Members (${scrapedMembers.length} found)`}
                        </Button>
                      )}
                      {scrapedMembers.length > 0 && (
                        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300">
                          <p>Found {scrapedMembers.length} members</p>
                          <p>After blacklist: {scrapedMembers.length - blacklistedUsers.length} targets</p>
                        </div>
                      )}
                    </div>
                  )}

                  {step === 4 && (
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <h3 className="text-lg font-semibold">Daily Limit Per Account</h3>
                        <Input type="number" min={1} value={dailyMessageLimitPerAccount}
                          onChange={(e) => setDailyMessageLimitPerAccount(Number(e.target.value))}
                          className="max-w-xs bg-slate-800 border-slate-700" />
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-lg font-semibold">Message Interval (seconds)</h3>
                        <Input type="number" min={1} value={messageInterval}
                          onChange={(e) => setMessageInterval(Number(e.target.value))}
                          className="max-w-xs bg-slate-800 border-slate-700" />
                        <p className="text-xs text-slate-400">Time between messages when rotating accounts</p>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-lg font-semibold">Blacklisted Users</h3>
                        <div className="flex gap-2">
                          <Input value={blacklistInput} onChange={(e) => setBlacklistInput(e.target.value)}
                            placeholder="username1, user_id2, ..." className="bg-slate-800 border-slate-700" />
                          <Button onClick={addToBlacklist} className="bg-red-600 hover:bg-red-700">Add</Button>
                        </div>
                        <p className="text-xs text-slate-400">Enter usernames or user IDs to exclude from messaging</p>
                        <div className="flex flex-wrap gap-1">
                          {blacklistedUsers.map((user) => (
                            <span key={user} className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-1 text-xs">
                              {user}
                              <button onClick={() => removeFromBlacklist(user)} className="text-red-300 hover:text-red-100">×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 5 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Rotating Messages</h3>
                      {messages.map((msg, i) => (
                        <div key={i} className="flex gap-2">
                          <Input value={msg} onChange={(e) => updateMessage(i, e.target.value)} placeholder={`Message ${i + 1}`} className="bg-slate-800 border-slate-700" />
                          <Button variant="outline" disabled={messages.length <= 1} onClick={() => removeMessage(i)} className="border-slate-700 shrink-0">Remove</Button>
                        </div>
                      ))}
                      <Button variant="outline" onClick={addMessage} className="border-slate-700">Add Message</Button>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300 space-y-0.5">
                        <p>Name: {campaignName || '-'}</p>
                        <p>Account: {selectedAccount?.displayName || selectedAccount?.username || '-'}</p>
                        <p>Group: {selectedGroup?.title || '-'}</p>
                        <p>Targets: {scrapedMembers.length - blacklistedUsers.length}</p>
                        <p>Daily per account: {dailyMessageLimitPerAccount}</p>
                        <p>Message interval: {messageInterval}s</p>
                        <p>Messages: {messages.filter((m) => m.trim()).length}</p>
                        <p>Estimated time: {Math.round((scrapedMembers.length - blacklistedUsers.length) * messageInterval / 60)} minutes</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" onClick={goPrev} disabled={step === 1 || isSubmitting} className="border-slate-700">Back</Button>
                    <div className="flex gap-2">
                      {step < 6 && <Button onClick={goNext} disabled={!canGoNext() || isSubmitting}>Next</Button>}
                      {step === 6 && (
                        <>
                          <Button variant="outline" onClick={handleSaveDraft} disabled={isSubmitting} className="border-slate-700">Save Draft</Button>
                          <Button onClick={handleSaveAndStart} disabled={isSubmitting}>Save & Start</Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {mode === 'stats' && selectedCampaign && (
                <div className="p-6 space-y-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold">{selectedCampaign.name}</h3>
                      <p className="text-sm text-slate-400 mt-0.5">
                        Status: <span className={selectedCampaign.status === 'running' ? 'text-emerald-400' : 'text-slate-300'}>{selectedCampaign.status}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {selectedCampaign.status === 'running' ? (
                        <Button onClick={handleStopSelectedCampaign} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">
                          <Square className="w-4 h-4 mr-1" /> End
                        </Button>
                      ) : (
                        <Button onClick={() => handleStartFromList(selectedCampaign.id)} disabled={isSubmitting}>
                          <Play className="w-4 h-4 mr-1" /> Start
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedCampaignSummary && (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          { label: 'Total Targets', value: selectedCampaignSummary.totalTargets || 0 },
                          { label: 'Sent', value: selectedCampaignSummary.sentCount || 0 },
                          { label: 'Remaining', value: Math.max(0, (selectedCampaignSummary.totalTargets || 0) - (selectedCampaignSummary.sentCount || 0)) },
                          { label: 'Est. Time Left', value: estimatedTimeRemaining || '-' },
                        ].map((s) => (
                          <div key={s.label} className="rounded-lg bg-slate-800/60 p-3">
                            <p className="text-[11px] text-slate-500 uppercase">{s.label}</p>
                            <p className="text-xl font-bold mt-0.5">{s.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3">
                        <p className="font-medium text-sm">Activity Log</p>
                        {campaignActivityLog.length === 0 ? (
                          <p className="text-sm text-slate-500">No activity yet</p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-200 space-y-0.5">
                            {campaignActivityLog.map((item, i) => (
                              <p key={i}>
                                [{item.at ? new Date(item.at).toLocaleTimeString() : '--:--'}] {item.message}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
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
                    <div><span className="text-slate-500">Account:</span> <span className="text-slate-200">{selectedCampaign.accountIds?.length || 0}</span></div>
                    <div><span className="text-slate-500">Group:</span> <span className="text-slate-200">{selectedCampaign.sourceGroup || '-'}</span></div>
                    <div><span className="text-slate-500">Daily Limit:</span> <span className="text-slate-200">{selectedCampaign.dailyMessageLimitPerAccount}</span></div>
                    <div><span className="text-slate-500">Messages:</span> <span className="text-slate-200">{selectedCampaign.messages?.length || 0}</span></div>
                    <div><span className="text-slate-500">Interval:</span> <span className="text-slate-200">{selectedCampaign.messageIntervalSeconds || 5}s</span></div>
                  </div>

                  {selectedCampaignSummary && (
                    <>
                      <div className="text-xs font-semibold uppercase text-slate-500">Send Summary</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold">{selectedCampaignSummary.totalTargets || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Targets</p>
                        </div>
                        <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-emerald-400">{selectedCampaignSummary.sentCount || 0}</p>
                          <p className="text-[10px] text-slate-500 uppercase">Sent</p>
                        </div>
                      </div>

                      {selectedCampaignSummary.totalTargets > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-400">Completion</span>
                            <span className="text-slate-300">{Math.round((selectedCampaignSummary.sentCount / selectedCampaignSummary.totalTargets) * 100)}%</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(selectedCampaignSummary.sentCount / selectedCampaignSummary.totalTargets) * 100}%` }} />
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="text-xs font-semibold uppercase text-slate-500 mt-4">Actions</div>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full border-slate-700 text-xs"
                      onClick={() => openEditFlow(selectedCampaign)}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit Campaign
                    </Button>
                    <Button variant="outline" size="sm" className="w-full border-red-600/50 text-red-300 hover:bg-red-500/10 text-xs"
                      onClick={handleDeleteSelectedCampaign} disabled={isSubmitting}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete Campaign
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <p>No campaign selected</p>
                </div>
              )}
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
