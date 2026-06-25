'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Flame, Play, Square, Users, Clock, Activity, MessageCircle, RefreshCw, ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AuthGuard } from '@/components/auth-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function WarmUpWorkspace() {
  const { user, startWarmup, stopWarmup, getWarmupStatus } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [initializing, setInitializing] = useState(true)

  const [intervalSeconds, setIntervalSeconds] = useState(120)

  const [totalSent, setTotalSent] = useState(0)
  const [dmSent, setDmSent] = useState(0)
  const [accountCount, setAccountCount] = useState(0)
  const [cooldownCount, setCooldownCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [accountStats, setAccountStats] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [rotationOrder, setRotationOrder] = useState<{ accountId: string; displayName: string }[]>([])
  const [rotationOffset, setRotationOffset] = useState(1)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [elapsed, setElapsed] = useState('')

  const accounts = useMemo(() => user?.connectedAccounts || [], [user])
  const onlineAccounts = useMemo(() => accounts.filter(a => a.status === 'online'), [accounts])

  const accountNameLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of accounts) {
      map.set(a.id, a.displayName || a.username || a.id.slice(0, 8))
    }
    return map
  }, [accounts])

  const handleStart = useCallback(async () => {
    if (onlineAccounts.length < 2) {
      setError('Need at least 2 online accounts so they can message each other')
      return
    }
    if (intervalSeconds < 10) {
      setError('Interval must be at least 10 seconds')
      return
    }
    setError(null)
    setStarting(true)
    try {
      const allIds = onlineAccounts.map(a => a.id)
      await startWarmup(allIds, intervalSeconds)
      setRunning(true)
      setStartedAt(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start warmup')
    } finally {
      setStarting(false)
    }
  }, [onlineAccounts, intervalSeconds, startWarmup])

  const handleStop = useCallback(async () => {
    setError(null)
    try {
      await stopWarmup()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop warmup')
    }
  }, [stopWarmup])

  useEffect(() => {
    if (!running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      return
    }
    const poll = async () => {
      try {
        const res = await getWarmupStatus()
        setTotalSent(res.totalSent || 0)
        setDmSent(res.dmSent || 0)
        setAccountCount(res.accounts || 0)
        setCooldownCount(res.restingCount || 0)
        setErrorCount(res.errorCount || 0)
        setAccountStats(res.accountStats || [])
        setActivity(res.activity || [])
        setRotationOrder(res.order || [])
        if (typeof res.rotationOffset === 'number') setRotationOffset(res.rotationOffset)
        if (!res.running) {
          setRunning(false)
          setStartedAt(null)
        }
      } catch {
        setRunning(false)
        setStartedAt(null)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)

    timerRef.current = setInterval(() => {
      if (startedAt) {
        const sec = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        setElapsed(`${h}h ${m}m ${s}s`)
      }
    }, 1000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [running, startedAt, getWarmupStatus])

  useEffect(() => {
    (async () => {
      try {
        const res = await getWarmupStatus()
        if (res.running) {
          setRunning(true)
          setTotalSent(res.totalSent || 0)
          setDmSent(res.dmSent || 0)
          setAccountCount(res.accounts || 0)
          setCooldownCount(res.restingCount || 0)
          setErrorCount(res.errorCount || 0)
          setAccountStats(res.accountStats || [])
          setActivity(res.activity || [])
          setRotationOrder(res.order || [])
          if (typeof res.rotationOffset === 'number') setRotationOffset(res.rotationOffset)
          setStartedAt(res.startedAt || new Date().toISOString())
          if (res.intervalSeconds) setIntervalSeconds(res.intervalSeconds)
        }
      } catch {
        /* not running — show config view */
      } finally {
        setInitializing(false)
      }
    })()
  }, [getWarmupStatus])

  const recentActivity = useMemo(() => [...activity].reverse().slice(0, 50), [activity])
  const latestSenderId = recentActivity[0]?.accountId as string | undefined

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <Flame className="w-5 h-5 text-orange-400" />
          <h1 className="text-lg font-bold">Warm Up</h1>
          {initializing ? (
            <span className="ml-auto text-xs text-slate-500 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Loading...
            </span>
          ) : running ? (
            <>
              <span className="ml-auto text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                Running
              </span>
              <span className="text-xs text-slate-500">{totalSent} msgs · {elapsed}</span>
              <Button onClick={handleStop} size="sm" className="bg-rose-600 hover:bg-rose-700 h-7 text-xs">
                <Square className="w-3 h-3 mr-1" /> Stop
              </Button>
            </>
          ) : (
            <span className="ml-auto text-xs text-slate-500">
              {onlineAccounts.length} online accounts
            </span>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 p-4">
          {initializing ? (
            <div className="h-full rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
              <p className="text-sm">Checking warm-up status...</p>
            </div>
          ) : running ? (
            <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
              {/* Main stats panel */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-y-auto p-4 space-y-4">
                {/* Summary cards */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg bg-slate-800/60 p-3">
                    <p className="text-xs text-slate-500 uppercase">Total Sent</p>
                    <p className="text-2xl font-bold mt-1">{totalSent}</p>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 p-3">
                    <p className="text-xs text-slate-500 uppercase">Cross-Account DMs</p>
                    <p className="text-2xl font-bold mt-1 text-purple-400">{dmSent}</p>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 p-3">
                    <p className="text-xs text-slate-500 uppercase">Accounts</p>
                    <p className="text-2xl font-bold mt-1">
                      {accountCount}
                      {cooldownCount > 0 && <span className="text-sm text-rose-400 ml-2">({cooldownCount} resting)</span>}
                      {errorCount > 0 && <span className="text-sm text-rose-400 ml-2">({errorCount} errors)</span>}
                    </p>
                  </div>
                </div>

                {/* Rotation visual — who is messaging whom, in order */}
                {rotationOrder.length >= 2 && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500 mb-3 flex items-center gap-2">
                      Rotation
                      <span className="text-[10px] text-slate-600 normal-case">step {rotationOffset}</span>
                    </div>
                    <div className="rounded-lg border border-slate-700/60 p-3 grid gap-1.5 sm:grid-cols-2">
                      {rotationOrder.map((acct, i) => {
                        const target = rotationOrder[(i + rotationOffset) % rotationOrder.length]
                        const active = latestSenderId === acct.accountId
                        return (
                          <div
                            key={acct.accountId}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                              active ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'bg-slate-800/40'
                            }`}
                          >
                            <span className="truncate text-slate-200 max-w-[42%]">
                              {accountNameLookup.get(acct.accountId) || acct.displayName}
                            </span>
                            <ArrowRight className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                            <span className="truncate text-slate-300 max-w-[42%]">
                              {accountNameLookup.get(target.accountId) || target.displayName}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Per-account table */}
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Account Breakdown</div>
                  {accountStats.length === 0 ? (
                    <div className="text-sm text-slate-500 text-center py-8">Waiting for accounts to send...</div>
                  ) : (
                    <div className="rounded-lg border border-slate-700/60 overflow-hidden">
                      <table className="w-full text-sm text-left text-slate-300">
                        <thead className="bg-slate-800/80 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Account</th>
                            <th className="px-4 py-2">State</th>
                            <th className="px-4 py-2 text-right">DM</th>
                            <th className="px-4 py-2 text-right">Total</th>
                            <th className="px-4 py-2">Bar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {accountStats.map((stat) => (
                            <tr key={stat.accountId} className="hover:bg-slate-800/30 transition">
                              <td className="px-4 py-2 text-xs text-cyan-300 font-medium">
                                {accountNameLookup.get(stat.accountId) || stat.displayName}
                              </td>
                              <td className="px-4 py-2 text-xs">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                  stat.state === 'active' ? 'bg-emerald-500/15 text-emerald-300' :
                                  stat.state === 'resting' || stat.state === 'cooldown' ? 'bg-rose-500/15 text-rose-300' :
                                  'bg-slate-500/15 text-slate-300'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    stat.state === 'active' ? 'bg-emerald-400' :
                                    stat.state === 'resting' || stat.state === 'cooldown' ? 'bg-rose-400' : 'bg-slate-400'
                                  }`} />
                                  {stat.state === 'cooldown' ? 'resting' : stat.state}
                                  {(stat.state === 'resting' || stat.state === 'cooldown') && stat.restSeconds > 0 && (
                                    <span className="text-rose-400 ml-1">({Math.round(stat.restSeconds / 60)}m left)</span>
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-xs text-right text-purple-300">{stat.dmSentToday || 0}</td>
                              <td className="px-4 py-2 text-xs text-right text-slate-200">{stat.sentToday}</td>
                              <td className="px-4 py-2">
                                <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-emerald-500"
                                    style={{ width: `${Math.min(100, (stat.sentToday / stat.dailyLimit) * 100)}%` }}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Activity log */}
                {recentActivity.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Recent Activity</div>
                    <div className="rounded-lg border border-slate-700/60 max-h-64 overflow-y-auto">
                      <table className="w-full text-xs text-left text-slate-400">
                        <thead className="bg-slate-800/80 text-[10px] uppercase text-slate-500 sticky top-0">
                          <tr>
                            <th className="px-3 py-1.5">Time</th>
                            <th className="px-3 py-1.5">Account</th>
                            <th className="px-3 py-1.5">Type</th>
                            <th className="px-3 py-1.5">Target</th>
                            <th className="px-3 py-1.5">Message</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {recentActivity.map((entry, i) => (
                            <tr key={i} className="hover:bg-slate-800/30">
                              <td className="px-3 py-1.5 text-slate-500">
                                {entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                              </td>
                              <td className="px-3 py-1.5 text-cyan-300">{entry.displayName}</td>
                              <td className="px-3 py-1.5">
                                <span className="text-purple-300">DM</span>
                              </td>
                              <td className="px-3 py-1.5 max-w-[120px] truncate">{entry.target}</td>
                              <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-300">"{entry.message}"</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Right panel - status */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-y-auto p-4 space-y-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Warmup Info</div>
                <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 text-xs">
                  <div><span className="text-slate-500">Accounts:</span> <span className="text-slate-200">{accountCount}</span></div>
                  <div><span className="text-slate-500">Interval:</span> <span className="text-slate-200">{intervalSeconds}s</span></div>
                  <div><span className="text-slate-500">Daily limit:</span> <span className="text-slate-200">15 / account</span></div>
                  <div><span className="text-slate-500">Started:</span> <span className="text-slate-200">{startedAt ? new Date(startedAt).toLocaleTimeString() : '-'}</span></div>
                  <div><span className="text-slate-500">Elapsed:</span> <span className="text-slate-200">{elapsed}</span></div>
                </div>

                <div className="text-xs font-semibold uppercase text-slate-500">Stats</div>
                <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-purple-400">{dmSent}</p>
                  <p className="text-[10px] text-slate-500 uppercase">DM msgs</p>
                </div>

                <div className="text-xs font-semibold uppercase text-slate-500">Account Status</div>
                {accountStats.length === 0 ? (
                  <div className="rounded-lg bg-slate-800/40 p-3 text-xs text-slate-500 text-center">Waiting...</div>
                ) : (
                  <div className="space-y-1.5">
                    {accountStats.map((stat) => (
                      <div key={stat.accountId} className="rounded-lg border border-slate-700 bg-slate-800/40 p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium truncate text-slate-200">
                            {accountNameLookup.get(stat.accountId) || stat.displayName}
                          </p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            stat.state === 'active' ? 'bg-emerald-500/15 text-emerald-300' :
                            stat.state === 'resting' || stat.state === 'cooldown' ? 'bg-rose-500/15 text-rose-300' :
                            'bg-slate-500/15 text-slate-300'
                          }`}>{stat.state === 'cooldown' ? 'resting' : stat.state}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] mt-1">
                          <span className="text-slate-500">DM:{stat.dmSentToday || 0}</span>
                          <span className="text-slate-300">{stat.sentToday}/{stat.dailyLimit}</span>
                        </div>
                        {stat.lastError && (
                          <p className="text-[10px] text-rose-400 mt-0.5 truncate" title={stat.lastError}>{stat.lastError}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs font-semibold uppercase text-slate-500">Actions</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-rose-600/50 text-rose-300 hover:bg-rose-500/10 text-xs"
                  onClick={handleStop}
                >
                  <Square className="w-3 h-3 mr-1" /> Stop Warm Up
                </Button>
              </div>
            </div>
          ) : (
            /* Configuration view */
            <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-6 overflow-y-auto">
                <div>
                  <h3 className="text-sm font-semibold uppercase text-slate-500 mb-1">Configure Warm Up</h3>
                  <p className="text-xs text-slate-400">
                    All {onlineAccounts.length} online accounts will be used automatically. They send random direct messages to each other and start immediately.
                  </p>
                </div>

                {onlineAccounts.length < 2 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                    Need at least 2 online accounts so they can message each other. Connect more accounts first.
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200">1. Set interval</h3>
                  <div className="flex items-center gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-slate-400">Seconds between each send</p>
                      <Input
                        type="number"
                        min={10}
                        value={intervalSeconds}
                        onChange={(e) => setIntervalSeconds(Math.max(10, Number(e.target.value)))}
                        className="w-32 bg-slate-800 border-slate-700 text-sm h-8"
                      />
                    </div>
                    <div className="pt-4 text-xs text-slate-500">
                      ~{onlineAccounts.length > 0 ? Math.round((onlineAccounts.length * 15 * intervalSeconds) / 3600) : 0}h/day total
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleStart}
                    disabled={onlineAccounts.length < 2 || starting}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {starting ? (
                      <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
                    ) : (
                      <><Play className="w-4 h-4 mr-2" /> Start Warm Up</>
                    )}
                  </Button>
                  {onlineAccounts.length >= 2 && (
                    <p className="text-xs text-slate-500 mt-2">
                      {onlineAccounts.length} accounts will send direct messages to each other
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                <p className="text-xs text-slate-400 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  Accounts send direct messages to each other at random
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  Each account sends up to 15 messages/day, then rests
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  On any error, the account rests for 4 hours
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function WarmUpPage() {
  return (
    <AuthGuard>
      <WarmUpWorkspace />
    </AuthGuard>
  )
}
