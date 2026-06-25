'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus, Loader2, Play, Square, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AuthGuard } from '@/components/auth-guard'
import { Button } from '@/components/ui/button'
import { useAuth, type MassGroupCampaign } from '@/lib/auth-context'

const POLL_INTERVAL_MS = 2500

export default function MassGroupCreationPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const {
    user,
    createMassGroupCampaign,
    listMassGroupCampaigns,
    getMassGroupCampaign,
    startMassGroupCampaign,
    stopMassGroupCampaign,
    deleteMassGroupCampaign,
  } = useAuth()

  const accounts = user?.connectedAccounts ?? []

  const [usernamesText, setUsernamesText] = useState('')
  const [titleTemplate, setTitleTemplate] = useState('Group - {username}')
  const [selectedAdminIds, setSelectedAdminIds] = useState<string[]>([])
  const [delaySeconds, setDelaySeconds] = useState(30)
  const [submitting, setSubmitting] = useState(false)

  const [campaigns, setCampaigns] = useState<MassGroupCampaign[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeCampaign, setActiveCampaign] = useState<MassGroupCampaign | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const accountLabel = (id: string) => {
    const a = accounts.find(x => x.id === id)
    if (!a) return id
    return a.displayName || (a.username ? `@${a.username}` : a.phone || id)
  }

  const refreshList = useCallback(async () => {
    try {
      const res = await listMassGroupCampaigns()
      setCampaigns(res.campaigns)
    } catch {
      // non-fatal
    }
  }, [listMassGroupCampaigns])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  // Poll the active campaign while it runs.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!activeId) return
    const tick = async () => {
      try {
        const c = await getMassGroupCampaign(activeId)
        setActiveCampaign(c)
        if (c.status !== 'running') {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
          refreshList()
        }
      } catch {
        // ignore transient errors
      }
    }
    tick()
    pollRef.current = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [activeId, getMassGroupCampaign, refreshList])

  const toggleAdmin = (id: string) => {
    setSelectedAdminIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const parsedUsernames = usernamesText
    .split(/[\n,]/)
    .map(u => u.trim().replace(/^@/, ''))
    .filter(Boolean)

  const handleStart = async () => {
    if (parsedUsernames.length === 0) {
      toast.error('Enter at least one username')
      return
    }
    if (!titleTemplate.includes('{username}')) {
      toast.error('Title template must include {username}')
      return
    }
    if (accounts.length === 0) {
      toast.error('No connected accounts available')
      return
    }
    setSubmitting(true)
    try {
      const created = await createMassGroupCampaign({
        title_template: titleTemplate.trim(),
        admin_account_ids: selectedAdminIds,
        usernames: parsedUsernames,
        delay_seconds: delaySeconds,
      })
      const started = await startMassGroupCampaign(created.id)
      setActiveId(started.id)
      setActiveCampaign(started)
      await refreshList()
      toast.success(`Started creating ${parsedUsernames.length} group(s)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStop = async (id: string) => {
    try {
      await stopMassGroupCampaign(id)
      toast.success('Stopping after the current group')
      await refreshList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to stop')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMassGroupCampaign(id)
      if (activeId === id) {
        setActiveId(null)
        setActiveCampaign(null)
      }
      await refreshList()
      toast.success('Deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const viewCampaign = async (id: string) => {
    setActiveId(id)
    try {
      setActiveCampaign(await getMassGroupCampaign(id))
    } catch {
      // ignore
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      running: 'bg-blue-900/40 text-blue-300 border-blue-700',
      done: 'bg-green-900/40 text-green-300 border-green-700',
      stopped: 'bg-amber-900/40 text-amber-300 border-amber-700',
      idle: 'bg-slate-800 text-slate-300 border-slate-700',
    }
    return map[status] || map.idle
  }

  return (
    <AuthGuard>
      <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
        <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <FolderPlus className="w-7 h-7 text-blue-400" />
                <div>
                  <h1 className="text-2xl font-semibold">Mass Group Creation</h1>
                  <p className="text-sm text-slate-400">
                    Create a separate group for each username. Groups are created by rotating
                    connected accounts to reduce bans &mdash; only an account that can resolve the
                    username creates that group.
                  </p>
                </div>
              </div>

              {/* Form */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Target usernames</label>
                  <textarea
                    value={usernamesText}
                    onChange={e => setUsernamesText(e.target.value)}
                    rows={6}
                    placeholder={'@user1\n@user2\n@user3'}
                    className="w-full rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    One per line (or comma-separated). {parsedUsernames.length} username(s) detected.
                    One group will be created per username.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Group title template</label>
                  <input
                    value={titleTemplate}
                    onChange={e => setTitleTemplate(e.target.value)}
                    className="w-full rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Use <code className="text-slate-300">{'{username}'}</code> as a placeholder, e.g.
                    {' '}<span className="text-slate-300">VIP - {'{username}'}</span>.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Admins (your accounts &mdash; promoted to admin in every group)
                  </label>
                  {accounts.length === 0 ? (
                    <p className="text-sm text-slate-500">No connected accounts.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {accounts.map(a => (
                        <label
                          key={a.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition text-sm ${
                            selectedAdminIds.includes(a.id)
                              ? 'border-blue-500 bg-blue-900/20 text-white'
                              : 'border-slate-700 bg-slate-800/40 text-gray-300 hover:border-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAdminIds.includes(a.id)}
                            onChange={() => toggleAdmin(a.id)}
                          />
                          <span className="truncate">{accountLabel(a.id)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 mt-1">
                    Note: an admin account must have a public @username to be promoted by the creating
                    account. All connected accounts are used (rotated) as group creators.
                  </p>
                </div>

                <div className="flex items-end gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Delay between groups (sec)</label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={delaySeconds}
                      onChange={e => setDelaySeconds(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
                      className="w-32 rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <Button onClick={handleStart} disabled={submitting} className="bg-blue-600 hover:bg-blue-500">
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Start creating groups
                  </Button>
                </div>
              </div>

              {/* Active campaign progress */}
              {activeCampaign && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{activeCampaign.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(activeCampaign.status)}`}>
                        {activeCampaign.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeCampaign.status === 'running' && (
                        <Button variant="outline" size="sm" onClick={() => handleStop(activeCampaign.id)}>
                          <Square className="w-3.5 h-3.5" /> Stop
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <Stat label="Total" value={activeCampaign.stats.totalUsernames} />
                    <Stat label="Processed" value={activeCampaign.stats.processed} />
                    <Stat label="Created" value={activeCampaign.stats.groupsCreated} accent="text-green-400" />
                    <Stat label="Failed" value={activeCampaign.stats.failed} accent="text-red-400" />
                  </div>

                  {activeCampaign.status === 'running' && activeCampaign.stats.activeUsername && (
                    <p className="text-sm text-blue-300 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Working on @{activeCampaign.stats.activeUsername}&hellip;
                    </p>
                  )}

                  {/* Event log */}
                  <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-80 overflow-y-auto">
                    {[...activeCampaign.events].reverse().map((ev, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                        {ev.type === 'group_created' ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                        ) : ev.type === 'group_failed' ? (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        ) : (
                          <span className="w-4 h-4 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-slate-200 truncate">{ev.message}</p>
                          {ev.accountLabel && (
                            <p className="text-xs text-slate-500">via {ev.accountLabel}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {activeCampaign.events.length === 0 && (
                      <p className="px-3 py-3 text-sm text-slate-500">No activity yet.</p>
                    )}
                  </div>

                  {activeCampaign.failures.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-red-300">
                        {activeCampaign.failures.length} failure(s)
                      </summary>
                      <ul className="mt-2 space-y-1 text-slate-400">
                        {activeCampaign.failures.map((f, i) => (
                          <li key={i}>
                            <span className="text-slate-300">{f.username}</span>: {f.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {/* Past campaigns */}
              {campaigns.length > 0 && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                  <h2 className="font-medium mb-3">Runs</h2>
                  <div className="divide-y divide-slate-800">
                    {campaigns.map(c => (
                      <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <button
                          onClick={() => viewCampaign(c.id)}
                          className="flex items-center gap-3 text-left min-w-0 flex-1 hover:text-blue-300"
                        >
                          <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(c.status)}`}>
                            {c.status}
                          </span>
                          <span className="truncate">{c.name}</span>
                          <span className="text-xs text-slate-500 shrink-0">
                            {c.stats.groupsCreated}/{c.stats.totalUsernames} created
                          </span>
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-slate-500 hover:text-red-400 shrink-0"
                          title="Delete run"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-lg py-3">
      <div className={`text-2xl font-semibold ${accent || 'text-white'}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}
