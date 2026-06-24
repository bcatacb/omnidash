import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'instagram' as const

const accounts: OmniAccount[] = [
  {
    id: 'ig-acc-1',
    platform: PLATFORM,
    label: 'Creator Main',
    username: '@creativemike',
    avatarUrl: null,
    status: 'connected',
  },
  {
    id: 'ig-acc-2',
    platform: PLATFORM,
    label: 'Collab',
    username: '@mikeandteam',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'ig-conv-1',
    platform: PLATFORM,
    accountId: 'ig-acc-1',
    peer: { id: 'brand-nike', displayName: 'Nike Brand', username: 'nike' },
    lastMessagePreview: 'Love the latest reel idea. Can we lock the shoot date?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 1,
    archived: false,
  },
  {
    id: 'ig-conv-2',
    platform: PLATFORM,
    accountId: 'ig-acc-1',
    peer: { id: 'friend-lex', displayName: 'Lex Rivera', username: 'lexrva' },
    lastMessagePreview: 'You posting the story tonight or tomorrow?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    lastMessageDirection: 'out',
    unreadCount: 0,
    archived: false,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'ig-conv-1': [
    {
      id: 'ig-msg-1',
      conversationId: 'ig-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'Love the latest reel idea. Can we lock the shoot date?',
      sentAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      author: { name: 'Nike Brand' },
    },
  ],
  'ig-conv-2': [
    {
      id: 'ig-msg-2',
      conversationId: 'ig-conv-2',
      platform: PLATFORM,
      direction: 'out',
      body: 'Story tonight. Will tag you.',
      sentAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      author: { name: 'You' },
    },
  ],
}

export const instagramAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    return [...accounts]
  },

  async listConversations(opts) {
    let list = [...conversations]
    if (opts?.accountIds?.length) {
      list = list.filter(c => opts.accountIds!.includes(c.accountId))
    }
    if (opts?.archived !== undefined) {
      list = list.filter(c => c.archived === opts.archived)
    }
    return list
  },

  async getMessages(convId, opts) {
    const msgs = messages[convId] ?? []
    const limit = opts?.limit ?? 50
    return [...msgs].slice(-limit)
  },

  async sendMessage(convId, body) {
    const msg: OmniMessage = {
      id: 'ig-msg-' + Date.now(),
      conversationId: convId,
      platform: PLATFORM,
      direction: 'out',
      body,
      sentAt: new Date().toISOString(),
      author: { name: 'You' },
    }
    if (!messages[convId]) messages[convId] = []
    messages[convId].push(msg)

    const conv = conversations.find(c => c.id === convId)
    if (conv) {
      conv.lastMessagePreview = body
      conv.lastMessageAt = msg.sentAt
      conv.lastMessageDirection = 'out'
    }
    return msg
  },

  async markRead(convId) {
    const conv = conversations.find(c => c.id === convId)
    if (conv) conv.unreadCount = 0
  },

  async archiveConversation(convId, archived) {
    const conv = conversations.find(c => c.id === convId)
    if (conv) conv.archived = archived
  },

  async startConversation(accountId, peer) {
    const newConv: OmniConversation = {
      id: `ig-conv-${Date.now()}`,
      platform: PLATFORM,
      accountId,
      peer: {
        id: peer.id || peer.username || `ig-peer-${Date.now()}`,
        displayName: peer.displayName,
        username: peer.username || null,
      },
      lastMessagePreview: null,
      lastMessageAt: null,
      lastMessageDirection: null,
      unreadCount: 0,
      archived: false,
    }
    conversations.push(newConv)
    messages[newConv.id] = []
    return newConv
  },

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: true,
      typicalSendLatencyMs: 400,
    }
  },
}
