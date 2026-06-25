'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useAuth,
  type GroupScraperAccountState,
  type GroupScraperCampaignEvent,
  type GroupScraperCampaignRecord,
} from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandedLoader } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Activity, Clock3, ShieldAlert, Search, Play, Square, Trash2, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const LIVE_STATUSES = new Set(['scraping', 'running'])

function eventColor(event: GroupScraperCampaignEvent) {
  const status = (event.status || '').toLowerCase()
  if (status === 'success' || status === 'joined' || status === 'done') return 'text-emerald-300'
  if (status === 'failed') return 'text-rose-300'
  if (status === 'skipped') return 'text-amber-300'
  if (status === 'joining' || status === 'running') return 'text-blue-300'
  if (status === 'resting' || status === 'cooldown') return 'text-rose-300'
  return 'text-slate-300'
}

function eventLabel(event: GroupScraperCampaignEvent) {
  const parts: string[] = []
  if (event.accountLabel) parts.push('[' + event.accountLabel + ']')
  if (event.group) parts.push(event.group)
  if (event.member) parts.push(event.member)
  if (event.message) parts.push(event.message)
  if (parts.length === 0) return event.type
  return parts.join(' ')
}

function stateChip(state: string) {
  const normalized = state.toLowerCase()
  if (normalized === 'resting' || normalized === 'cooldown') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
  if (normalized === 'blocked') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
  if (normalized === 'active') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
  if (normalized === 'failed') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
  return 'bg-slate-500/15 text-slate-300 border border-slate-600'
}

function formatSeconds(totalSeconds: number) {
  const value = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(value / 60)
  const seconds = value % 60
  if (minutes > 0) return minutes + 'm ' + seconds + 's'
  return seconds + 's'
}

function getRestSecondsRemaining(account: GroupScraperAccountState, nowTick: number) {
  if (!account.restUntil) return Math.max(0, Number(account.restSeconds || 0))
  const diffMs = new Date(account.restUntil).getTime() - nowTick
  return Math.max(0, Math.ceil(diffMs / 1000))
}

function getEffectiveState(account: GroupScraperAccountState, nowTick: number) {
  const raw = String(account.state || 'idle').toLowerCase()
  if (raw !== 'resting' && raw !== 'cooldown') return raw
  return getRestSecondsRemaining(account, nowTick) > 0 ? 'resting' : 'idle'
}

export default function WorkspaceSettingsPage() {
  const {
    user, listGroupsForAccount, runGroupScraper, listGroupScraperCampaigns,
    getGroupScraperCampaign, startGroupScraperCampaign, stopGroupScraperCampaign,
    leaveGroupScraperGroups, joinGroupScraperGroups, updateGroupScraperDelay,
    deleteGroupScraperCampaign,
  } = useAuth()

  const [sourceAccountId, setSourceAccountId] = useState('')
  const [inviterAccountIds, setInviterAccountIds] = useState<string[]>([])
  const [sourceGroup, setSourceGroup] = useState('')
  const [targetGroup, setTargetGroup] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(2)
  const [groupOptions, setGroupOptions] = useState<{ id: string; title: string; username?: string | null }[]>([])
  const [campaigns, setCampaigns] = useState<GroupScraperCampaignRecord[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [isLoadingGroups, setIsLoadingGroups] = useState(false)
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [isSubmittingAction, setIsSubmittingAction] = useState(false)
  const [isSavingDelay, setIsSavingDelay] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState<number>(Date.now())
  const [campaignSearch, setCampaignSearch] = useState('')

  const accounts = user?.connectedAccounts || []

  const selectedCampaign = useMemo(
    () => campaigns.find((item) => item.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  )
  const getCampaignRef = useRef(getGroupScraperCampaign)
  useEffect(() => { getCampaignRef.current = getGroupScraperCampaign }, [getGroupScraperCampaign])

  useEffect(() => {
    if (!selectedCampaign) return
    setDelaySeconds(Number(selectedCampaign.delaySeconds) || 0)
  }, [selectedCampaign?.id, selectedCampaign?.delaySeconds])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (accounts.length === 0) { setSourceAccountId(''); setInviterAccountIds([]); return }
    if (!sourceAccountId || !accounts.some((item) => item.id === sourceAccountId)) setSourceAccountId(accounts[0].id)
    if (inviterAccountIds.length === 0) { setInviterAccountIds(accounts.map((item) => item.id)); return }
    setInviterAccountIds((prev) => prev.filter((id) => accounts.some((item) => item.id === id)))
  }, [accounts, sourceAccountId, inviterAccountIds.length])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoadingCampaigns(true); setError(null)
      try {
        const items = await listGroupScraperCampaigns()
        if (cancelled) return
        setCampaigns(items)
        if (!selectedCampaignId && items.length > 0) setSelectedCampaignId(items[0].id)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load campaigns')
      } finally { if (!cancelled) setIsLoadingCampaigns(false) }
    }
    load(); return () => { cancelled = true }
  }, [listGroupScraperCampaigns, selectedCampaignId])

  useEffect(() => {
    if (!sourceAccountId) { setGroupOptions([]); return }
    let cancelled = false
    const load = async () => {
      setIsLoadingGroups(true); setError(null)
      try {
        const groups = await listGroupsForAccount(sourceAccountId)
        if (cancelled) return
        setGroupOptions(groups)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load groups')
      } finally { if (!cancelled) setIsLoadingGroups(false) }
    }
    load(); return () => { cancelled = true }
  }, [sourceAccountId, listGroupsForAccount])

  useEffect(() => {
    if (!selectedCampaignId || !selectedCampaign) return
    let intervalId: ReturnType<typeof setInterval> | null = null
    const poll = async () => {
      try {
        const fresh = await getCampaignRef.current(selectedCampaignId)
        setCampaigns((prev) => prev.map((item) => (item.id === fresh.id ? fresh : item)))
      } catch { /* keep running */ }
    }
    poll()
    if (LIVE_STATUSES.has(selectedCampaign.status)) intervalId = setInterval(poll, 2000)
    return () => { if (intervalId) clearInterval(intervalId) }
  }, [selectedCampaignId, selectedCampaign?.status])

  const groupHints = useMemo(() =>
    groupOptions.map((g) => ({
      value: g.username ? '@' + g.username : g.id,
      label: g.username ? g.title + ' (@' + g.username + ')' : g.title + ' (' + g.id + ')',
    })),
    [groupOptions]
  )

  const filteredCampaigns = useMemo(() => {
    if (!campaignSearch.trim()) return campaigns
    const needle = campaignSearch.toLowerCase()
    return campaigns.filter((c) =>
      c.name.toLowerCase().includes(needle) || c.status.toLowerCase().includes(needle) ||
      c.sourceGroup.toLowerCase().includes(needle) || c.targetGroup.toLowerCase().includes(needle)
    )
  }, [campaigns, campaignSearch])

  const sortedEvents = useMemo(() => {
    if (!selectedCampaign) return []
    return [...(selectedCampaign.events || [])].reverse().slice(0, 160)
  }, [selectedCampaign])

  const accountStates = useMemo(() => {
    if (!selectedCampaign) return []
    const fromStats = (selectedCampaign.stats.accountStates || []).filter((item) => item.accountId)
    if (fromStats.length > 0) return fromStats
    const accountMap = new Map((user?.connectedAccounts || []).map((item) => [item.id, item]))
    return (selectedCampaign.inviterAccountIds || []).map((accountId) => {
      const account = accountMap.get(accountId)
      return {
        accountId, accountLabel: account?.displayName || account?.username || accountId,
        state: 'idle', attempted: 0, added: 0, skipped: 0, failed: 0,
        restSeconds: 0, restUntil: null, restReason: null,
        lastMember: null, lastMessage: null, lastEventAt: null, pendingCandidates: 0,
      }
    })
  }, [selectedCampaign, user?.connectedAccounts])

  const accountHealthSummary = useMemo(() => {
    const resting = accountStates.filter((item) => { const s = item.state.toLowerCase(); return s === 'resting' || s === 'cooldown' }).length
    const blocked = accountStates.filter((item) => item.state.toLowerCase() === 'blocked').length
    const active = accountStates.filter((item) => item.state.toLowerCase() === 'active').length
    const idle = accountStates.filter((item) => item.state.toLowerCase() === 'idle').length
    return { resting, blocked, active, idle }
  }, [accountStates])

  const inviteBreakdownData = useMemo(() => {
    const stats = selectedCampaign?.stats
    if (!stats) return []
    return [
      { name: 'Added', value: stats.added || 0, fill: '#22c55e' },
      { name: 'Skipped', value: stats.skipped || 0, fill: '#f59e0b' },
      { name: 'Failed', value: stats.failed || 0, fill: '#ef4444' },
    ].filter((item) => item.value > 0)
  }, [selectedCampaign])

  const accountBarData = useMemo(() =>
    accountStates.map((item) => ({
      account: item.accountLabel, Added: item.added || 0, Failed: item.failed || 0, Skipped: item.skipped || 0,
    })),
    [accountStates]
  )

  const trendData = useMemo(() => {
    if (!selectedCampaign) return []
    const inviteEvents = [...(selectedCampaign.events || [])]
      .filter((item) => item.type === 'invite_success' || item.type === 'invite_failed' || item.type === 'invite_skipped')
      .slice(-40)
    let added = 0, failed = 0, skipped = 0
    return inviteEvents.map((event) => {
      if (event.type === 'invite_success') added += 1
      if (event.type === 'invite_failed') failed += 1
      if (event.type === 'invite_skipped') skipped += 1
      return { at: new Date(event.at).toLocaleTimeString(), Added: added, Failed: failed, Skipped: skipped }
    })
  }, [selectedCampaign])

  const toggleInviter = (accountId: string) => {
    setInviterAccountIds((prev) => prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId])
  }

  const handleRun = async () => {
    setError(null); setIsRunning(true)
    try {
      const campaign = await runGroupScraper({ sourceAccountId, inviterAccountIds, sourceGroup, targetGroup, delaySeconds })
      setCampaigns((prev) => [campaign, ...prev.filter((item) => item.id !== campaign.id)])
      setSelectedCampaignId(campaign.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to run group inviter') }
    finally { setIsRunning(false) }
  }

  const handleStartInvite = async () => {
    if (!selectedCampaign) return
    setError(null); setIsSubmittingAction(true)
    try {
      const updated = await startGroupScraperCampaign(selectedCampaign.id)
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to start invite') }
    finally { setIsSubmittingAction(false) }
  }

  const handleStopCampaign = async () => {
    if (!selectedCampaign) return
    setError(null); setIsSubmittingAction(true)
    try {
      const updated = await stopGroupScraperCampaign(selectedCampaign.id)
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to stop campaign') }
    finally { setIsSubmittingAction(false) }
  }

  const handleLeaveGroups = async () => {
    if (!selectedCampaign) return
    setError(null); setIsSubmittingAction(true)
    try {
      const updated = await leaveGroupScraperGroups(selectedCampaign.id)
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to leave groups') }
    finally { setIsSubmittingAction(false) }
  }

  const handleJoinGroups = async () => {
    if (!selectedCampaign) return
    setError(null); setIsSubmittingAction(true)
    try {
      const updated = await joinGroupScraperGroups(selectedCampaign.id)
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to join groups') }
    finally { setIsSubmittingAction(false) }
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleDeleteCampaignConfirm = async () => {
    if (!pendingDeleteId) return
    setError(null); setIsSubmittingAction(true)
    try {
      await deleteGroupScraperCampaign(pendingDeleteId)
      let nextSelectedId: string | null = null
      setCampaigns((prev) => { const remaining = prev.filter((item) => item.id !== pendingDeleteId); nextSelectedId = remaining.length > 0 ? remaining[0].id : null; return remaining })
      setSelectedCampaignId((prev) => (prev === pendingDeleteId ? nextSelectedId : prev))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete') }
    finally { setIsSubmittingAction(false); setPendingDeleteId(null) }
  }

  const handleSaveDelay = async () => {
    if (!selectedCampaign) return
    setError(null); setIsSavingDelay(true)
    try {
      const updated = await updateGroupScraperDelay(selectedCampaign.id, delaySeconds)
      setCampaigns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update delay') }
    finally { setIsSavingDelay(false) }
  }

  return (
    <div className="h-full min-h-0">
      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="h-full min-h-0 p-2 sm:p-4">
        <div className="h-full rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden grid grid-cols-1 lg:grid-cols-[320px_1fr_300px]">
          {/* Left Panel - Form + Campaign List */}
          <aside className="border-r border-slate-800 flex flex-col min-h-0">
            {/* Form */}
            <div className="p-3 space-y-3 border-b border-slate-800 overflow-y-auto" style={{ maxHeight: '50vh' }}>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Source Account</span>
                <select className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white mt-1"
                  value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)}>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.username}</option>)}
                </select>
              </label>

              <div>
                <span className="text-xs font-semibold uppercase text-slate-500">Inviter Accounts</span>
                <div className="max-h-20 space-y-1 overflow-auto rounded-md border border-slate-700 bg-slate-800 p-2 mt-1">
                  {accounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-xs text-slate-200">
                      <input type="checkbox" checked={inviterAccountIds.includes(a.id)} onChange={() => toggleInviter(a.id)} />
                      <span className="truncate">{a.displayName || a.username}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Source Group</span>
                  <Input type="text" list="group-scraper-options" placeholder="@source"
                    value={sourceGroup} onChange={(e) => setSourceGroup(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-xs h-7 mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Target Group</span>
                  <Input type="text" list="group-scraper-options" placeholder="@target"
                    value={targetGroup} onChange={(e) => setTargetGroup(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-xs h-7 mt-1" />
                </label>
              </div>

              <datalist id="group-scraper-options">
                {groupHints.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </datalist>

              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Delay (sec)</span>
                <Input type="number" min={0} max={3600} step="0.5" value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                  className="bg-slate-800 border-slate-700 text-xs h-7 mt-1" />
              </label>

              <Button onClick={handleRun} disabled={isRunning || accounts.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-xs h-8">
                {isRunning ? 'Preparing...' : 'Run Group Inviter'}
              </Button>
            </div>

            {/* Campaign List */}
            <div className="flex flex-col min-h-0" style={{ maxHeight: '50vh' }}>
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <Input placeholder="Search..." value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)}
                    className="pl-8 bg-slate-800 border-slate-700 text-xs h-7" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
                {isLoadingCampaigns ? (
                  <div className="p-6"><BrandedLoader label="Loading campaigns" /></div>
                ) : filteredCampaigns.length === 0 ? (
                  <div className="p-3 text-xs text-slate-400 text-center">No campaigns</div>
                ) : (
                  filteredCampaigns.map((campaign) => {
                    const active = campaign.id === selectedCampaignId
                    return (
                      <div key={campaign.id} className={`px-3 py-2 cursor-pointer transition ${active ? 'bg-blue-500/15' : 'hover:bg-slate-800/50'}`}>
                        <button onClick={() => setSelectedCampaignId(campaign.id)} className="w-full text-left">
                          <p className="text-xs font-medium truncate">{campaign.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {campaign.status} - {new Date(campaign.updatedAt).toLocaleDateString()}
                          </p>
                        </button>
                        <div className="flex items-center gap-1 mt-1">
                          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs text-rose-400 hover:text-rose-300 ml-auto"
                            onClick={() => setPendingDeleteId(campaign.id)} disabled={isSubmittingAction}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </aside>

          {/* Middle Panel - Stats & Charts */}
          <section className="flex flex-col min-h-0 overflow-y-auto">
            {selectedCampaign ? (
              <div className="p-6 space-y-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold">{selectedCampaign.name}</h3>
                    <p className="text-sm text-slate-400 mt-0.5">
                      Status: <span className={LIVE_STATUSES.has(selectedCampaign.status) ? 'text-emerald-400' : 'text-slate-300'}>{selectedCampaign.status}</span>
                      {' - '}Source: {selectedCampaign.sourceGroup}{' - '}Target: {selectedCampaign.targetGroup}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {LIVE_STATUSES.has(selectedCampaign.status) ? (
                      <Button onClick={handleStopCampaign} disabled={isSubmittingAction} className="bg-red-600 hover:bg-red-700 text-xs h-8">
                        <Square className="w-4 h-4 mr-1" /> Stop Invite
                      </Button>
                    ) : (
                      <Button onClick={handleStartInvite} disabled={isSubmittingAction || !['ready', 'stopped', 'completed'].includes(selectedCampaign.status)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-xs h-8">
                        <Play className="w-4 h-4 mr-1" /> Start Invite
                      </Button>
                    )}
                    <Button onClick={handleLeaveGroups} disabled={isSubmittingAction} className="bg-amber-600 hover:bg-amber-700 text-xs h-8">
                      <ArrowDownLeft className="w-4 h-4 mr-1" /> Leave Groups
                    </Button>
                    <Button onClick={handleJoinGroups} disabled={isSubmittingAction} className="bg-cyan-600 hover:bg-cyan-700 text-xs h-8">
                      <ArrowUpRight className="w-4 h-4 mr-1" /> Join Groups
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: 'Scraped', value: selectedCampaign.stats.scrapedCount, cls: '' },
                    { label: 'Added', value: selectedCampaign.stats.added, cls: 'text-emerald-400' },
                    { label: 'Skipped', value: selectedCampaign.stats.skipped, cls: 'text-amber-400' },
                    { label: 'Failed', value: selectedCampaign.stats.failed, cls: 'text-rose-400' },
                    { label: 'Joined', value: selectedCampaign.stats.joinedAccounts + '/' + selectedCampaign.stats.totalAccounts, cls: '' },
                    { label: 'Remaining', value: selectedCampaign.stats.remainingCandidates || 0, cls: 'text-cyan-300' },
                    { label: 'Phase', value: selectedCampaign.stats.activePhase || '-', cls: '' },
                    { label: 'Delay', value: delaySeconds + 's', cls: '' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg bg-slate-800/60 p-3">
                      <p className="text-xs text-slate-500 uppercase">{s.label}</p>
                      <p className={'text-xl font-bold mt-0.5 ' + s.cls}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {selectedCampaign.stats.activeAccountLabel && (
                  <p className="text-sm text-slate-400">
                    Active account: {selectedCampaign.stats.activeAccountLabel} | Group: {selectedCampaign.stats.activeGroup || '-'}
                  </p>
                )}

                {selectedCampaign.stats.blockedAccounts.length > 0 && (
                  <p className="text-sm text-amber-300">Blocked: {selectedCampaign.stats.blockedAccounts.join(', ')}</p>
                )}

                {/* Account Health Monitor */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <ShieldAlert className="h-4 w-4 text-orange-300" /> Account Flood & Rest Monitor
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 md:grid-cols-4">
                    <div className="rounded-md bg-slate-800/80 p-2">Active: {accountHealthSummary.active}</div>
                    <div className="rounded-md bg-slate-800/80 p-2">Resting: {accountHealthSummary.resting}</div>
                    <div className="rounded-md bg-slate-800/80 p-2">Blocked: {accountHealthSummary.blocked}</div>
                    <div className="rounded-md bg-slate-800/80 p-2">Idle: {accountHealthSummary.idle}</div>
                  </div>
                  <div className="max-h-48 overflow-auto rounded-lg border border-slate-700/60">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800/80 text-slate-400">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Account</th>
                          <th className="px-3 py-1.5 text-left">State</th>
                          <th className="px-3 py-1.5 text-left">Rest</th>
                          <th className="px-3 py-1.5 text-left">Pending</th>
                          <th className="px-3 py-1.5 text-left">Added</th>
                          <th className="px-3 py-1.5 text-left">Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountStates.map((item) => {
                          const restLeft = getRestSecondsRemaining(item, nowTick)
                          const effectiveState = getEffectiveState(item, nowTick)
                          return (
                            <tr key={item.accountId} className="border-t border-slate-800/70 text-slate-200">
                              <td className="px-3 py-1.5">{item.accountLabel}</td>
                              <td className="px-3 py-1.5"><span className={'inline-flex rounded-full px-2 py-0.5 text-xs ' + stateChip(effectiveState)}>{effectiveState}</span></td>
                              <td className="px-3 py-1.5">{effectiveState === 'resting' ? formatSeconds(restLeft) : '-'}</td>
                              <td className="px-3 py-1.5 text-cyan-300">{item.pendingCandidates || 0}</td>
                              <td className="px-3 py-1.5 text-emerald-300">{item.added || 0}</td>
                              <td className="px-3 py-1.5 text-rose-300">{item.failed || 0}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Delay Control */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400">Delay / Invite (sec)</label>
                  <Input type="number" min={0} max={3600} step="0.5" value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))} className="h-7 w-24 border-slate-700 bg-slate-800 text-xs" />
                  <Button onClick={handleSaveDelay} disabled={isSavingDelay || isSubmittingAction} className="bg-blue-600 hover:bg-blue-700 text-xs h-7">
                    {isSavingDelay ? 'Saving...' : 'Apply'}
                  </Button>
                </div>

                {/* Charts */}
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                      <Activity className="h-4 w-4 text-blue-300" /> Invite Outcome Mix
                    </div>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        {inviteBreakdownData.length > 0 ? (
                          <PieChart><Pie data={inviteBreakdownData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label /><Tooltip /><Legend /></PieChart>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-500">No invite outcomes yet</div>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                    <h4 className="mb-3 text-sm font-medium text-slate-200">Per Account Performance</h4>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={accountBarData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="account" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                          <Tooltip /><Legend />
                          <Bar dataKey="Added" fill="#22c55e" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Skipped" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                    <Clock3 className="h-4 w-4 text-cyan-300" /> Invite Trend
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="at" tick={{ fill: '#94a3b8', fontSize: 10 }} hide={trendData.length > 14} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                        <Tooltip /><Legend />
                        <Line type="monotone" dataKey="Added" stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Skipped" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {selectedCampaign.failures.length > 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                    <h4 className="text-sm font-medium text-slate-200 mb-3">Failures</h4>
                    <div className="max-h-40 space-y-1 overflow-auto text-xs text-rose-200">
                      {selectedCampaign.failures.map((f, i) => (
                        <p key={i}>[{f.accountLabel}] {f.member}: {f.reason}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <Activity className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                  <p className="text-sm">Select a campaign or create one</p>
                </div>
              </div>
            )}
          </section>

          {/* Right Panel - Live Timeline */}
          <aside className="border-l border-slate-800 overflow-y-auto p-4 space-y-4">
            <div className="text-xs font-semibold uppercase text-slate-500">Live Timeline</div>
            {sortedEvents.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <Clock3 className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p>No events yet</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedEvents.map((event, index) => (
                  <div key={index} className="rounded-md bg-slate-800/40 px-2.5 py-2">
                    <p className={'text-xs ' + eventColor(event)}>
                      {new Date(event.at).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-slate-300 mt-0.5 break-words">{eventLabel(event)}</p>
                  </div>
                ))}
              </div>
            )}
          </aside>
          <ConfirmDialog
            open={pendingDeleteId !== null}
            onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
            title="Delete Group Inviter"
            description="Delete this group inviter permanently?"
            confirmLabel="Delete"
            onConfirm={handleDeleteCampaignConfirm}
          />
        </div>
      </div>
    </div>
  )
}
