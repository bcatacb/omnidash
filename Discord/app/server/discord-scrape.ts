/**
 * Server-member scraper.
 *
 * Discord's REST `/guilds/{id}/members` is privileged — for user accounts it
 * returns 403 unless you're a server admin. The reliable path is the gateway
 * OP 8 REQUEST_GUILD_MEMBERS message + GUILD_MEMBERS_CHUNK responses, the
 * same mechanism Discord's own client uses to populate the member sidebar.
 *
 * We piggy-back on the already-running gateway connection per account
 * (see discord-gateway.ts) by attaching a temporary listener for
 * GUILD_MEMBERS_CHUNK events scoped to a specific nonce, then asking the
 * gateway to send a REQUEST_GUILD_MEMBERS for the guild.
 *
 * Discord rate-limits this to ~1 outstanding request per gateway connection
 * and chunks responses at 1000 members each. For huge guilds (10k+) the
 * scrape can take ~10-30s; we resolve once the final chunk arrives (chunk
 * index == chunk count - 1).
 */

import { ProxyAgent } from "undici";
import { randomBytes } from "node:crypto";
import {
  sendRequestGuildMembers,
  registerMembersChunkHandler,
  sendLazyGuildRequest,
  registerLazyGuildHandler,
} from "./discord-gateway";

import { discordHeaders as buildDiscordHeaders, tlsFetch } from "./discord-http";
import { browserFetch } from "./discord-browser";

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  approximateMemberCount: number | null;
  permissions: string;
  owner: boolean;
}

function guildIcon(id: string, hash: string | null | undefined): string | null {
  return hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.png?size=64` : null;
}

export async function listGuilds(token: string): Promise<GuildSummary[]> {
  try {
    // Use native fetch with a hard timeout — avoids cycletls/fingerprint overhead
    // for a simple read-only call that doesn't need Chrome TLS impersonation.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let r: Response;
    try {
      r = await fetch("https://discord.com/api/v9/users/@me/guilds?with_counts=true", {
        method: "GET",
        headers: {
          authorization: token,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          origin: "https://discord.com",
          referer: "https://discord.com/channels/@me",
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      console.warn(`[scrape] listGuilds HTTP ${r.status}`);
      return [];
    }
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr)) return [];
    return arr.map((g): GuildSummary => ({
      id: String(g.id),
      name: String(g.name || ""),
      iconUrl: guildIcon(String(g.id), g.icon),
      approximateMemberCount: typeof g.approximate_member_count === "number" ? g.approximate_member_count : null,
      permissions: String(g.permissions || ""),
      owner: !!g.owner,
    }));
  } catch (err: any) {
    console.warn(`[scrape] listGuilds threw: ${err?.message || err}`);
    return [];
  }
}

export interface ScrapedMember {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  avatarUrl: string | null;
  bot: boolean;
  nick: string | null;
}

const avatar = (uid: string, hash: string | null | undefined) =>
  hash ? `https://cdn.discordapp.com/avatars/${uid}/${hash}.png?size=64` : null;

/**
 * Scrape members for a guild this account is a member of. Returns once Discord
 * indicates the chunk stream is complete, or rejects on timeout (45s default).
 *
 * For guilds with > ~10k members, Discord may not return the full set in one
 * scrape — they cap GUILD_MEMBERS_CHUNK at ~1000 entries and you have to
 * paginate via `user_ids` / `query` filters. For v0.9 we accept whatever they
 * give us in one shot and report `truncated: true` if we hit the cap.
 */
export async function scrapeGuildMembers(
  accountId: string,
  guildId: string,
  onProgress?: (soFar: number, totalChunks: number) => void,
  options: { timeoutMs?: number } = {},
): Promise<{ members: ScrapedMember[]; truncated: boolean; chunks: number }> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const nonce = randomBytes(8).toString("hex");

  return new Promise((resolve, reject) => {
    const collected: ScrapedMember[] = [];
    let chunksReceived = 0;
    let expectedChunks = -1;
    let timeoutId: NodeJS.Timeout | null = null;
    let unsubscribe: (() => void) | null = null;

    const finish = (truncated: boolean) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      resolve({ members: collected, truncated, chunks: chunksReceived });
    };

    const fail = (err: Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      reject(err);
    };

    unsubscribe = registerMembersChunkHandler(accountId, nonce, (payload: any) => {
      const list = Array.isArray(payload?.members) ? payload.members : [];
      for (const m of list) {
        const u = m?.user;
        if (!u || u.bot) continue;
        collected.push({
          id: String(u.id),
          username: String(u.username || ""),
          globalName: u.global_name || null,
          discriminator: u.discriminator && u.discriminator !== "0" ? String(u.discriminator) : null,
          avatarUrl: avatar(String(u.id), u.avatar),
          bot: !!u.bot,
          nick: m?.nick || null,
        });
      }
      chunksReceived += 1;
      if (typeof payload?.chunk_count === "number") expectedChunks = payload.chunk_count;
      if (onProgress) onProgress(collected.length, expectedChunks);
      const isLast =
        typeof payload?.chunk_index === "number" &&
        typeof payload?.chunk_count === "number" &&
        payload.chunk_index >= payload.chunk_count - 1;
      if (isLast) finish(false);
    });

    timeoutId = setTimeout(() => {
      // Resolve with what we got rather than reject — partial data still useful.
      console.warn(`[scrape] guild=${guildId} timeout after ${timeoutMs}ms; got ${collected.length} members in ${chunksReceived} chunks`);
      finish(true);
    }, timeoutMs);

    const sent = sendRequestGuildMembers(accountId, guildId, nonce);
    if (!sent) fail(new Error("gateway not connected for this account"));
  });
}

// ───── Join via invite link ──────────────────────────────────────────────────
const INVITE_CODE_RE = /(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)?([a-zA-Z0-9-]{2,32})$/i;

export function extractInviteCode(input: string): string | null {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;
  // Strip trailing slashes / query strings.
  const cleaned = trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const m = cleaned.match(INVITE_CODE_RE);
  return m ? m[1] : null;
}

export interface JoinInviteResult {
  ok: boolean;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  error?: string;
  httpStatus?: number;
  // v0.46: when Discord captcha-walls the join, the response includes
  // captcha_sitekey + captcha_rqdata; we surface these so the operator can
  // solve via the existing hCaptcha widget and retry with captcha_key.
  captcha?: { sitekey: string; rqdata: string; rqtoken: string; service: string };
}

/**
 * Use a Discord invite code/URL to join the target guild as the captured user account.
 * Discord endpoint: POST /api/v9/invites/{code} with empty body. Returns invite object
 * (including guild) on success, or {code, message} on error (404/403/expired/etc).
 *
 * v0.46 captcha support: if Discord returns a captcha challenge, the result
 * includes the prompt instead of throwing — the caller solves via hCaptcha
 * and retries with captchaKey + captchaRqtoken.
 */
export async function joinByInvite(
  token: string,
  invite: string,
  captchaKey?: string,
  captchaRqtoken?: string,
  accountId?: string,
): Promise<JoinInviteResult> {
  const code = extractInviteCode(invite);
  if (!code) return { ok: false, error: "couldn't parse invite — paste discord.gg/<code> or https://discord.gg/<code>" };
  const url = `https://discord.com/api/v9/invites/${encodeURIComponent(code)}`;
  try {
    const body: any = { session_id: null };
    if (captchaKey) body.captcha_key = captchaKey;
    if (captchaRqtoken) body.captcha_rqtoken = captchaRqtoken;
    const r = await tlsFetch(url, {
      method: "POST",
      headers: await buildDiscordHeaders(token, true),
      body: JSON.stringify(body),
      timeoutMs: 20_000,
      accountId,
    });
    const bodyText = await r.text();
    if (!r.ok) {
      let parsed: any = null;
      try { parsed = JSON.parse(bodyText); } catch { /* noop */ }
      if (parsed?.captcha_sitekey) {
        return {
          ok: false,
          httpStatus: r.status,
          captcha: {
            sitekey: String(parsed.captcha_sitekey),
            rqdata: String(parsed.captcha_rqdata || ''),
            rqtoken: String(parsed.captcha_rqtoken || ''),
            service: String(parsed.captcha_service || 'hcaptcha'),
          },
          error: 'captcha required',
        };
      }
      const msg = parsed?.message || parsed?.errors?._errors?.[0]?.message || bodyText.slice(0, 160);
      return { ok: false, httpStatus: r.status, error: msg };
    }
    const j = (bodyText ? JSON.parse(bodyText) : {}) as any;
    return {
      ok: true,
      guildId: j?.guild?.id ? String(j.guild.id) : undefined,
      guildName: j?.guild?.name ? String(j.guild.name) : undefined,
      channelId: j?.channel?.id ? String(j.channel.id) : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ───── Large-guild scrape via OP 14 LAZY_GUILD_REQUEST ──────────────────────
// Discord's own web client uses this for any guild bigger than ~75 members.
// OP 8 with `query='' limit=0` silently fails for those — Discord just doesn't
// chunk back. OP 14 is range-paginated: ask for [0,99], [100,199], … until we
// cover member_count. Each response (GUILD_MEMBER_LIST_UPDATE) contains a SYNC
// op with up to 100 members for the requested range.

// Channel ID cache: once fetched per guild, reuse across scrape sessions.
// Real Discord clients cache this too — re-fetching every session is a detection signal.
const _channelCache = new Map<string, string>(); // guildId → channelId

async function pickGuildChannel(token: string, guildId: string): Promise<string | null> {
  const cached = _channelCache.get(guildId);
  if (cached) return cached;
  try {
    const r = await tlsFetch(`https://discord.com/api/v9/guilds/${guildId}/channels`, {
      method: "GET",
      headers: await buildDiscordHeaders(token),
      timeoutMs: 10_000,
    });
    if (!r.ok) {
      console.warn(`[scrape] guild=${guildId} GET /channels HTTP ${r.status} — likely no permission to list channels`);
      return null;
    }
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr)) return null;
    const textChannels = arr.filter((c) => c?.type === 0);
    console.log(`[scrape] guild=${guildId} discovered ${arr.length} total channels, ${textChannels.length} text — first 3: ${textChannels.slice(0, 3).map((c) => `${c.name}(${c.id})`).join(", ")}`);
    const text = textChannels[0];
    const channelId = text?.id ? String(text.id) : (arr[0]?.id ? String(arr[0].id) : null);
    if (channelId) _channelCache.set(guildId, channelId);
    return channelId;
  } catch (err: any) {
    console.warn(`[scrape] pickGuildChannel threw: ${err?.message || err}`);
    return null;
  }
}

async function scrapeViaLazyGuild(
  accountId: string,
  guildId: string,
  channelId: string,
  options: { timeoutMs?: number } = {},
): Promise<{ members: ScrapedMember[]; truncated: boolean; chunks: number }> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const collected = new Map<string, ScrapedMember>();
  let memberCount = 0;
  let chunks = 0;

  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let rangeCursor = 0;
    let stalled = 0;

    const finish = (truncated: boolean) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      resolve({ members: Array.from(collected.values()), truncated, chunks });
    };

    unsubscribe = registerLazyGuildHandler(accountId, guildId, (payload: any) => {
      chunks++;
      if (typeof payload?.member_count === "number") memberCount = payload.member_count;
      const ops = Array.isArray(payload?.ops) ? payload.ops : [];
      let touched = false;
      for (const op of ops) {
        const items = op?.op === "SYNC" ? op.items : op?.op === "INSERT" ? [op.item] : [];
        for (const it of items || []) {
          const u = it?.member?.user;
          if (!u || u.bot) continue;
          if (collected.has(String(u.id))) continue;
          collected.set(String(u.id), {
            id: String(u.id),
            username: String(u.username || ""),
            globalName: u.global_name || null,
            discriminator: u.discriminator && u.discriminator !== "0" ? String(u.discriminator) : null,
            avatarUrl: avatar(String(u.id), u.avatar),
            bot: !!u.bot,
            nick: it?.member?.nick || null,
          });
          touched = true;
        }
      }

      // Move the range cursor forward and request the next page if there's more.
      if (touched) stalled = 0; else stalled++;
      if (memberCount > 0 && collected.size >= memberCount) {
        finish(false);
        return;
      }
      if (stalled >= 3) {
        // Three responses without new members — server isn't paging us further.
        finish(true);
        return;
      }
      // Request the next range in 100-member windows, with a human-like delay.
      // Real clients wait for the user to scroll before requesting the next page.
      rangeCursor += 100;
      const next: [number, number][] = [
        [rangeCursor, rangeCursor + 99],
        [rangeCursor + 100, rangeCursor + 199],
        [rangeCursor + 200, rangeCursor + 299],
      ];
      rangeCursor += 200; // we'll advance by 300 per cycle
      const delayMs = 900 + Math.floor(Math.random() * 1400); // 0.9 – 2.3s
      setTimeout(() => sendLazyGuildRequest(accountId, guildId, channelId, next), delayMs);
    });

    timeoutId = setTimeout(() => {
      console.warn(`[scrape-lazy] guild=${guildId} timeout after ${timeoutMs}ms; got ${collected.size}/${memberCount || "?"} in ${chunks} updates`);
      finish(true);
    }, timeoutMs);

    // Kick off with the first 3 ranges (0-299) — gets us paging fast.
    const sent = sendLazyGuildRequest(accountId, guildId, channelId, [[0, 99], [100, 199], [200, 299]]);
    if (!sent) finish(true);
    rangeCursor = 300;
  });
}

/**
 * Public wrapper: try OP 8 first (fast for small guilds), fall back to OP 14
 * if the result was empty or tiny relative to the guild's known member count.
 */
export async function scrapeGuildMembersSmart(
  accountId: string,
  guildId: string,
  approximateMemberCount: number | null,
  token: string,
): Promise<{ members: ScrapedMember[]; truncated: boolean; chunks: number; via: "op8" | "op14" }> {
  // For large guilds (>500 members), skip OP 8 entirely.
  // OP 8 with limit=0 is a well-known self-bot signal, and it returns nothing
  // useful for large guilds anyway. Going straight to OP 14 reduces the
  // number of suspicious gateway opcodes per scrape session.
  const isLargeGuild = approximateMemberCount !== null && approximateMemberCount > 500;

  if (!isLargeGuild) {
    // Step 1: try OP 8 (fast, fine for small guilds).
    const op8 = await scrapeGuildMembers(accountId, guildId, undefined, { timeoutMs: 30_000 });
    if (op8.members.length > 0 && (approximateMemberCount == null || op8.members.length >= Math.min(approximateMemberCount, 75) * 0.7)) {
      return { ...op8, via: "op8" };
    }
    console.log(`[scrape] guild=${guildId} OP 8 returned ${op8.members.length} (approx total ${approximateMemberCount ?? "?"}); falling back to OP 14`);
  } else {
    console.log(`[scrape] guild=${guildId} large guild (${approximateMemberCount} members) — skipping OP 8, going straight to OP 14`);
  }

  // Step 2 (or Step 1 for large guilds): OP 14.
  const channelId = await pickGuildChannel(token, guildId);
  if (!channelId) {
    console.warn(`[scrape] guild=${guildId} no accessible channel for OP 14 — returning empty result`);
    return { members: [], truncated: true, chunks: 0, via: "op14" };
  }
  const op14 = await scrapeViaLazyGuild(accountId, guildId, channelId);
  return {
    members: op14.members,
    truncated: op14.truncated,
    chunks: op14.chunks,
    via: "op14",
  };
}

/**
 * GET-only lookup for an existing 1:1 DM channel with a given user. Unlike
 * openDmChannel (POST /users/@me/channels), this hits the safe GET endpoint
 * which Discord doesn't captcha-wall. Used before the engine falls back to
 * actually opening a new channel — lets us catch DMs the user manually
 * opened in real Discord but that haven't reached our REST poller yet.
 */
export async function findLiveDmChannel(token: string, userId: string): Promise<{ channelId: string | null; httpStatus?: number; error?: string }> {
  try {
    const r = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
      method: "GET",
      headers: await buildDiscordHeaders(token),
      timeoutMs: 12_000,
    });
    if (!r.ok) {
      const body = await r.text();
      return { channelId: null, httpStatus: r.status, error: body.slice(0, 200) };
    }
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr)) return { channelId: null };
    for (const ch of arr) {
      if (ch?.type !== 1) continue;
      const recipients: any[] = Array.isArray(ch.recipients) ? ch.recipients : [];
      if (recipients.length === 1 && String(recipients[0]?.id || "") === userId) {
        return { channelId: String(ch.id) };
      }
    }
    return { channelId: null };
  } catch (err: any) {
    return { channelId: null, error: String(err?.message || err) };
  }
}

/** Open (or fetch existing) DM channel with a given user. Returns channel_id on success.
 *  Captcha-required responses surface as raw 400 — the engine panic-pauses.
 *  Routed through discord-browser per account so Discord sees a real Chromium
 *  fingerprint + cookies + SPA-bound session. */
export async function openDmChannel(
  accountId: string,
  token: string,
  userId: string,
): Promise<{ ok: boolean; channelId?: string; error?: string; httpStatus?: number }> {
  try {
    const r = await browserFetch(accountId, token, "https://discord.com/api/v9/users/@me/channels", {
      method: "POST",
      headers: await buildDiscordHeaders(token, true),
      body: JSON.stringify({ recipients: [userId] }),
      timeoutMs: 15_000,
    });
    const body = await r.text();
    if (!r.ok) return { ok: false, httpStatus: r.status, error: body.slice(0, 200) };
    const j = JSON.parse(body) as { id: string };
    return { ok: true, channelId: String(j.id) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}
