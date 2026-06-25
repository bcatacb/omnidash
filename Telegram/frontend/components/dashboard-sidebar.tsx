'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Lock, Building2, MessageSquare, Megaphone, Users, Flame, ArrowLeftRight, Bell, FolderPlus, Bookmark, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SIDEBAR_ITEMS = [
  {
    section: 'Automation',
    items: [
      {
        label: 'Accounts',
        href: '/dashboard/settings/accounts',
        icon: Lock,
      },
      {
        label: 'Unibox',
        href: '/dashboard/unibox',
        icon: MessageSquare,
      },
      {
        label: 'Messaging Campaign',
        href: '/dashboard/campaign',
        icon: Megaphone,
      },
      {
        label: 'Group Inviter',
        href: '/dashboard/settings/workspace',
        icon: Building2,
      },
      {
        label: 'Scrape User',
        href: '/dashboard/scrape-group',
        icon: Users,
      },
      {
        label: 'Warm Up',
        href: '/dashboard/warm-up',
        icon: Flame,
      },
      {
        label: 'Import',
        href: '/dashboard/import',
        icon: ArrowLeftRight,
      },
      {
        label: 'Mass Group Creation',
        href: '/dashboard/mass-group-creation',
        icon: FolderPlus,
      },
      {
        label: 'Stored Messages',
        href: '/dashboard/stored-messages',
        icon: Bookmark,
      },
      {
        label: 'Notification Center',
        href: '/dashboard/notification-center',
        icon: Bell,
      },
    ],
  },
]

export function DashboardSidebar({ mobileOpen = false, onClose = () => {} }) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-50 h-full w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col
        transform transition-transform duration-200 ease-in-out
        lg:relative lg:transform-none lg:z-auto
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2 font-bold">
              <img src="/logo.png" alt="Telegram Portal" className="h-12 w-auto" />
              <span>Telegram Portal</span>
            </Link>
            <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {SIDEBAR_ITEMS.map((section) => (
            <div key={section.section}>
              <h3 className="text-xs font-semibold uppercase text-gray-500 px-2 py-3">
                {section.section}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
