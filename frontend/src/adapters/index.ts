import type { PlatformTransformer } from './platform-adapter'
import { telegramAdapter } from './telegram'
import { discordAdapter } from './discord'
import { tiktokAdapter } from './tiktok'
import { instagramAdapter } from './instagram'
import { snapchatAdapter } from './snapchat'
import { facebookAdapter } from './facebook'

/**
 * Platform transformers (the unified intra-API).
 * 
 * Backed by a single unified database (see omnibox/db/unified/).
 * 
 * Each exported *Adapter is the platform-specific adapter inside the transformer.
 * It knows how to talk to its platform's execution engine (Telethon / Playwright / hybrid)
 * and is responsible for ensuring data lands in the unified DB in normalized form.
 * 
 * The frontend only talks to the unified model via these transformers.
 * 
 * Adapters live inside the transformer.
 */
export const transformers: Record<string, PlatformTransformer> = {
  telegram: telegramAdapter,
  discord: discordAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  snapchat: snapchatAdapter,
  facebook: facebookAdapter,
}

// Back-compat aliases (we're shifting from "adapter" to "transformer" terminology)
export const adapters = transformers

export function getTransformer(platform: string): PlatformTransformer | undefined {
  return transformers[platform]
}

export function getAllTransformers(): PlatformTransformer[] {
  return Object.values(transformers)
}

// Legacy names (will be removed)
export const getAdapter = getTransformer
export const getAllAdapters = getAllTransformers
