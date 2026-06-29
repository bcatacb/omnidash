import type { Browser, BrowserContext } from 'playwright'
import { chromium } from 'playwright'
import { generateFingerprint } from '../utils/fingerprint.js'
import { supabase } from '../utils/supabase.js'

interface PooledSession {
  accountId: string
  context: BrowserContext
  browser: Browser
  lastUsed: number
  pinned: boolean
  busy: boolean
  headed: boolean
  waiters: Array<() => void>
}

interface QueuedTask {
  accountId: string
  headed: boolean
  resolve: (session: PooledSession) => void
  reject: (err: Error) => void
}

export interface AcquireOpts {
  /** Launch a VISIBLE browser (into the X display, for VNC manual login). Default false (headless). */
  headed?: boolean
}

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '5')
const IDLE_TIMEOUT = parseInt(process.env.BROWSER_IDLE_TIMEOUT_MS || '60000')

const activeSessions = new Map<string, PooledSession>()
const taskQueue: QueuedTask[] = []
let idleTimer: ReturnType<typeof setInterval> | null = null

function startIdleReaper() {
  if (idleTimer) return
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of activeSessions) {
      if (!session.pinned && !session.busy && now - session.lastUsed > IDLE_TIMEOUT) {
        console.log(`[pool] closing idle session for ${session.accountId}`)
        session.context.close().catch(() => {})
        session.browser.close().catch(() => {})
        activeSessions.delete(id)
        drainQueue()
      }
    }
    if (activeSessions.size === 0 && taskQueue.length === 0) {
      clearInterval(idleTimer!)
      idleTimer = null
    }
  }, 10_000)
}

// ── FAIL-CLOSED proxy gate ──────────────────────────────────────────────
// Confirm the browser's REAL egress IP equals the account's proxy IP before
// it is ever allowed to touch TikTok. If it can't be confirmed, we refuse.
async function verifyEgress(context: BrowserContext, expectedIp: string): Promise<{ ok: boolean; egress: string | null }> {
  const probes = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://ipinfo.io/ip']
  const page = await context.newPage()
  try {
    for (const u of probes) {
      try {
        await page.goto(u, { timeout: 20000, waitUntil: 'domcontentloaded' })
        const text = (await page.evaluate(() => document.body?.innerText || '')).trim()
        const m = text.match(/(\d{1,3}\.){3}\d{1,3}/)
        if (m) return { ok: m[0] === expectedIp, egress: m[0] }
      } catch {
        /* try next probe */
      }
    }
    return { ok: false, egress: null }
  } finally {
    await page.close().catch(() => {})
  }
}

async function createSession(accountId: string, proxyUrl: string | null, sessionData: Record<string, unknown> | null, headed: boolean): Promise<PooledSession> {
  let resolvedProxyUrl = proxyUrl
  let resolvedSessionData = sessionData

  // Always load the account's proxy + session — the proxy is REQUIRED for the
  // fail-closed gate, even when sessionData was passed in by the caller.
  const { data: account } = await supabase
    .from('tiktok_accounts')
    .select('session_data, proxy_id')
    .eq('id', accountId)
    .single()
  if (account) {
    if (!resolvedSessionData) resolvedSessionData = account.session_data as any
    if (account.proxy_id && !resolvedProxyUrl) {
      const { data: proxy } = await supabase
        .from('proxies')
        .select('*')
        .eq('id', account.proxy_id)
        .single()
      if (proxy) {
        const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : ''
        resolvedProxyUrl = `http://${auth}${proxy.host}:${proxy.port}`
      }
    }
  }

  // FAIL-CLOSED #1: no proxy => never launch a naked browser.
  if (!resolvedProxyUrl) {
    throw new Error(`[proxy-gate] account ${accountId} has NO proxy assigned — refusing to launch (fail-closed, no naked sessions)`)
  }
  const expectedIp = new URL(resolvedProxyUrl).hostname

  const fp = generateFingerprint(accountId)

  // headed = visible browser (rendered into the X display for VNC manual login).
  // headless = invisible (background automation: inbox-sync, send). Decided per call,
  // NOT via a global env flag — auth flows pass { headed: true }, everything else defaults headless.
  const launchOptions: Record<string, unknown> = {
    headless: !headed,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Never leak the real IP via WebRTC/STUN even with the HTTP proxy set.
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      `--window-size=${fp.viewport.width},${fp.viewport.height}`,
    ],
  }

  {
    const url = new URL(resolvedProxyUrl)
    launchOptions.proxy = {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: url.username || undefined,
      password: url.password || undefined,
    }
  }

  const browser = await chromium.launch(launchOptions)

  const contextOptions: Record<string, unknown> = {
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezone,
    permissions: [],
    bypassCSP: true,
  }

  if (resolvedSessionData?.cookies) {
    contextOptions.storageState = resolvedSessionData as unknown
  }

  const context = await browser.newContext(contextOptions)

  // Fingerprint hardening — runs before any page script. Masks the headless/Xvfb
  // tells: WebGL renderer (the big one), platform, hardwareConcurrency, deviceMemory,
  // window.chrome. Values are per-account-consistent (from generateFingerprint).
  await context.addInitScript((fpData: any) => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => false }) } catch { /* noop */ }
    try { Object.defineProperty(navigator, 'platform', { get: () => fpData.platform }) } catch { /* noop */ }
    try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fpData.hardwareConcurrency }) } catch { /* noop */ }
    try { Object.defineProperty(navigator, 'deviceMemory', { get: () => fpData.deviceMemory }) } catch { /* noop */ }
    try { if (!(window as any).chrome) (window as any).chrome = { runtime: {} } } catch { /* noop */ }
    const patch = (proto: any) => {
      if (!proto || !proto.getParameter) return
      const orig = proto.getParameter
      proto.getParameter = function (p: number) {
        if (p === 37445) return fpData.webglVendor   // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return fpData.webglRenderer // UNMASKED_RENDERER_WEBGL
        return orig.call(this, p)
      }
    }
    try { patch((window as any).WebGLRenderingContext && (window as any).WebGLRenderingContext.prototype) } catch { /* noop */ }
    try { patch((window as any).WebGL2RenderingContext && (window as any).WebGL2RenderingContext.prototype) } catch { /* noop */ }
  }, {
    platform: fp.platform,
    webglVendor: fp.webglVendor,
    webglRenderer: fp.webglRenderer,
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
  })

  // FAIL-CLOSED #2: verify real egress IP == proxy IP BEFORE returning the session.
  try {
    const { ok, egress } = await verifyEgress(context, expectedIp)
    if (!ok) {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
      throw new Error(`[proxy-gate] ${accountId}: egress ${egress || 'UNKNOWN'} != proxy ${expectedIp} — refusing to navigate (fail-closed, would be NAKED)`)
    }
    console.log(`[proxy-gate] OK ${accountId}: egress ${egress} == proxy ${expectedIp} (headed=${headed})`)
  } catch (e) {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    throw e
  }

  return {
    accountId,
    context,
    browser,
    lastUsed: Date.now(),
    pinned: false,
    busy: false,
    headed,
    waiters: [],
  }
}

function drainQueue() {
  while (taskQueue.length > 0 && activeSessions.size < MAX_CONCURRENT) {
    const task = taskQueue.shift()!
    const existing = activeSessions.get(task.accountId)
    if (existing) {
      existing.lastUsed = Date.now()
      task.resolve(existing)
    } else {
      createSession(task.accountId, null, null, task.headed)
        .then((session) => {
          activeSessions.set(task.accountId, session)
          startIdleReaper()
          task.resolve(session)
        })
        .catch(task.reject)
    }
  }
}

export async function acquireSession(
  accountId: string,
  proxyUrl: string | null = null,
  sessionData: Record<string, unknown> | null = null,
  opts: AcquireOpts = {}
): Promise<PooledSession> {
  const headed = opts.headed ?? false

  let existing = activeSessions.get(accountId)
  // If a session exists in the WRONG mode (e.g. a headless sync session, but we now
  // need a headed browser for manual login), tear it down and recreate in the right mode.
  if (existing && existing.headed !== headed) {
    console.log(`[pool] ${accountId}: mode switch (headed ${existing.headed} -> ${headed}) — recreating`)
    await destroySession(accountId)
    existing = undefined
  }

  if (existing) {
    if (existing.busy) {
      await new Promise<void>(resolve => existing!.waiters.push(resolve))
    }
    existing.lastUsed = Date.now()
    existing.busy = true
    return existing
  }

  if (activeSessions.size < MAX_CONCURRENT) {
    const session = await createSession(accountId, proxyUrl, sessionData, headed)
    session.busy = true
    activeSessions.set(accountId, session)
    startIdleReaper()
    return session
  }

  return new Promise((resolve, reject) => {
    taskQueue.push({ accountId, headed, resolve, reject })
  })
}

export function getSession(accountId: string): PooledSession | undefined {
  return activeSessions.get(accountId)
}

export function pinSession(accountId: string): void {
  const session = activeSessions.get(accountId)
  if (session) session.pinned = true
}

export async function releaseSession(accountId: string): Promise<void> {
  const session = activeSessions.get(accountId)
  if (session) {
    session.lastUsed = Date.now()
    session.pinned = false
    session.busy = false
    const waiter = session.waiters.shift()
    if (waiter) waiter()
  }
}

export async function destroySession(accountId: string): Promise<Record<string, unknown> | null> {
  const session = activeSessions.get(accountId)
  if (!session) return null

  let sessionData: Record<string, unknown> | null = null
  try {
    const state = await session.context.storageState()
    sessionData = state as unknown as Record<string, unknown>
  } catch {
    /* ignore */
  }

  await session.context.close().catch(() => {})
  await session.browser.close().catch(() => {})
  activeSessions.delete(accountId)
  drainQueue()

  return sessionData
}

export function getPoolStatus() {
  return {
    active: activeSessions.size,
    maxConcurrent: MAX_CONCURRENT,
    queued: taskQueue.length,
    sessions: Array.from(activeSessions.values()).map((s) => ({
      accountId: s.accountId,
      headed: s.headed,
      idleMs: Date.now() - s.lastUsed,
    })),
  }
}

export async function shutdownPool(): Promise<void> {
  if (idleTimer) clearInterval(idleTimer)
  for (const [id, session] of activeSessions) {
    await session.context.close().catch(() => {})
    await session.browser.close().catch(() => {})
    activeSessions.delete(id)
  }
  taskQueue.length = 0
}
