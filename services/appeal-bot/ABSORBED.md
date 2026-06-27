# appeal-bot (absorbed from `~/AppellantBot`)

Absorbed into the omnibox monorepo 2026-06-27. Python/Telethon service that
automates @SpamBot messaging-limit appeals for a fleet of Telegram accounts
(webhook trigger + Telegram control bot). See `README.md` for usage.

## Integration into omnibox
- Runs as a standalone Python service (own `pyproject.toml`, `src/appeal_bot`).
- Seam stays a **webhook** (`POST /appeal` with `X-Auth-Token`) + the control bot —
  the Telegram platform engine triggers it when an account hits a limit.
- Reads the CRM's `.session` files (`APP_SESSION_DIR`) — point this at the unified
  Telegram session store once `platforms/telegram` is consolidated.

> `.env` was copied for convenience; treat it as local-only (gitignored). Real
> secrets should live server-side / in Cloudflare, not in the repo.
