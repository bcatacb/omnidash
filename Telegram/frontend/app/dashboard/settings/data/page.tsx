'use client'

import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function DataSettingsPage() {
  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Data Management</h2>
        <p className="text-gray-400 mb-6 sm:mb-8 text-sm sm:text-base">Manage your data privacy and export options</p>

        <div className="space-y-6">
          {/* Export Data */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8">
            <h3 className="text-lg font-semibold mb-4">Export Your Data</h3>
            <p className="text-gray-400 text-sm mb-4 sm:mb-6">
              Download a copy of your data in JSON format. This includes all your settings,
              connected accounts, and activity logs.
            </p>
            <Button className="bg-blue-600 hover:bg-blue-700">
              Export Data
            </Button>
          </div>

          {/* Data Retention */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-8">
            <h3 className="text-lg font-semibold mb-4">Data Retention Policy</h3>
            <p className="text-gray-400 text-sm mb-4">
              We retain your data according to our privacy policy. You can request deletion of your
              account and all associated data at any time.
            </p>
            <Button variant="outline" className="border-slate-600 hover:bg-slate-800">
              Request Data Deletion
            </Button>
          </div>

          {/* Danger Zone */}
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 sm:p-8">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Delete all your data permanently. This action cannot be undone.
                </p>
                <Button variant="destructive">
                  Delete All Data
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
