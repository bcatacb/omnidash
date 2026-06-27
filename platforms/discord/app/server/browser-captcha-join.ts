// v0.71.2 — Playwright + Gemini Vision universal hCaptcha solver.
//
// Handles all known hCaptcha variants (3x3 grids, bbox clicks, drag-drop,
// yes/no, chained challenges). Dispatches on the captchaType the vision
// model returns; each variant has a dedicated executor.
//
// Why the per-account Playwright session matters: the SAME browser that
// solves the captcha submits the join, so the IP that produced the token
// matches the IP Discord verifies. No 2Captcha IP-mismatch rejection.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any; type Frame = any;
import { getAccountPage } from "./discord-browser";
import { solveCaptcha, type VisionAction } from "./vision-solver";

const MAX_CAPTCHA_LOOPS = 5;
const VISION_LOOP_TIMEOUT_MS = 90_000;

export interface BrowserJoinResult {
  ok: boolean;
  joined?: boolean;
  captchaLoops?: number;
  visionCostCents?: number;
  error?: string;
  captchaTypesSeen?: string[];
  screenshotsTaken?: number;
}

// v0.72 — Diagnostic mode keeps every screenshot + vision response in memory
// and returns them so the operator can see what the browser saw at each step.
// Used by /api/admin/warmup/test/join in the Test Lab.
export interface DiagnosticLoop {
  loop: number;
  url: string;
  challengeFrameUrl: string | null;
  screenshotPngBase64: string | null;
  pageScreenshotPngBase64: string | null; // v0.72.6 — full page, not just iframe
  bboxWidth: number;
  bboxHeight: number;
  visionRaw: string | null;
  visionParsed: {
    captchaType?: string;
    question?: string;
    actions?: any[];
    needsVerifyClick?: boolean;
  } | null;
  visionCostCents: number;
  clickedTiles: number[];
  error: string | null;
  iframeHtmlSnapshot: string | null;
  introClickStrategy: string | null;
  tileCountFound: number;
}

export interface BrowserJoinDiagnosticResult extends BrowserJoinResult {
  loops: DiagnosticLoop[];
  durationMs: number;
  totalCostCents: number;
}

export async function browserJoinWithCaptcha(
  accountId: string,
  token: string,
  inviteCode: string,
): Promise<BrowserJoinResult> {
  let page: Page;
  try {
    page = await getAccountPage(accountId, token);
  } catch (err: any) {
    return { ok: false, error: `browser context: ${err?.message || err}` };
  }

  let visionCostCents = 0;
  let captchaLoops = 0;
  let screenshotsTaken = 0;
  const captchaTypesSeen: string[] = [];

  try {
    await page.goto(`https://discord.com/invite/${encodeURIComponent(inviteCode)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    console.log(`[browser-captcha] acct=${accountId} navigated → ${page.url()}`);
    // Discord's React SPA needs a few seconds to boot from "domcontentloaded"
    // to "Accept Invite button visible". Wait for the network to settle (5s
    // max), which usually lines up with the SPA mounting + invite preview
    // rendering. Without this we click before the button exists.
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch { /* networkidle never fires on Discord — fall through */ }
    // Belt-and-suspenders: explicit selector wait for the actual button.
    try {
      await page.waitForSelector(
        'button:has-text("Accept Invite"), button:has-text("Join Server"), button:has-text("Join")',
        { timeout: 7000, state: "visible" },
      );
    } catch { /* button may have rendered some other way — proceed */ }
    const clicked = await tryClickAcceptInvite(page);
    console.log(`[browser-captcha] acct=${accountId} accept-invite clicked=${clicked}`);
    // If the click succeeded, give Discord a beat to fire its POST /invites
    // and surface the captcha widget.
    if (clicked) await page.waitForTimeout(1500);

    // Server may have Membership Screening (rules acknowledgment) enabled.
    // If we landed on the rules page instead of a channel, click through it now.
    await tryAcknowledgeRulesIfPresent(page);

    // Fast path: many servers drop you straight in after the ack.
    if (page.url().includes("/channels/") && !page.url().includes("/invite/")) {
      console.log(`[browser-captcha] acct=${accountId} JOINED (post-rules early) at ${page.url()}`);
      return { ok: true, joined: true, captchaLoops, visionCostCents, screenshotsTaken, captchaTypesSeen };
    }

    const cycleStart = Date.now();
    for (captchaLoops = 0; captchaLoops < MAX_CAPTCHA_LOOPS; captchaLoops++) {
      // Joined? Discord redirects /invite/<code> → /channels/<guildId>/<channelId>
      const url = page.url();
      if (url.includes("/channels/") && !url.includes("/invite/")) {
        console.log(`[browser-captcha] acct=${accountId} JOINED at ${url}`);
        return { ok: true, joined: true, captchaLoops, visionCostCents, screenshotsTaken, captchaTypesSeen };
      }

      let challengeFrame = await findChallengeFrame(page);
      if (!challengeFrame) {
        // No challenge yet — check if there's a checkbox iframe to click.
        const checkboxFrame = await findCheckboxFrame(page);
        if (checkboxFrame) {
          console.log(`[browser-captcha] acct=${accountId} loop=${captchaLoops} found checkbox iframe, clicking "I am human"`);
          await clickHCaptchaCheckbox(page, checkboxFrame);
          // hCaptcha takes ~1-3s to swap from checkbox to challenge.
          await page.waitForTimeout(2500);
          challengeFrame = await findChallengeFrame(page);
        }
      }
      if (!challengeFrame) {
        const allFrames = page.frames().map((f: any) => f.url()).filter((u: any) => u !== "about:blank");
        console.log(`[browser-captcha] acct=${accountId} loop=${captchaLoops} no challenge frame; url=${page.url()} frames=${JSON.stringify(allFrames)}`);
        await page.waitForTimeout(2000);
        if (page.url().includes("/channels/")) {
          console.log(`[browser-captcha] acct=${accountId} JOINED (post-wait) at ${page.url()}`);
          return { ok: true, joined: true, captchaLoops, visionCostCents, screenshotsTaken, captchaTypesSeen };
        }
        if (Date.now() - cycleStart > VISION_LOOP_TIMEOUT_MS) {
          return { ok: false, error: "no captcha frame and no redirect — gave up", captchaLoops, visionCostCents, screenshotsTaken, captchaTypesSeen };
        }
        continue;
      }
      console.log(`[browser-captcha] acct=${accountId} loop=${captchaLoops} challenge frame URL: ${challengeFrame.url()}`);

      // Three-tier screenshot strategy (Playwright "wait for stable" trips
      // on hCaptcha's constant repaints, so we fall back through):
      //   1. iframe element screenshot with animations:disabled
      //   2. page screenshot clipped to the iframe's bbox
      //   3. full-page screenshot (vision still locates the widget)
      const frameEl = await challengeFrame.frameElement().catch(() => null);
      if (!frameEl) {
        await page.waitForTimeout(1500);
        continue;
      }
      // Wait up to 3s for the iframe to have a real size — hCaptcha sometimes
      // renders 0×0 briefly before painting the grid.
      let bbox: { x: number; y: number; width: number; height: number } | null = null;
      for (let i = 0; i < 6; i++) {
        bbox = await frameEl.boundingBox().catch(() => null);
        if (bbox && bbox.width > 50 && bbox.height > 50) break;
        await page.waitForTimeout(500);
      }
      if (!bbox || bbox.width < 50 || bbox.height < 50) {
        console.warn(`[browser-captcha] iframe bbox not ready: ${JSON.stringify(bbox)}`);
        await page.waitForTimeout(1500);
        continue;
      }

      let pngBuf: Buffer | null = null;
      try {
        pngBuf = await frameEl.screenshot({ type: "png", timeout: 12_000, animations: "disabled" });
      } catch (err: any) {
        console.warn(`[browser-captcha] element screenshot failed (${err?.message || err}) → trying page-clip`);
      }
      if (!pngBuf) {
        try {
          pngBuf = await page.screenshot({
            type: "png",
            clip: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
            timeout: 12_000,
            animations: "disabled",
          });
        } catch (err: any) {
          console.warn(`[browser-captcha] page-clip screenshot failed (${err?.message || err}) → trying full page`);
        }
      }
      if (!pngBuf) {
        try {
          pngBuf = await page.screenshot({ type: "png", timeout: 12_000, animations: "disabled" });
        } catch (err: any) {
          console.warn(`[browser-captcha] full-page screenshot failed (${err?.message || err})`);
          await page.waitForTimeout(1500);
          continue;
        }
      }
      // v0.72.2 — intro-screen detection (see diagnostic path for details).
      const tilesPresent = await challengeFrame.locator(".task-image").count().catch(() => 0);
      if (tilesPresent < 9) {
        const clickedHow = await clickIntroCheckboxIfPresent(challengeFrame, page, bbox);
        console.log(`[browser-captcha] acct=${accountId} loop=${captchaLoops} intro state — tiles=${tilesPresent} clicked=${clickedHow || "none"}`);
        await page.waitForTimeout(2500);
        continue;
      }
      if (!pngBuf) { await page.waitForTimeout(1500); continue; }
      screenshotsTaken += 1;
      console.log(`[browser-captcha] acct=${accountId} loop=${captchaLoops} screenshot=${pngBuf.length}b bbox=${Math.round(bbox.width)}x${Math.round(bbox.height)}`);

      const solve = await solveCaptcha(pngBuf.toString("base64"));
      visionCostCents += solve.costCents || 0;
      if (!solve.ok || !solve.actions) {
        console.warn(`[browser-captcha] vision solve failed: ${solve.error}`);
        return {
          ok: false,
          error: `vision solve failed: ${solve.error}`,
          captchaLoops,
          visionCostCents,
          screenshotsTaken,
          captchaTypesSeen,
        };
      }
      captchaTypesSeen.push(solve.captchaType || "unknown");
      console.log(
        `[browser-captcha] vision: type=${solve.captchaType} actions=${solve.actions.length} q="${(solve.question || "").slice(0, 80)}"`,
      );

      // Skip-action means vision couldn't solve. Don't loop on the same image.
      if (solve.actions.length === 1 && solve.actions[0].type === "skip") {
        return {
          ok: false,
          error: `vision skip: ${solve.actions[0].reason || "unknown reason"}`,
          captchaLoops,
          visionCostCents,
          screenshotsTaken,
          captchaTypesSeen,
        };
      }

      // Execute actions inside the iframe.
      await executeActions(page, challengeFrame, bbox, solve.actions);

      // Click Verify (for the variants that need it).
      if (solve.needsVerifyClick !== false) {
        await clickVerifyButton(challengeFrame);
      }

      // Give hCaptcha a moment to either issue the token (and Discord auto-
      // submits) or chain another challenge.
      await page.waitForTimeout(2500);

      // After captcha resolution, Discord sometimes surfaces the rules screen
      // instead of immediately going to the channel. Try to click through.
      await tryAcknowledgeRulesIfPresent(page);

      // Re-evaluate: we may have been dropped into the rules page and just acknowledged it.
      if (page.url().includes("/channels/") && !page.url().includes("/invite/")) {
        console.log(`[browser-captcha] acct=${accountId} JOINED (post-rules) at ${page.url()}`);
        return { ok: true, joined: true, captchaLoops, visionCostCents, screenshotsTaken, captchaTypesSeen };
      }
    }
    return {
      ok: false,
      error: `max ${MAX_CAPTCHA_LOOPS} captcha cycles exhausted`,
      captchaLoops,
      visionCostCents,
      screenshotsTaken,
      captchaTypesSeen,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `browser join threw: ${err?.message || err}`,
      captchaLoops,
      visionCostCents,
      screenshotsTaken,
      captchaTypesSeen,
    };
  }
}

// v0.72 — Diagnostic version of browserJoinWithCaptcha. Collects every
// screenshot and vision response in memory and returns them. Slower because
// we don't `continue` past failures — we record the failure and try one more
// loop so the operator can see what the browser saw.
export async function browserJoinWithCaptchaDiagnostic(
  accountId: string,
  token: string,
  inviteCode: string,
  opts: { maxLoops?: number } = {},
): Promise<BrowserJoinDiagnosticResult> {
  const start = Date.now();
  const maxLoops = opts.maxLoops || 5;
  const loops: DiagnosticLoop[] = [];

  let page: Page;
  try {
    page = await getAccountPage(accountId, token);
  } catch (err: any) {
    return {
      ok: false,
      error: `browser context: ${err?.message || err}`,
      loops,
      durationMs: Date.now() - start,
      totalCostCents: 0,
      captchaLoops: 0,
      visionCostCents: 0,
      screenshotsTaken: 0,
      captchaTypesSeen: [],
    };
  }

  try {
    await page.goto(`https://discord.com/invite/${encodeURIComponent(inviteCode)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* discord never goes idle */ }
    try {
      await page.waitForSelector(
        'button:has-text("Accept Invite"), button:has-text("Join Server"), button:has-text("Join")',
        { timeout: 7000, state: "visible" },
      );
    } catch { /* proceed */ }
    const clicked = await tryClickAcceptInvite(page);
    if (clicked) await page.waitForTimeout(1500);

    await tryAcknowledgeRulesIfPresent(page);

    let totalCost = 0;
    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      const loopEntry: DiagnosticLoop = {
        loop: loopIdx,
        url: page.url(),
        challengeFrameUrl: null,
        screenshotPngBase64: null,
        pageScreenshotPngBase64: null,
        bboxWidth: 0,
        bboxHeight: 0,
        visionRaw: null,
        visionParsed: null,
        visionCostCents: 0,
        clickedTiles: [],
        error: null,
        iframeHtmlSnapshot: null,
        introClickStrategy: null,
        tileCountFound: 0,
      };

      // Always grab a full-page screenshot at the start of each loop. This
      // lets the operator see exactly what's visible on the screen — Discord
      // chrome, the captcha widget, AND any background — to diagnose stuck
      // states.
      try {
        const fullPng = await page.screenshot({ type: "png", timeout: 8000, animations: "disabled" });
        loopEntry.pageScreenshotPngBase64 = fullPng.toString("base64");
      } catch { /* skip — diagnostic is best-effort */ }

      // Joined?
      const url = page.url();
      if (url.includes("/channels/") && !url.includes("/invite/")) {
        loops.push(loopEntry);
        return {
          ok: true, joined: true, loops,
          durationMs: Date.now() - start, totalCostCents: totalCost,
          captchaLoops: loopIdx, visionCostCents: totalCost, screenshotsTaken: loops.filter(l => l.screenshotPngBase64).length,
          captchaTypesSeen: loops.map(l => l.visionParsed?.captchaType || "unknown").filter(Boolean),
        };
      }

      let challengeFrame = await findChallengeFrame(page);
      if (!challengeFrame) {
        // Try clicking the "I am human" checkbox if it's there.
        const checkboxFrame = await findCheckboxFrame(page);
        if (checkboxFrame) {
          await clickHCaptchaCheckbox(page, checkboxFrame);
          await page.waitForTimeout(2500);
          challengeFrame = await findChallengeFrame(page);
        }
      }
      if (!challengeFrame) {
        loopEntry.error = "no challenge frame (checkbox click did not produce challenge)";
        loops.push(loopEntry);
        await page.waitForTimeout(2000);
        continue;
      }
      loopEntry.challengeFrameUrl = challengeFrame.url();

      const frameEl = await challengeFrame.frameElement().catch(() => null);
      if (!frameEl) {
        loopEntry.error = "frameElement returned null";
        loops.push(loopEntry);
        await page.waitForTimeout(1500);
        continue;
      }
      let bbox: { x: number; y: number; width: number; height: number } | null = null;
      for (let i = 0; i < 6; i++) {
        bbox = await frameEl.boundingBox().catch(() => null);
        if (bbox && bbox.width > 50 && bbox.height > 50) break;
        await page.waitForTimeout(500);
      }
      if (!bbox || bbox.width < 50 || bbox.height < 50) {
        loopEntry.error = `bbox not ready: ${JSON.stringify(bbox)}`;
        loops.push(loopEntry);
        await page.waitForTimeout(1500);
        continue;
      }
      loopEntry.bboxWidth = Math.round(bbox.width);
      loopEntry.bboxHeight = Math.round(bbox.height);

      // v0.72.2 — hCaptcha enterprise opens with a "Verify you are human"
      // intro screen. The image grid only appears AFTER we click it. If we
      // screenshot the intro and send it to vision, Gemini sees no tiles to
      // classify and returns garbage. So: detect intro state by absence of
      // .task-image elements, click the intro, wait for the grid, and use
      // the next loop's screenshot for actual solving.
      // v0.72.5 — also count alternative selectors hCaptcha may use.
      const taskImageCount = await challengeFrame.locator(".task-image").count().catch(() => 0);
      const challengeBtnCount = await challengeFrame.locator(".challenge-answer-btn").count().catch(() => 0);
      const taskAnswerCount = await challengeFrame.locator(".task-answer").count().catch(() => 0);
      const tilesPresent = Math.max(taskImageCount, challengeBtnCount, taskAnswerCount);
      loopEntry.tileCountFound = tilesPresent;
      if (tilesPresent < 9) {
        const clickedHow = await clickIntroCheckboxIfPresent(challengeFrame, page, bbox);
        loopEntry.introClickStrategy = clickedHow;
        loopEntry.iframeHtmlSnapshot = await snapshotFrameHtml(challengeFrame);
        loopEntry.error = clickedHow
          ? `intro state (image:${taskImageCount} btn:${challengeBtnCount} answer:${taskAnswerCount}) — clicked via ${clickedHow}`
          : `intro state (image:${taskImageCount} btn:${challengeBtnCount} answer:${taskAnswerCount}) — no intro element found`;
        // Still screenshot so the operator can see what's on screen.
        let introBuf: Buffer | null = null;
        try { introBuf = await frameEl.screenshot({ type: "png", timeout: 12_000, animations: "disabled" }); } catch { /* skip */ }
        if (!introBuf) {
          try {
            introBuf = await page.screenshot({
              type: "png",
              clip: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
              timeout: 12_000, animations: "disabled",
            });
          } catch { /* skip */ }
        }
        if (introBuf) loopEntry.screenshotPngBase64 = introBuf.toString("base64");
        loops.push(loopEntry);
        await page.waitForTimeout(2500); // let image grid load
        continue;
      }

      let pngBuf: Buffer | null = null;
      try { pngBuf = await frameEl.screenshot({ type: "png", timeout: 12_000, animations: "disabled" }); } catch { /* fallback */ }
      if (!pngBuf) {
        try {
          pngBuf = await page.screenshot({
            type: "png",
            clip: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
            timeout: 12_000, animations: "disabled",
          });
        } catch { /* fallback */ }
      }
      if (!pngBuf) {
        try { pngBuf = await page.screenshot({ type: "png", timeout: 12_000, animations: "disabled" }); } catch { /* give up */ }
      }
      if (!pngBuf) {
        loopEntry.error = "all screenshot attempts failed";
        loops.push(loopEntry);
        await page.waitForTimeout(1500);
        continue;
      }
      loopEntry.screenshotPngBase64 = pngBuf.toString("base64");

      const solve = await solveCaptcha(pngBuf.toString("base64"));
      loopEntry.visionCostCents = solve.costCents || 0;
      totalCost += solve.costCents || 0;
      loopEntry.visionRaw = solve.raw || null;
      if (solve.ok) {
        loopEntry.visionParsed = {
          captchaType: solve.captchaType,
          question: solve.question,
          actions: solve.actions,
          needsVerifyClick: solve.needsVerifyClick,
        };
      }
      if (!solve.ok || !solve.actions) {
        loopEntry.error = `vision: ${solve.error || "no actions"}`;
        loops.push(loopEntry);
        continue;
      }
      if (solve.actions.length === 1 && solve.actions[0].type === "skip") {
        loopEntry.error = `vision skip: ${solve.actions[0].reason || "unknown"}`;
        loops.push(loopEntry);
        continue;
      }
      loopEntry.clickedTiles = solve.actions
        .filter((a) => a.type === "click_tile" && Number.isInteger(a.tileIndex))
        .map((a) => a.tileIndex!) as number[];

      await executeActions(page, challengeFrame, bbox, solve.actions);
      if (solve.needsVerifyClick !== false) await clickVerifyButton(challengeFrame);
      loops.push(loopEntry);
      await page.waitForTimeout(2500);
    }

    // Hit the loop ceiling without joining.
    return {
      ok: false,
      error: `${maxLoops} loops exhausted without join`,
      loops,
      durationMs: Date.now() - start,
      totalCostCents: totalCost,
      captchaLoops: loops.length,
      visionCostCents: totalCost,
      screenshotsTaken: loops.filter(l => l.screenshotPngBase64).length,
      captchaTypesSeen: loops.map(l => l.visionParsed?.captchaType || "unknown").filter(Boolean),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `diagnostic threw: ${err?.message || err}`,
      loops,
      durationMs: Date.now() - start,
      totalCostCents: 0,
      captchaLoops: loops.length,
      visionCostCents: 0,
      screenshotsTaken: loops.filter(l => l.screenshotPngBase64).length,
      captchaTypesSeen: [],
    };
  }
}

// ───── helpers ───────────────────────────────────────────────────────────

// hCaptcha enterprise opens with a "Verify you are human" intro screen
// containing only a checkbox/button. The 9-image grid only appears AFTER you
// click that intro. Returns the action that was taken so we can log it.
//
// Three strategies tried in sequence; first one that doesn't throw "wins":
//   1. Named selectors (#checkbox, role=checkbox, etc.)
//   2. Multi-position center clicks via page.mouse with natural movement
//      (move then click, multiple Y positions: center, lower-third, button row)
async function clickIntroCheckboxIfPresent(
  frame: Frame,
  page?: Page,
  bbox?: { x: number; y: number; width: number; height: number } | null,
): Promise<string | null> {
  // Image grid present? Then we're past the intro.
  const tileCount = await frame.locator(".task-image").count().catch(() => 0);
  if (tileCount >= 9) return null;

  const selectors = [
    "#checkbox",
    '[role="checkbox"]',
    ".checkbox",
    "#anchor",
    '[aria-label*="human"]',
    '[aria-label*="captcha"]',
    "div.button-submit",
    ".button-submit",
    'div[role="button"]',
    "button",
  ];
  for (const sel of selectors) {
    try {
      const el = frame.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 2000 });
        return `selector:${sel}`;
      }
    } catch { /* try next */ }
  }

  // page.mouse fallback with HUMAN-LIKE movement. hCaptcha listens for
  // mouse-move events to score "are you a bot". A click with no preceding
  // movement is the #1 bot signal — try moving to a random offset first,
  // then to the target, then click.
  if (page && bbox && bbox.width > 50 && bbox.height > 50) {
    const cx = bbox.x + bbox.width / 2;
    const candidates = [
      { y: bbox.y + bbox.height * 0.5, name: "center" },
      { y: bbox.y + bbox.height * 0.85, name: "bottom-button" },
      { y: bbox.y + bbox.height * 0.7, name: "lower-third" },
      { y: bbox.y + bbox.height * 0.3, name: "upper-third" },
    ];
    for (const c of candidates) {
      try {
        // Move to a random spot first (anti-bot heuristic), then to target,
        // then click. `steps: 12` smoothly animates the cursor.
        await page.mouse.move(bbox.x + 5, bbox.y + 5);
        await page.mouse.move(cx, c.y, { steps: 12 });
        await page.waitForTimeout(120);
        await page.mouse.click(cx, c.y);
        return `mouse:${c.name} (${Math.round(cx)},${Math.round(c.y)})`;
      } catch { /* try next position */ }
    }
  }
  return null;
}

// Dump the iframe's outerHTML for diagnostic purposes. Truncated to 4 KB —
// hCaptcha's full DOM is huge and we only need to see the visible-text
// elements to figure out what to click.
async function snapshotFrameHtml(frame: Frame): Promise<string> {
  try {
    const html = await frame.evaluate(() => {
      // Strip the heavy children (script tags, hidden divs) to keep the
      // output focused on what's actually visible to the operator.
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style").forEach((n) => n.remove());
      return clone.outerHTML;
    });
    return html.slice(0, 4000);
  } catch (err: any) {
    return `[snapshotFrameHtml threw: ${err?.message || err}]`;
  }
}

async function tryClickAcceptInvite(page: Page): Promise<boolean> {
  // Discord's invite-page CTA: tested labels + a few class-pattern fallbacks.
  // The button can be a <button>, <div role="button">, or inside an <a> tag
  // depending on whether the user is logged in. We try them all.
  const candidates = [
    'button:has-text("Accept Invite")',
    'button:has-text("Join Server")',
    'button:has-text("Join")',
    'div[role="button"]:has-text("Accept Invite")',
    'div[role="button"]:has-text("Join Server")',
    '[role="button"]:has-text("Accept")',
    '[role="button"]:has-text("Join")',
    'button[class*="acceptInvite"]',
    'button[class*="lookFilled"]:has-text("Accept")',
    'button[class*="colorBrand"]',
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout: 3000 });
        return true;
      }
    } catch { /* try next */ }
  }
  // Final attempt: take any visible <button> whose visible text mentions
  // "Accept" or "Join" (locale-tolerant).
  try {
    const all = await page.locator("button").all();
    for (const btn of all) {
      if (!(await btn.isVisible({ timeout: 200 }).catch(() => false))) continue;
      const txt = (await btn.innerText().catch(() => "")) || "";
      if (/accept|join/i.test(txt)) {
        await btn.click({ timeout: 3000 });
        return true;
      }
    }
  } catch { /* noop */ }
  return false;
}

// hCaptcha renders TWO iframes for the standard flow:
//   1. frame=lp (landing page) — the "Verify you are human" checkbox.
//      User must click this BEFORE the challenge appears.
//   2. frame=challenge — the actual 3x3 image grid (or bbox / drag-drop / etc.)
//
// findChallengeFrame() must prefer #2 (the grid). If only #1 exists, the
// caller needs to click the checkbox first to advance to #2.
async function findChallengeFrame(page: Page): Promise<Frame | null> {
  // First pass: explicit challenge iframe.
  for (const f of page.frames()) {
    const u = f.url();
    if (u.includes("hcaptcha.com") && u.includes("frame=challenge")) return f;
  }
  // No challenge yet. The CALLER should run clickHCaptchaCheckbox() first.
  return null;
}

// Find the hCaptcha checkbox iframe ("I am human") if present.
async function findCheckboxFrame(page: Page): Promise<Frame | null> {
  for (const f of page.frames()) {
    const u = f.url();
    if (u.includes("hcaptcha.com") && (u.includes("frame=lp") || u.includes("frame=checkbox"))) {
      return f;
    }
  }
  return null;
}

// Click the "I am human" checkbox inside hCaptcha's landing-page iframe so
// the challenge iframe appears. Returns true if the click went through.
async function clickHCaptchaCheckbox(page: Page, checkboxFrame: Frame): Promise<boolean> {
  // The checkbox is at predictable coordinates relative to the iframe origin.
  // Standard checkbox iframe is ~300×80; the actual checkbox input is at ~(15,33).
  // We click on the iframe via the page (not via the frame) because Playwright's
  // frame.click would resolve to the inner DOM which doesn't propagate as a real
  // user gesture for hCaptcha.
  try {
    const el = await checkboxFrame.frameElement();
    const bbox = await el.boundingBox();
    if (!bbox) return false;
    // The checkbox sits at the left of the iframe. Click at (15, height/2).
    const x = bbox.x + 15;
    const y = bbox.y + bbox.height / 2;
    await page.mouse.click(x, y);
    return true;
  } catch (err: any) {
    console.warn(`[browser-captcha] checkbox click threw: ${err?.message || err}`);
    return false;
  }
}

// Execute a list of vision-produced actions inside the challenge iframe.
// Each action gets ~150ms human-ish jitter so clicks don't look mechanical.
async function executeActions(
  page: Page,
  frame: Frame,
  bbox: { x: number; y: number; width: number; height: number },
  actions: VisionAction[],
): Promise<void> {
  for (const a of actions) {
    try {
      switch (a.type) {
        case "click_tile":
          await clickTile(frame, a.tileIndex!);
          break;
        case "click":
          if (typeof a.x === "number" && typeof a.y === "number") {
            const x = bbox.x + a.x * bbox.width;
            const y = bbox.y + a.y * bbox.height;
            await page.mouse.click(x, y);
          }
          break;
        case "drag":
          if (
            typeof a.x === "number" && typeof a.y === "number" &&
            typeof a.endX === "number" && typeof a.endY === "number"
          ) {
            const fromX = bbox.x + a.x * bbox.width;
            const fromY = bbox.y + a.y * bbox.height;
            const toX = bbox.x + a.endX * bbox.width;
            const toY = bbox.y + a.endY * bbox.height;
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            await page.mouse.move(toX, toY, { steps: 12 }); // smooth drag
            await page.mouse.up();
          }
          break;
        case "click_button":
          if (a.buttonLabel) {
            const sel = `:has-text("${a.buttonLabel.replace(/"/g, "")}")`;
            const el = frame.locator(`button${sel}, [role="button"]${sel}`).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.click({ timeout: 2000 });
            }
          }
          break;
        case "skip":
        default:
          break;
      }
    } catch (err: any) {
      console.warn(`[browser-captcha] action ${a.type} threw: ${err?.message || err}`);
    }
    await page.waitForTimeout(140 + Math.floor(Math.random() * 180));
  }
}

// For grid_3x3 — tile index 0..8 row-major. Multiple selectors because
// hCaptcha sometimes ships variants with different DOM.
async function clickTile(frame: Frame, idx: number): Promise<void> {
  if (idx < 0 || idx > 8) return;
  const selectors = [".task-image", '[role="checkbox"]', ".challenge-answer-btn"];
  for (const sel of selectors) {
    try {
      const tiles = frame.locator(sel);
      const count = await tiles.count();
      if (count >= 9) {
        await tiles.nth(idx).click({ timeout: 2000 });
        return;
      }
    } catch { /* try next selector */ }
  }
}

async function clickVerifyButton(frame: Frame): Promise<void> {
  const candidates = [
    'div.button-submit',
    '.button-submit',
    'button:has-text("Verify")',
    'button:has-text("Next")',
    'button:has-text("Skip")',
    '[role="button"]:has-text("Verify")',
  ];
  for (const sel of candidates) {
    try {
      const el = frame.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click({ timeout: 2000 });
        return;
      }
    } catch { /* try next */ }
  }
}

/**
 * After accepting an invite, some servers show a mandatory "Server Rules" / 
 * membership screening screen ("You must acknowledge the rules before chatting").
 * This function tries to click the checkbox + continue / agree button.
 */
async function tryAcknowledgeRulesIfPresent(page: Page): Promise<void> {
  try {
    // Give the rules UI a moment to appear (Discord is slow after join redirect).
    await page.waitForTimeout(1200);

    const url = page.url();
    if (url.includes("/channels/") && !url.includes("/invite/")) {
      return; // Already inside — nothing to do.
    }

    // Common patterns for the rules acknowledgment UI.
    const checkboxSelectors = [
      'input[type="checkbox"]',
      '[role="checkbox"]',
      'div[role="checkbox"]',
      'label:has(input[type="checkbox"])',
    ];

    // Click any visible rules-related checkbox first.
    for (const sel of checkboxSelectors) {
      try {
        const cb = page.locator(sel).first();
        if (await cb.isVisible({ timeout: 1200 })) {
          await cb.click({ timeout: 2000, force: true }).catch(async () => {
            await cb.check({ timeout: 2000 }).catch(() => {});
          });
          await page.waitForTimeout(600);
          break;
        }
      } catch { /* continue */ }
    }

    // Now click the primary action button to submit the acknowledgment.
    const actionSelectors = [
      'button:has-text("Continue")',
      'button:has-text("Accept")',
      'button:has-text("I have read")',
      'button:has-text("I agree")',
      'button:has-text("Got it")',
      'button:has-text("Agree")',
      '[role="button"]:has-text("Continue")',
      '[role="button"]:has-text("Accept")',
      'button[class*="colorBrand"]:has-text("Continue")',
      'button[class*="lookFilled"]',
    ];

    for (const sel of actionSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          // Re-check — if we advanced to a channel, we're done.
          if (page.url().includes("/channels/")) {
            console.log(`[browser-captcha] rules acknowledged, now in ${page.url()}`);
          }
          return;
        }
      } catch { /* try next */ }
    }
  } catch (err: any) {
    // Non-fatal — the account may still be able to chat, or the screen
    // may clear after the next gateway event / lazy load.
  }
}
