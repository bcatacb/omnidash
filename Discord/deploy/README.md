# Discord Unibox — deploy

End-to-end deployment of the Discord Unibox SaaS to `gg.linktree.bond`.

```
                                +-------------------------+
                                |     Browser (user)      |
                                +-----------+-------------+
                                            |
                                  https://gg.linktree.bond
                                            |
                  +--------- Cloudflare edge ------------+
                  |   gg.linktree.bond  → CF Pages       |
                  |   api.gg.linktree.bond → Tunnel      |
                  |   ws.gg.linktree.bond  → Tunnel      |
                  +----+-------------------+-------------+
                       |                   |
                       v                   v
            +----------+------+   +--------+---------+
            |   CF Pages       |  | Cloudflare Tunnel|
            |   discord-unibox |  | (cloudflared on  |
            |   (Vite static)  |  |  VPS, systemd)   |
            +------------------+  +--------+---------+
                                           |
                                           v
                            +--------------+---------------+
                            |          VPS (docker)        |
                            |                              |
                            |  nginx (optional) :8080      |
                            |     |                        |
                            |     v                        |
                            |  api :3000  ←—— orchestrator |
                            |                       |      |
                            |                       v      |
                            |        hungryshim, nats, pg  |
                            +------------------------------+
```

---

## Prerequisites

| Thing                            | Why                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| Cloudflare account               | Hosts the zone, Pages project, and Tunnel.                     |
| Registrar access for `linktree.bond` | To update nameservers when the zone is added.              |
| GitHub repo with `app/` pushed   | CF Pages connects to GitHub for builds.                        |
| VPS (Ubuntu/Debian, public IPv4) | Runs api + orchestrator + hungryshim + nats + postgres + cloudflared. |
| `CF_API_TOKEN`                   | For `wrangler` and the REST commands in the runbook.           |

---

## Repo layout (this folder)

```
deploy/
├── README.md                       # you are here
├── cloudflare/
│   ├── zone-setup-runbook.md       # exact commands to add gg.linktree.bond
│   ├── zones-list-output.json      # snapshot of mcp__cloudflare__zones_list
│   ├── pages-config.json           # CF Pages project config
│   ├── dns-records.yaml            # all DNS records needed
│   ├── tunnel-config.yaml          # cloudflared ingress rules
│   └── wrangler.toml.example       # placeholder for future Workers
├── vps/
│   ├── docker-compose.prod.yml     # top-level orchestration
│   ├── nginx.conf                  # optional reverse proxy
│   ├── systemd/
│   │   └── cloudflared.service     # systemd unit for the tunnel
│   └── bootstrap.sh                # one-shot VPS provisioner
└── ci/
    └── pages-deploy.sh             # build app/ → upload via wrangler
```

---

## Step-by-step

### 1. Zone setup on Cloudflare

Follow [`cloudflare/zone-setup-runbook.md`](./cloudflare/zone-setup-runbook.md).
Summary:

1. Add `linktree.bond` as a Full zone on the CF account.
2. Update the registrar nameservers to the two CF nameservers returned.
3. Wait for activation (`status: active`).
4. Add DNS records (`gg`, `api.gg`, `ws.gg` — all CNAME, all proxied).
5. Set SSL mode to **Full (strict)**.

Audit trail: every write command in the runbook has a timestamp slot; fill it in as you go.

### 2. Tunnel setup on the VPS

```bash
ssh root@<vps>
cloudflared tunnel login                       # browser auth
cloudflared tunnel create discord-unibox-prod  # prints UUID
# Move creds + drop UUID into deploy/cloudflare/tunnel-config.yaml.
```

Then patch the `api.gg` and `ws.gg` DNS records with the UUID
(runbook §4.2 + §4.3).

### 3. Push to GitHub & connect CF Pages

```bash
cd <repo-root>
git remote add origin git@github.com:<owner>/discord-unibox.git
git push -u origin main
```

Then in the CF dashboard:

1. Workers & Pages → Create application → Pages → Connect to Git.
2. Pick the repo. Settings come from [`cloudflare/pages-config.json`](./cloudflare/pages-config.json).
3. Deploy. The first build will produce `discord-unibox.pages.dev`.
4. Settings → Custom domains → add `gg.linktree.bond`. CF auto-validates against the CNAME from step 1.

### 4. Bootstrap the VPS

```bash
ssh root@<vps>
export POSTGRES_PASSWORD='<generate-32-char-secret>'
export UNIBOX_REPO_URL='git@github.com:<owner>/discord-unibox.git'
curl -fsSL https://raw.githubusercontent.com/<owner>/discord-unibox/main/deploy/vps/bootstrap.sh \
  | sudo -E bash -s -- "$UNIBOX_REPO_URL" main
```

Or, if you've already cloned the repo:

```bash
sudo POSTGRES_PASSWORD='...' UNIBOX_REPO_URL='...' \
  ./deploy/vps/bootstrap.sh
```

`bootstrap.sh` is idempotent — re-run it after a config change.

### 5. Smoke tests

```bash
curl -I https://gg.linktree.bond/            # 200, CF Pages
curl -I https://api.gg.linktree.bond/health  # 200, VPS api
# WS upgrade:
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     -H "Sec-WebSocket-Version: 13" \
     https://ws.gg.linktree.bond/ws          # 101 Switching Protocols
```

---

## Rollback

| Scenario                                      | Action                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Bad frontend deploy                           | CF Pages → Deployments → pick the last good deploy → **Rollback**.     |
| Bad backend deploy                            | `docker compose -f deploy/vps/docker-compose.prod.yml down` then check out previous git ref and re-up. |
| Tunnel hung                                   | `systemctl restart cloudflared`; check `journalctl -u cloudflared -e`. |
| DNS misroute                                  | Edit the record in CF dashboard or via REST (runbook §4); proxied changes propagate in seconds. |
| Want to take the whole stack offline          | `docker compose -f deploy/vps/docker-compose.prod.yml down` + `systemctl stop cloudflared`. Frontend stays up on CF Pages but cannot reach the api. |
| Full nuke                                     | Same as above + remove DNS records + delete the Pages project.        |

Postgres data lives in the named volume `unibox-postgres-data` — `docker compose down` does **not** delete it. `docker compose down -v` does. Be careful.

---

## Cost estimate (v1)

| Component                          | Plan        | Monthly cost |
| ---------------------------------- | ----------- | ------------ |
| Cloudflare zone (`linktree.bond`)  | Free        | $0           |
| Cloudflare Pages (frontend)        | Free        | $0           |
| Cloudflare Tunnel (cloudflared)    | Free        | $0           |
| VPS (existing — assumed)           | existing    | unchanged    |
| Domain renewal (`linktree.bond`)   | registrar   | ~$10/yr      |
| **Total marginal cost**            |             | **~$0/mo**   |

CF Pages free tier: 500 builds/mo, unlimited bandwidth, unlimited sites.
CF Tunnel free tier: unlimited traffic; rate-limit is the same as any
proxied zone (1000 req/s before you'd want Argo or Workers in front).

---

## What's deferred (not in v1)

- GitHub Actions workflow (deploy is manual via `pages-deploy.sh` for now).
- A separate staging Pages project + staging tunnel.
- Workers in front of `/api` for edge rate-limiting.
- WAF / Bot Fight Mode tuning.
- Backups for `unibox-postgres-data` (recommend daily `pg_dump` to R2 — placeholder).
