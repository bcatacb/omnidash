import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'discord' as const

const DISCORD_BASE = (import.meta as any).env?.VITE_DISCORD_API || 'http://localhost:4000'

// Discord transformer (hybrid platform).
// 
// Platform adapter inside the transformer.
// Normalizes to unified DB (see ../../db/unified/schema.sql).
// Keeps Discord's execution model (bridge + Playwright for certain actions).

function mapDiscordConversation(item: any): OmniConversation {
  // The Unibox API nests the peer (item.peer.{discordUserId,displayName,avatarUrl})
  // and uses camelCase. Keep snake_case/flat fallbacks for older shapes.
  const peer = item.peer || {}
  const lastAt = item.lastMessageAt || item.last_message_at
  return {
    id: item.id || `discord:${item.accountId || item.account_id}:${peer.discordUserId || item.peer_discord_user_id || item.id}`,
    platform: PLATFORM,
    accountId: item.accountId || item.account_id || 'dc-acc-1',
    peer: {
      id: peer.discordUserId || item.peer_discord_user_id || item.peerId || 'unknown',
      displayName: peer.displayName || item.peer_display_name || item.peerDisplayName || 'Discord User',
      username: peer.username || item.peer_username || item.peerUsername,
      avatarUrl: peer.avatarUrl || item.peer_avatar_url || item.peerAvatar || null,
    },
    lastMessagePreview: item.lastMessagePreview || item.last_message_preview || null,
    lastMessageAt: lastAt ? new Date(lastAt).toISOString() : null,
    lastMessageDirection: item.lastMessageDirection || item.last_message_direction,
    unreadCount: item.unreadCount || item.unread_count || 0,
    archived: item.label === 'archived' || !!item.archived,
    meta: item,
  }
}

function mapDiscordMessage(item: any, convId: string): OmniMessage {
  return {
    id: item.id || 'dc-msg-' + Date.now(),
    conversationId: convId,
    platform: PLATFORM,
    direction: item.direction || (item.outgoing ? 'out' : 'in'),
    body: item.body || item.text || null,
    sentAt: item.sentAt ? new Date(item.sentAt).toISOString() : (item.sent_at ? new Date(item.sent_at).toISOString() : new Date().toISOString()),
    author: item.author || (item.authorName ? { name: item.authorName, avatarUrl: item.authorAvatarUrl || null } : (item.sender_name ? { name: item.sender_name } : undefined)),
  }
}

export const discordAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    try {
      const res = await fetch(`${DISCORD_BASE}/api/accounts`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      return (data || []).map((a: any): OmniAccount => ({
        id: a.id,
        platform: PLATFORM,
        label: a.label || a.username || 'Discord',
        username: a.username || '',
        avatarUrl: a.avatarUrl || a.avatar || null,
        status: a.status || 'connected',
      }))
    } catch (e) {
      console.warn('[discord] listAccounts FAILED:', e)
      return []
    }
  },

  async listConversations(_opts?: any) {
    try {
      const res = await fetch(`${DISCORD_BASE}/api/unibox/conversations`)
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      // API returns { items, total, hasMore, summary } — not a bare array.
      const raw = Array.isArray(data) ? data : (data?.items || [])
      let items = raw.map(mapDiscordConversation)

      if (_opts?.accountIds?.length) {
        items = items.filter((c: any) => _opts.accountIds!.includes(c.accountId))
      }
      if (_opts?.archived !== undefined) {
        items = items.filter((c: any) => c.archived === _opts.archived)
      }
      return items
    } catch (e) {
      console.warn('[discord] listConversations FAILED:', e)
      return []
    }
  },

  async getMessages(convId: string, _opts?: any) {
    const id = convId.includes(':') ? convId.split(':').pop()! : convId
    try {
      const res = await fetch(`${DISCORD_BASE}/api/unibox/conversations/${encodeURIComponent(id)}/messages`)
      if (!res.ok) throw new Error('backend')
      const items = await res.json()
      return (items || []).map((m: any) => mapDiscordMessage(m, convId))
    } catch (e) {
      console.warn('[discord] getMessages FAILED:', e)
      return []
    }
  },

  async sendMessage(convId: string, body: string) {
    const id = convId.includes(':') ? convId.split(':').pop()! : convId
    try {
      const res = await fetch(`${DISCORD_BASE}/api/unibox/conversations/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error('backend')
      const data = await res.json()
      return mapDiscordMessage(data, convId)
    } catch (e) {
      console.error('Discord sendMessage failed', e)
      throw e
    }
  },

  async markRead(convId: string) {
    try {
      const id = convId.includes(':') ? convId.split(':').pop()! : convId
      await fetch(`${DISCORD_BASE}/api/unibox/conversations/${encodeURIComponent(id)}/mark-read`, { method: 'POST' })
    } catch {}
  },

  async archiveConversation(convId: string, archived: boolean) {
    try {
      const id = convId.includes(':') ? convId.split(':').pop()! : convId
      await fetch(`${DISCORD_BASE}/api/unibox/conversations/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
    } catch {}
  },

  async startConversation(accountId, peer) {
    // For real backend, call create conv endpoint if available.
    // Currently returns structure; send will go to backend.
    return {
      id: `dc-conv-${Date.now()}`,
      platform: PLATFORM,
      accountId,
      peer: {
        id: peer.id || peer.username || `dc-peer-${Date.now()}`,
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
      transport: 'hybrid' as const,
      supportsRealtime: true,
      typicalSendLatencyMs: 800,
    }
  },
}
