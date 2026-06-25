"use client"

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Navigation } from '@/components/navigation'

const FAQS = [
  {
    category: 'Getting Started',
    items: [
      {
        q: 'What is Telegram Portal?',
        a: 'Telegram Portal is a Telegram automation platform that lets you connect multiple Telegram accounts, run messaging campaigns, and scrape group members for your marketing and communication needs.',
      },
      {
        q: 'How do I connect my Telegram account?',
        a: 'You can connect using QR code (scan with your Telegram app) or upload an existing session file. Both methods are secure and your session stays with you.',
      },
      {
        q: 'Is my data secure?',
        a: 'Yes, your session files are stored securely on your server. We never share your Telegram credentials with third parties.',
      },
    ],
  },
  {
    category: 'Features',
    items: [
      {
        q: 'Can I connect multiple Telegram accounts?',
        a: 'Yes, you can connect unlimited Telegram accounts and manage them all from one dashboard. Each account runs independently.',
      },
      {
        q: 'How do Messaging Campaigns work?',
        a: 'Upload a CSV of target users or scrape them from groups, then send automated messages with daily limits and intervals to avoid Telegram restrictions.',
      },
      {
        q: 'What is Group Scraper?',
        a: 'Group Scraper lets you extract member lists from any Telegram group, then automatically invite them to your target group using your connected accounts.',
      },
    ],
  },
  {
    category: 'Account Management',
    items: [
      {
        q: 'Can I see all my conversations?',
        a: 'Yes, you can view conversations from all connected accounts, filter by folders, and search through messages in one unified inbox.',
      },
      {
        q: 'What if my account gets disconnected?',
        a: 'We monitor session health and will notify you when an account needs reconnection. You can easily reconnect via QR code or session file.',
      },
      {
        q: 'Can I exclude certain chats?',
        a: 'Yes, you can toggle "exclude chats" on any account to prevent certain conversations from appearing in your dashboard.',
      },
    ],
  },
]

export default function FAQClient() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const toggleItem = (id: string) => {
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedItems(newExpanded)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />

      {/* Header */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            Find answers to common questions about Telegram Portal
          </p>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {FAQS.map((section, sectionIdx) => (
            <div key={sectionIdx} className="mb-8 sm:mb-12">
              <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{section.category}</h2>
              <div className="space-y-3">
                {section.items.map((item, itemIdx) => {
                  const id = `${sectionIdx}-${itemIdx}`
                  const isExpanded = expandedItems.has(id)

                  return (
                    <div
                      key={id}
                      className="border border-slate-800 rounded-lg hover:border-slate-700 transition"
                    >
                      <button
                        onClick={() => toggleItem(id)}
                        className="w-full p-4 sm:p-6 flex items-center justify-between text-left"
                      >
                        <h3 className="font-semibold text-sm sm:text-base">{item.q}</h3>
                        <ChevronDown
                          className={`w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {isExpanded && (
                        <div className="px-4 sm:px-6 pb-4 sm:pb-6 text-gray-400 border-t border-slate-800 text-sm sm:text-base">
                          {item.a}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl text-center text-xs sm:text-sm text-gray-500">
          <p>&copy; 2024 Telegram Portal. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
