import type { PlatformTransformer } from './platform-adapter'

const PLATFORM = 'instagram' as const

export const instagramAdapter: PlatformTransformer = {
  platform: PLATFORM,

  async listAccounts() {
    // Real Instagram backend not yet implemented for live use.
    // Returning empty until real transport (Playwright/API) is wired.
    return []
  },

  async listConversations() {
    return []
  },

  async getMessages() {
    return []
  },

  async sendMessage() {
    throw new Error('Instagram real backend not implemented')
  },

  async markRead() {
    // no-op
  },

  async archiveConversation() {
    // no-op
  },

  async startConversation() {
    throw new Error('Instagram real backend not implemented')
  },

  getCharacteristics() {
    return {
      transport: 'api',
      supportsRealtime: true,
      typicalSendLatencyMs: 400,
    }
  },
}
