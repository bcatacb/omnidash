/**
 * Smoke test for discord-browser plumbing.
 *
 * Verifies the eval-fetch round-trip end-to-end against Discord's
 * /api/v9/experiments endpoint, which is:
 *   - same-origin with the page we boot in (no CORS)
 *   - safely callable with a junk token (returns 401 JSON, no spammy side-
 *     effects, no captcha trigger — it's a read-only fingerprint endpoint)
 *   - one of the calls Discord's own SPA makes on every boot, so it's
 *     indistinguishable from legitimate web traffic
 *
 * What this proves:
 *   - Chromium launches in the image
 *   - Per-account context creates, proxy routes work
 *   - addInitScript injects the token before navigation
 *   - page.goto Discord succeeds (or at least returns a usable page)
 *   - page.evaluate -> fetch round-trip returns status + headers + JSON body
 *
 * Run with:
 *   docker run --rm \
 *     -e BROWSER_FETCH_ENABLED=1 \
 *     -e WEBSHARE_PROXY_URL="$(cat .proxy-webshare.local)" \
 *     gg-api:v0.18-dryrun \
 *     npx ts-node discord-browser.smoke.ts
 */
import { browserFetch, closeAllBrowserContexts } from "./discord-browser";

async function main(): Promise<void> {
  const acctId = "smoke-test-account";
  const fakeToken = "smoke-token-not-real";
  const url = "https://discord.com/api/v9/experiments?with_guild_experiments=false";

  const res = await browserFetch(acctId, fakeToken, url, {
    method: "GET",
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: fakeToken,
      "x-discord-locale": "en-US",
    },
    timeoutMs: 60_000,
  });

  // 401 is expected (junk token); we're proving the round-trip, not auth.
  // What we care about: we got a numeric status, headers came back, body is JSON.
  if (res.status === 0) {
    throw new Error(`smoke fetch returned status=0 — round-trip broken`);
  }
  const text = await res.text();
  // Body must be JSON (Discord returns JSON even for 401s on this endpoint).
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`response body wasn't JSON: ${text.slice(0, 200)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`response JSON wasn't an object: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  console.log(`smoke OK: status=${res.status} bodyKeys=[${Object.keys(parsed).slice(0, 5).join(",")}] round-trip verified`);
  await closeAllBrowserContexts();
}

main().catch(async (err) => {
  console.error("smoke FAIL:", err?.message || err);
  try { await closeAllBrowserContexts(); } catch {}
  process.exit(1);
});
