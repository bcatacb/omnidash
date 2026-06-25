'use client'

import { Clock } from 'lucide-react'

const MOCK_ACTIVITIES = [
  {
    id: '1',
    action: 'Logged in',
    timestamp: '2024-04-25 10:30 AM',
    ip: '192.168.1.100',
    device: 'Chrome on MacOS',
  },
  {
    id: '2',
    action: 'Updated profile',
    timestamp: '2024-04-25 9:15 AM',
    ip: '192.168.1.100',
    device: 'Chrome on MacOS',
  },
  {
    id: '3',
    action: 'Connected Telegram account',
    timestamp: '2024-04-24 3:45 PM',
    ip: '192.168.1.100',
    device: 'Chrome on MacOS',
  },
  {
    id: '4',
    action: 'Changed notification settings',
    timestamp: '2024-04-24 2:20 PM',
    ip: '192.168.1.100',
    device: 'Chrome on MacOS',
  },
  {
    id: '5',
    action: 'Logged in',
    timestamp: '2024-04-23 8:00 AM',
    ip: '192.168.1.101',
    device: 'Safari on iPhone',
  },
]

export default function ActivityLogPage() {
  return (
    <div className="p-8">
      <div className="max-w-3xl">
        <h2 className="text-3xl font-bold mb-2">Activity Log</h2>
        <p className="text-gray-400 mb-8">
          Track all account activity including logins, settings changes, and integrations
        </p>

        <div className="space-y-3">
          {MOCK_ACTIVITIES.map((activity) => (
            <div
              key={activity.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:bg-slate-800 transition"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{activity.action}</p>
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-400">
                    <span>{activity.timestamp}</span>
                    <span className="text-gray-600">•</span>
                    <span>IP: {activity.ip}</span>
                    <span className="text-gray-600">•</span>
                    <span>{activity.device}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Load More */}
        <div className="text-center mt-8">
          <button className="text-blue-400 hover:text-blue-300 transition text-sm">
            Load more activity
          </button>
        </div>
      </div>
    </div>
  )
}
