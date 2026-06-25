// v0.70 — account warmup state machine.
//
// State machine:
//
//   captured ──proxy assigned──> warming ──Day 10──> warmed ──> outreach
//                                  │                              │
//                                  │ (4004)                       │ (4004)
//                                  ▼                              ▼
//                              quarantined ─7 days─> retired   quarantined
//
// Why this exists: v0.65 burned three accounts because the campaign-engine
// had no gate between "captured" and "can do cold outreach." Now the engine
// asks `canDoOutreach(accountId)` first; only `warmed`/`outreach` say yes.

import { query } from "./db";

export type WarmupStatus =
  | "captured"      // freshly imported, no proxy assigned yet, no warmup activity
  | "warming"       // proxy assigned, Phase 1/2 actions running, < 10 days since start
  | "warmed"        // 10+ days of warmup activity completed, no 4004 — eligible for outreach
  | "outreach"      // currently being used in an active campaign
  | "quarantined"   // hit 4004 or critical failure; cool-down before retry
  | "retired";      // quarantined > 7 days without recovery; never used again

const TRANSITIONS: Record<WarmupStatus, WarmupStatus[]> = {
  captured:    ["warming", "quarantined"],
  warming:     ["warmed", "quarantined"],
  warmed:      ["outreach", "quarantined"],
  outreach:    ["warmed", "quarantined"], // campaign-engine can release back to warmed when campaign ends
  quarantined: ["retired", "warming"],    // operator can manually re-attempt warmup after fixing cause
  retired:     [],                        // terminal
};

export async function getStatus(accountId: string): Promise<WarmupStatus | null> {
  const rows = await query<{ warmup_status: string }>(
    `SELECT warmup_status FROM tenant_main.discord_accounts WHERE id = $1`,
    [accountId],
  );
  return rows[0] ? (rows[0].warmup_status as WarmupStatus) : null;
}

export interface TransitionInput {
  accountId: string;
  to: WarmupStatus;
  reason?: string;
}

export async function transition(input: TransitionInput): Promise<{ ok: boolean; from?: WarmupStatus; error?: string }> {
  const current = await getStatus(input.accountId);
  if (!current) return { ok: false, error: "account not found" };
  if (current === input.to) return { ok: true, from: current }; // idempotent no-op

  const allowed = TRANSITIONS[current];
  if (!allowed.includes(input.to)) {
    return { ok: false, from: current, error: `illegal transition ${current} → ${input.to}` };
  }

  // Stamp lifecycle timestamps along the way so the dashboard / 7-day retire
  // sweep can compute durations without joining warmup_actions.
  const stamps: string[] = [];
  if (input.to === "warming" && current === "captured") stamps.push("warmup_started_at = now()");
  if (input.to === "warmed"  && current === "warming")  stamps.push("warmup_completed_at = now()");

  await query(
    `UPDATE tenant_main.discord_accounts
        SET warmup_status = $2
            ${stamps.length ? "," + stamps.join(",") : ""}
      WHERE id = $1`,
    [input.accountId, input.to],
  );

  // Log to audit so we have a timeline for post-mortems.
  await query(
    `INSERT INTO tenant_main.warmup_actions
       (account_id, action_type, success, payload)
     VALUES ($1, 'state_transition', true, $2)`,
    [input.accountId, `${current} -> ${input.to}${input.reason ? `: ${input.reason}` : ""}`],
  );

  console.log(`[acct-state] ${input.accountId}: ${current} → ${input.to}${input.reason ? ` (${input.reason})` : ""}`);
  return { ok: true, from: current };
}

// Used by campaign-engine before queuing any outreach action. Returns false
// for any state that isn't `warmed` or `outreach`. Captured / warming
// accounts get rejected — this is the load-bearing gate that prevents the
// v0.65 burn from recurring.
export async function canDoOutreach(accountId: string): Promise<boolean> {
  const s = await getStatus(accountId);
  return s === "warmed" || s === "outreach";
}

// Used by warmup-engine to find work. Returns the set of accounts currently
// in active warmup so the engine can pick one and execute its day's action.
export async function listWarmingAccounts(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM tenant_main.discord_accounts WHERE warmup_status = 'warming'`,
  );
  return rows.map((r) => r.id);
}

// Audit helper — log a warmup action regardless of outcome.
export interface ActionLog {
  accountId: string;
  actionType:
    | "join_server" | "channel_post" | "react_message"
    | "set_avatar" | "set_bio" | "set_status"
    | "accept_friend" | "inter_account_dm" | "state_transition";
  targetId?: string;
  success: boolean;
  httpStatus?: number;
  error?: string;
  captchaSolved?: boolean;
  captchaCostCents?: number;
  spintaxSeed?: string;
  payload?: string;
}

export async function logAction(a: ActionLog): Promise<void> {
  try {
    await query(
      `INSERT INTO tenant_main.warmup_actions
         (account_id, action_type, target_id, success, http_status, error,
          captcha_solved, captcha_cost_cents, spintax_seed, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        a.accountId,
        a.actionType,
        a.targetId || null,
        a.success,
        a.httpStatus || null,
        a.error || null,
        a.captchaSolved || false,
        a.captchaCostCents || 0,
        a.spintaxSeed || null,
        a.payload || null,
      ],
    );
    // Bump last_action_at so the warmup-engine can throttle per-account cadence.
    await query(
      `UPDATE tenant_main.discord_accounts SET last_action_at = now() WHERE id = $1`,
      [a.accountId],
    );
  } catch (err) {
    console.warn(`[acct-state] logAction failed acct=${a.accountId}: ${(err as any)?.message || err}`);
  }
}

// How many actions of (any | specific type) has this account done today (UTC)?
// Used by warmup-engine to decide whether the day's cap is hit.
export async function actionsToday(accountId: string, actionType?: ActionLog["actionType"]): Promise<number> {
  const conds = ["account_id = $1", "occurred_at >= (now() AT TIME ZONE 'UTC')::date", "success = true"];
  const params: any[] = [accountId];
  if (actionType) {
    conds.push("action_type = $2");
    params.push(actionType);
  }
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tenant_main.warmup_actions WHERE ${conds.join(" AND ")}`,
    params,
  );
  return Number(rows[0]?.n || 0);
}

// v0.70.3 — total attempts today regardless of success. Used to cap
// captcha-burning retries on join_server (which fails ~50% on cold-IP Day-1).
// Without this cap, the engine would loop on the same failing action every
// tick and exhaust 2Captcha credits.
export async function attemptsToday(accountId: string, actionType: ActionLog["actionType"]): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tenant_main.warmup_actions
       WHERE account_id = $1
         AND action_type = $2
         AND occurred_at >= (now() AT TIME ZONE 'UTC')::date`,
    [accountId, actionType],
  );
  return Number(rows[0]?.n || 0);
}

// How many days since the account started warmup (used by Phase 1 / Phase 2
// action selection — Days 1-3 use a different action table than Days 4-10).
export async function daysIntoWarmup(accountId: string): Promise<number> {
  const rows = await query<{ d: number | null }>(
    `SELECT EXTRACT(DAY FROM (now() - warmup_started_at))::int AS d
       FROM tenant_main.discord_accounts WHERE id = $1`,
    [accountId],
  );
  return Number(rows[0]?.d || 0);
}
