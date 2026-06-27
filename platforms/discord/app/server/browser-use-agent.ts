// v0.73.1 — Browser Use Cloud REST integration (provisions a stealth browser).
//
// Reality check: Browser Use's public REST API at api.browser-use.com/api/v3
// only manages BROWSERS (provision, list, stop), not autonomous agent tasks.
// Their agent SDK is a Python library that runs locally and drives a browser
// you provisioned. So our integration provisions a cloud browser and drives
// it ourselves via Playwright over CDP.
//
// What we get from Browser Use:
//   - Stealth Chromium (fingerprint randomisation, undetected-chromedriver
//     style patches) that bypasses MOST anti-bot checks including hCaptcha's
//     "is this a real browser" signal.
//   - Residential proxy from their pool (per-country, sticky for session).
//   - Live URL we can hand to the operator to watch via web (live.browser-use.com).
//
// What we still bring:
//   - Our click logic (Accept Invite, captcha checkbox, tile clicks).
//   - Token injection.
//   - Per-account state machine integration.
//
// Auth header IS `X-Browser-Use-API-Key`, NOT Authorization: Bearer.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any; type Page = any;
let _pwChromium: any = null;
function getPwChromium(): any {
  if (!_pwChromium) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _pwChromium = require('playwright-core').chromium;
  }
  return _pwChromium;
}

const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "";
const BU_API = "https://api.browser-use.com/api/v3";

export interface BUJoinResult {
  ok: boolean;
  joined?: boolean;
  browserId?: string;
  liveUrl?: string;
  error?: string;
  durationMs: number;
  browserCostUSD?: number;
  proxyCostUSD?: number;
}

export function browserUseEnabled(): boolean {
  return !!BROWSER_USE_API_KEY;
}

interface ProvisionedBrowser {
  id: string;
  liveUrl: string;
  cdpUrl: string;
  wsUrl: string;
}

async function provisionBrowser(timeoutMinutes = 10): Promise<ProvisionedBrowser> {
  const r = await fetch(`${BU_API}/browsers`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      proxyCountryCode: "us",
      timeout: timeoutMinutes,
      browserScreenWidth: 1920,
      browserScreenHeight: 1080,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`provision HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = (await r.json()) as any;
  const id = String(j?.id || "");
  const liveUrl = String(j?.liveUrl || "");
  const cdpUrl = String(j?.cdpUrl || "");
  if (!id || !cdpUrl) {
    throw new Error(`provision response missing fields: ${JSON.stringify(j).slice(0, 200)}`);
  }
  // Resolve cdpUrl (https://) → ws via /json/version.
  let wsUrl = cdpUrl.replace(/^https/, "wss");
  try {
    const v = await fetch(`${cdpUrl}/json/version`, {
      headers: { "X-Browser-Use-API-Key": BROWSER_USE_API_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    if (v.ok) {
      const vj = (await v.json()) as any;
      if (vj?.webSocketDebuggerUrl) wsUrl = String(vj.webSocketDebuggerUrl);
    }
  } catch { /* fall through with the converted URL */ }
  return { id, liveUrl, cdpUrl, wsUrl };
}

async function stopBrowser(id: string): Promise<{ browserCost: number; proxyCost: number }> {
  try {
    const r = await fetch(`${BU_API}/browsers/${id}`, {
      method: "PATCH",
      headers: {
        "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const j = (await r.json()) as any;
      return {
        browserCost: parseFloat(j?.browserCost || "0") || 0,
        proxyCost: parseFloat(j?.proxyCost || "0") || 0,
      };
    }
  } catch (err: any) {
    console.warn(`[browser-use] stop ${id} failed: ${err?.message || err}`);
  }
  return { browserCost: 0, proxyCost: 0 };
}

export async function joinViaBrowserUse(
  accountId: string,
  token: string,
  inviteCode: string,
): Promise<BUJoinResult> {
  const start = Date.now();
  if (!BROWSER_USE_API_KEY) {
    return { ok: false, error: "BROWSER_USE_API_KEY not set", durationMs: 0 };
  }
  if (!token || !inviteCode) {
    return { ok: false, error: "missing token or inviteCode", durationMs: 0 };
  }

  let provisioned: ProvisionedBrowser | null = null;
  let browser: Browser | null = null;

  try {
    provisioned = await provisionBrowser(10);
    console.log(`[browser-use] acct=${accountId} provisioned ${provisioned.id} live=${provisioned.liveUrl.slice(0, 80)}`);
    browser = await getPwChromium().connectOverCDP(provisioned.wsUrl, { timeout: 30_000 });
    const ctx = browser.contexts()[0] || (await browser.newContext());
    const page = ctx.pages()[0] || (await ctx.newPage());

    // 1. Inject token via Discord's own origin. Browser Use's stealth Chromium
    //    means localStorage write should stick across navigation.
    await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((t: string) => {
      try { window.localStorage.setItem("token", JSON.stringify(t)); } catch { /* swallow */ }
    }, token);
    // Reload so the Discord SPA reads the new token from localStorage.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* discord never goes idle */ }

    // 2. Navigate to the invite.
    await page.goto(`https://discord.com/invite/${encodeURIComponent(inviteCode)}`, {
      waitUntil: "domcontentloaded", timeout: 30_000,
    });
    try { await page.waitForLoadState("networkidle", { timeout: 6000 }); } catch { /* noop */ }

    // 3. Click Accept Invite.
    const clicked = await clickAcceptInvite(page);
    if (!clicked) {
      // Maybe already joined? Check URL.
      if (page.url().includes("/channels/") && !page.url().includes("/invite/")) {
        const cost = await stopBrowser(provisioned.id);
        provisioned = null;
        return {
          ok: true, joined: true, browserId: undefined, liveUrl: undefined,
          durationMs: Date.now() - start,
          browserCostUSD: cost.browserCost, proxyCostUSD: cost.proxyCost,
        };
      }
    }
    await page.waitForTimeout(3000);

    // 4. Check the URL — Browser Use's stealth may have bypassed captcha entirely.
    if (page.url().includes("/channels/") && !page.url().includes("/invite/")) {
      const cost = await stopBrowser(provisioned.id);
      provisioned = null;
      return {
        ok: true, joined: true, browserId: undefined, liveUrl: undefined,
        durationMs: Date.now() - start,
        browserCostUSD: cost.browserCost, proxyCostUSD: cost.proxyCost,
      };
    }

    // 5. Captcha challenge still required. Use the same logic as our local
    //    browser-captcha-join but driving the Browser Use page.
    const joined = await solveCaptchaInPage(page);
    const cost = await stopBrowser(provisioned.id);
    provisioned = null;
    return {
      ok: joined,
      joined,
      browserId: undefined,
      liveUrl: undefined,
      durationMs: Date.now() - start,
      error: joined ? undefined : "captcha unsolved on browser-use",
      browserCostUSD: cost.browserCost,
      proxyCostUSD: cost.proxyCost,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `browser-use threw: ${err?.message || err}`,
      durationMs: Date.now() - start,
      browserId: provisioned?.id,
      liveUrl: provisioned?.liveUrl,
    };
  } finally {
    try { await browser?.close(); } catch { /* noop */ }
    if (provisioned) {
      // Best-effort cleanup if we hit an error before the success path stopped.
      try { await stopBrowser(provisioned.id); } catch { /* noop */ }
    }
  }
}

// Reuse the same click + solve logic from browser-captcha-join.ts but inline
// here to keep the BU integration self-contained. If Browser Use's stealth
// makes hCaptcha pass silently, we never reach this anyway.
async function clickAcceptInvite(page: Page): Promise<boolean> {
  const candidates = [
    'button:has-text("Accept Invite")',
    'button:has-text("Join Server")',
    'button:has-text("Join")',
    'div[role="button"]:has-text("Accept Invite")',
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click({ timeout: 3000 });
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

async function solveCaptchaInPage(page: Page): Promise<boolean> {
  // hCaptcha checkbox iframe — click it.
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (page.url().includes("/channels/") && !page.url().includes("/invite/")) {
      return true;
    }
    // Find any hCaptcha iframe and click its center via real mouse.
    const captchaFrame = page.frames().find((f: any) =>
      f.url().includes("hcaptcha.com") && (f.url().includes("/captcha/") || f.url().includes("hcaptcha-checkbox")),
    );
    if (captchaFrame) {
      try {
        const fe = await captchaFrame.frameElement().catch(() => null);
        const bbox = fe ? await fe.boundingBox().catch(() => null) : null;
        if (bbox && bbox.width > 30) {
          await page.mouse.move(bbox.x + 5, bbox.y + 5);
          await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2, { steps: 14 });
          await page.waitForTimeout(150);
          await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
          await page.waitForTimeout(3000);
        }
      } catch { /* keep trying */ }
    }
    await page.waitForTimeout(2000);
  }
  return false;
}
