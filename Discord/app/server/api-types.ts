// Shared API contract between the React frontend and the demo-mode backend.
// Edit here first — server + UI both import from this file.

// "token_revoked" (v0.36): Discord forced re-auth on this account — typically
// gateway close code 4004. The account exists but its captured token is dead
// until the operator re-imports a fresh one. Treated as terminal until that
// re-onboard (no automatic reconnect attempts, suspended from all campaigns).
export type AccountStatus = "connected" | "connecting" | "captcha" | "disconnected" | "banned" | "token_revoked";

export interface DiscordAccount {
  id: string;
  label: string;
  username: string;
  avatarUrl: string | null;
  status: AccountStatus;
  lastStatusAt: string;
  friendsCount: number;
  pendingOutgoing: number;
  // Account warmup lifecycle state (captured/warming/warmed/outreach/quarantined/retired).
  // Optional because not every code path that builds a DiscordAccount knows it;
  // loadAllAccounts() populates it so the campaign engines can gate sends.
  warmupStatus?: string;
}

// Lead status as of v0.32. The old "FR" framing is gone — every lead in this
// product follows the same wave-prep → auto-send pathway.
export type LeadStatus =
  | "pending"  // not yet touched
  | "waving"   // operator has prepared a DM channel, manually waving in Discord client
  | "sent"     // engine sent the outreach DM through the warm channel
  | "replied"  // inbound message detected — operator owes a reply
  | "failed";  // any error along the way (captcha-paused, account banned, etc.)

export type LeadDmStatus = "none" | "sent" | "replied" | "archived";

export interface Lead {
  id: string;
  campaignId: string;
  discordUserId: string;
  displayName: string | null;
  status: LeadStatus;
  source: string;
  assignedAccountId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export type CampaignStatus = "draft" | "waving" | "running" | "paused" | "finished";

export interface Campaign {
  id: string;
  name: string;
  accountIds: string[];
  /** v0.11+: list of message variants. Engine picks one at random per send. */
  templates: string[];
  /** @deprecated kept for backward compat. New code reads `templates`. */
  template?: string;
  rateLimit: { perHour: number; perDay: number };
  /** v0.13.2+: global cooldown between any two sends across all accounts. */
  minInterSendSeconds?: number;
  status: CampaignStatus;
  /** @deprecated The DB column still exists for back-compat but UI/engine ignore it. */
  mode?: "fr" | "dm" | "both";
  createdAt: string;
  totals: { queued: number; sent: number; replied: number; failed: number };
}

export interface CampaignWithLeads extends Campaign {
  leads: Lead[];
}

export interface NewCampaignRequest {
  name: string;
  accountIds: string[];
  leads: { discordUserId: string; displayName?: string }[];
  /** v0.11+: template variants. Pass a single-element array to mimic the old behavior. */
  templates: string[];
  /** @deprecated kept for back-compat; ignored if templates is provided. */
  template?: string;
  rateLimit: { perHour: number; perDay: number };
  /** v0.13.2+: optional inter-send cooldown override (seconds). Defaults: 1800 (dm), 600 (fr). */
  minInterSendSeconds?: number;
}

export interface Conversation {
  id: string;
  accountId: string;
  leadId: string;
  peer: {
    discordUserId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  label: "inbox" | "archived";
  // v0.10.4 — derived counts surfaced for the reply-status filter on the Unibox.
  inboundCount?: number;
  outboundCount?: number;
  // v0.12.2 — direction of the most recent message ('in' = they wrote last, 'out' = we did).
  lastMessageDirection?: "in" | "out" | null;
  interested: boolean; // v0.32 — operator-set star flag
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  body: string;
  sentAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
}

export interface QrUserPreview {
  id: string;
  username: string;
  discriminator: string | null;
  avatarHash: string | null;
}

// Realtime events delivered over Server-Sent Events at GET /api/realtime
export type RealtimeEvent =
  | { type: "dm_sent"; campaignId: string; leadId: string; accountId?: string; ts: string }
  | { type: "dm_replied"; campaignId: string; leadId: string; conversationId: string; ts: string }
  | { type: "dm_failed"; campaignId: string; leadId: string; accountId?: string; ts: string }
  | { type: "dm_sending"; campaignId: string; leadId: string; accountId: string; ts: string }
  | { type: "campaign_waiting"; campaignId: string; nextSendAt: string | null; accountsInCooldown: number; accountsReady: number; ts: string }
  | { type: "message_in"; conversationId: string; message: Message; ts: string }
  | { type: "message_out"; conversationId: string; message: Message; ts: string }
  | { type: "conversation_removed"; conversationId: string; ts: string }
  | { type: "conversation_created"; conversationId: string; conversation: Conversation; ts: string }
  | { type: "conversation_updated"; conversationId: string; conversation: Conversation; ts: string }
  | { type: "account_status"; accountId: string; status: AccountStatus; ts: string }
  | { type: "campaign_finished"; campaignId: string; ts: string }
  | { type: "campaign_paused"; campaignId: string; reason?: string; ts: string }
  | { type: "captcha_required"; accountId: string; campaignId?: string; vncUrl: string; ts: string }
  | { type: "captcha_solved"; accountId: string; campaignId?: string; ts: string }
  // QR-login lifecycle events (Discord remote-auth protocol)
  | { type: "qr_ready"; sessionId: string; qrUrl: string; ts: string }
  | { type: "qr_user_seen"; sessionId: string; user: QrUserPreview; ts: string }
  | { type: "qr_authorizing"; sessionId: string; user: QrUserPreview; ts: string }
  | { type: "qr_captcha_required"; sessionId: string; user: QrUserPreview; sitekey: string; rqdata: string; service: string; ts: string }
  | { type: "qr_authorized"; sessionId: string; user: QrUserPreview; accountId: string; ts: string }
  | { type: "qr_failed"; sessionId: string; reason: string; ts: string }
  | { type: "qr_cancelled"; sessionId: string; ts: string };

// HTTP endpoint reference (informational — server defines these in routes):
//   GET    /api/accounts                            -> DiscordAccount[]
//   POST   /api/accounts                            -> DiscordAccount             (body: { label, username? })
//   POST   /api/accounts/:id/disconnect             -> DiscordAccount
//   DELETE /api/accounts/:id                        -> { ok: true }
//
//   GET    /api/campaigns                           -> Campaign[]
//   GET    /api/campaigns/:id                       -> CampaignWithLeads
//   POST   /api/campaigns                           -> Campaign                   (body: NewCampaignRequest, status=draft)
//   POST   /api/campaigns/:id/start                 -> Campaign
//   POST   /api/campaigns/:id/pause                 -> Campaign
//
//   GET    /api/unibox/conversations                -> Conversation[]
//   GET    /api/unibox/conversations/:id            -> Conversation
//   GET    /api/unibox/conversations/:id/messages   -> Message[]
//   POST   /api/unibox/conversations/:id/send       -> Message                    (body: { body: string })
//   POST   /api/unibox/conversations/:id/archive    -> Conversation
//
//   GET    /api/realtime                            -> text/event-stream (SSE)
//   GET    /api/demo/state                          -> { mode: "demo" | "live", seededAt: string }
//   POST   /api/demo/reset                          -> { ok: true }               (re-seeds demo data)

export const DEMO_PERSONA = {
  // Operator persona used in seed data so the demo immediately makes sense.
  agencyName: "Pixel & Mortar Studio",
  operatorTagline: "Boutique web design for indie SaaS founders",
  outreachTemplate:
    "Hey {{firstName}} — saw you're building {{project}}. I run a small web design studio that's helped a few founders nail their launch site lately. Mind if I send over a couple of examples?",
};

// ───── Account Groups (browser-extension multi-account) ──────────────────────
// An AccountGroup is a manual operator-defined bundle of captured accounts.
// The GG browser extension fetches a group as a token bundle and renders
// "Activate" buttons for each member. There is NO Discord-imposed limit on
// group size — we let the operator pick — though ~5-10 keeps the row visually
// scannable.
export interface AccountGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface AccountGroupMember {
  accountId: string;
  position: number;
  addedAt: string;
}

export interface AccountGroupWithMembers extends AccountGroup {
  members: AccountGroupMember[];
}

// Returned by GET /api/groups/:id/token-bundle. The extension holds this in
// service-worker memory only and writes one token at a time to
// localStorage.token on discord.com. Tokens are full master credentials —
// never log this payload.
export interface AccountTokenEntry {
  accountId: string;
  username: string;
  label: string;
  token: string;
  // Optional proxy URL the extension should route this account's discord.com
  // traffic through. Absent if no proxy is assigned (operator's home IP is used).
  proxyUrl?: string;
  // v0.68 — pending lead Discord user IDs this account still needs to wave.
  // The extension uses this to batch-create all empty DMs in one shot when
  // the operator clicks Open in Discord on any one of them.
  pendingRecipientIds?: string[];
}

export interface GroupTokenBundle {
  groupId: string;
  groupName: string;
  fetchedAt: string;
  entries: AccountTokenEntry[];
}

// ───── Proxies (per-account browser routing) ────────────────────────────────
export interface Proxy {
  id: string;
  label: string;
  url: string;
  geo: string;
  createdAt: string;
}

export interface AccountProxy {
  accountId: string;
  proxyId: string;
  assignedAt: string;
}
