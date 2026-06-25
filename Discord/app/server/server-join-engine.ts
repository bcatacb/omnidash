// server-join-engine.ts — background engine that processes server_join_queue rows
// one at a time, with auto-captcha solving and post-join gateway browse.
//
// Design principles:
//   - Only ONE join fires per tick, globally — no concurrency ever
//   - Global rate floor: MIN_JOIN_INTERVAL_MS between any two joins
//   - Captcha: auto-solved via 2captcha proxy relay (up to 3 attempts)
//   - Post-join: sends OP 14 LAZY_GUILD_REQUEST to browse channels naturally
//   - All join outcomes logged to account_activity_log

import * as db from './db';
import { joinByInvite } from './discord-scrape';
import { sendLazyGuildRequest, getAccountGuilds } from './discord-gateway';
import { solveCaptchaForToken } from './captcha';

const MAX_CAPTCHA_ATTEMPTS = 3;
const MIN_JOIN_INTERVAL_MS = 4 * 60_000;   // at least 4 min between joins
const RESCHEDULE_MS = 45 * 60_000;         // reschedule window on temp failure

let lastJoinAt = 0;
let ticking = false;
let engineTimer: ReturnType<typeof setInterval> | null = null;

export function startJoinEngine(): void {
  if (engineTimer) return;
  console.log('[join-engine] started — polling every 2 min');
  setTimeout(runTick, 8_000);  // first check shortly after boot
  engineTimer = setInterval(runTick, 2 * 60_000);
}

export function stopJoinEngine(): void {
  if (engineTimer) { clearInterval(engineTimer); engineTimer = null; }
}

async function runTick(): Promise<void> {
  if (ticking) return;
  if (Date.now() - lastJoinAt < MIN_JOIN_INTERVAL_MS) return;
  ticking = true;
  try {
    const row = await db.getNextDueJoin();
    if (!row) return;

    // Account already in guild? (gateway cache check)
    const guilds = getAccountGuilds(row.account_id);
    if (guilds.some((g) => g.id === row.guild_id)) {
      await db.updateJoinQueueRow(row.id, { status: 'skipped', error: 'already a member' });
      await db.checkCampaignCompletion(row.campaign_id);
      return;
    }

    const { _getCapturedToken } = require('./discord-mock');
    const token: string | null = _getCapturedToken(row.account_id);
    if (!token) {
      await db.updateJoinQueueRow(row.id, { status: 'skipped', error: 'no active token' });
      await db.checkCampaignCompletion(row.campaign_id);
      return;
    }

    await db.updateJoinQueueRow(row.id, { status: 'joining' });

    const outcome = await joinWithAutoCaptcha(row.account_id, token, row.invite_code, row.attempt_count);
    lastJoinAt = Date.now();

    if (outcome.ok) {
      await db.updateJoinQueueRow(row.id, { status: 'joined', joined_at: new Date().toISOString(), error: null });
      db.logActivity(row.account_id, 'server_join', {
        guildId: outcome.guildId ?? row.guild_id,
        guildName: outcome.guildName ?? row.guild_name,
        inviteCode: row.invite_code,
        captchaAttempts: outcome.captchaAttempts ?? 0,
      });
      console.log(`[join-engine] ✓ account=${row.account_id} guild=${row.guild_name ?? row.guild_id}`);

      if (row.post_join_action === 'browse' && outcome.channelId) {
        schedulePostJoinBrowse(row.account_id, row.guild_id, outcome.channelId);
      }
    } else if (outcome.captchaMaxed) {
      await db.updateJoinQueueRow(row.id, {
        status: 'failed', attempt_count: row.attempt_count + (outcome.captchaAttempts ?? 0),
        error: `captcha: ${MAX_CAPTCHA_ATTEMPTS} attempts exhausted`,
      });
      console.warn(`[join-engine] ✗ account=${row.account_id} captcha maxed`);
    } else if (outcome.retry && row.attempt_count < 2) {
      const reschedule = new Date(Date.now() + RESCHEDULE_MS + Math.random() * 15 * 60_000);
      await db.updateJoinQueueRow(row.id, {
        status: 'pending', attempt_count: row.attempt_count + 1,
        error: outcome.error, scheduled_at: reschedule.toISOString(),
      });
      console.warn(`[join-engine] ↻ account=${row.account_id} rescheduled: ${outcome.error}`);
    } else {
      await db.updateJoinQueueRow(row.id, {
        status: 'failed', attempt_count: row.attempt_count + 1, error: outcome.error ?? 'unknown',
      });
      console.warn(`[join-engine] ✗ account=${row.account_id} final fail: ${outcome.error}`);
    }

    await db.checkCampaignCompletion(row.campaign_id);
  } catch (err: any) {
    console.error('[join-engine] tick error:', err?.message || err);
  } finally {
    ticking = false;
  }
}

type Outcome = {
  ok: boolean;
  guildId?: string; guildName?: string; channelId?: string;
  error?: string; retry?: boolean;
  captchaMaxed?: boolean; captchaAttempts?: number;
};

async function joinWithAutoCaptcha(
  accountId: string,
  token: string,
  inviteCode: string,
  priorAttempts: number,
): Promise<Outcome> {
  let captchaAttempts = 0;
  let captchaKey: string | undefined;
  let captchaRqtoken: string | undefined;

  let result = await joinByInvite(token, inviteCode, captchaKey, captchaRqtoken, accountId);

  while (result.captcha) {
    if (captchaAttempts >= MAX_CAPTCHA_ATTEMPTS) {
      return { ok: false, captchaMaxed: true, captchaAttempts };
    }
    console.log(`[join-engine] captcha account=${accountId} attempt=${captchaAttempts + 1}`);
    const solved = await solveCaptchaForToken({
      sitekey: result.captcha.sitekey,
      pageUrl: `https://discord.com/invite/${inviteCode}`,
      rqdata: result.captcha.rqdata,
      rqtoken: result.captcha.rqtoken,
      accountId,
    });
    captchaAttempts++;
    if (!solved.ok) {
      return { ok: false, error: `captcha solve failed: ${solved.error}`, retry: true, captchaAttempts };
    }
    captchaKey = solved.token;
    captchaRqtoken = solved.rqtoken ?? result.captcha.rqtoken;
    result = await joinByInvite(token, inviteCode, captchaKey, captchaRqtoken, accountId);
  }

  if (result.ok) {
    return { ok: true, guildId: result.guildId, guildName: result.guildName, channelId: result.channelId, captchaAttempts };
  }

  const alreadyMember = result.httpStatus === 400 && (result.error?.toLowerCase().includes('already') ?? false);
  if (alreadyMember) return { ok: true, captchaAttempts }; // idempotent

  const retryable = result.httpStatus !== undefined && [429, 500, 502, 503].includes(result.httpStatus);
  return {
    ok: false,
    error: result.error ?? `HTTP ${result.httpStatus}`,
    retry: retryable || priorAttempts < 1,
    captchaAttempts,
  };
}

function schedulePostJoinBrowse(accountId: string, guildId: string, channelId: string): void {
  const delayMs = 2 * 60_000 + Math.floor(Math.random() * 6 * 60_000); // 2–8 min
  setTimeout(() => {
    try {
      sendLazyGuildRequest(accountId, guildId, channelId, [[0, 99]]);
      console.log(`[join-engine] browse account=${accountId} guild=${guildId}`);
    } catch (err: any) {
      console.warn(`[join-engine] post-join browse error: ${err?.message}`);
    }
  }, delayMs);
}
