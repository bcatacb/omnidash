import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'snapchat' as const

// Pure stub for live path. No demo data.

export const snapchatAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    // Real Snapchat backend not yet implemented for live use.
    return []
  },

  async listConversations() {
    return []
  },

  async getMessages() {
    return []
  },

  async sendMessage() {
    throw new Error('Snapchat real backend not implemented')
  },

  async markRead() {
    // no-op
  },

  async archiveConversation() {
    // no-op
  },

  async startConversation() {
    throw new Error('Snapchat real backend not implemented')
  },

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: false,
      typicalSendLatencyMs: 600,
    }
  },
}
