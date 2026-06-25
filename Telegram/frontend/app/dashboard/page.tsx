'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { Settings } from 'lucide-react'

function DashboardContent() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const accounts = user?.connectedAccounts ?? []
  const healthyCount = accounts.filter((a) => a.sessionStatus === 'good').length
  const bannedCount = accounts.filter((a) => a.sessionStatus === 'banned').length
  const disconnectedCount = accounts.filter((a) => a.sessionStatus === 'disconnected').length
  const frozenCount = accounts.filter((a) => a.sessionStatus === 'frozen').length

  const breakdownParts = [`${accounts.length} total`]
  if (bannedCount) breakdownParts.push(`${bannedCount} banned`)
  if (disconnectedCount) breakdownParts.push(`${disconnectedCount} disconnected`)
  if (frozenCount) breakdownParts.push(`${frozenCount} frozen`)

  return (
    <div className="flex h-screen bg-slate-950 text-white">
      <DashboardSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Dashboard Header with Profile Dropdown */}
        <DashboardHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-8">
          <div className="space-y-8">
            {/* Welcome Section */}
            <div>
              <h2 className="text-3xl font-bold mb-2">Welcome back, {user?.name}!</h2>
              <p className="text-gray-400">
                Manage your Telegram accounts and monitor conversations across all accounts.
              </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Connected Accounts</h3>
                <p className="text-3xl font-bold">{healthyCount}</p>
                <p className="text-xs text-gray-500 mt-1">{breakdownParts.join(' · ')}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Workspace Status</h3>
                <p className="text-3xl font-bold">Active</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Last Active</h3>
                <p className="text-3xl font-bold">Now</p>
              </div>
            </div>

            {/* Connected Accounts Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Connected Telegram Accounts</h3>
                <Link href="/dashboard/settings/accounts">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                    Manage Accounts
                  </Button>
                </Link>
              </div>

              {user && user.connectedAccounts.length > 0 ? (
                <div className="space-y-4">
                  {user.connectedAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-4 bg-slate-800 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{account.displayName || account.username}</p>
                        <p className="text-sm text-gray-400">ID: {account.telegramId}</p>
                      </div>
                      <div
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                          account.status === 'online'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {account.status}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8">
                  No connected accounts yet.{' '}
                  <Link
                    href="/dashboard/settings/accounts"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Connect your first account
                  </Link>
                </p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-6">Quick Actions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link href="/dashboard/settings/accounts">
                  <Button
                    variant="outline"
                    className="w-full justify-start border-slate-700 hover:bg-slate-800"
                  >
                    Add Telegram Account
                  </Button>
                </Link>
                <Link href="/dashboard/unibox">
                  <Button
                    variant="outline"
                    className="w-full justify-start border-slate-700 hover:bg-slate-800"
                  >
                    View Unibox
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  )
}
