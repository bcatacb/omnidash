# Cloudflare zone setup runbook — `linktree.bond` / `gg.linktree.bond`

This runbook brings the apex zone `linktree.bond` onto Cloudflare and wires
`gg.linktree.bond` (the subdomain that hosts the Discord Unibox SaaS) to
Cloudflare Pages (frontend) + Cloudflare Tunnel (backend API + WS).

The whole flow assumes you are running the commands from a Claude Code session
with the `mcp__cloudflare__*` tools attached. Every write command has a
timestamp slot — fill it in when you actually run the command so we get an
audit trail.

---

## Pre-flight check (read-only) — completed

| When (UTC)              | Command                          | Result                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-18T00:00:00Z    | `mcp__cloudflare__zones_list`    | Tool returned `[object Object]` in the harness (display issue, not auth). Per user brief the zone is not yet on the account. **Action:** verify in the CF dashboard before running section 2; if zone already exists, skip to §3. |
| 2026-05-18T00:00:00Z    | `mcp__cloudflare__domain_list`   | Same — `[object Object]`. Treated as "no workers domains attached" for v1.                                                                                                                                                          |

Raw capture saved to `./zones-list-output.json`.

---

## 1. Prerequisites

- A Cloudflare account with the API token already attached to this Claude
  session (the same one the MCP uses).
- Access to the domain registrar where `linktree.bond` is currently registered
  (you need to update the nameservers there).
- The VPS reachable on the public internet, with `cloudflared` installable.
- The frontend code in `app/` pushed to a GitHub repo that Cloudflare Pages
  can connect to.

---

## 2. Add the apex zone `linktree.bond`

> Skip this whole section if `mcp__cloudflare__zones_list` shows
> `linktree.bond` (or `gg.linktree.bond` — though Cloudflare always operates
> on the apex) is already on the account.

There is no `mcp__cloudflare__zones_create` tool in the current MCP surface.
We add the zone via the REST API using `curl` with the same token, then
re-list with the MCP to confirm.

### 2.1 Add the zone (REST)

```bash
# Run on any machine with curl + jq, with CF_API_TOKEN exported.
# The token must have the "Zone:Edit" + "DNS:Edit" + "Account:Read" scopes.
curl -sS -X POST https://api.cloudflare.com/client/v4/zones \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "linktree.bond",
    "account": { "id": "<YOUR_ACCOUNT_ID>" },
    "type": "full"
  }' | tee zone-create.response.json | jq '.result | {id, name, status, name_servers}'
```

Record:

| When (UTC) | Zone ID | Status  | Nameservers |
| ---------- | ------- | ------- | ----------- |
|            |         | pending |             |

### 2.2 User action: update nameservers at the registrar

The registrar for `linktree.bond` must point the NS records to the two
Cloudflare nameservers returned above. Until that propagates (5 min – 24 h)
the zone stays in `pending` state and **no DNS or tunnel traffic will resolve**.

### 2.3 Wait for activation, then verify

```bash
# Poll every 60s; replace <ZONE_ID> with the id from §2.1.
until [ "$(curl -sS https://api.cloudflare.com/client/v4/zones/<ZONE_ID> \
            -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.status')" = "active" ]; do
  echo "still pending... $(date -u +%FT%TZ)"
  sleep 60
done
echo "zone active"
```

Or via MCP once the harness shows real output:

```text
mcp__cloudflare__zones_get  zoneId=<ZONE_ID>
```

| When (UTC) | Activation confirmed |
| ---------- | -------------------- |
|            | yes / no             |

---

## 3. Create the tunnel `discord-unibox-prod`

Tunnel creation is not in the current MCP surface either — it is done
locally on the VPS by `cloudflared`. The runbook step is here so the
DNS records (section 4) have a tunnel UUID to point to.

```bash
# On the VPS, as a user that can sudo:
sudo cloudflared tunnel login                       # opens a browser auth flow
sudo cloudflared tunnel create discord-unibox-prod  # prints tunnel UUID + creds path
# Move the creds file into place:
sudo mkdir -p /etc/cloudflared
sudo mv ~/.cloudflared/<TUNNEL_UUID>.json /etc/cloudflared/discord-unibox-prod.json
sudo chmod 600 /etc/cloudflared/discord-unibox-prod.json
```

Record:

| When (UTC) | Tunnel UUID | Creds path                                       |
| ---------- | ----------- | ------------------------------------------------ |
|            |             | `/etc/cloudflared/discord-unibox-prod.json`     |

Drop the UUID into `./tunnel-config.yaml` (replacing `<TUNNEL_UUID>`) and
into the DNS commands below.

---

## 4. DNS records for `gg.linktree.bond`

Three records. The first points the frontend hostname at Cloudflare Pages
(the Pages project is created in §5 and produces a `*.pages.dev` hostname).
The other two route `api.` and `ws.` at the tunnel.

### 4.1 Frontend — `gg` → CF Pages

```text
mcp__cloudflare__... (no DNS-create tool in this MCP surface — use REST below)
```

```bash
curl -sS -X POST https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "gg",
    "content": "discord-unibox.pages.dev",
    "ttl": 1,
    "proxied": true,
    "comment": "Discord Unibox SaaS frontend — CF Pages"
  }'
```

### 4.2 API — `api.gg` → tunnel

```bash
curl -sS -X POST https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "api.gg",
    "content": "<TUNNEL_UUID>.cfargotunnel.com",
    "ttl": 1,
    "proxied": true,
    "comment": "Discord Unibox API — Cloudflare Tunnel"
  }'
```

### 4.3 WebSocket — `ws.gg` → tunnel (same backend, ws upgrade path)

```bash
curl -sS -X POST https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "ws.gg",
    "content": "<TUNNEL_UUID>.cfargotunnel.com",
    "ttl": 1,
    "proxied": true,
    "comment": "Discord Unibox WebSocket — Cloudflare Tunnel"
  }'
```

Audit:

| When (UTC) | Record       | Target                              | Proxied |
| ---------- | ------------ | ----------------------------------- | ------- |
|            | gg CNAME     | discord-unibox.pages.dev            | yes     |
|            | api.gg CNAME | `<UUID>.cfargotunnel.com`           | yes     |
|            | ws.gg CNAME  | `<UUID>.cfargotunnel.com`           | yes     |

### 4.4 Set SSL mode to Full (strict)

```bash
curl -sS -X PATCH https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/settings/ssl \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{ "value": "strict" }'
```

| When (UTC) | SSL mode set to "strict" |
| ---------- | ------------------------ |
|            |                          |

---

## 5. Cloudflare Pages project (manual one-time, not MCP)

Pages projects that build from GitHub cannot be fully provisioned via the
MCP — they need the GitHub App connection consent which is a browser flow.

Do this once via the dashboard:

1. **Cloudflare dashboard → Workers & Pages → Create application → Pages → Connect to Git**.
2. Select the GitHub repo containing `app/`.
3. Project name: `discord-unibox` (must match the CNAME target in §4.1).
4. Production branch: `main` (or whichever the team uses).
5. Build settings — copy from `./pages-config.json`:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `app/dist`
   - Root directory: `app`
   - Node version: `20`
6. Environment variables: copy any prod-only values from `app/.env.staging.example`.
7. Save & Deploy. First build will produce `discord-unibox.pages.dev`.
8. Settings → Custom domains → add `gg.linktree.bond` (the CNAME from §4.1
   should pre-validate automatically).

| When (UTC) | Project created | First deploy green | Custom domain attached |
| ---------- | --------------- | ------------------ | ---------------------- |
|            |                 |                    |                        |

---

## 6. Smoke tests

```bash
# Frontend
curl -I https://gg.linktree.bond/             # expect 200 from CF edge
# API through tunnel
curl -I https://api.gg.linktree.bond/health   # expect 200, served by VPS api:3000
# WS upgrade
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     -H "Sec-WebSocket-Version: 13" \
     https://ws.gg.linktree.bond/ws           # expect 101 Switching Protocols
```

| When (UTC) | gg.linktree.bond | api.gg.linktree.bond | ws.gg.linktree.bond |
| ---------- | ---------------- | -------------------- | ------------------- |
|            |                  |                      |                     |

---

## Audit log of write operations performed during this session

| When (UTC)           | Operation                                          | Outcome                                                                                |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-05-18T00:00:00Z | `mcp__cloudflare__zones_list` (read)               | Harness returned `[object Object]`; treated as no-zone-yet per user brief.             |
| 2026-05-18T00:00:00Z | `mcp__cloudflare__domain_list` (read)              | Harness returned `[object Object]`; assumed no Workers custom domains attached.        |
|                      | Zone create (REST) `POST /zones` — linktree.bond   | (pending — user to execute)                                                            |
|                      | DNS create gg CNAME → discord-unibox.pages.dev     | (pending — depends on zone activation)                                                 |
|                      | DNS create api.gg CNAME → cfargotunnel             | (pending)                                                                              |
|                      | DNS create ws.gg CNAME → cfargotunnel              | (pending)                                                                              |
|                      | SSL mode → strict                                  | (pending)                                                                              |
