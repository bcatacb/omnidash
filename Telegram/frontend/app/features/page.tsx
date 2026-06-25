import type { Metadata } from 'next'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { MessageCircle, Send, Users, QrCode, Shield, BarChart3 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Features - Telegram Automation Platform',
  description: 'Explore Telegram Portal features: connect unlimited Telegram accounts, run messaging campaigns, scrape group members, and automate your Telegram marketing workflow.',
  keywords: ['Telegram features', 'Telegram automation features', 'QR code login', 'bulk messaging', 'group scraper', 'multi-account management'],
  openGraph: {
    title: 'Telegram Portal Features - Telegram Automation Platform',
    description: 'Explore Telegram Portal features: connect unlimited Telegram accounts, run messaging campaigns, scrape group members, and automate your Telegram marketing workflow.',
    images: ['/features-og.png'],
  },
}

const FEATURES = [
  {
    title: 'Connect Telegram Accounts',
    description: 'Connect unlimited Telegram accounts via QR code scan or upload session files. Manage all accounts from one dashboard.',
    icon: QrCode,
  },
  {
    title: 'Messages & Conversations',
    description: 'View and manage conversations across all connected Telegram accounts. Filter by folders, search messages, and track interactions.',
    icon: MessageCircle,
  },
  {
    title: 'Messaging Campaigns',
    description: 'Send bulk messages to targeted users from CSV or scraped group members. Set daily limits and message intervals.',
    icon: Send,
  },
  {
    title: 'Group Scraper',
    description: 'Scrape members from Telegram groups and automatically invite them to your target groups. Track progress in real-time.',
    icon: Users,
  },
  {
    title: 'Multi-Account Management',
    description: 'Run campaigns across multiple Telegram accounts simultaneously. Monitor account health and reconnect sessions when needed.',
    icon: BarChart3,
  },
  {
    title: 'Session Security',
    description: 'Secure session file storage with health monitoring. Get notified when accounts need reconnection.',
    icon: Shield,
  },
]

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />

      {/* Header */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">Powerful Features</h1>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            Everything you need to scale your Telegram marketing and communication
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {FEATURES.map((feature, i) => (
              <div
                key={i}
                className="p-6 sm:p-8 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-900 transition"
              >
                <div className="w-10 sm:w-12 h-10 sm:h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-3 sm:mb-4">
                  <feature.icon className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">{feature.title}</h3>
                <p className="text-sm sm:text-base text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Ready to get started?</h2>
          <Link href="/signup">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-sm sm:text-base">
              Start Free Trial
            </Button>
          </Link>
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
