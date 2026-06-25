'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, type UnreadNotification } from '@/lib/auth-context'
import { Bell } from 'lucide-react'

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function NotificationBell() {
  const { fetchUnreadSummary } = useAuth()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [data, setData] = useState<{ total_unread: number; items: UnreadNotification[] }>({
    total_unread: 0,
    items: [],
  })
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const dropdownRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const visibleItems = data.items.filter((item) => !dismissedIds.has(item.id))
  const visibleCount = visibleItems.length

  const load = useCallback(async () => {
    try {
      const result = await fetchUnreadSummary()
      setData(result)
    } catch {
      // silently fail — notifications are non-critical
    }
  }, [fetchUnreadSummary])

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 10000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNotificationClick = (accountId: string, chatId: string, notificationId: string) => {
    setDismissedIds((prev) => new Set(prev).add(notificationId))
    setIsOpen(false)
    router.push(`/dashboard/unibox?account_id=${encodeURIComponent(accountId)}&chat_id=${encodeURIComponent(chatId)}`)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-slate-800 transition text-gray-400 hover:text-white"
      >
        <Bell className="w-5 h-5" />
        {visibleCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1 text-[11px] font-bold text-white bg-red-500 rounded-full">
            {visibleCount > 99 ? '99+' : visibleCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-lg bg-slate-800 border border-slate-700 shadow-lg z-50 max-h-96 flex flex-col">
          <div className="p-3 border-b border-slate-700 shrink-0">
            <h3 className="text-sm font-medium text-white">
              Notifications{visibleCount > 0 ? ` (${visibleCount})` : ''}
            </h3>
          </div>

          <div className="overflow-y-auto flex-1">
            {visibleItems.length === 0 ? (
              <p className="text-sm text-gray-400 p-4 text-center">No new notifications</p>
            ) : (
              visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNotificationClick(item.accountId, item.chatId, item.id)}
                  className="flex flex-col items-start gap-0.5 w-full px-3 py-2.5 text-left hover:bg-slate-700 transition border-b border-slate-700/50 last:border-b-0"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-medium text-white truncate max-w-[180px]">
                      {item.chatTitle}
                    </span>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="text-xs text-gray-400 truncate flex-1">
                      {item.lastMessage}
                    </span>
                    {item.unreadCount > 1 && (
                      <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 shrink-0">
                        {item.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
