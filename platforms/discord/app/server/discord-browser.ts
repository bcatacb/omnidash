/**
 * Per-account Playwright Chromium contexts for captcha-walled Discord REST.
 *
 * Why this exists: cycletls impersonates Chrome at the TLS layer but Discord's
 * anti-abuse stack also inspects the full browser fingerprint — ServiceWorker
 * presence, navigator fields, cookie jar continuity, paint-timing. We can't
 * fake all of that from Node. Running the captcha-sensitive REST calls inside
 * a real Chromium that has already loaded discord.com and identified via the
 * SPA's normal boot path gives Discord exactly the shape it expects.
 *
 * Scope: ONLY the 3 endpoints Discord captcha-walls go through here:
 *   POST /channels/:id/messages
 *   POST /users/@me/channels
 *   PUT  /users/@me/relationships/:id
 * Everything else (GETs, /experiments, joins, listing) stays on tlsFetch —
 * those are not captcha-walled and don't justify the cost.
 *
 * Lifecycle:
 *   - One Browser singleton (lazy-launched on first browserFetch call).
 *   - One BrowserContext per accountId (lazy-created, kept warm). Each context
 *     has its own proxy URL, localStorage.token, cookie jar.
 *   - One Page per context, navigated to https://discord.com/channels/@me so
 *     Discord's SPA boot has executed.
 *   - Idle contexts (no use for IDLE_CLOSE_MS) close to free memory.
 *   - On SIGTERM, closeAllBrowserContexts() shuts every context + the browser.
 *
 * Disabled with BROWSER_FETCH_ENABLED=0; in that mode browserFetch throws so
 * call sites can decide whether to fall back to tlsFetch or surface the error.
 */
// playwright-extra/puppeteer-extra-plugin-stealth are NOT listed in package.json.
// They are loaded on first getBrowser() call so this module can be safely
// imported without those packages installed (they're only needed when
// BROWSER_FETCH_ENABLED=1 and a browser function is actually invoked).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any; type BrowserContext = any; type Page = any;
let _chromium: any = null;
function loadChromium(): any {
  if (!_chromium) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _chromium = require('playwright-extra').chromium;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _chromium.use(require('puppeteer-extra-plugin-stealth')());
  }
  return _chromium;
}
import { randomUUID } from "crypto";
import { getProxyUrlForAccount, getProxyGeoForAccount } from "./db";
import { solveCaptchaForToken } from "./captcha";

// Map a proxy geo tag (e.g. "US-CA", "GB", "Webshare DE #2") to a plausible
// IANA timezone + locale so the browser fingerprint matches the residential
// exit IP. hCaptcha/Discord score IP-geo vs browser timezone/locale mismatch;
// a US residential IP reporting UTC is a cheap tell. Falls back to a US East
// profile (never UTC) when geo is unknown.
function deriveBrowserGeo(geo: string | null | undefined): { timezoneId: string; locale: string } {
  const g = (geo || "").toUpperCase();
  const has = (...tokens: string[]) => tokens.some((t) => g.includes(t));
  // Non-US countries first (more specific).
  if (has("GB", "UK", "ENGLAND", "LONDON")) return { timezoneId: "Europe/London", locale: "en-GB" };
  if (has("DE", "GERMANY", "BERLIN", "FRANKFURT")) return { timezoneId: "Europe/Berlin", locale: "de-DE" };
  if (has("FR", "FRANCE", "PARIS")) return { timezoneId: "Europe/Paris", locale: "fr-FR" };
  if (has("NL", "NETHERLANDS", "AMSTERDAM")) return { timezoneId: "Europe/Amsterdam", locale: "nl-NL" };
  if (has("AU", "AUSTRALIA", "SYDNEY")) return { timezoneId: "Australia/Sydney", locale: "en-AU" };
  if (has("CA", "CANADA", "TORONTO")) return { timezoneId: "America/Toronto", locale: "en-CA" };
  // US regions → correct US timezone.
  if (has("US-CA", "US-WA", "US-OR", "SACRAMENTO", "SEATTLE", "PORTLAND", "LOS ANGELES")) return { timezoneId: "America/Los_Angeles", locale: "en-US" };
  if (has("US-TX", "US-IL", "DALLAS", "HOUSTON", "CHICAGO")) return { timezoneId: "America/Chicago", locale: "en-US" };
  if (has("US-CO", "US-AZ", "DENVER", "PHOENIX")) return { timezoneId: "America/Denver", locale: "en-US" };
  if (has("US", "USA", "NEW YORK", "MIAMI", "ATLANTA")) return { timezoneId: "America/New_York", locale: "en-US" };
  // Unknown — a plausible default that is NOT UTC.
  return { timezoneId: "America/New_York", locale: "en-US" };
}

const ENABLED = process.env.BROWSER_FETCH_ENABLED !== "0";
const DEFAULT_PROXY_URL = process.env.WEBSHARE_PROXY_URL || "";
const IDLE_CLOSE_MS = Number(process.env.IDLE_CLOSE_MS || String(10 * 60 * 1000)); // default 10 min; set lower (e.g. 180000) on memory-constrained VPS

// Hard cap on simultaneous open browser contexts. Each Chromium context uses
// ~200-300 MB on a 1 GB VPS — without this the FR campaign opens one per account
// simultaneously and OOMs the server. Queue callers until a slot is free.
// Default 3: leaves ~350 MB headroom for postgres + node + OS on a 1 GB box.
const MAX_CONCURRENT_CONTEXTS = Number(process.env.MAX_BROWSER_CONTEXTS || "3");
let activeContextCount = 0;
const contextQueue: Array<() => void> = [];

function acquireContextSlot(): Promise<void> {
  if (activeContextCount < MAX_CONCURRENT_CONTEXTS) {
    activeContextCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => contextQueue.push(resolve));
}

function releaseContextSlot(entry?: AccountContext): void {
  // Idempotent per-context. A stored context owns exactly one slot; guard
  // against the idle-close timer and a concurrent stale-detect BOTH releasing
  // the same context's slot, which would drift activeContextCount below real
  // usage and eventually let MAX_CONCURRENT_CONTEXTS be exceeded → OOM on a
  // small VPS (the exact failure the cap exists to prevent).
  if (entry) {
    if (!entry.slotHeld) return; // already released for this context
    entry.slotHeld = false;
  }
  const next = contextQueue.shift();
  if (next) {
    next(); // hand the slot to the next waiter
  } else if (activeContextCount > 0) {
    activeContextCount--;
  } else {
    // Assertion: a release with no waiter and a zero count means something
    // released twice. Don't throw — just refuse to go negative and flag it.
    console.warn("[browser] releaseContextSlot: activeContextCount already 0 — ignoring extra release");
  }
}
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Headed by default — we run inside an Xvfb display so the browser windows are
// visible via VNC (port 5900) / noVNC (port 6080). Set BROWSER_HEADLESS=1 to
// flip back to headless mode if running outside the VNC-equipped container.
const HEADLESS = process.env.BROWSER_HEADLESS === "1";
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // Detect a crashed/OOM-killed Chromium process and relaunch.
      if (typeof b.isConnected === "function" && !b.isConnected()) {
        console.warn("[browser] Chromium process disconnected — relaunching");
        browserPromise = null;
      } else {
        return b;
      }
    } catch {
      browserPromise = null;
    }
  }
  const launchPromise = loadChromium().launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      // Headed mode args — quieter rendering, no first-run wizard.
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,InterestFeedContentSuggestions",
      "--start-maximized",
    ],
  });
  browserPromise = launchPromise;
  console.log(`[browser] Chromium launched (headless=${HEADLESS})`);
  return launchPromise;
}

interface AccountContext {
  ctx: BrowserContext;
  page: Page;
  lastUsedMs: number;
  idleTimer: NodeJS.Timeout | null;
  superProperties: string; // captured from Discord's own outgoing requests
  slotHeld: boolean; // true while this context owns a concurrency slot
}

const accountContexts = new Map<string, AccountContext>();
// Per-account idle timer handles, so a replacement context for the same account
// can cancel the previous account's pending idle-close (prevents an orphan
// timer from closing a freshly-created, in-use context).
const idleTimers = new Map<string, NodeJS.Timeout>();

function parseProxyUrl(url: string):
  | { server: string; username?: string; password?: string }
  | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const server = `${u.protocol}//${u.host}`;
    if (u.username || u.password) {
      return {
        server,
        username: decodeURIComponent(u.username || ""),
        password: decodeURIComponent(u.password || ""),
      };
    }
    return { server };
  } catch {
    return undefined;
  }
}

async function createAccountContext(accountId: string, token: string): Promise<AccountContext> {
  const browser = await getBrowser();
  // Per-account proxy: each account should route through its own proxy IP so
  // Discord doesn't see multiple accounts sending FRs from the same address.
  // Fall back to the shared WEBSHARE_PROXY_URL if the account has no proxy assigned.
  const accountProxyUrl = await getProxyUrlForAccount(accountId).catch(() => null);
  const proxyUrl = accountProxyUrl || DEFAULT_PROXY_URL;
  if (proxyUrl) {
    let proxyHost = proxyUrl;
    try { proxyHost = new URL(proxyUrl).host; } catch {}
    console.log(`[browser] account=${accountId} context → proxy ${proxyHost}${accountProxyUrl ? "" : " (fallback shared)"}`);
  } else {
    console.warn(`[browser] account=${accountId} NO proxy assigned — browser using bare VPS IP`);
  }
  // Derive timezone/locale from the proxy's geo so the browser fingerprint
  // matches the exit IP (avoids the UTC-on-a-US-residential-IP captcha tell).
  const proxyGeo = await getProxyGeoForAccount(accountId).catch(() => null);
  const { timezoneId, locale } = deriveBrowserGeo(proxyGeo);
  console.log(`[browser] account=${accountId} geo=${proxyGeo || "unknown"} → tz=${timezoneId} locale=${locale}`);
  const ctx = await browser.newContext({
    userAgent: USER_AGENT,
    locale,
    timezoneId,
    // 1920x1080 keeps Discord's right-side member list visible by default;
    // at 1280 wide Discord auto-collapses the panel which breaks our tier-5
    // "find member in sidebar" path.
    viewport: { width: 1920, height: 1080 },
    proxy: parseProxyUrl(proxyUrl),
  });

  // Inject the user token BEFORE any discord.com page loads. Discord's SPA
  // reads localStorage.token during boot to skip the login screen.
  await ctx.addInitScript((tok: string) => {
    try {
      (window as any).localStorage.setItem("token", JSON.stringify(tok));
    } catch {
      /* localStorage may not be available on about:blank — Discord page itself works */
    }
  }, token);

  const page = await ctx.newPage();

  // Create entry before navigation so the request listener can populate
  // superProperties during the Discord SPA boot sequence.
  const entry: AccountContext = { ctx, page, lastUsedMs: Date.now(), idleTimer: null, superProperties: "", slotHeld: false };

  // Capture x-super-properties from every Discord request — Discord's own
  // client JS builds this from the real browser environment (OS, Chrome version,
  // build number). We reuse it verbatim so our eval-fetch calls look identical
  // to what the real client sends. Listener stays on for the context's lifetime.
  page.on("request", (req: any) => {
    try {
      const sp = req.headers()["x-super-properties"];
      if (sp) entry.superProperties = sp;
    } catch {}
  });

  // Navigate to the app shell so Discord's SPA boots, sets cookies, and fires
  // domcontentloaded completes as soon as the HTML is parsed — the SPA boots
  // shortly after and fires authenticated requests containing x-super-properties.
  // networkidle was too strict: Discord's SPA never fully quiesces through a proxy.
  await page.goto("https://discord.com/channels/@me", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  }).catch((err: any) => {
    console.warn(`[browser] account=${accountId} initial nav warning: ${err?.message || err}`);
  });

  // Poll up to 20s for the SPA to fire an authenticated request with x-super-properties.
  // 20s gives slow proxies time to complete Discord's boot sequence.
  const spDeadline = Date.now() + 20_000;
  while (!entry.superProperties && Date.now() < spDeadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (entry.superProperties) {
    console.log(`[browser] account=${accountId} context ready (superProps captured)`);
  } else {
    console.warn(`[browser] account=${accountId} context ready (superProps missing — SPA may not have booted)`);
  }

  scheduleIdleClose(accountId, entry);
  return entry;
}

// Solve captcha while keeping the browser context alive. The 3-min idle
// timer fires at almost exactly the same time as the solve (captcha takes
// 30-120s, context creation 45-65s → timer fires ~180s after creation =
// ~70-110s into the solve). A one-shot lastUsedMs update leaves only a
// millisecond of margin. The heartbeat fires every 30s so the timer always
// sees a very recent use and reschedules rather than closing.
async function solveCaptchaKeepAlive(
  entry: AccountContext,
  opts: Parameters<typeof solveCaptchaForToken>[0],
): ReturnType<typeof solveCaptchaForToken> {
  entry.lastUsedMs = Date.now();
  const hb = setInterval(() => { entry.lastUsedMs = Date.now(); }, 30_000);
  try {
    return await solveCaptchaForToken(opts);
  } finally {
    clearInterval(hb);
  }
}

function scheduleIdleClose(accountId: string, entry: AccountContext): void {
  // Cancel any pending timer for this account — both the one on this entry and
  // any lingering one keyed by account (e.g. from a since-replaced context).
  const prev = idleTimers.get(accountId);
  if (prev) clearTimeout(prev);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  const timer = setTimeout(async () => {
    idleTimers.delete(accountId);
    const cur = accountContexts.get(accountId);
    if (!cur) return;
    if (Date.now() - cur.lastUsedMs < IDLE_CLOSE_MS) {
      // Got used during the timer — reschedule.
      scheduleIdleClose(accountId, cur);
      return;
    }
    accountContexts.delete(accountId);
    try { await cur.ctx.close(); } catch {}
    releaseContextSlot(cur);
    console.log(`[browser] account=${accountId} idle-closed after ${IDLE_CLOSE_MS / 60000} min`);
  }, IDLE_CLOSE_MS);
  entry.idleTimer = timer;
  idleTimers.set(accountId, timer);
}

async function getOrCreateContext(accountId: string, token: string): Promise<AccountContext> {
  const existing = accountContexts.get(accountId);
  if (existing) {
    // Guard against the idle-close timer having just closed the page.
    const pageClosed = existing.page?.isClosed?.() ?? false;
    if (!pageClosed) {
      existing.lastUsedMs = Date.now();
      scheduleIdleClose(accountId, existing); // reset timer from NOW, not from last schedule
      return existing;
    }
    // Stale entry — remove and fall through to create a fresh context.
    accountContexts.delete(accountId);
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    releaseContextSlot(existing);
    console.log(`[browser] account=${accountId} stale context detected (page was closed) — recreating`);
  }
  // Wait for a free slot before spawning a new Chromium context.
  await acquireContextSlot();
  // Re-check after waiting — another caller may have created this context.
  const afterWait = accountContexts.get(accountId);
  if (afterWait) {
    releaseContextSlot(); // release the slot we just acquired (afterWait owns its own)
    afterWait.lastUsedMs = Date.now();
    scheduleIdleClose(accountId, afterWait);
    return afterWait;
  }
  try {
    const entry = await createAccountContext(accountId, token);
    // Reset lastUsedMs to NOW (after creation completes) so the 3-min idle
    // timer counts from when the context is actually ready, not from when
    // creation started (nav + superProps poll can take 30-60s themselves).
    entry.lastUsedMs = Date.now();
    entry.slotHeld = true; // this context now owns the slot acquired above
    accountContexts.set(accountId, entry);
    return entry;
  } catch (err) {
    releaseContextSlot(); // creation failed — free the slot we acquired
    throw err;
  }
}

export interface BrowserFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface BrowserFetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<any>;
}

/**
 * Run a fetch inside the per-account Chromium page. Caller passes account id
 * + token so we can lazy-init the context. The actual HTTP call is the
 * browser's native fetch, so Discord sees its own cookies, ServiceWorker, and
 * fingerprint headers — exactly what the SPA would send.
 */
export async function browserFetch(
  accountId: string,
  token: string,
  url: string,
  opts: BrowserFetchOptions = {},
): Promise<BrowserFetchResponse> {
  if (!ENABLED) {
    throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  }
  const { page } = await getOrCreateContext(accountId, token);

  const evalResult = await page.evaluate(
    async (args: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), args.timeoutMs);
      try {
        const r = await fetch(args.url, {
          method: args.method || "GET",
          headers: args.headers || {},
          body: args.body ?? undefined,
          credentials: "include",
          signal: ac.signal,
        });
        const text = await r.text();
        const headerObj: Record<string, string> = {};
        r.headers.forEach((v: string, k: string) => { headerObj[k.toLowerCase()] = v; });
        return { status: r.status, headers: headerObj, text };
      } finally {
        clearTimeout(timer);
      }
    },
    {
      url,
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs ?? 20_000,
    },
  );

  const { status, headers, text } = evalResult;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/**
 * Best-effort dismiss any Discord promo/upsell modal that's covering the chat.
 * Discord shows these aggressively (Nitro promos, "What's new" splash, gift
 * banners) and they intercept pointer events so the editor underneath becomes
 * unreachable. Strategy: press Escape twice with a delay, then look for any
 * dialog-shaped overlay with a close button and click it.
 *
 * No-op when no modal is open. Never throws — we always fall through to the
 * editor search regardless of whether dismissal succeeded.
 */
// Inclusive-min, exclusive-max random integer.
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

// Type text with human-variance cadence: 15–80ms between keys, plus an
// occasional 120–300ms "hesitation" every 4–8 characters. A flat 25ms-per-key
// rhythm is a trivial automation fingerprint; this scatters the keystroke
// timing the way a real typist does.
async function humanType(page: Page, text: string): Promise<void> {
  let sinceLastPause = 0;
  let pauseEvery = randInt(4, 9);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(randInt(15, 81));
    if (++sinceLastPause >= pauseEvery) {
      await page.waitForTimeout(randInt(120, 301));
      sinceLastPause = 0;
      pauseEvery = randInt(4, 9);
    }
  }
}

async function dismissPromoModals(page: Page, accountId: string): Promise<void> {
  try {
    // Don't bother if the editor is already visible (no modal blocking).
    const fastEditor = await page.$('[contenteditable="true"][role="textbox"]');
    if (fastEditor) return;

    // Only press Escape when a true modal/dialog overlay is visible.
    // [class*="layerContainer"] is Discord's generic SPA layer system (used in
    // the main channel view too) — matching it presses Escape on the DM view
    // itself, closing it even though no promo modal is present.
    const hasModal = await page.$('[role="dialog"][aria-modal="true"], [aria-modal="true"][role="alertdialog"]').catch(() => null);
    if (hasModal) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }

    // Try to click an explicit close button on any visible dialog. Discord uses
    // a few different markup shapes across its modals — match all of them.
    const closeSelectors = [
      '[role="dialog"] [aria-label="Close" i]',
      '[role="dialog"] button[aria-label*="Close" i]',
      '[role="dialog"] button[aria-label*="dismiss" i]',
      '[class*="modal" i] [aria-label="Close" i]',
      // Nitro promo specifically uses a "No thanks" / "Maybe later" footer link.
      '[role="dialog"] button:has-text("No thanks")',
      '[role="dialog"] button:has-text("Maybe later")',
      '[role="dialog"] button:has-text("Not now")',
    ];
    for (const sel of closeSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await el.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        console.log(`[browser] account=${accountId} dismissed modal via selector: ${sel}`);
        break;
      }
    }
  } catch (e: any) {
    // Silent — modal dismissal is best-effort; the editor search will report
    // the real problem if we couldn't clear the overlay.
    console.warn(`[browser] account=${accountId} dismissPromoModals warning: ${e?.message || e}`);
  }
}

/**
 * Send a DM by *driving Discord's UI* — navigates to the channel, types the
 * message into the slate editor, presses Enter, then waits for the underlying
 * POST /messages response.
 *
 * Why drive the UI (vs. eval-fetch in browserFetch): when Discord's anti-spam
 * captcha-walls a stranger-DM send, the official client's React state machine
 * renders an hCaptcha modal so the user can solve it. eval-fetch never triggers
 * that React path — Discord's server replies 400 but our page never sees a
 * captcha widget. Typing into the real input box DOES trigger the modal.
 *
 * Behavior on captcha:
 *   - The first POST /messages response comes back 400 with captcha-required.
 *   - Discord's React opens the hCaptcha modal in the visible Chromium window.
 *   - We DO NOT resolve yet — we publish a `captcha_required` SSE event so the
 *     operator's UI can pop the noVNC viewer.
 *   - Operator clicks through the captcha in noVNC.
 *   - Discord automatically retries the POST with captcha_key set.
 *   - We catch the second response (2xx or terminal 4xx) and resolve.
 *
 * Up to 5 minutes total wait for the operator to solve. After that we resolve
 * with status 0 ("captcha solve timeout") so the engine's panic-pause fires
 * and we don't sit forever on a stuck modal.
 */
export async function browserSendDmViaUi(
  accountId: string,
  token: string,
  channelId: string,
  messageBody: string,
  onCaptchaRequired?: () => void,
  recipientDiscordUserId?: string,
  recipientDisplayName?: string,
  originGuildId?: string,
): Promise<BrowserFetchResponse> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const entry = await getOrCreateContext(accountId, token);
  const { page } = entry;

  // ───── Set up the response listener BEFORE any UI action ─────────────────
  // We want to capture the eventual POST /channels/:id/messages response, NOT
  // intermediate 400/captcha-required ones. A simple state machine:
  //   - first non-captcha response → resolve
  //   - captcha-required → keep waiting + fire callback (human) or auto-solve (autonomous)
  let resolved = false;
  let captchaFired = false;
  // Hoisted so non-resolve exit paths (Tier 6 eval-fetch, a thrown UI step) can
  // detach the listener too — otherwise each failed send leaves a "response"
  // handler bound to the warm page for the context's lifetime (memory growth +
  // stray captcha solves firing on later sends).
  let respHandler: ((resp: any) => Promise<void>) | null = null;
  const detachResponseHandler = () => { if (respHandler) { page.off("response", respHandler); respHandler = null; } };
  const responsePromise = new Promise<{ status: number; text: string }>((resolve) => {
    const handler = async (resp: any) => {
      if (resolved) return;
      try {
        const url = resp.url();
        const req = resp.request();
        if (req.method() !== "POST") return;
        if (!url.endsWith(`/channels/${channelId}/messages`)) return;
        const status = resp.status();
        const text = await resp.text().catch(() => "");
        if (status === 400 && text.toLowerCase().includes("captcha-required")) {
          if (!captchaFired) {
            captchaFired = true;
            if (onCaptchaRequired) {
              console.log(`[browser] account=${accountId} captcha-required on /messages — awaiting human solve via noVNC`);
              try { onCaptchaRequired(); } catch { /* noop */ }
            } else {
              console.log(`[browser] account=${accountId} captcha-required on /messages — auto-solving via 2captcha`);
              let parsedCaptcha: any = null;
              try { parsedCaptcha = JSON.parse(text); } catch { /* noop */ }
              if (parsedCaptcha?.captcha_sitekey) {
                const contextObj = originGuildId
                  ? { location: "Direct Message", location_guild_id: originGuildId }
                  : { location: "Direct Message" };
                const contextProps = Buffer.from(JSON.stringify(contextObj)).toString("base64");
                const cs = await solveCaptchaKeepAlive(entry, {
                  sitekey: String(parsedCaptcha.captcha_sitekey),
                  pageUrl: "https://discord.com/channels/@me",
                  rqdata: parsedCaptcha.captcha_rqdata || undefined,
                  rqtoken: parsedCaptcha.captcha_rqtoken || undefined,
                  accountId,
                });
                if (cs.ok && cs.token) {
                  console.log(`[browser] account=${accountId} UI-send captcha solved — retrying POST /messages in-browser`);
                  const retryUrl = `https://discord.com/api/v9/channels/${encodeURIComponent(channelId)}/messages`;
                  const captchaKey = cs.token;
                  const captchaRqtoken = String(parsedCaptcha.captcha_rqtoken || "");
                  const sp = entry.superProperties;
                  try {
                    const retryResult = await page.evaluate(
                      async (args: { url: string; tok: string; content: string; nonce: string; ctxProps: string; sp: string; ck: string; rqtok: string }) => {
                        try {
                          const hdrs: Record<string, string> = {
                            "content-type": "application/json",
                            "authorization": args.tok,
                            "x-context-properties": args.ctxProps,
                            "x-discord-locale": "en-US",
                            "x-debug-options": "bugReporterEnabled",
                          };
                          if (args.sp) hdrs["x-super-properties"] = args.sp;
                          const bd: any = { content: args.content, nonce: args.nonce, flags: 0, captcha_key: args.ck };
                          if (args.rqtok) bd.captcha_rqtoken = args.rqtok;
                          const r = await fetch(args.url, { method: "POST", headers: hdrs, body: JSON.stringify(bd), credentials: "include", signal: AbortSignal.timeout(20_000) });
                          const t = await r.text().catch(() => "");
                          return { status: r.status, text: t };
                        } catch (e: any) {
                          return { status: 0, text: String(e?.message || e) };
                        }
                      },
                      { url: retryUrl, tok: token, content: messageBody, nonce: randomUUID(), ctxProps: contextProps, sp: sp || "", ck: captchaKey, rqtok: captchaRqtoken },
                    );
                    if (!resolved) { resolved = true; page.off("response", handler); resolve(retryResult); }
                  } catch (retryErr: any) {
                    console.warn(`[browser] account=${accountId} UI-send captcha retry threw: ${retryErr?.message || retryErr}`);
                    if (!resolved) { resolved = true; page.off("response", handler); resolve({ status: 0, text: String(retryErr?.message || retryErr) }); }
                  }
                } else {
                  console.warn(`[browser] account=${accountId} UI-send captcha auto-solve failed: ${cs.error}`);
                  if (!resolved) { resolved = true; page.off("response", handler); resolve({ status: 400, text }); }
                }
              } else {
                console.warn(`[browser] account=${accountId} UI-send captcha response missing sitekey`);
                if (!resolved) { resolved = true; page.off("response", handler); resolve({ status: 400, text }); }
              }
            }
          }
          return; // keep listening (human solve path) or auto-solve in-flight
        }
        // Terminal response.
        resolved = true;
        page.off("response", handler);
        resolve({ status, text });
      } catch (err: any) {
        console.warn(`[browser] response handler error: ${err?.message || err}`);
      }
    };
    respHandler = handler;
    page.on("response", handler);
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      detachResponseHandler();
      resolve({
        status: 0,
        text: captchaFired
          ? "captcha solve timed out (5 min)"
          : "no /messages response within 5 min",
      });
    }, 5 * 60_000);
  });

  // ───── Drive the UI ─────────────────────────────────────────────────────
  // Discord's SPA does client-side routing AFTER load. Hitting a direct URL
  // for a channel that has zero message history (e.g. a freshly-clicked DM
  // with just a "Wave to X" placeholder) renders the Friends tab even though
  // the URL bar shows the target path. URL-equality is not a reliable signal
  // for "did the channel actually render" — we must check the DOM.
  //
  // Strategy:
  //   1. Navigate to the channel URL, wait briefly for the SPA.
  //   2. Try to find the editor with a short timeout. Found → proceed.
  //   3. Not found → look for the DM in the sidebar by href and click it.
  //      This triggers Discord's own CHANNEL_SELECT which renders the editor
  //      even for empty channels.
  //   4. Try the editor again with a longer timeout. Still not found → throw
  //      with a diagnostic snapshot.
  let targetPath = `/channels/@me/${channelId}`;

  if (page.url().includes(targetPath)) {
    // Already on the right DM page — let React settle.
    await page.waitForTimeout(500);
  } else if (recipientDiscordUserId) {
    // Phase 0: open DM via in-page POST so CHANNEL_CREATE fires into the live WS.
    //
    // Critical ordering:
    //   1. Land on /channels/@me first. That page always renders and its READY
    //      event carries the full DM list. A brand-new (empty) DM is NOT included
    //      in READY, but CHANNEL_CREATE from our POST will add it to the sidebar
    //      in real-time while the WS connection is stable.
    //   2. Do the in-page POST — Discord delivers CHANNEL_CREATE to the same WS.
    //   3. Wait for the sidebar link, click it (in-page SPA nav, WS stays alive).
    //
    // Skipping step 1 and using page.goto('/channels/@me/{id}') directly fails
    // because Discord's READY omits empty DMs → router bounces to /channels/@me.
    const isOnDmList = page.url().includes("/channels/@me");
    if (!isOnDmList) {
      console.log(`[browser] account=${accountId} navigating to @me DM list before in-page POST`);
      await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch((e: any) => {
        console.warn(`[browser] account=${accountId} goto @me failed: ${e?.message || e}`);
      });
      await page.waitForTimeout(2000);
    }

    const dmOpenResult = await page.evaluate(async (args: { userId: string; token: string }) => {
      try {
        const r = await fetch("/api/v9/users/@me/channels", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: args.token },
          body: JSON.stringify({ recipients: [args.userId] }),
          credentials: "include",
        });
        const text = await r.text().catch(() => "");
        if (!r.ok) return { id: null as string | null, status: r.status, err: text.slice(0, 120) };
        const d = JSON.parse(text) as any;
        return { id: (d?.id as string) || null, status: r.status, err: "" };
      } catch (e: any) { return { id: null as string | null, status: 0, err: String(e?.message || e) }; }
    }, { userId: recipientDiscordUserId, token });

    const freshChannelId = dmOpenResult.id;
    if (!freshChannelId) {
      console.warn(`[browser] account=${accountId} Phase-0 POST failed status=${dmOpenResult.status} ${dmOpenResult.err} — goto DM directly`);
      await page.goto(`https://discord.com${targetPath}`, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      targetPath = `/channels/@me/${freshChannelId}`;
      console.log(`[browser] account=${accountId} Phase-0 DM open → id=${freshChannelId}, waiting for sidebar`);
      await page.waitForTimeout(3000); // let React process CHANNEL_CREATE
      const sidebarLink = `a[href="/channels/@me/${freshChannelId}"]`;
      try {
        await page.waitForSelector(sidebarLink, { timeout: 10_000 });
        await page.click(sidebarLink);
        console.log(`[browser] account=${accountId} Phase-0 sidebar clicked → DM open`);
        // Wait for Discord's SPA to finish navigating to the DM channel before
        // searching for the editor. A fixed 1s was too short — React needs to
        // unmount the Friends view and mount the DM channel + Slate editor.
        // waitForURL returns as soon as the URL settles, then 500ms for rendering.
        await page.waitForURL(`**${targetPath}`, { timeout: 6_000 }).catch(() => {});
        await page.waitForTimeout(1500);
      } catch {
        console.warn(`[browser] account=${accountId} Phase-0 sidebar not found — goto DM directly`);
        await page.goto(`https://discord.com${targetPath}`, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
  } else {
    // No recipientDiscordUserId — goto directly (no in-page POST possible).
    await page.goto(`https://discord.com${targetPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e: any) => {
      console.warn(`[browser] account=${accountId} nav to ${targetPath} warning: ${e?.message || e}`);
    });
    await page.waitForTimeout(2000);
  }

  // Tier 0: dismiss any Discord-injected promo/upsell modal that's covering
  // the chat. The Nitro / "ORBS" promo overlay and the "What's new" changelog
  // both intercept all pointer events, so the editor selector matches an
  // element that isn't clickable — every subsequent tier then fails with a
  // 30s timeout. Cheap to attempt, no-op when no modal is present.
  await dismissPromoModals(page, accountId);

  // Discord's slate editor selector has changed several times. We try each in
  // priority order; whichever matches first wins. The `aria-label^="Message "`
  // pattern is the most stable signal because Discord ALWAYS sets it on the
  // chat input (e.g. "Message @Dans", "Message #general") regardless of
  // whether the DM is empty / first-time / active.
  const editorCandidates = [
    'div[role="textbox"][contenteditable="true"][data-slate-editor]',
    '[aria-label^="Message "][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-slate-node="value"]',
    '[class*="slateTextArea"] [contenteditable="true"]',
  ];
  const findEditor = async (timeoutMs: number): Promise<string | null> => {
    // Race all candidate selectors in parallel — first one to resolve wins.
    const start = Date.now();
    const tasks = editorCandidates.map(async (sel) => {
      try {
        await page.waitForSelector(sel, { timeout: Math.max(500, timeoutMs - (Date.now() - start)) });
        return sel;
      } catch { return null; }
    });
    const results = await Promise.all(tasks);
    return results.find((s) => s) || null;
  };

  let editorFoundSel = await findEditor(10_000);

  if (!editorFoundSel) {
    // Tier 1b: hard reload. When the Chromium has been kept warm across many
    // pages, its in-memory React state may not know about DMs that were
    // created by our backend AFTER the Chromium connected. A reload makes
    // Discord re-fetch /users/@me/channels which includes the new DM. Then
    // the URL nav will actually render.
    console.warn(`[browser] account=${accountId} editor missing — reloading and re-navigating`);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(2000);
      if (!page.url().includes(targetPath)) {
        await page.goto(`https://discord.com${targetPath}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      editorFoundSel = await findEditor(10_000);
    } catch (e: any) {
      console.warn(`[browser] account=${accountId} reload path failed: ${e?.message || e}`);
    }
  }

  if (!editorFoundSel) {
    // Tier 2: sidebar click. After the reload, the DM should appear in the sidebar.
    console.warn(`[browser] account=${accountId} channel still didn't render — falling back to sidebar click`);
    const sidebarLink = `a[href="/channels/@me/${channelId}"]`;
    try {
      await page.waitForSelector(sidebarLink, { timeout: 5_000 });
      await page.click(sidebarLink);
      console.log(`[browser] account=${accountId} clicked sidebar entry for channel=${channelId}`);
      await page.waitForTimeout(1500);
      editorFoundSel = await findEditor(15_000);
    } catch (e: any) {
      console.warn(`[browser] account=${accountId} sidebar click path failed: ${e?.message || e}`);
    }
  }

  if (!editorFoundSel && recipientDisplayName) {
    // Tier 3: Cmd+K quick switcher. Discord's "Where would you like to go"
    // search indexes ALL channels (even ones not visible in the sidebar) and
    // is the official way to "find or start a conversation". Press Ctrl+K,
    // type the recipient's display name, hit Enter on the first result.
    console.warn(`[browser] account=${accountId} sidebar failed — opening Cmd+K quick switcher for "${recipientDisplayName}"`);
    try {
      await page.keyboard.press("Control+k");
      const switcherInput = 'input[placeholder*="Where would you like"], input[aria-label*="Quick switcher"]';
      await page.waitForSelector(switcherInput, { timeout: 5_000 });
      // Clear any pre-filled text first.
      await page.fill(switcherInput, recipientDisplayName);
      await page.waitForTimeout(1200); // let Discord debounce + populate results
      await page.keyboard.press("Enter");
      editorFoundSel = await findEditor(15_000);
    } catch (e: any) {
      console.warn(`[browser] account=${accountId} quick switcher path failed: ${e?.message || e}`);
    }
    // Close any lingering modal Cmd+K opened.
    try { await page.keyboard.press("Escape"); } catch { /* noop */ }
  }

  if (!editorFoundSel && originGuildId && (recipientDiscordUserId || recipientDisplayName)) {
    // Tier 4 (heavy): drive Discord like a real user. Navigate to the server,
    // ensure the right-side member panel is open, call Discord's own member-
    // search API from inside the Chromium so the user gets loaded into React
    // state, then scroll the member list and click them → profile → "Send
    // Message" → DM opens.
    console.warn(`[browser] account=${accountId} cmd-k failed — driving server ${originGuildId} member list for ${recipientDisplayName || recipientDiscordUserId}`);
    try {
      await page.goto(`https://discord.com/channels/${originGuildId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(3000);

      // 4a) Force-open the member list panel if Discord auto-hid it.
      try {
        const showPanelBtn = '[aria-label="Show Member List"]';
        const btn = await page.$(showPanelBtn);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(500);
          console.log(`[browser] account=${accountId} clicked Show Member List`);
        }
      } catch { /* already visible */ }

      // 4b) Hit Discord's own member-search endpoint from INSIDE the Chromium.
      // This triggers Discord's React store to load the user, after which they
      // appear in the right-side member list (even if they were offline /
      // unrendered before). Critically: the response includes the user's data
      // which Discord's WebSocket handler stitches into the guild's member map.
      if (recipientDisplayName) {
        try {
          await page.evaluate(async (args: { guildId: string; query: string }) => {
            const tok = (window as any).localStorage?.token;
            const auth = typeof tok === "string" ? tok.replace(/^"|"$/g, "") : "";
            await fetch(`/api/v9/guilds/${args.guildId}/members/search?query=${encodeURIComponent(args.query)}&limit=10`, {
              headers: auth ? { authorization: auth } : {},
              credentials: "include",
            });
          }, { guildId: originGuildId, query: recipientDisplayName });
          await page.waitForTimeout(800);
          console.log(`[browser] account=${accountId} called members/search?query=${recipientDisplayName}`);
        } catch (e: any) {
          console.warn(`[browser] account=${accountId} members/search failed: ${e?.message || e}`);
        }
      }

      // 4c) Try to find the member, scrolling the panel if not visible. With
      // the larger viewport + force-open + members/search prime, this should
      // hit much more often than before.
      const memberByName = recipientDisplayName
        ? `div[role="listitem"]:has-text("${recipientDisplayName.replace(/"/g, '\\"')}")`
        : null;
      const memberByUserId = recipientDiscordUserId
        ? `div[data-list-item-id*="${recipientDiscordUserId}"]`
        : null;
      const memberSelector = [memberByUserId, memberByName].filter(Boolean).join(", ");

      const memberListContainer = '[aria-label="Members"], [data-list-id="members"]';
      let found = false;
      // Bigger scroll loop than before: 100 attempts × 800px = up to 80k pixels.
      // Discord's lazy-load fires as the scroll hits unrendered ranges.
      for (let i = 0; i < 100; i++) {
        const elem = await page.$(memberSelector);
        if (elem) {
          await elem.scrollIntoViewIfNeeded().catch(() => {});
          await elem.click();
          found = true;
          console.log(`[browser] account=${accountId} found + clicked member after ${i} scrolls`);
          break;
        }
        await page.evaluate((sel: string) => {
          const list = document.querySelector(sel) as HTMLElement | null;
          if (list) list.scrollTop = (list.scrollTop || 0) + 800;
        }, memberListContainer);
        await page.waitForTimeout(250);
      }

      if (found) {
        await page.waitForTimeout(1200);
        const sendMsg = [
          'button[aria-label*="Send Message"]',
          'div[role="button"][aria-label*="Send Message"]',
          'button:has-text("Send Message")',
          'div[role="button"]:has-text("Send Message")',
          'button:has-text("Message")',
        ].join(", ");
        try {
          await page.waitForSelector(sendMsg, { timeout: 4000 });
          await page.click(sendMsg);
        } catch (e: any) {
          console.warn(`[browser] account=${accountId} send-message button not found: ${e?.message || e}`);
        }
        editorFoundSel = await findEditor(15_000);
      } else {
        console.warn(`[browser] account=${accountId} member ${recipientDisplayName || recipientDiscordUserId} not in guild=${originGuildId} member list after 100 scrolls`);
      }
    } catch (e: any) {
      console.warn(`[browser] account=${accountId} server-member path failed: ${e?.message || e}`);
    }
  }

  if (!editorFoundSel && recipientDiscordUserId) {
    // Tier 5: open the DM channel from inside the browser page.
    // POST /users/@me/channels fires a CHANNEL_CREATE event into the same
    // in-page WebSocket, so Discord's React receives it and adds the channel
    // to its store. Navigating to the channel URL then renders the editor.
    console.warn(`[browser] account=${accountId} member-list failed — re-opening DM via in-browser POST /channels for ${recipientDiscordUserId}`);
    try {
      const freshChannelId = await page.evaluate(async (args: { userId: string; token: string }) => {
        try {
          const r = await fetch("/api/v9/users/@me/channels", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: args.token },
            body: JSON.stringify({ recipients: [args.userId] }),
            credentials: "include",
            signal: AbortSignal.timeout(20_000),
          });
          if (!r.ok) return null;
          const d = await r.json() as any;
          return (d?.id as string) || null;
        } catch { return null; }
      }, { userId: recipientDiscordUserId, token });

      if (freshChannelId) {
        // Navigate to /channels/@me first so the DM sidebar is rendered,
        // then CHANNEL_CREATE from our POST will add the new DM to the list.
        if (!page.url().includes("/channels/@me")) {
          await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }
        await page.waitForTimeout(1500); // let React process CHANNEL_CREATE
        const freshSidebar = `a[href="/channels/@me/${freshChannelId}"]`;
        let sidebarClicked = false;
        try {
          await page.waitForSelector(freshSidebar, { timeout: 10_000 });
          await page.click(freshSidebar);
          console.log(`[browser] account=${accountId} Tier 5 sidebar clicked for channel=${freshChannelId}`);
          await page.waitForTimeout(1000);
          sidebarClicked = true;
        } catch { /* sidebar still didn't appear — fall through to goto */ }
        if (!sidebarClicked) {
          const freshPath = `/channels/@me/${freshChannelId}`;
          await page.goto(`https://discord.com${freshPath}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }
        await dismissPromoModals(page, accountId);
        editorFoundSel = await findEditor(10_000);
        if (editorFoundSel) console.log(`[browser] account=${accountId} Tier 5 (in-browser DM open) found editor`);
      }
    } catch (e: any) {
      console.warn(`[browser] account=${accountId} Tier 5 failed: ${e?.message || e}`);
    }
  }

  if (!editorFoundSel) {
    // ── Tier 6: eval-fetch ───────────────────────────────────────────────────
    // All UI tiers failed (editor selectors didn't match in time, or Discord
    // didn't render the editor at all). POST the message directly from the
    // browser's JS context — identical cookies + TLS session to what Discord's
    // own React does when you press Enter. Bypasses the DOM editor entirely.
    //
    // CRITICAL: POST to the channelId the caller asked for — NOT whatever the
    // SPA URL currently shows. During the failed UI tiers Discord may have
    // bounced the router to /channels/@me or a *different* DM; reading the
    // channel id from page.url() there would deliver this message to the wrong
    // recipient. The function's channelId param is the only trustworthy target.
    const urlChannelId = channelId;
    console.log(`[browser] account=${accountId} Tier 6 eval-fetch → channel=${urlChannelId}`);
    resolved = true; // stop the responsePromise 5-min timeout from interfering
    detachResponseHandler(); // we're answering via eval-fetch — drop the listener so it doesn't leak
    try {
      const t6 = await page.evaluate(
        async (args: { url: string; tok: string; body: string; sp: string }) => {
          try {
            const r = await fetch(args.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: args.tok,
                "x-discord-locale": "en-US",
                ...(args.sp ? { "x-super-properties": args.sp } : {}),
              },
              body: args.body,
              credentials: "include",
            });
            const t = await r.text().catch(() => "");
            return { status: r.status, ok: r.ok, text: t };
          } catch (e: any) {
            return { status: 0, ok: false, text: String(e?.message ?? e) };
          }
        },
        {
          url: `https://discord.com/api/v9/channels/${urlChannelId}/messages`,
          tok: token,
          body: JSON.stringify({ content: messageBody, nonce: randomUUID(), flags: 0 }),
          sp: entry.superProperties || "",
        },
      );
      console.log(`[browser] account=${accountId} Tier 6 eval-fetch status=${t6.status}`);
      return {
        status: t6.status,
        ok: t6.ok,
        headers: {} as Record<string, string>,
        text: async () => t6.text,
        json: async () => JSON.parse(t6.text),
      };
    } catch (t6err: any) {
      console.warn(`[browser] account=${accountId} Tier 6 eval-fetch threw: ${t6err?.message || t6err}`);
      throw new Error(`editor not found and eval-fetch failed on ${page.url()}: ${t6err?.message || t6err}`);
    }
  }

  // Focus + small settle delay + type. The slate editor sometimes ignores
  // typed input if we hit it the same frame it mounts.
  try {
    await page.click(editorFoundSel).catch(() => { /* surface via type below */ });
    await page.focus(editorFoundSel).catch(() => {});
    await page.waitForTimeout(randInt(300, 701)); // settle (was a flat 400ms)
    // Multi-line messages: each `\n` must become Shift+Enter (Discord's hotkey
    // for "newline within draft"). Plain Enter SUBMITS the current draft, which
    // turns one multi-line message into N separate sends — visually coalesced
    // by Discord's recipient client, but our gateway still sees N MESSAGE_CREATE
    // events so the unibox renders N bubbles. Iterate per-line.
    const lines = messageBody.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) await humanType(page, lines[i]);
      if (i < lines.length - 1) {
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
      }
    }
    await page.waitForTimeout(randInt(150, 351)); // pre-send pause (was a flat 200ms)
    await page.keyboard.press("Enter");
  } catch (typeErr) {
    // A thrown UI step would otherwise leave the response listener attached.
    detachResponseHandler();
    throw typeErr;
  }

  return responsePromise.then(({ status, text }) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {} as Record<string, string>,
    text: async () => text,
    json: async () => JSON.parse(text),
  }));
}

/** Manually drop an account's context (e.g. on token revocation). */
/**
 * Browser-driven wave: navigates the per-account Chromium to the freshly-
 * opened DM channel and clicks Discord's native "Wave to X" button. Discord's
 * React handles the captcha modal natively when anti-spam triggers — we
 * publish the captcha_required SSE so the operator sees the noVNC iframe and
 * can solve it in our app. After solve, Discord automatically retries the
 * wave and our response listener catches the success.
 *
 * Used as the captcha-fallback path when the tlsFetch-based server-side wave
 * (which can't surface the captcha to the operator) returns captcha-required.
 */
export async function browserWaveToUser(
  accountId: string,
  token: string,
  channelId: string,
  recipientDisplayName: string | undefined,
  onCaptchaRequired?: () => void,
): Promise<BrowserFetchResponse> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const { page } = await getOrCreateContext(accountId, token);

  // Response listener — Discord's wave button POSTs to /channels/<id>/messages
  // with sticker_ids. We watch for that response. captcha-required keeps us
  // waiting; terminal 2xx/4xx resolves.
  let resolved = false;
  let captchaFired = false;
  const responsePromise = new Promise<{ status: number; text: string }>((resolve) => {
    const handler = async (resp: any) => {
      if (resolved) return;
      try {
        const url = resp.url();
        if (resp.request().method() !== "POST") return;
        if (!url.endsWith(`/channels/${channelId}/messages`)) return;
        const status = resp.status();
        const text = await resp.text().catch(() => "");
        if (status === 400 && text.toLowerCase().includes("captcha-required")) {
          if (!captchaFired) {
            captchaFired = true;
            console.log(`[browser] account=${accountId} wave→captcha-required, waiting for human solve via noVNC`);
            try { onCaptchaRequired?.(); } catch {}
          }
          return;
        }
        resolved = true;
        page.off("response", handler);
        resolve({ status, text });
      } catch (err: any) {
        console.warn(`[browser] wave handler error: ${err?.message || err}`);
      }
    };
    page.on("response", handler);
    // 5-minute total wait (gives operator time to spot + solve the captcha).
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      page.off("response", handler);
      resolve({
        status: 0,
        text: captchaFired ? "captcha solve timed out (5 min)" : "no /messages response within 5 min",
      });
    }, 5 * 60_000);
  });

  // Drive the UI: navigate to the channel and find the Wave button.
  const targetPath = `/channels/@me/${channelId}`;
  await page.goto(`https://discord.com${targetPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Discord's "Wave to <name>" button. Several selector patterns:
  //   - button[aria-label*="Wave to"]
  //   - button:has-text("Wave to <name>")
  //   - section with profile + a single primary button
  const waveSelectors = [
    'button[aria-label^="Wave to"]',
    recipientDisplayName ? `button:has-text("Wave to ${recipientDisplayName.replace(/"/g, '\\"')}")` : "",
    'div[role="button"][aria-label^="Wave to"]',
    'button:has-text("Wave to ")',
  ].filter(Boolean);
  const waveBtnSelector = waveSelectors.join(", ");

  let clicked = false;
  for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
    try {
      await page.waitForSelector(waveBtnSelector, { timeout: attempt === 0 ? 10_000 : 4_000 });
      await page.click(waveBtnSelector);
      clicked = true;
      console.log(`[browser] account=${accountId} clicked Wave button for channel=${channelId}`);
    } catch (e: any) {
      // The Wave button is only shown for empty DM channels. If the channel
      // already has a message, the button is gone and we'd send via the editor
      // instead. In that case, escalate to the regular DM editor flow.
      console.warn(`[browser] account=${accountId} Wave button not found (attempt ${attempt + 1}/3): ${e?.message || e}`);
      if (attempt === 0) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
  }

  if (!clicked) {
    const visibleText = await page.evaluate(() => {
      try { return (document.body?.innerText || "").slice(0, 300); } catch { return ""; }
    }).catch(() => "");
    throw new Error(`Wave button not found on ${page.url()}. Visible: ${visibleText.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  return responsePromise.then(({ status, text }) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {} as Record<string, string>,
    text: async () => text,
    json: async () => JSON.parse(text),
  }));
}

export async function browserResolveUsername(
  accountId: string,
  token: string,
  targetUserId: string,
): Promise<string | null> {
  if (!ENABLED) return null;
  try {
    const { page } = await getOrCreateContext(accountId, token);
    // Navigate to Discord so the browser session is active and cookies are live.
    await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    const result = await page.evaluate(
      async (args: { userId: string }) => {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 8000);
          const r = await fetch(`https://discord.com/api/v9/users/${args.userId}`, {
            headers: { "content-type": "application/json" },
            credentials: "include",
            signal: controller.signal,
          });
          clearTimeout(tid);
          if (!r.ok) return null;
          const j = await r.json() as { username?: string };
          return j.username ?? null;
        } catch { return null; }
      },
      { userId: targetUserId },
    );
    console.log(`[browser] resolveUsername account=${accountId} userId=${targetUserId} → ${result ?? "null"}`);
    return result ?? null;
  } catch (e: any) {
    console.warn(`[browser] resolveUsername account=${accountId} userId=${targetUserId}: ${e?.message}`);
    return null;
  }
}

export async function browserSendFriendRequest(
  accountId: string,
  token: string,
  targetUsername: string,
  onCaptchaRequired?: () => void,
): Promise<BrowserFetchResponse> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const entry = await getOrCreateContext(accountId, token);
  const { page } = entry;

  // Ensure browser is on discord.com so session cookies are live. If the proxy
  // can't load the full SPA (domcontentloaded timeout) we still proceed — the
  // eval-fetch below works as long as the proxy can reach Discord's API layer.
  // `acct_17_aad8` proved this: initial nav timed out yet openDmChannel→200.
  if (!page.url().includes("discord.com")) {
    await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e: any) => {
      console.warn(`[browser] account=${accountId} FR nav warning (continuing): ${e?.message?.split("\n")[0]}`);
    });
  }

  // POST /users/@me/relationships via eval-fetch inside the Chromium context.
  // This gives us real browser cookies + TLS fingerprint without needing the
  // SPA to fully render. Eliminates the UI-driving nav timeouts entirely.
  const doFetch = async (captchaKey?: string, captchaRqtoken?: string) =>
    page.evaluate(
      async (args: { username: string; token: string; sp: string; ck?: string; rqtok?: string }) => {
        try {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "authorization": args.token,
            "x-discord-locale": "en-US",
            "x-debug-options": "bugReporterEnabled",
            "x-context-properties": "eyJsb2NhdGlvbiI6IkFkZCBGcmllbmQifQ==",
          };
          if (args.sp) headers["x-super-properties"] = args.sp;
          const body: any = { username: args.username, discriminator: null };
          if (args.ck) {
            body.captcha_key = args.ck;
            if (args.rqtok) body.captcha_rqtoken = args.rqtok;
          }
          const r = await fetch("https://discord.com/api/v9/users/@me/relationships", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials: "include",
            signal: AbortSignal.timeout(20_000),
          });
          return { status: r.status, text: await r.text().catch(() => "") };
        } catch (e: any) {
          return { status: 0, text: String(e?.message || e) };
        }
      },
      { username: targetUsername, token, sp: entry.superProperties || "", ck: captchaKey, rqtok: captchaRqtoken },
    ).catch((e: any) => ({ status: 0, text: String(e?.message || e) }));

  const result = await doFetch();
  const alreadyFriends = result.status === 400 && result.text.includes('"code":80007');
  const ok = result.status === 200 || result.status === 204 || alreadyFriends;
  console.log(`[browser] account=${accountId} FR username=${targetUsername} status=${result.status} ok=${ok} text=${result.text.slice(0, 120)}`);

  if (!ok && result.status === 400 && result.text.toLowerCase().includes("captcha")) {
    let captchaBody: any = {};
    try { captchaBody = JSON.parse(result.text); } catch {}
    const sitekey = captchaBody.captcha_sitekey || "";
    const rqdata = captchaBody.captcha_rqdata || undefined;
    const rqtoken = captchaBody.captcha_rqtoken || undefined;
    console.log(`[browser] account=${accountId} FR captcha — sitekey=${sitekey.slice(0, 12)}`);

    if (sitekey) {
      // Keep context alive during the solve (2captcha takes 30-120s).
      const cs = await solveCaptchaKeepAlive(entry, { sitekey, pageUrl: "https://discord.com", rqdata, rqtoken, accountId });
      if (cs.ok && cs.token) {
        console.log(`[browser] account=${accountId} captcha solved by 2captcha — retrying FR`);
        const retryResult = await doFetch(cs.token, rqtoken || "");
        const retryOk = retryResult.status === 200 || retryResult.status === 204 || (retryResult.status === 400 && retryResult.text.includes('"code":80007'));
        console.log(`[browser] account=${accountId} FR captcha-retry status=${retryResult.status} ok=${retryOk}`);
        return { status: retryResult.status, ok: retryOk, headers: {}, text: async () => retryResult.text, json: async () => { try { return JSON.parse(retryResult.text); } catch { return {}; } } };
      }
      console.warn(`[browser] account=${accountId} 2captcha failed (${cs.error}) — surfacing captcha to operator`);
    }

    try { onCaptchaRequired?.(); } catch {}
    const payload = JSON.stringify({ captcha_required: true, captcha_sitekey: sitekey, captcha_rqdata: rqdata || null, captcha_rqtoken: rqtoken || null });
    return { status: 400, ok: false, headers: {}, text: async () => payload, json: async () => JSON.parse(payload) };
  }

  return {
    status: result.status,
    ok,
    headers: {},
    text: async () => result.text,
    json: async () => { try { return JSON.parse(result.text); } catch { return {}; } },
  };
}

/**
 * Open a DM channel through the browser session using guild context headers.
 * This makes the POST /users/@me/channels request look like it came from a
 * user clicking "Message" on someone's profile inside a shared server —
 * the most natural path, vs the raw API call which has no browser fingerprint.
 *
 * Returns the channel ID on success, same shape as the tlsFetch version in
 * warmup-campaign-engine so callers can swap the two transparently.
 */
export async function browserOpenDmChannel(
  accountId: string,
  token: string,
  recipientDiscordUserId: string,
  guildId?: string,
): Promise<{ ok: boolean; channelId?: string; token4004?: boolean; captchaChallenged?: boolean; privacyBlocked?: boolean; rateLimited?: boolean; retryAfterMs?: number; error?: string }> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const entry = await getOrCreateContext(accountId, token);
  const { page } = entry;

  const contextObj = guildId
    ? { location: "User Profile", location_guild_id: guildId }
    : { location: "Direct Message" };
  const contextProps = Buffer.from(JSON.stringify(contextObj)).toString("base64");

  let evalResult: { status: number; text: string };
  try {
    evalResult = await page.evaluate(
      async (args: { token: string; recipientId: string; contextProps: string; superProperties: string }) => {
        try {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "authorization": args.token,
            "x-context-properties": args.contextProps,
          };
          if (args.superProperties) headers["x-super-properties"] = args.superProperties;
          const r = await fetch("https://discord.com/api/v9/users/@me/channels", {
            method: "POST",
            headers,
            body: JSON.stringify({ recipients: [args.recipientId] }),
            credentials: "include",
            signal: AbortSignal.timeout(20_000),
          });
          const text = await r.text().catch(() => "");
          return { status: r.status, text };
        } catch (e: any) {
          return { status: 0, text: String(e?.message || e) };
        }
      },
      { token, recipientId: recipientDiscordUserId, contextProps, superProperties: entry.superProperties },
    );
  } catch (evalErr: any) {
    // Page/context/browser was closed (crash, OOM, idle-close race). Return
    // error so the caller can fall back to TLS instead of crashing the tick.
    console.warn(`[browser] account=${accountId} openDmChannel evaluate threw (page closed?): ${evalErr?.message || evalErr}`);
    return { ok: false, error: `browser page closed: ${evalErr?.message || evalErr}` };
  }

  console.log(
    `[browser] account=${accountId} openDmChannel status=${evalResult.status}` +
    ` guild=${guildId || "none"} superProps=${entry.superProperties ? "yes" : "no"}`,
  );

  if (evalResult.status === 401) return { ok: false, token4004: true, error: evalResult.text.slice(0, 200) };

  // Rate-limited — surface retry_after so the caller can back off instead of
  // hammering through the limit (a strong automated-abuse signal). Discord's
  // 429 body carries retry_after in seconds.
  if (evalResult.status === 429) {
    let retryAfterMs = 60_000;
    try { const j = JSON.parse(evalResult.text); if (j?.retry_after) retryAfterMs = Math.max(Number(j.retry_after) * 1000, 1000); } catch {}
    console.warn(`[browser] account=${accountId} channel-open 429 — retryAfter=${Math.round(retryAfterMs / 1000)}s`);
    return { ok: false, rateLimited: true, retryAfterMs, error: evalResult.text.slice(0, 200) };
  }

  if (evalResult.status >= 400 || !evalResult.status) {
    let parsed: any = {};
    try { parsed = JSON.parse(evalResult.text); } catch {}
    if (parsed?.captcha_sitekey) {
      console.log(`[browser] account=${accountId} channel-open captcha — solving via 2captcha`);
      const cs = await solveCaptchaKeepAlive(entry, {
        sitekey: String(parsed.captcha_sitekey),
        pageUrl: "https://discord.com/channels/@me",
        rqdata: parsed.captcha_rqdata || undefined,
        rqtoken: parsed.captcha_rqtoken || undefined,
        accountId,
      });
      if (cs.ok && cs.token) {
        const retryResult = await page.evaluate(
          async (args: { token: string; recipientId: string; contextProps: string; superProperties: string; captchaKey: string; captchaRqtoken: string }) => {
            try {
              const headers: Record<string, string> = {
                "content-type": "application/json",
                "authorization": args.token,
                "x-context-properties": args.contextProps,
              };
              if (args.superProperties) headers["x-super-properties"] = args.superProperties;
              const body: any = { recipients: [args.recipientId], captcha_key: args.captchaKey };
              if (args.captchaRqtoken) body.captcha_rqtoken = args.captchaRqtoken;
              const r = await fetch("https://discord.com/api/v9/users/@me/channels", {
                method: "POST", headers, body: JSON.stringify(body), credentials: "include",
                signal: AbortSignal.timeout(20_000),
              });
              const text = await r.text().catch(() => "");
              return { status: r.status, text };
            } catch (e: any) { return { status: 0, text: String(e?.message || e) }; }
          },
          { token, recipientId: recipientDiscordUserId, contextProps, superProperties: entry.superProperties,
            captchaKey: cs.token, captchaRqtoken: String(parsed.captcha_rqtoken || "") },
        ).catch(() => ({ status: 0, text: "eval threw" }));
        if (retryResult.status >= 200 && retryResult.status < 300) {
          try {
            const j = JSON.parse(retryResult.text);
            console.log(`[browser] account=${accountId} channel-open captcha solved — channelId=${j.id}`);
            return { ok: true, channelId: String(j.id) };
          } catch {}
        }
        console.warn(`[browser] account=${accountId} channel-open captcha retry failed http=${retryResult.status}`);
      } else {
        console.warn(`[browser] account=${accountId} channel-open captcha unsolvable: ${cs.error}`);
      }
      return { ok: false, captchaChallenged: true, error: "captcha on channel-open" };
    }
    if (parsed?.code === 50009 || /50009|cannot send messages/i.test(evalResult.text)) {
      return { ok: false, privacyBlocked: true, error: evalResult.text.slice(0, 200) };
    }
    return { ok: false, error: evalResult.text.slice(0, 200) };
  }

  let channelId: string;
  try {
    const j = JSON.parse(evalResult.text);
    channelId = String(j.id);
  } catch {
    return { ok: false, error: `non-JSON response: ${evalResult.text.slice(0, 120)}` };
  }

  // Don't navigate here — let browserSendDmViaUi handle it. Navigating now
  // with page.goto tears down the existing WS connection so the CHANNEL_CREATE
  // event Discord sent back is lost before React processes it.
  return { ok: true, channelId };
}

/**
 * Send a DM message via page.evaluate(fetch(...)) inside the per-account
 * Chromium. Discord sees a real Chrome TLS fingerprint, real cookies, and the
 * genuine x-super-properties captured from the SPA's own requests — same as
 * if the user typed and hit Enter. No 2captcha, no relay needed.
 *
 * If Discord still challenges with captcha (flagged accounts), the response is
 * returned as-is (status 400) so the caller can apply a cooldown rather than
 * spinning on an unsolvable puzzle.
 */
export async function browserSendMessage(
  accountId: string,
  token: string,
  channelId: string,
  content: string,
  guildId?: string,
): Promise<BrowserFetchResponse> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const entry = await getOrCreateContext(accountId, token);
  const { page } = entry;

  const contextObj = guildId
    ? { location: "Direct Message", location_guild_id: guildId }
    : { location: "Direct Message" };
  const contextProps = Buffer.from(JSON.stringify(contextObj)).toString("base64");

  const url = `https://discord.com/api/v9/channels/${encodeURIComponent(channelId)}/messages`;

  const doFetch = async (captchaKey?: string, captchaRqtoken?: string) =>
    page.evaluate(
      async (args: {
        url: string; token: string; content: string; nonce: string;
        contextProps: string; superProperties: string;
        captchaKey?: string; captchaRqtoken?: string;
      }) => {
        try {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "authorization": args.token,
            "x-context-properties": args.contextProps,
            "x-discord-locale": "en-US",
            "x-debug-options": "bugReporterEnabled",
          };
          if (args.superProperties) headers["x-super-properties"] = args.superProperties;
          const body: any = { content: args.content, nonce: args.nonce, flags: 0 };
          if (args.captchaKey) body.captcha_key = args.captchaKey;
          if (args.captchaRqtoken) body.captcha_rqtoken = args.captchaRqtoken;
          const r = await fetch(args.url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials: "include",
            signal: AbortSignal.timeout(20_000),
          });
          const text = await r.text().catch(() => "");
          return { status: r.status, text };
        } catch (e: any) {
          return { status: 0, text: String(e?.message || e) };
        }
      },
      { url, token, content, nonce: randomUUID(), contextProps, superProperties: entry.superProperties, captchaKey, captchaRqtoken },
    );

  const first = await doFetch();

  // Captcha challenge — solve with 2captcha and retry from INSIDE the same
  // browser context so Discord sees a consistent fingerprint on both calls.
  if (first.status === 400) {
    let parsed: any = null;
    try { parsed = JSON.parse(first.text); } catch {}
    if (parsed?.captcha_sitekey) {
      const cs = await solveCaptchaKeepAlive(entry, {
        sitekey: String(parsed.captcha_sitekey),
        pageUrl: "https://discord.com/channels/@me",
        rqdata: parsed.captcha_rqdata || undefined,
        rqtoken: parsed.captcha_rqtoken || undefined,
        accountId,
      });
      if (cs.ok && cs.token) {
        console.log(`[browser] account=${accountId} captcha solved (cost=${cs.costCents}c) — retrying send in-browser`);
        const retry = await doFetch(cs.token, parsed.captcha_rqtoken || undefined);
        return {
          status: retry.status,
          ok: retry.status >= 200 && retry.status < 300,
          headers: {},
          text: async () => retry.text,
          json: async () => { try { return JSON.parse(retry.text); } catch { return {}; } },
        };
      }
      console.warn(`[browser] account=${accountId} captcha solve failed: ${cs.error}`);
    }
  }

  return {
    status: first.status,
    ok: first.status >= 200 && first.status < 300,
    headers: {},
    text: async () => first.text,
    json: async () => { try { return JSON.parse(first.text); } catch { return {}; } },
  };
}

export async function closeAccountContext(accountId: string): Promise<void> {
  const entry = accountContexts.get(accountId);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  accountContexts.delete(accountId);
  try { await entry.ctx.close(); } catch {}
  releaseContextSlot();
}

/** True if a Chromium context is currently alive for this account. */
export function isAccountContextOpen(accountId: string): boolean {
  return accountContexts.has(accountId);
}


/**
 * Open (or surface) the per-account Chromium for operator-driven use via
 * noVNC. Navigates to `path` on discord.com — defaults to /channels/@me so
 * the operator lands on the DM home. The operator drives everything else
 * through the noVNC iframe.
 *
 * Returns immediately after dispatching the goto — we don't wait for
 * full network idle, otherwise slow Discord cold-loads hold up the UI.
 */
export async function browserOpenForOperator(
  accountId: string,
  token: string,
  path: string = "/channels/@me",
): Promise<void> {
  if (!ENABLED) throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  const { page } = await getOrCreateContext(accountId, token);
  const safePath = path.startsWith("/") ? path : `/${path}`;
  await page.goto(`https://discord.com${safePath}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  }).catch((err: any) => {
    console.warn(`[browser] account=${accountId} operator-open nav warning: ${err?.message || err}`);
  });
  console.log(`[browser] account=${accountId} opened for operator at ${safePath}`);
}

/** Shutdown hook: called from SIGTERM in index.ts. */
export async function closeAllBrowserContexts(): Promise<void> {
  for (const [id, entry] of accountContexts) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try { await entry.ctx.close(); } catch {}
    console.log(`[browser] account=${id} closed on shutdown`);
  }
  accountContexts.clear();
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {}
    browserPromise = null;
  }
}

// v0.71 — expose the per-account page so other modules (vision captcha solver,
// future on-page automation) can drive the same context without spawning a
// second browser. Caller MUST NOT close the page; idle-close still owns it.
export async function getAccountPage(accountId: string, token: string): Promise<any> {
  if (!ENABLED) {
    throw new Error("browser-fetch disabled (BROWSER_FETCH_ENABLED=0)");
  }
  const { page } = await getOrCreateContext(accountId, token);
  return page;
}

export function browserFetchEnabled(): boolean {
  return ENABLED;
}
