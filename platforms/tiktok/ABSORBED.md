# tiktok (absorbed from live c2 / "TokTik C2")

Absorbed 2026-06-27 from the **live** `/root/C2` on the old server (the pm2 process
serving `tiktok.deadbread.space`). This is now the **canonical** TikTok source —
it replaces the stale, Supabase-based fork at `omnibox/TikTok/` (deprecated).

Includes the repairs made during the deployment work:
- `server/utils/supabase.ts` is the **pg-backed shim** (local Postgres `tiktok`), with the
  `.limit()` and `.upsert()` methods added (fixes the conversations + fetch-messages endpoints).

## Stack
React/Vite frontend + Express/tsx server + Playwright + local Postgres. Routes for
accounts, conversations, messages, leads, lists, campaigns, pipeline, automation, proxies.

## Status / next
- **Source = canonical here.** The live runtime still runs from `/root/C2` until Phase 6 cutover.
- Wire into omnibox: expose via the `PlatformTransformer` (`@omnibox/core`); the existing
  `frontend/src/adapters/tiktok.ts` already matches this API contract.
- Phase 6: deploy TikTok from the monorepo and decommission `/root/C2`.

> Do not edit the stale `omnibox/TikTok/` fork — it is deprecated (see `TikTok/DEPRECATED.md`).
