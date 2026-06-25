import type { Metadata } from 'next'
import FAQClient from './FAQClient'

export const metadata: Metadata = {
  title: 'FAQ - Frequently Asked Questions',
  description: 'Find answers to common questions about Telegram Portal - Telegram automation, bulk messaging, group scraping, and account management.',
  keywords: ['Telegram FAQ', 'Telegram Portal help', 'Telegram automation FAQ', 'how to use Telegram Portal', 'Telegram CRM support'],
  openGraph: {
    title: 'Telegram Portal FAQ - Frequently Asked Questions',
    description: 'Find answers to common questions about Telegram Portal - Telegram automation, bulk messaging, and account management.',
    images: ['/faq-og.png'],
  },
}

export default function FAQPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is Telegram Portal?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Telegram Portal is a Telegram automation platform that lets you connect multiple Telegram accounts, run messaging campaigns, and scrape group members for your marketing and communication needs.',
        },
      },
      {
        '@type': 'Question',
        name: 'How do I connect my Telegram account?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'You can connect using QR code (scan with your Telegram app) or upload an existing session file. Both methods are secure and your session stays with you.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I connect multiple Telegram accounts?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, you can connect unlimited Telegram accounts and manage them all from one dashboard. Each account runs independently.',
        },
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FAQClient />
    </>
  )
}
