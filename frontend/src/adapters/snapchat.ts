import type { OmniAccount, OmniConversation, OmniMessage } from '../types/omni'
import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'snapchat' as const

export const snapchatAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts(): Promise<OmniAccount[]> {
    // Socket ready — implementation coming later
    return []
  },

  async listConversations(): Promise<OmniConversation[]> {
    return []
  },

  async getMessages(): Promise<OmniMessage[]> {
    return []
  },

  async sendMessage(): Promise<OmniMessage> {
    throw new Error('Snapchat support not implemented yet')
  },

  async markRead() {
    // no-op for now
  },

  async archiveConversation() {
    // no-op for now
  },

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: false,
      typicalSendLatencyMs: 600,
    }
  },
}
