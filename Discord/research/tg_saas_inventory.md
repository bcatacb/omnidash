# Telegram SaaS Architecture Inventory

## Stack & Build

**Frontend:**
- Framework: React 18.3.1, TypeScript 5.5.3
- Build tool: Vite 5.4.0
- UI library: Radix UI + Tailwind CSS 3.4.19
- State mgmt: localStorage (session token + user JSON)
- Icons: Lucide React
- Charts: Recharts 3.8.1

**Backend:**
- Language: TypeScript (Node.js, ts-node)
- Framework: Express 5.2.1
- Telegram library: `telegram` npm package (TelegramClient/MTProto)
- Database: Supabase (PostgreSQL)
- Auth: Custom JWT + session token hashing (SHA256)
- WebSocket: `ws` 8.20.0 for QR-code login
- AI integration: OpenRouter API (LLM personalization)

**Deployment:**
- Docker compose (Traefik reverse proxy + external networks)
- Frontend: 5173 (Vite dev server)
- Backend: 4000 (Express + WebSocket)
- External services: Supabase (Kong), Traefik (LetsEncrypt SSL)

## High-Level Architecture Diagram

```
┌─────────────────────┐
│   Browser (React)   │
│   /app/campaigns    │
│   /app/accounts     │
│   /app/unibox       │
└──────────┬──────────┘
           │ HTTP + WebSocket
           │ (session token)
           ▼
┌─────────────────────────────────┐
│   Express Backend (4000)        │
│  • Auth routes                  │
│  • Campaign CRUD                │
│  • Lead management              │
│  • Telegram client dispatch     │
│  • Media upload/download        │
│  • WebSocket QR login           │
└──────────┬──────────────────────┘
           │ TelegramClient API
           │ (telegram npm)
           │
    ┌──────▼─────────┐
    │ Telegram MTProto
    │ Server (cloud)
    └────────────────┘

        ├── Supabase (PostgreSQL)
        │   ├── users
        │   ├── telegram_accounts
        │   ├── campaigns, campaign_leads
        │   ├── leads, leads_enriched
        │   ├── unibox_chat_states
        │   ├── group_scrape_rules
        │   └── user_subscriptions
        │
        └── S3-like (campaign media)
```

## Generic SaaS Scaffolding (REUSABLE for Discord Clone)

These files/dirs have no Telegram dependencies and can be directly ported:

**Auth & User Management:**
- `/src/pages/SignIn.tsx` — Email+password login form
- `/src/pages/SignUp.tsx` — User registration
- `/src/pages/Landing.tsx` — Public landing page
- `/src/pages/PricingPage.tsx` — Pricing plans UI
- `/src/pages/Settings.tsx` — User profile, preferences
- `/src/components/auth/RequireAuth.tsx` — Protected route wrapper
- `/src/components/ui/sign-in.tsx` — Reusable login component

**Layout & UI Components:**
- `/src/components/layout/AppLayout.tsx` — Main app shell
- `/src/components/layout/Header.tsx` — Top navigation
- `/src/components/layout/Sidebar.tsx` — Left nav
- `/src/components/ui/*.tsx` — All Radix/Tailwind UI primitives
- `/src/lib/theme.ts` — Theme utilities

**Database Migrations (Generic):**
- `20260407_auth_plans.sql` — Users, subscriptions, sessions, API keys
- `20260410_user_custom_statuses_api_keys.sql` — Custom lead status labels

**API Routes (Generic):**
```
POST /api/auth/signin
POST /api/auth/signup
POST /api/auth/signout
GET  /api/auth/me
GET  /api/auth/plans
PATCH /api/settings/profile
GET  /api/settings/preferences
PATCH /api/settings/preferences
GET  /api/settings/api-keys
POST /api/settings/api-keys
DELETE /api/settings/api-keys/:id
```

**Build & Config:**
- `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`
- `docker-compose.yml` (Traefik routing rules)
- `package.json` (deps, build scripts)

## Telegram-Specific Layer (NEEDS REWRITE for Discord)

**Backend Core:**
- `/server/index.ts` (7468 lines) — **Main backend**: TelegramClient initialization, OTP login, message sending, group joining, user lookup, flood detection, campaign send/import ticks. Imports all modules below.

**Telegram Client Lifecycle:**
- `/server/account_flood_cooldown.ts` — Tracks rest-flood cooldowns per account
- `/server/account_load_picker.ts` — Round-robin account selection for sending
- `/server/group_link_parser.ts` — Parses t.me/username, joinchat/* invite links

**Campaign Execution:**
- `/server/campaign_bad_target.ts` — Tracks failed send attempts (unresolvable user, deleted account, privacy)
- `/server/campaign_send_queue.ts` — Queues leads for sending; selects account/lead combos
- `/server/campaign_send_reconciliation.ts` — Detects successful sends via message history
- `/server/campaign_followup.ts` — Conversation state machine for sequences
- `/server/campaign_media.ts` — Media upload to S3; caption truncation

**Group Operations:**
- `/server/group_scrape_chat_id_uuid.ts` — Converts group username → peer_id
- `/server/group_scrape_keyword.ts` — Scans group members by keyword filter
- `/server/group_link_import.ts` — Join group + scrape members

**Data Processing:**
- `/server/flood_classifier.ts` — Classifies Telegram error messages → flood type
- `/server/csv.ts` — Leads CSV import/export
- `/server/import_lead_resolvability.ts` — Resolves lead @username/@user_id via TG API
- `/server/campaign_events.ts` — Event logging (sent, bounced, replied)

**Migrations (Telegram-Specific):**
- `20260407_campaigns_leads.sql` — Campaign/lead link table
- `20260407_campaign_lead_personalization.sql` — AI personalization fields
- `20260407_account_profile_bio.sql` — Account bio storage
- `20260407_account_tags_and_lead_enrichment.sql` — Account tags, enriched lead data
- `20260407_unibox_chat_states.sql` — Chat archive/priority state per account
- `20260410_group_rules_profile_photo.sql` — Group automation rules, profile photos
- `20260422_pricing_slots_preferences.sql` — Pricing tiers, account slots
- `20260428_account_flood_cooldown.sql` — Flood cooldown tracking

**Frontend Pages (Telegram-Specific):**
- `/src/pages/Accounts.tsx` — Connect/manage Telegram accounts via QR code, bulk operations
- `/src/pages/AccountOnboardQr.tsx` — QR login flow
- `/src/pages/Campaigns.tsx` — Campaign builder (sequences, scheduling, lead import from groups)
- `/src/pages/Unibox.tsx` — Unified inbox (multi-account message threads)
- `/src/pages/Groups.tsx` — Group scraping rules editor
- `/src/pages/Analytics.tsx` — Campaign stats dashboard

**Libraries & Imports:**
- `teleproto` — TL schema codegen (Telegram protocol)
- `@supabase/supabase-js` — Database client

## Data Model

**Generic (SaaS infrastructure):**
- `users` — id, email, password_hash, first_name, last_name, is_active, created_at
- `user_sessions` — id, user_id, token_hash, expires_at
- `user_subscriptions` — id, user_id, plan_id, status, current_period_start/end
- `subscription_plans` — slug, name, price_monthly, monthly_message_limit, lead_limit, features (plans: Launch/Growth/Scale/Enterprise)
- `user_custom_statuses` — id, user_id, status_key (e.g., "contacted", "interested")
- `api_keys` — id, user_id, token_hash, token_prefix, last_used_at, revoked_at

**Telegram-Specific:**
- `telegram_accounts` — id, user_id, phone_number, username, session_string, is_active, daily_limit, profile_bio, tag_id, flood_cooldown_* (per-account TG session state)
- `account_tags` — id, user_id, name (for grouping accounts)
- `campaigns` — id, user_id, name, status, schedule_json, options_json (options: accounts[], dailyLimit, stopOnReply, aiPersonalization config)
- `campaign_leads` — id, campaign_id, lead_id (links leads to campaigns)
- `campaign_sequences` — Campaign multi-step message sequences (stored in options_json)
- `leads` — id, user_id, user_id (Telegram), username, first_name, last_name, bio, profile_photo_url, last_online_at (lead profiles)
- `leads_enriched` — ICP rating, personalization line, problem statement (enriched via AI)
- `unibox_chat_states` — id, account_id, peer_id, archived, low_priority (per-chat UI state)
- `campaign_events` — id, campaign_id, lead_id, event_type, message_id, created_at (send/reply/bounce logs)
- `group_scrape_rules` — Automated group member import triggers (group_id, keyword, interval, account/campaign bindings)

## API Surface

**Authentication (public):**
- `POST /api/auth/signup` — Register user
- `POST /api/auth/signin` — Login with email+password
- `POST /api/auth/signout` — Logout
- `GET  /api/auth/me` — Current user profile
- `GET  /api/auth/plans` — List subscription plans
- `POST /api/accounts/onboard/otp/send-code` — Start QR login
- `POST /api/accounts/onboard/otp/verify` — Confirm QR code

**Accounts (Telegram-specific):**
- `GET  /api/accounts` — List user's connected accounts
- `GET  /api/accounts/detailed` — Accounts + connection status + load metrics
- `POST /api/accounts/import-sessions` — Bulk import account sessions
- `POST /api/accounts/:id/profile` — Update account bio/profile photo
- `PATCH /api/accounts/:id/limit` — Set daily sending limit
- `POST /api/accounts/bulk-profile` — Batch edit profiles
- `POST /api/accounts/bulk-delete` — Delete multiple accounts
- `POST /api/accounts/bulk-transfer` — Transfer accounts between users
- `DELETE /api/accounts/:id` — Delete single account
- `GET  /api/account-tags` — List account tag definitions
- `POST /api/account-tags` — Create tag

**Leads (SaaS infra + TG queries):**
- `GET  /api/leads` — Paginated lead list
- `POST /api/leads` — Create lead manually
- `GET  /api/leads/:userId` — Fetch lead details
- `PATCH /api/leads/:userId/status` — Update lead status
- `POST /api/leads/statuses` — Create custom status label
- `PATCH /api/leads/statuses/:statusKey` — Edit status label
- `DELETE /api/leads/statuses/:statusKey` — Delete status
- `GET  /api/leads/statuses` — List all status labels
- `POST /api/leads/statuses/reorder` — Reorder status list
- `GET  /api/leads/export.csv` — CSV export

**Campaigns (Telegram-specific):**
- `GET  /api/campaigns` — List campaigns
- `POST /api/campaigns` — Create campaign
- `PATCH /api/campaigns/:id` — Update campaign (schedule, options, sequences)
- `GET  /api/campaigns/:campaignId/leads` — Paginated leads in campaign
- `GET  /api/campaigns/:campaignId/lead-user-ids` — Just lead IDs (for quick export)
- `POST /api/campaigns/:campaignId/leads/import` — Add leads manually
- `POST /api/campaigns/:campaignId/leads/import-groups` — Import from groups
- `POST /api/campaigns/:campaignId/leads/import-group-links` — Import from group links
- `POST /api/campaigns/:campaignId/leads/enrich` — AI-enrich leads (ICP, problems, personas)
- `POST /api/campaigns/:campaignId/personalization/generate` — AI-personalize variant bodies
- `GET  /api/campaigns/:campaignId/analytics` — Campaign send/reply stats
- `GET  /api/campaigns/:campaignId/events` — Campaign event log
- `DELETE /api/campaigns/:campaignId/media` — Delete media from campaign
- `GET  /api/campaigns/:campaignId/media/preview` — Preview media
- `GET  /api/campaigns/media/library` — List all user's media files
- `GET  /api/campaigns/stats` — Aggregate stats across campaigns
- `DELETE /api/campaigns/:id` — Delete campaign
- `POST /api/campaigns/bulk-delete` — Bulk delete

**Messages & Unibox (Telegram-specific):**
- `GET  /api/dialogs` — List active chats across accounts (multi-account inbox)
- `GET  /api/messages/:accountId/:peerId` — Message history in thread
- `POST /api/messages/:accountId/:peerId` — Send message
- `POST /api/messages/:accountId/:peerId/:messageId/react` — Add emoji reaction
- `DELETE /api/messages/:accountId/:peerId/:messageId` — Delete message
- `POST /api/messages/:accountId/:peerId/invite` — Invite user to group
- `POST /api/messages/:accountId/:peerId/create-group` — Create private group
- `GET  /api/messages/:accountId/:peerId/media/:messageId` — Download media
- `GET  /api/photo/:accountId/:peerId` — Fetch profile photo
- `GET  /api/unibox/chat-states` — Chat archive/priority flags
- `POST /api/unibox/chat-states` — Update chat state
- `GET  /api/search-users` — Search for Telegram users by username

**Groups (Telegram-specific):**
- `GET  /api/groups` — List discovered/scraped groups
- `GET  /api/groups/cached` — Cached group list
- `POST /api/groups` — Create or join group
- `GET  /api/groups/rules` — List automation rules
- `POST /api/groups/rules/bulk` — Create/update rules

**Settings & Utilities:**
- `GET  /api/settings/profile` — User profile
- `PATCH /api/settings/profile` — Update profile
- `GET  /api/settings/preferences` — User preferences
- `PATCH /api/settings/preferences` — Update preferences
- `GET  /api/settings/:key` — Get setting by key
- `POST /api/settings/:key` — Set setting

**WebSocket:**
- `ws://localhost:4000/ws/qr-login` — QR code login stream (emits QR image + polling token)

## Frontend Pages

1. `/` — Landing page (marketing)
2. `/pricing` — Pricing plans
3. `/login` — Sign in page
4. `/signup` — Sign up page
5. `/accounts/:onboardToken` — QR code onboarding
6. `/app/dashboard` — Dashboard with campaign/message stats
7. `/app/campaigns` — Campaign builder & list
8. `/app/analytics` — Campaign performance dashboard
9. `/app/unibox` — Unified inbox (all accounts' messages)
10. `/app/accounts` — Connect Telegram accounts, manage limits
11. `/app/groups` — Group automation rules
12. `/app/settings` — User profile, API keys

## What to Clone?

**Recommendation: Hard-fork + Selective Rewrite**

Hard-fork the repo and surgically replace the Telegram layer:

1. **Keep as-is:** Auth system, user/subscription management, API key system, UI components, deployment config (Traefik/Docker), generic database migrations, pricing plans.

2. **Replace wholesale:** All TelegramClient initialization code, MTProto session handling, group scraping, message sending logic, flood detection. These are ~3000 LOC in `index.ts` + 40 supporting `.ts` files. For Discord, import `discord.py` or discord.js, wrap in similar client lifecycle patterns (login → fetch user states → dispatch messages → handle rate limits).

3. **Keep structure, rewrite routes:** API routes like `/api/campaigns`, `/api/leads` are generic SaaS patterns — repurpose for Discord (instead of peer_id for chats, use Discord user/channel IDs; instead of Telegram's "rest flood," handle Discord's bucket-based rate limiting).

4. **Shared business logic:** Campaign sequencing (wait N days, send variant), lead enrichment (AI personalization), media handling, CSV import/export — all media/platform-agnostic. Reuse.

Why hard-fork? Because extracting a shared "saas-skeleton" would require extensive generalization (abstracting TelegramClient → abstract MessageClient, peer_id → abstractUserIdentifier) — slower and more fragile than a focused rewrite. The Telegram-specific code is concentrated; ripping it out is surgical.

**Effort estimate:** ~4–6 weeks to port all Telegram client logic to Discord SDK + adapt database schema (telegram_accounts → discord_accounts, peer_id → discord_user_id, rest_flood → discord_rate_limit_bucket).
