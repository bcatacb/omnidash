import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformAdapter } from './platform-adapter'

const PLATFORM = 'telegram' as const

// Fake accounts for Telegram
const accounts: OmniAccount[] = [
  {
    id: 'tg-acc-1',
    platform: PLATFORM,
    label: 'Main Account',
    username: '@mainuser',
    avatarUrl: null,
    status: 'connected',
  },
  {
    id: 'tg-acc-2',
    platform: PLATFORM,
    label: 'Work Phone',
    username: '@workphone',
    avatarUrl: null,
    status: 'connected',
  },
]

let conversations: OmniConversation[] = [
  {
    id: 'tg-conv-1',
    platform: PLATFORM,
    accountId: 'tg-acc-1',
    peer: { id: 'u1', displayName: 'Sophia Patel', username: 'sophia_m' },
    lastMessagePreview: 'Hey, any updates on the proposal we sent last week?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 2,
    archived: false,
  },
  {
    id: 'tg-conv-2',
    platform: PLATFORM,
    accountId: 'tg-acc-1',
    peer: { id: 'u2', displayName: 'Lina Voss', username: 'linavoss' },
    lastMessagePreview: 'Can you resend the file? Thanks!',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    lastMessageDirection: 'in',
    unreadCount: 0,
    archived: false,
  },
]

const messages: Record<string, OmniMessage[]> = {
  'tg-conv-1': [
    {
      id: 'tg-msg-0',
      conversationId: 'tg-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'Hi, following up on the earlier discussion.',
      sentAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      author: { name: 'Sophia Patel' },
    },
    {
      id: 'tg-msg-1',
      conversationId: 'tg-conv-1',
      platform: PLATFORM,
      direction: 'in',
      body: 'Hey, any updates on the proposal we sent last week?',
      sentAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      author: { name: 'Sophia Patel' },
    },
    {
      id: 'tg-msg-2',
      conversationId: 'tg-conv-1',
      platform: PLATFORM,
      direction: 'out',
      body: 'Working on it now, should have something by EOD.',
      sentAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      author: { name: 'You' },
    },
  ],
  'tg-conv-2': [
    {
      id: 'tg-msg-3',
      conversationId: 'tg-conv-2',
      platform: PLATFORM,
      direction: 'in',
      body: 'Can you resend the file? Thanks!',
      sentAt: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
      author: { name: 'Lina Voss' },
    },
  ],
}

export const telegramAdapter: PlatformAdapter = {
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
      id: 'tg-msg-' + Date.now(),
      conversationId: convId,
      platform: PLATFORM,
      direction: 'out',
      body,
      sentAt: new Date().toISOString(),
      author: { name: 'You' },
    }
    if (!messages[convId]) messages[convId] = []
    messages[convId].push(msg)

    // update conversation preview
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
