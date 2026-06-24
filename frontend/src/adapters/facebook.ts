import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'facebook' as const

const accounts: OmniAccount[] = [
  {
    id: 'fb-acc-1',
    platform: PLATFORM,
    label: 'Personal',
    username: 'mike.chen',
    avatarUrl: null,
    status: 'connected',
  },
  {
    id: 'fb-acc-2',
    platform: PLATFORM,
    label: 'Business Page',
    username: 'MikeCreativeCo',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'fb-conv-1',
    platform: PLATFORM,
    accountId: 'fb-acc-1',
    peer: { id: 'old-college', displayName: 'Alex Kim', username: 'alexkim' },
    lastMessagePreview: 'Haha yeah the old group chat was chaos',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 2,
    archived: false,
  },
  {
    id: 'fb-conv-2',
    platform: PLATFORM,
    accountId: 'fb-acc-2',
    peer: { id: 'lead-jordan', displayName: 'Jordan Ellis', username: 'jordan.ellis' },
    lastMessagePreview: 'Thanks for the proposal. When can we hop on a call?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 33).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 0,
    archived: false,
  },
  {
    id: 'fb-conv-3',
    platform: PLATFORM,
    accountId: 'fb-acc-1',
    peer: { id: 'family-mom', displayName: 'Mom', username: '' },
    lastMessagePreview: 'Did you see the photos from the weekend?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 1,
    archived: false,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'fb-conv-1': [
    {
      id: 'fb-msg-1',
      conversationId: 'fb-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'Haha yeah the old group chat was chaos',
      sentAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      author: { name: 'Alex Kim' },
    },
    {
      id: 'fb-msg-2',
      conversationId: 'fb-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'We should recreate it sometime 😂',
      sentAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
      author: { name: 'Alex Kim' },
    },
  ],
  'fb-conv-2': [
    {
      id: 'fb-msg-3',
      conversationId: 'fb-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'Thanks for the proposal. When can we hop on a call?',
      sentAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
      author: { name: 'Jordan Ellis' },
    },
  ],
  'fb-conv-3': [
    {
      id: 'fb-msg-4',
      conversationId: 'fb-conv-3',
      platform: PLATFORM,
      direction: 'in',
      body: 'Did you see the photos from the weekend?',
      sentAt: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
      author: { name: 'Mom' },
    },
  ],
}

export const facebookAdapter: PlatformTransformer = {
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
      id: 'fb-msg-' + Date.now(),
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

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: true,
      typicalSendLatencyMs: 350,
    }
  },
}
