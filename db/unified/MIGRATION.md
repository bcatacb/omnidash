# Unified DB Migration Guide

We are moving from 3 separate databases → 1 unified database for the operator experience.

## Do NOT do this
- Big-bang migration of all historical data on day 1.
- Forcing the three platform backends to drop their current tables immediately.

## Recommended Phases

### Phase 1 — New data only (start today)
- The unified schema (`users`, `platform_accounts`, `conversations`, `messages`) becomes the source of truth **for new activity**.
- Platform backends continue running on their existing tables for internal state.
- The transformers (or a small sync worker) read fresh data from the platform APIs and write normalized rows into the unified tables.
- The Dash always reads from the unified DB (via the transformers or a future unified API).

Result: You get a working single-DB experience for everything going forward, with zero risk to existing data.

### Phase 2 — Backfill historical data (when you have time)
- Write a one-time script that copies old conversations and messages from the three old DBs into the unified tables.
- Run it once per platform.
- After backfill, the Dash can show history.

### Phase 3 — Direct platform writes (later, optional)
- Update the platform backends to write directly into the unified `conversations`/`messages` tables for inbox data.
- They can still keep their own tables for anything that is purely platform-specific and not needed in the unified view (e.g. raw Playwright session data, detailed internal campaign state, etc.).

## How the platforms stay independent

- Execution model never changes (Telegram stays Telethon, others stay Playwright).
- Only the **persisted inbox view** + operator account lives in the unified DB.
- Platform-specific details stay in `meta` JSONB or stay inside the platform backend.

## Practical tip

Start by having the current transformers do dual writes (or just writes) to the unified tables for every new message/conversation they see. This gives you the unified DB with almost no backend changes.

Later you can move the write responsibility into the backends if you want.
