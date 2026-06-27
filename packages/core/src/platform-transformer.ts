import type { OmniAccount, OmniConversation, OmniMessage, Platform } from './omni'

/**
 * PlatformTransformer — the contract every platform implements.
 *
 * The shell (and the unified inbox) talk ONLY to this. Each platform's engine
 * fulfils the contract using whatever execution model it must:
 *   - api        → Telegram (Telethon)
 *   - hybrid     → Discord (bridge + Playwright)
 *   - browser    → TikTok (web Playwright)
 *   - cloud-phone→ Snapchat / Instagram / Facebook (DuoPlus device via ADB/Appium)
 *
 * Normalized output (Omni* shapes) lands in the unified DB; the shell reads it.
 */
export interface PlatformCharacteristics {
  transport: 'api' | 'hybrid' | 'browser' | 'cloud-phone'
  supportsRealtime?: boolean
  typicalSendLatencyMs?: number
}

export interface PlatformTransformer {
  readonly platform: Platform

  listAccounts(): Promise<OmniAccount[]>

  listConversations(opts?: {
    accountIds?: string[]
    archived?: boolean
  }): Promise<OmniConversation[]>

  getMessages(convId: string, opts?: { limit?: number }): Promise<OmniMessage[]>

  sendMessage(convId: string, body: string): Promise<OmniMessage>

  markRead(convId: string): Promise<void>

  archiveConversation(convId: string, archived: boolean): Promise<void>

  startConversation(
    accountId: string,
    peer: { displayName: string; username?: string; id?: string }
  ): Promise<OmniConversation>

  getCharacteristics?(): PlatformCharacteristics
}
