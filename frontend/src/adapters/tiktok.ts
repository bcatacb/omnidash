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
    } catch (e) {
      console.warn('[tiktok] listAccounts FAILED:', e)
      return []
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
    } catch (e) {
      console.warn('[tiktok] listConversations FAILED:', e)
      return []
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
      // c2 returns a bare array of inserted messages; older shape used {messages}/{items}.
      const items = Array.isArray(data) ? data : (data.messages || data.items || [])
      return items.map((m: any) => mapTikTokMessage(m, convId))
    } catch (e) {
      console.warn('[tiktok] getMessages FAILED:', e)
      return []
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
    } catch (e) {
      console.error('TikTok sendMessage failed', e)
      throw e
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

  async startConversation(accountId, peer) {
    // Real backend path; structure for now.
    return {
      id: `tt-conv-${Date.now()}`,
      platform: PLATFORM,
      accountId,
      peer: {
        id: peer.id || peer.username || `tt-peer-${Date.now()}`,
        displayName: peer.displayName,
        username: peer.username || null,
      },
      lastMessagePreview: null,
      lastMessageAt: null,
      lastMessageDirection: null,
      unreadCount: 0,
      archived: false,
    }
  },

  getCharacteristics() {
    return {
      transport: 'browser' as const,
      supportsRealtime: false,
      typicalSendLatencyMs: 2500,
    }
  },
}
