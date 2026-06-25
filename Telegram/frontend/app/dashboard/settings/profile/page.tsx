'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ProfileSettingsPage() {
  const { user, updateProfile } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
    updateProfile({ name })
    setIsSaving(false)
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Your Profile</h2>
        <p className="text-gray-400 mb-6 sm:mb-8 text-sm sm:text-base">Manage your account information</p>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Avatar */}
          <div>
            <label className="block text-sm font-medium mb-4">Profile Picture</label>
            <div className="flex items-center gap-6">
              {user?.avatar && (
                <img
                  src={user.avatar}
                  alt="Avatar"
                  className="w-16 h-16 rounded-lg border border-slate-700"
                />
              )}
              <Button variant="outline" className="border-slate-600 hover:bg-slate-800">
                Change Avatar
              </Button>
            </div>
          </div>

          {/* Email (Read-only) */}
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <div className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-gray-400">
              {user?.email}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2">Full Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder-gray-500"
            />
          </div>

          {/* Save Button */}
          <div className="flex gap-4 pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
