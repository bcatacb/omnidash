/**
 * Real outbound message send + relationships fetch.
 *
 * All sends use pure TLS (cycletls Chrome-impersonation) with the account's
 * assigned proxy. Captcha challenges are resolved via 2captcha using the same
 * proxy so the hCaptcha token IP matches the account IP — no mismatch, no
 * revocation. No Playwright/browser anywhere in this file.
 *
 * The relationships GET stays on cycletls — Discord doesn't captcha-wall reads.
 */

import { discordHeaders, tlsFetch } from "./discord-http";
import { publishExternalEvent } from "./realtime";
import { solveCaptchaForToken } from "./captcha";
import { browserSendDmViaUi, browserSendMessage, browserFetchEnabled } from "./discord-browser";

export interface SendResult {
  ok: boolean;
  discordMessageId?: string;
  body?: string;
  sentAt?: string;
  error?: string;
  httpStatus?: number;
  /** Path that produced the result: "tls" (no captcha), "tls+2captcha" (solved), "browser" (manual fallback). */
  via?: "tls" | "tls+2captcha" | "browser";
  costCents?: number;
}

const CAPTCHA_PAGE_URL = "https://discord.com/channels/@me";

/** POST /messages via TLS. Captcha challenges are solved via 2captcha using the account's proxy.
 *  Pass guildId so x-context-properties marks the send as a mutual-server DM — prevents cold-contact captcha. */
async function tlsSendWithCaptcha(
  accountId: string,
  token: string,
  channelId: string,
  body: string,
  guildId?: string,
): Promise<SendResult> {
  const url = `https://discord.com/api/v9/channels/${encodeURIComponent(channelId)}/messages`;
  const payload: any = { content: body, nonce: String(Date.now()), flags: 0 };
  const baseHeaders = await discordHeaders(token, true, undefined, accountId);
  if (guildId) {
    baseHeaders["x-context-properties"] = Buffer.from(
      JSON.stringify({ location: "Direct Message", location_guild_id: guildId }),
    ).toString("base64");
  }
  const first = await tlsFetch(url, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(payload),
    timeoutMs: 15_000,
    accountId,
  });
  const firstText = await first.text();
  if (first.ok) {
    let j: any = null;
    try { j = JSON.parse(firstText); } catch { /* */ }
    if (!j?.id) {
      return { ok: false, httpStatus: first.status, error: `2xx without message id: ${firstText.slice(0, 200)}`, via: "tls" };
    }
    return {
      ok: true, via: "tls", httpStatus: first.status,
      discordMessageId: String(j.id),
      body: String(j.content || body),
      sentAt: String(j.timestamp || new Date().toISOString()),
    };
  }
  let parsed: any = null;
  try { parsed = JSON.parse(firstText); } catch { /* */ }
  if (!parsed?.captcha_sitekey) {
    return { ok: false, httpStatus: first.status, error: parsed?.message || firstText.slice(0, 200), via: "tls" };
  }
  // Captcha challenge — solve via 2captcha using the account's assigned proxy so
  // the hCaptcha token IP matches the account's proxy IP.
  const sitekey = String(parsed.captcha_sitekey);
  const rqdata = String(parsed.captcha_rqdata || "");
  const rqtoken = String(parsed.captcha_rqtoken || "");
  const cs = await solveCaptchaForToken({ sitekey, pageUrl: CAPTCHA_PAGE_URL, rqdata, rqtoken, accountId });
  if (!cs.ok || !cs.token) {
    return { ok: false, httpStatus: first.status, error: `solver: ${cs.error}`, via: "tls+2captcha", costCents: cs.costCents };
  }
  const retryBody: any = { ...payload, captcha_key: cs.token, captcha_rqtoken: rqtoken || undefined };
  const retry = await tlsFetch(url, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(retryBody),
    timeoutMs: 15_000,
    accountId,
  });
  const retryText = await retry.text();
  if (retry.ok) {
    let j: any = null;
    try { j = JSON.parse(retryText); } catch { /* */ }
    if (!j?.id) {
      return { ok: false, httpStatus: retry.status, error: `2xx without message id (post-captcha): ${retryText.slice(0, 200)}`, via: "tls+2captcha", costCents: cs.costCents };
    }
    return {
      ok: true, via: "tls+2captcha", httpStatus: retry.status, costCents: cs.costCents,
      discordMessageId: String(j.id),
      body: String(j.content || body),
      sentAt: String(j.timestamp || new Date().toISOString()),
    };
  }
  let retryParsed: any = null;
  try { retryParsed = JSON.parse(retryText); } catch { /* */ }
  console.warn(`[send] captcha-retry failed account=${accountId} http=${retry.status} body=${retryText.slice(0, 500)}`);
  return {
    ok: false, httpStatus: retry.status, via: "tls+2captcha", costCents: cs.costCents,
    error: retryParsed?.message || retryText.slice(0, 200),
  };
}

/** Send a DM. Uses Playwright stealth (real Chrome fingerprint) when browser is
 *  enabled — no 2captcha, no relay needed. Falls back to TLS+2captcha when
 *  BROWSER_FETCH_ENABLED=0 (local dev without Chromium). */
export async function sendDiscordMessage(
  accountId: string,
  token: string,
  channelId: string,
  body: string,
  context: { campaignId?: string; recipientUserId?: string; recipientDisplayName?: string; originGuildId?: string } = {},
): Promise<SendResult> {
  if (!accountId || !token || !channelId || !body) {
    return { ok: false, error: "missing accountId/token/channelId/body" };
  }
  const result = browserFetchEnabled()
    ? await browserSend(accountId, token, channelId, body, context.originGuildId, context.recipientUserId, context.recipientDisplayName)
    : await tlsSendWithCaptcha(accountId, token, channelId, body, context.originGuildId);
  return result;
}

async function browserSend(
  accountId: string,
  token: string,
  channelId: string,
  content: string,
  guildId?: string,
  recipientUserId?: string,
  recipientDisplayName?: string,
): Promise<SendResult> {
  // Mutual-server DMs (warmup): use eval-fetch with x-context-properties guild
  // header — Discord skips captcha for mutual-server sends. Much faster than
  // navigating the full SPA (no page.goto needed, ~1s vs 20-30s).
  if (guildId) {
    try {
      const r = await browserSendMessage(accountId, token, channelId, content, guildId);
      const text = await r.text();
      if (r.ok) {
        let j: any = null;
        try { j = JSON.parse(text); } catch {}
        if (!j?.id) return { ok: false, httpStatus: r.status, error: `2xx but no message id: ${text.slice(0, 200)}`, via: "browser" };
        return { ok: true, via: "browser", httpStatus: r.status, discordMessageId: String(j.id), body: String(j.content || content), sentAt: String(j.timestamp || new Date().toISOString()) };
      }
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      if (r.status === 400 && parsed?.captcha_sitekey) {
        return { ok: false, httpStatus: 400, error: `captcha-unsolvable`, via: "browser" };
      }
      return { ok: false, httpStatus: r.status, error: parsed?.message || text.slice(0, 200), via: "browser" };
    } catch (err: any) {
      return { ok: false, error: `browser send threw: ${err?.message || err}`, via: "browser" };
    }
  }
  // Cold-contact / no guild context: drive Discord's UI so captcha modals are
  // visible in noVNC and the operator can solve them manually.
  try {
    const r = await browserSendDmViaUi(accountId, token, channelId, content, undefined, recipientUserId, recipientDisplayName, guildId);
    const text = await r.text();
    if (r.ok) {
      let j: any = null;
      try { j = JSON.parse(text); } catch {}
      if (!j?.id) return { ok: false, httpStatus: r.status, error: `2xx but no message id: ${text.slice(0, 200)}`, via: "browser" };
      return { ok: true, via: "browser", httpStatus: r.status, discordMessageId: String(j.id), body: String(j.content || content), sentAt: String(j.timestamp || new Date().toISOString()) };
    }
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    if (r.status === 400 && parsed?.captcha_sitekey) {
      console.warn(`[send] account=${accountId} UI-send captcha auto-solve failed — account flagged or 2captcha UNSOLVABLE`);
      return { ok: false, httpStatus: 400, error: `captcha-unsolvable`, via: "browser" };
    }
    return { ok: false, httpStatus: r.status, error: parsed?.message || text.slice(0, 200), via: "browser" };
  } catch (err: any) {
    return { ok: false, error: `browser send threw: ${err?.message || err}`, via: "browser" };
  }
}

// ───── Server-side wave (v0.24) ───────────────────────────────────────────
// Mimics what Discord's official "Wave to X" button does: open the DM channel
// (POST /users/@me/channels) then send the wave sticker (POST /channels/:id/
// messages with sticker_ids). This is Discord's intentional low-friction
// first-contact UX — anti-spam MAY treat it differently than a cold text DM.
// If it works without captcha, we have scalable cold-channel creation across
// any number of accounts.

const WAVE_STICKER_ID = "749054660769218631"; // Discord's "wave" sticker

export interface WaveResult {
  ok: boolean;
  channelId?: string;
  /** Indicates which step failed: channel-open vs sticker-send. */
  failedStep?: "channel" | "sticker";
  httpStatus?: number;
  error?: string;
}

/**
 * Server-side wave: open DM + send wave sticker via the account's token.
 * No UI, no Chromium — pure REST via cycletls (TLS-impersonated Chrome 124).
 * Returns ok=true when the wave sticker was delivered; the engine's existing
 * REST poller will import the resulting conversation within ~60s.
 */
export async function sendWaveTo(
  accountId: string,
  token: string,
  recipientUserId: string,
  recipientDisplayName?: string,
): Promise<WaveResult> {
  if (!token || !recipientUserId) return { ok: false, error: "missing token/userId" };
  // Open (or fetch existing) the DM channel via tlsFetch — lightweight, no
  // Chromium needed. The whole point of server-side wave is to scale to N
  // accounts without a browser context per-account.
  let channelId: string | null = null;
  {
    const r = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
      method: "POST",
      headers: await discordHeaders(token, true, undefined, accountId),
      body: JSON.stringify({ recipients: [recipientUserId] }),
      timeoutMs: 15_000,
      accountId,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, failedStep: "channel", httpStatus: r.status, error: body.slice(0, 200) };
    }
    try {
      const j = JSON.parse(await r.text());
      channelId = String(j.id || "");
    } catch (e: any) {
      return { ok: false, failedStep: "channel", error: `bad channel response: ${e?.message || e}` };
    }
  }
  if (!channelId) return { ok: false, failedStep: "channel", error: "empty channel id" };
  const ch = { ok: true, channelId };
  // Send the wave sticker. NOTE: we deliberately use tlsFetch (not browserFetch
  // / not browserSendDmViaUi). The sticker payload is the SAME thing Discord's
  // official client sends — anti-spam may not captcha-wall stickers the way it
  // does cold text DMs because the wave sticker is the intentional first-contact UX.
  const r = await tlsFetch(`https://discord.com/api/v9/channels/${encodeURIComponent(ch.channelId)}/messages`, {
    method: "POST",
    headers: await discordHeaders(token, true, undefined, accountId),
    body: JSON.stringify({
      sticker_ids: [WAVE_STICKER_ID],
      content: "",
      flags: 0,
      nonce: String(Date.now()),
    }),
    timeoutMs: 15_000,
    accountId,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch { /* */ }
    if (r.status === 400 && parsed?.captcha_sitekey) {
      console.log(`[wave] account=${accountId} sticker captcha — solving via 2captcha+proxy`);
      const cs = await solveCaptchaForToken({
        sitekey: String(parsed.captcha_sitekey),
        pageUrl: "https://discord.com/channels/@me",
        rqdata: parsed.captcha_rqdata || undefined,
        rqtoken: parsed.captcha_rqtoken || undefined,
        accountId,
      });
      if (!cs.ok || !cs.token) {
        return { ok: false, channelId: ch.channelId, failedStep: "sticker", error: `captcha solve failed: ${cs.error}` };
      }
      const retry = await tlsFetch(`https://discord.com/api/v9/channels/${encodeURIComponent(ch.channelId)}/messages`, {
        method: "POST",
        headers: await discordHeaders(token, true, undefined, accountId),
        body: JSON.stringify({ sticker_ids: [WAVE_STICKER_ID], content: "", flags: 0, nonce: String(Date.now()), captcha_key: cs.token, captcha_rqtoken: parsed.captcha_rqtoken || undefined }),
        timeoutMs: 15_000,
        accountId,
      });
      if (!retry.ok) {
        const retryText = await retry.text().catch(() => "");
        return { ok: false, channelId: ch.channelId, failedStep: "sticker", httpStatus: retry.status, error: retryText.slice(0, 200) };
      }
      return { ok: true, channelId: ch.channelId };
    }
    return { ok: false, channelId: ch.channelId, failedStep: "sticker", httpStatus: r.status, error: body.slice(0, 200) };
  }
  // Parse the sticker-send response. Discord returns the full message object on
  // success. If we don't get a real id back, the send didn't deliver and we
  // must NOT mark the lead as Sent — otherwise the Wave Queue lies to the
  // operator about progress (the original v0.25 false-positive bug).
  const okText = await r.text().catch(() => "");
  try {
    const j = JSON.parse(okText);
    if (!j?.id) {
      return { ok: false, channelId: ch.channelId, failedStep: "sticker", httpStatus: r.status, error: `2xx but no message id: ${okText.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { ok: false, channelId: ch.channelId, failedStep: "sticker", httpStatus: r.status, error: `2xx but unparseable: ${e?.message || e}` };
  }
  return { ok: true, channelId: ch.channelId };
}

// ───── Relationships (full friends + pending FR list) ─────────────────────────
export type RelationshipType =
  | "friend"   // 1
  | "blocked"  // 2
  | "incoming" // 3
  | "outgoing" // 4
  | "unknown";

const TYPE_TO_LABEL: Record<number, RelationshipType> = {
  1: "friend", 2: "blocked", 3: "incoming", 4: "outgoing",
};

export interface RelationshipRow {
  id: string;
  type: RelationshipType;
  since: string;
  user: {
    id: string;
    username: string;
    globalName: string | null;
    discriminator: string | null;
    avatarUrl: string | null;
  };
  nickname?: string | null;
}

function avatar(userId: string, hash: string | null | undefined): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128` : null;
}

export async function fetchRelationships(token: string, accountId?: string): Promise<RelationshipRow[]> {
  try {
    const r = await tlsFetch("https://discord.com/api/v9/users/@me/relationships", {
      method: "GET",
      headers: await discordHeaders(token, false, undefined, accountId),
      timeoutMs: 15_000,
      accountId,
    });
    if (!r.ok) {
      console.warn(`[relationships] HTTP ${r.status}`);
      return [];
    }
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr)) return [];
    return arr.map((row): RelationshipRow => ({
      id: String(row?.id || row?.user?.id || ""),
      type: TYPE_TO_LABEL[Number(row?.type)] || "unknown",
      since: String(row?.since || ""),
      user: {
        id: String(row?.user?.id || row?.id || ""),
        username: String(row?.user?.username || ""),
        globalName: row?.user?.global_name || null,
        discriminator: row?.user?.discriminator && row.user.discriminator !== "0" ? String(row.user.discriminator) : null,
        avatarUrl: avatar(row?.user?.id || row?.id || "", row?.user?.avatar),
      },
      nickname: row?.nickname || null,
    }));
  } catch (err: any) {
    console.warn(`[relationships] threw: ${err?.message || err}`);
    return [];
  }
}
