'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import { Star } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export default function Home() {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      router.replace('/dashboard')
    }
  }, [user, router])
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Telegram Portal',
    description: 'Connect your personal Telegram account and turn every chat into a structured workflow — analytics, broadcasts and tickets built for the way your team actually works.',
    url: 'https://telegramportal.com',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '29',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      ratingCount: '100',
    },
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navigation />

      {/* Hero Section */}
      <section className="relative py-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 right-20 w-72 h-72 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
          <div className="absolute bottom-20 left-20 w-72 h-72 bg-slate-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
        </div>

        <div className="relative mx-auto max-w-7xl">
          <div className="text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span className="text-sm text-blue-400">Telegram CRM for Web3</span>
            </div>

            {/* Main Heading */}
            <h1 className="mt-6 text-5xl sm:text-6xl font-bold tracking-tight">
              The <span className="text-blue-500">Telegram CRM</span> your team is missing.
            </h1>

            {/* Subheading */}
            <p className="mt-6 text-xl text-gray-400 max-w-2xl mx-auto">
              Connect your personal Telegram account and turn every chat into a structured workflow — analytics, broadcasts and tickets built for the way your team actually works.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Try for Free →
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="border-slate-600 hover:bg-slate-800">
                Request Demo
              </Button>
            </div>

            {/* Trust indicator */}
            <p className="mt-6 text-sm text-gray-400 flex items-center justify-center gap-2">
              <span>✓</span>
              <span>Works with your personal Telegram account.</span>
            </p>

            {/* Social proof */}
            <div className="mt-12 flex items-center justify-center gap-6">
              <div className="flex -space-x-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center border-2 border-slate-950 text-white font-bold text-sm"
                  >
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
                <span className="text-sm text-gray-400 ml-4">+100</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex text-yellow-400">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-current" />
                  ))}
                </div>
                <span className="text-sm text-gray-400">4.9/5 Based on over +100 clients</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Preview Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 sm:mb-12">
            Powerful Features Built for Your Team
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { icon: '💬', title: 'Chat Management', desc: 'Organize conversations' },
              { icon: '📊', title: 'Analytics', desc: 'Real-time insights' },
              { icon: '📢', title: 'Broadcasts', desc: 'Mass messaging' },
              { icon: '🎫', title: 'Tickets', desc: 'Issue tracking' },
            ].map((feature, i) => (
              <div
                key={i}
                className="p-4 sm:p-6 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-900 transition"
              >
                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">{feature.icon}</div>
                <h3 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">{feature.title}</h3>
                <p className="text-xs sm:text-sm text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Ready to streamline your Telegram workflow?</h2>
          <p className="text-sm sm:text-base text-gray-400 mb-6 sm:mb-8">Join hundreds of teams using Telegram Portal to manage their Telegram chats.</p>
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
