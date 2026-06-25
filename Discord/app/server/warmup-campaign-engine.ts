// warmup-campaign-engine.ts — continuous inter-account warmup tick loop.
// Open-ended: no graduation, no auto-quarantine, no end date. Operator
// cancels the campaign manually. On 401, set dead_since to cheaply skip the
// account on future ticks; the operator can paste a fresh token and the
// gateway-ready hook clears dead_since.

import * as db from "./db";
import { expand, dailySeed } from "./spintax";
import { tlsFetch, discordHeaders } from "./discord-http";
import { publishExternalEvent } from "./realtime";
import { browserOpenDmChannel, browserFetchEnabled } from "./discord-browser";
import { solveCaptchaForToken } from "./captcha";

async function autoRestIfOverLimit(accountId: string): Promise<void> {
  try {
    const count = await db.getAccount24hActionCount(accountId, "warmup_sent");
    if (count >= 15) {
      await db.restAccount(accountId);
      publishExternalEvent({ type: "account_status", accountId, status: "resting", ts: new Date().toISOString() } as any);
      console.log(`[auto-rest] account=${accountId} rested — warmup_sent=${count} hit limit 15`);
    }
  } catch (err: any) {
    console.warn(`[auto-rest] failed account=${accountId}: ${err?.message}`);
  }
}

const TICK_MS = 30_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

// In-memory fallback for next_eligible_at — prevents send bursts if DB writes fail.
// Key: `${campaignId}:${accountId}`, value: ms timestamp when eligible again.
const memNextEligible = new Map<string, number>();

// Per-campaign timestamp of the last successful send (any account).
// Used to enforce between_account_interval_minutes — ensures a minimum gap
// between any two sends across the whole campaign.
const memLastCampaignSend = new Map<string, number>(); // campaignId → ms

// Seed the per-campaign between-account timer from the DB so a redeploy doesn't
// reset the in-memory gate to 0 and let the first tick fire immediately.
async function seedLastSendFromDb(): Promise<void> {
  try {
    const last = await db.getLastWarmupSendPerCampaign();
    for (const [campaignId, ts] of last) memLastCampaignSend.set(campaignId, ts);
    if (last.size > 0) console.log(`[warmup-campaign-engine] seeded between-account timer for ${last.size} campaigns from DB`);
  } catch (err: any) {
    console.warn(`[warmup-campaign-engine] could not seed last-send timer: ${err?.message || err}`);
  }
}

export function startWarmupCampaignEngine(): void {
  if (running) return;
  running = true;
  console.log("[warmup-campaign-engine] starting (tick=30s)");
  const tick = async () => {
    if (!running) return;
    try { await runOneTick(); }
    catch (err: any) { console.warn(`[warmup-campaign-engine] tick failed: ${err?.message || err}`); }
    timer = setTimeout(tick, TICK_MS);
  };
  void seedLastSendFromDb().finally(() => { void tick(); });
}

export function stopWarmupCampaignEngine(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  console.log("[warmup-campaign-engine] stopped");
}

async function runOneTick(): Promise<void> {
  const campaigns = await db.listWarmupCampaigns();
  for (const c of campaigns) {
    if (c.status !== "running") continue;
    if (!isInsideActiveHours(c.active_hours_start_utc, c.active_hours_end_utc)) continue;
    await handleCampaign(c);
  }
}

function isInsideActiveHours(startUtcHr: number, endUtcHr: number): boolean {
  // 0,0 or 0,24 means 24/7 — always active.
  if (startUtcHr === 0 && (endUtcHr === 0 || endUtcHr >= 24)) return true;
  const hr = new Date().getUTCHours();
  if (startUtcHr < endUtcHr) return hr >= startUtcHr && hr < endUtcHr;
  return hr >= startUtcHr || hr < endUtcHr;
}

async function handleCampaign(c: db.WarmupCampaignRow): Promise<void> {
  const accounts = await db.listWarmupCampaignAccounts(c.id);
  const pairs = await db.listWarmupCampaignPairs(c.id);
  // Accounts quarantined/retired by the warmup state machine must never be sent
  // on, even if their per-campaign dead_since was cleared by a stray READY.
  const blockedIds = await db.listBlockedAccountIds();
  const now = Date.now();
  const busyThisTick = new Set<string>();
  // Round-robin fairness: sort by the latest cooldown timestamp (DB or in-memory),
  // so never-sent accounts always go before recently-sent ones. Without this the
  // engine keeps cycling through the same first N accounts (where N ≈
  // per_account_cooldown / between_account_interval) and ignores the rest.
  const sortedAccounts = [...accounts].sort((a, b) => {
    const aDb = a.next_eligible_at ? new Date(a.next_eligible_at).getTime() : 0;
    const bDb = b.next_eligible_at ? new Date(b.next_eligible_at).getTime() : 0;
    const aMs = Math.max(aDb, memNextEligible.get(`${c.id}:${a.account_id}`) ?? 0);
    const bMs = Math.max(bDb, memNextEligible.get(`${c.id}:${b.account_id}`) ?? 0);
    return aMs - bMs;
  });
  for (const acct of sortedAccounts) {
    if (acct.dead_since) continue;
    if (blockedIds.has(acct.account_id)) continue;
    // Skip accounts not confirmed in the campaign's guild. Guards against
    // accounts being added to the campaign before they joined the server.
    // Only skip when we have actual guild data (guilds.length > 0) — an empty
    // list means the gateway hasn't finished the READY event for this account.
    if (c.guild_id) {
      const { getAccountGuilds } = await import("./discord-gateway");
      const guilds = getAccountGuilds(acct.account_id);
      if (guilds.length > 0 && !guilds.some((g) => g.id === c.guild_id)) {
        console.log(`[warmup-campaign-engine] account=${acct.account_id} not in guild=${c.guild_id} — skipping (confirmed in ${guilds.length} other guilds)`);
        continue;
      }
    }
    if (acct.next_eligible_at && new Date(acct.next_eligible_at).getTime() > now) continue;
    const memKey = `${c.id}:${acct.account_id}`;
    const memNext = memNextEligible.get(memKey);
    if (memNext && memNext > now) continue;
    if (busyThisTick.has(acct.account_id)) continue;
    // Between-account cooldown — enforce campaign-wide minimum gap between any two sends.
    const betweenMs = c.between_account_interval_minutes * 60_000;
    if (betweenMs > 0) {
      const lastSend = memLastCampaignSend.get(c.id) ?? 0;
      const elapsed = Date.now() - lastSend;
      if (elapsed < betweenMs) {
        const waitSecs = Math.round((betweenMs - elapsed) / 1000);
        console.log(`[warmup-campaign-engine] campaign=${c.id} between-account cooldown — next send in ${waitSecs}s`);
        break; // no more sends this tick for this campaign
      }
    }
    // Daily cap — count sends in the last 24 h for this account.
    const sendsToday = await db.countWarmupSendsInWindow(c.id, acct.account_id, 24 * 60 * 60_000);
    if (sendsToday >= c.daily_send_cap) {
      console.log(`[warmup-campaign-engine] account=${acct.account_id} hit daily cap (${sendsToday}/${c.daily_send_cap}) — skipping until tomorrow`);
      await db.setAccountNextEligible(c.id, acct.account_id, new Date(Date.now() + 60 * 60_000).toISOString());
      publishExternalEvent({ type: "warmup_daily_cap", campaignId: c.id, accountId: acct.account_id, sendsToday, cap: c.daily_send_cap, ts: new Date().toISOString() } as any);
      continue;
    }
    await fireOneSend(c, acct, accounts, pairs, busyThisTick);
  }
}

async function fireOneSend(
  c: db.WarmupCampaignRow,
  acct: db.WarmupCampaignAccountRow,
  accounts: db.WarmupCampaignAccountRow[],
  pairs: db.WarmupCampaignPairRow[],
  busyThisTick: Set<string>,
): Promise<void> {
  // Mark sender busy immediately so no other path in this tick targets them.
  busyThisTick.add(acct.account_id);

  const myPairs = pairs.filter(
    (p) => !p.paused_reason &&
      (p.account_a_id === acct.account_id || p.account_b_id === acct.account_id),
  );
  const livePartnerIds = new Set(accounts.filter((a) => !a.dead_since).map((a) => a.account_id));
  const candidates = myPairs.filter((p) => {
    const partnerId = p.account_a_id === acct.account_id ? p.account_b_id : p.account_a_id;
    // Skip partners already involved in a send this tick (prevents double-text).
    return livePartnerIds.has(partnerId) && !busyThisTick.has(partnerId);
  });
  if (candidates.length === 0 || !acct.message_bank || acct.message_bank.length === 0) {
    await rescheduleNext(c, acct.account_id);
    return;
  }
  // Prefer pairs where we owe a reply (back-and-forth conversation).
  const pendingReplyCandidates = candidates.filter((p) => p.pending_reply_from === acct.account_id);
  const pool = pendingReplyCandidates.length > 0 ? pendingReplyCandidates : candidates;
  const pair = pool[Math.floor(Math.random() * pool.length)]!
  const partnerId = pair.account_a_id === acct.account_id ? pair.account_b_id : pair.account_a_id;
  // Lock the partner out for the rest of this tick immediately — before any
  // async work — so the outer loop doesn't fire them too.
  busyThisTick.add(partnerId);
  const tpl = acct.message_bank[Math.floor(Math.random() * acct.message_bank.length)]!;
  const seed = dailySeed([c.id, acct.account_id, partnerId, String(Date.now())]);
  const content = expand(tpl, seed).slice(0, 1000);

  const allAccts = await db.loadAllAccounts({ sendableOnly: true });
  const senderEntry = allAccts.find((a) => a.account.id === acct.account_id);
  if (!senderEntry?.token || senderEntry.account.status === "token_revoked") {
    await db.setAccountDeadSince(c.id, acct.account_id, new Date().toISOString());
    const reason = !senderEntry?.token
      ? "No token found — paste a fresh token to bring this account back."
      : "Token revoked by Discord — paste a fresh token to put this account back online.";
    console.warn(`[warmup-campaign-engine] account=${acct.account_id} ${!senderEntry?.token ? "no token" : "status=token_revoked"} — dead_since set`);
    publishExternalEvent({ type: "warmup_account_dead", campaignId: c.id, accountId: acct.account_id, reason, ts: new Date().toISOString() } as any);
    return;
  }

  // partnerId is our internal account ID — look up the Discord user ID to open the DM.
  const partnerEntry = allAccts.find((a) => a.account.id === partnerId);
  const partnerDiscordUserId = partnerEntry?.discordUserId;
  if (!partnerDiscordUserId) {
    console.warn(`[warmup-campaign-engine] partner=${partnerId} has no Discord user ID — skipping`);
    await rescheduleNext(c, acct.account_id);
    return;
  }

  // Never send to ourselves — guard against pairs where both accounts share the same Discord user ID.
  const senderDiscordUserId = senderEntry.discordUserId;
  if (senderDiscordUserId && partnerDiscordUserId === senderDiscordUserId) {
    console.warn(`[warmup-campaign-engine] self-send blocked campaign=${c.id} account=${acct.account_id} partner=${partnerId} — same Discord user ID`);
    await rescheduleNext(c, acct.account_id);
    return;
  }

  const isSenderSideA = acct.account_id === pair.account_a_id;
  const cachedChannelId = isSenderSideA ? pair.channel_id_a_to_b : pair.channel_id_b_to_a;
  let channelId = cachedChannelId;
  if (!channelId) {
    let openRes: { ok: boolean; channelId?: string; token4004?: boolean; captchaChallenged?: boolean; privacyBlocked?: boolean; error?: string };
    if (browserFetchEnabled()) {
      try {
        openRes = await browserOpenDmChannel(acct.account_id, senderEntry.token, partnerDiscordUserId, c.guild_id || undefined);
      } catch (browserErr: any) {
        console.warn(`[warmup-campaign-engine] account=${acct.account_id} browser channel-open threw (${String(browserErr?.message || browserErr).slice(0, 80)}) — TLS fallback`);
        openRes = await openDmChannel(senderEntry.token, partnerDiscordUserId, acct.account_id, c.guild_id || undefined);
      }
    } else {
      openRes = await openDmChannel(senderEntry.token, partnerDiscordUserId, acct.account_id, c.guild_id || undefined);
    }
    if (!openRes.ok || !openRes.channelId) {
      if (openRes.token4004) {
        await db.setAccountDeadSince(c.id, acct.account_id, new Date().toISOString());
        console.warn(`[warmup-campaign-engine] account=${acct.account_id} 401 on channel-open — dead_since set`);
        publishExternalEvent({ type: "warmup_account_dead", campaignId: c.id, accountId: acct.account_id, reason: "Token revoked by Discord — paste a fresh token to put this account back online.", ts: new Date().toISOString() } as any);
        return;
      }
      if (openRes.captchaChallenged) {
        // Cold-contact channel-open blocked by captcha. Retry after 45 min.
        const cooldownMs = 45 * 60_000;
        const nextEligible = new Date(Date.now() + cooldownMs).toISOString();
        memNextEligible.set(`${c.id}:${acct.account_id}`, Date.now() + cooldownMs);
        await db.setAccountNextEligible(c.id, acct.account_id, nextEligible);
        publishExternalEvent({
          type: "warmup_account_dead" as any,
          campaignId: c.id,
          accountId: acct.account_id,
          reason: "Captcha on DM open — accounts need a mutual Discord server. Set a server in the Discord Server card on this campaign.",
          ts: new Date().toISOString(),
        } as any);
        return;
      }
      if (openRes.privacyBlocked) {
        // Recipient's privacy settings block DMs from non-friends/non-server-members.
        // Pause the pair — won't recover without a mutual server or friend request.
        await db.pauseWarmupPair(c.id, pair.account_a_id, pair.account_b_id, `privacy: ${openRes.error?.slice(0, 80)}`);
        return;
      }
      await rescheduleNext(c, acct.account_id);
      return;
    }
    channelId = openRes.channelId;
    await db.updatePairChannelId(c.id, pair.account_a_id, pair.account_b_id,
      isSenderSideA ? "a_to_b" : "b_to_a", channelId);
  }

  // Jitter before send — uniform machine-speed sends are easy for Discord to detect.
  await new Promise((r) => setTimeout(r, 1_000 + Math.random() * 4_000)); // 1–5s

  const { sendDiscordMessage } = await import("./discord-send");
  const result = await sendDiscordMessage(acct.account_id, senderEntry.token, channelId, content, {
    recipientUserId: partnerDiscordUserId,
    originGuildId: c.guild_id || undefined,
  });
  // Only record a captcha as "solved" when the send actually succeeded through
  // the 2captcha path — a failed 2captcha attempt was logging captchaSolved=true.
  const captchaSolved = result.ok && result.via === "tls+2captcha";
  try {
    await db.recordWarmupMessage({
      campaignId: c.id,
      senderAccountId: acct.account_id,
      recipientAccountId: partnerId,
      content,
      ok: result.ok,
      httpStatus: result.httpStatus,
      captchaSolved,
      costCents: result.costCents || 0,
      error: result.ok ? undefined : result.error,
    });
  } catch (err: any) {
    console.warn(`[warmup-campaign-engine] recordWarmupMessage failed campaign=${c.id} account=${acct.account_id}: ${err?.message || err}`);
  }
  if (result.ok) {
    db.logActivity(acct.account_id, "warmup_sent", { campaignId: c.id, partnerId, via: result.via || "" });
    autoRestIfOverLimit(acct.account_id).catch(() => {});
    publishExternalEvent({
      type: "warmup_msg_sent",
      campaignId: c.id,
      accountId: acct.account_id,
      partnerId,
      senderLabel: senderEntry.account.label || senderEntry.account.username || acct.account_id.slice(0, 8),
      partnerLabel: partnerEntry?.account.label || partnerEntry?.account.username || partnerId.slice(0, 8),
      ts: new Date().toISOString(),
    } as any);
    memLastCampaignSend.set(c.id, Date.now());
    // recordWarmupMessage above already inserted this send, so the DISTINCT
    // count includes the current partner.
    const partnerCount = await db.countDistinctWarmupPartners(c.id, acct.account_id);
    await db.incrementAccountSendCount(c.id, acct.account_id, partnerCount);
    await db.incrementPairCount(c.id, pair.account_a_id, pair.account_b_id, acct.account_id);

    // Back-and-forth: mark the partner as owing a reply on their NEXT natural turn.
    // No fast-tracking — let the configured interval govern the pace.
    await db.setPendingReply(c.id, pair.account_a_id, pair.account_b_id, partnerId);

  } else {
    if (result.httpStatus === 401) {
      await db.setAccountDeadSince(c.id, acct.account_id, new Date().toISOString());
      console.warn(`[warmup-campaign-engine] account=${acct.account_id} 401 on send — dead_since set`);
      publishExternalEvent({ type: "warmup_account_dead", campaignId: c.id, accountId: acct.account_id, reason: "Token revoked by Discord — paste a fresh token to put this account back online.", ts: new Date().toISOString() } as any);
      return;
    } else if (result.via === "tls+2captcha" || result.error === "captcha-unsolvable" || (result.httpStatus === 400 && /captcha/i.test(result.error || ""))) {
      // Captcha challenge on send — apply 45-min cooldown and retry.
      // Root cause is usually no mutual Discord server. 45 min lets accounts
      // recover overnight without sitting idle for 4 hours.
      const cooldownMs = 45 * 60_000;
      await db.setAccountNextEligible(c.id, acct.account_id, new Date(Date.now() + cooldownMs).toISOString());
      console.warn(`[warmup-campaign-engine] account=${acct.account_id} captcha on send (via=${result.via}) — 45min cooldown. Ensure accounts share a mutual Discord server.`);
      return;
    } else if (!result.ok && result.via === "browser") {
      // Browser send failed for a non-captcha reason (e.g. editor not found, navigation error).
      // Short 5-minute cooldown so the engine retries soon rather than hammering or giving up.
      console.warn(`[warmup-campaign-engine] account=${acct.account_id} browser send failed: ${result.error}`);
      const cooldownMs = 5 * 60_000;
      await db.setAccountNextEligible(c.id, acct.account_id, new Date(Date.now() + cooldownMs).toISOString());
      publishExternalEvent({ type: "warmup_browser_failed" as any, campaignId: c.id, accountId: acct.account_id, partnerId, senderLabel: senderEntry.account.label || senderEntry.account.username || acct.account_id.slice(0, 8), error: result.error || "unknown", ts: new Date().toISOString() } as any);
      return;
    } else if (result.httpStatus === 429) {
      const m = (result.error || "").match(/"retry_after"\s*:\s*([\d.]+)/);
      const retryAfterSec = m ? Number(m[1]) : 120;
      const cooldownMs = Math.max(retryAfterSec * 1000, 120_000) + 5_000;
      await db.setAccountNextEligible(c.id, acct.account_id, new Date(Date.now() + cooldownMs).toISOString());
      const mins = Math.round(cooldownMs / 60_000);
      console.warn(`[warmup-campaign-engine] account=${acct.account_id} 429 — cooldown ${Math.round(cooldownMs / 1000)}s`);
      publishExternalEvent({ type: "warmup_rate_limited", campaignId: c.id, accountId: acct.account_id, cooldownMinutes: mins, reason: `Discord rate-limited this account — it will resume automatically in ${mins} minute${mins !== 1 ? "s" : ""}.`, ts: new Date().toISOString() } as any);
      return;
    } else if (result.httpStatus === 400 && /50009|cost.*high|privacy/i.test(result.error || "")) {
      await db.pauseWarmupPair(c.id, pair.account_a_id, pair.account_b_id,
        `recipient_privacy: ${result.error?.slice(0, 120)}`);
      await db.setPendingReply(c.id, pair.account_a_id, pair.account_b_id, null);
      publishExternalEvent({ type: "warmup_pair_paused", campaignId: c.id, accountId: acct.account_id, partnerId, reason: "This pair can no longer DM each other — they need a shared Discord server. The pair has been paused.", ts: new Date().toISOString() } as any);
    }
  }
  await rescheduleNext(c, acct.account_id);
}

async function rescheduleNext(c: db.WarmupCampaignRow, accountId: string): Promise<void> {
  const minMs = Math.max(60_000, c.per_account_interval_min_minutes * 60_000); // floor: 1 minute
  const maxMs = Math.max(minMs, c.per_account_interval_max_minutes * 60_000);
  const jitter = Math.floor(minMs + Math.random() * (maxMs - minMs));
  const nextTs = Date.now() + jitter;
  // Always update in-memory gate first — guards against send bursts if DB write fails.
  memNextEligible.set(`${c.id}:${accountId}`, nextTs);
  try {
    await db.setAccountNextEligible(c.id, accountId, new Date(nextTs).toISOString());
  } catch (err: any) {
    console.warn(`[warmup] rescheduleNext DB write failed for account=${accountId}: ${err?.message || err} — in-memory gate active`);
  }
}

async function openDmChannel(
  token: string, recipientUserId: string, senderAccountId: string, guildId?: string,
): Promise<{ ok: boolean; channelId?: string; token4004?: boolean; captchaChallenged?: boolean; privacyBlocked?: boolean; error?: string }> {
  try {
    const baseHeaders = await discordHeaders(token, true, undefined, senderAccountId);
    const extraHeaders: Record<string, string> = {};
    if (guildId) {
      const ctx = Buffer.from(JSON.stringify({ location: "User Profile", location_guild_id: guildId })).toString("base64");
      extraHeaders["x-context-properties"] = ctx;
    }
    const r = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
      method: "POST",
      headers: { ...baseHeaders, ...extraHeaders },
      body: JSON.stringify({ recipients: [recipientUserId] }),
      timeoutMs: 15_000,
      accountId: senderAccountId,
    });
    const text = await r.text();
    if (!r.ok) {
      if (r.status === 401) return { ok: false, token4004: true, error: text.slice(0, 200) };
      if (r.status === 400) {
        let parsed: any = {};
        try { parsed = JSON.parse(text); } catch {}
        if (parsed?.captcha_sitekey) {
          console.log(`[warmup-campaign-engine] account=${senderAccountId} captcha on channel-open — solving via 2captcha`);
          const cs = await solveCaptchaForToken({
            sitekey: String(parsed.captcha_sitekey),
            pageUrl: "https://discord.com/channels/@me",
            rqdata: parsed.captcha_rqdata || undefined,
            rqtoken: parsed.captcha_rqtoken || undefined,
            accountId: senderAccountId,
          });
          if (cs.ok && cs.token) {
            const retryBody: any = { recipients: [recipientUserId], captcha_key: cs.token };
            if (parsed.captcha_rqtoken) retryBody.captcha_rqtoken = String(parsed.captcha_rqtoken);
            const retry = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
              method: "POST",
              headers: { ...baseHeaders, ...extraHeaders },
              body: JSON.stringify(retryBody),
              timeoutMs: 15_000,
              accountId: senderAccountId,
            });
            const retryText = await retry.text();
            if (retry.ok) {
              const rj = JSON.parse(retryText);
              console.log(`[warmup-campaign-engine] account=${senderAccountId} channel-open captcha solved — channelId=${rj.id}`);
              return { ok: true, channelId: String(rj.id) };
            }
            console.warn(`[warmup-campaign-engine] account=${senderAccountId} channel-open captcha retry failed http=${retry.status}`);
          } else {
            console.warn(`[warmup-campaign-engine] account=${senderAccountId} channel-open captcha unsolvable: ${cs.error}`);
          }
          return { ok: false, captchaChallenged: true, error: "captcha on channel-open" };
        }
        if (parsed?.code === 50009 || /50009|cannot send messages/i.test(text)) {
          return { ok: false, privacyBlocked: true, error: text.slice(0, 200) };
        }
      }
      return { ok: false, error: text.slice(0, 200) };
    }
    const j = JSON.parse(text);
    return { ok: true, channelId: String(j.id) };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Called by the gateway READY handler to clear dead_since after the operator pastes a fresh token.
 *  The gateway only calls this when READY carried NO required_action (so a still-locked account
 *  isn't revived). As a second guard, never revive an account the warmup state machine has
 *  quarantined/retired — that flag outranks a stray READY. */
export async function clearDeadFlagForAccount(accountId: string): Promise<void> {
  const blocked = await db.listBlockedAccountIds();
  if (blocked.has(accountId)) {
    console.warn(`[warmup-campaign-engine] account=${accountId} READY but quarantined/retired/resting — not clearing dead_since`);
    return;
  }
  const campaigns = await db.listWarmupCampaigns();
  for (const c of campaigns) {
    if (c.status !== "running") continue;
    await db.setAccountDeadSince(c.id, accountId, null);
  }
}

/** Called by the gateway 4004 close handler — token revoked by Discord.
 *  Marks dead_since immediately so the warmup engine doesn't keep hammering
 *  the account with TLS sends that will return 401. */
export async function markAccountRevoked(accountId: string): Promise<void> {
  const campaigns = await db.listWarmupCampaigns();
  for (const c of campaigns) {
    if (c.status !== "running") continue;
    await db.setAccountDeadSince(c.id, accountId, new Date().toISOString());
    publishExternalEvent({
      type: "warmup_account_dead",
      campaignId: c.id,
      accountId,
      reason: "Token revoked by Discord — paste a fresh token to put this account back online.",
      ts: new Date().toISOString(),
    } as any);
  }
}

/** Called by the gateway READY handler when Discord sends required_action — account is locked
 *  (email/phone/ToS verification required). Captcha solves on these accounts always fail.
 *  Sets dead_since so the engine skips the account until the lock is resolved and READY fires
 *  again without required_action. */
export async function markAccountRequiredAction(accountId: string): Promise<void> {
  const campaigns = await db.listWarmupCampaigns();
  for (const c of campaigns) {
    if (c.status !== "running") continue;
    await db.setAccountDeadSince(c.id, accountId, new Date().toISOString());
  }
}

/** Clear all in-memory state for a campaign — call when the campaign is deleted or reset. */
export function clearCampaignCache(campaignId: string): void {
  for (const key of [...memNextEligible.keys()]) {
    if (key.startsWith(`${campaignId}:`)) memNextEligible.delete(key);
  }
  memLastCampaignSend.delete(campaignId);
}
