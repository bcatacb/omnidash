import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'facebook' as const

// Pure stub for live: no demo data. Real implementation required for production use.

export const facebookAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    // Real Facebook/Messenger backend not yet implemented for live use.
    return []
  },

  async listConversations() {
    return []
  },

  async getMessages() {
    return []
  },

  async sendMessage() {
    throw new Error('Facebook real backend not implemented')
  },

  async markRead() {
    // no-op
  },

  async archiveConversation() {
    // no-op
  },

  async startConversation() {
    throw new Error('Facebook real backend not implemented')
  },

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: true,
      typicalSendLatencyMs: 350,
    }
  },
}
