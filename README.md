# OmniDash (omnidash)

Unified operator dashboard + account management for Telegram + Discord + TikTok.

## Philosophy

- Each platform keeps its own execution model:
  - Telegram → API (Telethon)
  - Discord → Hybrid (bridge + Playwright for high-risk actions)
  - TikTok → Playwright
- Unification happens at the **transformer layer** + **one shared database** for the operator experience (inbox + single operator account).
- You interact with one account that owns platform accounts across all three.

## Current Structure (Monorepo)

- `frontend/` — The unified OmniDash UI (this is what most people run)
- `Discord/`, `Telegram/`, `TikTok/` — The individual platform implementations
- `db/unified/` — The single unified database schema

## Installation (the whole package as 1 repo)

This is a monorepo. Clone the root to get **everything** (dash + platforms + unified DB schema).

```bash
git clone https://github.com/bcatacb/omnidash.git
cd omnidash
npm install
```

Run the unified dash:

```bash
npm run dev
```

The `frontend/` is the actual runnable OmniDash UI that operators use.

The platform folders (Discord/, Telegram/, TikTok/) contain the full implementations. Run them via their own docker-compose or start scripts (they can stay separate for now).

If someone only wants the dash:

```bash
cd frontend
npm install
npm run dev
```

But the recommended way is to work from the root so you have the full unified picture.

## Database Strategy

We use **one unified Postgres database** for:

- Operator users
- Platform accounts (linked to the single operator)
- Normalized conversations + messages (the unified inbox)

The individual platforms can continue using their current tables for platform-specific state during transition.

### When to Migrate the Databases

**Do it in phases. Never a big-bang migration while any platform is live.**

1. **Phase 1 (start now)**  
   New `platform_accounts`, conversations and messages are written to the unified schema.  
   The transformers (or a tiny sync process) read from the existing platform backends and normalize into the unified tables.  
   The old platform DBs keep running unchanged for now.

2. **Phase 2 (after the Dash is stable)**  
   One-time backfill script that copies historical data from the three old DBs into the unified tables.

3. **Phase 3 (optional, much later)**  
   Move the write responsibility into the platform backends so they write inbox data directly to the unified tables. They can still keep purely internal tables (browser sessions, detailed campaign state, etc.) in their original DBs if they want.

This gives you the "1 DB is much easier" benefit quickly without touching running platform code.

See `db/unified/MIGRATION.md` for the full plan.

## Running Everything (Monorepo)

This is a monorepo. Clone the root.

```bash
npm install
npm run dev          # runs the unified dash
```

The individual platform folders (Discord/, Telegram/, TikTok/) still have their own docker-compose and scripts. You can run them separately or orchestrate them from the root later.

The "dash" is what operators actually use. The rest of the repo exists so you have the full picture in one place.

## One Operator Account

A single user in the unified DB owns multiple `platform_accounts` (one per actual logged-in account on each platform).

This is the account the operator uses in OmniDash.

## Important Files

- `db/unified/schema.sql` — the single DB design
- `frontend/src/adapters/` — the transformers that normalize platform data
- `CHANGE_IMPACT_PLAYBOOK.md` and `ONE_PAGER.md` — change impact guide for the team

See the individual platform READMEs for their specific setup.
