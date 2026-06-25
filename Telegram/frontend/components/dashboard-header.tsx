'use client'

import { useAuth } from '@/lib/auth-context'
import { Menu } from 'lucide-react'
import { ProfileDropdown } from './profile-dropdown'
import { NotificationBell } from './notification-bell'

export function DashboardHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth()

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center">
          {/* Mobile Menu Button */}
          <button
            onClick={onMenuClick}
            className="lg:hidden text-white p-2 -ml-2"
          >
            <Menu className="w-6 h-6" />
          </button>

          {/* Notification Bell + Profile Dropdown on far right */}
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </header>
  )
}
