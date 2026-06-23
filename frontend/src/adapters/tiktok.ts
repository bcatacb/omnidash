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
}
