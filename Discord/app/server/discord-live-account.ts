/**
 * Live account poller.
 *
 * Once we've captured a Discord user token (via QR or token-paste), this module
 * uses it to populate REAL data on the account:
 *   - friend count + pending outgoing friend requests (via /users/@me/relationships)
 *   - existing DM conversations (via /users/@me/channels)
 *   - last ~20 messages per DM (via /channels/{id}/messages)
 *
 * Runs an initial fetch immediately + then every 60 s. Flips the account's
 * status from "connecting" → "connected" after the first successful fetch.
 *
 * Real-time message arrival (gateway WebSocket) is a separate, larger task
 * deliberately deferred — see project_discord_qr_proxy memory note + spec.
 */

import { state, _getCapturedToken } from "./discord-mock";
import { publishExternalEvent } from "./realtime";
import * as db from "./db";

import { discordHeaders, tlsFetch } from "./discord-http";
import { formatDiscordContent, isSystemMessage } from "./discord-format";

const POLL_INTERVAL_MS = 15_000;
const pollers = new Map<string, NodeJS.Timeout>();

// Per-account: cached own user id (from /users/@me on first poll), and a one-shot
// flag indicating we've completed the boot-time full-history backfill for this account.
const ownUserIds = new Map<string, string>();
const backfillDone = new Set<string>();
// Per-account: channels we noticed are MISSING from Discord's response since
// the last poll. A channel must be missing for 2 consecutive polls before we
// actually remove it, so a transient Discord blip can't wipe the unibox.
//   key: accountId, value: Set<channelId-currently-missing-since-last-poll>
const missingChannelsByAccount = new Map<string, Set<string>>();

// Per-channel cap when fetching full history. Most DMs are well under this; for
// busy channels we'd rather stop early than spend 30+ minutes paging Discord.
const HISTORY_CAP_PER_CHANNEL = 1000;
const HISTORY_PAGE_SIZE = 100; // Discord max
const PAGE_DELAY_MS = 250;     // polite spacing between paged requests

async function fetchOwnUserId(token: string, accountId?: string): Promise<string | null> {
  const me = await discordFetch("https://discord.com/api/v9/users/@me", token, accountId);
  return me?.id ? String(me.id) : null;
}

/**
 * Walk Discord's /channels/{id}/messages with `before=` pagination, going from
 * newest to oldest. If `startBefore` is set, we start paging strictly OLDER
 * than that id (so backfill on an existing conv fills in history before our
 * oldest known message — newer messages are already covered by the gateway WS).
 * Returns messages in oldest-first order.
 */
async function fullChannelHistory(
  token: string,
  channelId: string,
  options: { startBefore?: string; cap?: number; accountId?: string } = {},
): Promise<any[]> {
  const cap = options.cap ?? HISTORY_CAP_PER_CHANNEL;
  const collected: any[] = [];
  let before: string | undefined = options.startBefore;
  while (collected.length < cap) {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (before) params.set("before", before);
    const batch = await discordFetch(
      `https://discord.com/api/v9/channels/${channelId}/messages?${params}`,
      token,
      options.accountId,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) collected.push(m);
    if (batch.length < HISTORY_PAGE_SIZE) break;
    before = batch[batch.length - 1]?.id; // oldest of this batch
    if (!before) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  return collected.reverse(); // newest-first → oldest-first
}

async function loadDbMessagesForConv(convId: string): Promise<any[]> {
  try { return await db.loadMessagesForConversation(convId); } catch { return []; }
}

function mergeMessages(a: any[], b: any[]): any[] {
  const byId = new Map<string, any>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return Array.from(byId.values()).sort((x, y) => x.sentAt.localeCompare(y.sentAt));
}

function rawToMessage(raw: any, convId: string, ownUserId: string | null) {
  const authorId = String(raw?.author?.id || "");
  const msgType = Number(raw?.type ?? 0);
  return {
    id: `live_msg_${raw.id}`,
    conversationId: convId,
    direction: (ownUserId && authorId === ownUserId ? "out" : "in") as "in" | "out",
    body: msgType === 3 ? "📞 Incoming call" : formatDiscordContent(raw),
    sentAt: String(raw?.timestamp || new Date().toISOString()),
    authorName: String(raw?.author?.global_name || raw?.author?.username || "unknown"),
    authorAvatarUrl: authorId ? discordAvatar(authorId, raw?.author?.avatar) : null,
  };
}

async function discordFetch(url: string, token: string, accountId?: string): Promise<any | null> {
  try {
    const r = await tlsFetch(url, {
      method: "GET",
      headers: await discordHeaders(token, false, undefined, accountId),
      timeoutMs: 15_000,
      accountId,
    });
    if (!r.ok) {
      // Gateway WS code 4004 is the only authoritative source for token revocation.
      // A single 401 from the poller can be a transient Discord API hiccup; marking
      // token_revoked here causes false positives that quarantine healthy accounts.
      console.warn(`[live] account=${accountId ?? "?"} poll ${url} -> HTTP ${r.status} (ignored — gateway is authoritative)`);
      return null;
    }
    return await r.json();
  } catch (err: any) {
    console.warn(`[live] ${url} threw: ${err?.message || err}`);
    return null;
  }
}

function discordAvatar(userId: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128`;
}

/** Single poll cycle. Returns false on hard auth failure so the caller can stop. */
async function pollOnce(accountId: string, token: string): Promise<boolean> {
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) return false;

  // 1) Relationships → friend counts.
  // Discord relationship types: 1 = friend, 2 = blocked, 3 = incoming FR, 4 = outgoing FR.
  const rels = await discordFetch("https://discord.com/api/v9/users/@me/relationships", token, accountId);
  if (Array.isArray(rels)) {
    let friends = 0;
    let pendingOut = 0;
    for (const r of rels) {
      if (r?.type === 1) friends++;
      else if (r?.type === 4) pendingOut++;
    }
    acct.friendsCount = friends;
    acct.pendingOutgoing = pendingOut;
    db.updateAccountStats(acct.id, friends, pendingOut, acct.status).catch(() => {});
  } else if (rels === null) {
    // /users/@me/relationships failed (429 rate-limit, captcha, transient error).
    // Don't return early — fall through to channels + status flip so accounts
    // bulk-imported under rate-limit pressure don't stay in 'connecting' forever.
    // The gateway WS is the source of truth for real auth failures (4004 close).
    console.warn(`[live] account=${accountId} relationships unavailable; skipping friend-count update (gateway is the truth)`);
  }

  // Ensure we know our own user id so direction (in/out) is correct.
  let ownUserId = ownUserIds.get(accountId) || null;
  if (!ownUserId) {
    ownUserId = await fetchOwnUserId(token, accountId);
    if (ownUserId) ownUserIds.set(accountId, ownUserId);
  }

  // 2) DM channels → conversations.
  // Channel types: 1 = DM, 3 = group DM, others = guild (ignore).
  const channels = await discordFetch("https://discord.com/api/v9/users/@me/channels", token, accountId);
  if (Array.isArray(channels)) {
    for (const ch of channels) {
      if (ch?.type !== 1 && ch?.type !== 3) continue;
      const convId = `live_${ch.id}`;
      const existing = state.conversations.find((c) => c.id === convId);
      const recipient = Array.isArray(ch.recipients) && ch.recipients[0] ? ch.recipients[0] : null;
      const peerName = ch.type === 3
        ? (ch.name || (ch.recipients?.map((r: any) => r.global_name || r.username).join(", ") ?? "Group DM"))
        : (recipient?.global_name || recipient?.username || "Unknown");
      const peerId = recipient?.id || ch.id;
      const peerAvatar = recipient ? discordAvatar(recipient.id, recipient.avatar) : null;

      // 3) Pull message history for this channel.
      //    - New conv (first time we see it): walk full history up to HISTORY_CAP_PER_CHANNEL.
      //    - Existing conv on FIRST post-boot poll: backfill — walk full history (the gateway WS
      //      handles real-time deltas after, so we only need this once per process).
      //    - Existing conv on later polls: skip (gateway covers it).
      let messagesForConv = state.messages.get(convId);
      const isNew = !existing;
      const needsBackfill = !backfillDone.has(accountId) && !!existing;
      if (isNew || needsBackfill) {
        // Always page Discord from the newest message all the way back to the per-channel cap.
        // Dedup happens automatically via the messages.id PRIMARY KEY (ON CONFLICT DO NOTHING)
        // — we just re-pass already-known ones and only newly-discovered ones actually persist.
        const raw = await fullChannelHistory(token, ch.id, { accountId });
        const converted = raw.filter((m: any) => !isSystemMessage(m)).map((m: any) => rawToMessage(m, convId, ownUserId));

        // Merge in-memory: combine state + DB + freshly fetched.
        const stateMs = state.messages.get(convId) || [];
        const dbMs = await loadDbMessagesForConv(convId);
        const merged = mergeMessages(mergeMessages(stateMs, dbMs), converted);
        state.messages.set(convId, merged);
        messagesForConv = merged;

        // Persist every freshly fetched row — duplicates are no-ops thanks to ON CONFLICT.
        for (const m of converted) db.insertMessage(m).catch(() => {});

        if (raw.length > 0) {
          console.log(
            `[live] account=${accountId} backfilled conv=${convId} fetched=${raw.length} total=${merged.length}`,
          );
        }
      }

      const lastMsg = messagesForConv && messagesForConv.length
        ? messagesForConv[messagesForConv.length - 1]
        : null;

      if (existing) {
        existing.lastMessagePreview = lastMsg?.body?.slice(0, 80) || existing.lastMessagePreview;
        existing.lastMessageAt = lastMsg?.sentAt || existing.lastMessageAt;
        existing.peer.displayName = peerName;
        existing.peer.avatarUrl = peerAvatar;
      } else {
        const newConv = {
          id: convId,
          accountId,
          leadId: `live_lead_${peerId}`,
          peer: { discordUserId: peerId, displayName: peerName, avatarUrl: peerAvatar },
          lastMessagePreview: lastMsg?.body?.slice(0, 80) || "(no messages yet)",
          lastMessageAt: lastMsg?.sentAt || new Date().toISOString(),
          unreadCount: 0,
          label: "inbox" as const,
          interested: false,
        };
        state.conversations.push(newConv);
        db.upsertConversation(newConv).catch(() => {});
        for (const m of messagesForConv || []) db.insertMessage(m).catch(() => {});
        console.log(`[live] account=${accountId} imported DM conv=${convId} peer=${peerName}`);
      }
    }
  }

  // ───── Detect closed DMs (Discord-side deletion) ─────────────────────────
  // Compare the set of channel IDs Discord just returned to the conversations
  // we have for this account. Any conversation NOT in Discord's response means
  // the channel was closed. To survive Discord's occasional partial / blip
  // responses we require a channel to be missing on TWO consecutive polls
  // before deletion. We also skip the whole diff entirely when Discord's
  // response was empty/null — that's almost always a transient failure rather
  // than "the user deleted every DM at once".
  if (Array.isArray(channels) && channels.length > 0) {
    const liveDmChannelIds = new Set<string>();
    for (const ch of channels) {
      if (ch?.type === 1 || ch?.type === 3) liveDmChannelIds.add(String(ch.id));
    }
    const prevMissing = missingChannelsByAccount.get(accountId) || new Set<string>();
    const stillMissing = new Set<string>();
    // v0.41: skip-delete for young conversations. Wave-prepare freshly opens
    // DM channels via POST /users/@me/channels, but Discord's LIST endpoint is
    // eventually-consistent — the new channel typically takes 30–120s to
    // appear in /users/@me/channels responses. The previous "2 missing polls"
    // rule (= ~60s) was deleting freshly-warmed empty DMs before Discord's
    // cache caught up. Grace window: any conv younger than 10 minutes is
    // never auto-deleted by the diff, regardless of how many polls miss it.
    const GRACE_MS = 10 * 60 * 1000;
    const now = Date.now();
    for (const conv of state.conversations) {
      if (conv.accountId !== accountId) continue;
      if (!conv.id.startsWith("live_")) continue;
      const channelId = conv.id.slice("live_".length);
      if (liveDmChannelIds.has(channelId)) continue;
      const age = now - Date.parse(conv.lastMessageAt);
      if (Number.isFinite(age) && age < GRACE_MS) {
        // Young conv — Discord's LIST may not surface it yet. Don't delete.
        continue;
      }
      // Missing this poll. Was it also missing on the previous poll?
      if (prevMissing.has(channelId)) {
        const idx = state.conversations.findIndex((c) => c.id === conv.id);
        if (idx >= 0) state.conversations.splice(idx, 1);
        state.messages.delete(conv.id);
        db.deleteConversation(conv.id).catch((err) =>
          console.warn(`[live] account=${accountId} deleteConversation ${conv.id} failed: ${err?.message || err}`),
        );
        publishExternalEvent({
          type: "conversation_removed",
          conversationId: conv.id,
          ts: new Date().toISOString(),
        });
        console.log(`[live] account=${accountId} REST-diff removed closed DM conv=${conv.id} (missing 2 polls in a row, age=${Math.round(age/1000)}s)`);
      } else {
        stillMissing.add(channelId);
      }
    }
    missingChannelsByAccount.set(accountId, stillMissing);
  }

  // Mark that we've completed the one-time post-boot backfill for this account.
  if (!backfillDone.has(accountId)) {
    backfillDone.add(accountId);
    console.log(`[live] account=${accountId} backfill pass complete`);
  }

  // 3) Flip status to connected (after first successful poll only).
  // Guard: only flip from 'connecting' — never overwrite terminal statuses like
  // 'token_revoked' or 'banned' that the gateway already stamped on this account.
  if (acct.status === "connecting") {
    acct.status = "connected";
    acct.lastStatusAt = new Date().toISOString();
    db.updateAccountStats(acct.id, acct.friendsCount, acct.pendingOutgoing, "connected").catch(() => {});
    publishExternalEvent({
      type: "account_status",
      accountId,
      status: "connected",
      ts: acct.lastStatusAt,
    });
    console.log(`[live] account=${accountId} status → connected (friends=${acct.friendsCount} pendingFR=${acct.pendingOutgoing})`);
  }

  return true;
}

/** Start (or restart) the poll loop for an account. Safe to call multiple times. */
export function attachLiveAccount(accountId: string): void {
  const existing = pollers.get(accountId);
  if (existing) clearInterval(existing);

  const token = _getCapturedToken(accountId);
  if (!token) {
    console.warn(`[live] no token for account=${accountId}, cannot attach`);
    return;
  }

  // Fire one poll immediately, then on the interval.
  pollOnce(accountId, token).catch((err) => console.warn(`[live] initial poll failed:`, err));

  const timer = setInterval(() => {
    const stillThere = state.accounts.find((a) => a.id === accountId);
    if (!stillThere || stillThere.status === "token_revoked" || stillThere.status === "banned") {
      clearInterval(timer);
      pollers.delete(accountId);
      return;
    }
    pollOnce(accountId, token).catch((err) => console.warn(`[live] poll error:`, err));
  }, POLL_INTERVAL_MS);
  pollers.set(accountId, timer);
}

export function detachLiveAccount(accountId: string): void {
  const t = pollers.get(accountId);
  if (t) {
    clearInterval(t);
    pollers.delete(accountId);
  }
}
