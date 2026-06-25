# Unified DB Migration (Phase 2 backfill)

This folder contains tools to copy historical inbox + account data from the three platform DBs into the single unified Postgres (`db/unified/schema.sql`).

## Prerequisites

- Postgres target (new `omnibox` db or reuse one).
- Connection strings / paths for the sources.
- Python 3 + `pip install "psycopg[binary]"` (or `pg8000`).

## Quick start (local or on the VPS)

```bash
cd C:\Users\ogt\grok\omnibox   # or wherever on the server

# 1. Point at your real Postgres (create DB if needed)
# psql -U postgres -c "CREATE DATABASE omnibox;"

export UNIFIED_DATABASE_URL="postgres://postgres:YOUR_PW@80.208.224.130:5432/omnibox"

# 2. Source DBs (fill in what you have)
export TG_SQLITE_PATH="C:\Users\... \telegram_portal.db"     # or the one on server
export DISCORD_DATABASE_URL="postgres://.../discord_unibox"
export TIKTOK_DATABASE_URL="postgres://.../tiktok"   # or the supabase direct url

# 3. Run
python db/migrate/backfill.py --apply-schema --backfill-all
# or limit:
# python db/migrate/backfill.py --platform=telegram
```

After backfill, the `platform_accounts`, `conversations` and `messages` tables will contain normalized data from the old stores.

## What gets migrated

- **platform_accounts**: from `accounts` (TG), `discord_accounts` (Discord tenant_main), `tiktok_accounts`.
  - Original IDs go into `external_id` + `meta`.
- **conversations + messages**: normalized rows with peer info, last msg, direction (in/out), etc.
  - Platform differences (pipeline, archived label, etc.) go into `meta` JSONB.

## Important notes

- TG history is **mostly live** (Telethon `get_dialogs` + `get_messages`). The local DB only has a subset that was ever listed/persisted.
- Idempotent: re-running is safe.
- After migration you can still keep using the platform UIs + the original backends.
- The OmniDash (frontend adapters) currently pulls via the per-platform HTTP APIs. Once you are happy with unified data you can evolve the adapters (or a thin API) to read primarily from the unified PG for the inbox view.

## On the VPS (80.208.224.130)

- Same script works.
- Use the real DB passwords / connection details you have for each platform.
- You can run this from the server shell (after cloning or rsyncing the omnibox folder).
- Firewall: only need outbound from the migration host to the PGs.

## After migration

You can query unified data directly:

```sql
SELECT platform, count(*) FROM platform_accounts GROUP BY platform;
SELECT platform, count(*) FROM conversations GROUP BY platform;
```

Then point future inbox consumers at the unified tables (or keep the current direct adapter path + dual write for new activity).

See also:
- `db/unified/MIGRATION.md`
- `db/unified/schema.sql`
- `db/unified/DECISION.md`
