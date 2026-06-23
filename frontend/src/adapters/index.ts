import type { PlatformAdapter } from './platform-adapter'
import { telegramAdapter } from './telegram'
import { discordAdapter } from './discord'
import { tiktokAdapter } from './tiktok'

export const adapters: Record<string, PlatformAdapter> = {
  telegram: telegramAdapter,
  discord: discordAdapter,
  tiktok: tiktokAdapter,
}

export function getAdapter(platform: string): PlatformAdapter | undefined {
  return adapters[platform]
}

export function getAllAdapters(): PlatformAdapter[] {
  return Object.values(adapters)
}
