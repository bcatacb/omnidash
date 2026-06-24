import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'snapchat' as const

const accounts: OmniAccount[] = [
  {
    id: 'sc-acc-1',
    platform: PLATFORM,
    label: 'Personal',
    username: 'mike.snap',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'sc-conv-1',
    platform: PLATFORM,
    accountId: 'sc-acc-1',
    peer: { id: 'buddy-sam', displayName: 'Sam Torres', username: 'samtorres' },
    lastMessagePreview: 'The party snap was wild 😂',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 3,
    archived: false,
  },
  {
    id: 'sc-conv-2',
    platform: PLATFORM,
    accountId: 'sc-acc-1',
    peer: { id: 'team-lead', displayName: 'Jules (Work)', username: 'julesk' },
    lastMessagePreview: 'Can you send the quick edit before 3?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 0,
    archived: false,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'sc-conv-1': [
    {
      id: 'sc-msg-1',
      conversationId: 'sc-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'The party snap was wild 😂',
      sentAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      author: { name: 'Sam Torres' },
    },
    {
      id: 'sc-msg-2',
      conversationId: 'sc-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'You got the best angles lol',
      sentAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      author: { name: 'Sam Torres' },
    },
  ],
  'sc-conv-2': [
    {
      id: 'sc-msg-3',
      conversationId: 'sc-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'Can you send the quick edit before 3?',
      sentAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
      author: { name: 'Jules (Work)' },
    },
  ],
}

export const snapchatAdapter: PlatformTransformer = {
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
      id: 'sc-msg-' + Date.now(),
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
      id: `sc-conv-${Date.now()}`,
      platform: PLATFORM,
      accountId,
      peer: {
        id: peer.id || peer.username || `sc-peer-${Date.now()}`,
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
      supportsRealtime: false,
      typicalSendLatencyMs: 600,
    }
  },
}
