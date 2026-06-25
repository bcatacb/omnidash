'use client'

import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { useState } from 'react'

export default function NotificationsSettingsPage() {
  const { user, updateNotificationSettings } = useAuth()
  const defaultSettings = {
    newMessages: true,
    notificationSound: true,
    desktopNotifications: false,
  }
  const [settings, setSettings] = useState(user?.notificationSettings ?? defaultSettings)

  const handleToggle = (key: keyof typeof settings) => {
    const newSettings = {
      ...settings,
      [key]: !settings[key],
    }
    setSettings(newSettings)
    updateNotificationSettings(newSettings)
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">In-App Notifications</h2>
        <p className="text-gray-400 mb-6 sm:mb-8 text-sm sm:text-base">
          Configure toast notifications and sounds when the app is open
        </p>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* New Message Notifications */}
          <div className="flex items-center justify-between py-4 border-b border-slate-800">
            <div>
                <h3 className="font-medium text-sm sm:text-base">New Message Notifications</h3>
                <p className="text-xs sm:text-sm text-gray-400">
                  Show toast notifications when new messages arrive
              </p>
            </div>
            <Toggle
              pressed={settings.newMessages}
              onPressedChange={() => handleToggle('newMessages')}
            />
          </div>

          {/* Notification Sound */}
          <div className="flex items-center justify-between py-3 sm:py-4 border-b border-slate-800">
            <div>
              <h3 className="font-medium text-sm sm:text-base">Notification Sound</h3>
              <p className="text-xs sm:text-sm text-gray-400">
                Play a sound when new messages arrive (works independently from toast
                notifications)
              </p>
            </div>
            <Toggle
              pressed={settings.notificationSound}
              onPressedChange={() => handleToggle('notificationSound')}
            />
          </div>

          {/* Desktop Notifications */}
          <div className="flex items-center justify-between py-3 sm:py-4">
            <div>
              <h3 className="font-medium text-sm sm:text-base">Desktop Notifications</h3>
              <p className="text-xs sm:text-sm text-gray-400">
                Show desktop notifications even when the app is minimized
              </p>
            </div>
            <Toggle
              pressed={settings.desktopNotifications}
              onPressedChange={() => handleToggle('desktopNotifications')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
