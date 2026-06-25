/**
 * Campaign engine — round-robin DM sends with strict per-account cooldown.
 *
 * Flow per tick:
 *   1. For each running campaign, sort enrolled accounts by last-sent ASC.
 *   2. Pick the first account whose cooldown has expired (configured via
 *      campaign.minInterSendSeconds, default 8 min).
 *   3. Pick the oldest pending lead for that account.
 *   4. If an existing DM channel is found, send through it directly.
 *      If no channel exists yet, open one inline (POST /users/@me/channels)
 *      then send immediately — one atomic open+send per lead.
 *   5. Captcha on channel-open or send → skip lead for this tick (not failed).
 *      Fatal errors (401, account restriction) → pause campaign.
 *   6. If all accounts in cooldown → emit campaign_waiting (throttled 1/min).
 *
 * Lead lifecycle:  pending → sent | failed
 */

import * as db from "./db";
import { _getCapturedToken } from "./discord-mock";
import { publishExternalEvent } from "./realtime";
import { sendDiscordMessage } from "./discord-send";
import { tlsFetch, discordHeaders } from "./discord-http";
import { browserOpenDmChannel, browserFetchEnabled } from "./discord-browser";

const TICK_MS = 5_000;
const DEFAULT_ACCOUNT_COOLDOWN_MS = 8 * 60 * 1000;
const WAITING_THROTTLE_MS = 60_000;

const lastWaitingEmit = new Map<string, number>();

// Per-account rate-limit cooldown: `${campaignId}:${accountId}` → ms timestamp
// when the account may send again. Set on a 429 so we honor Discord's
// retry_after instead of hammering through the limit (a strong abuse signal)
// or failing the lead outright. In-memory is fine — it's a short-lived backoff.
const accountRateLimitUntil = new Map<string, number>();

// Pull retry_after (seconds) out of a Discord 429 body → ms, floor 60s.
function parseRetryAfterMs(errBody: string | undefined): number {
  const m = (errBody || "").match(/"retry_after"\s*:\s*([\d.]+)/);
  const secs = m ? Number(m[1]) : 60;
  return Math.max(secs, 60) * 1000;
}

function classifyDiscordError(httpStatus: number | undefined, errorBody: string | undefined): { fatal: boolean; captcha: boolean; reason: string } {
  const body = (errorBody || "").toLowerCase();
  if (body.includes("captcha-required") || body.includes("captcha_required") ||
      body.includes("captcha_sitekey") || body.includes("invalid-response") || body.includes("invalid_response")) {
    return { fatal: false, captcha: true, reason: "Discord is asking for a CAPTCHA — the auto-solver is working on it." };
  }
  if (httpStatus === 401) {
    return { fatal: true, captcha: false, reason: "Account token was revoked by Discord — paste a fresh token to put it back online." };
  }
  if (httpStatus === 403 && (body.includes("limited your access") || body.includes("verify") || body.includes("phone"))) {
    return { fatal: true, captcha: false, reason: "Discord restricted this account — it may need phone or email verification before it can send again." };
  }
  if (httpStatus === 429) {
    const m = body.match(/"retry_after"\s*:\s*([\d.]+)/);
    const secs = m ? Math.round(Number(m[1])) : null;
    if (secs && secs > 60) {
      const mins = Math.round(secs / 60);
      return { fatal: true, captcha: false, reason: `Discord rate-limited this account with a ${mins}-minute timeout — too many messages sent too quickly.` };
    }
  }
  if (httpStatus === 400 && (body.includes("50007") || body.includes("cannot send messages to this user"))) {
    return { fatal: false, captcha: false, reason: "Recipient has DMs turned off — they only accept messages from friends." };
  }
  if (httpStatus === 400 && (body.includes("50009") || body.includes("no mutual") || body.includes("privacy"))) {
    return { fatal: false, captcha: false, reason: "No shared server with this person — Discord requires a mutual server to DM strangers." };
  }
  if (body.includes("blocked")) {
    return { fatal: false, captcha: false, reason: "This person has blocked the sending account." };
  }
  if (!httpStatus || httpStatus >= 500) {
    return { fatal: false, captcha: false, reason: "Discord's servers returned an error — will retry automatically." };
  }
  return { fatal: false, captcha: false, reason: `Discord rejected the message (code ${httpStatus}).` };
}

async function autoRestIfOverLimit(accountId: string, action: "fr_sent" | "dm_sent" | "warmup_sent", limit: number): Promise<void> {
  try {
    const count = await db.getAccount24hActionCount(accountId, action);
    if (count >= limit) {
      await db.restAccount(accountId);
      publishExternalEvent({ type: "account_status", accountId, status: "resting", ts: new Date().toISOString() } as any);
      console.log(`[auto-rest] account=${accountId} rested — ${action}=${count} hit limit ${limit}`);
    }
  } catch (err: any) {
    console.warn(`[auto-rest] failed account=${accountId}: ${err?.message}`);
  }
}

async function panicPauseCampaign(
  campaign: db.CampaignRow,
  accountId: string,
  leadId: string,
  reason: string,
): Promise<void> {
  console.warn(`[campaign] PANIC PAUSE campaign=${campaign.id} account=${accountId} reason=${reason}`);
  try {
    await db.setCampaignStatus(campaign.id, "paused");
    await db.addSuspension(campaign.id, accountId, reason);
    const rb = await db.rebalanceFromSuspendedAccount(campaign.id, accountId);
    console.warn(`[campaign] rebalanced: reassigned=${rb.reassigned} orphaned=${rb.orphaned}`);
  } catch (e: any) {
    console.warn(`[campaign] panic-pause failed: ${e?.message || e}`);
  }
  publishExternalEvent({ type: "campaign_paused", campaignId: campaign.id, reason, ts: new Date().toISOString() } as any);
}

// Suspend a single bad account and rebalance — campaign keeps running with remaining accounts.
async function suspendAccountFromCampaign(
  campaign: db.CampaignRow,
  accountId: string,
  reason: string,
): Promise<void> {
  console.warn(`[campaign] suspending account=${accountId} from campaign=${campaign.id} reason=${reason}`);
  try {
    await db.addSuspension(campaign.id, accountId, reason);
    const rb = await db.rebalanceFromSuspendedAccount(campaign.id, accountId);
    console.warn(`[campaign] rebalanced after suspend: reassigned=${rb.reassigned} orphaned=${rb.orphaned}`);
  } catch (e: any) {
    console.warn(`[campaign] suspend failed: ${e?.message || e}`);
  }
  publishExternalEvent({ type: "dm_failed", campaignId: campaign.id, accountId, reason, ts: new Date().toISOString() } as any);
}

// Returns null when the campaign has no usable template — callers must skip the
// send rather than blasting an identical hardcoded literal (e.g. "hey 👋") to
// many recipients, which is a textbook spam signature.
function pickTemplateBody(campaign: db.CampaignRow, lead: db.LeadRow): string | null {
  const variants = (campaign.templates || []).map((t) => t.trim()).filter(Boolean);
  if (variants.length === 0) return null;
  const chosen = variants[Math.floor(Math.random() * variants.length)]!;
  return chosen
    .replace(/\{\{firstName\}\}/g, lead.displayName || "")
    .replace(/\{\{username\}\}/g, lead.displayName || "");
}

async function openDmChannel(
  token: string,
  recipientUserId: string,
  senderAccountId: string,
): Promise<{ ok: boolean; channelId?: string; captcha?: boolean; httpStatus?: number; error?: string }> {
  try {
    const r = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
      method: "POST",
      headers: await discordHeaders(token, true, undefined, senderAccountId),
      body: JSON.stringify({ recipients: [recipientUserId] }),
      timeoutMs: 15_000,
      accountId: senderAccountId,
    });
    const text = await r.text();
    if (!r.ok) {
      const cls = classifyDiscordError(r.status, text);
      return { ok: false, captcha: cls.captcha, httpStatus: r.status, error: text.slice(0, 200) };
    }
    const j = JSON.parse(text);
    return { ok: true, channelId: String(j.id) };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

type AccountEntry = { account: { id: string; status?: string; warmupStatus?: string }; token: string; discordUserId?: string | null };

function getToken(allAccts: AccountEntry[], accountId: string): string | null {
  const entry = allAccts.find((a) => a.account.id === accountId);
  if (entry?.token) return entry.token;
  return _getCapturedToken(accountId) || null;
}

const campaignLocks = new Set<string>();

async function handleCampaign(campaign: db.CampaignRow, allAccts: AccountEntry[], scraperIds: Set<string>): Promise<void> {
  if (!campaign.templates || campaign.templates.length === 0) return;
  // Prevent overlapping ticks: if a previous tick is still mid-send (e.g. captcha solve),
  // skip rather than picking the same lead again and triple-texting.
  if (campaignLocks.has(campaign.id)) {
    console.log(`[campaign] campaign=${campaign.id} tick skipped — previous tick still in progress`);
    return;
  }
  campaignLocks.add(campaign.id);
  try {
    await handleCampaignInner(campaign, allAccts, scraperIds);
  } finally {
    campaignLocks.delete(campaign.id);
  }
}

async function handleCampaignInner(campaign: db.CampaignRow, allAccts: AccountEntry[], scraperIds: Set<string>): Promise<void> {

  const [accountIds, lastSentMap, suspended] = await Promise.all([
    db.getCampaignAccountIds(campaign.id),
    db.getCampaignAccountLastSent(campaign.id),
    db.listSuspensions(campaign.id),
  ]);

  if (accountIds.length === 0) return;

  const suspendedSet = new Set(suspended.map((s) => s.accountId));
  const now = Date.now();

  const accountCooldownMs = campaign.minInterSendSeconds > 0
    ? campaign.minInterSendSeconds * 1000
    : DEFAULT_ACCOUNT_COOLDOWN_MS;

  // Global spacing: enforce a minimum gap between ANY two sends in this campaign,
  // regardless of which account is sending. Prevents 40-account campaigns from
  // firing a DM every 5 seconds on the first tick when all accounts are fresh.
  const globalSpacingMs = (campaign.minGlobalSpacingSeconds ?? 300) * 1000;
  const allLastSentTimes = [...lastSentMap.values()].map((d) => d.getTime());
  const lastGlobalSendAt = allLastSentTimes.length > 0 ? Math.max(...allLastSentTimes) : 0;
  if (lastGlobalSendAt > 0 && now - lastGlobalSendAt < globalSpacingMs) {
    const waitSec = Math.round((globalSpacingMs - (now - lastGlobalSendAt)) / 1000);
    const lastEmit = lastWaitingEmit.get(campaign.id) || 0;
    if (now - lastEmit > WAITING_THROTTLE_MS) {
      lastWaitingEmit.set(campaign.id, now);
      publishExternalEvent({
        type: "campaign_waiting",
        campaignId: campaign.id,
        nextSendAt: new Date(lastGlobalSendAt + globalSpacingMs).toISOString(),
        accountsInCooldown: 0,
        accountsReady: 0,
        ts: new Date().toISOString(),
      } as any);
    }
    console.log(`[campaign] campaign=${campaign.id} global spacing: last send ${Math.round((now - lastGlobalSendAt) / 1000)}s ago, next in ${waitSec}s`);
    return;
  }

  // Round-robin: sort by last-sent ASC — never-sent (epoch 0) first.
  // Auto-suspend accounts whose tokens are revoked or banned — instead of
  // silently dropping them, add a suspension so the campaign can pause
  // with a clear reason if all accounts are exhausted.
  for (const id of accountIds) {
    if (suspendedSet.has(id)) continue;
    const acct = allAccts.find((a) => a.account.id === id)?.account;
    const acctStatus = acct?.status;
    const warmupStatus = acct?.warmupStatus;
    // Gate on warmup lifecycle too: quarantineAccount() flips warmup_status but
    // not status, so a quarantined/retired account would otherwise keep sending.
    const blocked = acctStatus === "token_revoked" || acctStatus === "banned"
      || warmupStatus === "quarantined" || warmupStatus === "retired" || warmupStatus === "resting";
    if (blocked) {
      let reason: string;
      if (acctStatus === "token_revoked") reason = "Account token was revoked by Discord — paste a fresh token to re-enable this account.";
      else if (acctStatus === "banned") reason = "Account is banned on Discord.";
      else if (warmupStatus === "resting") reason = "Account is resting — activate it on the Health tab when ready.";
      else reason = `Account is ${warmupStatus} (hit a critical failure during warmup) — it has been removed from outreach.`;
      console.warn(`[campaign] auto-suspending account=${id} (status=${acctStatus} warmup=${warmupStatus}) from campaign=${campaign.id}`);
      try { await db.addSuspension(campaign.id, id, reason); } catch { /* already suspended */ }
      suspendedSet.add(id);
    }
  }

  const eligible = accountIds
    .filter((id) => {
      if (suspendedSet.has(id)) return false;
      if (!getToken(allAccts, id)) return false;
      if (scraperIds.has(id)) {
        console.log(`[campaign] campaign=${campaign.id} skipping account=${id} — reserved as scraper decoy`);
        return false;
      }
      return true;
    })
    .sort((a, b) => (lastSentMap.get(a)?.getTime() ?? 0) - (lastSentMap.get(b)?.getTime() ?? 0));

  let cooldownCount = 0;
  let readyCount = 0;
  let soonestNextSend = Infinity;

  for (const accountId of eligible) {
    // Honor an active 429 backoff before anything else.
    const rlUntil = accountRateLimitUntil.get(`${campaign.id}:${accountId}`) ?? 0;
    if (rlUntil > now) {
      cooldownCount++;
      soonestNextSend = Math.min(soonestNextSend, rlUntil);
      continue;
    }
    const lastSent = lastSentMap.get(accountId)?.getTime() ?? 0;
    if (now - lastSent < accountCooldownMs) {
      cooldownCount++;
      soonestNextSend = Math.min(soonestNextSend, lastSent + accountCooldownMs);
      continue;
    }

    readyCount++;
    const sendsToday = await db.countOutreachSendsToday(campaign.id, accountId);
    if (campaign.ratePerDay > 0 && sendsToday >= campaign.ratePerDay) {
      console.log(`[campaign] account=${accountId} daily cap reached (${sendsToday}/${campaign.ratePerDay}) — skipping`);
      cooldownCount++;
      continue;
    }
    const token = getToken(allAccts, accountId)!;
    const lead = await db.pickNextLeadForAccount(campaign.id, accountId);
    if (!lead) continue;

    // Never send to ourselves — skip if the lead's Discord user ID matches the sender's.
    const senderDiscordUserId = allAccts.find((a) => a.account.id === accountId)?.discordUserId;
    if (senderDiscordUserId && lead.discordUserId === senderDiscordUserId) {
      console.warn(`[campaign] self-send blocked campaign=${campaign.id} account=${accountId} lead=${lead.id}`);
      await db.setLeadStatus(lead.id, "failed", accountId, "self-send: lead is the sending account");
      await db.bumpCampaignTotal(campaign.id, "failed");
      publishExternalEvent({ type: "dm_failed", campaignId: campaign.id, leadId: lead.id, accountId, reason: "Lead is the same Discord account as the sender — skipped.", ts: new Date().toISOString() } as any);
      continue;
    }

    // Prefer an existing DM channel — avoids the channel-open API call entirely.
    let channelId = await db.findExistingDmChannel(accountId, lead.discordUserId);

    if (!channelId) {
      // No existing channel — open one now and send immediately.
      console.log(`[campaign] opening DM channel campaign=${campaign.id} account=${accountId} → ${lead.discordUserId}`);
      const opened: { ok: boolean; channelId?: string; captcha?: boolean; httpStatus?: number; retryAfterMs?: number; error?: string } = browserFetchEnabled()
        ? await (async () => {
            const r = await browserOpenDmChannel(accountId, token, lead.discordUserId, campaign.guildId || undefined);
            return { ok: r.ok, channelId: r.channelId, captcha: r.captchaChallenged || false, httpStatus: r.rateLimited ? 429 : (r.ok ? 200 : 400), retryAfterMs: r.retryAfterMs, error: r.error };
          })()
        : await openDmChannel(token, lead.discordUserId, accountId);
      if (!opened.ok) {
        // Rate-limited on channel-open — back the account off, leave the lead
        // pending (it'll be re-picked after the cooldown), don't fail it.
        if (opened.httpStatus === 429) {
          const retryMs = opened.retryAfterMs || parseRetryAfterMs(opened.error);
          accountRateLimitUntil.set(`${campaign.id}:${accountId}`, now + retryMs);
          console.warn(`[campaign] channel-open 429 account=${accountId} — cooldown ${Math.round(retryMs / 1000)}s`);
          publishExternalEvent({ type: "campaign_rate_limited", campaignId: campaign.id, accountId, cooldownSeconds: Math.round(retryMs / 1000), ts: new Date().toISOString() } as any);
          return;
        }
        if (opened.captcha) {
          console.log(`[campaign] channel-open captcha'd account=${accountId} lead=${lead.id} — skipping tick`);
          publishExternalEvent({ type: "captcha_triggered", campaignId: campaign.id, leadId: lead.id, accountId, stage: "channel_open", ts: new Date().toISOString() } as any);
          continue;
        }
        // Browser context was closed mid-operation (idle-close race) — transient, retry next tick.
        if (opened.error?.includes("browser page closed") || opened.error?.includes("Target page")) {
          console.log(`[campaign] browser context closed during channel-open account=${accountId} lead=${lead.id} — retrying next tick`);
          continue;
        }
        const cls = classifyDiscordError(opened.httpStatus, opened.error);
        if (cls.fatal) { await suspendAccountFromCampaign(campaign, accountId, cls.reason); return; }
        await db.setLeadStatus(lead.id, "failed", accountId, `channel-open: ${opened.error || `HTTP ${opened.httpStatus}`}`);
        await db.bumpCampaignTotal(campaign.id, "failed");
        publishExternalEvent({ type: "dm_failed", campaignId: campaign.id, leadId: lead.id, accountId, reason: cls.reason, ts: new Date().toISOString() } as any);
        const pendingAfterOpen = await db.countPendingLeads(campaign.id);
        if (pendingAfterOpen === 0 && campaign.status === "running") {
          await db.setCampaignStatus(campaign.id, "finished");
          publishExternalEvent({ type: "campaign_finished", campaignId: campaign.id, ts: new Date().toISOString() } as any);
          console.log(`[campaign] campaign=${campaign.id} auto-finished — all leads processed`);
        }
        return;
      }
      channelId = opened.channelId!;
    }

    // Send the message — account cooldown timer starts now.
    const body = pickTemplateBody(campaign, lead);
    if (!body) {
      console.warn(`[campaign] campaign=${campaign.id} has no usable template — skipping send (refusing to send a constant literal)`);
      return;
    }
    console.log(`[campaign] sending campaign=${campaign.id} account=${accountId} → ${lead.discordUserId}`);
    publishExternalEvent({ type: "dm_sending", campaignId: campaign.id, leadId: lead.id, accountId, ts: new Date().toISOString() } as any);

    // Human-like jitter (3–12s) before the actual send. The 5s tick + per-account
    // cooldown space sends coarsely; this scatters the exact send moment so the
    // interval isn't a fixed, detectable signature. The campaignLock held by this
    // tick makes concurrent ticks skip the campaign while we wait, so no overlap.
    await new Promise((r) => setTimeout(r, 3_000 + Math.random() * 9_000));

    const result = await sendDiscordMessage(accountId, token, channelId, body, { campaignId: campaign.id, recipientUserId: lead.discordUserId, recipientDisplayName: lead.displayName || undefined });

    if (result.ok) {
      await db.setLeadStatus(lead.id, "sent", accountId);
      await db.bumpCampaignTotal(campaign.id, "sent");
      db.logActivity(accountId, "dm_sent", { campaignId: campaign.id, leadId: lead.id, via: result.via || "" });
      autoRestIfOverLimit(accountId, "dm_sent", 5).catch(() => {});
      publishExternalEvent({ type: "dm_sent", campaignId: campaign.id, leadId: lead.id, accountId, ts: new Date().toISOString() } as any);
      console.log(`[campaign] sent campaign=${campaign.id} account=${accountId} via=${result.via}`);
    } else {
      // Rate-limited on send — back the account off and leave the lead pending.
      // Must run before classifyDiscordError, which would otherwise either
      // suspend the account (429 >60s) or fail the lead (429 <60s).
      if (result.httpStatus === 429) {
        const retryMs = parseRetryAfterMs(result.error);
        accountRateLimitUntil.set(`${campaign.id}:${accountId}`, now + retryMs);
        console.warn(`[campaign] send 429 account=${accountId} — cooldown ${Math.round(retryMs / 1000)}s`);
        publishExternalEvent({ type: "campaign_rate_limited", campaignId: campaign.id, accountId, leadId: lead.id, cooldownSeconds: Math.round(retryMs / 1000), ts: new Date().toISOString() } as any);
        return;
      }
      const cls = classifyDiscordError(result.httpStatus, result.error);
      if (cls.captcha) {
        console.log(`[campaign] send captcha'd account=${accountId} lead=${lead.id} — skipping tick`);
        publishExternalEvent({ type: "captcha_triggered", campaignId: campaign.id, leadId: lead.id, accountId, stage: "send", ts: new Date().toISOString() } as any);
        return;
      }
      if (cls.fatal) { await suspendAccountFromCampaign(campaign, accountId, cls.reason); return; }
      await db.setLeadStatus(lead.id, "failed", accountId, result.error || `HTTP ${result.httpStatus}`);
      await db.bumpCampaignTotal(campaign.id, "failed");
      publishExternalEvent({ type: "dm_failed", campaignId: campaign.id, leadId: lead.id, accountId, reason: cls.reason, ts: new Date().toISOString() } as any);
    }
    // Auto-complete: mark finished when every lead has been sent or failed.
    const pending = await db.countPendingLeads(campaign.id);
    if (pending === 0 && campaign.status === "running") {
      await db.setCampaignStatus(campaign.id, "finished");
      publishExternalEvent({ type: "campaign_finished", campaignId: campaign.id, ts: new Date().toISOString() } as any);
      console.log(`[campaign] campaign=${campaign.id} auto-finished — all leads processed`);
    }
    return; // one send per campaign per tick
  }

  // If ALL accounts are suspended (none eligible at all), auto-pause the campaign
  // rather than silently idling — gives the operator a clear signal.
  if (eligible.length === 0 && accountIds.every((id) => suspendedSet.has(id))) {
    const reason = "All accounts in this campaign have been suspended (token revoked, banned, or manually paused).";
    console.warn(`[campaign] auto-pausing campaign=${campaign.id} — all accounts suspended`);
    await db.setCampaignStatus(campaign.id, "paused");
    publishExternalEvent({ type: "campaign_paused", campaignId: campaign.id, reason, ts: new Date().toISOString() } as any);
    return;
  }

  // No send happened — emit throttled waiting event.
  const lastEmit = lastWaitingEmit.get(campaign.id) || 0;
  if (now - lastEmit > WAITING_THROTTLE_MS) {
    lastWaitingEmit.set(campaign.id, now);
    publishExternalEvent({
      type: "campaign_waiting",
      campaignId: campaign.id,
      nextSendAt: soonestNextSend < Infinity ? new Date(soonestNextSend).toISOString() : null,
      accountsInCooldown: cooldownCount,
      accountsReady: readyCount,
      ts: new Date().toISOString(),
    } as any);
  }

  const remaining = await db.countPendingLeads(campaign.id);
  if (remaining === 0) {
    await db.setCampaignStatus(campaign.id, "finished");
    publishExternalEvent({ type: "campaign_finished", campaignId: campaign.id, ts: new Date().toISOString() });
    console.log(`[campaign] ${campaign.id} finished`);
  }
}

async function tick(): Promise<void> {
  const campaigns = await db.listRunningCampaigns();
  if (campaigns.length === 0) return;
  const [allAccts, scraperIds] = await Promise.all([
    db.loadAllAccounts({ sendableOnly: true }) as Promise<AccountEntry[]>,
    db.getScraperAccountIds(),
  ]);
  for (const campaign of campaigns) {
    await handleCampaign(campaign, allAccts, scraperIds);
  }
}

export function clearAccountCooldowns(_accountIds?: Set<string>): void { /* no-op */ }
export function clearCampaignCooldown(_campaignId: string): void { /* no-op */ }

let schedulerTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (schedulerTimer) return;
  console.log(`[campaign] scheduler started (tick=${TICK_MS}ms, cooldown=configurable, round-robin)`);
  schedulerTimer = setInterval(() => {
    tick().catch((err) => console.warn("[campaign] tick error:", err?.message || err));
  }, TICK_MS);
}

export function stopScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
