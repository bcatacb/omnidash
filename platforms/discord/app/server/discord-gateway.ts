/**
 * Discord gateway WebSocket client.
 *
 * One connection per bridged account. Speaks the public gateway protocol the
 * Discord web client uses: HELLO → IDENTIFY → READY → DISPATCH events.
 *
 * What we listen for and surface:
 *   MESSAGE_CREATE      → push into the right conversation, emit message_in/out
 *   MESSAGE_UPDATE      → patch the matching message in state
 *   MESSAGE_DELETE      → drop the matching message from state
 *   CHANNEL_CREATE      → import new DM channel as a conversation
 *   RELATIONSHIP_ADD    → bump friendsCount / pendingOutgoing, flip lead state
 *   RELATIONSHIP_REMOVE → opposite
 *   READY               → snapshot our own user.id (needed for in/out direction)
 *
 * Reconnect strategy: exponential backoff up to 60 s, no RESUME for v1 (we
 * just IDENTIFY again, which is fine for stateless DM monitoring).
 *
 * ToS posture: this is exactly the same flow Discord's desktop client uses.
 * Same residential-proxy egress as everything else, so Discord sees a
 * legitimate-looking client per account.
 */

import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { state } from "./discord-mock";
import { publishExternalEvent } from "./realtime";
import * as db from "./db";
import { formatDiscordContent, isSystemMessage } from "./discord-format";
import type { Message } from "./api-types";
import { getSuperPropertiesB64 } from "./discord-http";
import { handleInboundMessage } from "./telegram-notifier";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Per-account agent cache. Each account's gateway WS egresses through its
// FIXED assigned proxy only. No assignment → direct (no shared/rotating pool).
const wsAgentByAccount = new Map<string, { agent: any; proxyUrl: string }>();
async function agentForAccount(accountId: string): Promise<any> {
  try {
    const { getProxyUrlForAccount } = await import("./db");
    const proxyUrl = await getProxyUrlForAccount(accountId);
    if (proxyUrl) {
      const cached = wsAgentByAccount.get(accountId);
      if (cached && cached.proxyUrl === proxyUrl) return cached.agent;
      const agent = new HttpsProxyAgent(proxyUrl);
      wsAgentByAccount.set(accountId, { agent, proxyUrl });
      // Extract just host:port for the log — don't log credentials
      let proxyHost = proxyUrl;
      try { proxyHost = new URL(proxyUrl).host; } catch {}
      console.log(`[gw] account=${accountId} gateway → proxy ${proxyHost}`);
      return agent;
    }
    console.warn(`[gw] account=${accountId} NO proxy assigned — gateway connecting DIRECT from VPS IP`);
  } catch (err) {
    console.warn(`[gw] account=${accountId} proxy lookup failed: ${(err as any)?.message || err}`);
  }
  return undefined; // no proxy assigned → direct, NOT the shared rotating pool
}
export function invalidateGatewayAgent(accountId?: string): void {
  if (accountId) wsAgentByAccount.delete(accountId);
  else wsAgentByAccount.clear();
}

// Super-properties are fetched dynamically from discord-http so the
// client_build_number stays current. Stale build numbers get flagged.

interface GatewayConn {
  accountId: string;
  token: string;
  ws: WebSocket | null;
  hbTimer: NodeJS.Timeout | null;
  lastSeq: number | null;
  ownUserId: string | null;
  reconnectAttempts: number;
  closed: boolean;
  guilds: Array<{ id: string; name: string }>;
  // Session resume — avoids a fresh IDENTIFY (new login) on every reconnect.
  // Discord sees RESUME as a continuation, not a new login.
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  // Consecutive INVALID_SESSION responses without an intervening READY. A
  // re-IDENTIFY storm (login spam) is a token-revocation trigger, so we cap it.
  invalidSessionCount: number;
}

const conns = new Map<string, GatewayConn>();

// ───── Incoming friend-request auto-accept throttling ─────────────────────────
// Accepting every incoming FR instantly, from anyone, in an unbounded burst is a
// textbook bot signature (and an easy way for an anti-spam honeypot to flag the
// account). Cap to 5 accepts / 60s per account, jitter each accept, and dedupe
// repeat requests from the same sender within the window.
const FR_ACCEPT_WINDOW_MS = 60_000;
const FR_ACCEPT_MAX_PER_WINDOW = 5;
const frAcceptTimes = new Map<string, number[]>();      // accountId → recent accept timestamps
const frAcceptedRecently = new Map<string, number>();   // `${accountId}:${senderId}` → ts

function canAcceptFr(accountId: string, senderId: string): boolean {
  const now = Date.now();
  // Dedupe: same sender within the window.
  const dedupeKey = `${accountId}:${senderId}`;
  const last = frAcceptedRecently.get(dedupeKey);
  if (last && now - last < FR_ACCEPT_WINDOW_MS) return false;
  // Sliding window per account.
  const times = (frAcceptTimes.get(accountId) || []).filter((t) => now - t < FR_ACCEPT_WINDOW_MS);
  if (times.length >= FR_ACCEPT_MAX_PER_WINDOW) {
    frAcceptTimes.set(accountId, times);
    return false;
  }
  times.push(now);
  frAcceptTimes.set(accountId, times);
  frAcceptedRecently.set(dedupeKey, now);
  return true;
}

function discordAvatar(userId: string, hash: string | null | undefined): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128` : null;
}

function send(conn: GatewayConn, payload: any) {
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(payload));
  }
}

async function identify(conn: GatewayConn) {
  const superPropsB64 = await getSuperPropertiesB64();
  const properties = JSON.parse(Buffer.from(superPropsB64, "base64").toString("utf-8"));
  send(conn, {
    op: 2,
    d: {
      token: conn.token,
      capabilities: 30717,
      properties,
      presence: { status: "online", since: 0, activities: [], afk: false },
      compress: false,
      client_state: {
        guild_versions: {},
        highest_last_message_id: "0",
        read_state_version: 0,
        user_guild_settings_version: -1,
        user_settings_version: -1,
        private_channels_version: "0",
      },
    },
  });
}

function startHeartbeat(conn: GatewayConn, intervalMs: number) {
  if (conn.hbTimer) clearInterval(conn.hbTimer);
  // First heartbeat is jittered per Discord spec.
  const firstDelay = Math.floor(Math.random() * intervalMs);
  setTimeout(() => {
    send(conn, { op: 1, d: conn.lastSeq });
    conn.hbTimer = setInterval(() => send(conn, { op: 1, d: conn.lastSeq }), intervalMs);
  }, firstDelay);
}

function handleDispatch(conn: GatewayConn, type: string, d: any) {
  const acct = state.accounts.find((a) => a.id === conn.accountId);
  if (!acct) return;

  switch (type) {
    case "READY": {
      conn.ownUserId = String(d?.user?.id || "");
      conn.reconnectAttempts = 0;
      conn.invalidSessionCount = 0; // a successful login clears the storm counter
      // Save resume info so reconnects use RESUME (session continuation) instead
      // of a fresh IDENTIFY (new login), which is a token-revocation risk.
      conn.sessionId = String(d?.session_id || "");
      conn.resumeGatewayUrl = String(d?.resume_gateway_url || "");
      // Cache the email from READY so it persists even after token revocation.
      const readyEmail: string | undefined = d?.user?.email;
      if (readyEmail) {
        import("./db").then(({ setCachedEmail }) => {
          setCachedEmail(conn.accountId, readyEmail).catch(() => {});
        }).catch(() => {});
      }
      // v0.73.7 — extract guild summaries. Discord's READY for user tokens
      // can deliver guilds in `d.guilds[]` (each with id + properties.name)
      // OR as just IDs under `d.user_guild_settings.entries[]`. Try both.
      const rawGuilds = Array.isArray(d?.guilds) ? d.guilds : [];
      let extracted = rawGuilds
        .map((g: any) => ({
          id: String(g?.id || ""),
          name: String(g?.properties?.name || g?.name || g?.id || ""),
        }))
        .filter((g: any) => g.id);
      // Fallback to user_guild_settings if d.guilds was empty/missing.
      if (extracted.length === 0 && Array.isArray(d?.user_guild_settings?.entries)) {
        extracted = d.user_guild_settings.entries
          .map((e: any) => ({ id: String(e?.guild_id || ""), name: String(e?.guild_id || "") }))
          .filter((g: any) => g.id);
      }
      conn.guilds = extracted;
      const dKeys = d && typeof d === "object" ? Object.keys(d).slice(0, 12).join(",") : "?";
      const requiredAction = d?.required_action ? String(d.required_action) : null;
      console.log(`[gw] account=${conn.accountId} READY ownUserId=${conn.ownUserId} dms=${(d?.private_channels || []).length} guilds=${conn.guilds.length} d.keys=${dKeys}${requiredAction ? ` required_action=${requiredAction}` : ""}`);
      void (async () => {
        try {
          if (requiredAction) {
            // Account is locked by Discord (email/phone/ToS verification required).
            // Captcha solves will always fail — mark dead so the engine skips it.
            const { markAccountRequiredAction } = await import("./warmup-campaign-engine");
            await markAccountRequiredAction(conn.accountId);
            console.warn(`[gw] account=${conn.accountId} required_action=${requiredAction} — marked dead in all warmup campaigns`);
          } else {
            const { clearDeadFlagForAccount } = await import("./warmup-campaign-engine");
            await clearDeadFlagForAccount(conn.accountId);
          }
        } catch (err) {
          console.warn(`[gw] READY dead-flag update failed acct=${conn.accountId}: ${(err as any)?.message}`);
        }
        // Clear any 4004-based campaign suspensions — account has a fresh token now.
        try {
          const { listCampaigns, listSuspensions, clearSuspension } = await import("./db");
          const campaigns = await listCampaigns();
          for (const camp of campaigns.filter((c: any) => c.status !== "finished")) {
            const suspensions = await listSuspensions(camp.id);
            const mine = suspensions.find((s: any) => s.accountId === conn.accountId && s.reason.includes("4004"));
            if (mine) {
              await clearSuspension(camp.id, conn.accountId);
              console.log(`[gw] cleared 4004 suspension account=${conn.accountId} campaign=${camp.id}`);
            }
          }
        } catch (err) {
          console.warn(`[gw] clearSuspension failed acct=${conn.accountId}: ${(err as any)?.message}`);
        }
      })();
      break;
    }

    case "RESUMED":
      conn.reconnectAttempts = 0;
      console.log(`[gw] account=${conn.accountId} session RESUMED — no new login event`);
      break;

    // v0.73.7 — Discord delivers some guilds in lazy GUILD_CREATE events
    // after READY. Catch those too so the cache fills out.
    case "GUILD_CREATE": {
      if (d?.id) {
        const id = String(d.id);
        const name = String(d?.properties?.name || d?.name || id);
        if (!conn.guilds.some((g) => g.id === id)) {
          conn.guilds.push({ id, name });
        }
      }
      break;
    }

    case "MESSAGE_CREATE": {
      const channelId = String(d?.channel_id || "");
      if (!channelId) return;

      // Only 1:1 DMs for Unibox. Drop server/guild messages (they have guild_id) and avoid group DM noise.
      if (d?.guild_id) return;

      const convId = `live_${channelId}`;
      let conv = state.conversations.find((c) => c.id === convId && c.accountId === conn.accountId);
      if (!conv) {
        // Create on the fly for first messages (external DMs etc) so they appear instantly
        // via gateway instead of waiting for the 5s poll.
        const author = d?.author || {};
        const peerId = String(author.id || channelId);
        const peerName = String(author.global_name || author.username || "Unknown");
        const peerAvatar = author.id ? discordAvatar(author.id, author.avatar) : null;
        conv = {
          id: convId,
          accountId: conn.accountId,
          leadId: `live_lead_${peerId}`,
          peer: { discordUserId: peerId, displayName: peerName, avatarUrl: peerAvatar },
          lastMessagePreview: "",
          lastMessageAt: new Date().toISOString(),
          unreadCount: 0,
          label: "inbox" as const,
          interested: false,
        };
        state.conversations.push(conv);
        db.upsertConversation(conv).catch(() => {});
        publishExternalEvent({
          type: "conversation_created",
          conversationId: convId,
          conversation: conv,
          ts: new Date().toISOString(),
        });
      }
      // Drop non-critical system events (join, pin, boost, etc.).
      if (isSystemMessage(d)) return;
      const msgType = Number(d?.type ?? 0);
      const isOutgoing = String(d?.author?.id || "") === conn.ownUserId;
      const msg: Message = {
        id: `live_msg_${d.id}`,
        conversationId: convId,
        direction: isOutgoing ? "out" : "in",
        body: msgType === 3 ? "📞 Incoming call" : formatDiscordContent(d),
        sentAt: String(d?.timestamp || new Date().toISOString()),
        authorName: String(d?.author?.global_name || d?.author?.username || "unknown"),
        authorAvatarUrl: d?.author?.id ? discordAvatar(d.author.id, d.author.avatar) : null,
      };
      const msgs = state.messages.get(convId) || [];
      // Dedupe in case we get a REST + gateway echo for the same id.
      if (!msgs.some((m) => m.id === msg.id)) {
        msgs.push(msg);
        state.messages.set(convId, msgs);
        conv.lastMessagePreview = msg.body.slice(0, 80);
        conv.lastMessageAt = msg.sentAt;
        if (!isOutgoing) conv.unreadCount = (conv.unreadCount || 0) + 1;
        db.insertMessage(msg).catch((err) => console.warn(`[gw] insertMessage failed conv=${convId}: ${err?.message || err}`));
        db.upsertConversation(conv).catch((err) => console.warn(`[gw] upsertConversation failed conv=${convId}: ${err?.message || err}`));
        publishExternalEvent({
          type: isOutgoing ? "message_out" : "message_in",
          conversationId: convId,
          message: msg,
          ts: msg.sentAt,
        });

        if (!isOutgoing) {
          // Campaign lead reply tracking + Telegram notification (if enabled).
          // Only for real external 1:1 DMs. Skip entirely for our own accounts talking to each other (warmups etc).
          const acct = state.accounts.find((a) => a.id === conn.accountId);
          const peerId = String(d?.author?.id || (conv as any)?.peer?.discordUserId || "");
          const ownIds = getKnownOwnUserIds();
          if (!ownIds.includes(peerId)) {
            handleInboundMessage({
              accountId: conn.accountId,
              accountUsername: acct?.username,
              peerDiscordUserId: peerId,
              peerDisplayName: msg.authorName || String((conv as any)?.peer?.displayName || "unknown"),
              body: msg.body,
              conversationId: convId,
              sentAt: msg.sentAt,
            }).catch((err) => console.warn(`[gw] handleInboundMessage failed: ${err?.message || err}`));
          }
        }
      }
      break;
    }

    case "MESSAGE_UPDATE": {
      const channelId = String(d?.channel_id || "");
      const convId = `live_${channelId}`;
      const msgs = state.messages.get(convId);
      if (!msgs) return;
      const idx = msgs.findIndex((m) => m.id === `live_msg_${d.id}`);
      if (idx >= 0 && d?.content !== undefined) {
        msgs[idx].body = formatDiscordContent(d);
      }
      break;
    }

    case "MESSAGE_DELETE": {
      // Sync deletions performed on the real Discord client (phone/app) so they disappear from Unibox.
      // Only for our 1:1 DMs.
      const channelId = String(d?.channel_id || "");
      if (!channelId) return;
      if (d?.guild_id) return;
      const convId = `live_${channelId}`;
      const msgs = state.messages.get(convId);
      if (!msgs) return;
      const msgId = `live_msg_${d.id}`;
      const idx = msgs.findIndex((m) => m.id === msgId);
      if (idx === -1) return;
      msgs.splice(idx, 1);
      db.deleteMessage(convId, msgId).catch((err) => console.warn(`[gw] deleteMessage failed: ${err?.message || err}`));
      publishExternalEvent({
        type: "message_deleted",
        conversationId: convId,
        messageId: msgId,
        ts: new Date().toISOString(),
      } as any);
      // If this was the last message, the next poll or reload will clear the preview via updateConversationLastMessage if needed.
      break;
    }

    case "CHANNEL_CREATE": {
      // v0.67 — extension creates DMs from the operator's IP; Discord then
      // fans CHANNEL_CREATE out to every connected session for that account,
      // including this gateway WS. We import the new DM as a live
      // conversation so the Unibox's pending_ placeholder gets replaced by
      // a real live_ row without waiting on the next REST poll cycle.
      // Only real 1:1 DMs (type 1). Exclude group DMs (type 3) and everything else per user request.
      const channelType = Number(d?.type);
      if (channelType !== 1) break;
      const channelId = String(d?.id || "");
      if (!channelId) break;
      const convId = `live_${channelId}`;
      if (state.conversations.some((c) => c.id === convId)) break;
      const recipient = Array.isArray(d?.recipients) && d.recipients[0] ? d.recipients[0] : null;
      const peerName = (recipient?.global_name || recipient?.username || "Unknown");
      const peerId = recipient?.id || channelId;
      const peerAvatar = recipient ? discordAvatar(recipient.id, recipient.avatar) : null;
      const newConv = {
        id: convId,
        accountId: conn.accountId,
        leadId: `live_lead_${peerId}`,
        peer: { discordUserId: peerId, displayName: peerName, avatarUrl: peerAvatar },
        lastMessagePreview: "(no messages yet)",
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
        label: "inbox" as const,
        interested: false,
      };
      state.conversations.push(newConv);
      db.upsertConversation(newConv).catch((err) =>
        console.warn(`[gw] account=${conn.accountId} CHANNEL_CREATE upsert failed conv=${convId}: ${err?.message || err}`),
      );
      publishExternalEvent({
        type: "conversation_created",
        conversationId: convId,
        conversation: newConv,
        ts: newConv.lastMessageAt,
      });
      console.log(`[gw] account=${conn.accountId} CHANNEL_CREATE imported conv=${convId} peer=${peerName}`);
      break;
    }

    case "CHANNEL_DELETE": {
      // Fires when the user closes a DM in their real Discord client (or when
      // a guild channel they could see gets deleted). We only track 1:1 DMs.
      const channelType = Number(d?.type);
      if (channelType !== 1) break;
      const channelId = String(d?.id || "");
      if (!channelId) break;
      const convId = `live_${channelId}`;
      const idx = state.conversations.findIndex(
        (c) => c.id === convId && c.accountId === conn.accountId,
      );
      if (idx === -1) break;
      state.conversations.splice(idx, 1);
      state.messages.delete(convId);
      db.deleteConversation(convId).catch((err) =>
        console.warn(`[gw] account=${conn.accountId} deleteConversation failed: ${err?.message || err}`),
      );
      publishExternalEvent({
        type: "conversation_removed",
        conversationId: convId,
        ts: new Date().toISOString(),
      });
      console.log(`[gw] account=${conn.accountId} CHANNEL_DELETE removed conv=${convId}`);
      break;
    }

    case "RELATIONSHIP_ADD": {
      // type: 1 = friend, 2 = blocked, 3 = incoming FR, 4 = outgoing FR
      const t = Number(d?.type);
      if (t === 1) {
        acct.friendsCount += 1;
        if (acct.pendingOutgoing > 0) acct.pendingOutgoing -= 1;
        // Notify FR campaign engine so accepted leads update their status.
        const friendUserId = String(d?.id ?? "");
        if (friendUserId) {
          import("./fr-campaign-engine").then(({ handleFrAccepted }) => {
            handleFrAccepted(conn.accountId, friendUserId).catch(() => {});
          }).catch(() => {});
        }
      }
      if (t === 3) {
        // Incoming FR — auto-accept from anyone, but throttled + jittered +
        // deduped so a flood of incoming FRs doesn't produce a bot-shaped burst.
        const senderDiscordUserId = String(d?.id ?? d?.user?.id ?? "");
        if (senderDiscordUserId && canAcceptFr(conn.accountId, senderDiscordUserId)) {
          void (async () => {
            try {
              // Human-like delay before acting (2–8s).
              await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 6_000));
              const { tlsFetch, discordHeaders } = await import("./discord-http");
              const r = await tlsFetch(
                `https://discord.com/api/v9/users/@me/relationships/${senderDiscordUserId}`,
                {
                  method: "PUT",
                  headers: { ...await discordHeaders(conn.token, true, undefined, conn.accountId), "x-context-properties": "eyJsb2NhdGlvbiI6IkFkZCBGcmllbmQifQ==" },
                  body: JSON.stringify({ type: 1 }),
                  timeoutMs: 10_000,
                  accountId: conn.accountId,
                },
              );
              console.log(`[gw] account=${conn.accountId} auto-accepted FR from discord=${senderDiscordUserId} status=${r.status}`);
            } catch (err: any) {
              console.warn(`[gw] account=${conn.accountId} auto-accept FR failed: ${err?.message || err}`);
            }
          })();
        } else if (senderDiscordUserId) {
          console.log(`[gw] account=${conn.accountId} incoming FR from discord=${senderDiscordUserId} throttled/deduped — not auto-accepting this tick`);
        }
      }
      if (t === 4) acct.pendingOutgoing += 1;
      acct.lastStatusAt = new Date().toISOString();
      db.updateAccountStats(acct.id, acct.friendsCount, acct.pendingOutgoing, acct.status).catch(() => {});
      publishExternalEvent({
        type: "account_status",
        accountId: acct.id,
        status: acct.status,
        ts: acct.lastStatusAt,
      });
      console.log(`[gw] account=${conn.accountId} RELATIONSHIP_ADD type=${t} friends=${acct.friendsCount} pendingOut=${acct.pendingOutgoing}`);
      break;
    }

    case "RELATIONSHIP_REMOVE": {
      const t = Number(d?.type);
      if (t === 1 && acct.friendsCount > 0) acct.friendsCount -= 1;
      if (t === 4 && acct.pendingOutgoing > 0) acct.pendingOutgoing -= 1;
      break;
    }

    case "GUILD_MEMBERS_CHUNK": {
      // Route the chunk to whichever scrape session asked for it via OP 8.
      const nonce = String(d?.nonce || "");
      const perAccount = membersChunkListeners.get(conn.accountId);
      const fn = perAccount?.get(nonce);
      if (fn) fn(d);
      // If no listener, the chunk was probably triggered by Discord's own client
      // behavior (rare for our usage). Drop silently.
      break;
    }

    case "GUILD_MEMBER_LIST_UPDATE": {
      // Response to OP 14 (LAZY_GUILD_REQUEST). Used by the scraper for large guilds
      // where OP 8 returns nothing. Routed to all OP 14 listeners for this guild_id
      // — caller dedupes by member id.
      const guildId = String(d?.guild_id || "");
      const opCount = Array.isArray(d?.ops) ? d.ops.length : 0;
      const memberCount = typeof d?.member_count === "number" ? d.member_count : "?";
      console.log(`[gw] account=${conn.accountId} GUILD_MEMBER_LIST_UPDATE guild=${guildId} ops=${opCount} member_count=${memberCount}`);
      const perAccount = lazyGuildListeners.get(conn.accountId);
      const set = perAccount?.get(guildId);
      if (set) for (const fn of set) fn(d);
      else console.warn(`[gw] account=${conn.accountId} GUILD_MEMBER_LIST_UPDATE for guild=${guildId} but no listener registered`);
      break;
    }

    default:
      // Lots of events we don't care about for v1 (PRESENCE_UPDATE, TYPING_START, etc).
      break;
  }
}

async function open(conn: GatewayConn) {
  if (conn.closed) return;
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;

  const agent = await agentForAccount(conn.accountId);
  // Prefer resume_gateway_url (from last READY) so RESUME lands on the right shard.
  const canResume = !!(conn.sessionId && conn.resumeGatewayUrl && conn.lastSeq !== null);
  const gatewayUrl = canResume
    ? `${conn.resumeGatewayUrl}?v=10&encoding=json`
    : GATEWAY_URL;
  console.log(`[gw] account=${conn.accountId} connecting (attempt ${conn.reconnectAttempts + 1}, ${canResume ? "RESUME" : "fresh IDENTIFY"})`);
  const ws = new WebSocket(gatewayUrl, {
    origin: "https://discord.com",
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    agent,
  });
  conn.ws = ws;

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (typeof msg.s === "number") conn.lastSeq = msg.s;

    switch (msg.op) {
      case 10: // HELLO
        startHeartbeat(conn, Number(msg.d?.heartbeat_interval) || 41250);
        if (conn.sessionId && conn.resumeGatewayUrl && conn.lastSeq !== null) {
          // Resume the existing session — Discord won't fire a new login event.
          send(conn, { op: 6, d: { token: conn.token, session_id: conn.sessionId, seq: conn.lastSeq } });
        } else {
          void identify(conn);
        }
        break;
      case 11: // HEARTBEAT_ACK
        break;
      case 7: // RECONNECT — server-asked graceful reconnect
        try { ws.close(4000, "server requested reconnect"); } catch {}
        break;
      case 9: { // INVALID_SESSION — resume failed or session expired
        const resumable = msg.d === true;
        conn.sessionId = null;
        conn.resumeGatewayUrl = null;
        conn.lastSeq = null;
        conn.invalidSessionCount += 1;
        // Cap re-IDENTIFY storms: repeated INVALID_SESSION usually means the
        // token is soft-locked. Re-identifying every few seconds is login spam
        // and a token-revocation trigger. After 3 in a row, stop and quarantine.
        const MAX_REIDENTIFY = 3;
        if (conn.invalidSessionCount > MAX_REIDENTIFY) {
          console.warn(`[gw] account=${conn.accountId} INVALID_SESSION x${conn.invalidSessionCount} — giving up, quarantining (invalid_session_loop)`);
          conn.closed = true;
          try { conn.ws?.close(1000, "invalid_session_loop"); } catch {}
          db.logActivity(conn.accountId, "quarantined", { reason: "invalid_session_loop", count: conn.invalidSessionCount });
          db.quarantineAccount(conn.accountId).catch((err: any) => console.warn(`[gw] quarantine failed account=${conn.accountId}: ${err?.message || err}`));
          break;
        }
        console.warn(`[gw] account=${conn.accountId} INVALID_SESSION resumable=${resumable} (attempt ${conn.invalidSessionCount}/${MAX_REIDENTIFY}) — clearing session, re-identifying`);
        setTimeout(() => { void identify(conn); }, 2_000 + Math.random() * 3_000);
        break;
      }
      case 0: // DISPATCH
        handleDispatch(conn, String(msg.t || ""), msg.d);
        break;
      default:
        break;
    }
  });

  ws.on("error", (err) => {
    console.warn(`[gw] account=${conn.accountId} ws error: ${err?.message || err}`);
  });

  ws.on("close", (code) => {
    if (conn.hbTimer) clearInterval(conn.hbTimer);
    conn.hbTimer = null;
    if (conn.closed) return;

    // v0.33: 4004 = "Authentication failed" — Discord rejected the token. No
    // amount of reconnecting will fix it; the operator must re-onboard. Mark
    // the account suspended in every campaign it's part of so the scheduler
    // doesn't keep handing it leads. Rebalance moves those leads to other
    // eligible accounts (or orphans them with assigned_account_id=NULL if
    // none remain).
    if (code === 4004) {
      const acctLabel = state.accounts.find((a) => a.id === conn.accountId)?.username || conn.accountId;
      console.warn(`[gw] account=${conn.accountId} (${acctLabel}) closed code=4004 — token revoked.`);
      conn.closed = true;
      db.logActivity(conn.accountId, "gateway_4004", { closeCode: 4004 });
      // v0.36: flip the account's status to "token_revoked" so the Accounts
      // page can clearly flag it for re-onboarding. The status survives across
      // restarts via the DB write below.
      const acct = state.accounts.find((a) => a.id === conn.accountId);
      if (acct && acct.status !== "token_revoked") {
        acct.status = "token_revoked";
        acct.lastStatusAt = new Date().toISOString();
        db.updateAccountStats(acct.id, acct.friendsCount, acct.pendingOutgoing, "token_revoked").catch(() => {});
        publishExternalEvent({
          type: "account_status",
          accountId: conn.accountId,
          status: "token_revoked",
          ts: acct.lastStatusAt,
        });
        // Attempt silent reauth using stored credentials (if any).
      }
      void (async () => {
        try {
          const campaigns = await db.listCampaigns();
          const affected = campaigns.filter(
            (c) => c.accountIds.includes(conn.accountId) && c.status !== "finished",
          );
          for (const camp of affected) {
            await db.addSuspension(camp.id, conn.accountId, `gateway close 4004 (token revoked)`);
            const r = await db.rebalanceFromSuspendedAccount(camp.id, conn.accountId);
            console.warn(`[gw] auto-suspended account=${conn.accountId} in campaign=${camp.id} reassigned=${r.reassigned} orphaned=${r.orphaned}`);
            publishExternalEvent({
              type: "campaign_paused",
              campaignId: camp.id,
              ts: new Date().toISOString(),
              reason: `@${acctLabel}'s token was revoked by Discord — paste a fresh token to bring this account back online.`,
            } as any);
          }
        } catch (err: any) {
          console.warn(`[gw] auto-suspend on 4004 failed: ${err?.message || err}`);
        }
        // Mark dead in all warmup campaigns immediately — prevents the warmup
        // engine from firing TLS sends that will return 401 before the engine's
        // own tick detects the revocation.
        try {
          const { markAccountRevoked } = await import("./warmup-campaign-engine");
          await markAccountRevoked(conn.accountId);
        } catch (err: any) {
          console.warn(`[gw] warmup dead-flag on 4004 failed acct=${conn.accountId}: ${err?.message || err}`);
        }
      })();
      return;
    }

    conn.reconnectAttempts += 1;
    const backoff = Math.min(60_000, 1_000 * 2 ** Math.min(conn.reconnectAttempts, 6));
    console.warn(`[gw] account=${conn.accountId} closed code=${code}, reconnect in ${backoff}ms`);
    setTimeout(() => { void open(conn); }, backoff);
  });
}

export function attachGateway(accountId: string, token: string): void {
  const existing = conns.get(accountId);
  if (existing) {
    existing.closed = true;
    try { existing.ws?.close(); } catch {}
  }
  const conn: GatewayConn = {
    accountId,
    token,
    ws: null,
    hbTimer: null,
    lastSeq: null,
    ownUserId: null,
    reconnectAttempts: 0,
    closed: false,
    guilds: [],
    sessionId: null,
    resumeGatewayUrl: null,
    invalidSessionCount: 0,
  };
  conns.set(accountId, conn);
  void open(conn);
}

export function detachGateway(accountId: string): void {
  const conn = conns.get(accountId);
  if (!conn) return;
  conn.closed = true;
  if (conn.hbTimer) clearInterval(conn.hbTimer);
  try { conn.ws?.close(); } catch {}
  conns.delete(accountId);
}

// ───── REQUEST_GUILD_MEMBERS (OP 8) — for the scraper ────────────────────────
type MembersChunkListener = (payload: any) => void;
const membersChunkListeners = new Map<string, Map<string, MembersChunkListener>>(); // accountId → nonce → fn

/** Send OP 8 over the existing gateway connection for an account. Returns false if no connection. */
export function sendRequestGuildMembers(accountId: string, guildId: string, nonce: string): boolean {
  const conn = conns.get(accountId);
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    const reason = !conn ? "not-in-conns-map" : !conn.ws ? "no-ws" : `ws-readyState=${conn.ws.readyState}`;
    const connectedIds = Array.from(conns.keys()).join(", ");
    console.warn(`[gw] sendRequestGuildMembers FAIL account=${accountId} guild=${guildId} reason=${reason}`);
    console.warn(`[gw] connected accounts in conns map: [${connectedIds}]`);
    return false;
  }
  // Empty query + limit 0 asks for ALL members. Presences:true mirrors what
  // Discord's web client does (so we look legitimate); members come back
  // as GUILD_MEMBERS_CHUNK events.
  conn.ws.send(JSON.stringify({
    op: 8,
    d: {
      guild_id: guildId,
      query: "",
      limit: 0,
      presences: true,
      nonce,
    },
  }));
  return true;
}

/** Register a per-account/per-nonce listener for GUILD_MEMBERS_CHUNK. Returns an unsubscribe fn. */
export function registerMembersChunkHandler(accountId: string, nonce: string, fn: MembersChunkListener): () => void {
  let perAccount = membersChunkListeners.get(accountId);
  if (!perAccount) {
    perAccount = new Map();
    membersChunkListeners.set(accountId, perAccount);
  }
  perAccount.set(nonce, fn);
  return () => {
    const m = membersChunkListeners.get(accountId);
    if (m) {
      m.delete(nonce);
      if (m.size === 0) membersChunkListeners.delete(accountId);
    }
  };
}

// ───── OP 14 LAZY_GUILD_REQUEST (large-guild member list) ────────────────────
// Discord's web client uses this for guilds where OP 8 doesn't return the full
// list. We subscribe to a channel's member list and ask for ranges of 100 at a
// time, walking through them to cover the entire roster.
type LazyGuildListener = (payload: any) => void;
const lazyGuildListeners = new Map<string, Map<string, Set<LazyGuildListener>>>();
// accountId → guildId → Set<listener>

/** Send OP 14 over the existing gateway for `accountId`. Returns false if no connection. */
export function sendLazyGuildRequest(
  accountId: string,
  guildId: string,
  channelId: string,
  ranges: Array<[number, number]>,
): boolean {
  const conn = conns.get(accountId);
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
  // Note: typing/activities=true mirrors what Discord's own web client sends.
  // Some guilds with strict community settings reject the request entirely with
  // both flags off (silent — no error, just no response).
  conn.ws.send(JSON.stringify({
    op: 14,
    d: {
      guild_id: guildId,
      typing: true,
      activities: true,
      threads: false,
      members: [],
      channels: { [channelId]: ranges },
      thread_member_lists: [],
    },
  }));
  console.log(`[gw] account=${accountId} sent OP 14 guild=${guildId} channel=${channelId} ranges=${JSON.stringify(ranges)}`);
  return true;
}

/** Register a per-account/per-guild listener for GUILD_MEMBER_LIST_UPDATE. Returns unsubscribe. */
export function registerLazyGuildHandler(accountId: string, guildId: string, fn: LazyGuildListener): () => void {
  let perAccount = lazyGuildListeners.get(accountId);
  if (!perAccount) {
    perAccount = new Map();
    lazyGuildListeners.set(accountId, perAccount);
  }
  let set = perAccount.get(guildId);
  if (!set) {
    set = new Set();
    perAccount.set(guildId, set);
  }
  set.add(fn);
  return () => {
    const pa = lazyGuildListeners.get(accountId);
    const s = pa?.get(guildId);
    if (s) {
      s.delete(fn);
      if (s.size === 0) pa!.delete(guildId);
      if (pa && pa.size === 0) lazyGuildListeners.delete(accountId);
    }
  };
}

export function gatewayStatus(): Array<{ accountId: string; ownUserId: string | null; reconnectAttempts: number; closed: boolean }> {
  return Array.from(conns.values()).map((c) => ({
    accountId: c.accountId,
    ownUserId: c.ownUserId,
    reconnectAttempts: c.reconnectAttempts,
    closed: c.closed,
  }));
}

/** Returns Discord user IDs for all currently attached bridged accounts.
 *  Used by notifier to suppress TG spam from warmup/internal account-to-account DMs.
 */
export function getKnownOwnUserIds(): string[] {
  const ids: string[] = [];
  for (const c of conns.values()) {
    if (c.ownUserId) ids.push(c.ownUserId);
  }
  return ids;
}

// v0.73.6 — guild summaries from the gateway's last READY for this account.
// Lets the Test Lab list guilds without hitting Discord REST.
export function getAccountGuilds(accountId: string): Array<{ id: string; name: string }> {
  const conn = conns.get(accountId);
  return conn?.guilds || [];
}

/** True only when the WebSocket is actually in OPEN state (readyState === 1). */
export function isGatewayOpen(accountId: string): boolean {
  const conn = conns.get(accountId);
  return !!(conn && conn.ws && conn.ws.readyState === WebSocket.OPEN);
}

