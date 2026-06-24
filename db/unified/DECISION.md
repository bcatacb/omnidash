# Database Strategy Decision (2026-06)

## Decision
**Use a single unified Postgres database** for the operator-level experience.

## Rationale (user priorities)
- Unified Inbox is priority #1.
- One database is significantly easier to manage than three separate ones.
- Single operator-level account that owns all platform accounts.

## Approach
- One DB (`omnibox` or similar).
- Core tables are normalized for cross-platform use (users, platform_accounts, conversations, messages).
- Platform-specific details live in `meta` JSONB columns.
- The **transformers** (in `frontend/src/adapters/`) are the unification layer. They read from the unified data model.
- Each platform's execution backend is responsible for writing normalized data into the unified tables (directly or via a thin sync layer).

## Why not three separate DBs
- Violates the "1 DB is much easier" requirement.
- Makes true unified inbox painful (constant fan-out + merging in the client).
- Harder to have one operator account.

## Why not fully merge execution models
- Telegram remains API-driven.
- Discord and TikTok remain Playwright-driven.
- Only the *data* for the inbox and operator account is converged.

## Next Steps
- Platform backends will be updated to write to unified tables.
- A unified API layer (or direct DB access from transformers in dev) will serve the frontend.
- Migration path from existing separate DBs will be needed.

See `schema.sql` for the initial schema.
