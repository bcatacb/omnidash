/**
 * Postgres data layer for the Discord Unibox SaaS.
 *
 * Single-tenant for v0.7 â€” all writes go to schema `tenant_main`. The schema
 * was created by db/migrations/0001..0004 at deploy time, see deploy/README.md.
 *
 * Tokens captured from Discord (QR or paste) are encrypted column-side with
 * AES-256-GCM. Key comes from TOKEN_ENCRYPTION_KEY (must be stable across
 * restarts or every stored token becomes unreadable).
 */

import { Pool } from "pg";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { DiscordAccount, Conversation, Message, Lead } from "./api-types";

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  `postgres://discord_unibox:${process.env.DISCORD_UNIBOX_PG_PASSWORD || ""}@discord-unibox-pg:5432/discord_unibox`;

export const pool = new Pool({
  connectionString: CONNECTION_STRING,
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on("error", (err) => console.warn("[db] pool error:", err.message));

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

// Run a set of statements on a single pooled client inside BEGIN/COMMIT, so a
// multi-table mutation either fully applies or fully rolls back. Use for any
// function that writes to more than one table (or many rows) and must not leave
// partial state if the process dies mid-way.
export async function withTransaction<T>(
  fn: (q: <R = any>(sql: string, params?: any[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = async <R = any>(sql: string, params: any[] = []): Promise<R[]> =>
      (await client.query(sql, params)).rows as R[];
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// â”€â”€â”€â”€â”€ Auto-migration runner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reads all *.sql files from MIGRATIONS_DIR (baked into the Docker image at
// /app/migrations/), applies any that haven't been recorded yet, and records
// each one atomically. Runs once on boot before account hydration.
export async function runMigrations(): Promise<void> {
  const dir = process.env.MIGRATIONS_DIR || path.join(__dirname, "..", "migrations");
  if (!existsSync(dir)) {
    console.warn(`[migrations] directory not found at ${dir} â€” skipping auto-migration (set MIGRATIONS_DIR env var)`);
    return;
  }
  // Bootstrap the tracking table in public schema (exists before tenant_main is created).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.applied_migrations (
      migration_name text PRIMARY KEY,
      applied_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = new Set(
    (await pool.query<{ migration_name: string }>(`SELECT migration_name FROM public.applied_migrations`))
      .rows.map((r) => r.migration_name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public.applied_migrations (migration_name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[migrations] applied ${file}`);
      ran++;
    } catch (err: any) {
      await client.query("ROLLBACK");
      // Re-throw â€” a failed migration means the schema is in an unknown state.
      throw new Error(`Migration ${file} failed: ${err?.message || err}`);
    } finally {
      client.release();
    }
  }
  if (ran === 0) console.log(`[migrations] all ${files.length} migration(s) already applied`);
}

// â”€â”€â”€â”€â”€ Token encryption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const RAW_KEY = process.env.TOKEN_ENCRYPTION_KEY || "";
const ENC_KEY: Buffer | null = RAW_KEY
  ? (RAW_KEY.length === 64 ? Buffer.from(RAW_KEY, "hex") : scryptSync(RAW_KEY, "discord-unibox-salt-v1", 32))
  : null;

function encryptToken(plaintext: string): Buffer {
  if (!ENC_KEY) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function decryptToken(blob: Buffer): string {
  if (!ENC_KEY) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// â”€â”€â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  role: string;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    "SELECT id, tenant_id, email, password_hash, role FROM public.users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );
  return rows[0] || null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    "SELECT id, tenant_id, email, password_hash, role FROM public.users WHERE id = $1 LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

export async function createSession(userId: string, tokenHash: string, ttlMs: number, meta: { ua?: string; ip?: string } = {}): Promise<void> {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  await query(
    `INSERT INTO public.user_sessions (token_hash, user_id, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = now(), expires_at = EXCLUDED.expires_at`,
    [tokenHash, userId, meta.ua || null, meta.ip || null, expires],
  );
}

export async function getSessionUser(tokenHash: string): Promise<UserRow | null> {
  const rows = await query<UserRow & { expires_at: string }>(
    `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, s.expires_at
       FROM public.user_sessions s
       JOIN public.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      LIMIT 1`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  // Touch last_seen_at without awaiting.
  query("UPDATE public.user_sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]).catch(() => {});
  return { id: r.id, tenant_id: r.tenant_id, email: r.email, password_hash: r.password_hash, role: r.role };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query("DELETE FROM public.user_sessions WHERE token_hash = $1", [tokenHash]);
}

// â”€â”€â”€â”€â”€ Discord accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function upsertDiscordAccount(acct: DiscordAccount, token: string | null, discordUserId: string | null): Promise<void> {
  const tokenBlob = token ? encryptToken(token) : null;
  await query(
    `INSERT INTO tenant_main.discord_accounts
       (id, label, username, discord_user_id, avatar_url, status, token_encrypted, friends_count, pending_outgoing, last_status_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label,
       username = EXCLUDED.username,
       discord_user_id = COALESCE(EXCLUDED.discord_user_id, tenant_main.discord_accounts.discord_user_id),
       avatar_url = EXCLUDED.avatar_url,
       status = EXCLUDED.status,
       token_encrypted = COALESCE(EXCLUDED.token_encrypted, tenant_main.discord_accounts.token_encrypted),
       friends_count = EXCLUDED.friends_count,
       pending_outgoing = EXCLUDED.pending_outgoing,
       last_status_at = EXCLUDED.last_status_at
     WHERE tenant_main.discord_accounts.last_status_at <= EXCLUDED.last_status_at`,
    [
      acct.id, acct.label, acct.username, discordUserId, acct.avatarUrl,
      acct.status, tokenBlob, acct.friendsCount, acct.pendingOutgoing, acct.lastStatusAt,
    ],
  );
}

export async function updateAccountStats(id: string, friendsCount: number, pendingOutgoing: number, status: string): Promise<void> {
  await query(
    `UPDATE tenant_main.discord_accounts
        SET friends_count = $2, pending_outgoing = $3, status = $4, last_status_at = now()
      WHERE id = $1`,
    [id, friendsCount, pendingOutgoing, status],
  );
}

export async function deleteAccount(id: string): Promise<void> {
  await query("DELETE FROM tenant_main.discord_accounts WHERE id = $1", [id]);
}

export async function updateAccountToken(accountId: string, token: string): Promise<void> {
  const blob = encryptToken(token);
  await query(
    `UPDATE tenant_main.discord_accounts
        SET token_encrypted = $2, status = 'connecting', last_status_at = now()
      WHERE id = $1`,
    [accountId, blob],
  );
}

export async function setAccountCredentials(
  accountId: string,
  password: string,
  totpSecret: string | null,
): Promise<void> {
  const pwBlob = encryptToken(password);
  const totpBlob = totpSecret ? encryptToken(totpSecret) : null;
  await query(
    `UPDATE tenant_main.discord_accounts
        SET password_encrypted = $2, totp_secret_encrypted = $3
      WHERE id = $1`,
    [accountId, pwBlob, totpBlob],
  );
}

export async function getAccountCredentials(
  accountId: string,
): Promise<{ password: string; totpSecret: string | null } | null> {
  const rows = await query<{ password_encrypted: Buffer | null; totp_secret_encrypted: Buffer | null }>(
    `SELECT password_encrypted, totp_secret_encrypted FROM tenant_main.discord_accounts WHERE id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r?.password_encrypted) return null;
  try {
    const password = decryptToken(r.password_encrypted);
    const totpSecret = r.totp_secret_encrypted ? decryptToken(r.totp_secret_encrypted) : null;
    return { password, totpSecret };
  } catch {
    return null;
  }
}

export async function setCachedEmail(accountId: string, email: string): Promise<void> {
  await query(
    `UPDATE tenant_main.discord_accounts SET cached_email = $1 WHERE id = $2`,
    [email, accountId],
  );
}

export async function getCachedEmail(accountId: string): Promise<string | null> {
  const r = await query<{ cached_email: string | null }>(
    `SELECT cached_email FROM tenant_main.discord_accounts WHERE id = $1`,
    [accountId],
  );
  return r[0]?.cached_email ?? null;
}

export interface LoadedAccount {
  account: DiscordAccount;
  token: string | null;
  discordUserId: string | null;
}

export async function loadAllAccounts(opts?: { sendableOnly?: boolean }): Promise<LoadedAccount[]> {
  // sendableOnly: campaign engines call this every tick and decrypt every
  // token. Excluding accounts that can never send (banned / token_revoked /
  // quarantined / retired) at the SQL layer avoids decrypting their tokens and
  // shrinks the per-tick set. The default (no opts) returns ALL accounts —
  // dashboards and the accounts page rely on seeing revoked/banned rows.
  const where = opts?.sendableOnly
    ? "WHERE status NOT IN ('banned','token_revoked') AND warmup_status NOT IN ('quarantined','retired','resting')"
    : "";
  const rows = await query<any>(
    `SELECT id, label, username, discord_user_id, avatar_url, status, token_encrypted, friends_count, pending_outgoing, last_status_at, warmup_status FROM tenant_main.discord_accounts ${where}`,
  );
  return rows.map((r) => {
    let token: string | null = null;
    if (r.token_encrypted) {
      try {
        token = decryptToken(r.token_encrypted);
      } catch {
        // Key mismatch or corruption â€” account loads without token (shows disconnected).
        // User can reconnect by pasting the token again.
        console.warn(`[db] could not decrypt token for account ${r.id} (${r.username}) â€” loading without token`);
      }
    }
    return {
      account: {
        id: r.id,
        label: r.label,
        username: r.username,
        avatarUrl: r.avatar_url,
        status: r.status,
        lastStatusAt: r.last_status_at.toISOString(),
        friendsCount: r.friends_count,
        pendingOutgoing: r.pending_outgoing,
        warmupStatus: r.warmup_status,
      },
      token,
      discordUserId: r.discord_user_id,
    };
  });
}

// â”€â”€â”€â”€â”€ Conversations & messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Account IDs that must never be used for any send — hit a 4004 / critical
// failure and got quarantined, or aged out to retired. The campaign engines
// gate on this so a quarantined account is never sent on even if its
// per-campaign dead_since flag was cleared by a stray READY event.
export async function listBlockedAccountIds(): Promise<Set<string>> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM tenant_main.discord_accounts WHERE warmup_status IN ('quarantined','retired','resting')`,
  );
  return new Set(rows.map((r) => r.id));
}

// Most-recent FR send per campaign — used to seed the in-memory inter-send
// timer on engine startup so a redeploy doesn't reset spacing to 0 and fire a
// burst on the first tick.
export async function getLastFrSentPerCampaign(): Promise<Map<string, number>> {
  const rows = await query<{ campaign_id: string; t: Date | null }>(
    `SELECT campaign_id, MAX(fr_sent_at) AS t
       FROM tenant_main.fr_campaign_leads
      WHERE fr_sent_at IS NOT NULL
      GROUP BY campaign_id`,
  );
  const m = new Map<string, number>();
  for (const r of rows) if (r.t) m.set(r.campaign_id, new Date(r.t).getTime());
  return m;
}

// Most-recent successful warmup send per campaign — seeds the in-memory
// between-account timer on startup (same redeploy-burst guard as FR).
export async function getLastWarmupSendPerCampaign(): Promise<Map<string, number>> {
  const rows = await query<{ campaign_id: string; t: Date | null }>(
    `SELECT campaign_id, MAX(sent_at) AS t
       FROM tenant_main.warmup_campaign_messages
      WHERE ok = true
      GROUP BY campaign_id`,
  );
  const m = new Map<string, number>();
  for (const r of rows) if (r.t) m.set(r.campaign_id, new Date(r.t).getTime());
  return m;
}

// Discord's official system account (Trust & Safety notices, gift receipts,
// etc.). Conversations with this peer should never sit in the operator's inbox.
const DISCORD_SYSTEM_USER_ID = "643945264868098049";

export async function upsertConversation(c: Conversation): Promise<void> {
  // v0.39 bugfix: include `interested` because the column is NOT NULL with no
  // DEFAULT. Omitting it (as we did previously) caused every wave-prepare
  // insert to silently fail (.catch swallowed the constraint error). The
  // conversation lived in in-memory state but never landed in the DB, so
  // the Unibox's REST query couldn't find it.
  //
  // System DMs are born archived so they never pollute the inbox — and stay
  // archived across upserts via EXCLUDED.label below.
  const label = c.peer.discordUserId === DISCORD_SYSTEM_USER_ID ? "archived" : c.label;
  await query(
    `INSERT INTO tenant_main.conversations
       (id, account_id, peer_discord_user_id, peer_display_name, peer_avatar_url, last_message_preview, last_message_at, unread_count, label, interested)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       peer_display_name = EXCLUDED.peer_display_name,
       peer_avatar_url = EXCLUDED.peer_avatar_url,
       last_message_preview = EXCLUDED.last_message_preview,
       last_message_at = EXCLUDED.last_message_at,
       unread_count = EXCLUDED.unread_count,
       label = EXCLUDED.label`,
    [
      c.id, c.accountId, c.peer.discordUserId, c.peer.displayName, c.peer.avatarUrl,
      c.lastMessagePreview, c.lastMessageAt, c.unreadCount, label, !!c.interested,
    ],
  );
}

export async function setConversationInterested(id: string, interested: boolean): Promise<void> {
  await query(
    'UPDATE tenant_main.conversations SET interested = $2 WHERE id = $1',
    [id, interested],
  );
}

export async function insertMessage(m: Message): Promise<void> {
  // Atomic: the message insert and the conversation's last_message_direction
  // sync must both land or neither, else the Unibox "Needs reply" filter (which
  // reads last_message_direction) can disagree with the actual messages.
  await withTransaction(async (q) => {
    await q(
      `INSERT INTO tenant_main.messages
         (id, conversation_id, direction, body, sent_at, author_name, author_avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.conversationId, m.direction, m.body, m.sentAt, m.authorName, m.authorAvatarUrl],
    );
    // Keep conversations.last_message_direction in sync — only update if this
    // message is at least as recent as the current last_message_at (so backfills
    // of older history don't clobber the real "latest direction").
    await q(
      `UPDATE tenant_main.conversations
          SET last_message_direction = $2
        WHERE id = $1
          AND (last_message_at IS NULL OR $3::timestamptz >= last_message_at)`,
      [m.conversationId, m.direction, m.sentAt],
    );
  });
}

/** Returns per-conversation message direction counts. Used to power the
 *  "Replied / Sent only / Needs reply" filter in the Unibox. */
export async function loadConversationMessageCounts(): Promise<Map<string, { inbound: number; outbound: number }>> {
  const rows = await query<any>(
    `SELECT conversation_id,
            count(*) FILTER (WHERE direction = 'in')  AS inbound,
            count(*) FILTER (WHERE direction = 'out') AS outbound
       FROM tenant_main.messages
      GROUP BY conversation_id`,
  );
  const map = new Map<string, { inbound: number; outbound: number }>();
  for (const r of rows) {
    map.set(String(r.conversation_id), {
      inbound: Number(r.inbound) || 0,
      outbound: Number(r.outbound) || 0,
    });
  }
  return map;
}

/**
 * Look up an existing DM channel between an account and a specific Discord user.
 * Returns the bare Discord channel id (no `live_` prefix) â€” that's what the
 * /channels/{id}/messages endpoint expects. Returns null if no such conversation.
 *
 * Used by the campaign engine to *avoid* calling POST /users/@me/channels
 * (which Discord's anti-spam captchas) when we already have a DM thread.
 */
export async function findExistingDmChannel(
  accountId: string,
  peerDiscordUserId: string,
): Promise<string | null> {
  const rows = await query<any>(
    `SELECT id FROM tenant_main.conversations
       WHERE account_id = $1 AND peer_discord_user_id = $2
       LIMIT 1`,
    [accountId, peerDiscordUserId],
  );
  if (rows.length === 0) return null;
  const internalId = String(rows[0].id || "");
  // Our IDs are `live_<channelId>` for accounts hydrated via the gateway/REST poller.
  return internalId.startsWith("live_") ? internalId.slice(5) : internalId;
}

/**
 * "Warm" = a DM channel that has had at least one real message exchanged
 * (either direction). An *empty* channel â€” like the leftover from a
 * server-side wave whose sticker POST got captcha-walled â€” does NOT count,
 * because no message was ever delivered. The Wave Queue uses this to avoid
 * the false-positive Coldâ†’Warm flip from v0.25.
 */
export async function findWarmDmChannel(
  accountId: string,
  peerDiscordUserId: string,
): Promise<string | null> {
  const rows = await query<any>(
    `SELECT c.id,
            (SELECT COUNT(*) FROM tenant_main.messages m WHERE m.conversation_id = c.id) AS msg_count
       FROM tenant_main.conversations c
      WHERE c.account_id = $1 AND c.peer_discord_user_id = $2
      LIMIT 1`,
    [accountId, peerDiscordUserId],
  );
  if (rows.length === 0) return null;
  if (Number(rows[0].msg_count) === 0) return null;
  const internalId = String(rows[0].id || "");
  return internalId.startsWith("live_") ? internalId.slice(5) : internalId;
}

/**
 * Permanently remove a conversation and its messages. Used when the user
 * closes the underlying DM channel in Discord â€” our REST poll diff (and the
 * gateway CHANNEL_DELETE handler) call this so the unibox doesn't keep
 * showing channels that no longer exist on Discord's side.
 *
 * Cascades by FK in our schema, but we issue an explicit messages DELETE
 * first for clarity and to keep the operation safe if the cascade is ever
 * reconfigured. No-op if the conversation doesn't exist.
 */
export async function deleteConversation(id: string): Promise<void> {
  await query('DELETE FROM tenant_main.messages WHERE conversation_id = $1', [id]);
  await query('DELETE FROM tenant_main.conversations WHERE id = $1', [id]);
}

export async function loadAllConversations(): Promise<Conversation[]> {
  // Exclude conversations that have never had a message (empty wave-prepared
  // channels show up as blank rows and are pure noise). last_message_preview is
  // populated whenever a real message lands, so its emptiness is the cheapest
  // "no messages" signal.
  const rows = await query<any>(
    "SELECT id, account_id, peer_discord_user_id, peer_display_name, peer_avatar_url, last_message_preview, last_message_at, unread_count, label, last_message_direction, interested FROM tenant_main.conversations WHERE last_message_preview IS NOT NULL AND last_message_preview <> '' ORDER BY last_message_at DESC",
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    leadId: `live_lead_${r.peer_discord_user_id}`,
    peer: { discordUserId: r.peer_discord_user_id, displayName: r.peer_display_name, avatarUrl: r.peer_avatar_url },
    lastMessagePreview: r.last_message_preview || "",
    lastMessageAt: r.last_message_at.toISOString(),
    unreadCount: r.unread_count,
    label: r.label,
    lastMessageDirection: r.last_message_direction || null,
    interested: Boolean(r.interested),
  }));
}

/** Per-conversation last_message_direction. Powers the Unibox "Needs reply" filter exactly. */
export async function loadConversationLastDirections(): Promise<Map<string, "in" | "out" | null>> {
  const rows = await query<any>(
    "SELECT id, last_message_direction FROM tenant_main.conversations",
  );
  const map = new Map<string, "in" | "out" | null>();
  for (const r of rows) map.set(String(r.id), r.last_message_direction || null);
  return map;
}

export async function loadMessagesForConversation(convId: string): Promise<Message[]> {
  const rows = await query<any>(
    "SELECT id, conversation_id, direction, body, sent_at, author_name, author_avatar_url FROM tenant_main.messages WHERE conversation_id = $1 ORDER BY sent_at ASC",
    [convId],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    body: r.body,
    sentAt: r.sent_at.toISOString(),
    authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
  }));
}

// â”€â”€â”€â”€â”€ Campaigns & leads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface CampaignRow {
  id: string;
  name: string;
  accountIds: string[];
  /** v0.11+ â€” list of message variants, one chosen at random per send. */
  templates: string[];
  ratePerHour: number;
  ratePerDay: number;
  /** v0.13.2+ â€” global rest in seconds between ANY two sends in this campaign (across all accounts). */
  minInterSendSeconds: number;
  status: 'draft' | 'waving' | 'running' | 'paused' | 'finished';
  mode: 'fr' | 'dm' | 'both';
  minGlobalSpacingSeconds: number;
  guildId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totals: { queued: number; sent: number; replied: number; failed: number };
}

/** LeadRow is now identical to the API Lead type. Kept as an alias for back-compat with callers. */
export type LeadRow = Lead;

const rowToCampaign = (r: any): CampaignRow => ({
  id: r.id,
  name: r.name,
  accountIds: r.account_ids || [],
  templates: Array.isArray(r.templates) ? r.templates : [],
  ratePerHour: r.rate_per_hour,
  ratePerDay: r.rate_per_day,
  minInterSendSeconds: r.min_inter_send_seconds || 480,
  minGlobalSpacingSeconds: r.min_global_spacing_seconds ?? 300,
  guildId: r.guild_id ?? null,
  status: r.status,
  mode: r.mode || 'fr',
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at ? r.started_at.toISOString() : null,
  finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  totals: {
    queued: Number(r.totals_queued) || 0,
    sent: Number(r.totals_sent) || 0,
    replied: Number(r.totals_replied) || 0,
    failed: Number(r.totals_failed) || 0,
  },
});

function rowToLead(r: any): Lead {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    discordUserId: r.discord_user_id,
    displayName: r.display_name,
    status: r.status,
    source: r.source,
    assignedAccountId: r.assigned_account_id,
    sentAt: r.dm_sent_at ? (r.dm_sent_at instanceof Date ? r.dm_sent_at.toISOString() : String(r.dm_sent_at)) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const rows = await query<any>(
    'SELECT * FROM tenant_main.campaigns ORDER BY created_at DESC',
  );
  return rows.map(rowToCampaign);
}

// Running-only variant for the engine tick — filters in SQL (uses
// campaigns_status_idx) instead of fetching every campaign and filtering in JS
// every 5 seconds.
export async function listRunningCampaigns(): Promise<CampaignRow[]> {
  const rows = await query<any>(
    "SELECT * FROM tenant_main.campaigns WHERE status = 'running' ORDER BY created_at DESC",
  );
  return rows.map(rowToCampaign);
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const rows = await query<any>(
    'SELECT * FROM tenant_main.campaigns WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] ? rowToCampaign(rows[0]) : null;
}

export async function createCampaign(c: Omit<CampaignRow, 'startedAt' | 'finishedAt' | 'totals'> & { totals?: CampaignRow['totals'] }): Promise<void> {
  await query(
    `INSERT INTO tenant_main.campaigns
       (id, name, account_ids, templates, rate_per_hour, rate_per_day, min_inter_send_seconds, min_global_spacing_seconds, status, mode, guild_id, created_at, totals_queued)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO NOTHING`,
    [c.id, c.name, c.accountIds, c.templates, c.ratePerHour, c.ratePerDay, c.minInterSendSeconds, c.minGlobalSpacingSeconds ?? 300, c.status, c.mode, c.guildId ?? null, c.createdAt, c.totals?.queued || 0],
  );
}

export async function setCampaignStatus(id: string, status: CampaignRow['status']): Promise<void> {
  if (status === 'running') {
    await query(
      `UPDATE tenant_main.campaigns SET status = $2, started_at = COALESCE(started_at, now()) WHERE id = $1`,
      [id, status],
    );
  } else if (status === 'finished') {
    await query(
      `UPDATE tenant_main.campaigns SET status = $2, finished_at = now() WHERE id = $1`,
      [id, status],
    );
  } else {
    await query('UPDATE tenant_main.campaigns SET status = $2 WHERE id = $1', [id, status]);
  }
}

export async function bumpCampaignTotal(id: string, field: 'sent' | 'replied' | 'failed', by: number = 1): Promise<void> {
  await query(
    `UPDATE tenant_main.campaigns SET totals_${field} = totals_${field} + $2 WHERE id = $1`,
    [id, by],
  );
}

export async function deleteCampaign(id: string): Promise<void> {
  await query('DELETE FROM tenant_main.campaigns WHERE id = $1', [id]);
}

// v0.64 â€” when an operator deletes a campaign, they want:
//   1. Empty (never-waved) DM conversations removed from the Unibox.
//   2. Pending leads (no wave sent) wiped so the next scrape can re-find them.
//   3. Sent/replied leads preserved (otherwise the already-contacted check
//      would let us spam them again on the next scrape).
//
// Because leads.campaign_id FK has ON DELETE CASCADE, we detach the
// sent/replied leads (campaign_id = NULL) BEFORE deleting the campaign so
// they survive the cascade and remain in the already-contacted set.
// Conversations aren't FK-linked to leads (only to accounts), so we cull them
// explicitly by peer_discord_user_id, scoped to rows that have no messages.
export async function deleteCampaignAndCleanup(campaignId: string): Promise<{
  conversationIds: string[];
  pendingLeadsDeleted: number;
  sentLeadsPreserved: number;
}> {
  // All four steps run in one transaction: detaching sent/replied leads,
  // deleting empty conversations, and dropping the campaign must be atomic, or a
  // crash mid-way leaves leads orphaned (campaign_id NULL) while the campaign
  // still exists, or conversations gone while leads remain.
  return withTransaction(async (q) => {
    const preserved = await q<{ id: string }>(
      `UPDATE tenant_main.leads SET campaign_id = NULL
         WHERE campaign_id = $1 AND status IN ('sent','replied')
         RETURNING id`,
      [campaignId],
    );
    const pendingRows = await q<{ discord_user_id: string }>(
      `SELECT discord_user_id FROM tenant_main.leads
         WHERE campaign_id = $1 AND status = 'pending'`,
      [campaignId],
    );
    const pendingUserIds = pendingRows.map((r) => r.discord_user_id);
    let conversationIds: string[] = [];
    if (pendingUserIds.length > 0) {
      const del = await q<{ id: string }>(
        `DELETE FROM tenant_main.conversations c
           WHERE c.peer_discord_user_id = ANY($1::text[])
             AND NOT EXISTS (
               SELECT 1 FROM tenant_main.messages m WHERE m.conversation_id = c.id
             )
           RETURNING c.id`,
        [pendingUserIds],
      );
      conversationIds = del.map((d) => d.id);
    }
    // CASCADE removes any remaining (pending) leads.
    await q('DELETE FROM tenant_main.campaigns WHERE id = $1', [campaignId]);
    return {
      conversationIds,
      pendingLeadsDeleted: pendingRows.length,
      sentLeadsPreserved: preserved.length,
    };
  });
}

export async function bulkInsertLeads(leads: Pick<LeadRow, 'id' | 'campaignId' | 'discordUserId' | 'displayName' | 'source' | 'assignedAccountId'>[]): Promise<void> {
  if (!leads.length) return;
  // Build a single multi-row insert for speed.
  const values: any[] = [];
  const placeholders: string[] = [];
  leads.forEach((l, i) => {
    const o = i * 6;
    placeholders.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`);
    values.push(l.id, l.campaignId, l.discordUserId, l.displayName, l.source, l.assignedAccountId);
  });
  await query(
    `INSERT INTO tenant_main.leads
       (id, campaign_id, discord_user_id, display_name, source, assigned_account_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

// v0.67 â€” pending leads from currently-active (running/waving) campaigns,
// for surfacing in the Unibox as "needs wave" placeholders BEFORE a real
// Discord DM channel has been opened. The extension creates the channel
// on-demand from the operator's IP when they click Open in Discord.
export async function listActivePendingLeads(): Promise<{
  leadId: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  discordUserId: string;
  displayName: string | null;
  createdAt: string;
}[]> {
  const rows = await query<any>(
    `SELECT l.id, l.campaign_id, c.name AS campaign_name, l.assigned_account_id,
            l.discord_user_id, l.display_name, l.created_at
       FROM tenant_main.leads l
       JOIN tenant_main.campaigns c ON c.id = l.campaign_id
      WHERE l.status = 'pending'
        AND l.assigned_account_id IS NOT NULL
        AND c.status IN ('running','waving','paused')
      ORDER BY l.created_at ASC`,
  );
  return rows.map((r) => ({
    leadId: String(r.id),
    campaignId: String(r.campaign_id),
    campaignName: String(r.campaign_name || ''),
    accountId: String(r.assigned_account_id),
    discordUserId: String(r.discord_user_id),
    displayName: r.display_name ? String(r.display_name) : null,
    createdAt: r.created_at.toISOString ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function listLeadsByCampaign(campaignId: string): Promise<LeadRow[]> {
  const rows = await query<any>(
    'SELECT * FROM tenant_main.leads WHERE campaign_id = $1 ORDER BY created_at ASC',
    [campaignId],
  );
  return rows.map(rowToLead);
}

/** Pick the next batch of pending leads for a running campaign, rate-limit aware. */
export async function pickPendingLeads(campaignId: string, limit: number): Promise<LeadRow[]> {
  const rows = await query<any>(
    `SELECT * FROM tenant_main.leads
       WHERE campaign_id = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT $2`,
    [campaignId, limit],
  );
  return rows.map(rowToLead);
}

/** Recent sends from an account, used for rate-limit accounting. */
export async function countLeadsSentSince(accountId: string, sinceIso: string): Promise<number> {
  const rows = await query<any>(
    `SELECT count(*)::int AS n FROM tenant_main.leads
       WHERE assigned_account_id = $1 AND dm_sent_at IS NOT NULL AND dm_sent_at > $2`,
    [accountId, sinceIso],
  );
  return rows[0]?.n || 0;
}

export async function setLeadStatus(
  leadId: string,
  status: 'pending' | 'waving' | 'sent' | 'replied' | 'failed',
  assignedAccountId?: string,
  error?: string
): Promise<void> {
  if (error) {
    await query(
      `UPDATE tenant_main.leads SET status = $2, assigned_account_id = COALESCE($3, assigned_account_id), dm_error = $4, dm_sent_at = COALESCE(dm_sent_at, now()) WHERE id = $1`,
      [leadId, status, assignedAccountId || null, error.slice(0, 500)],
    );
  } else {
    await query(
      `UPDATE tenant_main.leads SET status = $2, assigned_account_id = COALESCE($3, assigned_account_id), dm_sent_at = CASE WHEN $2 IN ('sent','replied') THEN COALESCE(dm_sent_at, now()) ELSE dm_sent_at END WHERE id = $1`,
      [leadId, status, assignedAccountId || null],
    );
  }
}

export async function findPendingLeadByDiscordUserId(accountId: string, discordUserId: string): Promise<LeadRow | null> {
  const rows = await query<any>(
    `SELECT * FROM tenant_main.leads
       WHERE assigned_account_id = $1 AND discord_user_id = $2 AND status IN ('sent','pending')
       LIMIT 1`,
    [accountId, discordUserId],
  );
  return rows[0] ? rowToLead(rows[0]) : null;
}

/** Distinct account IDs that have leads (pending or otherwise) in this campaign. */
export async function getCampaignAccountIds(campaignId: string): Promise<string[]> {
  const rows = await query<any>(
    `SELECT DISTINCT assigned_account_id FROM tenant_main.leads WHERE campaign_id = $1 AND assigned_account_id IS NOT NULL`,
    [campaignId],
  );
  return rows.map((r: any) => String(r.assigned_account_id));
}

/** Returns the most recent attempt time for each account in this campaign (for cooldown).
 *  Includes failed leads — otherwise rejected sends don't count and the engine fires every tick. */
export async function getCampaignAccountLastSent(campaignId: string): Promise<Map<string, Date>> {
  const rows = await query<any>(
    `SELECT assigned_account_id, MAX(dm_sent_at) AS last_sent_at
       FROM tenant_main.leads
       WHERE campaign_id = $1 AND dm_sent_at IS NOT NULL
       GROUP BY assigned_account_id`,
    [campaignId],
  );
  const map = new Map<string, Date>();
  for (const r of rows) {
    if (r.assigned_account_id) map.set(String(r.assigned_account_id), new Date(r.last_sent_at));
  }
  return map;
}

/** Pick the oldest pending lead assigned to a specific account in a campaign. */
export async function pickNextLeadForAccount(campaignId: string, accountId: string): Promise<LeadRow | null> {
  const rows = await query<any>(
    `SELECT * FROM tenant_main.leads WHERE campaign_id = $1 AND assigned_account_id = $2 AND status = 'pending' ORDER BY created_at ASC LIMIT 1`,
    [campaignId, accountId],
  );
  return rows[0] ? rowToLead(rows[0]) : null;
}

/** Count remaining pending leads in a campaign. */
export async function countPendingLeads(campaignId: string): Promise<number> {
  const rows = await query<any>(
    `SELECT COUNT(*)::int AS n FROM tenant_main.leads WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId],
  );
  return rows[0]?.n || 0;
}

/**
 * Pick the oldest pending lead for an account in a campaign that already has an
 * existing DM conversation. We do NOT call openDmChannel â€” that triggers
 * Discord captchas. Leads without an existing channel are skipped here and
 * retried once a channel is opened organically (via the gateway or extension).
 */
export async function pickNextLeadWithChannelForAccount(
  campaignId: string,
  accountId: string,
): Promise<LeadRow | null> {
  const rows = await query<any>(
    `SELECT l.* FROM tenant_main.leads l
     INNER JOIN tenant_main.conversations c
       ON c.account_id = $2 AND c.peer_discord_user_id = l.discord_user_id
     WHERE l.campaign_id = $1 AND l.assigned_account_id = $2 AND l.status = 'pending'
     ORDER BY l.created_at ASC
     LIMIT 1`,
    [campaignId, accountId],
  );
  return rows[0] ? rowToLead(rows[0]) : null;
}

// â”€â”€â”€â”€â”€ Scraped guild members cache (v0.20) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface ScrapedGuildCache {
  accountId: string;
  guildId: string;
  guildName: string | null;
  memberCount: number;
  members: any[]; // { id, username, globalName, avatarUrl, nick }
  via: string | null;
  truncated: boolean;
  scrapedAt: string;
}

export async function getCachedGuildScrape(accountId: string, guildId: string): Promise<ScrapedGuildCache | null> {
  const rows = await query<any>(
    `SELECT account_id, guild_id, guild_name, member_count, members, via, truncated, scraped_at
       FROM tenant_main.scraped_guild_members
       WHERE account_id = $1 AND guild_id = $2`,
    [accountId, guildId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    accountId: r.account_id,
    guildId: r.guild_id,
    guildName: r.guild_name,
    memberCount: r.member_count,
    members: Array.isArray(r.members) ? r.members : [],
    via: r.via,
    truncated: !!r.truncated,
    scrapedAt: r.scraped_at.toISOString(),
  };
}

export async function saveScrapedGuildMembers(args: {
  accountId: string;
  guildId: string;
  guildName?: string | null;
  members: any[];
  via?: string | null;
  truncated?: boolean;
}): Promise<void> {
  await query(
    `INSERT INTO tenant_main.scraped_guild_members
       (account_id, guild_id, guild_name, member_count, members, via, truncated, scraped_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
     ON CONFLICT (account_id, guild_id) DO UPDATE SET
       guild_name = EXCLUDED.guild_name,
       member_count = EXCLUDED.member_count,
       members = EXCLUDED.members,
       via = EXCLUDED.via,
       truncated = EXCLUDED.truncated,
       scraped_at = EXCLUDED.scraped_at`,
    [
      args.accountId,
      args.guildId,
      args.guildName ?? null,
      args.members.length,
      JSON.stringify(args.members),
      args.via ?? null,
      !!args.truncated,
    ],
  );
}

export async function checkDbReady(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (err: any) {
    console.warn("[db] not ready:", err?.message || err);
    return false;
  }
}

// â”€â”€â”€â”€â”€ Account Groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import type { AccountGroup, AccountGroupMember, AccountGroupWithMembers } from './api-types';

function rowToGroup(r: any): AccountGroup {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listGroups(): Promise<AccountGroupWithMembers[]> {
  const groupRows = await query<any>(
    'SELECT id, name, description, created_at FROM tenant_main.account_groups ORDER BY created_at ASC',
  );
  const memberRows = await query<any>(
    'SELECT group_id, account_id, position, added_at FROM tenant_main.account_group_members ORDER BY position ASC',
  );
  const membersByGroup = new Map<string, AccountGroupMember[]>();
  for (const m of memberRows) {
    const list = membersByGroup.get(m.group_id) || [];
    list.push({
      accountId: m.account_id,
      position: Number(m.position) || 0,
      addedAt: m.added_at instanceof Date ? m.added_at.toISOString() : String(m.added_at),
    });
    membersByGroup.set(m.group_id, list);
  }
  return groupRows.map((g) => ({
    ...rowToGroup(g),
    members: membersByGroup.get(g.id) || [],
  }));
}

export async function getGroup(id: string): Promise<AccountGroupWithMembers | null> {
  const rows = await query<any>(
    'SELECT id, name, description, created_at FROM tenant_main.account_groups WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return null;
  const members = await query<any>(
    'SELECT account_id, position, added_at FROM tenant_main.account_group_members WHERE group_id = $1 ORDER BY position ASC',
    [id],
  );
  return {
    ...rowToGroup(rows[0]),
    members: members.map((m) => ({
      accountId: m.account_id,
      position: Number(m.position) || 0,
      addedAt: m.added_at instanceof Date ? m.added_at.toISOString() : String(m.added_at),
    })),
  };
}

export async function createGroup(group: Omit<AccountGroup, 'createdAt'>): Promise<void> {
  await query(
    'INSERT INTO tenant_main.account_groups (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [group.id, group.name, group.description || ''],
  );
}

export async function updateGroup(id: string, name: string, description: string): Promise<void> {
  await query(
    'UPDATE tenant_main.account_groups SET name = $2, description = $3 WHERE id = $1',
    [id, name, description],
  );
}

export async function deleteGroup(id: string): Promise<void> {
  await query('DELETE FROM tenant_main.account_groups WHERE id = $1', [id]);
}

export async function addAccountToGroup(groupId: string, accountId: string, position: number): Promise<void> {
  await query(
    'INSERT INTO tenant_main.account_group_members (group_id, account_id, position) VALUES ($1, $2, $3) ON CONFLICT (group_id, account_id) DO NOTHING',
    [groupId, accountId, position],
  );
}

export async function removeAccountFromGroup(groupId: string, accountId: string): Promise<void> {
  await query(
    'DELETE FROM tenant_main.account_group_members WHERE group_id = $1 AND account_id = $2',
    [groupId, accountId],
  );
}

export async function reorderGroupMembers(groupId: string, accountIdsInOrder: string[]): Promise<void> {
  for (let i = 0; i < accountIdsInOrder.length; i++) {
    await query(
      'UPDATE tenant_main.account_group_members SET position = $3 WHERE group_id = $1 AND account_id = $2',
      [groupId, accountIdsInOrder[i], i],
    );
  }
}

// â”€â”€â”€â”€â”€ Proxies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import type { Proxy } from './api-types';

function rowToProxy(r: any): Proxy {
  return {
    id: r.id,
    label: r.label || '',
    url: r.url,
    geo: r.geo || '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function listProxies(): Promise<Proxy[]> {
  const rows = await query<any>('SELECT id, label, url, geo, created_at FROM tenant_main.proxies ORDER BY created_at ASC');
  return rows.map(rowToProxy);
}

export async function createProxy(p: Omit<Proxy, 'createdAt'>): Promise<void> {
  await query(
    'INSERT INTO tenant_main.proxies (id, label, url, geo) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
    [p.id, p.label || '', p.url, p.geo || ''],
  );
}

export async function deleteProxy(id: string): Promise<void> {
  await query('DELETE FROM tenant_main.proxies WHERE id = $1', [id]);
}

export async function assignProxy(accountId: string, proxyId: string): Promise<void> {
  await query(
    `INSERT INTO tenant_main.account_proxies (account_id, proxy_id) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET proxy_id = EXCLUDED.proxy_id, assigned_at = now()`,
    [accountId, proxyId],
  );
}

export async function unassignProxy(accountId: string): Promise<void> {
  await query('DELETE FROM tenant_main.account_proxies WHERE account_id = $1', [accountId]);
}

export async function getAccountProxyMap(): Promise<Map<string, string>> {
  const rows = await query<any>('SELECT account_id, proxy_id FROM tenant_main.account_proxies');
  const map = new Map<string, string>();
  for (const r of rows) map.set(String(r.account_id), String(r.proxy_id));
  return map;
}

export async function getProxyUrlForAccount(accountId: string): Promise<string | null> {
  const rows = await query<any>(
    `SELECT p.url FROM tenant_main.account_proxies ap
       JOIN tenant_main.proxies p ON p.id = ap.proxy_id
      WHERE ap.account_id = $1`,
    [accountId],
  );
  return rows.length > 0 ? String(rows[0].url) : null;
}

/** Geo tag of the account's assigned proxy (e.g. "US-CA"), for deriving a
 *  matching browser timezone/locale so hCaptcha doesn't score an IP/locale
 *  mismatch. Null if no proxy or no geo set. */
export async function getProxyGeoForAccount(accountId: string): Promise<string | null> {
  const rows = await query<{ geo: string | null }>(
    `SELECT p.geo FROM tenant_main.account_proxies ap
       JOIN tenant_main.proxies p ON p.id = ap.proxy_id
      WHERE ap.account_id = $1`,
    [accountId],
  );
  const geo = rows[0]?.geo;
  return geo ? String(geo) : null;
}

/** Bulk load: account_id → proxy URL for all assigned accounts. One query instead of N. */
export async function listAllAccountProxyUrls(): Promise<Map<string, string>> {
  const rows = await query<any>(
    `SELECT ap.account_id, p.url FROM tenant_main.account_proxies ap
       JOIN tenant_main.proxies p ON p.id = ap.proxy_id`,
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.url) map.set(String(r.account_id), String(r.url));
  return map;
}

// â”€â”€â”€â”€â”€ Dashboard helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function countMessagesSince(direction: 'in' | 'out', sinceIso: string): Promise<number> {
  const rows = await query<any>(
    `SELECT COUNT(*)::int AS c FROM tenant_main.messages WHERE direction = $1 AND sent_at >= $2`,
    [direction, sinceIso],
  );
  return Number(rows[0]?.c || 0);
}

export async function countAllPendingLeads(): Promise<number> {
  const rows = await query<any>(
    `SELECT COUNT(*)::int AS c FROM tenant_main.leads WHERE status = 'pending'`,
  );
  return Number(rows[0]?.c || 0);
}

export async function recentMessagesSince(sinceIso: string, limit: number): Promise<any[]> {
  return await query<any>(
    `SELECT m.sent_at, m.direction, c.peer_display_name
       FROM tenant_main.messages m
       JOIN tenant_main.conversations c ON c.id = m.conversation_id
      WHERE m.sent_at >= $1
      ORDER BY m.sent_at DESC
      LIMIT $2`,
    [sinceIso, limit],
  );
}

// â”€â”€â”€â”€â”€ Already-contacted leads (v0.55) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns the set of discord_user_id values we've already sent a template to
// in any past campaign (status IN ('sent','replied')). The scrape endpoint
// uses this to filter freshly-scraped members so the operator doesn't
// accidentally re-contact someone with a different account.
export async function getAlreadyContactedDiscordUserIds(): Promise<Set<string>> {
  const rows = await query<any>(
    `SELECT DISTINCT discord_user_id FROM tenant_main.leads
       WHERE status IN ('sent', 'replied')`,
  );
  const out = new Set<string>();
  for (const r of rows) out.add(String(r.discord_user_id));
  return out;
}

// â”€â”€â”€â”€â”€ Lead eligibility (v0.33) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// For each scraped discord_user_id, return the set of accountIds (from the
// candidate set) that have a cached scrape containing that user. Used at
// campaign-create time to compute per-lead eligibility before least-loaded
// assignment.
export async function getEligibilityForUsers(
  candidateAccountIds: string[],
  discordUserIds: string[],
): Promise<Map<string, string[]>> {
  const eligibility = new Map<string, string[]>();
  if (candidateAccountIds.length === 0 || discordUserIds.length === 0) return eligibility;
  const rows = await query<any>(
    `SELECT account_id, m->>'id' AS discord_user_id
       FROM tenant_main.scraped_guild_members,
            LATERAL jsonb_array_elements(members) AS m
      WHERE account_id = ANY($1::text[])
        AND (m->>'id') = ANY($2::text[])`,
    [candidateAccountIds, discordUserIds],
  );
  for (const r of rows) {
    const uid = String(r.discord_user_id);
    const acct = String(r.account_id);
    const list = eligibility.get(uid) || [];
    if (!list.includes(acct)) list.push(acct);
    eligibility.set(uid, list);
  }
  return eligibility;
}

// â”€â”€â”€â”€â”€ Campaign account suspensions (v0.33) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface CampaignAccountSuspension {
  campaignId: string;
  accountId: string;
  suspendedAt: string;
  reason: string;
}

export async function listSuspensions(campaignId: string): Promise<CampaignAccountSuspension[]> {
  const rows = await query<any>(
    `SELECT campaign_id, account_id, suspended_at, reason
       FROM tenant_main.campaign_account_suspensions
      WHERE campaign_id = $1`,
    [campaignId],
  );
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    accountId: r.account_id,
    suspendedAt: r.suspended_at instanceof Date ? r.suspended_at.toISOString() : String(r.suspended_at),
    reason: r.reason || '',
  }));
}

export async function addSuspension(campaignId: string, accountId: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO tenant_main.campaign_account_suspensions (campaign_id, account_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (campaign_id, account_id) DO UPDATE SET reason = EXCLUDED.reason, suspended_at = now()`,
    [campaignId, accountId, reason.slice(0, 500)],
  );
}

export async function clearSuspension(campaignId: string, accountId: string): Promise<void> {
  await query(
    `DELETE FROM tenant_main.campaign_account_suspensions WHERE campaign_id = $1 AND account_id = $2`,
    [campaignId, accountId],
  );
}

/**
 * Move all pending leads currently assigned to `fromAccountId` in `campaignId`
 * to a different eligible non-suspended account, chosen via least-loaded over
 * the current per-account assignment count. Leads with no remaining eligible
 * account get `assigned_account_id = NULL` and become invisible to the
 * scheduler until the operator clears a suspension.
 *
 * Returns { reassigned, orphaned } counts.
 */
export async function rebalanceFromSuspendedAccount(
  campaignId: string,
  fromAccountId: string,
): Promise<{ reassigned: number; orphaned: number }> {
  const camp = await getCampaign(campaignId);
  if (!camp) return { reassigned: 0, orphaned: 0 };
  const suspended = await listSuspensions(campaignId);
  const suspendedIds = new Set(suspended.map((s) => s.accountId));
  suspendedIds.add(fromAccountId);
  const eligibleAccounts = camp.accountIds.filter((id) => !suspendedIds.has(id));

  const pending = await query<any>(
    `SELECT id, discord_user_id FROM tenant_main.leads
       WHERE campaign_id = $1 AND assigned_account_id = $2 AND status = 'pending'`,
    [campaignId, fromAccountId],
  );
  if (pending.length === 0) return { reassigned: 0, orphaned: 0 };

  // Initial load count per remaining eligible account.
  const loadRows = await query<any>(
    `SELECT assigned_account_id, count(*)::int AS n FROM tenant_main.leads
       WHERE campaign_id = $1 AND status = 'pending' AND assigned_account_id = ANY($2::text[])
       GROUP BY assigned_account_id`,
    [campaignId, eligibleAccounts],
  );
  const load = new Map<string, number>();
  for (const a of eligibleAccounts) load.set(a, 0);
  for (const r of loadRows) load.set(String(r.assigned_account_id), Number(r.n));

  // Eligibility of these leads.
  const eligibility = await getEligibilityForUsers(
    eligibleAccounts,
    pending.map((p: any) => String(p.discord_user_id)),
  );

  let reassigned = 0;
  let orphaned = 0;
  // All reassignments/orphanings in one transaction so a crash mid-loop can't
  // leave the campaign half-rebalanced (some leads moved, some stranded).
  await withTransaction(async (q) => {
    for (const lead of pending) {
      const elig = (eligibility.get(String(lead.discord_user_id)) || []).filter((a) => !suspendedIds.has(a));
      if (elig.length === 0) {
        await q(`UPDATE tenant_main.leads SET assigned_account_id = NULL WHERE id = $1`, [lead.id]);
        orphaned += 1;
        continue;
      }
      let best: string | null = null;
      let bestN = Infinity;
      for (const a of elig) {
        const n = load.get(a) || 0;
        if (n < bestN) { bestN = n; best = a; }
      }
      if (!best) {
        await q(`UPDATE tenant_main.leads SET assigned_account_id = NULL WHERE id = $1`, [lead.id]);
        orphaned += 1;
        continue;
      }
      await q(`UPDATE tenant_main.leads SET assigned_account_id = $2 WHERE id = $1`, [lead.id, best]);
      load.set(best, (load.get(best) || 0) + 1);
      reassigned += 1;
    }
  });
  return { reassigned, orphaned };
}

/** Per-account aggregate stats for a campaign's detail view. */
export interface CampaignAccountStats {
  accountId: string;
  queued: number;
  sent: number;
  replied: number;
  failed: number;
  unassigned?: boolean;
}

export async function getCampaignAccountStats(campaignId: string): Promise<CampaignAccountStats[]> {
  const rows = await query<any>(
    `SELECT
       COALESCE(assigned_account_id, '') AS account_id,
       count(*) FILTER (WHERE status = 'pending')::int AS queued,
       count(*) FILTER (WHERE status = 'sent')::int    AS sent,
       count(*) FILTER (WHERE status = 'replied')::int AS replied,
       count(*) FILTER (WHERE status = 'failed')::int  AS failed
     FROM tenant_main.leads
     WHERE campaign_id = $1
     GROUP BY COALESCE(assigned_account_id, '')`,
    [campaignId],
  );
  return rows.map((r: any) => ({
    accountId: r.account_id || '',
    queued: r.queued,
    sent: r.sent,
    replied: r.replied,
    failed: r.failed,
    unassigned: !r.account_id,
  }));
}

// â”€â”€â”€â”€â”€ Warmup campaigns (v0.76, open-ended) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WarmupCampaignRow {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "cancelled";
  active_hours_start_utc: number;
  active_hours_end_utc: number;
  per_account_interval_min_minutes: number;
  per_account_interval_max_minutes: number;
  between_account_interval_minutes: number;
  daily_send_cap: number;
  guild_id: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarmupCampaignAccountRow {
  campaign_id: string;
  account_id: string;
  message_bank: string[];
  msgs_sent_count: number;
  partners_reached_count: number;
  last_sent_at: string | null;
  next_eligible_at: string | null;
  dead_since: string | null;
}

export interface WarmupCampaignPairRow {
  campaign_id: string;
  account_a_id: string;
  account_b_id: string;
  channel_id_a_to_b: string | null;
  channel_id_b_to_a: string | null;
  msgs_a_to_b: number;
  msgs_b_to_a: number;
  paused_reason: string | null;
  pending_reply_from: string | null;
}

export async function createWarmupCampaign(c: Omit<WarmupCampaignRow, "created_at"|"updated_at"|"started_at"|"cancelled_at">): Promise<void> {
  await query(
    `INSERT INTO tenant_main.warmup_campaigns
     (id, name, status, active_hours_start_utc, active_hours_end_utc,
      per_account_interval_min_minutes, per_account_interval_max_minutes,
      between_account_interval_minutes, daily_send_cap, guild_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [c.id, c.name, c.status, c.active_hours_start_utc, c.active_hours_end_utc,
     c.per_account_interval_min_minutes, c.per_account_interval_max_minutes,
     c.between_account_interval_minutes, c.daily_send_cap, c.guild_id ?? null],
  );
}

export async function listWarmupCampaigns(): Promise<WarmupCampaignRow[]> {
  return await query<WarmupCampaignRow>(
    "SELECT * FROM tenant_main.warmup_campaigns ORDER BY created_at DESC",
  );
}

export async function deleteWarmupCampaign(id: string): Promise<void> {
  // Cascade: pairs, accounts, messages are FK-linked with ON DELETE CASCADE.
  await query("DELETE FROM tenant_main.warmup_campaigns WHERE id = $1", [id]);
}

export async function getWarmupCampaign(id: string): Promise<WarmupCampaignRow | null> {
  const r = await query<WarmupCampaignRow>(
    "SELECT * FROM tenant_main.warmup_campaigns WHERE id = $1",
    [id],
  );
  return r[0] || null;
}

export async function setWarmupCampaignGuildId(id: string, guildId: string | null): Promise<void> {
  await query(
    "UPDATE tenant_main.warmup_campaigns SET guild_id=$1, updated_at=$2 WHERE id=$3",
    [guildId ?? null, new Date().toISOString(), id],
  );
}

export async function setWarmupCampaignStatus(id: string, status: WarmupCampaignRow["status"]): Promise<void> {
  const now = new Date().toISOString();
  if (status === "running") {
    await query(
      "UPDATE tenant_main.warmup_campaigns SET status=$1, started_at=COALESCE(started_at,$2), updated_at=$2 WHERE id=$3",
      [status, now, id],
    );
  } else if (status === "cancelled") {
    await query(
      "UPDATE tenant_main.warmup_campaigns SET status=$1, cancelled_at=$2, updated_at=$2 WHERE id=$3",
      [status, now, id],
    );
  } else {
    await query(
      "UPDATE tenant_main.warmup_campaigns SET status=$1, updated_at=$2 WHERE id=$3",
      [status, now, id],
    );
  }
}

export async function listWarmupCampaignAccounts(campaignId: string): Promise<WarmupCampaignAccountRow[]> {
  return await query<WarmupCampaignAccountRow>(
    `SELECT campaign_id, account_id, message_bank, msgs_sent_count, partners_reached_count,
            last_sent_at, next_eligible_at, dead_since
       FROM tenant_main.warmup_campaign_accounts
      WHERE campaign_id = $1
      ORDER BY account_id`,
    [campaignId],
  );
}

export async function upsertWarmupCampaignAccount(
  campaignId: string, accountId: string, messageBank: string[],
): Promise<void> {
  await query(
    `INSERT INTO tenant_main.warmup_campaign_accounts (campaign_id, account_id, message_bank)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (campaign_id, account_id) DO UPDATE SET message_bank = EXCLUDED.message_bank`,
    [campaignId, accountId, JSON.stringify(messageBank)],
  );
}

export async function upsertWarmupCampaignPair(
  campaignId: string, acctA: string, acctB: string,
): Promise<void> {
  const [a, b] = acctA < acctB ? [acctA, acctB] : [acctB, acctA];
  await query(
    `INSERT INTO tenant_main.warmup_campaign_pairs (campaign_id, account_a_id, account_b_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (campaign_id, account_a_id, account_b_id) DO NOTHING`,
    [campaignId, a, b],
  );
}

export async function listWarmupCampaignPairs(campaignId: string): Promise<WarmupCampaignPairRow[]> {
  return await query<WarmupCampaignPairRow>(
    `SELECT * FROM tenant_main.warmup_campaign_pairs WHERE campaign_id = $1`,
    [campaignId],
  );
}

export async function updatePairChannelId(
  campaignId: string, acctA: string, acctB: string,
  side: "a_to_b" | "b_to_a", channelId: string,
): Promise<void> {
  const [a, b] = acctA < acctB ? [acctA, acctB] : [acctB, acctA];
  const col = side === "a_to_b" ? "channel_id_a_to_b" : "channel_id_b_to_a";
  await query(
    `UPDATE tenant_main.warmup_campaign_pairs
        SET ${col} = $1
      WHERE campaign_id=$2 AND account_a_id=$3 AND account_b_id=$4`,
    [channelId, campaignId, a, b],
  );
}

export async function recordWarmupMessage(row: {
  campaignId: string; senderAccountId: string; recipientAccountId: string;
  content: string; ok: boolean; httpStatus?: number; captchaSolved?: boolean;
  costCents?: number; error?: string;
}): Promise<void> {
  await query(
    `INSERT INTO tenant_main.warmup_campaign_messages
     (campaign_id, sender_account_id, recipient_account_id, content, ok, http_status, captcha_solved, cost_cents, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.campaignId, row.senderAccountId, row.recipientAccountId, row.content, row.ok,
     row.httpStatus || null, !!row.captchaSolved, row.costCents || 0, row.error || null],
  );
}

// Distinct partners this sender has messaged in the campaign — computed in SQL
// instead of pulling 500 recent rows and de-duping in JS on every send (which
// also under-counted partners beyond the 500-row window).
export async function countDistinctWarmupPartners(campaignId: string, senderAccountId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT recipient_account_id)::text AS n
       FROM tenant_main.warmup_campaign_messages
      WHERE campaign_id = $1 AND sender_account_id = $2 AND ok = true`,
    [campaignId, senderAccountId],
  );
  return parseInt(rows[0]?.n ?? "0", 10);
}

export async function incrementAccountSendCount(
  campaignId: string, accountId: string, newPartnerCount: number,
): Promise<void> {
  await query(
    `UPDATE tenant_main.warmup_campaign_accounts
        SET msgs_sent_count = msgs_sent_count + 1,
            partners_reached_count = $1,
            last_sent_at = now()
      WHERE campaign_id=$2 AND account_id=$3`,
    [newPartnerCount, campaignId, accountId],
  );
}

export async function incrementPairCount(
  campaignId: string, acctA: string, acctB: string, sender: string,
): Promise<void> {
  const [a, b] = acctA < acctB ? [acctA, acctB] : [acctB, acctA];
  const col = sender === a ? "msgs_a_to_b" : "msgs_b_to_a";
  await query(
    `UPDATE tenant_main.warmup_campaign_pairs
        SET ${col} = ${col} + 1
      WHERE campaign_id=$1 AND account_a_id=$2 AND account_b_id=$3`,
    [campaignId, a, b],
  );
}

export async function setAccountNextEligible(
  campaignId: string, accountId: string, isoDt: string,
): Promise<void> {
  await query(
    `UPDATE tenant_main.warmup_campaign_accounts SET next_eligible_at = $1
      WHERE campaign_id=$2 AND account_id=$3`,
    [isoDt, campaignId, accountId],
  );
}

export async function setAccountDeadSince(
  campaignId: string, accountId: string, isoDt: string | null,
): Promise<void> {
  await query(
    `UPDATE tenant_main.warmup_campaign_accounts SET dead_since = $1
      WHERE campaign_id=$2 AND account_id=$3`,
    [isoDt, campaignId, accountId],
  );
}

export async function pauseWarmupPair(
  campaignId: string, acctA: string, acctB: string, reason: string,
): Promise<void> {
  const [a, b] = acctA < acctB ? [acctA, acctB] : [acctB, acctA];
  await query(
    `UPDATE tenant_main.warmup_campaign_pairs SET paused_reason = $1
      WHERE campaign_id=$2 AND account_a_id=$3 AND account_b_id=$4`,
    [reason, campaignId, a, b],
  );
}

export async function removeAccountFromWarmupCampaign(campaignId: string, accountId: string): Promise<void> {
  await Promise.all([
    query(
      `DELETE FROM tenant_main.warmup_campaign_accounts WHERE campaign_id=$1 AND account_id=$2`,
      [campaignId, accountId],
    ),
    query(
      `DELETE FROM tenant_main.warmup_campaign_pairs WHERE campaign_id=$1 AND (account_a_id=$2 OR account_b_id=$2)`,
      [campaignId, accountId],
    ),
  ]);
}


export async function countTotalWarmupMessagesSent(accountId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tenant_main.warmup_campaign_messages WHERE sender_account_id = $1 AND ok = true`,
    [accountId],
  );
  return Number(rows[0]?.n || 0);
}

export async function quarantineAccount(accountId: string): Promise<void> {
  await query(
    `UPDATE tenant_main.discord_accounts SET warmup_status = 'quarantined' WHERE id = $1`,
    [accountId],
  );
  // Mark dead in every warmup campaign it's part of so the engine skips it.
  await query(
    `UPDATE tenant_main.warmup_campaign_accounts SET dead_since = now() WHERE account_id = $1 AND dead_since IS NULL`,
    [accountId],
  );
}

// restAccount: lightweight temporary rest triggered from the Health tab.
// Does NOT mark the account's status as token_revoked — the token stays valid
// and the gateway connection stays open. The account is simply excluded from
// all campaign send engines until the operator clicks "Activate".
export async function restAccount(accountId: string): Promise<void> {
  await query(
    `UPDATE tenant_main.discord_accounts SET warmup_status = 'resting' WHERE id = $1 AND warmup_status NOT IN ('quarantined','retired')`,
    [accountId],
  );
}

export async function unrestAccount(accountId: string): Promise<void> {
  await query(
    `UPDATE tenant_main.discord_accounts SET warmup_status = 'outreach' WHERE id = $1 AND warmup_status = 'resting'`,
    [accountId],
  );
}

// Count how many times an account performed a given action in the last 24 hours.
// Used by engines for auto-rest enforcement after each send.
export async function getAccount24hActionCount(accountId: string, action: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tenant_main.account_activity_log WHERE account_id = $1 AND action = $2 AND ts > now() - INTERVAL '24 hours'`,
    [accountId, action],
  );
  return Number(r[0]?.n ?? 0);
}

export async function setPendingReply(
  campaignId: string, acctA: string, acctB: string, fromAccountId: string | null,
): Promise<void> {
  const [a, b] = acctA < acctB ? [acctA, acctB] : [acctB, acctA];
  await query(
    `UPDATE tenant_main.warmup_campaign_pairs SET pending_reply_from = $1
      WHERE campaign_id=$2 AND account_a_id=$3 AND account_b_id=$4`,
    [fromAccountId, campaignId, a, b],
  );
}

// â”€â”€ Message templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TemplateRow {
  id: string;
  name: string | null;
  body: string;
  vars: string[] | null;
  created_at: string;
}

export async function listTemplates(): Promise<TemplateRow[]> {
  return await query<TemplateRow>(
    `SELECT id, name, body, vars, created_at FROM tenant_main.templates ORDER BY created_at DESC`,
  );
}

export async function createTemplate(name: string, body: string): Promise<TemplateRow> {
  const r = await query<TemplateRow>(
    `INSERT INTO tenant_main.templates (name, body) VALUES ($1, $2) RETURNING *`,
    [name || null, body],
  );
  return r[0]!;
}

export async function updateTemplate(id: string, name: string, body: string): Promise<void> {
  await query(
    `UPDATE tenant_main.templates SET name=$1, body=$2 WHERE id=$3`,
    [name || null, body, id],
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.templates WHERE id=$1`, [id]);
}

// â”€â”€ Content library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LibraryItem {
  id: string;
  title: string | null;
  text_body: string | null;
  image_urls: string[];
  shortcut: string | null;
  sort_order: number;
  created_at: string;
}

export async function listLibraryItems(): Promise<LibraryItem[]> {
  return await query<LibraryItem>(
    `SELECT id, title, text_body, image_urls, shortcut, sort_order, created_at
       FROM tenant_main.content_library
      ORDER BY sort_order ASC, created_at DESC`,
  );
}

export async function createLibraryItem(item: { title?: string; text_body?: string; image_urls?: string[]; shortcut?: string }): Promise<LibraryItem> {
  const r = await query<LibraryItem>(
    `INSERT INTO tenant_main.content_library (title, text_body, image_urls, shortcut)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [item.title || null, item.text_body || null, item.image_urls || [], item.shortcut || null],
  );
  return r[0]!;
}

export async function updateLibraryItem(id: string, item: { title?: string; text_body?: string; image_urls?: string[]; shortcut?: string }): Promise<void> {
  await query(
    `UPDATE tenant_main.content_library SET title=$1, text_body=$2, image_urls=$3, shortcut=$4 WHERE id=$5`,
    [item.title || null, item.text_body || null, item.image_urls || [], item.shortcut || null, id],
  );
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.content_library WHERE id=$1`, [id]);
}

// ── Warmup bank presets ───────────────────────────────────────────────────────

export interface WarmupBankPreset {
  id: string;
  name: string;
  messages: string[];
  created_at: string;
}

export async function listWarmupBankPresets(): Promise<WarmupBankPreset[]> {
  return await query<WarmupBankPreset>(
    `SELECT id, name, messages, created_at FROM tenant_main.warmup_bank_presets ORDER BY created_at DESC`,
  );
}

export async function upsertWarmupBankPreset(name: string, messages: string[]): Promise<WarmupBankPreset> {
  const r = await query<WarmupBankPreset>(
    `INSERT INTO tenant_main.warmup_bank_presets (name, messages)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [name, messages],
  );
  if (r[0]) return r[0];
  const u = await query<WarmupBankPreset>(
    `UPDATE tenant_main.warmup_bank_presets SET messages=$2 WHERE name=$1 RETURNING *`,
    [name, messages],
  );
  return u[0]!;
}

export async function deleteWarmupBankPreset(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.warmup_bank_presets WHERE id=$1`, [id]);
}

export async function countWarmupSendsInWindow(
  campaignId: string, accountId: string, windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const r = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tenant_main.warmup_campaign_messages
      WHERE campaign_id=$1 AND sender_account_id=$2 AND ok=true AND sent_at >= $3`,
    [campaignId, accountId, since],
  );
  return Number(r[0]?.n ?? 0);
}

export async function listRecentWarmupMessages(campaignId: string, limit: number): Promise<Array<{
  id: number; sender_account_id: string; recipient_account_id: string;
  content: string; ok: boolean; http_status: number | null;
  captcha_solved: boolean; cost_cents: number; error: string | null; sent_at: string;
}>> {
  return await query(
    `SELECT id, sender_account_id, recipient_account_id, content, ok, http_status,
            captcha_solved, cost_cents, error, sent_at
       FROM tenant_main.warmup_campaign_messages
      WHERE campaign_id = $1
      ORDER BY id DESC
      LIMIT $2`,
    [campaignId, Math.min(500, limit)],
  );
}

// ───── FR Campaigns ───────────────────────────────────────────────────────────

export interface FrCampaignRow {
  id: string;
  name: string;
  status: string;
  mode: string;
  guild_id: string | null;
  template: string | null;
  fr_per_account_per_day: number;
  min_interval_seconds: number;
  max_interval_seconds: number;
  combo_interval_seconds: number;
  inter_send_seconds: number;
  created_at: string;
}

export interface FrLeadRow {
  id: string;
  campaign_id: string;
  discord_user_id: string;
  display_name: string | null;
  username: string | null;
  assigned_account_id: string | null;
  status: string;
  fr_sent_at: string | null;
  fr_accepted_at: string | null;
  dm_sent_at: string | null;
  next_eligible_at: string | null;
  fr_due_at: string | null;
  error: string | null;
}

export async function listFrCampaigns(): Promise<FrCampaignRow[]> {
  return query(`SELECT * FROM tenant_main.fr_campaigns ORDER BY created_at DESC`);
}

// Running-only variant for the FR engine tick (filters in SQL instead of JS).
export async function listRunningFrCampaigns(): Promise<FrCampaignRow[]> {
  return query(`SELECT * FROM tenant_main.fr_campaigns WHERE status = 'running' ORDER BY created_at DESC`);
}

export async function getFrCampaign(id: string): Promise<FrCampaignRow | null> {
  const rows = await query<FrCampaignRow>(`SELECT * FROM tenant_main.fr_campaigns WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createFrCampaign(data: {
  name: string; mode: string; guild_id?: string; template?: string;
  fr_per_account_per_day: number; min_interval_seconds: number;
  max_interval_seconds: number; combo_interval_seconds: number;
  inter_send_seconds: number;
}): Promise<FrCampaignRow> {
  const rows = await query<FrCampaignRow>(
    `INSERT INTO tenant_main.fr_campaigns
       (name, mode, guild_id, template, fr_per_account_per_day,
        min_interval_seconds, max_interval_seconds, combo_interval_seconds,
        inter_send_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.name, data.mode, data.guild_id ?? null, data.template ?? null,
     data.fr_per_account_per_day, data.min_interval_seconds,
     data.max_interval_seconds, data.combo_interval_seconds,
     data.inter_send_seconds],
  );
  return rows[0]!;
}

export async function countOutreachSendsToday(campaignId: string, accountId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_main.leads
      WHERE campaign_id = $1 AND assigned_account_id = $2
        AND status = 'sent' AND dm_sent_at >= now() - interval '24 hours'`,
    [campaignId, accountId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function updateFrCampaignStatus(id: string, status: string): Promise<void> {
  await query(`UPDATE tenant_main.fr_campaigns SET status = $2 WHERE id = $1`, [id, status]);
}

export async function updateFrCampaign(id: string, patch: Partial<Pick<FrCampaignRow, 'name' | 'template' | 'guild_id'>>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [id];
  if (patch.name !== undefined)     { vals.push(patch.name);     sets.push(`name = $${vals.length}`); }
  if (patch.template !== undefined) { vals.push(patch.template); sets.push(`template = $${vals.length}`); }
  if (patch.guild_id !== undefined) { vals.push(patch.guild_id); sets.push(`guild_id = $${vals.length}`); }
  if (!sets.length) return;
  await query(`UPDATE tenant_main.fr_campaigns SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function deleteFrCampaign(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.fr_campaigns WHERE id = $1`, [id]);
}

export async function importFrLeads(campaignId: string, leads: Array<{ discord_user_id: string; display_name?: string; username?: string }>): Promise<number> {
  if (!leads.length) return 0;
  // Chunked multi-row insert instead of one round-trip per lead. 500 rows × 4
  // params = 2000 params/statement, well under Postgres's 65535 limit.
  // (Also fixes a latent bug: the old per-row `(r as any).rowCount` read was
  // always undefined since query() returns rows, so inserted always reported 0.)
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    slice.forEach((l, idx) => {
      const b = idx * 4;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      params.push(campaignId, l.discord_user_id, l.display_name ?? null, l.username ?? null);
    });
    const rows = await query<{ id: string }>(
      `INSERT INTO tenant_main.fr_campaign_leads (campaign_id, discord_user_id, display_name, username)
       VALUES ${values.join(",")}
       ON CONFLICT (campaign_id, discord_user_id) DO NOTHING
       RETURNING id`,
      params,
    );
    inserted += rows.length;
  }
  return inserted;
}


export async function getFrLead(id: string): Promise<FrLeadRow | null> {
  const rows = await query<FrLeadRow>(`SELECT * FROM tenant_main.fr_campaign_leads WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listFrLeads(campaignId: string, limit = 200, offset = 0): Promise<FrLeadRow[]> {
  return query<FrLeadRow>(
    `SELECT * FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset],
  );
}

export async function resolveLeadUsernamesFromScraper(campaignId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE tenant_main.fr_campaign_leads l
       SET username = sm.username
       FROM tenant_main.scraped_members sm
       WHERE l.campaign_id = $1
         AND l.discord_user_id = sm.discord_user_id
         AND l.username IS NULL
         AND sm.username IS NOT NULL
       RETURNING 1
     ) SELECT COUNT(*)::text AS n FROM updated`,
    [campaignId],
  );
  return parseInt(r[0]?.n ?? "0", 10);
}

export async function listEligibleFrLeads(campaignId: string): Promise<FrLeadRow[]> {
  return query<FrLeadRow>(
    `SELECT * FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1
        AND status = 'pending'
        AND (next_eligible_at IS NULL OR next_eligible_at < now())
        AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT 100`,
    [campaignId],
  );
}

// Atomically take exclusive ownership of a lead right before sending. Returns
// true only if THIS call won the claim — a concurrent tick/process that already
// holds a live (<5min) claim loses and should skip the lead this round. Pairs
// with releaseFrLeadClaim() in the sender's finally block.
export async function tryClaimFrLead(leadId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE tenant_main.fr_campaign_leads
        SET claimed_at = now()
      WHERE id = $1
        AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
      RETURNING id`,
    [leadId],
  );
  return rows.length > 0;
}

// Release a claim once the send resolves so next_eligible_at becomes the gate
// again (a successful send moves status off 'pending', so this is a no-op there).
export async function releaseFrLeadClaim(leadId: string): Promise<void> {
  await query(`UPDATE tenant_main.fr_campaign_leads SET claimed_at = NULL WHERE id = $1`, [leadId]);
}

// Top-of-tick sweep: null out claims older than 5 minutes (a process crashed
// mid-send). Belt-and-suspenders — the SELECT/UPDATE guards already ignore them.
export async function releaseStaleFrClaims(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE tenant_main.fr_campaign_leads
        SET claimed_at = NULL
      WHERE claimed_at IS NOT NULL AND claimed_at < now() - interval '5 minutes'
      RETURNING id`,
  );
  return rows.length;
}

export async function listPendingComboDmLeads(campaignId: string): Promise<Array<{ id: string; discord_user_id: string; display_name: string | null; assigned_account_id: string | null }>> {
  return query(
    `SELECT id, discord_user_id, display_name, assigned_account_id
       FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1 AND status = 'fr_sent'
        AND fr_due_at IS NOT NULL AND fr_due_at < now()
        AND dm_sent_at IS NULL`,
    [campaignId],
  );
}

export async function updateFrLead(id: string, patch: Partial<Pick<FrLeadRow, 'status' | 'assigned_account_id' | 'fr_sent_at' | 'fr_accepted_at' | 'dm_sent_at' | 'next_eligible_at' | 'fr_due_at' | 'error' | 'username'>>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return;
  await query(`UPDATE tenant_main.fr_campaign_leads SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function findFrLeadByDiscordUser(discordUserId: string): Promise<Array<FrLeadRow & { campaign_mode: string; campaign_template: string | null }>> {
  return query(
    `SELECT l.*, c.mode AS campaign_mode, c.template AS campaign_template
       FROM tenant_main.fr_campaign_leads l
       JOIN tenant_main.fr_campaigns c ON c.id = l.campaign_id
      WHERE l.discord_user_id = $1 AND l.status = 'fr_sent'`,
    [discordUserId],
  );
}

export async function countFrSendsToday(campaignId: string, accountId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1 AND assigned_account_id = $2
        AND fr_sent_at > now() - interval '24 hours'`,
    [campaignId, accountId],
  );
  return parseInt(rows[0]?.n || '0', 10);
}

export async function listFrLeadsDmPending(campaignId: string): Promise<FrLeadRow[]> {
  return query<FrLeadRow>(
    `SELECT * FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1
        AND status = 'pending'
        AND dm_sent_at IS NULL
        AND (next_eligible_at IS NULL OR next_eligible_at < now())
      ORDER BY created_at LIMIT 50`,
    [campaignId],
  );
}

export async function listFrLeadsAwaitingFr(campaignId: string): Promise<FrLeadRow[]> {
  return query<FrLeadRow>(
    `SELECT * FROM tenant_main.fr_campaign_leads
      WHERE campaign_id = $1
        AND status = 'pending'
        AND dm_sent_at IS NOT NULL
        AND fr_due_at IS NOT NULL
        AND fr_due_at < now()
      ORDER BY dm_sent_at LIMIT 100`,
    [campaignId],
  );
}

// ───── Member scraper ─────────────────────────────────────────────────────────

export interface ScraperJobRow {
  id: string;
  account_id: string;
  guild_id: string;
  guild_name: string | null;
  status: "idle" | "running" | "paused" | "error";
  interval_minutes: number;
  last_scraped_at: string | null;
  next_scrape_at: string | null;
  members_new: number;
  members_total: number;
  error_message: string | null;
  created_at: string;
}

export interface ScrapedMemberRow {
  id: number;
  job_id: string | null;
  guild_id: string | null;
  guild_name: string | null;
  discord_user_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  fr_status: "pending" | "fr_queued" | "fr_sent";
  first_seen_at: string;
}

export async function listScraperJobs(): Promise<ScraperJobRow[]> {
  return query<ScraperJobRow>(
    `SELECT * FROM tenant_main.member_scraper_jobs ORDER BY created_at ASC`,
  );
}

export async function getScraperJob(id: string): Promise<ScraperJobRow | null> {
  const rows = await query<ScraperJobRow>(
    `SELECT * FROM tenant_main.member_scraper_jobs WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createScraperJob(data: {
  account_id: string; guild_id: string; guild_name?: string | null; interval_minutes?: number;
}): Promise<ScraperJobRow> {
  const rows = await query<ScraperJobRow>(
    `INSERT INTO tenant_main.member_scraper_jobs (account_id, guild_id, guild_name, interval_minutes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.account_id, data.guild_id, data.guild_name ?? null, data.interval_minutes ?? 60],
  );
  return rows[0]!;
}

export async function updateScraperJob(id: string, patch: Partial<Pick<ScraperJobRow,
  'status' | 'interval_minutes' | 'guild_name' | 'last_scraped_at' | 'next_scrape_at' |
  'members_new' | 'members_total' | 'error_message'
>>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return;
  await query(`UPDATE tenant_main.member_scraper_jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function deleteScraperJob(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.member_scraper_jobs WHERE id = $1`, [id]);
}

export async function listDueScraperJobs(): Promise<ScraperJobRow[]> {
  return query<ScraperJobRow>(
    `SELECT * FROM tenant_main.member_scraper_jobs
      WHERE status = 'running'
        AND (next_scrape_at IS NULL OR next_scrape_at <= now())
      ORDER BY next_scrape_at ASC NULLS FIRST`,
  );
}

/** All account IDs that have at least one active (non-paused/non-error) scraper job.
 *  These accounts are reserved as decoys and must not be used by campaign engines. */
export async function getScraperAccountIds(): Promise<Set<string>> {
  const rows = await query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM tenant_main.member_scraper_jobs WHERE status IN ('running','idle')`,
  );
  return new Set(rows.map((r) => String(r.account_id)));
}

export async function upsertScrapedMembers(members: Array<{
  job_id: string; guild_id: string; guild_name: string | null;
  discord_user_id: string; username: string;
  global_name: string | null; avatar_url: string | null;
}>): Promise<number> {
  if (members.length === 0) return 0;
  // Chunked multi-row insert (500 rows × 7 params = 3500 params/statement).
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < members.length; i += CHUNK) {
    const slice = members.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    slice.forEach((m, idx) => {
      const b = idx * 7;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(m.job_id, m.guild_id, m.guild_name, m.discord_user_id, m.username, m.global_name, m.avatar_url);
    });
    const rows = await query<{ discord_user_id: string }>(
      `INSERT INTO tenant_main.scraped_members (job_id, guild_id, guild_name, discord_user_id, username, global_name, avatar_url)
       VALUES ${values.join(",")}
       ON CONFLICT (discord_user_id) DO NOTHING
       RETURNING discord_user_id`,
      params,
    );
    inserted += rows.length;
  }
  return inserted;
}

export async function listScrapedMembers(opts: {
  job_id?: string; guild_id?: string; fr_status?: string; limit?: number; offset?: number;
}): Promise<ScrapedMemberRow[]> {
  const conditions: string[] = [];
  const vals: any[] = [];
  if (opts.guild_id) { vals.push(opts.guild_id); conditions.push(`guild_id = $${vals.length}`); }
  else if (opts.job_id) { vals.push(opts.job_id); conditions.push(`job_id = $${vals.length}`); }
  if (opts.fr_status) { vals.push(opts.fr_status); conditions.push(`fr_status = $${vals.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  vals.push(opts.limit ?? 200);
  vals.push(opts.offset ?? 0);
  return query<ScrapedMemberRow>(
    `SELECT * FROM tenant_main.scraped_members ${where} ORDER BY LOWER(username) ASC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals,
  );
}

export async function exportScrapedMembers(opts: {
  ids?: number[]; job_id?: string; guild_id?: string; fr_status?: string;
}): Promise<ScrapedMemberRow[]> {
  const conditions: string[] = [];
  const vals: any[] = [];
  if (opts.ids && opts.ids.length > 0) {
    vals.push(opts.ids);
    conditions.push(`id = ANY($${vals.length}::bigint[])`);
  }
  if (opts.guild_id) { vals.push(opts.guild_id); conditions.push(`guild_id = $${vals.length}`); }
  else if (opts.job_id) { vals.push(opts.job_id); conditions.push(`job_id = $${vals.length}`); }
  if (opts.fr_status) { vals.push(opts.fr_status); conditions.push(`fr_status = $${vals.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query<ScrapedMemberRow>(
    `SELECT * FROM tenant_main.scraped_members ${where} ORDER BY LOWER(username) ASC`,
    vals,
  );
}

export async function countScrapedMembersByStatus(guild_id?: string): Promise<Record<string, number>> {
  const vals: any[] = [];
  const where = guild_id ? (vals.push(guild_id), `WHERE guild_id = $1`) : '';
  const rows = await query<{ fr_status: string; n: string }>(
    `SELECT fr_status, COUNT(*) AS n FROM tenant_main.scraped_members ${where} GROUP BY fr_status`,
    vals,
  );
  const out: Record<string, number> = { pending: 0, fr_queued: 0, fr_sent: 0 };
  for (const r of rows) out[r.fr_status] = Number(r.n);
  return out;
}

export async function listScrapedMemberGuilds(): Promise<Array<{ guild_id: string; guild_name: string | null; total: number; pending: number }>> {
  const rows = await query<{ guild_id: string; guild_name: string | null; total: string; pending: string }>(
    `SELECT guild_id, MAX(guild_name) AS guild_name,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE fr_status = 'pending') AS pending
       FROM tenant_main.scraped_members
      WHERE guild_id IS NOT NULL
      GROUP BY guild_id
      ORDER BY MAX(guild_name) ASC NULLS LAST`,
  );
  return rows.map((r) => ({
    guild_id: r.guild_id,
    guild_name: r.guild_name,
    total: Number(r.total),
    pending: Number(r.pending),
  }));
}

export async function pushMembersToFrCampaign(opts: {
  campaign_id: string; job_id?: string; guild_id?: string; limit: number;
}): Promise<number> {
  // SELECT uses its own param list — no stray $1 from campaign_id
  const selectVals: any[] = [];
  const conditions: string[] = [`fr_status = 'pending'`];
  if (opts.guild_id) {
    selectVals.push(opts.guild_id);
    conditions.push(`guild_id = $${selectVals.length}`);
  } else if (opts.job_id) {
    selectVals.push(opts.job_id);
    conditions.push(`job_id = $${selectVals.length}`);
  }
  selectVals.push(opts.limit);

  const members = await query<{ id: number; discord_user_id: string; username: string; global_name: string | null }>(
    `SELECT id, discord_user_id, username, global_name FROM tenant_main.scraped_members
      WHERE ${conditions.join(' AND ')}
      ORDER BY first_seen_at ASC LIMIT $${selectVals.length}`,
    selectVals,
  );
  if (members.length === 0) return 0;

  const ids = members.map((m) => Number(m.id));
  await query(
    `UPDATE tenant_main.scraped_members SET fr_status = 'fr_queued'
      WHERE id = ANY($1::bigint[])`,
    [ids],
  );

  // Chunked multi-row insert instead of one INSERT per member.
  const CHUNK = 500;
  for (let i = 0; i < members.length; i += CHUNK) {
    const slice = members.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    slice.forEach((m, idx) => {
      const b = idx * 4;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      params.push(opts.campaign_id, m.discord_user_id, m.global_name || m.username, m.username);
    });
    await query(
      `INSERT INTO tenant_main.fr_campaign_leads (campaign_id, discord_user_id, display_name, username)
       VALUES ${values.join(",")}
       ON CONFLICT (campaign_id, discord_user_id) DO NOTHING`,
      params,
    );
  }
  return members.length;
}

// ───── Account activity log ───────────────────────────────────────────────────
// Thresholds for rest recommendation (24-hour window):
//   fr_sent   >= 6   → rest_recommended
//   dm_sent   >= 5   → rest_recommended
//   warmup_sent >= 15 → rest_recommended

export interface ActivityLogRow {
  id: string;
  account_id: string;
  action: string;
  detail: Record<string, any>;
  ts: string;
}

export interface AccountHealthRow {
  id: string;
  username: string;
  label: string | null;
  status: string;
  warmup_status: string | null;
  avatar_url: string | null;
  fr_sent_24h: number;
  dm_sent_24h: number;
  warmup_sent_24h: number;
  scrape_sessions_24h: number;
  last_4004_at: string | null;
  last_event_at: string | null;
  rest_recommended: boolean;
  recent_events: ActivityLogRow[];
}

export async function logActivity(
  accountId: string,
  action: string,
  detail: Record<string, any> = {},
): Promise<void> {
  query(
    `INSERT INTO tenant_main.account_activity_log (account_id, action, detail) VALUES ($1, $2, $3)`,
    [accountId, action, JSON.stringify(detail)],
  ).catch((err) => console.warn(`[db] logActivity failed account=${accountId} action=${action}: ${err?.message || err}`));
}

// ───── Server Join Campaigns ─────────────────────────────────────────────────

export interface JoinCampaignRow {
  id: string;
  guild_id: string;
  guild_name: string | null;
  guild_icon: string | null;
  invite_codes: string[];
  joins_per_day: number;
  min_account_age_days: number;
  post_join_action: 'browse' | 'outreach' | 'none';
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface JoinQueueRow {
  id: number;
  campaign_id: string;
  account_id: string;
  invite_code: string;
  scheduled_at: string;
  status: 'pending' | 'joining' | 'joined' | 'failed' | 'skipped';
  attempt_count: number;
  joined_at: string | null;
  error: string | null;
  created_at: string;
  username?: string;
  label?: string | null;
  avatar_url?: string | null;
}

export function discordAccountAgeDays(discordUserId: string | null | undefined): number | null {
  if (!discordUserId) return null;
  try {
    const EPOCH = 1420070400000n;
    const ms = (BigInt(discordUserId) >> 22n) + EPOCH;
    return (Date.now() - Number(ms)) / 86_400_000;
  } catch { return null; }
}

export async function createJoinCampaign(data: {
  guild_id: string; guild_name?: string | null; guild_icon?: string | null;
  invite_codes: string[]; joins_per_day?: number; min_account_age_days?: number;
  post_join_action?: string;
}): Promise<JoinCampaignRow> {
  const rows = await query<JoinCampaignRow>(
    `INSERT INTO tenant_main.server_join_campaigns
       (guild_id, guild_name, guild_icon, invite_codes, joins_per_day, min_account_age_days, post_join_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.guild_id, data.guild_name ?? null, data.guild_icon ?? null, data.invite_codes,
     data.joins_per_day ?? 10, data.min_account_age_days ?? 0, data.post_join_action ?? 'browse'],
  );
  return rows[0]!;
}

export async function listJoinCampaigns(): Promise<Array<JoinCampaignRow & { total: number; joined: number; failed: number; pending: number; skipped: number }>> {
  const campaigns = await query<JoinCampaignRow>(`SELECT * FROM tenant_main.server_join_campaigns ORDER BY created_at DESC`);
  if (!campaigns.length) return [];
  const counts = await query<{ campaign_id: string; status: string; n: string }>(
    `SELECT campaign_id, status, COUNT(*) AS n FROM tenant_main.server_join_queue GROUP BY campaign_id, status`,
  );
  const map = new Map<string, Record<string, number>>();
  for (const r of counts) {
    const m = map.get(r.campaign_id) ?? {};
    m[r.status] = Number(r.n);
    map.set(r.campaign_id, m);
  }
  return campaigns.map((c) => {
    const m = map.get(c.id) ?? {};
    const total = Object.values(m).reduce((s, v) => s + v, 0);
    return { ...c, total, joined: m.joined ?? 0, failed: m.failed ?? 0, pending: m.pending ?? 0, skipped: m.skipped ?? 0 };
  });
}

export async function getJoinCampaign(id: string): Promise<JoinCampaignRow | null> {
  const rows = await query<JoinCampaignRow>(`SELECT * FROM tenant_main.server_join_campaigns WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function updateJoinCampaign(id: string, patch: Partial<Pick<JoinCampaignRow, 'status' | 'joins_per_day' | 'invite_codes'>>): Promise<void> {
  const sets: string[] = []; const vals: any[] = [id];
  if (patch.status !== undefined) { vals.push(patch.status); sets.push(`status=$${vals.length}`); }
  if (patch.joins_per_day !== undefined) { vals.push(patch.joins_per_day); sets.push(`joins_per_day=$${vals.length}`); }
  if (patch.invite_codes !== undefined) { vals.push(patch.invite_codes); sets.push(`invite_codes=$${vals.length}`); }
  if (!sets.length) return;
  await query(`UPDATE tenant_main.server_join_campaigns SET ${sets.join(',')} WHERE id=$1`, vals);
}

export async function deleteJoinCampaign(id: string): Promise<void> {
  await query(`DELETE FROM tenant_main.server_join_campaigns WHERE id=$1`, [id]);
}

function generateJoinSchedule(count: number, joinsPerDay: number, firstMs: number): Date[] {
  const WIN_START_H = 8; const WIN_END_H = 22;
  const MIN_GAP_MS = 3 * 60_000;
  const times: Date[] = [];
  let dayOffset = 0; let scheduled = 0;
  while (scheduled < count) {
    const winStart = new Date(firstMs);
    winStart.setUTCDate(winStart.getUTCDate() + dayOffset);
    winStart.setUTCHours(WIN_START_H, 0, 0, 0);
    const winEnd = new Date(winStart); winEnd.setUTCHours(WIN_END_H, 0, 0, 0);
    // On the first day, don't go earlier than firstMs; if already past window end, skip to next day.
    const anchor = dayOffset === 0 ? Math.max(firstMs, winStart.getTime()) : winStart.getTime();
    if (anchor >= winEnd.getTime()) { dayOffset++; continue; }
    const remainMs = winEnd.getTime() - anchor;
    const todayCount = Math.min(joinsPerDay, count - scheduled);
    const slotMs = Math.max(MIN_GAP_MS + 30_000, Math.floor(remainMs / todayCount));
    let lastOff = 0;
    for (let i = 0; i < todayCount; i++) {
      const base = i === 0 ? 0 : lastOff + slotMs;
      const jitter = Math.floor(Math.random() * Math.min(slotMs * 0.45, 5 * 60_000));
      const off = Math.min(base + jitter, remainMs - 60_000);
      times.push(new Date(anchor + off));
      lastOff = off;
    }
    scheduled += todayCount; dayOffset++;
  }
  return times;
}

export async function populateJoinQueue(campaignId: string, opts: {
  accountIds: string[]; inviteCodes: string[]; joinsPerDay: number; startDelayMinutes?: number;
}): Promise<number> {
  const { accountIds, inviteCodes, joinsPerDay } = opts;
  if (!accountIds.length || !inviteCodes.length) return 0;
  const times = generateJoinSchedule(accountIds.length, joinsPerDay, Date.now() + (opts.startDelayMinutes ?? 5) * 60_000);
  const CHUNK = 500; let inserted = 0;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const slice = accountIds.slice(i, i + CHUNK);
    const timeSlice = times.slice(i, i + CHUNK);
    const vals: string[] = []; const params: any[] = [];
    slice.forEach((accountId, idx) => {
      const b = idx * 4;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4})`);
      params.push(campaignId, accountId, inviteCodes[(i + idx) % inviteCodes.length], timeSlice[idx].toISOString());
    });
    const r = await query<{ id: number }>(
      `INSERT INTO tenant_main.server_join_queue (campaign_id, account_id, invite_code, scheduled_at)
       VALUES ${vals.join(',')} ON CONFLICT (campaign_id, account_id) DO NOTHING RETURNING id`,
      params,
    );
    inserted += r.length;
  }
  return inserted;
}

export async function getNextDueJoin(): Promise<(JoinQueueRow & { guild_id: string; guild_name: string | null; post_join_action: string; campaign_status: string }) | null> {
  const rows = await query<any>(
    `SELECT q.*, c.guild_id, c.guild_name, c.post_join_action, c.status AS campaign_status
       FROM tenant_main.server_join_queue q
       JOIN tenant_main.server_join_campaigns c ON c.id = q.campaign_id
      WHERE q.status = 'pending' AND q.scheduled_at <= now() AND c.status = 'active'
      ORDER BY q.scheduled_at ASC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function updateJoinQueueRow(id: number, patch: Partial<Pick<JoinQueueRow, 'status' | 'attempt_count' | 'joined_at' | 'error' | 'scheduled_at'>>): Promise<void> {
  const sets: string[] = []; const vals: any[] = [id];
  for (const [k, v] of Object.entries(patch) as [string, any][]) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  if (!sets.length) return;
  await query(`UPDATE tenant_main.server_join_queue SET ${sets.join(',')} WHERE id=$1`, vals);
}

export async function getJoinQueueForCampaign(campaignId: string): Promise<JoinQueueRow[]> {
  return query<JoinQueueRow>(
    `SELECT q.id, q.campaign_id, q.account_id, q.invite_code, q.scheduled_at, q.status,
            q.attempt_count, q.joined_at, q.error, q.created_at,
            a.username, a.label, a.avatar_url
       FROM tenant_main.server_join_queue q
       LEFT JOIN tenant_main.discord_accounts a ON a.id = q.account_id
      WHERE q.campaign_id=$1 ORDER BY q.scheduled_at ASC`,
    [campaignId],
  );
}

export async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const r = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tenant_main.server_join_queue WHERE campaign_id=$1 AND status='pending'`,
    [campaignId],
  );
  if (Number(r[0]?.n) === 0) {
    await query(`UPDATE tenant_main.server_join_campaigns SET status='completed' WHERE id=$1 AND status='active'`, [campaignId]);
  }
}

export async function getAccountGuildMembership(guildId: string): Promise<string[]> {
  // Returns account IDs that are already in the given guild (from activity log or join queue).
  const rows = await query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM tenant_main.server_join_queue
      WHERE campaign_id IN (SELECT id FROM tenant_main.server_join_campaigns WHERE guild_id=$1)
        AND status='joined'`,
    [guildId],
  );
  return rows.map((r) => r.account_id);
}

export async function getAccountsNotInCampaign(campaignId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM tenant_main.discord_accounts
      WHERE id NOT IN (
        SELECT account_id FROM tenant_main.server_join_queue WHERE campaign_id=$1
      )`,
    [campaignId],
  );
  return rows.map((r) => r.id);
}

export async function addToCampaignQueue(campaignId: string, opts: {
  accountIds: string[]; inviteCodes: string[]; joinsPerDay: number;
}): Promise<number> {
  const { accountIds, inviteCodes, joinsPerDay } = opts;
  if (!accountIds.length || !inviteCodes.length) return 0;
  // Find the latest scheduled_at in this campaign so we append after it
  const latest = await query<{ max_scheduled: string | null }>(
    `SELECT MAX(scheduled_at) AS max_scheduled FROM tenant_main.server_join_queue WHERE campaign_id=$1 AND status='pending'`,
    [campaignId],
  );
  const lastMs = latest[0]?.max_scheduled ? new Date(latest[0].max_scheduled).getTime() : Date.now();
  const startMs = Math.max(lastMs + 60_000, Date.now() + 5 * 60_000);
  const times = generateJoinSchedule(accountIds.length, joinsPerDay, startMs);
  const CHUNK = 500; let inserted = 0;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const slice = accountIds.slice(i, i + CHUNK);
    const timeSlice = times.slice(i, i + CHUNK);
    const vals: string[] = []; const params: any[] = [];
    slice.forEach((accountId, idx) => {
      const b = idx * 4;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4})`);
      params.push(campaignId, accountId, inviteCodes[(i + idx) % inviteCodes.length], timeSlice[idx].toISOString());
    });
    const r = await query<{ id: number }>(
      `INSERT INTO tenant_main.server_join_queue (campaign_id, account_id, invite_code, scheduled_at)
       VALUES ${vals.join(',')} ON CONFLICT (campaign_id, account_id) DO NOTHING RETURNING id`,
      params,
    );
    inserted += r.length;
  }
  return inserted;
}

export async function getAccountHealthSummary(): Promise<AccountHealthRow[]> {
  const [accounts, counts, recentEvents] = await Promise.all([
    query<any>(
      `SELECT id, label, username, avatar_url, status, warmup_status
         FROM tenant_main.discord_accounts
        ORDER BY COALESCE(label, username) ASC`,
    ),
    query<any>(
      `SELECT account_id,
              COUNT(*) FILTER (WHERE action = 'fr_sent')        AS fr_sent_24h,
              COUNT(*) FILTER (WHERE action = 'dm_sent')        AS dm_sent_24h,
              COUNT(*) FILTER (WHERE action = 'warmup_sent')    AS warmup_sent_24h,
              COUNT(*) FILTER (WHERE action = 'scrape_session') AS scrape_sessions_24h,
              MAX(ts)  FILTER (WHERE action = 'gateway_4004')   AS last_4004_at,
              MAX(ts)                                            AS last_event_at
         FROM tenant_main.account_activity_log
        WHERE ts > now() - INTERVAL '24 hours'
        GROUP BY account_id`,
    ),
    query<any>(
      `SELECT id, account_id, action, detail, ts
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY ts DESC) AS rn
             FROM tenant_main.account_activity_log
            WHERE ts > now() - INTERVAL '7 days'
         ) sub
        WHERE rn <= 30
        ORDER BY account_id, ts DESC`,
    ),
  ]);

  const countMap = new Map<string, any>(counts.map((r: any) => [r.account_id, r]));
  const eventsMap = new Map<string, ActivityLogRow[]>();
  for (const ev of recentEvents) {
    const list = eventsMap.get(ev.account_id) || [];
    list.push({
      id: String(ev.id),
      account_id: ev.account_id,
      action: ev.action,
      detail: (typeof ev.detail === "object" && ev.detail !== null) ? ev.detail : {},
      ts: ev.ts instanceof Date ? ev.ts.toISOString() : String(ev.ts),
    });
    eventsMap.set(ev.account_id, list);
  }

  return accounts.map((a: any) => {
    const c = countMap.get(a.id) || {};
    const fr = Number(c.fr_sent_24h) || 0;
    const dm = Number(c.dm_sent_24h) || 0;
    const wu = Number(c.warmup_sent_24h) || 0;
    return {
      id: a.id,
      username: a.username,
      label: a.label || null,
      status: a.status,
      warmup_status: a.warmup_status || null,
      avatar_url: a.avatar_url || null,
      fr_sent_24h: fr,
      dm_sent_24h: dm,
      warmup_sent_24h: wu,
      scrape_sessions_24h: Number(c.scrape_sessions_24h) || 0,
      last_4004_at: c.last_4004_at ? (c.last_4004_at instanceof Date ? c.last_4004_at.toISOString() : String(c.last_4004_at)) : null,
      last_event_at: c.last_event_at ? (c.last_event_at instanceof Date ? c.last_event_at.toISOString() : String(c.last_event_at)) : null,
      rest_recommended: fr >= 6 || dm >= 5 || wu >= 15,
      recent_events: eventsMap.get(a.id) || [],
    };
  });
}
