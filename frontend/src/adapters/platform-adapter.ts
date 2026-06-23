import type {
  OmniAccount,
  OmniConversation,
  OmniMessage,
  Platform,
} from '../types/omni'

export interface PlatformAdapter {
  readonly platform: Platform

  listAccounts(): Promise<OmniAccount[]>

  listConversations(opts?: {
    accountIds?: string[]
    archived?: boolean
  }): Promise<OmniConversation[]>

  getMessages(
    convId: string,
    opts?: { limit?: number }
  ): Promise<OmniMessage[]>

  sendMessage(convId: string, body: string): Promise<OmniMessage>

  markRead(convId: string): Promise<void>

  archiveConversation(convId: string, archived: boolean): Promise<void>
}
