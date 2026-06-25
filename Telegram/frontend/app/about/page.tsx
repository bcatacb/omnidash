import type { Metadata } from 'next'
import { Navigation } from '@/components/navigation'
import { MessageCircle, Send, Users, QrCode } from 'lucide-react'

export const metadata: Metadata = {
  title: 'About Us - Telegram Automation Platform',
  description: 'Learn about Telegram Portal - the ultimate Telegram automation platform built for marketers and teams. Our mission is to simplify Telegram account management and marketing campaigns.',
  keywords: ['about Telegram Portal', 'Telegram automation company', 'Telegram marketing platform', 'who we are'],
  openGraph: {
    title: 'About Telegram Portal - Telegram Automation Platform',
    description: 'Learn about Telegram Portal - the ultimate Telegram automation platform built for marketers and teams.',
    images: ['/about-og.png'],
  },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />

      {/* Header */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">About Telegram Portal</h1>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            The ultimate Telegram automation platform for marketers and teams
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Our Mission</h2>
          <p className="text-gray-400 text-base sm:text-lg mb-3 sm:mb-4">
            Telegram Portal was built to solve a common problem: managing multiple Telegram accounts
            and running marketing campaigns across them is painful and time-consuming.
          </p>
          <p className="text-gray-400 text-base sm:text-lg">
            Our mission is to provide a powerful, easy-to-use platform that lets you connect unlimited
            Telegram accounts, automate messaging campaigns, and grow your communities — all from one dashboard.
          </p>
        </div>
      </section>

      {/* What We Offer */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-2xl sm:text-3xl font-bold mb-8 sm:mb-12 text-center">What We Offer</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
            {[
              {
                icon: QrCode,
                title: 'Easy Connection',
                description: 'Connect accounts via QR code or session files in seconds.',
              },
              {
                icon: MessageCircle,
                title: 'Unified Inbox',
                description: 'View and manage conversations across all accounts.',
              },
              {
                icon: Send,
                title: 'Smart Campaigns',
                description: 'Run messaging campaigns with daily limits and intervals.',
              },
              {
                icon: Users,
                title: 'Group Growth',
                description: 'Scrape group members and invite them to your communities.',
              },
            ].map((item, i) => (
              <div key={i} className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 text-center">
                <div className="w-10 sm:w-12 h-10 sm:h-12 rounded-lg bg-blue-600 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                  <item.icon className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-semibold mb-1 sm:mb-2">{item.title}</h3>
                <p className="text-gray-400 text-xs sm:text-sm">{item.description}</p>
              </div>
            ))}
          </div>
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
