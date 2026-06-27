# OmniBox Monorepo — Structure & Status

The single home for everything. See `docs/OMNIBOX_MERGE_PLAN.md` for the full plan
and `docs/OMNIBOX_OVERVIEW_PLAIN.html` for the plain-English version.

```
omnibox/
├── frontend/                 unified shell (the dashboard)            [live]
├── packages/
│   └── core/                 @omnibox/core — Omni types + contracts   [NEW ✅]
├── transports/
│   ├── api/                  Telethon                                 [planned]
│   ├── playwright/           web automation                          [planned]
│   └── cloud-phone/          DuoPlus (absorbed from duoapi)          [NEW ✅]
├── platforms/
│   ├── telegram/ discord/ tiktok/                                    [to consolidate]
│   └── instagram/ facebook/ snapchat/                                [greenfield]
├── services/
│   └── appeal-bot/           AppellantBot (absorbed)                  [NEW ✅]
├── db/unified/               unified Postgres schema                  [live]
├── deploy/                                                            [live]
└── docs/                     plan + overview reports
```

## Progress (Phase 0 + start of Phase 1)
- ✅ `@omnibox/core` created — canonical Omni types, `PlatformTransformer`, and the
  new `CloudPhoneTransport` contract (`packages/core/src/cloud-phone.ts`).
- ✅ `duoapi` absorbed → `transports/cloud-phone` (the `@duoplus/*` workspaces).
- ✅ `AppellantBot` absorbed → `services/appeal-bot`.
- ✅ live **c2** absorbed → `platforms/tiktok` (canonical; with the `.limit`/`.upsert` fixes). Stale `TikTok/` fork marked deprecated.
- ✅ **Discord source** absorbed → `platforms/discord` (source only; runtime stays containerized). Leaked-secret files purged on absorption; stale `Discord/` deprecated. (⚠️ live secrets still need rotation — see ABSORBED.md.)
- ✅ Skeleton + status docs for transports / platforms / services.
- ✅ Root workspaces wired; graph validated (8 packages).
- ✅ **`@omnibox/cloud-phone`** — `CloudPhoneClient` implements `CloudPhoneTransport` against the proxy (list/power/ADB/dumpUi/apps/SMS/media/proxy/RPA) + a reusable **`UiAutomator`** (parse screen → find by id/text → tap/type).
- ✅ **`@omnibox/platform-snapchat`** — Snapchat engine scaffold (pilot): launch app → dump → normalize → reply via the cloud-phone transport. Element selectors pending live-device calibration (see `platforms/snapchat/CALIBRATION.md`).
- ✅ Build-time security/ban-risk checklist captured: `docs/SECURITY_HARDENING.md`.
- ✅ **`@omnibox/ai`** — `InboxAssistant` (triage / draft-reply / translate) over the Omni types, provider-pluggable (Cloudflare Workers AI or any OpenAI-compatible model).

## Focus (2026-06-27): the three live platforms — Telegram, Discord, TikTok
Cloud-phone platforms (Snapchat/IG/FB) are **deferred** (login/provisioning problem, not code).
Live now: **Telegram 81 accts**, **Discord 93 accts** (both flowing into the unified inbox); **TikTok-c2 empty** (its real accounts are on the cloud phones — deferred).

## Next
1. Wire **`@omnibox/ai`** into the unified inbox UI — "Draft reply", "Translate", auto-triage badge (TG + Discord, real data).
2. Point the shell + adapters at `@omnibox/core` (retire duplicated `Omni*`).
3. Confirm TikTok path (connect accounts to c2, or keep cloud-phone-only/deferred).
4. Extract shared core (accounts/proxies/warmup/scrape/inbox-sync).
5. (Deferred) cloud-phone engines once accounts can stay logged in.

## Conventions
- Shared contracts/types live in `@omnibox/core`; nothing redefines `Omni*` locally anymore.
- Heavy runtimes (Playwright, Appium, Telethon, Discord stack, c2) run on VMs/cloud-phones,
  not in edge/Workers. Cloudflare is the backbone + brain (see plan §07).
