# OmniBox — Full Consolidation & Multi-Platform Buildout Plan

> **Goal:** Collapse every scattered project into the **omnibox** monorepo so there is *one* place to reach for code, a *shared core* so any fix/feature scales to all platforms, and a *cloud-phone transport* (DuoPlus) that unlocks the mobile-first platforms (Snapchat, Instagram, Facebook). Reduce footprint, single source of truth, easy to scale.

_Last updated: 2026-06-27_

---

## 1. Why we're doing this

Today the system is spread across **~6 codebases on 2 servers**, with **duplicate, drifting copies** of the same platforms. Fixes have to be delivered to multiple sources; nothing is shared. The target is a single monorepo where:

- **One repo** holds every platform, service, transport, and the dashboard.
- A **shared core** (accounts, proxies, campaigns, warmup, scrape, inbox-sync) is written once and reused by every platform — fix once, everyone benefits.
- **New platforms** only implement their platform-specific automation; everything else is free.
- **Cloud phones** (DuoPlus) become a first-class transport so mobile-only platforms are finally viable.

---

## 2. Current state (the footprint we're consolidating)

| Project | Where it lives | What it is | Status |
|---|---|---|---|
| **omnibox** | new server `/data/omnibox` + local repo | Unified shell (frontend) + vendored **stale** Telegram/Discord/TikTok folders + `db/unified` + deploy | Canonical going forward |
| **c2 / TokTik C2** | OLD server `/root/C2` (pm2) | **Live** TikTok engine: Node/tsx + Playwright + local Postgres `tiktok` + own Vite UI | Absorb → `platforms/tiktok` |
| **AppellantBot** | `C:\Users\ogt\AppellantBot` | Python/Telethon @SpamBot limit-appeal service (webhook + control bot) | Absorb → `services/appeal-bot` |
| **Discord Unibox** | OLD server `/opt/discord-unibox` | **Live** 6-container stack (api + postgres + nats + orchestrator + hungryshim + nginx); Playwright + Matrix bridge | Source absorbed; **runtime stays containerized** |
| **Telegram Portal** | frontend OLD `:3000` (Next.js); backend new `:8000` (FastAPI/Telethon) | Telegram CRM (the reference UX) | Consolidate into `platforms/telegram` |
| **duoapi** | `C:\Users\ogt\duoapi` | DuoPlus cloud-phone console: `proxy/` + `web/` + `mock-server/` + `shared/` | Absorb → `transports/cloud-phone` |

**Infra already in place:**
- **New server** (Azure `deadbread`, `20.81.133.252`): omnibox shell, Telegram backend, hermes, `omnidash` Cloudflare tunnel.
- **OLD server** (`80.208.224.130`): Discord Unibox, c2, Telegram Portal frontend, `platforms` Cloudflare tunnel.
- **Cloudflare tunnels** on `deadbread.space`: `app` / `discord` / `telegram` / `tiktok` / `hermes` — clean HTTPS, no open ports.

---

## 3. Target architecture

```
omnibox/                         ← one repo, one deploy origin
├── frontend/                    unified shell (dashboard + embeds + native views)
├── packages/
│   ├── core/                    accounts · sessions · proxies · campaigns ·
│   │                            warmup · scrape · inbox-sync · device-pool · contracts
│   └── unified-db/              single Postgres schema + migrations + transformer contract
├── transports/
│   ├── api/                     Telethon            → Telegram
│   ├── playwright/              web automation      → Discord assist, TikTok (web)
│   └── cloud-phone/             DuoPlus (absorbed)  → ADB/Appium + RPA trigger
├── platforms/
│   ├── telegram/  discord/  tiktok/                 (existing, consolidated)
│   └── instagram/ facebook/ snapchat/               (new, cloud-phone backed)
├── services/
│   └── appeal-bot/              absorbed AppellantBot
├── db/unified/                  schema + migrations
├── deploy/                      one deploy pipeline
└── docs/                        specs + plans (this file)
```

### Transport model (the key abstraction)

| Transport | Engine | Platforms |
|---|---|---|
| `api` | Telethon (official API) | Telegram |
| `playwright` | Headless browser | Discord (assist), TikTok (web) |
| `cloud-phone` | **DuoPlus** real Android devices | **Snapchat, Instagram, Facebook** (+ TikTok-mobile optional) |

Every platform implements the same `PlatformTransformer` contract (already defined in `frontend/src/adapters/platform-adapter.ts`) → normalized `OmniConversation` / `OmniMessage` → unified inbox.

---

## 4. The DuoPlus cloud-phone layer (the unlock)

`duoapi` already provides the hard part: a secure proxy (API key stays server-side, 1 QPS, 429 backoff) over the full DuoPlus API, plus a console UI. It becomes `transports/cloud-phone`.

**DuoPlus capabilities we rely on** (verified from official docs + `duoplus-api-inventory.md`):

| Need | Mechanism |
|---|---|
| Device lifecycle | `cloudPhone/list · powerOn/Off · restart · info · newPhone` |
| **Raw automation** | `cloudPhone/openAdb` → real `adb connect IP:port` → **Appium / uiautomator2** |
| Quick shell | `cloudPhone/command` (sync ADB, ≤10s, ≤20 phones) + `DuoPlusDumpUI` |
| **Bulk/scheduled automation** | DuoPlus **RPA** templates (element detect, OCR, data extract) via `automation/*` |
| App management | `app/install · start · stop · uninstall · installedList` |
| **Account onboarding** | `cloudNumber/purchase · smsList` (verification codes) |
| Media push | `cloudDisk/signedUrl → pushFiles` |
| Isolation | `proxy/*` per device |

### Automation strategy — **hybrid**
| Job | Engine | Why |
|---|---|---|
| Inbox: read conversations, send replies | **ADB + Appium** (over `openAdb`) | Precision, programmatic, owned in omnibox code |
| Bulk chores: warmup, scroll, post, scheduled | **DuoPlus RPA templates** | Their OCR/element + scheduler already scale repetitive work |

**Hard prerequisite:** add the omnibox automation host IP to the **DuoPlus ADB whitelist** (max 10 IPs, team-level).

---

## 5. What absorbs cleanly vs. what stays special

| Component | Absorption | Notes |
|---|---|---|
| **c2 / TikTok** | ✅ Full (source + runtime) | Small, self-contained, designed as "Phase 1 of a hub." Replace stale fork; preserve the `.limit`/`.upsert` shim fixes |
| **AppellantBot** | ✅ Full | Clean service; webhook + control-bot seam preserved |
| **duoapi** | ✅ Full | Becomes `transports/cloud-phone` + "Cloud Phones" shell section |
| **Instagram / Facebook / Snapchat** | ✅ Greenfield, native | Built into the structure from day one |
| **Telegram** | ✅ Consolidate | Backend already on new server; fold portal + backend together |
| **Discord Unibox** | ⚠️ **Source only** | 6-container runtime (Matrix bridge, NATS, Go) stays containerized — too heavy for one process. Monorepo holds the source; deploy keeps the stack |

---

## 6. Data strategy

- **During transition:** each platform keeps its own store (Telegram SQLite, c2 Postgres `tiktok`, Discord Postgres-in-container). `inbox-sync` (in `packages/core`) normalizes into the existing **`omnibox_unified`** Postgres.
- **Unified inbox** reads `omnibox_unified` via the transformers; **full per-platform apps** keep their own stores (embedded in the shell).
- **Later (optional):** evaluate collapsing per-platform stores into the unified DB once stable.

---

## 7. Cloudflare Platform Layer (cross-cutting foundation)

> Cloudflare becomes the **edge backbone + AI brain** the whole system runs on — it **wraps** the automation runtimes, it does not replace them.

### 🧱 Backbone — adopt broadly
| Service | Role in OmniBox |
|---|---|
| **Access (Zero Trust)** | One SSO/email gate in front of every dashboard (shell, hermes, discord, tiktok) — replaces ad-hoc auth |
| **R2** | All object storage, zero egress: media to send/post, session-file & DB backups, automation screenshots/UI dumps, logs |
| **KV** | Config, flags, per-account cursors, rate-limit counters, metadata cache |
| **Queues** | The job spine — sends, warmup, scrape, RPA triggers (decouple "decide" from "do") |
| **Durable Objects** | Per-account/per-device coordinators: serialize actions, real-time inbox state, websocket fan-out — the fleet's nervous system |
| **Hyperdrive** | Pools/accelerates the existing Postgres for edge code |
| **Workers** | Edge API gateway + webhooks; the duoapi proxy can become a Worker |
| **Pages** | Host the shell frontend at the edge |
| **Tunnels + DNS** | Already in use (`deadbread.space`) |

### 🎆 The brain — the fireworks
| Service | Unlocks |
|---|---|
| **Workers AI** | Edge LLMs: draft replies, classify (interested/needs-reply/spam), summarize, **translate**, lead-score — across the unified inbox, every platform |
| **Vectorize** | RAG / semantic search over all conversations → context-aware, on-brand replies |
| **AI Gateway** | Cache, cost-control, rate-limit & observe any LLM (incl. external Claude/OpenAI) |

= an AI that reads every platform's inbox and drafts/sends on-brand replies — the force multiplier on top of everything else.

### 🧩 Supporting / optional
**Images** (optimize/store) · **Stream** (video host/transcode for TikTok/Snap posting) · **Email Routing** (inbound → webhook) · **Turnstile** (protect your own endpoints) · **Browser Rendering** (stateless scrapes/screenshots — niche; not warmed fleets) · **Load Balancing / WAF** (HA + edge protection).

### ⚠️ The runtime boundary (critical)
Heavy runtimes — Playwright, Appium-over-ADB, Telethon, the Discord container stack, c2 — **stay on the VMs and cloud phones.** Cloudflare = brain + storage + orchestration + auth + AI; the VMs/phones = the muscle; Workers are the glue. (D1 = small edge data only, **not** a replacement for the big Postgres stores.)

### Woven through the phases
- **Phase 0:** R2 backups · Access in front of all dashboards
- **Phase 1:** Workers as the API/duoapi gateway · Pages for the shell
- **Phase 2:** Queues + Durable Objects become the shared core's job/coordination spine
- **Phase 3+:** R2 for screenshots/media · KV for cursors
- **Phase 4+ (Snapchat on):** Workers AI + Vectorize + AI Gateway → AI triage & auto-reply across the unified inbox

**Assumption to confirm:** Workers **Paid** plan (required for Durable Objects, Queues, Workers AI quotas).

---

## 8. The merge — phased steps

> Principle: **absorb source first (zero runtime disruption), cut over runtime last, back up before every cutover.** Live systems (c2, Discord, Telegram, hermes) keep running throughout.

> **🟡 Scope update (2026-06-27):** Pursue the FULL plan, but **defer the cloud-phone-ONLY platforms — Snapchat, Instagram, Facebook** (Phases 4–5 + the live cloud-phone calibration) — they're blocked on account login/provisioning, not code. The transport/engine code for them stays built and waiting.
> **In scope now: Telegram, Discord, TikTok + the Cloudflare backbone + the AI brain.** TikTok keeps **both** paths — accounts connect in **c2** (web/Playwright; currently unpopulated but real) **and** on the cloud phones; the cloud phones do **not** feed c2 (separate stores). The c2 path proceeds now; the cloud-phone-TikTok path defers with the other cloud-phone work.
> Re-sequenced order below: 0 → 1 → 2 → (skip 4–5) → 6 → 7, with Cloudflare §7 woven throughout and the AI brain pulled **earlier** (it's deliverable now on Telegram + Discord).

### Phase 0 — Foundation & safety
- [ ] Back up all live systems (c2 `tiktok` DB, Discord `unibox-postgres` volume, Telegram SQLite + sessions, configs).
- [ ] Establish monorepo workspace tooling (npm/pnpm workspaces) + CI in omnibox.
- [ ] Create skeletons: `packages/core` (contracts), `packages/unified-db`, `transports/`.
- [ ] Decide open items in §9.

### Phase 1 — Absorb clean sources (no runtime change)
- [ ] **c2 → `platforms/tiktok`** — import live `/root/C2`, replace the stale fork, reconcile shim fixes. Keep `/root/C2` running until Phase 6.
- [ ] **AppellantBot → `services/appeal-bot`**.
- [ ] **duoapi → `transports/cloud-phone`** + add "Cloud Phones" section to the shell (reuse `web/`).
- [ ] **Discord source → `platforms/discord`** (source only).
- [ ] **Telegram → `platforms/telegram`** (portal frontend + backend together).

### Phase 2 — Extract the shared core
- [ ] Move accounts · proxies · campaigns · warmup · scrape · inbox-sync into `packages/core`.
- [ ] Refactor Telegram + TikTok to consume core (proves the "fix once" property).
- [ ] Define the **device-pool** abstraction (device ↔ account ↔ proxy ↔ number).

### Phase 3 — Cloud-phone transport (built; live-calibration DEFERRED)
- [x] `CloudPhoneClient` + `UiAutomator` + `VisionAutomator` + `DeviceScheduler` built (`@omnibox/cloud-phone`, `@omnibox/core`).
- [~] **DEFERRED:** live Appium/vision calibration, ADB whitelist, cloudNumber onboarding — wait on connectable cloud-phone accounts.

### Phase 4 — Snapchat pilot — 🟡 DEFERRED (cloud-phone-only)
- Engine scaffold built; waits on a logged-in device. (Vision-based, per `docs/CLOUD_PHONE_FINDINGS.md`.)

### Phase 5 — Instagram + Facebook — 🟡 DEFERRED (cloud-phone-only)
- Reuse the cloud-phone transport once accounts can stay logged in.

### Phase 6 — Runtime consolidation & deploy
- [ ] Single deploy pipeline from omnibox.
- [ ] Cut TikTok runtime from `/root/C2` → omnibox-managed; decommission stale copies.
- [ ] Unify services/tunnels; retire duplicates. Discord stack remains containerized but deployed from the monorepo source.

### Phase 7 — Unified, cross-platform features
- [ ] Native cross-platform unified inbox across all platforms.
- [ ] Cross-platform campaigns/warmup driven from `packages/core`.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Disrupting live systems (c2, Discord, Telegram, hermes) | Absorb source first; cut over runtime last; back up before each cutover |
| DuoPlus ADB whitelist cap (10 IPs) | Run automation from 1–2 stable hosts only |
| DuoPlus 1 QPS rate limit | Serialize via the existing proxy (already implemented) |
| Account bans / platform anti-bot | Per-device proxies, warmup cadence, conservative automation; Snapchat pilot doubles as a feasibility test |
| Secret sprawl | Keep all API keys server-side (duoapi pattern); never bake into bundles |
| Discord operator session token expiry (~2027-06-26) | Rotation reminder (already flagged) |
| Two divergent c2 codebases | Phase 1 makes omnibox canonical; delete the stale fork |

---

## 10. Open decisions to confirm

1. **Monorepo tooling** — npm workspaces (simplest) vs pnpm vs Nx/Turborepo (caching, bigger).
2. **Database** — keep per-platform stores + sync into unified (recommended for now) vs. push toward one unified DB sooner.
3. **Hosting** — consolidate everything onto the new Azure box vs. keep the heavy Discord stack on the old server.
4. **TikTok transport** — keep web/c2, or also run TikTok on cloud phones (mobile app) for better anti-detection.
5. **Pilot confirmation** — Snapchat first (recommended: it has no other viable path).

---

## 11. Immediate next actions

1. ✅ This plan (you're reading it).
2. ▶ **Phase 0**: back up live systems + scaffold the monorepo workspace + core/transport skeletons.
3. ▶ **Phase 1 first move**: absorb `duoapi → transports/cloud-phone` and diff live `/root/C2` against the stale `TikTok/` fork so we see exactly what TikTok absorption pulls in.

> Recommendation: start with **duoapi absorption + the c2 diff** (both low-risk, high-leverage), then the Snapchat pilot once the cloud-phone transport is hardened.
