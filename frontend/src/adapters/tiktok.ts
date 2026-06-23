import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformAdapter } from './platform-adapter'

const PLATFORM = 'tiktok' as const

const accounts: OmniAccount[] = [
  {
    id: 'tt-acc-1',
    platform: PLATFORM,
    label: 'Creator Account',
    username: '@creativemike',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'tt-conv-1',
    platform: PLATFORM,
    accountId: 'tt-acc-1',
    peer: { id: 'u4', displayName: 'Mike Chen', username: 'creativemike' },
    lastMessagePreview: 'Loved the last video idea 🔥 When are we posting?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 41).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 0,
    archived: false,
  },
  {
    id: 'tt-conv-2',
    platform: PLATFORM,
    accountId: 'tt-acc-1',
    peer: { id: 'u10', displayName: 'Ava Torres', username: 'avadesign' },
    lastMessagePreview: 'The collab video is blowing up. 180k views!',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 4,
    archived: false,
  },
  {
    id: 'tt-conv-3',
    platform: PLATFORM,
    accountId: 'tt-acc-1',
    peer: { id: 'u11', displayName: 'Kai Nakamura', username: 'kainaka' },
    lastMessagePreview: 'Sent the revised script in the drive.',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    lastMessageDirection: 'out',
    unreadCount: 0,
    archived: false,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'tt-conv-1': [
    {
      id: 'tt-msg-1',
      conversationId: 'tt-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'Loved the last video idea 🔥 When are we posting?',
      sentAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
      author: { name: 'Mike Chen' },
    },
  ],
  'tt-conv-2': [
    {
      id: 'tt-msg-2a',
      conversationId: 'tt-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'The collab video is blowing up. 180k views!',
      sentAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
      author: { name: 'Ava Torres' },
    },
    {
      id: 'tt-msg-2b',
      conversationId: 'tt-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'Brands are sliding into DMs now lol',
      sentAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
      author: { name: 'Ava Torres' },
    },
  ],
  'tt-conv-3': [
    {
      id: 'tt-msg-3',
      conversationId: 'tt-conv-3',
      platform: PLATFORM,
      direction: 'out',
      body: 'Sent the revised script in the drive.',
      sentAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      author: { name: 'You' },
    },
  ],
}

export const tiktokAdapter: PlatformAdapter = {
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
      id: 'tt-msg-' + Date.now(),
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

  async simulateIncoming(convId, body) {
    const conv = conversations.find(c => c.id === convId)
    const peerName = conv?.peer.displayName || 'Them'
    const text = body || (['This is going viral 😎', 'DMs are wild today', 'Can we hop on a quick voice?'][Math.floor(Math.random()*3)])

    const msg: OmniMessage = {
      id: 'tt-in-' + Date.now(),
      conversationId: convId,
      platform: PLATFORM,
      direction: 'in',
      body: text,
      sentAt: new Date().toISOString(),
      author: { name: peerName },
    }
    if (!messages[convId]) messages[convId] = []
    messages[convId].push(msg)

    if (conv) {
      conv.lastMessagePreview = text
      conv.lastMessageAt = msg.sentAt
      conv.lastMessageDirection = 'in'
      conv.unreadCount = (conv.unreadCount || 0) + 1
    }
    return msg
  },

  async createConversation(peerName, initialMessage, accountId) {
    const accId = accountId || accounts[0]?.id || 'tt-acc-1'
    const newId = 'tt-conv-' + Date.now()
    const peer = { id: 'peer-' + Date.now(), displayName: peerName, username: peerName.toLowerCase().replace(/\s+/g, '') }
    const conv: OmniConversation = {
      id: newId,
      platform: PLATFORM,
      accountId: accId,
      peer,
      lastMessagePreview: initialMessage || 'New conversation started',
      lastMessageAt: new Date().toISOString(),
      lastMessageDirection: initialMessage ? 'out' : null,
      unreadCount: 0,
      archived: false,
    }
    conversations.unshift(conv)

    if (initialMessage) {
      const msg: OmniMessage = {
        id: 'tt-new-' + Date.now(),
        conversationId: newId,
        platform: PLATFORM,
        direction: 'out',
        body: initialMessage,
        sentAt: new Date().toISOString(),
        author: { name: 'You' },
      }
      if (!messages[newId]) messages[newId] = []
      messages[newId].push(msg)
    }
    return conv
  },
}
