'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'

const MOCK_API_KEYS = [
  {
    id: '1',
    name: 'Production Key',
    key: 'sk_prod_' + 'x'.repeat(32),
    createdAt: '2024-04-15',
  },
]

export default function DevelopersSettingsPage() {
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)
  const [keyName, setKeyName] = useState('')

  const handleCreateKey = () => {
    // Mock implementation
    setKeyName('')
    setShowNewKeyForm(false)
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Developers</h2>
        <p className="text-gray-400 mb-6 sm:mb-8 text-sm sm:text-base">Manage API keys and integrations</p>

        <div className="space-y-6">
          {/* API Keys Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="text-lg font-semibold">API Keys</h3>
              <Button
                onClick={() => setShowNewKeyForm(!showNewKeyForm)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Create New Key
              </Button>
            </div>

            {/* Create New Key Form */}
            {showNewKeyForm && (
              <div className="bg-slate-800 rounded-lg p-4 mb-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Key Name</label>
                  <Input
                    type="text"
                    placeholder="e.g., Production API Key"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="bg-slate-700 border-slate-600 text-white placeholder-gray-500"
                  />
                </div>
                <div className="flex gap-4">
                  <Button
                    onClick={handleCreateKey}
                    disabled={!keyName.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Create
                  </Button>
                  <Button
                    onClick={() => setShowNewKeyForm(false)}
                    variant="outline"
                    className="border-slate-600 hover:bg-slate-800"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* API Keys List */}
            <div className="space-y-3">
              {MOCK_API_KEYS.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 bg-slate-800 rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{key.name}</p>
                    <p className="text-sm text-gray-400">{key.key}</p>
                    <p className="text-xs text-gray-500 mt-1">Created {key.createdAt}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-400 hover:text-white"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Webhooks Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8">
            <h3 className="text-lg font-semibold mb-4">Webhooks</h3>
            <p className="text-gray-400 text-sm mb-4">
              Configure webhooks to receive real-time events from Telegram Portal
            </p>
            <Button variant="outline" className="border-slate-600 hover:bg-slate-800">
              Add Webhook
            </Button>
          </div>

          {/* Documentation */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-8">
            <h3 className="text-lg font-semibold text-blue-400 mb-2">API Documentation</h3>
            <p className="text-gray-400 text-sm">
              Check out our API documentation to learn how to integrate Telegram Portal into your
              application.
            </p>
            <Button variant="outline" className="border-blue-500 hover:bg-blue-500/10 mt-4">
              Read Docs
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
