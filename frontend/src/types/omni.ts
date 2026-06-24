// Shared OmniBox types — foundation for progressive unification
// These will be used by the dashboard shell and the future unified inbox view.
//
// Backed by a single unified database (see ../../db/unified/schema.sql).
// One operator user owns platform_accounts across Telegram/Discord/TikTok.
//
// The cross-platform bridging logic is "transformers" (with platform adapters inside).
// Telegram (API), Discord & TikTok (Playwright/hybrid) keep their execution models.

export type Platform = 'telegram' | 'discord' | 'tiktok' | 'instagram' | 'snapchat' | 'facebook'

export const PLATFORM_LABEL: Record<Platform, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  snapchat: 'Snapchat',
  facebook: 'Facebook',
}

export const PLATFORM_COLOR: Record<Platform, string> = {
  telegram: '#229ED9',
  discord: '#5865F2',
  tiktok: '#FE2C55',
  instagram: '#E1306C',
  snapchat: '#FFFC00',
  facebook: '#1877F2',
}

export interface OmniAccount {
  id: string
  platform: Platform
  label: string
  username: string
  avatarUrl?: string | null
  status: 'connected' | 'connecting' | 'disconnected' | 'error' | string
}

export interface OmniConversation {
  id: string // e.g. `${platform}:${accountId}:${peerId}`
  platform: Platform
  accountId: string
  peer: {
    id: string
    displayName: string
    avatarUrl?: string | null
    username?: string | null
  }
  lastMessagePreview: string | null
  lastMessageAt: string | null
  lastMessageDirection: 'in' | 'out' | null
  unreadCount: number
  archived: boolean
  // Platform-specific details live here
  meta?: Record<string, unknown>
}

export interface OmniMessage {
  id: string
  conversationId: string
  platform: Platform
  direction: 'in' | 'out'
  body: string | null
  media?: {
    type: 'image' | 'video' | 'voice' | 'file'
    url: string
    name?: string
  }
  sentAt: string
  author?: { name: string; avatarUrl?: string | null }
}

// Note: The PlatformTransformer contract lives in ../adapters/platform-adapter.ts
// (See agreed model: transformers can be rich intra-API implementations; adapters exist into them.)
