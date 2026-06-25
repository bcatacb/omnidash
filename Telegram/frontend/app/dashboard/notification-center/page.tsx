'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Plus, Trash2, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AuthGuard } from '@/components/auth-guard'
import { useAuth, API_BASE_URL } from '@/lib/auth-context'

interface NotificationConfig {
  enabled: boolean
  hasToken: boolean
  tokenPreview: string
  pushoverUsers: string[]
  commandPrefix: string
}

interface NotificationWatcher {
  id: string
  accountId: string
  chatId: string
  chatTitle: string | null
  createdAt: string
  listenerRunning: boolean
}

interface GroupOption {
  chatId: string
  chatTitle: string
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sessionToken') || '' : ''
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? String((data as { detail: unknown }).detail) : 'Request failed'
    throw new Error(detail)
  }
  return data as T
}

export default function NotificationCenterPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, fetchMessages } = useAuth()

  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [watchers, setWatchers] = useState<NotificationWatcher[]>([])

  // Pushover form state
  const [enabled, setEnabled] = useState(true)
  const [token, setToken] = useState('')
  const [userKeys, setUserKeys] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Watcher form state
  const [selectedAccount, setSelectedAccount] = useState('')
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [selectedChatId, setSelectedChatId] = useState('')
  const [addingWatcher, setAddingWatcher] = useState(false)

  const accounts = user?.connectedAccounts || []

  const showBanner = (kind: 'ok' | 'err', text: string) => {
    setBanner({ kind, text })
    setTimeout(() => setBanner(null), 5000)
  }

  const loadConfig = useCallback(async () => {
    try {
      const data = await api<{ config: NotificationConfig; watchers: NotificationWatcher[] }>('/notifications/config')
      setConfig(data.config)
      setWatchers(data.watchers)
      setEnabled(data.config.enabled)
      setUserKeys(data.config.pushoverUsers.length ? data.config.pushoverUsers : [''])
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const loadGroups = useCallback(async (accountId: string) => {
    setLoadingGroups(true)
    setGroups([])
    setSelectedChatId('')
    try {
      const res = await fetchMessages(200, 0)
      const opts = res.conversations
        .filter((c) => c.isGroup && c.accountId === accountId)
        .map((c) => ({ chatId: c.chatId, chatTitle: c.chatTitle }))
      setGroups(opts)
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }, [fetchMessages])

  useEffect(() => {
    if (selectedAccount) {
      loadGroups(selectedAccount)
    }
  }, [selectedAccount, loadGroups])

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = await api<{ ok: boolean; config: NotificationConfig; watchers: NotificationWatcher[] }>(
        '/notifications/config',
        {
          method: 'PUT',
          body: JSON.stringify({
            enabled,
            pushoverToken: token, // empty keeps the existing token
            pushoverUsers: userKeys.map((k) => k.trim()).filter(Boolean),
            commandPrefix: config?.commandPrefix || '/m',
          }),
        }
      )
      setConfig(data.config)
      setWatchers(data.watchers)
      setToken('')
      setUserKeys(data.config.pushoverUsers.length ? data.config.pushoverUsers : [''])
      showBanner('ok', 'Settings saved')
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const r = await api<{ ok: boolean; sent: number; failed: number }>('/notifications/test', { method: 'POST' })
      showBanner('ok', `Test sent to ${r.sent} recipient(s)${r.failed ? `, ${r.failed} failed` : ''}`)
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleAddWatcher = async () => {
    if (!selectedAccount || !selectedChatId) return
    const group = groups.find((g) => g.chatId === selectedChatId)
    setAddingWatcher(true)
    try {
      const data = await api<{ ok: boolean; watchers: NotificationWatcher[] }>('/notifications/watchers', {
        method: 'POST',
        body: JSON.stringify({ accountId: selectedAccount, chatId: selectedChatId, chatTitle: group?.chatTitle || null }),
      })
      setWatchers(data.watchers)
      setSelectedChatId('')
      showBanner('ok', 'Group added')
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Failed to add group')
    } finally {
      setAddingWatcher(false)
    }
  }

  const handleRemoveWatcher = async (id: string) => {
    try {
      const data = await api<{ ok: boolean; watchers: NotificationWatcher[] }>(`/notifications/watchers/${id}`, {
        method: 'DELETE',
      })
      setWatchers(data.watchers)
    } catch (e) {
      showBanner('err', e instanceof Error ? e.message : 'Failed to remove group')
    }
  }

  const accountLabel = (accountId: string) => {
    const a = accounts.find((acc) => acc.id === accountId)
    return a ? a.displayName || `@${a.username}` || a.telegramId : accountId.slice(0, 8)
  }

  const prefix = config?.commandPrefix || '/m'

  return (
    <AuthGuard>
      <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
        <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <Bell className="w-6 h-6 text-blue-400" />
                <div>
                  <h1 className="text-2xl font-semibold">Notification Center</h1>
                  <p className="text-sm text-slate-400">
                    Send a Pushover alert when you type <code className="text-blue-300">{prefix} your message</code> in a watched group.
                  </p>
                </div>
              </div>

              {banner && (
                <div
                  className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
                    banner.kind === 'ok' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'
                  }`}
                >
                  {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {banner.text}
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Pushover setup */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-medium">Pushover</h2>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => setEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                        />
                        Enabled
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Application API Token</label>
                      <input
                        type="text"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={config?.hasToken ? `Saved (${config.tokenPreview}) — leave blank to keep` : 'Your Pushover app token'}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Recipient user / group keys</label>
                      <div className="space-y-2">
                        {userKeys.map((key, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              value={key}
                              onChange={(e) => setUserKeys((prev) => prev.map((k, idx) => (idx === i ? e.target.value : k)))}
                              placeholder="Pushover user key"
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              onClick={() => setUserKeys((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : ['']))}
                              className="rounded-lg border border-slate-700 px-3 text-slate-400 hover:text-red-400 hover:border-red-500/50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setUserKeys((prev) => [...prev, ''])}
                        className="mt-2 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                      >
                        <Plus className="w-4 h-4" /> Add another recipient
                      </button>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                      >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save settings
                      </button>
                      <button
                        onClick={handleTest}
                        disabled={testing || !config?.hasToken}
                        className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                      >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Send test
                      </button>
                    </div>
                  </div>

                  {/* Watched groups */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
                    <h2 className="text-lg font-medium">Watched groups</h2>
                    <p className="text-sm text-slate-400">
                      Pick an account and one of its group chats. When that account sends{' '}
                      <code className="text-blue-300">{prefix} ...</code> in the group, the text after{' '}
                      <code className="text-blue-300">{prefix}</code> is pushed to Pushover.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <select
                        value={selectedAccount}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">Select account…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.displayName || `@${a.username}`}
                          </option>
                        ))}
                      </select>

                      <select
                        value={selectedChatId}
                        onChange={(e) => setSelectedChatId(e.target.value)}
                        disabled={!selectedAccount || loadingGroups}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">{loadingGroups ? 'Loading groups…' : 'Select group…'}</option>
                        {groups.map((g) => (
                          <option key={g.chatId} value={g.chatId}>
                            {g.chatTitle}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleAddWatcher}
                        disabled={!selectedChatId || addingWatcher}
                        className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                      >
                        {addingWatcher ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add
                      </button>
                    </div>

                    <div className="space-y-2">
                      {watchers.length === 0 ? (
                        <p className="text-sm text-slate-500 py-4 text-center">No watched groups yet.</p>
                      ) : (
                        watchers.map((w) => (
                          <div
                            key={w.id}
                            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">{w.chatTitle || w.chatId}</div>
                              <div className="text-xs text-slate-400">{accountLabel(w.accountId)}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span
                                className={`flex items-center gap-1 text-xs ${
                                  w.listenerRunning ? 'text-green-400' : 'text-slate-500'
                                }`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${w.listenerRunning ? 'bg-green-400' : 'bg-slate-600'}`}
                                />
                                {w.listenerRunning ? 'Listening' : 'Idle'}
                              </span>
                              <button
                                onClick={() => handleRemoveWatcher(w.id)}
                                className="text-slate-400 hover:text-red-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
