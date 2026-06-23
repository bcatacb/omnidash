import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformAdapter } from './platform-adapter'

const PLATFORM = 'discord' as const

const accounts: OmniAccount[] = [
  {
    id: 'dc-acc-1',
    platform: PLATFORM,
    label: 'Main',
    username: 'alexr#4821',
    avatarUrl: null,
    status: 'connected',
  },
  {
    id: 'dc-acc-2',
    platform: PLATFORM,
    label: 'Alt',
    username: 'workalt#0091',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'dc-conv-1',
    platform: PLATFORM,
    accountId: 'dc-acc-1',
    peer: { id: 'u3', displayName: 'Alex Rivera', username: 'alexr' },
    lastMessagePreview: 'The server is ready for the campaign. Just added the new leads.',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 1,
    archived: false,
  },
  {
    id: 'dc-conv-2',
    platform: PLATFORM,
    accountId: 'dc-acc-1',
    peer: { id: 'u5', displayName: 'Jordan Hale', username: 'jordanh' },
    lastMessagePreview: 'Got it, will review the assets tonight.',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    lastMessageDirection: 'out',
    unreadCount: 0,
    archived: false,
  },
  {
    id: 'dc-conv-3',
    platform: PLATFORM,
    accountId: 'dc-acc-2',
    peer: { id: 'u7', displayName: 'Sam Patel', username: 'samp' },
    lastMessagePreview: 'Interested — can we hop on a quick call?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 3,
    archived: false,
  },
  {
    id: 'dc-conv-4',
    platform: PLATFORM,
    accountId: 'dc-acc-2',
    peer: { id: 'u9', displayName: 'Taylor Kim', username: 'tayk' },
    lastMessagePreview: 'Thanks for the warm intro!',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    lastMessageDirection: 'out',
    unreadCount: 0,
    archived: true,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'dc-conv-1': [
    {
      id: 'dc-msg-1',
      conversationId: 'dc-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'The server is ready for the campaign. Just added the new leads.',
      sentAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      author: { name: 'Alex Rivera' },
    },
  ],
  'dc-conv-2': [
    {
      id: 'dc-msg-2a',
      conversationId: 'dc-conv-2',
      platform: PLATFORM,
      direction: 'out',
      body: 'Got it, will review the assets tonight.',
      sentAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
      author: { name: 'You' },
    },
    {
      id: 'dc-msg-2b',
      conversationId: 'dc-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'Awesome, ping me when you have feedback.',
      sentAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      author: { name: 'Jordan Hale' },
    },
  ],
  'dc-conv-3': [
    {
      id: 'dc-msg-3a',
      conversationId: 'dc-conv-3',
      platform: PLATFORM,
      direction: 'in',
      body: 'Hey, saw your outreach. Interested — can we hop on a quick call?',
      sentAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      author: { name: 'Sam Patel' },
    },
    {
      id: 'dc-msg-3b',
      conversationId: 'dc-conv-3',
      platform: PLATFORM,
      direction: 'in',
      body: 'My calendar is pretty open tomorrow.',
      sentAt: new Date(Date.now() - 1000 * 60 * 60 * 3 + 1000 * 60 * 2).toISOString(),
      author: { name: 'Sam Patel' },
    },
  ],
  'dc-conv-4': [
    {
      id: 'dc-msg-4',
      conversationId: 'dc-conv-4',
      platform: PLATFORM,
      direction: 'out',
      body: 'Thanks for the warm intro!',
      sentAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
      author: { name: 'You' },
    },
  ],
}

export const discordAdapter: PlatformAdapter = {
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
      id: 'dc-msg-' + Date.now(),
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
    const text = body || (['Hey, following up on that.', 'Sounds good — when works for you?', 'Just saw your note. 🔥'][Math.floor(Math.random()*3)])

    const msg: OmniMessage = {
      id: 'dc-in-' + Date.now(),
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
    const accId = accountId || accounts[0]?.id || 'dc-acc-1'
    const newId = 'dc-conv-' + Date.now()
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
        id: 'dc-new-' + Date.now(),
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
