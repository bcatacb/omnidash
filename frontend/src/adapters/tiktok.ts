import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'tiktok' as const

const TIKTOK_BASE = (import.meta as any).env?.VITE_TIKTOK_API || 'http://localhost:3000'

// TikTok transformer (Playwright-driven).
// 
// Platform adapter inside the transformer.
// Feeds normalized data to the unified DB (see ../../db/unified/schema.sql).
// Execution stays pure Playwright.

function mapTikTokConversation(item: any): OmniConversation {
  return {
    id: item.id || `tiktok:${item.account_id}:${item.peer_username}`,
    platform: PLATFORM,
    accountId: item.account_id || 'tt-acc-1',
    peer: {
      id: item.peer_username || 'unknown',
      displayName: item.peer_display_name || item.peer_username || 'Contact',
      username: item.peer_username,
      avatarUrl: null,
    },
    lastMessagePreview: item.last_message_text || null,
    lastMessageAt: item.last_message_at ? new Date(item.last_message_at).toISOString() : null,
    lastMessageDirection: item.last_message_direction === 'inbound' ? 'in' : item.last_message_direction === 'outbound' ? 'out' : null,
    unreadCount: item.unread_count || 0,
    archived: !!item.archived,
    meta: { status: item.status, pipeline: item.pipeline_stage_id },
  }
}

function mapTikTokMessage(item: any, convId: string): OmniMessage {
  return {
    id: item.id || item.tiktokMsgId || 'tt-msg-' + Date.now(),
    conversationId: convId,
    platform: PLATFORM,
    direction: item.direction === 'inbound' || item.direction === 'in' ? 'in' : 'out',
    body: item.body || item.text || null,
    sentAt: item.sent_at ? new Date(item.sent_at).toISOString() : item.sentAt || new Date().toISOString(),
    author: item.sender ? { name: item.sender } : undefined,
  }
}

export const tiktokAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    try {
      const res = await fetch(`${TIKTOK_BASE}/api/accounts`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      return (data || []).map((a: any): OmniAccount => ({
        id: a.id,
        platform: PLATFORM,
        label: a.label || a.username || 'TikTok Account',
        username: a.username || '',
        avatarUrl: a.avatar || null,
        status: a.status || 'connected',
      }))
    } catch {
      return [{ id: 'tt-demo', platform: PLATFORM, label: 'TikTok (demo)', username: '@demo', avatarUrl: null, status: 'connected' as const }]
    }
  },

  async listConversations(opts?: any) {
    try {
      const res = await fetch(`${TIKTOK_BASE}/api/conversations`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      let items: any[] = (data || []).map(mapTikTokConversation)

      if (opts?.accountIds?.length) {
        items = items.filter((c: any) => opts.accountIds!.includes(c.accountId))
      }
      if (opts?.archived !== undefined) {
        items = items.filter((c: any) => c.archived === opts.archived)
      }
      return items
    } catch {
      return [
        { id: 'tt-demo-1', platform: PLATFORM, accountId: 'tt-demo', peer: { id: 'u4', displayName: 'Demo TikTok' }, lastMessagePreview: 'Demo message', lastMessageAt: new Date().toISOString(), lastMessageDirection: 'in' as const, unreadCount: 2, archived: false },
      ]
    }
  },

  async getMessages(convId: string, _opts?: any) {
    try {
      const id = convId.includes(':') ? convId.split(':').pop()! : convId
      const res = await fetch(`${TIKTOK_BASE}/api/conversations/${encodeURIComponent(id)}/fetch-messages`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      const items = data.messages || data.items || []
      return items.map((m: any) => mapTikTokMessage(m, convId))
    } catch {
      return [{ id: 'tt-d1', conversationId: convId, platform: PLATFORM, direction: 'in' as const, body: 'Demo TikTok message', sentAt: new Date().toISOString() }]
    }
  },

  async sendMessage(convId: string, body: string) {
    const id = convId.includes(':') ? convId.split(':').pop()! : convId
    try {
      const res = await fetch(`${TIKTOK_BASE}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id, body }),
      })
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      return mapTikTokMessage(data, convId)
    } catch {
      return {
        id: 'tt-sent-' + Date.now(),
        conversationId: convId,
        platform: PLATFORM,
        direction: 'out' as const,
        body,
        sentAt: new Date().toISOString(),
      }
    }
  },

  async markRead(_convId: string) {
    // TikTok backend may not have explicit mark-read; best effort or no-op
    try {
      // Could call update on conversation if needed
    } catch {}
  },

  async archiveConversation(convId: string, archived: boolean) {
    const id = convId.includes(':') ? convId.split(':').pop()! : convId
    try {
      await fetch(`${TIKTOK_BASE}/api/conversations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
    } catch {}
  },

  getCharacteristics() {
    return {
      transport: 'browser' as const,
      supportsRealtime: false,
      typicalSendLatencyMs: 2500,
    }
  },
}
