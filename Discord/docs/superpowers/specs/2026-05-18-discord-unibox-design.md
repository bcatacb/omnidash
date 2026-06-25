# Discord Unibox — Design Spec

- **Status:** Draft (converged from brainstorming, 2026-05-18)
- **Author:** Agent E
- **Repo:** `Discord Account Manager`
- **Supersedes:** none

This document is the canonical design for the Discord multi-account unibox SaaS. Code-writing agents (A app, B theme, C bridge-stack, D deploy) must conform to it. Disagreements get resolved by editing this file first, code second.

---

## 1. Problem & goal

Build a Discord multi-account "unibox" SaaS, modeled on the existing Telegram SaaS at `/root/tg-messaging-saas/`.

Single product, two main jobs:

1. **Friend-request outreach** to lead lists. Operator uploads a CSV (or pulls leads from elsewhere), picks one of their bridged Discord accounts, and sends friend requests at safe rate-limits.
2. **Unified inbox ("unibox") for managing DMs** across multiple bridged Discord accounts. Every account the customer has logged in feeds its DMs into one chat surface; replies are manual.

Success criteria for v1:

- One operator can run 5–20 Discord accounts behind the product without operating any Matrix infra themselves.
- A lead can be moved from `pending_fr` to `replied` through the UI without touching Discord's own client.
- Connection / captcha / ban states are observable per account in the UI.
- No customer credentials are ever logged or stored outside the bridge container that needs them.

---

## 2. Non-goals (v1)

- **No automated DM sequences / drip campaigns.** Reply is manual only. (We may add a v2 sequencer; intentionally out of scope now to keep ToS posture defensible.)
- **No voice, video, or screen share.** Bridge upstream doesn't support it; we don't surface it.
- **No server administration UI** (kick / ban / channel management). Guilds are not the primary surface; DMs are.
- **No mass DM blast.** Bridge can technically send into any channel, but the product does not expose unsolicited DM-to-many. Outbound DM is always 1:1 from a chat opened in the unibox.
- **No multi-region failover.** Single-VPS deploy. HA is a later concern.

---

## 3. Product flow

The lifecycle of a single lead, from CSV import to closed conversation:

```
[CSV import] -> pending_fr -> fr_sent ----> (accept) -> unlocked -> replied -> archived
                                |                                       ^
                                +----> (decline / timeout) -> fr_declined
```

### States (stored on `tenant_<slug>.leads.fr_status` and `.dm_status`)

| State          | Meaning                                                                 |
|----------------|-------------------------------------------------------------------------|
| `pending_fr`   | Lead exists, no friend request sent yet. Assigned account may be null.  |
| `fr_sent`      | FR sent successfully via assigned account. Awaiting Discord ack.        |
| `fr_declined`  | Discord returned an error (already friends not possible, blocked, etc.) or 7-day silence after the FR. |
| `unlocked`     | We received `RELATIONSHIP_ADD` (friend accept) for this user on the assigned account. DM is now legal. |
| `replied`      | At least one inbound message exists in the conversation (lead replied). |
| `archived`     | Operator hand-archived the conversation. Pulled out of unibox primary view. |

### Transitions

1. `pending_fr -> fr_sent` — operator clicks "Send FR" in the lead row; we POST `/users/@me/relationships` via the bridge provisioning HTTP API on the assigned account. On 200, mark `fr_sent`, write to `audit_log`.
2. `fr_sent -> unlocked` — bridge emits a `RELATIONSHIP_ADD` for the lead's `discord_user_id`; AS-sink translates to a NATS event; backend updates the row; conversation is now "unlocked" in the unibox.
3. `fr_sent -> fr_declined` — bridge emits a `RELATIONSHIP_REMOVE` referencing the same user, or 7 days elapse with no `RELATIONSHIP_ADD` (a cron job sweeps).
4. `unlocked -> replied` — first inbound DM arrives (`MESSAGE_CREATE` with `is_dm` and lead as author).
5. `* -> archived` — operator explicit action only.

### Conversation vs lead

A `conversation` row exists once a DM exists in either direction. Before that, the lead has `fr_status` but no `conversation` row. After friend-add we eagerly create the empty conversation so the unibox can show "(no messages yet)" rows.

---

## 4. UI / design language

### Layout

Three-pane layout, mirroring the TG unibox but Discord-skinned:

```
+----------+---------------------+-----------------------------+----------------+
| Account  |  Conversation list  |   Chat pane                 |  Context pane  |
| rail     |                     |                             |  (optional)    |
| 56px     |  320px              |   flex                      |  280px         |
+----------+---------------------+-----------------------------+----------------+
```

- **Account rail (left, 56px):** circular account avatars; the active account is outlined; offline / captcha / banned accounts get a colored ring. Click to filter unibox to one account; ctrl-click to multi-select.
- **Conversation list:** per-account or aggregated. Each row: peer avatar, display name + Discord handle, last message preview, unread badge, label chip.
- **Chat pane:** message list (virtualised), composer at the bottom. Composer supports markdown, file attach, template insert. No reactions in v1 — reactions are read-only display.
- **Context pane (optional, collapsible):** lead profile, notes field, lead `fr_status`/`dm_status`, source / label, "send another FR from a different account" button.

### Design tokens (Discord-faithful)

Inspired by Discord's `Ottawa` color tokens, simplified. Theme pack agent (B) owns the full token file; the canonical values:

| Token                         | Value     | Use                          |
|-------------------------------|-----------|------------------------------|
| `--bg-primary`                | `#313338` | Main chat background          |
| `--bg-secondary`              | `#2B2D31` | Sidebar / conv list bg        |
| `--bg-tertiary`               | `#1E1F22` | Account rail / nav bar        |
| `--bg-floating`               | `#111214` | Tooltips / modals             |
| `--bg-mentioned`              | `#FAA61A1A` | Mention highlight           |
| `--accent-primary`            | `#5865F2` | Discord blurple (links, btns) |
| `--accent-success`            | `#23A55A` | Online / sent OK              |
| `--accent-warning`            | `#F0B232` | Captcha / degraded            |
| `--accent-danger`             | `#F23F43` | Banned / send fail            |
| `--accent-idle`               | `#F0B232` | Idle status dot               |
| `--accent-dnd`                | `#F23F43` | DND status dot                |
| `--text-primary`              | `#F2F3F5` | Body text                     |
| `--text-secondary`            | `#B5BAC1` | Muted text                    |
| `--text-muted`                | `#80848E` | Timestamps                    |
| `--text-link`                 | `#00A8FC` | Hyperlinks                    |
| `--border-subtle`             | `#3F4147` | Dividers, hairlines           |
| `--interactive-hover`         | `#35373C` | Hover backgrounds             |
| `--interactive-active`        | `#404249` | Pressed backgrounds           |

Light mode is **not** in v1 scope. (Discord's own light theme is rarely used by the target operator.)

### Typography

- **Font:** Inter (variable). Discord ships gg sans; we use Inter because it's free, ships with most starter kits, and reads close enough at 14px.
- **Scale:** 12 / 14 / 16 / 20 / 24. Body is 14px / 1.45. Composer is 16px to avoid iOS auto-zoom.

### Motion

Restraint. Specifically:

- Hovers: 80ms opacity / background only.
- Composer focus: no scale, no shadow pulse.
- New message arrival: fade-in 120ms; no slide.
- No spring animations. No skeleton shimmer in the unibox — use a quiet pulse on a single 1px line instead.

Rationale: the operator stares at this screen all day. Heavy motion fatigues.

### Component basis

Radix UI primitives (already in the TG SaaS) + Tailwind, restyled. We do **not** import Shadcn defaults wholesale; the theme pack owns `tailwind.preset.js` and `tokens.css`, and components in `theme/components/` are pre-skinned wrappers around Radix.

---

## 5. Architecture

### Topology

```
                          +------------------------------+
                          |  Browser (Cloudflare Pages)  |
                          |  React + Vite, /app/*        |
                          +---------+--------------------+
                                    |   HTTPS + WSS
                                    |   (gg.linktree.bond)
                          +---------v--------------------+
                          |  Cloudflare Tunnel           |
                          |  api.gg + ws.gg subdomains   |
                          +---------+--------------------+
                                    |
                          +---------v--------------------+
                          |  VPS                         |
                          |                              |
                          |  +------------------------+  |
                          |  |  Node API (Express)    |  |
                          |  |  WebSocket gateway     |  |
                          |  +--+--------+------------+  |
                          |     |        |               |
                          |     |        | NATS pub/sub  |
                          |     v        v               |
                          |  +-----+  +------------+     |
                          |  | PG  |  | NATS JS    |     |
                          |  +-----+  +-----+------+     |
                          |                 ^            |
                          |                 | publish    |
                          |  +--------------+---------+  |
                          |  |  AS-sink (Go)          |  |
                          |  |  HTTP appservice tx    |  |
                          |  +-----------+------------+  |
                          |              ^               |
                          |              | AS txns       |
                          |  +-----------+------------+  |
                          |  |  hungryshim (Go ~500   |  |
                          |  |  LOC, fake homeserver) |  |
                          |  +--+--+--+--+--+--+--+---+  |
                          |     |  |  |  |  |  |  |      |
                          |     v  v  v  v  v  v  v      |
                          |  [mautrix-discord container]  <- one per Discord acct
                          |     |                          |
                          |     v                          |
                          |  Discord gateway WS + REST     |
                          |  (via residential proxy)       |
                          +--------------------------------+
```

### Component summary

- **Frontend:** React + Vite, Cloudflare Pages. Talks to `api.gg.linktree.bond` (HTTPS) and `ws.gg.linktree.bond` (WSS).
- **Node API:** Express, JWT sessions, multi-tenant via schema-per-tenant. Owns: lead CRUD, conversation read API, FR-send orchestration, template CRUD. Never touches Discord tokens directly.
- **NATS JetStream:** event bus. Subjects: `discord.<tenant>.<account>.{message,relationship,status}`. JetStream persistence on (24h) so the WS gateway can replay on reconnect.
- **AS-sink (Go):** registers itself as an appservice with hungryshim covering the namespace of all bridge ghost users. Receives the appservice transaction stream; transforms each `m.room.message` / status event into the NATS subjects above. Stateless beyond NATS publish.
- **hungryshim (Go, ~500 LOC):** the minimum Matrix client-server surface that mautrix-discord actually calls (login, room create, send, redact, react, upload media, appservice transaction push, `/_matrix/client/v3/sync` stub, `/.well-known`). Implements **only** that surface. Does not persist Matrix state in any meaningful way — rooms are addressed by deterministic IDs derived from `(tenant, account, peer_id)`. Owned by agent C.
- **mautrix-discord container:** one per Discord account. Configured to talk to hungryshim on a fixed internal hostname. Holds the Discord gateway WS for that user. State in its own SQLite or per-account Postgres schema (the bridge's own state; separate from the SaaS schema).
- **Outbound path:** the Node API does **not** push Matrix events. To send a DM, it calls the per-bridge `appservice.provisioning` HTTP API directly — `POST /_matrix/provision/v1/send` (or equivalent in bridgev2) — which routes to discordgo and Discord. This bypasses the whole Matrix room machinery for outbound and is faster + simpler than round-tripping through hungryshim.
- **Token storage:** the Discord user token never enters the Node API as a request body. The provisioning UI generates a one-shot signed URL the customer's browser POSTs to *directly* against the bridge container's provisioning endpoint (through a narrow Tunnel route). Bridge stores the encrypted token in its own per-account DB. Node API only holds `token_encrypted` as an opaque blob *if* we re-export tokens for backup, which is a v2 feature.

### Why this shape

- **Process-per-account** is the supported isolation model upstream (`bbctl run`). Beeper's `megabridge` is private and not yet shipped. See `research/beeper_discord_architecture.md` §3-4.
- **Skipping Synapse** drops 100s of MB of memory and 1 GB+ of state per host. `hungryshim` is feasible because mautrix-discord exercises a *tiny* fraction of the C-S API (per Tulir's "hungryserv does not implement the entire client-server API"). Risk: hungryshim is novel code we own.
- **NATS over the appservice transaction stream** because the AS protocol is the canonical bridge → outside-world tap. Polling Postgres is brittle; sniffing the bridge's outbound HTTPS to Discord is fragile and would lock us to a discordgo version.

---

## 6. Multi-tenancy & data model

### Tenancy model

**Schema-per-tenant in a single Postgres database.** Each customer org has:

- A `public.tenants` row (the source of truth for the tenant slug).
- A schema named `tenant_<slug>` created by the `create_tenant_schema(slug)` SQL function.
- All operator users live in `public.users` and have `tenant_id` FK back to `public.tenants`.

Rationale: cheap, easy backup per tenant (`pg_dump --schema=tenant_<slug>`), lets us drop a tenant entirely with `DROP SCHEMA CASCADE`. Avoids the RLS hairball of full row-level multi-tenancy. Per-DB instance would be too expensive at our scale.

### Shared (`public`) schema

```sql
CREATE TABLE public.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email          text NOT NULL,
  password_hash  text,
  role           text NOT NULL DEFAULT 'admin',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  UNIQUE (tenant_id, email)
);

CREATE INDEX users_tenant_id_idx ON public.users (tenant_id);
```

### Per-tenant schema (`tenant_<slug>`)

```sql
-- One Discord account that this tenant has bridged.
CREATE TABLE tenant_<slug>.discord_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label                 text,
  bridge_container_id   text UNIQUE,
  proxy_id              text,
  status                text NOT NULL DEFAULT 'provisioning',
    -- one of: provisioning, online, offline, captcha, banned, paused
  token_encrypted       text,
  last_status_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- A Discord user we'd like to (or already do) talk to.
CREATE TABLE tenant_<slug>.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id       text NOT NULL,
  display_name          text,
  source                text,         -- 'csv', 'manual', 'scrape:<rule_id>', etc.
  label                 text,
  fr_status             text NOT NULL DEFAULT 'none',
    -- pending_fr, fr_sent, fr_declined, unlocked, none
  dm_status             text NOT NULL DEFAULT 'none',
    -- none, replied, archived
  notes                 text,
  assigned_account_id   uuid REFERENCES tenant_<slug>.discord_accounts(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_discord_user_id_idx ON tenant_<slug>.leads (discord_user_id);
CREATE INDEX leads_fr_status_idx        ON tenant_<slug>.leads (fr_status);

-- One conversation per (account, peer).
CREATE TABLE tenant_<slug>.conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES tenant_<slug>.discord_accounts(id) ON DELETE CASCADE,
  peer_user_id      text NOT NULL,
  channel_type      text,            -- 'dm', 'group_dm', 'guild_text'
  last_message_at   timestamptz,
  unread_count      integer NOT NULL DEFAULT 0,
  label             text,
  UNIQUE (account_id, peer_user_id)
);

CREATE INDEX conversations_account_id_idx       ON tenant_<slug>.conversations (account_id);
CREATE INDEX conversations_last_message_at_idx  ON tenant_<slug>.conversations (last_message_at DESC);

-- A single message in a conversation.
CREATE TABLE tenant_<slug>.messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES tenant_<slug>.conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  body                text,
  discord_message_id  text,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  delivery_status     text NOT NULL DEFAULT 'sent'
    -- sent, pending, failed, deleted
);

CREATE INDEX messages_conv_sent_idx ON tenant_<slug>.messages (conversation_id, sent_at);

-- Reply / FR templates.
CREATE TABLE tenant_<slug>.templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  body        text,
  vars        text[],
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- All state-changing operator actions, for replay and compliance.
CREATE TABLE tenant_<slug>.audit_log (
  id              bigserial PRIMARY KEY,
  actor_user_id   uuid,
  action          text NOT NULL,
  payload         jsonb,
  ts              timestamptz NOT NULL DEFAULT now()
);
```

The DDL above is *narrative*; the executable form is in `db/migrations/0002_tenant_schema_template.sql` wrapped in a `create_tenant_schema(text)` function.

### Why not put `tenant_id` on every row in `public`?

Considered. Schema-per-tenant won because (a) lets us read `discord_accounts` without ever risking a missing `WHERE tenant_id = ?`, (b) `pg_dump --schema=` for per-customer GDPR export, (c) Postgres handles ~5000 schemas before catalog bloat becomes a problem and we're nowhere near.

---

## 7. ToS posture

### Position

The customer's Discord account is the customer's. We don't operate it — we host a bridge they configured. Concretely:

1. **BYO credentials.** Customer pastes their own Discord user token. We never collect, generate, or share tokens.
2. **Token never enters the API codebase as request input.** Onboarding UI POSTs the token to a Tunnel route that lands directly inside the customer's `mautrix-discord` container's provisioning endpoint. The Node API receives only a "this account is now online" callback. (Implementation: signed one-shot URL; see deploy/cloudflare/.)
3. **Per-account isolation.** Each Discord account runs in its own container, its own residential proxy, its own bridge state DB. Compromise of one account does not implicate another tenant or even another account in the same tenant.
4. **ToS click-through.** Onboarding screen shows verbatim: "Using a user token with this service violates Discord's terms of service. Discord may terminate accounts that use this product. You accept this risk. We will not appeal bans on your behalf." Customer types the literal word `I UNDERSTAND` to enable the token-paste field.
5. **Per-account friend-request rate limit:** **5 / hour, 30 / day.** Enforced in the API before any provisioning call. Stored counter in `audit_log` (or a small cache table — agent A's call). These are well under Discord's silent thresholds.
6. **Auto-pause on 401.** Bridge's `status_endpoint` fires on auth failure; AS-sink publishes a `status` event; backend marks account `status='paused'` and the UI shows a "Token expired, please re-paste" banner. No retries from our side.
7. **Captcha banner.** If the bridge emits a captcha-required status, backend marks `status='captcha'` and shows a non-dismissible banner: "Discord is challenging this account. Open Discord in a browser, complete the challenge, and resume sending." We do not attempt to solve the captcha.

### What we don't do

- Don't share credentials between tenants, ever.
- Don't proactively warm new accounts (out of scope v1 — operator manages this themselves).
- Don't claim "Discord-compatible" or use Discord trademarks in marketing copy.

---

## 8. Cloudflare deployment

### Domain plan

- Primary product domain: `gg.linktree.bond`. This is a subdomain of `linktree.bond` (the user's existing zone — `linktree.bond` must be added to the user's Cloudflare account if it isn't already, and `gg` is the new subdomain we manage).
- All three records are on Cloudflare DNS:
  - `gg.linktree.bond` -> Cloudflare Pages (frontend).
  - `api.gg.linktree.bond` -> Cloudflare Tunnel -> VPS:4000 (Node API).
  - `ws.gg.linktree.bond` -> Cloudflare Tunnel -> VPS:4000 (WebSocket, same backend).

### Frontend

- **Cloudflare Pages.** Build from `app/` subdir. Vite build output deployed via Pages Git integration (or `wrangler pages publish` from the deploy agent).
- Environment: `VITE_API_BASE=https://api.gg.linktree.bond`, `VITE_WS_BASE=wss://ws.gg.linktree.bond`.

### Backend

- **Stateful, on VPS.** Runs Node API + NATS JetStream + Postgres + AS-sink + hungryshim + N×mautrix-discord all under one docker-compose stack (orchestrated by agent C/D).
- Exposed to the world **only** via Cloudflare Tunnel. The VPS has no inbound public ports beyond SSH.
- Tunnel config lives in `deploy/cloudflare/`.

### Secrets

- Postgres password, JWT signing key, NATS auth: kept on the VPS, mounted into containers via docker-compose env files. Never committed.
- Cloudflare Tunnel credential file: lives on VPS only. The `deploy/cloudflare/` files are templates, not actual credentials.

---

## 9. MVP build order

Nine steps, executable in roughly this order. Earlier steps unblock later steps.

1. **Repo + theme + design tokens.** Bootstrap the repo, write this spec, ship the theme pack (`theme/tokens.css`, `theme/tailwind.preset.js`, a handful of Radix-wrapped components). One operator can preview a static unibox layout. *(Agents E + B.)*
2. **Database migrations.** `public.tenants`, `public.users`, `create_tenant_schema()` function. Run against a local Postgres; verify a tenant can be created and dropped cleanly. *(Agent E.)*
3. **Node API skeleton.** Express, auth (signup / signin / me), tenant resolver, empty stubs for `/api/accounts`, `/api/leads`, `/api/conversations`. JWT in localStorage to mirror TG SaaS. *(Agent A.)*
4. **hungryshim + AS-sink + one mautrix-discord container.** End-to-end: one operator can log in one Discord account locally and see `MESSAGE_CREATE` events land in NATS. No UI yet. *(Agent C.)*
5. **Account provisioning UI + Tunnel route for token paste.** Operator can paste a token in the browser, the token lands in the bridge directly, the API gets the "online" callback and writes a `discord_accounts` row. *(Agents A + C + D.)*
6. **Unibox read path.** Subscribe the WS gateway to NATS, hydrate conversations + messages from Postgres on connect, stream live updates. *(Agent A.)*
7. **Outbound send path.** Composer in chat pane -> Node API -> bridge `provisioning` HTTP API -> Discord. Record optimistic `messages` row, reconcile on bridge ack. *(Agent A + C.)*
8. **FR outreach.** CSV import to `leads`, "Send FR" button, rate-limit enforcement, `RELATIONSHIP_ADD` listener to flip `fr_status -> unlocked`. *(Agent A.)*
9. **Cloudflare deploy.** Push frontend to Pages, wire Tunnel + DNS for `api.gg` / `ws.gg`, ship a real onboarding flow on `gg.linktree.bond`. *(Agent D.)*

After step 9 we have a usable, deployed MVP. Captcha banners, ToS click-through, audit log polish, analytics, templates UI are post-MVP polish — fit between the steps as time allows.

---

## 10. Open questions / risks

| # | Risk | Mitigation plan |
|---|------|-----------------|
| 1 | **discordgo fingerprint freshness.** Beeper's discordgo fork may not keep `super_properties` / desktop build numbers current. Stale fingerprints raise ban rates. | Audit the fork before step 4. If stale, patch and pin to a recent build. Track Discord client release notes monthly. |
| 2 | **Captcha mid-session.** mautrix-discord docs say captcha "is currently not supported." We don't know how often Discord challenges a long-lived user token, or what the bridge does when it happens. | Surface as `status='captcha'` and instruct the operator to resolve manually. Empirical measurement in week 1 of beta. |
| 3 | **Per-account storage requirement.** Beeper publishes no figure. Rough back-of-envelope from the bridge schema is 50–200 MB per account at moderate activity, but unconfirmed. | Measure on the first three real accounts. If >500 MB/account, switch bridge state from per-account SQLite to a shared Postgres with hard retention pruning. |
| 4 | **Proxy provider selection.** Residential proxies vary 10x in price and 5x in reliability. Datacenter IPs are detectable, so we can't avoid residential. | Spike three providers (IPRoyal, Bright Data, Smartproxy) on the same three real test accounts; pick by ban rate over 14 days. Budget line item in pricing. |
| 5 | **megabridge ship date.** Tulir's roadmap mentions multi-tenant-in-one-process, but it has not shipped publicly. Our process-per-account model could be simplified later. | Build the orchestrator with a thin enough abstraction that "spawn a container per account" can be swapped for "register an account in the megabridge process." Don't over-engineer this now. |
| 6 | **Rate limits at aggregate scale.** Per-route limits are per-token, but Discord has global limits keyed on IP. Many accounts behind one proxy could share a global limit. | One proxy per account where possible; otherwise pool proxies so no proxy fronts more than ~3 accounts. Reassess after step 9. |
| 7 | **hungryshim correctness.** It's novel code, and any C-S endpoint we forget to implement crashes the bridge. | Run mautrix-discord against a logging proxy first to enumerate the exact endpoint set; cover with tests; keep a fallback config that swaps in a real Dendrite if hungryshim wedges. |

---

## Appendix: references

- `research/beeper_discord_architecture.md` — primary source for bridge / hungryshim / discordgo facts.
- `research/tg_saas_inventory.md` — TG SaaS we're modeling on; lift the auth + layout patterns, drop the Telegram client code.
- `db/migrations/0001_shared_init.sql` — executable form of §6 shared schema.
- `db/migrations/0002_tenant_schema_template.sql` — executable form of §6 per-tenant schema.
