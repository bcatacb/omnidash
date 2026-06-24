import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'telegram' as const

// Telegram backend base (adjust via env for your setup)
const TELEGRAM_BASE = (import.meta as any).env?.VITE_TELEGRAM_API || 'http://localhost:8000'

// Note: For full auth, the Telegram backend uses Bearer tokens.
// For initial real wiring, you may need to either:
// - Run without strict auth in dev, or
// - Proxy / set a default token, or
// - Extend the adapter to handle login first.

// Telegram transformer (API-driven platform).
// 
// This is the platform adapter that lives *inside* the Telegram transformer.
// Its job:
// - Talk to the Telegram backend (Telethon)
// - Normalize data into the unified DB schema (see ../../db/unified/schema.sql)
// - Fulfill the PlatformTransformer contract for the unified inbox
//
// The actual writes to the unified DB can happen here (in real mode) or via
// the platform backend writing directly.

// --- Real Telegram Transformer Implementation ---
// This fulfills PlatformTransformer. It can grow into a full intraAPI client for Telegram.

function mapConversation(item: any): OmniConversation {
  // Backend gives composite id like "acc123::456", timestamp etc.
  const chatId = item.chatId || item.id?.split('::')[1] || item.id
  const accountId = item.accountId || item.id?.split('::')[0] || 'unknown'
  const unifiedId = item.id?.includes('::') ? item.id : `telegram:${accountId}:${chatId}`

  return {
    id: unifiedId,
    platform: PLATFORM,
    accountId,
    peer: {
      id: chatId,
      displayName: item.chatTitle || item.chatUsername || chatId,
      username: item.chatUsername || undefined,
      avatarUrl: null,
    },
    lastMessagePreview: item.lastMessage || item.draft || null,
    lastMessageAt: item.timestamp || null,
    lastMessageDirection: item.lastMessageOutgoing ? 'out' : (item.lastMessage ? 'in' : null),
    unreadCount: item.unreadCount || 0,
    archived: false, // Telegram backend doesn't surface archived the same way in convs list
    meta: { isGroup: item.isGroup, isChannel: item.isChannel, draft: item.draft },
  }
}

function mapMessage(item: any, convId: string): OmniMessage {
  return {
    id: String(item.id),
    conversationId: convId,
    platform: PLATFORM,
    direction: item.outgoing ? 'out' : 'in',
    body: item.text || null,
    sentAt: item.timestamp || new Date().toISOString(),
    author: item.senderName ? { name: item.senderName } : undefined,
  }
}

export const telegramAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    try {
      const res = await fetch(`${TELEGRAM_BASE}/api/v1/accounts`)
      if (!res.ok) throw new Error('backend not reachable')
      const data = await res.json()
      return (data || []).map((a: any): OmniAccount => ({
        id: a.id,
        platform: PLATFORM,
        label: a.label || a.id,
        username: a.username || '',
        avatarUrl: null,
        status: a.status || 'connected',
      }))
    } catch {
      // Fallback for when backend is not running
      return [{ id: 'tg-demo', platform: PLATFORM, label: 'Telegram (demo)', username: '@demo', avatarUrl: null, status: 'connected' as const }]
    }
  },

  async listConversations(opts) {
    try {
      const params = new URLSearchParams()
      params.set('limit', '200')
      const res = await fetch(`${TELEGRAM_BASE}/api/v1/messages/conversations?${params}`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      let items: any[] = data.conversations || []

      if (opts?.accountIds?.length) {
        items = items.filter((c: any) => opts.accountIds!.includes(c.accountId))
      }

      let mapped = items.map(mapConversation)

      if (opts?.archived !== undefined) {
        mapped = mapped.filter(c => c.archived === opts.archived)
      }

      return mapped
    } catch {
      // Demo fallback data
      return [
        { id: 'tg-demo-1', platform: PLATFORM, accountId: 'tg-demo', peer: { id: 'u1', displayName: 'Demo Contact' }, lastMessagePreview: 'Hello from Telegram backend', lastMessageAt: new Date().toISOString(), lastMessageDirection: 'in' as const, unreadCount: 1, archived: false },
      ]
    }
  },

  async getMessages(convId: string, opts) {
    try {
      // Parse account and chat from unified or backend id
      let accountId = ''
      let chatId = convId
      if (convId.includes('::')) {
        [accountId, chatId] = convId.split('::')
      } else if (convId.includes(':')) {
        const parts = convId.split(':')
        accountId = parts[1] || ''
        chatId = parts[2] || parts[1] || convId
      }

      const params = new URLSearchParams()
      params.set('account_id', accountId || '')
      params.set('chat_id', chatId)
      params.set('limit', String(opts?.limit ?? 100))

      const res = await fetch(`${TELEGRAM_BASE}/api/v1/messages/thread?${params}`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      const items: any[] = data.items || []
      return items.map(item => mapMessage(item, convId))
    } catch {
      return [{ id: 'tg-d1', conversationId: convId, platform: PLATFORM, direction: 'in' as const, body: 'Demo message from Telegram', sentAt: new Date().toISOString() }]
    }
  },

  async sendMessage(convId: string, body: string) {
    let accountId = ''
    let chatId = convId
    if (convId.includes('::')) {
      [accountId, chatId] = convId.split('::')
    } else if (convId.includes(':')) {
      const parts = convId.split(':')
      accountId = parts[1] || ''
      chatId = parts[2] || parts[1] || convId
    }

    try {
      const res = await fetch(`${TELEGRAM_BASE}/api/v1/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, chatId, text: body }),
      })
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      const item = data.item
      return mapMessage(item, convId)
    } catch {
      return {
        id: 'tg-sent-' + Date.now(),
        conversationId: convId,
        platform: PLATFORM,
        direction: 'out' as const,
        body,
        sentAt: new Date().toISOString(),
      }
    }
  },

  async markRead(convId: string) {
    // Best effort
    try {
      let accountId = ''
      let chatId = convId
      if (convId.includes('::')) [accountId, chatId] = convId.split('::')
      else if (convId.includes(':')) {
        const p = convId.split(':'); accountId = p[1]||''; chatId = p[2]||p[1]||convId
      }
      await fetch(`${TELEGRAM_BASE}/api/v1/messages/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, chatId }),
      })
    } catch {}
  },

  async archiveConversation(_convId: string, _archived: boolean) {
    // Telegram backend doesn't have direct archive in the same way for DMs.
    // We can no-op or use a local meta flag via the meta in conv.
    // For now, this is a no-op in real mode (or implement using folders if desired).
    console.warn('[telegramAdapter] archive not fully wired for real Telegram backend')
  },

  getCharacteristics() {
    return {
      transport: 'api' as const,
      supportsRealtime: true,
      typicalSendLatencyMs: 250,
    }
  },
}
