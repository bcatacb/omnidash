'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AuthGuard } from '@/components/auth-guard'
import { Button } from '@/components/ui/button'
import {
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react'

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1'

interface ImportContact {
  user_id: string
  username: string
  full_name: string
  phone: string
  status: 'imported' | 'skipped' | 'error'
  reason?: string
}

interface ImportComplete {
  imported: number
  skipped: number
  total: number
  imported_contacts: ImportContact[]
  skipped_contacts: ImportContact[]
}

function ImportContent() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [sourceAccountId, setSourceAccountId] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [result, setResult] = useState<ImportComplete | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const accounts = useMemo(() => user?.connectedAccounts || [], [user])

  const filteredTargetAccounts = useMemo(
    () => accounts.filter((a) => a.id !== sourceAccountId),
    [accounts, sourceAccountId],
  )

  const selectedSourceLabel = useMemo(
    () => accounts.find((a) => a.id === sourceAccountId),
    [accounts, sourceAccountId],
  )

  const accountLabel = (a: { id: string; displayName?: string; username?: string }) =>
    a.displayName || a.username || a.id.slice(0, 8)

  const handleImport = useCallback(async () => {
    if (!sourceAccountId || !targetAccountId) {
      setError('Select both a source and target account')
      return
    }
    if (sourceAccountId === targetAccountId) {
      setError('Source and target accounts must be different')
      return
    }

    setError('')
    setResult(null)
    setProgress(null)
    setImporting(true)

    const token = localStorage.getItem('sessionToken') || ''
    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const response = await fetch(`${API_BASE_URL}/contacts/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          source_account_id: sourceAccountId,
          target_account_id: targetAccountId,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || 'Import request failed')
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          const match = part.match(/^data: (.+)$/m)
          if (!match) continue
          let data: any
          try {
            data = JSON.parse(match[1])
          } catch {
            // skip malformed events
            continue
          }
          switch (data.type) {
            case 'progress':
              setProgress({ current: data.current, total: data.total })
              break
            case 'complete':
              setResult(data)
              setProgress({ current: data.total, total: data.total })
              break
            case 'error':
              throw new Error(data.message)
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      abortRef.current = null
    }
  }, [sourceAccountId, targetAccountId])

  const allContacts = useMemo(() => {
    if (!result) return []
    return [
      ...(result.imported_contacts || []),
      ...(result.skipped_contacts || []),
    ]
  }, [result])

  return (
    <>
      <DashboardSidebar
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-h-0">
        <DashboardHeader onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="w-6 h-6 text-blue-400" />
              <h1 className="text-2xl font-bold">Import Contacts</h1>
            </div>

            <p className="text-gray-400 text-sm">
              Copy all contacts from one Telegram account to another.
            </p>

            {error && (
              <div className="flex items-center gap-2 text-red-400 bg-red-900/20 border border-red-800 rounded-md px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                  Source Account
                </h2>
                <p className="text-xs text-gray-500">
                  Account whose contacts will be copied
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {accounts.map((a) => (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition text-sm ${
                        sourceAccountId === a.id
                          ? 'border-blue-500 bg-blue-900/20 text-white'
                          : 'border-slate-700 bg-slate-800/50 text-gray-300 hover:border-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sourceAccount"
                        value={a.id}
                        checked={sourceAccountId === a.id}
                        onChange={(e) => {
                          setSourceAccountId(e.target.value)
                          if (targetAccountId === e.target.value) {
                            setTargetAccountId('')
                          }
                        }}
                        className="accent-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {accountLabel(a)}
                        </div>
                        {a.username && (
                          <div className="text-xs text-gray-500 truncate">
                            @{a.username}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                  {accounts.length === 0 && (
                    <p className="text-gray-500 text-sm">No accounts found</p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                  Target Account
                </h2>
                <p className="text-xs text-gray-500">
                  Account that will receive the contacts
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {filteredTargetAccounts.map((a) => (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition text-sm ${
                        targetAccountId === a.id
                          ? 'border-blue-500 bg-blue-900/20 text-white'
                          : 'border-slate-700 bg-slate-800/50 text-gray-300 hover:border-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="targetAccount"
                        value={a.id}
                        checked={targetAccountId === a.id}
                        onChange={(e) => setTargetAccountId(e.target.value)}
                        className="accent-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {accountLabel(a)}
                        </div>
                        {a.username && (
                          <div className="text-xs text-gray-500 truncate">
                            @{a.username}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                  {filteredTargetAccounts.length === 0 && (
                    <p className="text-gray-500 text-sm">
                      {sourceAccountId
                        ? 'No other accounts available'
                        : 'Select a source account first'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                onClick={handleImport}
                disabled={!sourceAccountId || !targetAccountId || importing}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                {importing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowLeftRight className="w-4 h-4" />
                )}
                {importing ? 'Importing...' : 'Import Contacts'}
              </Button>
            </div>

            {progress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-400">
                  <span>
                    Importing contacts... {progress.current} of {progress.total}
                  </span>
                  <span>
                    {progress.total > 0
                      ? Math.round((progress.current / progress.total) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                    style={{
                      width:
                        progress.total > 0
                          ? `${(progress.current / progress.total) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-400">
                    <CheckCircle2 className="w-4 h-4 inline mr-1" />
                    {result.imported} imported
                  </span>
                  {result.skipped > 0 && (
                    <span className="text-yellow-400">
                      <AlertCircle className="w-4 h-4 inline mr-1" />
                      {result.skipped} skipped
                    </span>
                  )}
                  <span className="text-gray-400">{result.total} total</span>
                </div>

                {allContacts.length > 0 && (
                  <div className="border border-slate-700 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-800 text-gray-400 text-left">
                            <th className="px-4 py-3 font-medium">Username</th>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Phone</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                          {allContacts.map((c) => (
                            <tr key={c.user_id} className="hover:bg-slate-800/50">
                              <td className="px-4 py-2.5 text-gray-300">
                                {c.username ? `@${c.username}` : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-gray-300">
                                {c.full_name}
                              </td>
                              <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                                {c.phone || '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                {c.status === 'imported' ? (
                                  <span className="flex items-center gap-1 text-green-400 text-xs">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Imported
                                  </span>
                                ) : (
                                  <span
                                    className="flex items-center gap-1 text-xs"
                                    title={c.reason}
                                  >
                                    {c.status === 'error' ? (
                                      <>
                                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                                        <span className="text-red-400">
                                          Error
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
                                        <span className="text-yellow-400">
                                          Skipped
                                        </span>
                                      </>
                                    )}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default function ImportPage() {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-slate-950 text-white">
        <ImportContent />
      </div>
    </AuthGuard>
  )
}
