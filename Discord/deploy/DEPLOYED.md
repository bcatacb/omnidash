# Live deployment state — `gg.linktree.bond`

## v0.33 — Pre-assigned leads + per-account stats (current)

Leads now get pre-assigned to an account at insert time via least-loaded over eligible accounts (accounts that scraped the user). Scheduler is lead-driven — `lead.assigned_account_id` decides who sends; per-campaign cooldown still gates global throughput. When the engine panic-pauses a campaign due to a fatal Discord signal (captcha-required, 401, 403, 429 punishment), the bad account is added to `campaign_account_suspensions` and its pending leads get rebalanced to other eligible non-suspended accounts. Operator clears the suspension on the campaign detail page.

**Why:** Before v0.33 every lead was inserted with `assigned_account_id=null` and `pickAccountForCampaign` rotated round-robin across all campaign accounts ignoring eligibility. Cross-server pairings worked only by accident — if account A got handed a lead from server B (which A wasn't in), `findExistingDmChannel` returned null and the lead silently stayed pending. UI showed one global queue with no per-account visibility.

**New migration:**
- `0018_campaign_account_suspensions.sql` — `(campaign_id, account_id, suspended_at, reason)` table with PK + index on account_id

**New endpoints:**
- `GET /api/campaigns/:id/account-stats` — per-account queued/sent/replied/failed + suspension state
- `POST /api/campaigns/:id/accounts/:accountId/resume` — clear suspension

**New db functions** (`app/server/db.ts`):
- `getEligibilityForUsers(candidateAccountIds, discordUserIds)` — eligibility map computed from `scraped_guild_members` jsonb
- `addSuspension / listSuspensions / clearSuspension`
- `rebalanceFromSuspendedAccount(campaignId, fromAccountId)` — moves pending leads off a suspended account to non-suspended eligible accounts (least-loaded), orphans (sets assigned_account_id=NULL) if no eligible alternative
- `getCampaignAccountStats(campaignId)` — aggregate over leads grouped by assigned_account_id

**Scheduler changes** (`app/server/campaign-engine.ts`):
- Deleted `pickAccountForCampaign` (round-robin over all accounts). Replaced with `accountIsUsable(id)` predicate.
- `tick()` now fetches up to 50 candidate pending leads (instead of just `BATCH_PER_TICK=1`) and walks them in FIFO until it finds one whose `assigned_account_id` isn't suspended/rate-limited. Sends at most BATCH_PER_TICK per tick.
- `panicPauseCampaign` also adds a suspension row and runs `rebalanceFromSuspendedAccount`

**UI changes:**
- NewCampaignWizard: per-account split preview after the lead range slider — simulates the server's least-loaded pass client-side using `eligibleAccountIds` collected during the scrape. Shows `@account → N leads` for every campaign account plus an `unassignable` row if any leads aren't in any paired server.
- CampaignDetail: per-account split table replacing the single totals header (queued/sent/replied/failed/status per account; `active`/`suspended (reason) [Resume]`/`orphaned` status pill).

**Image:** `gg-api:v0.33`. Rollback: `gg-api:v0.32` still on disk.

**Boot verified (2026-05-22):**
- All 6 gateways READY through the active Webshare proxy `216.98.249.105:7086`
- `/api/campaigns/nonexistent/account-stats → 401` (auth wall, expected)
- Frontend HTTP 200, `CampaignDetail-DtURtWqC.js` bundle deployed
- tsc clean (server + frontend)

**Known constraints (documented, not regressions):**
- Per-campaign `min_inter_send_seconds` cooldown still gates global throughput — even with 6 pre-assigned queues, sends are spaced by this value across the whole campaign. By design (operator wants quiet pacing, not concurrent bursts).
- Rebalance is one-way: clearing a suspension does NOT pull leads back from the accounts they were rebalanced to. Operator can re-run the wizard for a fresh distribution if they want full re-shuffling.
- Eligibility uses `scraped_guild_members` only — if the operator re-scrapes a server with a different account, old eligibility data persists until that scrape is overwritten via the per-(account, guild) unique key.

---

## v0.32 — Product cleanup (previous)

Locks the campaign flow to one provably-working pathway (wave-prep + auto-send through warm channels). Removes FR mode, Both mode, all 40+ unused 501-stub `todoDiscord` routes, demo persona text, and the dead `RelationshipsDialog`. Adds the Unibox "Interested" star toggle + filter chip. Rebuilds Dashboard from scratch as the ops hub (KPIs, alerts, recent activity feed, campaign mini-cards, wave queue summary). New landing page is `/app/dashboard` instead of `/app/unibox`.

**Four DB migrations applied:**
- `0014_lead_status_simplify.sql` — `leads.fr_status → leads.status`, values: `pending|waving|sent|replied|failed`
- `0015_campaign_totals_rename.sql` — `totals_fr_sent/accepted/declined/dm_sent` collapsed into `totals_queued/sent/replied/failed`
- `0016_campaign_status_waving.sql` — `campaigns.status` accepts `'waving'`
- `0017_conversation_interested.sql` — `conversations.interested boolean default false`

**New endpoints:**
- `PUT  /api/unibox/conversations/:id/interested` — star toggle (publishes `conversation_updated` SSE)
- `GET  /api/dashboard?window=24h|7d|all` — KPIs, alerts, recent activity, campaign mini-cards, wave queue summary

**Deleted (≈40 routes):** `todoDiscord` 501-stub block (15+ routes), `/api/demo/state`, `/api/demo/reset`, `/api/analytics/timeseries`, all FR-era `setLeadFrSent/Error/Dm*/Accepted` setters in db.ts, `sendFriendRequest` + `onRelationshipAccepted` + `resolveDmChannel` in campaign-engine, `DEMO_PERSONA` constant, `RelationshipsDialog` component, FR/Both mode picker in NewCampaignWizard, Type column on Campaigns list, Pending FRs stat on AccountCard, demo banner on Accounts page, Settings from primary sidebar nav.

**Image:** `gg-api:v0.32`. Rollback: `gg-api:v0.31` still on disk.

**Boot verified (cutover 2026-05-22):**
- API serving (`GET /api/dashboard → HTTP 401` auth-walled = expected)
- Frontend at `https://gg.linktree.bond/` returns HTTP 200
- v0.32 code present in image (verified `setLeadStatus`, `setConversationInterested`, `/api/dashboard` route, `todoDiscord` absent)
- Server tsc clean, frontend tsc clean before deploy

**⚠ Known operational issue (NOT a v0.32 regression):**
- All 6 gateway WS connections hitting HTTP 407 against `WEBSHARE_PROXY_URL=192.46.185.38:5728`. Curl with the same creds confirms the proxy itself returns `407 — "The proxy you are connecting is not in your list."` This Webshare IP appears rotated out of the user's allowed list.
- Per-account proxy table `tenant_main.account_proxies` has **0 rows** — accounts never got assigned proxies despite v0.31 shipping the schema. All connections fall back to the single dead default.
- **Fix on next session:** either (a) update `WEBSHARE_PROXY_URL` to a fresh proxy from the Webshare dashboard, or (b) populate `account_proxies` so each account uses a different live proxy.
- v0.31 was running the same proxy URL and would also be broken — rolling back wouldn't help.

---

## v0.30 — Multi-account browser extension

Ships the GG Account Switcher Chrome extension + `/app/sessions` UI for managing operator-defined groups of captured Discord accounts. Operator clicks "Activate @account" in gg → extension fetches a token bundle from `/api/groups/:id/token-bundle` (using the operator's gg session cookie) → writes `localStorage.token` on the operator's discord.com tab → reloads. ~3 sec switch. Tokens never persisted to disk on operator's machine — extension holds in service-worker memory only (5-min cache TTL).

**New artefacts:**
- `db/migrations/0012_account_groups.sql` — `account_groups` + `account_group_members` tables (applied to live DB)
- `app/server/groups.ts` + `app/server/api-types.ts` + `app/server/db.ts` — backend CRUD + token-bundle endpoint
- `app/src/pages/BrowserSessions.tsx` + `app/src/pages/sessions/{GroupCard,AddAccountPicker}.tsx` — frontend page
- `extension/` — Chrome MV3 extension source (manifest, background service worker, content script, options + popup pages, build script, README)

**Honest scope notes:**
- **Not yet on Chrome Web Store.** Operator must sideload via `chrome://extensions → Load unpacked → extension/dist/` after running `cd extension && npm install && ./build.sh`. Then paste the extension ID into `localStorage.gg-extension-id` from `/app/sessions` devtools.
- **Per-account proxy diversity is still a single shared Webshare IP for the backend.** The extension uses the operator's HOME/OFFICE IP for all account activations — that's where Discord sees logins from. Cluster-ban risk at 10+ accounts unless the operator routes their browser through per-account proxies or rotates accounts slowly.
- **No bulk token import UI.** Onboarding 50 accounts via QR is still slow — separate workstream.

**Boot verified (cutover 2026-05-21):**
- 5/6 gateway WS connections READY post-deploy
- `GET /api/groups` returns HTTP 401 (auth wall enforced — expected for anonymous request)
- DB migration `0012_account_groups` applied + both tables visible
- Extension `dist/` builds cleanly via `cd extension && ./build.sh`

**Redeploy:**
```bash
cd "/home/claudeuser/Discord Account Manager/app"
sudo docker build -f Dockerfile.backend -t gg-api:v0.30 .
sudo docker rm -f gg-api
sudo docker run -d --name gg-api --network coolify --restart unless-stopped \
  -e PORT=4000 -e NODE_ENV=production \
  -e DATABASE_URL="postgres://..." \
  -e WEBSHARE_PROXY_URL="..." \
  -e TOKEN_ENCRYPTION_KEY="..." \
  -e TOKEN_STORE_DIR=/data/gg-api/tokens \
  -e DISPLAY=:99 -e PLAYWRIGHT_BROWSERS_PATH=0 \
  -v /data/gg-api:/data/gg-api \
  gg-api:v0.30
```

Rollback: `sudo docker rm -f gg-api && sudo docker run` with `gg-api:v0.27` (v0.27 image still on disk).

---

## v0.18 — Browser-fetch for captcha-walled sends (previous)

**Status v0.18:** Live as of 2026-05-20. The three Discord REST endpoints Discord captcha-walls now execute inside a per-account headless Chromium context via `playwright-core`:

- `POST /channels/:id/messages` (`sendDiscordMessage` in `discord-send.ts`)
- `POST /users/@me/channels` (`openDmChannel` in `discord-scrape.ts`)
- `PUT /users/@me/relationships/:id` (`sendFriendRequest` in `campaign-engine.ts`)

Everything else (GETs, `/experiments` fingerprint, joins, invites, listing) still uses `cycletls` (`tlsFetch`). Gateway WebSocket still uses the `ws` package + `https-proxy-agent`. The hypothesis: Discord captchas REST sends because it inspects the full browser fingerprint (ServiceWorker, navigator fields, cookie-jar continuity, paint-timing) that a Node-side TLS-impersonated request can't fake. Running these from a real Chromium that's already booted `discord.com/channels/@me` gives Discord exactly the shape it expects.

**New artefacts:**
- `app/server/discord-browser.ts` — Browser singleton + per-account `BrowserContext` (proxy, `localStorage.token`, cookie jar). Lazy-init on first `browserFetch` call, idle-closes after 30 min.
- `app/server/discord-browser.smoke.ts` — round-trip smoke against `discord.com/api/v9/experiments` (read-only, safe to run from any IP).
- `app/Dockerfile.backend` — Chromium system libs + `playwright-core` install via the local CLI (NOT `npx playwright install`, which would duplicate the package in the npx cache).

**Image size:** `gg-api:v0.17` was 671 MB; `gg-api:v0.18` is 1.83 GB. Bulk is Chromium binary (~280 MB) + Debian Chromium libs (~250 MB) + cycletls's Go sidecar (~200 MB) + Node base (~190 MB) + buildkit attestation manifests. Disk on Hetzner is plenty; per-account runtime memory cost is ~150 MB per warm browser context (idle-closes after 30 min if unused).

**New env vars:**
- `BROWSER_FETCH_ENABLED=1` (default on). Set to `0` to disable — `browserFetch` throws, so call sites would need a fallback added for graceful degrade.

**Honest known unknown:** Even with Playwright, if Discord checks REST/WS TLS-session binding (i.e. that the gateway WS and the captcha-walled REST call came from the same TLS stack), this alone won't fix the captcha behavior. The Phase 2 fallback would be moving the gateway WS into Playwright too via `page.evaluate(() => new WebSocket(...))`. Out of scope for v0.18.

**Cool-down note:** test accounts need ≥ 24–48 h quiet time before measuring v0.18's effect, otherwise existing captcha flags mask the result.

**Boot verified (2026-05-20 swap):**
```
[boot] hydrated 6 account(s), 349 conversation(s) from DB
[gw] account=acct_3_f24a READY ownUserId=637308976786309144 dms=2
[gw] account=acct_1_fec5 READY ownUserId=630045882405879854 dms=100
[gw] account=acct_1_d967 READY ownUserId=539122110375657494 dms=102
[gw] account=acct_1_3cfc READY ownUserId=586390962474057728 dms=34
[gw] account=acct_2_ea32 READY ownUserId=900444977002348575 dms=101
[gw] account=acct_4_ce7f READY ownUserId=630448553134784533 dms=7
```

All 6 captured accounts hydrated; all 6 gateway WS connections READY; backfill polling resumed. No `[browser]` log yet (lazy-init on first send).

**Redeploy:**
```bash
cd "/home/claudeuser/Discord Account Manager/app"
sudo docker build -f Dockerfile.backend -t gg-api:v0.18 .

sudo docker rm -f gg-api
sudo docker run -d --name gg-api --network coolify --restart unless-stopped \
  -e PORT=4000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgres://..." \
  -e WEBSHARE_PROXY_URL="$(cat ../.proxy-webshare.local)" \
  -e TOKEN_ENCRYPTION_KEY="..." \
  -e TOKEN_STORE_DIR=/data/gg-api/tokens \
  -e BROWSER_FETCH_ENABLED=1 \
  -v /data/gg-api:/data/gg-api \
  gg-api:v0.18
```

Rollback: `sudo docker rm -f gg-api && sudo docker run` with `gg-api:v0.17` (671 MB image still on disk).

---

## v0.3 — QR-login wired (previous)

Adds the Discord remote-auth protocol (same one beeper-discord / mautrix-discord use) directly in the Node API, surfaced as a real QR code in the Accounts page's "Add account" modal.

**New artefacts:**
- `app/server/discord-remote-auth.ts` — WebSocket protocol implementation (~250 lines)
- `app/server/discord-mock.ts` — `createAccountFromQr(user, token)` provisions a real account from a QR capture (token stored module-private, never logged, never serialised)
- `app/server/index.ts` — new endpoints `POST /api/accounts/qr/start`, `GET /api/accounts/qr/:id`, `POST /api/accounts/qr/:id/cancel`
- `app/server/realtime.ts` — `publishExternalEvent()` hook so QR lifecycle events flow into the same SSE stream
- `app/src/api-types.ts` — `RealtimeEvent` union extended with `qr_ready`, `qr_user_seen`, `qr_authorized`, `qr_failed`, `qr_cancelled`
- `app/src/pages/accounts/AddAccountModal.tsx` — `QrLoginPanel` component renders the real QR via `qrcode.react` and walks the state machine

**Server env unchanged.** Image bumped to `gg-api:v0.3`.

**Smoke (verified live):**
```
$ curl -X POST https://gg.linktree.bond/api/accounts/qr/start | jq .id
"0a45705b34d27d2b"
# ~2 seconds later:
$ curl -s https://gg.linktree.bond/api/accounts/qr/0a45705b34d27d2b
{ "status": "pending_scan", "qrUrl": "https://discord.com/ra/...", ... }
```

**End-to-end click flow:**

1. https://gg.linktree.bond/app/accounts → "Add account" button
2. Switch to the "QR" tab
3. Server opens WebSocket to `wss://remote-auth-gateway.discord.gg/?v=2`
4. After handshake (1–2 s) a real QR appears, scoped to a Discord URL
5. Scan with Discord mobile (avatar → "Scan QR Code")
6. Modal shows "username — confirm on phone"
7. Tap Authorize on phone → token captured → account appears in your list

**What is NOT wired yet (intentional, will live in v0.4):**

- After capture, the new account sits in `status=connecting` (yellow pill). We have the token, but no bridge process is consuming it. The Accounts UI surfaces this clearly via the status pill.
- Real outbound friend requests still go through the **demo simulator** — the "Pixel & Mortar Studio" seeded accounts. Captured accounts are inert until the bridge stack at `bridge-stack/` is brought up and made to consume `_getCapturedToken(accountId)`.
- Token is in-memory only. **Will be lost on container restart.** Production needs encryption at rest (KMS or a server-held key) before any real use.

---

## v0.2 — Full SPA + demo simulator

## v0.2 — Live SaaS (current)

| Layer | What | Where |
|---|---|---|
| Frontend | React + Vite build, SPA fallback | container `gg-landing` (nginx:alpine), `/data/discord-unibox/landing/`, custom nginx conf at `/data/discord-unibox/nginx/default.conf` |
| API | Node + Express + ts-node, in-memory demo simulator | container `gg-api` (image `gg-api:v0.2`), built from `app/Dockerfile.backend`, port 4000 internal |
| Routing | Path-split: `/api/*` → gg-api, else → gg-landing | `/data/coolify/proxy/dynamic/gg.yml` |
| Auth | `DEMO_AUTH_BYPASS=1` — every request gets injected `demo-user` | server env var |
| TLS | Let's Encrypt R12 | via Coolify Traefik at the origin |

**End-to-end smoke-tested** (2026-05-18 04:36 UTC):

```
/                            HTTP 200  (title: "Discord Unibox (skeleton)")
/api/demo/state              HTTP 200  {"mode":"demo",...}
/api/auth/me                 HTTP 200  {"id":"demo-user",...}
/api/accounts                HTTP 200  [3 seeded accounts]
/api/unibox/conversations    HTTP 200
/app/unibox (SPA fallback)   HTTP 200
POST /api/campaigns/:id/start  → SSE emits fr_sent within 3s
```

### Container env (gg-api)

```
PORT=4000
DEMO_AUTH_BYPASS=1
SUPABASE_URL=http://placeholder.local:8000   # passes URL validation, never connected
SUPABASE_KEY=demoplaceholderkey0000000000000000
NODE_ENV=production
```

### Quick redeploy after code change

```bash
cd "/home/claudeuser/Discord Account Manager/app"

# Frontend changes:
npm run build
# Use rsync --delete (NOT rm+cp) so the directory inode is preserved and
# nginx's bind mount keeps pointing at the live data. rm+cp swaps the inode
# and breaks the mount until you restart the container — caused a 403 on
# 2026-05-18 ~05:02 UTC; root cause documented here so it doesn't repeat.
sudo rsync -a --delete dist/ /data/discord-unibox/landing/
sudo chmod -R a+rX /data/discord-unibox/landing
# nginx serves the new files immediately, no restart needed.
# If you DO swap inodes by accident: `sudo docker restart gg-landing` fixes it.

# Backend changes:
sudo docker build -f Dockerfile.backend -t gg-api:v0.2 .
sudo docker rm -f gg-api
sudo docker run -d --name gg-api --network coolify --restart unless-stopped \
  -e PORT=4000 -e DEMO_AUTH_BYPASS=1 \
  -e SUPABASE_URL=http://placeholder.local:8000 \
  -e SUPABASE_KEY=demoplaceholderkey0000000000000000 \
  -e NODE_ENV=production \
  gg-api:v0.2
```

### How v0.2 differs from v0.1

- v0.1 was a single static HTML mockup. v0.2 is the actual React SPA + working API.
- nginx config now does SPA fallback (`try_files $uri /index.html`) so `/app/unibox/c/xyz` and similar deep links work on refresh.
- A second Traefik router (`gg-api`) splits `/api/*` traffic from the SPA traffic via `priority: 100`.

---

## v0.1 — Static landing (deprecated, archived for reference)

## What's running

| Layer | What | Where |
|---|---|---|
| DNS | `gg.linktree.bond  A  46.4.80.39` (non-proxied) | Cloudflare zone `linktree.bond` (id `f8d289acadc5f0ee2484c09b61bd6249`), record id `866f93f0c31ab0464949309ac50a71e7` |
| TLS | Let's Encrypt R12, valid through 2026-08-16 | Issued by Traefik (coolify-proxy) at the origin |
| Proxy | Traefik v3.6 (Coolify-managed) | host `46.4.80.39`, dynamic config `/data/coolify/proxy/dynamic/gg.yml` |
| Origin | `nginx:alpine` container, name `gg-landing`, network `coolify` | Mounts `/data/discord-unibox/landing:/usr/share/nginx/html:ro` |
| Content | Inlined `theme/preview/index.html` + `theme/tokens.css` | 14,095 bytes, single self-contained HTML |

The DNS record uses **non-proxied** mode (orange cloud OFF) so Let's Encrypt's HTTP-01 challenge works against the origin. This matches the existing pattern in this zone for `claude.linktree.bond`, `omnirouter.linktree.bond`, etc. To switch to CF-proxied later, rewrite `gg.yml` to use only the `http` entryPoint (like `n10n.linktree.bond` does) and flip the DNS record's `proxied: true`.

## How it got deployed (reproducible)

1. CF API token pulled from `/root/.config/hermes/config.json` → `mcp_servers.cloudflare.env.CLOUDFLARE_API_TOKEN`. Has zone-scope only — no Workers permission, which is why the MCP `worker_deploy` path failed silently and we pivoted to nginx-on-VPS.
2. DNS record created via `POST /zones/{zone}/dns_records` (initially proxied, then flipped to non-proxied to fix the CF→origin HTTPS redirect loop).
3. Content prepared by inlining `tokens.css` into `theme/preview/index.html` and dropping the file at `/data/discord-unibox/landing/index.html`.
4. Container started: `sudo docker run -d --name gg-landing --network coolify --restart unless-stopped -v /data/discord-unibox/landing:/usr/share/nginx/html:ro nginx:alpine`.
5. Traefik routing file `/data/coolify/proxy/dynamic/gg.yml` written (HTTPS + LE + HTTP→HTTPS redirect, modeled on `claude.yml`).
6. Traefik auto-reloaded (file-watch provider), LE issued the cert, requests started succeeding inside 30 seconds.

## How to update content

```bash
# Edit theme/preview/index.html or theme/tokens.css in the repo, then:
sudo python3 - <<'PY'
import re
from pathlib import Path
html = Path("/home/claudeuser/Discord Account Manager/theme/preview/index.html").read_text()
css  = Path("/home/claudeuser/Discord Account Manager/theme/tokens.css").read_text()
html = re.sub(r'<link[^>]+tokens\.css[^>]*/?>', f'<style>\n{css}\n</style>', html)
Path("/data/discord-unibox/landing/index.html").write_text(html)
PY
# nginx serves the file directly — no container restart needed.
```

## How to tear it all down

```bash
# 1) Remove Traefik route (Traefik unloads it within a second of file removal)
sudo rm /data/coolify/proxy/dynamic/gg.yml

# 2) Stop and remove the nginx container
sudo docker rm -f gg-landing

# 3) Remove the content directory
sudo rm -rf /data/discord-unibox

# 4) Delete the DNS record
export CF_API_TOKEN=$(python3 -c "import json; print(json.load(open('/root/.config/hermes/config.json'))['mcp_servers']['cloudflare']['env']['CLOUDFLARE_API_TOKEN'])")
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/f8d289acadc5f0ee2484c09b61bd6249/dns_records/866f93f0c31ab0464949309ac50a71e7" \
  -H "Authorization: Bearer $CF_API_TOKEN"
```

## What this is NOT

This is a static landing — a placeholder that proves the routing chain works. It does **not** include:

- The actual React unibox UI (`app/dist/` exists but isn't being served yet)
- The api backend (`app/server/index.ts` — stubbed, no Discord wiring yet)
- The bridge stack (`bridge-stack/` — mautrix-discord containers, hungryshim, NATS — nothing running yet)
- Multi-tenant DB schema applied to any Postgres (the SQL files in `db/migrations/` haven't been executed)

For v0.2 — actually serving the React app on this domain — see `deploy/cloudflare/zone-setup-runbook.md` for the planned Pages + Tunnel architecture.
