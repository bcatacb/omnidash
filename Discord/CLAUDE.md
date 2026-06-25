# Discord Unibox — Claude Code Context

## Deploy command (ALWAYS use this exact form)
```bash
cd /opt/discord-unibox && deploy/vps/backup-db.sh && git fetch origin master && git reset --hard origin/master && docker compose -f deploy/vps/docker-compose.prod.yml build api nginx && docker compose -f deploy/vps/docker-compose.prod.yml up -d
```

> **Why `build api nginx`:** The React frontend is built inside `Dockerfile.nginx` (Vite build in stage 1, nginx serves in stage 3). Skipping `nginx` means the old JS bundle is served no matter how many times the API is deployed.

## Non-negotiable rules
- NEVER use `--volumes` flag in any docker command
- NEVER suggest `docker compose down -v` or `docker system prune --volumes`
- ALWAYS run `backup-db.sh` before every deploy — user lost 64 accounts to a volume wipe
- ALWAYS bump `app/server/package.json` patch version before every commit
- ALWAYS push to GitHub immediately after every commit (`git push origin master`)
- Deploy compose file is always: `deploy/vps/docker-compose.prod.yml`
- Git update pattern: `git fetch origin master && git reset --hard origin/master` (NOT git pull --rebase)
- Deploy commands must NOT include `ssh root@...` prefix — user runs them directly on VPS

## Architecture
- **api**: Node 20 + Express + WebSocket + Playwright/Chromium — all Discord automation logic
- **postgres**: All persistent state — accounts, campaigns, leads, warmup pairs, messages
- **nats**: Message bus with JetStream
- **orchestrator**: Go — spawns mautrix-discord bridge containers
- **hungryshim**: Go — minimal Matrix C-S API shim for Discord protocol
- **nginx**: Reverse proxy (80/443/8080), cloudflared tunnel routes traffic through it

## Key files
- `app/server/discord-browser.ts` — Playwright browser context management, FR send, DM send
- `app/server/fr-campaign-engine.ts` — FR campaign tick loop
- `app/server/campaign-engine.ts` — Outreach DM campaign tick loop
- `app/server/warmup-campaign-engine.ts` — Warmup campaign tick loop
- `app/server/discord-gateway.ts` — Discord WebSocket gateway (auto-accepts incoming FRs)
- `app/server/captcha.ts` — 2captcha solver + proxy relay
- `app/server/db.ts` — All database queries
- `deploy/vps/docker-compose.prod.yml` — Production stack definition
- `deploy/vps/backup-db.sh` — Pre-deploy backup script (accounts + users tables)

## Key environment variables (in deploy/vps/.env on server)
- `VPS_PUBLIC_IP` — must match server's public IP exactly (used for 2captcha captcha-proxy-relay)
- `TWOCAPTCHA_API_KEY` — 2captcha API key for hCaptcha solving
- `POSTGRES_PASSWORD` / `TOKEN_ENCRYPTION_KEY` — secrets, never change after first deploy
- `MAX_BROWSER_CONTEXTS` — concurrent Chromium contexts (default 3; use 15 on 8GB VPS)
- `IDLE_CLOSE_MS` — browser context idle timeout ms (default 600000=10min; use 180000=3min on 1GB VPS)
- `BROWSER_FETCH_ENABLED` — set to 0 to disable browser-based sends entirely

## Captcha relay
Ports 4002-4099 must be published in docker-compose AND open in ufw (`ufw allow 4002:4099/tcp`).
2captcha workers connect to `VPS_PUBLIC_IP:PORT` which tunnels through the account's residential proxy.
Without this, captcha solves are proxyless → IP mismatch → token revoked.

## Version tracking
- Current version lives in `app/server/package.json`
- Increment patch on every push (2.0.29 → 2.0.30 → etc.)
- Version appears in the dashboard sidebar as a build indicator

## VPS details
- Current production VPS: root access via SSH
- Repo cloned at: `/opt/discord-unibox`
- Backups at: `/opt/discord-unibox/backups/`
- Captcha relay ports: 4002-4099 (TCP, published + ufw open)
