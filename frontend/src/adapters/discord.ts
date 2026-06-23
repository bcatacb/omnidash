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
}
