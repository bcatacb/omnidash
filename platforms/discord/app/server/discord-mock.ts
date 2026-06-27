/**
 * Discord Mock — single-module in-memory state + simulator.
 *
 * TODO(live-bridge): swap this module for calls to bridge-stack/orchestrator
 * HTTP API. Same exported surface (state, seed, createCampaign, startCampaign,
 * pauseCampaign, sendMessage, subscribe). The simulator inside simulateCampaign
 * is the only thing that becomes "real" — everything else is a wrapper.
 *
 * Demo mode is the ONLY mode right now. There is no Postgres. State is pure
 * module-level mutable objects so we can reset / re-seed easily. Frontend
 * agents (F/G/H) drive their UIs against this until the bridge ships.
 */

import crypto from 'crypto';
import {
  DiscordAccount,
  Lead,
  Campaign,
  CampaignWithLeads,
  Conversation,
  Message,
  NewCampaignRequest,
  RealtimeEvent,
} from './api-types';

// ---- Deterministic RNG so the demo flow is reproducible across restarts ----
// xorshift32 seeded by a constant. Resets every seed() call.
let rngSeed = 0x9e3779b1 >>> 0;
const resetRng = () => { rngSeed = 0x9e3779b1 >>> 0; };
const rand = (): number => {
  let x = rngSeed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngSeed = x >>> 0;
  return (rngSeed & 0xffffffff) / 0x100000000;
};
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

// ---- ID helpers ----
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(++idCounter).toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const nowIso = () => new Date().toISOString();

// ---- Mutable state container ----
export interface MockState {
  accounts: DiscordAccount[];
  leads: Lead[];
  campaigns: Campaign[];
  campaignLeadIds: Map<string, string[]>; // campaignId -> ordered leadIds
  conversations: Conversation[];
  messages: Map<string, Message[]>; // conversationId -> ordered msgs
  seededAt: string;
}

export const state: MockState = {
  accounts: [],
  leads: [],
  campaigns: [],
  campaignLeadIds: new Map(),
  conversations: [],
  messages: new Map(),
  seededAt: '',
};

// ---- Event emitter (tiny hand-rolled, no extra deps) ----
type Listener = (event: RealtimeEvent) => void;
const listeners = new Set<Listener>();
export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const emit = (event: RealtimeEvent) => {
  for (const l of listeners) {
    try { l(event); } catch (err) { console.error('[demo] listener error', err); }
  }
};

// ---- Lead opening-message bank (agency outreach replies) ----
const LEAD_OPENERS = [
  "Hey, saw your message — what's your portfolio look like?",
  "Interested. What's your typical timeline + pricing?",
  "Sure, what do you have in mind?",
  "Hey 👋 — got a sec? Curious what kind of sites you've done lately.",
  "Yeah I'm open to a chat. Do you have a couple examples?",
  "What's the typical turnaround on a launch site?",
  "Send me a few examples and we can go from there.",
  "Cool, what does your process look like end to end?",
];

const LEAD_FOLLOWUPS = [
  "btw what's the rough price range for something like that?",
  "ok cool — and you handle copy too or just design?",
  "Got it, will check those out.",
  "How soon could you start on something?",
  "Are you taking on new clients this month?",
];

// ---- Plausible lead display names + discord IDs for seeding ----
const LEAD_NAME_BANK = [
  'mike.builds', 'sarah_codes', 'jen.makes.stuff', 'devon_t', 'priya.designs',
  'alex.k', 'ravi_ops', 'lena.ux', 'mark__solo', 'taylor.ships',
  'sam.bootstraps', 'kai.indie', 'noor.founders', 'chris_saas', 'becca.dev',
  'omar.builds', 'lia.codes', 'tomas.k', 'maya_ux', 'finn.indie',
];

// ---- Seeded conversation transcripts (~6 msgs each, agency-pitch dialogue) ----
const SEEDED_CONVS: Array<{
  peerName: string;
  peerDiscordId: string;
  messages: Array<{ direction: 'in' | 'out'; body: string; minutesAgo: number }>;
}> = [
  {
    peerName: 'mike.builds',
    peerDiscordId: '188271093344559104',
    messages: [
      { direction: 'out', body: "Hey Mike — saw you're shipping ledgerfox.io. I run a small web design studio that's helped a few founders nail their launch site lately. Mind if I send over a couple examples?", minutesAgo: 95 },
      { direction: 'in',  body: "Hey, saw your message — what's your portfolio look like?", minutesAgo: 92 },
      { direction: 'out', body: "Yeah of course — pixelandmortar.studio/work has a bunch. Closest match is probably the Folio Labs site we did last month.", minutesAgo: 90 },
      { direction: 'in',  body: "That folio one is sharp. What's the typical timeline + ballpark cost?", minutesAgo: 73 },
      { direction: 'out', body: "Usually 3-4 weeks for a 5-page launch site. Pricing starts at $4.8k for that scope. Happy to jump on a 15 min call this week if you want to dig into your specifics.", minutesAgo: 70 },
      { direction: 'in',  body: "Cool — Thursday afternoon work?", minutesAgo: 12 },
    ],
  },
  {
    peerName: 'sarah_codes',
    peerDiscordId: '231554987612348001',
    messages: [
      { direction: 'out', body: "Hey Sarah — noticed you're getting close to launching Stackmend. I run a boutique web design studio focused on indie SaaS — mind if I send over a couple of examples?", minutesAgo: 240 },
      { direction: 'in',  body: "Sure, what do you have in mind?", minutesAgo: 235 },
      { direction: 'out', body: "Mostly launch sites that convert (not just look good). Recently did Folio Labs + Crater HQ. Both are in pixelandmortar.studio/work.", minutesAgo: 234 },
      { direction: 'in',  body: "Crater is exactly the vibe I want for ours actually.", minutesAgo: 180 },
      { direction: 'out', body: "Nice — that one took ~3 weeks. Want me to send a short proposal with two scope options?", minutesAgo: 178 },
      { direction: 'in',  body: "Yeah please do, my email is sarah@stackmend.io", minutesAgo: 30 },
    ],
  },
  {
    peerName: 'devon_t',
    peerDiscordId: '309887412233097221',
    messages: [
      { direction: 'out', body: "Hey Devon — saw you're working on Riverpen. I run a small design studio that helps indie SaaS founders ship launch sites that actually convert. Mind sharing a couple references?", minutesAgo: 1440 },
      { direction: 'in',  body: "Hey 👋 — got a sec? Curious what kind of sites you've done lately.", minutesAgo: 1435 },
      { direction: 'out', body: "Sure — recents are Folio Labs, Crater HQ, and Bytemark. pixelandmortar.studio/work has the full set.", minutesAgo: 1432 },
      { direction: 'in',  body: "Bytemark looks great. We're earlier stage though — what's the lowest-scope thing you'd take on?", minutesAgo: 1380 },
      { direction: 'out', body: "Smallest engagement is a 3-page MVP site, ~2 weeks, starts at $2.8k. Good for pre-launch where you need something credible without overbuilding.", minutesAgo: 1378 },
      { direction: 'in',  body: "Got it, will check those out.", minutesAgo: 60 },
    ],
  },
];

// ---- seed() ----
export const seed = () => {
  resetRng();
  idCounter = 0;
  state.accounts = [];
  state.leads = [];
  state.campaigns = [];
  state.campaignLeadIds = new Map();
  state.conversations = [];
  state.messages = new Map();
  state.seededAt = nowIso();

  // 3 accounts
  const acctSpecs: Array<{ username: string; label: string }> = [
    { username: 'agency_alex#0001',  label: 'Primary outreach' },
    { username: 'alex_freelance#4421', label: 'Freelance persona' },
    { username: 'design_lab#9912',     label: 'Studio account' },
  ];
  for (const spec of acctSpecs) {
    state.accounts.push({
      id: nextId('acct'),
      label: spec.label,
      username: spec.username,
      avatarUrl: null,
      status: 'connected',
      lastStatusAt: nowIso(),
      friendsCount: 0, // recalculated by index.ts when serving
      pendingOutgoing: 0,
    });
  }

  const primaryAccount = state.accounts[0];

  // 3 seeded conversations on the primary account
  for (const conv of SEEDED_CONVS) {
    const lead: Lead = {
      id: nextId('lead'),
      campaignId: '',
      discordUserId: conv.peerDiscordId,
      displayName: conv.peerName,
      status: 'replied',
      source: 'seed',
      assignedAccountId: primaryAccount.id,
      sentAt: null,
      createdAt: nowIso(),
    };
    state.leads.push(lead);

    const convId = nextId('conv');
    const msgs: Message[] = [];
    const lastSentAt = new Date();
    for (const m of conv.messages) {
      const sentAt = new Date(lastSentAt.getTime() - m.minutesAgo * 60_000).toISOString();
      msgs.push({
        id: nextId('msg'),
        conversationId: convId,
        direction: m.direction,
        body: m.body,
        sentAt,
        authorName: m.direction === 'out' ? primaryAccount.username : conv.peerName,
        authorAvatarUrl: null,
      });
    }
    msgs.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    state.messages.set(convId, msgs);

    const last = msgs[msgs.length - 1];
    state.conversations.push({
      id: convId,
      accountId: primaryAccount.id,
      leadId: lead.id,
      peer: {
        discordUserId: lead.discordUserId,
        displayName: lead.displayName ?? lead.discordUserId,
        avatarUrl: null,
      },
      lastMessagePreview: last.body.slice(0, 120),
      lastMessageAt: last.sentAt,
      unreadCount: last.direction === 'in' ? 1 : 0,
      label: 'inbox',
      interested: false,
    });
  }

  // One draft campaign — "Q2 — Web design leads" with 50 queued leads
  const draftLeads: Lead[] = [];
  for (let i = 0; i < 50; i++) {
    const baseName = LEAD_NAME_BANK[i % LEAD_NAME_BANK.length];
    const displayName = i < LEAD_NAME_BANK.length ? baseName : `${baseName}_${Math.floor(i / LEAD_NAME_BANK.length) + 1}`;
    const lead: Lead = {
      id: nextId('lead'),
      campaignId: '',
      discordUserId: String(100000000000000000n + BigInt(i * 7919 + 113)),
      displayName,
      status: 'pending',
      source: 'q2-web-design-prospects.csv',
      assignedAccountId: primaryAccount.id,
      sentAt: null,
      createdAt: nowIso(),
    };
    state.leads.push(lead);
    draftLeads.push(lead);
  }

  const draftCampaign: Campaign = {
    id: nextId('camp'),
    name: 'Q2 — Web design leads',
    accountIds: [primaryAccount.id],
    templates: [
      "Hey {{firstName}} — saw you're building {{project}}. I run a small web design studio that's helped a few founders nail their launch site lately. Mind if I send over a couple of examples?",
    ],
    rateLimit: { perHour: 5, perDay: 30 },
    status: 'draft',
    createdAt: nowIso(),
    totals: { queued: draftLeads.length, sent: 0, replied: 0, failed: 0 },
  };
  state.campaigns.push(draftCampaign);
  state.campaignLeadIds.set(draftCampaign.id, draftLeads.map((l) => l.id));

  console.log(`[demo] seeded ${state.accounts.length} accounts, ${state.conversations.length} convs, ${state.leads.length} leads, ${state.campaigns.length} campaign(s)`);
};

// ---- helpers ----
const getCampaign = (id: string) => state.campaigns.find((c) => c.id === id);
const recomputeAccountAggregates = () => {
  // helper for index.ts to call when serving GET /api/accounts
};
void recomputeAccountAggregates;

// ---- createCampaign ----
export const createCampaign = (req: NewCampaignRequest): Campaign => {
  const accountIds = (req.accountIds || []).filter((id: string) => state.accounts.some((a) => a.id === id));
  const finalAccountIds = accountIds.length > 0 ? accountIds : (state.accounts[0] ? [state.accounts[0].id] : []);
  const assignedAccountId = finalAccountIds[0] || null;

  const newLeads: Lead[] = [];
  for (const seed of req.leads || []) {
    const lead: Lead = {
      id: nextId('lead'),
      campaignId: '',
      discordUserId: String(seed.discordUserId || ''),
      displayName: String(seed.displayName || seed.discordUserId || 'unknown'),
      status: 'pending',
      source: 'campaign-import',
      assignedAccountId,
      sentAt: null,
      createdAt: nowIso(),
    };
    state.leads.push(lead);
    newLeads.push(lead);
  }

  const camp: Campaign = {
    id: nextId('camp'),
    name: String(req.name || 'Untitled campaign').slice(0, 200),
    accountIds: finalAccountIds,
    templates: Array.isArray((req as any).templates) && (req as any).templates.length
      ? (req as any).templates.map((t: any) => String(t || ''))
      : (req.template ? [String(req.template)] : []),
    rateLimit: {
      perHour: Math.max(1, Number(req?.rateLimit?.perHour) || 5),
      perDay: Math.max(1, Number(req?.rateLimit?.perDay) || 30),
    },
    status: 'draft',
    createdAt: nowIso(),
    totals: { queued: newLeads.length, sent: 0, replied: 0, failed: 0 },
  };
  state.campaigns.push(camp);
  state.campaignLeadIds.set(camp.id, newLeads.map((l) => l.id));
  console.log(`[demo] campaign created id=${camp.id} name="${camp.name}" leads=${newLeads.length} rateLimit=${camp.rateLimit.perHour}/hr`);
  return camp;
};

// ---- startCampaign / pauseCampaign ----
export const startCampaign = (id: string): Campaign | null => {
  const camp = getCampaign(id);
  if (!camp) return null;
  if (camp.status === 'running') return camp;
  camp.status = 'running';
  console.log(`[demo] campaign ${camp.id} started: ${camp.totals.queued - camp.totals.sent} leads queued at ${camp.rateLimit.perHour}/hr (compressed → ${camp.rateLimit.perHour}/min for demo)`);
  void simulateCampaign(camp.id);
  return camp;
};

export const pauseCampaign = (id: string): Campaign | null => {
  const camp = getCampaign(id);
  if (!camp) return null;
  if (camp.status === 'running') {
    camp.status = 'paused';
    console.log(`[demo] campaign ${camp.id} paused`);
  }
  return camp;
};

// ---- simulateCampaign ----
// Compress demo speed: divide perHour by 60 so "5/hr" becomes "5/min".
const simulateCampaign = async (campaignId: string): Promise<void> => {
  const camp = getCampaign(campaignId);
  if (!camp) return;
  const leadIds = state.campaignLeadIds.get(campaignId) || [];
  // Step interval (ms): one FR roughly every (60_000 / perHour) — i.e. perHour per minute.
  const stepIntervalMs = Math.max(2_000, Math.floor(60_000 / Math.max(1, camp.rateLimit.perHour)));

  for (const leadId of leadIds) {
    // Re-check status each iter so pause() takes effect.
    const stillRunning = state.campaigns.find((c) => c.id === campaignId);
    if (!stillRunning || stillRunning.status !== 'running') {
      console.log(`[demo] campaign ${campaignId} loop exited (status=${stillRunning?.status})`);
      return;
    }

    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead || lead.status !== 'pending') continue;

    // Small jitter 2-5s before fire so the operator sees motion.
    await sleep(randInt(2_000, 5_000));

    // 1) FR sent
    lead.status = 'sent';
    camp.totals.sent += 1;
    console.log(`[demo] dm_sent campaign=${camp.id} lead=${lead.id} (${lead.displayName})`);
    emit({ type: 'dm_sent', campaignId: camp.id, leadId: lead.id, ts: nowIso() });

    // 2) Resolution after 8-25s in background; do not await so we continue the rate-limit tick.
    scheduleResolution(camp.id, lead.id);

    // Wait the rest of the step interval.
    await sleep(Math.max(0, stepIntervalMs - 3_500));
  }

  // After loop, if all leads resolved, mark finished. We do this on a slight delay
  // so pending resolutions still fire their events first.
  setTimeout(() => {
    const c = getCampaign(campaignId);
    if (!c) return;
    const ids = state.campaignLeadIds.get(campaignId) || [];
    const unresolved = ids.some((lid) => {
      const l = state.leads.find((x) => x.id === lid);
      return l && (l.status === 'pending' || l.status === 'sent');
    });
    if (!unresolved && c.status === 'running') {
      c.status = 'finished';
      console.log(`[demo] campaign ${c.id} finished — sent=${c.totals.sent} replied=${c.totals.replied} failed=${c.totals.failed}`);
      emit({ type: 'campaign_finished', campaignId: c.id, ts: nowIso() });
    }
  }, 30_000);
};

const scheduleResolution = (campaignId: string, leadId: string) => {
  const delay = randInt(8_000, 25_000);
  setTimeout(() => {
    const camp = getCampaign(campaignId);
    const lead = state.leads.find((l) => l.id === leadId);
    if (!camp || !lead) return;
    if (camp.status === 'paused') return; // skip while paused
    if (lead.status !== 'sent') return;

    if (rand() < 0.7) {
      // Replied → create conversation + auto-incoming opener.
      lead.status = 'replied';
      camp.totals.replied += 1;
      const accountId = lead.assignedAccountId || camp.accountIds[0] || state.accounts[0]?.id;
      if (!accountId) return;
      const convId = nextId('conv');
      const opener = pick(LEAD_OPENERS);
      const inMsg: Message = {
        id: nextId('msg'),
        conversationId: convId,
        direction: 'in',
        body: opener,
        sentAt: nowIso(),
        authorName: lead.displayName || lead.discordUserId,
        authorAvatarUrl: null,
      };
      state.conversations.push({
        id: convId,
        accountId,
        leadId: lead.id,
        peer: {
          discordUserId: lead.discordUserId,
          displayName: lead.displayName || lead.discordUserId,
          avatarUrl: null,
        },
        lastMessagePreview: opener.slice(0, 120),
        lastMessageAt: inMsg.sentAt,
        unreadCount: 1,
        label: 'inbox',
        interested: false,
      });
      state.messages.set(convId, [inMsg]);
      console.log(`[demo] dm_replied lead=${lead.id} (${lead.displayName}) → conv=${convId}`);
      emit({ type: 'dm_replied', campaignId: camp.id, leadId: lead.id, conversationId: convId, ts: nowIso() });
      emit({ type: 'message_in', conversationId: convId, message: inMsg, ts: inMsg.sentAt });

      // Occasional follow-up so the unibox feels alive.
      if (rand() < 0.35) {
        const followupDelay = randInt(15_000, 60_000);
        setTimeout(() => maybeFollowup(convId, lead.id), followupDelay);
      }
    } else {
      lead.status = 'failed';
      camp.totals.failed += 1;
      console.log(`[demo] dm_failed lead=${lead.id} (${lead.displayName})`);
      emit({ type: 'dm_failed', campaignId: camp.id, leadId: lead.id, ts: nowIso() });
    }
  }, delay);
};

const maybeFollowup = (conversationId: string, leadId: string) => {
  const conv = state.conversations.find((c) => c.id === conversationId);
  const lead = state.leads.find((l) => l.id === leadId);
  if (!conv || !lead) return;
  if (conv.label === 'archived') return;
  const body = pick(LEAD_FOLLOWUPS);
  const msg: Message = {
    id: nextId('msg'),
    conversationId,
    direction: 'in',
    body,
    sentAt: nowIso(),
    authorName: lead.displayName ?? lead.discordUserId,
    authorAvatarUrl: null,
  };
  const msgs = state.messages.get(conversationId) || [];
  msgs.push(msg);
  state.messages.set(conversationId, msgs);
  conv.lastMessagePreview = body.slice(0, 120);
  conv.lastMessageAt = msg.sentAt;
  conv.unreadCount += 1;
  console.log(`[demo] message_in (followup) conv=${conversationId} lead=${lead.id}`);
  emit({ type: 'message_in', conversationId, message: msg, ts: msg.sentAt });
};

// ---- sendMessage (operator outbound) ----
export const sendMessage = (convId: string, body: string): Message | null => {
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) return null;
  const account = state.accounts.find((a) => a.id === conv.accountId);
  const msg: Message = {
    id: nextId('msg'),
    conversationId: convId,
    direction: 'out',
    body: String(body || '').slice(0, 4000),
    sentAt: nowIso(),
    authorName: account?.username || 'operator',
    authorAvatarUrl: null,
  };
  const msgs = state.messages.get(convId) || [];
  msgs.push(msg);
  state.messages.set(convId, msgs);
  conv.lastMessagePreview = msg.body.slice(0, 120);
  conv.lastMessageAt = msg.sentAt;
  conv.unreadCount = 0;
  console.log(`[demo] message_out conv=${convId} body="${msg.body.slice(0, 60)}..."`);
  emit({ type: 'message_out', conversationId: convId, message: msg, ts: msg.sentAt });
  return msg;
};

// ---- archiveConversation ----
export const archiveConversation = (convId: string): Conversation | null => {
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) return null;
  conv.label = 'archived';
  conv.unreadCount = 0;
  return conv;
};

// ---- account helpers (used by routes) ----
export const createAccount = (label: string, username?: string): DiscordAccount => {
  const handle = (username && username.trim()) || `account_${state.accounts.length + 1}#${randInt(1000, 9999)}`;
  const acct: DiscordAccount = {
    id: nextId('acct'),
    label: label || handle,
    username: handle,
    avatarUrl: null,
    status: 'connecting',
    lastStatusAt: nowIso(),
    friendsCount: 0,
    pendingOutgoing: 0,
  };
  state.accounts.push(acct);
  emit({ type: 'account_status', accountId: acct.id, status: acct.status, ts: acct.lastStatusAt });
  console.log(`[demo] account created id=${acct.id} username=${acct.username} (connecting → connected in 2s)`);
  setTimeout(() => {
    const a = state.accounts.find((x) => x.id === acct.id);
    if (!a) return;
    if (a.status !== 'connecting') return;
    a.status = 'connected';
    a.lastStatusAt = nowIso();
    console.log(`[demo] account_status acct=${a.id} → connected`);
    emit({ type: 'account_status', accountId: a.id, status: 'connected', ts: a.lastStatusAt });
  }, 2_000);
  return acct;
};

/**
 * Provision an account from a real Discord remote-auth (QR) capture.
 * The user token is stored in a module-private side map (NEVER serialised, NEVER logged).
 * The account itself surfaces the real Discord username + id but no credentials.
 *
 * Status starts as 'connecting' — we don't have a bridge running yet, so the account
 * will sit in 'connecting' until either (a) someone wires the bridge stack or (b) the
 * status is manually flipped. The Accounts UI shows a yellow pill so the user knows.
 */
const capturedTokens = new Map<string, string>();
export const createAccountFromQr = (
  user: { id: string; username: string; discriminator: string | null; avatarHash: string | null },
  token: string,
  label?: string,
): DiscordAccount => {
  const handle = user.discriminator && user.discriminator !== '0'
    ? `${user.username}#${user.discriminator}`
    : user.username;
  const avatarUrl = user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatarHash}.png?size=128`
    : null;
  const acct: DiscordAccount = {
    id: nextId('acct'),
    label: (label && label.trim()) || handle,
    username: handle,
    avatarUrl,
    status: 'connecting', // intentional: we have the token, but no bridge running yet
    lastStatusAt: nowIso(),
    friendsCount: 0,
    pendingOutgoing: 0,
  };
  capturedTokens.set(acct.id, token);
  state.accounts.push(acct);
  emit({ type: 'account_status', accountId: acct.id, status: acct.status, ts: acct.lastStatusAt });
  // Mask in logs — never log the token, only count its presence.
  console.log(`[qr] account provisioned id=${acct.id} username=${handle} discordUserId=${user.id} token=<${token.length}ch>`);
  return acct;
};

/** Internal use only — exposes the captured token for the bridge wiring layer (NOT routed to HTTP). */
export const _getCapturedToken = (accountId: string): string | null => capturedTokens.get(accountId) || null;

/** Boot-time hydration: re-register a captured token from the DB without minting a new account id. */
export const __rehydrateToken = (accountId: string, token: string): void => {
  capturedTokens.set(accountId, token);
};

export const updateAccountLabel = (id: string, label: string): DiscordAccount | null => {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return null;
  a.label = String(label || '').slice(0, 120) || a.label;
  return a;
};

export const disconnectAccount = (id: string): DiscordAccount | null => {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return null;
  a.status = 'disconnected';
  a.lastStatusAt = nowIso();
  console.log(`[demo] account_status acct=${a.id} → disconnected`);
  emit({ type: 'account_status', accountId: a.id, status: a.status, ts: a.lastStatusAt });
  return a;
};

export const removeAccount = (id: string): boolean => {
  const idx = state.accounts.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  state.accounts.splice(idx, 1);
  console.log(`[demo] account removed id=${id}`);
  return true;
};

// ---- Derived counts (used by GET /api/accounts) ----
export const computeAccountAggregates = (accountId: string): { friendsCount: number; pendingOutgoing: number } => {
  let friendsCount = 0;
  let pendingOutgoing = 0;
  for (const lead of state.leads) {
    if (lead.assignedAccountId !== accountId) continue;
    if (lead.status === 'replied') friendsCount += 1;
    if (lead.status === 'sent' || lead.status === 'pending') pendingOutgoing += 1;
  }
  return { friendsCount, pendingOutgoing };
};

// ---- Campaign detail (CampaignWithLeads) ----
export const getCampaignDetail = (id: string): CampaignWithLeads | null => {
  const camp = getCampaign(id);
  if (!camp) return null;
  const leadIds = state.campaignLeadIds.get(id) || [];
  const leads = leadIds
    .map((lid) => state.leads.find((l) => l.id === lid))
    .filter((l): l is Lead => Boolean(l));
  return { ...camp, leads };
};

// ---- sleep helper ----
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
