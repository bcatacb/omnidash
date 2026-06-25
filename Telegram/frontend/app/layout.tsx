import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from '@/lib/auth-context'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: 'Telegram Portal - The Telegram CRM Your Team Is Missing',
    template: '%s | Telegram Portal',
  },
  description: 'Connect your personal Telegram account and turn every chat into a structured workflow — analytics, broadcasts and tickets built for the way your team actually works.',
  generator: 'v0.app',
  keywords: ['Telegram CRM', 'Telegram automation', 'Telegram marketing', 'Telegram bulk messaging', 'Telegram group scraper', 'Telegram campaign management', 'multi-account Telegram', 'Telegram workflow'],
  authors: [{ name: 'Telegram Portal Team' }],
  creator: 'Telegram Portal',
  publisher: 'Telegram Portal',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://telegramportal.com'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Telegram Portal - The Telegram CRM Your Team Is Missing',
    description: 'Connect your personal Telegram account and turn every chat into a structured workflow — analytics, broadcasts and tickets built for the way your team actually works.',
    url: 'https://telegramportal.com',
    siteName: 'Telegram Portal',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Telegram Portal - Telegram CRM Dashboard',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Telegram Portal - The Telegram CRM Your Team Is Missing',
    description: 'Connect your personal Telegram account and turn every chat into a structured workflow — analytics, broadcasts and tickets built for the way your team actually works.',
    images: ['/og-image.png'],
    creator: '@telegramportal',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  verification: {
    google: 'your-google-verification-code',
    yandex: 'your-yandex-verification-code',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-slate-950 text-white">
        <AuthProvider>
          {children}
          <Toaster richColors position="top-right" />
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </AuthProvider>
      </body>
    </html>
  )
}
