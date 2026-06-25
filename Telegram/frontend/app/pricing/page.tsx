import type { Metadata } from 'next'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Check } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Pricing - Simple, Transparent Plans',
  description: 'Choose the perfect Telegram Portal plan for your needs. From individual users to enterprise teams - scalable pricing for Telegram automation, bulk messaging, and group scraping.',
  keywords: ['Telegram pricing', 'Telegram automation cost', 'bulk messaging pricing', 'Telegram CRM pricing', 'marketing automation plans'],
  openGraph: {
    title: 'Telegram Portal Pricing - Simple, Transparent Plans',
    description: 'Choose the perfect Telegram Portal plan for your needs. From individual users to enterprise teams - scalable pricing for Telegram automation.',
    images: ['/pricing-og.png'],
  },
}

const PRICING_PLANS = [
  {
    name: 'Starter',
    price: 29,
    description: 'Perfect for individuals and small projects',
    features: [
      'Connect up to 3 Telegram accounts',
      'QR code & session file connection',
      'Message campaigns (CSV targets)',
      'Basic conversation viewing',
      'Community support',
    ],
  },
  {
    name: 'Professional',
    price: 79,
    description: 'For growing teams and agencies',
    features: [
      'Unlimited Telegram accounts',
      'Group scraper campaigns',
      'Advanced messaging campaigns',
      'Multi-account management',
      'Session health monitoring',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For large organizations with custom needs',
    features: [
      'Everything in Professional',
      'Custom campaign workflows',
      'Dedicated account manager',
      'API access for integrations',
      'SLA guarantee',
      'On-premise deployment option',
    ],
  },
]

export default function PricingPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Telegram Portal Starter',
          description: 'Perfect for individuals and small projects',
        },
        price: '29',
        priceCurrency: 'USD',
      },
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Telegram Portal Professional',
          description: 'For growing teams and agencies',
        },
        price: '79',
        priceCurrency: 'USD',
      },
    ],
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navigation />

      {/* Header */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
            Scale your Telegram marketing with the right plan
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {PRICING_PLANS.map((plan, i) => (
              <div
                key={i}
                className={`rounded-lg border p-8 transition ${
                  plan.highlighted
                    ? 'border-blue-500 bg-slate-900 ring-2 ring-blue-500/20'
                    : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'
                }`}
              >
                {plan.highlighted && (
                  <div className="mb-4 inline-block px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-medium">
                    Most Popular
                  </div>
                )}
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <p className="text-gray-400 text-sm mb-6">{plan.description}</p>

                <div className="mb-8">
                  <span className="text-5xl font-bold">
                    {typeof plan.price === 'number' ? `$${plan.price}` : plan.price}
                  </span>
                  {typeof plan.price === 'number' && (
                    <span className="text-gray-400 ml-2">/month</span>
                  )}
                </div>

                <Button
                  className={`w-full mb-8 ${
                    plan.highlighted
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'border-slate-600 hover:bg-slate-800'
                  }`}
                  variant={plan.highlighted ? 'default' : 'outline'}
                  asChild
                >
                  <Link href="/signup">Get Started</Link>
                </Button>

                <ul className="space-y-3">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-green-500" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 sm:mb-12">Frequently Asked Questions</h2>
          <div className="space-y-4 sm:space-y-6">
            {[
              {
                q: 'Can I change plans anytime?',
                a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect at your next billing cycle.',
              },
              {
                q: 'Do you offer a free trial?',
                a: 'Yes, we offer a 14-day free trial with full access to all features.',
              },
              {
                q: 'What payment methods do you accept?',
                a: 'We accept all major credit cards, PayPal, and bank transfers for enterprise customers.',
              },
            ].map((item, i) => (
              <div key={i} className="border-b border-slate-800 pb-4 sm:pb-6 last:border-0">
                <h3 className="font-semibold mb-2 text-sm sm:text-base">{item.q}</h3>
                <p className="text-gray-400 text-xs sm:text-sm">{item.a}</p>
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
