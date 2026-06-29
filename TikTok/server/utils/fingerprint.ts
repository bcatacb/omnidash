// Chrome-on-Windows/Mac only. (Dropped the Linux + Safari UAs: a Linux desktop is
// an unusual TikTok client, and a Safari UA on a Chromium engine is an inconsistency
// that's itself a tell.)
const WINDOWS_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]
const MAC_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
]
const USER_AGENTS = [...WINDOWS_UAS, ...MAC_UAS]

// Believable WebGL [vendor, renderer] pairs per OS — masks the Xvfb SwiftShader/llvmpipe
// renderer, which is the single biggest "no GPU / datacenter" tell.
const WIN_GPUS: [string, string][] = [
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 (0x00002184) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
]
const MAC_GPUS: [string, string][] = [
  ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
  ['Google Inc. (Intel Inc.)', 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)'],
]

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
]

const LOCALES = ['en-US', 'en-US', 'en-US', 'en-GB', 'en-CA']
const HW_CONCURRENCY = [4, 8, 8, 12, 16]

function seededRandom(seed: string): () => number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 0x100000000
  }
}

export interface BrowserFingerprint {
  userAgent: string
  viewport: { width: number; height: number }
  timezone: string
  locale: string
  platform: string
  webglVendor: string
  webglRenderer: string
  hardwareConcurrency: number
  deviceMemory: number
}

export function generateFingerprint(accountId: string): BrowserFingerprint {
  const rand = seededRandom(accountId)
  const userAgent = USER_AGENTS[Math.floor(rand() * USER_AGENTS.length)]
  const isWin = userAgent.includes('Windows')
  const gpus = isWin ? WIN_GPUS : MAC_GPUS
  const [webglVendor, webglRenderer] = gpus[Math.floor(rand() * gpus.length)]
  return {
    userAgent,
    viewport: VIEWPORTS[Math.floor(rand() * VIEWPORTS.length)],
    timezone: TIMEZONES[Math.floor(rand() * TIMEZONES.length)],
    locale: LOCALES[Math.floor(rand() * LOCALES.length)],
    platform: isWin ? 'Win32' : 'MacIntel',
    webglVendor,
    webglRenderer,
    hardwareConcurrency: HW_CONCURRENCY[Math.floor(rand() * HW_CONCURRENCY.length)],
    deviceMemory: 8,
  }
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function humanTypeDelay(): Promise<void> {
  return randomDelay(50, 150)
}
