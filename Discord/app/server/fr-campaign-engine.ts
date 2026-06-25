import * as db from "./db";
import { expand, dailySeed } from "./spintax";
import { tlsFetch, discordHeaders } from "./discord-http";
import { publishExternalEvent } from "./realtime";
import { browserSendFriendRequest, browserOpenDmChannel, browserFetchEnabled } from "./discord-browser";
import { sendDiscordMessage } from "./discord-send";

const TICK_MS = 30_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

const campaignLastFrSentMs = new Map<string, number>();

// An account may be sent on only if its gateway status is "connected" AND its
// warmup lifecycle isn't quarantined/retired. quarantineAccount() flips
// warmup_status but NOT discord_accounts.status, so a status-only filter would
// keep hammering an account Discord already flagged — the exact regression that
// burned accounts before the warmup state machine existed.
function isSendable(a: db.LoadedAccount): boolean {
  if (a.account.status !== "connected") return false;
  const ws = a.account.warmupStatus;
  return ws !== "quarantined" && ws !== "retired" && ws !== "resting";
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

// Returns the set of account IDs currently enrolled in running warmup campaigns.
// FR engine excludes these so dedicated warmup accounts don't accidentally get
// assigned FR campaign leads — they should only send inter-account warmup DMs.
//
// Cached for 5 minutes: this was an N+1 (one listWarmupCampaignAccounts query
// per running warmup campaign) running on every 30s FR tick. Warmup enrollment
// changes rarely, so a short TTL eliminates the per-tick fan-out.
let warmupIdsCache: { ids: Set<string>; at: number } | null = null;
const WARMUP_IDS_TTL_MS = 5 * 60_000;
async function getWarmupAccountIds(): Promise<Set<string>> {
  if (warmupIdsCache && Date.now() - warmupIdsCache.at < WARMUP_IDS_TTL_MS) return warmupIdsCache.ids;
  const ids = new Set<string>();
  try {
    const campaigns = await db.listWarmupCampaigns();
    for (const c of campaigns) {
      if (c.status !== "running") continue;
      const accts = await db.listWarmupCampaignAccounts(c.id);
      for (const a of accts) ids.add(a.account_id);
    }
  } catch {
    // Non-fatal — reuse the last good cache if we have one rather than blocking sends.
    return warmupIdsCache?.ids ?? ids;
  }
  warmupIdsCache = { ids, at: Date.now() };
  return ids;
}

// Scraper decoy accounts are reserved exclusively for member scraping.
// They must not be used for outreach — mixing scraper + sender roles on one
// account means an account doing OP 8 requests AND sending FRs/DMs, which
// is a much stronger behaviour anomaly than either alone.
let scraperIdsCache: { ids: Set<string>; at: number } | null = null;
const SCRAPER_IDS_TTL_MS = 5 * 60_000;
async function getScraperAccountIds(): Promise<Set<string>> {
  if (scraperIdsCache && Date.now() - scraperIdsCache.at < SCRAPER_IDS_TTL_MS) return scraperIdsCache.ids;
  try {
    const ids = await db.getScraperAccountIds();
    scraperIdsCache = { ids, at: Date.now() };
    return ids;
  } catch {
    return scraperIdsCache?.ids ?? new Set();
  }
}

// TLS-based friend request — no browser, no new-device login.
// Sends PUT /relationships/{userId} with the account's assigned proxy, handles
// captcha inline via 2captcha (solving through the account proxy so hCaptcha
// embeds the correct IP in the token).
// Returns a response-like shape compatible with the sendFr caller.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Parse Discord's retry_after (seconds) out of a 429 error body; floor 30s.
function parseRetryMs(errBody: string | undefined): number {
  const m = (errBody || "").match(/"retry_after"\s*:\s*([\d.]+)/);
  const secs = m ? Number(m[1]) : 30;
  return Math.max(secs, 30) * 1000;
}
// Random 8–20s pause between back-to-back sends inside the combo loops.
const comboGapMs = () => 8_000 + Math.floor(Math.random() * 12_000);
// Max combo sends fired in a single tick — caps burst exposure per campaign.
const COMBO_MAX_PER_TICK = 3;

// Seed the per-campaign inter-send timer from the DB so a redeploy doesn't
// reset spacing to 0 and let the first tick fire immediately.
async function seedLastSentFromDb(): Promise<void> {
  try {
    const last = await db.getLastFrSentPerCampaign();
    for (const [campaignId, ts] of last) campaignLastFrSentMs.set(campaignId, ts);
    if (last.size > 0) console.log(`[fr-engine] seeded inter-send timer for ${last.size} campaigns from DB`);
  } catch (err: any) {
    console.warn(`[fr-engine] could not seed last-sent timer: ${err?.message || err}`);
  }
}

export function startFrCampaignEngine(): void {
  if (running) return;
  running = true;
  console.log("[fr-engine] starting (tick=30s)");
  const tick = async () => {
    if (!running) return;
    try { await runOneTick(); }
    catch (err: any) { console.warn(`[fr-engine] tick error: ${err?.message || err}`); }
    timer = setTimeout(tick, TICK_MS);
  };
  void seedLastSentFromDb().finally(() => { void tick(); });
}

export function stopFrCampaignEngine(): void {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  console.log("[fr-engine] stopped");
}

async function runOneTick(): Promise<void> {
  // Release any leads stranded 'claimed' by a crash mid-send before selecting.
  try {
    const freed = await db.releaseStaleFrClaims();
    if (freed > 0) console.log(`[fr-engine] released ${freed} stale lead claim(s)`);
  } catch { /* non-fatal */ }
  const campaigns = await db.listRunningFrCampaigns();
  console.log(`[fr-engine] tick — ${campaigns.length} running campaign(s)`);
  for (const c of campaigns) {
    await handleCampaign(c);
  }
}

async function handleCampaign(c: db.FrCampaignRow): Promise<void> {
  if (c.mode === "dm_then_fr") {
    await handleDmThenFrCampaign(c);
    return;
  }
  await handleFrSendStep(c);
  if (c.mode === "fr_then_dm") {
    await handleFrThenDmComboStep(c);
  }
}

async function handleFrSendStep(c: db.FrCampaignRow): Promise<void> {
  console.log(`[fr-engine] handleFrSendStep START campaign=${c.id}`);
  const interSendMs = (c.inter_send_seconds ?? 60) * 1000;
  const lastSent = campaignLastFrSentMs.get(c.id) ?? 0;
  console.log(`[fr-engine] interSendMs=${interSendMs} lastSent=${lastSent} now=${Date.now()}`);
  if (Date.now() - lastSent < interSendMs) return;

  const resolved = await db.resolveLeadUsernamesFromScraper(c.id);
  if (resolved > 0) console.log(`[fr-engine] campaign=${c.id} resolved ${resolved} usernames from scraped_members`);

  const leads = await db.listEligibleFrLeads(c.id);
  console.log(`[fr-engine] campaign=${c.id} found ${leads.length} eligible leads`);
  if (leads.length === 0) return;

  const allAccts = await db.loadAllAccounts({ sendableOnly: true });
  // Exclude warmup accounts — they use TLS-only sends, and spawning a browser
  // context on them creates a new-device login that triggers token revocation.
  // Exclude scraper decoy accounts — mixing scraper + sender on one account is a flag risk.
  const [warmupIds, scraperIds] = await Promise.all([getWarmupAccountIds(), getScraperAccountIds()]);
  const connected = allAccts.filter((a) => isSendable(a) && !warmupIds.has(a.account.id) && !scraperIds.has(a.account.id));
  if (connected.length === 0) {
    console.log(`[fr-engine] campaign=${c.id} — no connected non-warmup non-scraper accounts available, skipping tick`);
    return;
  }
  const connectedIds = new Set(connected.map((a) => a.account.id));

  const busyThisTick = new Set<string>();

  for (const lead of leads) {
    let accountId = lead.assigned_account_id;
    if (!accountId || !connectedIds.has(accountId)) {
      const available = connected.filter((a) => !busyThisTick.has(a.account.id) && a.discordUserId !== lead.discord_user_id);
      if (available.length === 0) break;
      const picked = available[Math.floor(Math.random() * available.length)]!;
      accountId = picked.account.id;
    }

    // Self-send guard: handles pre-assigned case where the assigned account IS the lead target.
    const senderDiscordId = allAccts.find((a) => a.account.id === accountId)?.discordUserId;
    if (senderDiscordId && senderDiscordId === lead.discord_user_id) {
      console.warn(`[fr-engine] self-send blocked lead=${lead.id} account=${accountId}`);
      await db.updateFrLead(lead.id, { status: "failed", error: "self-send: sending account is the lead target" });
      publishExternalEvent({ type: "fr_failed", campaignId: c.id, leadId: lead.id, displayName: lead.display_name, accountId, ts: new Date().toISOString() } as any);
      continue;
    }

    const sendsToday = await db.countFrSendsToday(c.id, accountId);
    console.log(`[fr-engine] account=${accountId} sendsToday=${sendsToday}/${c.fr_per_account_per_day}`);
    if (sendsToday >= c.fr_per_account_per_day) { console.log(`[fr-engine] daily limit reached for ${accountId}`); continue; }

    const acctEntry = allAccts.find((a) => a.account.id === accountId);
    const token = acctEntry?.token ?? null;
    console.log(`[fr-engine] token for ${accountId}: ${token ? 'FOUND' : 'MISSING'}`);
    if (!token) continue;

    busyThisTick.add(accountId);
    await sendFr(c, lead, accountId, token);
    campaignLastFrSentMs.set(c.id, Date.now());
    break;
  }
}

async function handleFrThenDmComboStep(c: db.FrCampaignRow): Promise<void> {
  if (!c.template) return;
  const comboDmLeads = await db.listPendingComboDmLeads(c.id);
  if (comboDmLeads.length === 0) return;

  const allAccts = await db.loadAllAccounts({ sendableOnly: true });
  let sentThisTick = 0;
  for (const lead of comboDmLeads) {
    if (!lead.assigned_account_id) continue;
    const acctEntry = allAccts.find((a) => a.account.id === lead.assigned_account_id);
    if (acctEntry?.discordUserId && acctEntry.discordUserId === lead.discord_user_id) {
      console.warn(`[fr-engine] self-DM blocked (fr_then_dm combo) lead=${lead.id} account=${lead.assigned_account_id}`);
      await db.updateFrLead(lead.id, { dm_sent_at: new Date().toISOString(), error: "self-send: sending account is the lead target" });
      continue;
    }
    const token = acctEntry?.token ?? null;
    console.log(`[fr-engine] handleFrThenDmComboStep campaign=${c.id} lead=${lead.id} account=${lead.assigned_account_id} token=${token ? "FOUND" : "MISSING"}`);
    if (!token) continue;
    // Cap burst exposure: at most COMBO_MAX_PER_TICK sends per tick, with an
    // 8–20s human-like gap between consecutive sends.
    if (sentThisTick >= COMBO_MAX_PER_TICK) break;
    if (sentThisTick > 0) await sleep(comboGapMs());
    await sendTemplateDm(lead.assigned_account_id, lead.discord_user_id, c.template, lead.id, token, c.guild_id);
    sentThisTick++;
  }
}

async function handleDmThenFrCampaign(c: db.FrCampaignRow): Promise<void> {
  const allAccts = await db.loadAllAccounts({ sendableOnly: true });
  const [warmupIds, scraperIds] = await Promise.all([getWarmupAccountIds(), getScraperAccountIds()]);
  const connected = allAccts.filter((a) => isSendable(a) && !warmupIds.has(a.account.id) && !scraperIds.has(a.account.id));
  if (connected.length === 0) return;
  const connectedIds = new Set(connected.map((a) => a.account.id));

  const busyThisTick = new Set<string>();
  // Shared burst budget across both the DM and FR legs of this combo tick:
  // never fire more than COMBO_MAX_PER_TICK sends, with an 8–20s human-like gap
  // between consecutive sends. Without this the loops fire one send per eligible
  // lead at machine speed — a textbook bot-farm signature.
  let sentThisTick = 0;

  const dmPending = await db.listFrLeadsDmPending(c.id);
  for (const lead of dmPending) {
    if (sentThisTick >= COMBO_MAX_PER_TICK) break;
    let accountId = lead.assigned_account_id;
    if (!accountId || !connectedIds.has(accountId)) {
      const available = connected.filter((a) => !busyThisTick.has(a.account.id) && a.discordUserId !== lead.discord_user_id);
      if (available.length === 0) break;
      const picked = available[Math.floor(Math.random() * available.length)]!;
      accountId = picked.account.id;
    }
    const acctEntry = allAccts.find((a) => a.account.id === accountId);
    if (acctEntry?.discordUserId && acctEntry.discordUserId === lead.discord_user_id) {
      console.warn(`[fr-engine] self-DM blocked lead=${lead.id} account=${accountId}`);
      await db.updateFrLead(lead.id, { status: "failed", error: "self-send: sending account is the lead target" });
      continue;
    }
    const token = acctEntry?.token ?? null;
    if (!token) continue;
    busyThisTick.add(accountId);

    const frDueAt = new Date(Date.now() + c.combo_interval_seconds * 1000).toISOString();

    if (sentThisTick > 0) await sleep(comboGapMs());
    if (c.template) {
      await sendDmFirstForLead(c, lead, accountId, token, frDueAt);
    } else {
      await db.updateFrLead(lead.id, {
        assigned_account_id: accountId,
        dm_sent_at: new Date().toISOString(),
        fr_due_at: frDueAt,
      });
    }
    sentThisTick++;
  }

  const frPending = await db.listFrLeadsAwaitingFr(c.id);
  for (const lead of frPending) {
    if (sentThisTick >= COMBO_MAX_PER_TICK) break;
    const accountId = lead.assigned_account_id;
    if (!accountId) continue;
    const acctEntry = allAccts.find((a) => a.account.id === accountId);
    if (acctEntry?.discordUserId && acctEntry.discordUserId === lead.discord_user_id) {
      console.warn(`[fr-engine] self-FR blocked (dm_then_fr) lead=${lead.id} account=${accountId}`);
      await db.updateFrLead(lead.id, { status: "failed", error: "self-send: sending account is the lead target" });
      continue;
    }
    const sendsToday = await db.countFrSendsToday(c.id, accountId);
    if (sendsToday >= c.fr_per_account_per_day) continue;
    const token = acctEntry?.token ?? null;
    if (!token) continue;
    if (sentThisTick > 0) await sleep(comboGapMs());
    await sendFr(c, lead, accountId, token);
    sentThisTick++;
  }
}

async function sendFr(
  c: db.FrCampaignRow,
  lead: db.FrLeadRow,
  accountId: string,
  token: string,
): Promise<void> {
  console.log(`[fr-engine] sendFr START lead=${lead.id} account=${accountId} target=${lead.discord_user_id}`);
  // Atomic claim — prevents a second tick/process from sending the same FR
  // while this send is mid-flight (captcha solves can run 30-120s).
  if (!(await db.tryClaimFrLead(lead.id))) {
    console.log(`[fr-engine] lead=${lead.id} already claimed by another worker — skipping`);
    return;
  }
  try {
    // Browser path: stealth Chromium + inline 2captcha solve (preferred).
    // TLS path: raw PUT /relationships with 2captcha fallback (no-browser fallback).
    let ok = false;
    let status = 0;
    let captchaRequired = false;
    let errText = "";

    const targetUsername = lead.username || "";
    if (!targetUsername) {
      await db.updateFrLead(lead.id, { status: "failed", error: "no username — re-scrape the guild to populate" });
      publishExternalEvent({ type: "fr_failed", campaignId: c.id, leadId: lead.id, displayName: lead.display_name, accountId, ts: new Date().toISOString() } as any);
      console.warn(`[fr-engine] lead=${lead.id} failed — no username in scraped_members`);
      return;
    }
    const r = await browserSendFriendRequest(accountId, token, targetUsername);
    ok = r.ok || r.status === 204 || r.status === 200;
    status = r.status;
    const rText = await r.text().catch(() => "");
    errText = rText;
    if (!ok) {
      let body: any = {};
      try { body = JSON.parse(rText); } catch {}
      captchaRequired = !!body.captcha_required;
    }

    console.log(`[fr-engine] sendFr RESPONSE lead=${lead.id} status=${status} ok=${ok}`);

    if (ok) {
      await onFrSent(c, lead, accountId);
      return;
    }

    if (status === 401) {
      await db.updateFrLead(lead.id, { status: "failed", assigned_account_id: null, error: "401 — token revoked" });
      publishExternalEvent({ type: "fr_failed", campaignId: c.id, leadId: lead.id, displayName: lead.display_name, accountId, ts: new Date().toISOString() } as any);
      // Mark the account revoked immediately — don't wait for gateway 4004.
      db.updateAccountStats(accountId, 0, 0, "token_revoked").catch(() => {});
      db.logActivity(accountId, "token_revoked", { source: "fr_engine_401", campaignId: c.id });
      publishExternalEvent({ type: "account_status", accountId, status: "token_revoked", ts: new Date().toISOString() } as any);
      return;
    }

    if (status === 429) {
      let retryAfter = 30;
      try { retryAfter = Math.max(JSON.parse(errText)?.retry_after || 30, 30); } catch { /* */ }
      await db.updateFrLead(lead.id, { next_eligible_at: new Date(Date.now() + retryAfter * 1000).toISOString() });
      return;
    }

    if (captchaRequired) {
      // 2captcha attempted and failed — retry in 30 min.
      await db.updateFrLead(lead.id, { next_eligible_at: new Date(Date.now() + 30 * 60_000).toISOString() });
      publishExternalEvent({
        type: "fr_captcha_required",
        campaignId: c.id, leadId: lead.id, accountId,
        sitekey: "", rqdata: undefined, rqtoken: undefined,
        ts: new Date().toISOString(),
      } as any);
      return;
    }

    // Any browser-side failure (nav blocked, UI not found, timeout) — reschedule
    // with a different account instead of permanently failing the lead.
    if (status === 0) {
      console.warn(`[fr-engine] lead=${lead.id} browser failed (${errText.slice(0, 80)}) on account=${accountId} — rescheduling`);
      await db.updateFrLead(lead.id, { assigned_account_id: null, next_eligible_at: new Date(Date.now() + 5 * 60_000).toISOString() });
      return;
    }

    // 403 with "Incoming friend requests disabled" means the TARGET has FRs turned
    // off in their privacy settings — not a problem with the sending account.
    // Mark as "fr_disabled" so it's distinct from genuine send failures.
    const frDisabled = status === 403 && (
      errText.includes("Incoming friend requests disabled") ||
      errText.includes('"code":40003') ||
      errText.includes('"code": 40003')
    );
    await db.updateFrLead(lead.id, {
      status: frDisabled ? "fr_disabled" : "failed",
      assigned_account_id: null,
      error: `HTTP ${status}: ${errText.slice(0, 100)}`,
    });
    publishExternalEvent({ type: "fr_failed", campaignId: c.id, leadId: lead.id, displayName: lead.display_name, accountId, ts: new Date().toISOString() } as any);
  } catch (err: any) {
    console.warn(`[fr-engine] send error lead=${lead.id}: ${err?.message || err}`);
    // Back off 5 min so a thrown send doesn't leave the lead immediately
    // re-eligible and spin in a tight retry loop every tick.
    await db.updateFrLead(lead.id, { next_eligible_at: new Date(Date.now() + 5 * 60_000).toISOString() }).catch(() => {});
  } finally {
    await db.releaseFrLeadClaim(lead.id).catch(() => {});
  }
}

async function onFrSent(c: db.FrCampaignRow, lead: db.FrLeadRow, accountId: string): Promise<void> {
  const jitter = c.min_interval_seconds + Math.floor(Math.random() * Math.max(1, c.max_interval_seconds - c.min_interval_seconds));
  const update: Parameters<typeof db.updateFrLead>[1] = {
    status: "fr_sent",
    assigned_account_id: accountId,
    fr_sent_at: new Date().toISOString(),
    next_eligible_at: new Date(Date.now() + jitter * 1000).toISOString(),
  };
  if (c.mode === "fr_then_dm" && c.combo_interval_seconds > 0) {
    update.fr_due_at = new Date(Date.now() + c.combo_interval_seconds * 1000).toISOString();
  }
  await db.updateFrLead(lead.id, update);
  db.logActivity(accountId, "fr_sent", { campaignId: c.id, leadId: lead.id, targetUsername: lead.username || "" });
  autoRestIfOverLimit(accountId, "fr_sent", 6).catch(() => {});
  publishExternalEvent({ type: "fr_sent", campaignId: c.id, leadId: lead.id, displayName: lead.display_name, accountId, ts: new Date().toISOString() } as any);
  console.log(`[fr-engine] FR sent campaign=${c.id} lead=${lead.discord_user_id} account=${accountId}`);
}

async function sendDmFirstForLead(
  c: db.FrCampaignRow,
  lead: db.FrLeadRow,
  accountId: string,
  token: string,
  frDueAt: string,
): Promise<void> {
  if (!(await db.tryClaimFrLead(lead.id))) {
    console.log(`[fr-engine] sendDmFirstForLead lead=${lead.id} already claimed — skipping`);
    return;
  }
  try {
    let channelId: string | null = null;
    if (browserFetchEnabled()) {
      const openRes = await browserOpenDmChannel(accountId, token, lead.discord_user_id, c.guild_id || undefined);
      if (!openRes.ok || !openRes.channelId) {
        await db.updateFrLead(lead.id, {
          assigned_account_id: accountId,
          dm_sent_at: new Date().toISOString(),
          fr_due_at: frDueAt,
          error: `DM channel open failed: ${openRes.error || "unknown"}`,
        });
        return;
      }
      channelId = openRes.channelId;
    } else {
      const chanR = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
        method: "POST",
        headers: await discordHeaders(token, true, undefined, accountId),
        body: JSON.stringify({ recipients: [lead.discord_user_id] }),
        timeoutMs: 12_000,
        accountId,
      });
      if (!chanR.ok) {
        await db.updateFrLead(lead.id, {
          assigned_account_id: accountId,
          dm_sent_at: new Date().toISOString(),
          fr_due_at: frDueAt,
          error: `DM channel open failed: HTTP ${chanR.status}`,
        });
        return;
      }
      const chan = await chanR.json() as any;
      channelId = String(chan.id);
    }

    const content = expand(c.template!, dailySeed([accountId]));
    const result = await sendDiscordMessage(accountId, token, channelId, content, {
      recipientUserId: lead.discord_user_id,
      originGuildId: c.guild_id || undefined,
    });

    // Rate-limited: back off without advancing dm_sent_at so the DM retries.
    if (!result.ok && result.httpStatus === 429) {
      const retryMs = parseRetryMs(result.error);
      console.warn(`[fr-engine] dm_then_fr DM 429 lead=${lead.id} — backing off ${Math.round(retryMs / 1000)}s`);
      await db.updateFrLead(lead.id, { next_eligible_at: new Date(Date.now() + retryMs).toISOString() });
      return;
    }

    await db.updateFrLead(lead.id, {
      assigned_account_id: accountId,
      dm_sent_at: new Date().toISOString(),
      fr_due_at: frDueAt,
      ...(result.ok ? {} : { error: `DM send failed: HTTP ${result.httpStatus}: ${result.error?.slice(0, 80)}` }),
    });

    if (result.ok) {
      console.log(`[fr-engine] dm_then_fr DM sent campaign=${c.id} lead=${lead.discord_user_id} via=${result.via}`);
    }
  } catch (err: any) {
    console.warn(`[fr-engine] dm_then_fr DM error lead=${lead.id}: ${err?.message || err}`);
    await db.updateFrLead(lead.id, {
      assigned_account_id: accountId,
      dm_sent_at: new Date().toISOString(),
      fr_due_at: frDueAt,
      error: `DM failed: ${String(err?.message || err).slice(0, 100)}`,
    }).catch(() => {});
  } finally {
    await db.releaseFrLeadClaim(lead.id).catch(() => {});
  }
}

export async function handleFrAccepted(accountId: string, friendDiscordUserId: string): Promise<void> {
  const frLeads = await db.findFrLeadByDiscordUser(friendDiscordUserId);
  for (const lead of frLeads) {
    await db.updateFrLead(lead.id, {
      status: "fr_accepted",
      fr_accepted_at: new Date().toISOString(),
    });
    publishExternalEvent({
      type: "fr_accepted",
      campaignId: lead.campaign_id,
      leadId: lead.id,
      displayName: lead.display_name,
      accountId,
      ts: new Date().toISOString(),
    } as any);
    console.log(`[fr-engine] FR accepted lead=${lead.discord_user_id} campaign=${lead.campaign_id}`);

    if (lead.campaign_mode === "fr_only" && lead.campaign_template) {
      const allAccts = await db.loadAllAccounts({ sendableOnly: true });
      const acctEntry = allAccts.find((a) => a.account.id === accountId);
      const token = acctEntry?.token ?? null;
      if (token) {
      const campaign = await db.getFrCampaign(lead.campaign_id).catch(() => null);
      await sendTemplateDm(accountId, friendDiscordUserId, lead.campaign_template, lead.id, token, campaign?.guild_id);
    }
    }
  }

  try {
    const outreachLeads = await db.query<{ id: string; campaign_id: string }>(
      `UPDATE tenant_main.campaign_leads
          SET fr_accepted_at = now()
        WHERE discord_user_id = $1
          AND fr_sent_at IS NOT NULL
          AND fr_accepted_at IS NULL
        RETURNING id, campaign_id`,
      [friendDiscordUserId],
    );
    for (const l of outreachLeads) {
      publishExternalEvent({
        type: "fr_accepted",
        campaignId: l.campaign_id,
        leadId: l.id,
        displayName: friendDiscordUserId,
        accountId,
        ts: new Date().toISOString(),
      } as any);
    }
  } catch { /* outreach combo columns may not exist on older installs */ }
}

export async function sendFrManual(
  campaignId: string,
  leadId: string,
): Promise<{ ok: boolean; accountId?: string; error?: string }> {
  const c = await db.getFrCampaign(campaignId);
  if (!c) return { ok: false, error: "campaign not found" };

  const lead = await db.getFrLead(leadId);
  if (!lead) return { ok: false, error: "lead not found" };
  if (lead.campaign_id !== campaignId) return { ok: false, error: "lead not in campaign" };

  const allAccts = await db.loadAllAccounts({ sendableOnly: true });
  const connected = allAccts.filter((a) => isSendable(a));
  if (connected.length === 0) return { ok: false, error: "no connected accounts available" };
  const connectedIds = new Set(connected.map((a) => a.account.id));

  let accountId = lead.assigned_account_id ?? null;
  if (!accountId || !connectedIds.has(accountId)) {
    for (const a of connected) {
      const sendsToday = await db.countFrSendsToday(campaignId, a.account.id);
      if (sendsToday < c.fr_per_account_per_day) { accountId = a.account.id; break; }
    }
  }
  if (!accountId) return { ok: false, error: "all accounts at daily FR limit" };

  const acctEntry = allAccts.find((a) => a.account.id === accountId);
  const token = acctEntry?.token ?? null;
  if (!token) return { ok: false, error: "no token for account" };

  await sendFr(c, lead, accountId, token);

  const updated = await db.getFrLead(leadId);
  if (!updated) return { ok: false, error: "lead not found after send" };
  if (updated.status === "failed") return { ok: false, accountId, error: updated.error ?? "failed" };
  return { ok: true, accountId };
}

async function sendTemplateDm(accountId: string, discordUserId: string, template: string, leadId: string, token: string, guildId?: string | null): Promise<void> {
  if (!(await db.tryClaimFrLead(leadId))) {
    console.log(`[fr-engine] sendTemplateDm lead=${leadId} already claimed — skipping`);
    return;
  }
  try {
    console.log(`[fr-engine] sendTemplateDm START lead=${leadId} account=${accountId}`);

    let channelId: string | null = null;
    if (browserFetchEnabled()) {
      const openRes = await browserOpenDmChannel(accountId, token, discordUserId, guildId || undefined);
      console.log(`[fr-engine] sendTemplateDm channel lead=${leadId} ok=${openRes.ok}`);
      if (!openRes.ok || !openRes.channelId) {
        await db.updateFrLead(leadId, { dm_sent_at: new Date().toISOString(), error: `DM channel failed: ${openRes.error || "unknown"}` });
        return;
      }
      channelId = openRes.channelId;
    } else {
      const chanR = await tlsFetch("https://discord.com/api/v9/users/@me/channels", {
        method: "POST",
        headers: await discordHeaders(token, true, undefined, accountId),
        body: JSON.stringify({ recipients: [discordUserId] }),
        timeoutMs: 12_000,
        accountId,
      });
      console.log(`[fr-engine] sendTemplateDm channel lead=${leadId} status=${chanR.status}`);
      if (!chanR.ok) {
        await db.updateFrLead(leadId, { dm_sent_at: new Date().toISOString(), error: `DM channel failed: HTTP ${chanR.status}` });
        return;
      }
      const chan = await chanR.json() as any;
      channelId = String(chan.id);
    }

    const content = expand(template, dailySeed([accountId]));
    const result = await sendDiscordMessage(accountId, token, channelId, content, {
      recipientUserId: discordUserId,
      originGuildId: guildId || undefined,
    });
    console.log(`[fr-engine] sendTemplateDm message lead=${leadId} status=${result.httpStatus} ok=${result.ok} via=${result.via}`);

    // Rate-limited: back off and retry later instead of consuming the lead.
    if (!result.ok && result.httpStatus === 429) {
      const retryMs = parseRetryMs(result.error);
      console.warn(`[fr-engine] sendTemplateDm 429 lead=${leadId} — backing off ${Math.round(retryMs / 1000)}s`);
      await db.updateFrLead(leadId, { next_eligible_at: new Date(Date.now() + retryMs).toISOString() });
      return;
    }

    if (result.ok) {
      await db.updateFrLead(leadId, { status: "dm_sent", dm_sent_at: new Date().toISOString() });
      publishExternalEvent({ type: "fr_dm_sent", leadId, ts: new Date().toISOString() } as any);
      console.log(`[fr-engine] template DM sent lead=${leadId} via=${result.via}`);
    } else {
      await db.updateFrLead(leadId, { dm_sent_at: new Date().toISOString(), error: `DM send failed: HTTP ${result.httpStatus}: ${result.error?.slice(0, 80)}` });
    }
  } catch (err: any) {
    console.warn(`[fr-engine] template DM failed lead=${leadId}: ${err?.message || err}`);
    await db.updateFrLead(leadId, { next_eligible_at: new Date(Date.now() + 5 * 60_000).toISOString() }).catch(() => {});
  } finally {
    await db.releaseFrLeadClaim(leadId).catch(() => {});
  }
}
