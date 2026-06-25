# Discord Unibox

A multi-account Discord "unibox" SaaS — friend-request outreach to lead lists plus a unified inbox for managing DMs across multiple bridged Discord accounts. Modeled on the existing Telegram SaaS at `/root/tg-messaging-saas/`, reshaped around the `mautrix-discord` bridge running one process per Discord account behind a custom minimal-Matrix-homeserver shim.

## Subdirectories

| Path | Owner | What lives here |
|------|-------|-----------------|
| `app/` | Agent A | Frontend (React + Vite) and backend (Node + Express) for the product. |
| `theme/` | Agent B | Design pack: Tailwind preset, design tokens, Inter font, restyled Radix components. |
| `bridge-stack/` | Agent C | `mautrix-discord` orchestration, the `hungryshim` minimal Matrix homeserver (Go ~500 LOC), and the AS-sink that relays bridge events into NATS. |
| `deploy/` | Agent D | Cloudflare Pages + Tunnel config, VPS docker-compose, CI templates. |
| `db/migrations/` | Agent E | Postgres migrations: shared `public` schema and the per-tenant schema template. |
| `docs/` | Agent E | Design spec and supporting docs. Start with `docs/superpowers/specs/2026-05-18-discord-unibox-design.md`. |
| `research/` | — | Pre-build research notes (Beeper / mautrix architecture, TG SaaS inventory). |
| `leads/` | — | Working lead CSVs and exports for internal testing. Not part of the product. |

## Quick start

1. Read the canonical design: [`docs/superpowers/specs/2026-05-18-discord-unibox-design.md`](docs/superpowers/specs/2026-05-18-discord-unibox-design.md).
2. Then read the deploy guide once it exists at [`deploy/README.md`](deploy/README.md).

Everything else (running it locally, running tests, deploying) is documented inside each subdirectory's own README.

## Status

Work in progress. No public release. Not affiliated with Discord Inc. or Beeper. Using a user token with `mautrix-discord` is against Discord's terms of service; this project is BYO-credentials and the operator accepts the ToS risk explicitly during onboarding.
