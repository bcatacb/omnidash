import type {
  OmniAccount,
  OmniConversation,
  OmniMessage,
  Platform,
} from '../types/omni'

/**
 * PlatformTransformer
 *
 * The contract for the unification / intra-platform API layer.
 *
 * Backed by a single unified database (see ../db/unified/schema.sql).
 *
 * Critical points (agreed model):
 * - A transformer implementation **could look like anything** as long as it fulfills this contract
 *   (correct Omni* shapes + method behavior). It can be thin or a full internal subsystem.
 * - Adapters still exist *into* the transformer. The per-platform pieces (*Adapter exports)
 *   handle platform-specific execution (API vs Playwright) and feed normalized data into the unified DB.
 * - This layer (the transformers) acts as the unified intra-API.
 *   The UI (OmniDash) talks only to this; it does not talk directly to the three platform systems.
 *
 * - The platform backends keep their execution models.
 * - They (or sync workers) write to the shared unified DB.
 *
 * We do not force the platforms to change how they operate.
 */
export interface PlatformCharacteristics {
  transport: 'api' | 'hybrid' | 'browser'
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

  getMessages(
    convId: string,
    opts?: { limit?: number }
  ): Promise<OmniMessage[]>

  sendMessage(convId: string, body: string): Promise<OmniMessage>

  markRead(convId: string): Promise<void>

  archiveConversation(convId: string, archived: boolean): Promise<void>

  /**
   * Optional metadata for richer transformer / intraAPI usage.
   * Helps the UI treat platforms differently without hardcoding.
   */
  getCharacteristics?(): PlatformCharacteristics;
}
