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
import { lookupAccountProxy } from './discord-http';

const MAX_CAPTCHA_ATTEMPTS = 3;
const MIN_JOIN_INTERVAL_MS = 4 * 60_000;   // at least 4 min between joins
const RESCHEDULE_MS = 45 * 60_000;         // reschedule window on temp failure

// Simple in-memory backoff for invite codes that are getting repeated UNSOLVABLE captchas.
// Prevents hammering the same bad code (Discord ramps difficulty fast on repeat usage).
const codeFailureCounts = new Map<string, number>();
const CODE_BACKOFF_MS = 30 * 60 * 1000; // 30 min backoff after 2+ failures on a code
const codeBackoffUntil = new Map<string, number>();

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
  ticking = true;

  try {
    // Recovery only when engine is free (not during active captcha solve).
    // Prevents interfering with in-progress solves on an account.
    await recoverStaleJoiningRows();

    if (Date.now() - lastJoinAt < MIN_JOIN_INTERVAL_MS) return;
    const row = await db.getNextDueJoin();
    if (!row) return;

    const proxyUrl = await lookupAccountProxy(row.account_id).catch(() => undefined);
    console.log(`[join-engine] next due: account=${row.account_id} guild=${row.guild_name || row.guild_id} code=${row.invite_code} proxy=${proxyUrl ? 'assigned' : 'NONE (IP mismatch risk)'} scheduled=${row.scheduled_at} campaign=${row.campaign_id}`);

    // Per-code backoff: skip this code temporarily if it's been failing captchas a lot.
    const code = row.invite_code;
    const backoffUntil = codeBackoffUntil.get(code) || 0;
    if (Date.now() < backoffUntil) {
      const waitMin = Math.ceil((backoffUntil - Date.now()) / 60000);
      console.log(`[join-engine] backing off code=${code} for ~${waitMin}m due to recent unsolvables`);
      // Reschedule this row a bit later and move on.
      await db.updateJoinQueueRow(row.id, {
        scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      return;
    }

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

    // Always record the join attempt (success or failure) so invite codes are saved in history.
    const attemptStatus = outcome.ok
      ? 'joined'
      : outcome.captchaMaxed
      ? 'captcha_maxed'
      : (outcome.retry && row.attempt_count < 2)
      ? 'failed_retry'
      : 'failed';
    db.logActivity(row.account_id, 'server_join', {
      guildId: outcome.guildId ?? row.guild_id,
      guildName: outcome.guildName ?? row.guild_name,
      inviteCode: row.invite_code,
      status: attemptStatus,
      error: outcome.error,
      httpStatus: outcome.httpStatus,
      captchaAttempts: outcome.captchaAttempts ?? 0,
    });

    if (outcome.ok) {
      await db.updateJoinQueueRow(row.id, { status: 'joined', joined_at: new Date().toISOString(), error: null });
      console.log(`[join-engine] ✓ account=${row.account_id} guild=${row.guild_name ?? row.guild_id}`);

      // Reset per-code failure tracking on success.
      codeFailureCounts.delete(code);
      codeBackoffUntil.delete(code);

      // joinByInvite already does the PATCH to /members/@me to complete
      // membership screening (acknowledge rules). We additionally do the
      // natural "browse channels" (OP 14) when configured so the account
      // appears to actually open and read the server.
      if (row.post_join_action === 'browse' && outcome.channelId) {
        schedulePostJoinBrowse(row.account_id, row.guild_id, outcome.channelId);
      }
    } else if (outcome.captchaMaxed) {
      await db.updateJoinQueueRow(row.id, {
        status: 'failed', attempt_count: row.attempt_count + (outcome.captchaAttempts ?? 0),
        error: `captcha: ${MAX_CAPTCHA_ATTEMPTS} attempts exhausted`,
      });
      console.warn(`[join-engine] ✗ account=${row.account_id} captcha maxed`);
    } else if (outcome.retry && row.attempt_count < 2 && !(outcome.error && /captcha required/i.test(outcome.error) && (outcome.captchaAttempts || 0) > 0)) {
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

      // Track bad solve failures per code for backoff (prevents burning the same code).
      // Includes UNSOLVABLE and post-solve "captcha required" (bad token from solver).
      const isBadSolve = outcome.error && (
        /UNSOLVABLE|unsolvable/i.test(outcome.error) ||
        (/captcha required/i.test(outcome.error) && (outcome.captchaAttempts || 0) > 0)
      );
      if (isBadSolve) {
        const count = (codeFailureCounts.get(code) || 0) + 1;
        codeFailureCounts.set(code, count);
        if (count >= 2) {
          codeBackoffUntil.set(code, Date.now() + CODE_BACKOFF_MS);
          console.warn(`[join-engine] code=${code} getting bad solves (count=${count}) — backing off 30m`);
        }
      }
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
  httpStatus?: number;
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
  let captchaSessionId: string | undefined;

  let result = await joinByInvite(token, inviteCode, captchaKey, captchaRqtoken, captchaSessionId, accountId);

  if (result.captcha) {
    captchaSessionId = result.captcha.sessionId;
  }

  // Only ONE captcha solve per engine tick / account processing.
  // This prevents repeated solves on a single account in quick succession
  // (which was causing rate issues and repeated UNSOLVABLE).
  // Previous versions did one attempt per processing + reschedule on fail.
  if (result.captcha) {
    captchaAttempts = 1;
    console.log(`[join-engine] captcha account=${accountId} attempt=1`);
    const solved = await solveCaptchaForToken({
      sitekey: result.captcha.sitekey,
      pageUrl: `https://discord.com/invite/${inviteCode}`,
      rqdata: result.captcha.rqdata,
      rqtoken: result.captcha.rqtoken,
      accountId,
    });
    if (!solved.ok) {
      return { ok: false, error: `captcha solve failed: ${solved.error}`, retry: true, captchaAttempts: 1, httpStatus: 0 };
    }
    captchaKey = solved.token;
    captchaRqtoken = solved.rqtoken ?? result.captcha.rqtoken;
    captchaSessionId = result.captcha.sessionId;
    console.log(`[join-engine] captcha solved for account=${accountId} — submitting with rqtoken=${!!captchaRqtoken}`);
    console.log(`[join-engine] submitting solved captcha body keys: captcha_key=${captchaKey ? captchaKey.slice(0,20)+'...' : 'none'} captcha_rqtoken=${captchaRqtoken ? captchaRqtoken.slice(0,20)+'...' : 'none'}`);
    result = await joinByInvite(token, inviteCode, captchaKey, captchaRqtoken, captchaSessionId, accountId);

    // Efficient post-solve handling: if Discord still wants captcha, grab the fresh rqtoken
    // it just gave us and do one immediate cheap re-submit with the already-solved key.
    // Avoids full reschedule + another 2captcha call in many "stale rqtoken" cases.
    if (result.captcha) {
      const freshRq = result.captcha.rqtoken || captchaRqtoken;
      const freshSession = result.captcha.sessionId || captchaSessionId;
      if (freshRq && freshRq !== captchaRqtoken) {
        console.log(`[join-engine] fresh rqtoken from Discord — quick re-submit (no new solve)`);
        result = await joinByInvite(token, inviteCode, captchaKey, freshRq, freshSession, accountId);
      } else {
        console.warn(`[join-engine] STILL captcha after solve account=${accountId} http=${result.httpStatus} — Discord rejected the token`);
      }
    }
  }

  if (result.ok) {
    return { ok: true, guildId: result.guildId, guildName: result.guildName, channelId: result.channelId, captchaAttempts, httpStatus: result.httpStatus };
  }

  const alreadyMember = result.httpStatus === 400 && (result.error?.toLowerCase().includes('already') ?? false);
  if (alreadyMember) return { ok: true, captchaAttempts, httpStatus: result.httpStatus }; // idempotent

  const retryable = result.httpStatus !== undefined && [429, 500, 502, 503].includes(result.httpStatus);
  return {
    ok: false,
    error: result.error ?? `HTTP ${result.httpStatus}`,
    retry: retryable || priorAttempts < 1,
    captchaAttempts,
    httpStatus: result.httpStatus,
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

async function recoverStaleJoiningRows(): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const stale = await db.query<{ id: number; campaign_id: string; account_id: string }>(
      `SELECT id, campaign_id, account_id
         FROM tenant_main.server_join_queue
        WHERE status = 'joining'
          AND scheduled_at < $1
        LIMIT 20`,
      [tenMinutesAgo]
    );

    for (const row of stale) {
      await db.updateJoinQueueRow(row.id, {
        status: 'pending',
        error: 'recovered from stale joining state (hung >15min)',
        scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      console.warn(`[join-engine] recovered stale joining row id=${row.id} account=${row.account_id}`);
    }
  } catch (e: any) {
    console.warn('[join-engine] recoverStaleJoiningRows failed:', e?.message || e);
  }
}
