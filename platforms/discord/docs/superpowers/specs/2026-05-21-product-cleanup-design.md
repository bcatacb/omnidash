# Product cleanup + locked campaign flow — design

**Date:** 2026-05-21
**Goal:** Take the product from "everything works individually" to "this is a single coherent product." Cut features that proved unreliable (FR mode, Both mode), simplify the campaign lifecycle to one provably-working flow (wave-prep → auto-engine through warm channels), and rebuild the Dashboard as an ops hub.

---

## 1. The locked campaign flow

There is exactly one outreach flow going forward. No mode picker, no fallbacks.

### State machine

```
            ┌─────────┐
            │  draft  │
            └────┬────┘
                 │ operator clicks "Start"
                 ▼
            ┌─────────┐    operator pauses    ┌─────────┐
            │ waving  │──────────────────────▶│ paused  │
            └────┬────┘                       └────┬────┘
                 │ all leads warmed                │
                 ▼                                 │
            ┌─────────┐    captcha / fatal      ┌──┘
            │ running │────────────────────────┘
            └────┬────┘
                 │ no more pending leads
                 ▼
            ┌─────────┐
            │finished │
            └─────────┘
```

### Per-state operator UX

| State | What operator sees | What engine does |
|---|---|---|
| `draft` | "Start campaign" button on detail page | Nothing |
| `waving` | Wave Queue modal open, list of leads to wave manually, live progress as waves land | Polls `/wave-queue` every 3s, marks leads warm as gateway detects waves |
| `running` | "Pause" button, progress bar ticking, activity feed live | Sends outreach template through each warm channel on 4hr/account, 6/day/account floor |
| `paused` | "Resume" button | Stops sending. Resumed manually. |
| `finished` | "Finished" badge, full leads table, view-only | Done |

### Why this is the only flow

- We proved cold DMs trigger Discord's Clyde wall at ~7/hr/account
- We proved FR-mode captcha-walls even with Playwright + residential proxy (v0.18 test on chipcommander)
- We proved sending through a **warm channel** (one that already has a wave message in it) bypasses captcha cleanly
- Hard floors of 4hr/account and 6/day/account are non-negotiable safety after chipcommander's ban

---

## 2. What gets removed

| Item | File / location | Reason |
|---|---|---|
| Mode picker | `NewCampaignWizard.tsx` step 0 | No more FR/DM/Both — one flow |
| `mode` field in `Campaign` type, `mode` column in DB | `api-types.ts`, `0006_campaign_mode.sql` baseline | Leave the DB column with default `'dm'` (no migration churn) — UI and engine ignore it |
| FR send path in campaign engine | `campaign-engine.ts` — the `sendFriendRequest` function + the FR/both branches in `tick()` | ~200 LOC deleted |
| "Both mode" specific banners + UI hints | `NewCampaignWizard.tsx` | Mode picker is gone |
| "Accepted" stat card | `CampaignDetail.tsx` | Replaced with "Replied" (computed from inbound message presence) |
| "FR status" column header + status types `accepted`, `expired`, `dm_blocked` | `CampaignDetail.tsx`, `api-types.ts` `LeadFrStatus` | Replaced with simpler `LeadStatus` = `pending` / `waving` / `sent` / `replied` / `failed` |
| `pendingOutgoing` field on `AccountCard` | `AccountCard.tsx`, account API responses | FR concept; gone |
| Old `todoDiscord` 501 stubs | `index.ts` ~lines 968–986 | 15+ dead routes. Whole block deleted. |
| `DEMO_PERSONA` ("Pixel & Mortar Studio") | `api-types.ts` | Pre-product seed copy. Replaced with empty defaults. |
| Demo mode banner | `Accounts.tsx` | We're in real mode now |
| `RelationshipsDialog` component | `Accounts.tsx` | Inline panel replaced it; dialog is unreachable dead code |
| Mock simulator state for campaigns | `discord-mock.ts` simulator path | Real engine is the only path now |
| `/api/demo/state` endpoint | `index.ts` | Last consumer (demo banner) removed |

---

## 3. Pages — final shape

### Dashboard (`/app/dashboard`) — NEW design, now the landing page

**Top row — 4 KPI tiles, with 24h / 7d / all-time toggle:**
- **DMs sent** — total + trend arrow vs previous window
- **Replies received** — count + reply rate %
- **Pending leads** — total across all running/waving campaigns
- **Active accounts** — "5 of 6 healthy" (clickable, jumps to Accounts)

**Health alerts (auto-hides if everything's green):**
- Token-revoked accounts (4004 / persistent 401)
- Captcha-paused campaigns
- Accounts without proxy assignment (warn if any account in a running campaign lacks a proxy)

**Activity feed (right column, scrollable, last 24h):**
- Live updates via SSE
- Format: `10:23 · chipcommander → @lead123 · sent (poker-outreach)`
- Color coding: blue=sent, green=replied, amber=paused, red=failed
- Click any entry → jump to relevant detail page

**Campaigns at a glance:**
- One mini-card per non-finished campaign
- Each card: name, state pill, today's sends, replies, progress bar, accounts used
- Click → `CampaignDetail`
- "+ New campaign" CTA at the bottom

**Wave queue summary (only shows if any campaign is in `waving` state):**
- Per-campaign: "poker-outreach · 12 leads still to wave · @velvetriver"
- Click → opens Wave Queue for that campaign

**Quick stats footer (muted, small):**
- "Friends across all accounts: N"
- "Total conversations: N"
- "Accounts in groups: N/M"

### Accounts (`/app/accounts`)

Stays mostly the same, with cleanup:
- Top row: "+ Bulk import" (already exists) + "+ Add account" (already exists)
- Each AccountCard: avatar, label, status pill, Friends count (Pending FRs **dropped**)
- Inline relationships panel stays — collapsed by default (one click to expand)
- Three-dot menu: Rename, Disconnect, Join server, Remove
- "Add demo account" button at the bottom: **removed**
- Demo banner: **removed**

### Browser sessions (`/app/sessions`)

Unchanged. Already clean. Setup card auto-collapses once extension ID is saved.

### Proxies (`/app/proxies`)

Unchanged. Already clean.

### Campaigns (`/app/campaigns`)

List table simplified:
- Columns: Name / State / Accounts / Pending / Sent / Replied / Progress / Created / Actions
- "Type" column **removed** (mode no longer exists)
- "Accepted" column **removed**
- "Failed" → "Replied"
- Per-row "Wave Queue" button only visible when state = `waving`

### CampaignDetail (`/app/campaigns/:id`)

- Header KPI row: Pending / Sent / Replied / Progress (only 4 tiles; Accepted **removed**)
- Status pill matches the 4-state machine
- Activity feed unchanged
- Leads table column: "Status" instead of "FR status"; values `pending` / `waving` / `sent` / `replied` / `failed`
- Wave Queue button **always visible** (not just in header) — clicking re-opens it during waving / running for adding more leads
- "Open in Discord" per lead row — already kept

### NewCampaignWizard

Simpler — 3 steps instead of 3 steps (same count but reshaped):

| Step | Content |
|---|---|
| **1. Basics** | Name · message templates (variants list) · rate caps (per-hour + per-day, recommended defaults pre-filled) |
| **2. Accounts + servers** | The existing scrape-pairs UI (each row: pick account + pick server) |
| **3. Review + scrape** | Same as today — scrape members, range-slider to pick lead window, "Create campaign" button |

Removed from wizard:
- Mode picker (step 0 was 2/3 of the form)
- DM-mode safety banner (engine still enforces 4hr/6day silently; we don't pre-warn)
- Both-mode safety banner
- "Variants" line in step 3 review when mode was FR

### Unibox (`/app/unibox`)

One addition: **"Interested" star** per conversation. Orthogonal to the existing inbox/archived tabs — a conversation can be starred AND in the inbox, or starred AND archived.

**ConvRow changes:**
- New star icon button (lucide `Star`) on the right side of each row, next to the unread dot
- Click toggles the conversation's `interested` flag (filled = interested, outlined = not)
- Hover affordance: "Star as interested" / "Remove star"
- No confirmation needed; one click toggles

**Filter chip changes:**
- New chip "Interested" alongside the existing All / Replied / Needs reply / No reply
- When active, shows only conversations with `interested = true` (within the current tab/account filter)
- Count badge shows the number of starred convs in the current visible set

**Data model:**
- New column on `conversations` table: `interested boolean NOT NULL DEFAULT false`
- Migration `0017_conversation_interested.sql`
- API endpoint: `PUT /api/unibox/conversations/:id/interested` body `{interested: boolean}` returns updated conversation
- The `Conversation` type gets a new field `interested: boolean`
- The `ConvSummary` shipped to the frontend on initial load includes `interested` so the chip count is accurate without re-fetching

**Why a separate flag (not a new label value):**
- `label` is `inbox` / `archived` (mutex — a conv is either visible in inbox or hidden in archived)
- `interested` is a marker — orthogonal. Operator might want to star convs in BOTH inbox and archived
- Future labeling features (color tags, priority, etc.) follow the same pattern: separate boolean/enum columns rather than overloading `label`

### Settings (`/app/settings`)

Moved out of primary sidebar — accessed via avatar menu only (it's rarely-used config).

### Sidebar nav order (final)

1. **Dashboard** (icon: LayoutDashboard) — the new landing page
2. **Accounts** (Users)
3. **Browser sessions** (Globe)
4. **Proxies** (Shield)
5. **Campaigns** (Megaphone)
6. **Unibox** (Inbox)

Settings + Help + Sign out cluster at the bottom unchanged.

---

## 4. Schema + backend changes

### Lead status — replace `LeadFrStatus` with `LeadStatus`

```ts
// OLD
type LeadFrStatus = "pending" | "sent" | "accepted" | "declined" | "expired" | "error" | "dm_blocked";

// NEW
type LeadStatus = "pending" | "waving" | "sent" | "replied" | "failed";
```

DB migration `0014_lead_status_simplify.sql`:
- Map existing values: `accepted` → `replied`, `declined` → `failed`, `expired` → `failed`, `error` → `failed`, `dm_blocked` → `failed`, `sent`+`pending` unchanged
- Add `waving` as a new value
- The DB column type is `text` with a `CHECK` constraint; migration drops the old constraint, runs the UPDATE statements, then adds the new constraint
- Backend code paths that set old values are removed when the FR + Both mode code paths get deleted

### Campaign state — replace boolean-y `status` with explicit machine

Existing `CampaignStatus` already has `draft / running / paused / finished`. We add `waving`:

```ts
type CampaignStatus = "draft" | "waving" | "running" | "paused" | "finished";
```

DB migration `0016_campaign_status_waving.sql` expands the text check constraint (campaign status is also `text` not an enum in current schema).

### Engine changes

- `campaign-engine.ts::tick()` simplifies. No more mode branching. Single send path:
  1. Pick lead in `sent`/`pending` state where account has a WARM DM channel (≥1 prior message)
  2. Apply 4hr + 6/day per-account caps
  3. Send via `sendDiscordMessage` (already proven safe through warm channels)
  4. On success: lead → `sent`, bump `totals.sent`
  5. On gateway MESSAGE_CREATE direction=`in` for this lead's channel: lead → `replied`, bump `totals.replied`
- `sendFriendRequest` function: **deleted**
- `resolveDmChannel` tier 3 (openDmChannel): **deleted** — leads ONLY get sent to once their channel is warm via the wave flow
- New campaign state transitions:
  - `start` → if any pending leads have no warm channel, status = `waving` and the engine auto-pauses; if ALL channels are warm, jumps straight to `running`
  - Wave Queue's auto-detection (already wired) flips state from `waving` → `running` once `c.cold === 0`

### Totals — replace `accepted` with `replied`

```ts
// OLD
totals: { queued: number; sent: number; accepted: number; declined: number };

// NEW
totals: { queued: number; sent: number; replied: number; failed: number };
```

`accepted`/`declined` column rename in DB: `0015_campaign_totals_rename.sql`. Backfill: `totals_accepted` → `totals_replied`, `totals_declined` → `totals_failed`. Four migrations total this release: `0014` (lead status), `0015` (campaign totals rename), `0016` (campaign status adds `waving`), `0017` (conversation `interested` flag).

### Dashboard API — new endpoint

`GET /api/dashboard?window=24h|7d|all` returns:

```ts
{
  kpis: {
    dmsSent: number, dmsSentTrendPct: number,
    repliesReceived: number, replyRatePct: number,
    pendingLeads: number,
    activeAccounts: number, totalAccounts: number,
  },
  alerts: Array<{
    severity: "info" | "warn" | "error",
    kind: "token-revoked" | "captcha-paused" | "no-proxy" | "wave-needed",
    message: string,
    linkTo?: string,
  }>,
  recentActivity: Array<{
    ts: string,
    accountUsername: string,
    leadName: string,
    campaignName: string,
    campaignId: string,
    type: "sent" | "replied" | "paused" | "failed",
  }>, // last 24h, max 50
  campaigns: Array<{
    id: string, name: string, status: CampaignStatus,
    todaySent: number, repliedTotal: number,
    progressPct: number, accountCount: number,
  }>, // non-finished only
  waveQueueSummary: Array<{
    campaignId: string, campaignName: string,
    cold: number, accountUsername: string,
  }>,
  quickStats: { friendsTotal: number, conversationsTotal: number, accountsInGroups: number, accountsTotal: number },
}
```

One endpoint, one fetch on Dashboard mount + a periodic refresh every 30 seconds (or SSE-driven if we want it real-time, but a 30s poll is cheaper and good enough).

---

## 5. What we keep that's working

These were built this session and are working — no changes needed beyond what's listed in cleanup:

- Bulk token import (`/api/accounts/token/bulk`)
- v0.18 browser-fetch wrapper (`discord-browser.ts`)
- v0.31 per-account proxy + GG extension
- Wave Queue auto-detection + auto-start
- Account groups + token-bundle endpoint
- Unibox pagination + summary
- Conversation deletion sync (CHANNEL_DELETE handler + REST diff)

---

## 6. Non-goals (explicitly out of scope)

- Chrome Web Store publication — operator does that themselves (doc: `deploy/CHROME-WEB-STORE.md`)
- Account warm-up automation — operator manually warms cold accounts
- Multi-tenant / team collaboration — single operator product
- Email / SMS notifications — Discord + Unibox is the notification channel
- Discord ToS compliance posture — operator accepts ToS risk; we don't sanitize / soften the product

---

## 7. Migration / rollout

- All changes ship as **one release: v0.32**
- Database migrations 0014 + 0015 applied before deploy
- Existing campaigns with mode=`fr` or `both` get auto-paused on first boot of v0.32 (since FR send path is gone). Operator can clone leads into a new wave-flow campaign if they want to continue.
- Rollback path: keep `gg-api:v0.31` image on disk; one-line revert.

---

## 8. Success criteria

After v0.32 ships:

- Operator opens Dashboard → sees actionable summary in 2 seconds
- New campaign creation = 3 wizard steps, no mode picker, total time ~2 minutes
- Wave Queue auto-flows into running state without manual Start clicks
- Zero references to "FR", "Friend Request", "Accepted" anywhere in the UI
- AccountCard shows Friends count only (no Pending FRs)
- Sidebar nav: 6 primary items, sensible order
- 15+ dead 501 stub routes deleted from index.ts
- Demo persona text deleted from codebase
- Operator can star a Unibox conversation as "interested" and filter to just those
