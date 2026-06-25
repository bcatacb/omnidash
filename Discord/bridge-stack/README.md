# bridge-stack

Discord multi-account bridge runtime. One `mautrix-discord` container per
Discord account, all talking to a shared minimal Matrix homeserver shim
("hungryshim") and a shared Postgres + NATS. An HTTP orchestrator
manages the lifecycle.

## Architecture

```
                                 +---------------------+
   POST /accounts ───────────────▶│    orchestrator    │ (Node/TS, :7000)
   POST /accounts/:id/login       │  - spawns bridges  │
   GET  /accounts/:id/status      │  - writes configs  │
   DEL  /accounts/:id             │  - drops schemas   │
                                 +----------┬----------+
                                            │ docker.sock
                  +-------------------------┼-------------------------+
                  │                         │                         │
       docker run │              docker run │              docker run │
                  ▼                         ▼                         ▼
     +---------------------+   +---------------------+   +---------------------+
     │ bridge-<acct_1>     │   │ bridge-<acct_2>     │   │ bridge-<acct_N>     │
     │ mautrix-discord     │   │ mautrix-discord     │   │ mautrix-discord     │
     │ (Go + discordgo)    │   │                     │   │                     │
     └─────────┬───────────┘   └──────────┬──────────┘   └──────────┬──────────┘
               │                          │                         │
               │  Matrix C-S (HTTP)       │                         │
               ▼                          ▼                         ▼
     +-----------------------------------------------------------------+
     │                        hungryshim (Go, :8008)                  │
     │   minimal Matrix C-S + appservice subset                       │
     │   logs every unhandled path so you know what to implement next │
     +-----------------------------------------------------------------+
                                       │
                                       ▼
                +---------------------------------------------+
                │ Postgres 16     (per-account schema)        │
                │ NATS 2 (JetStream — outbound event bus)     │
                +---------------------------------------------+
```

The shared services live in `docker-compose.yml`. **Bridge containers
are NOT in compose** — they are spawned on demand by the orchestrator
via the mounted Docker socket. Each gets its own per-account config and
its own Postgres schema (`acct_<account_id>`).

## Layout

```
bridge-stack/
├── README.md
├── docker-compose.yml
├── docker-compose.override.example.yml
├── orchestrator/             # Node + TypeScript HTTP control plane
├── hungryshim/               # Go shim implementing the Matrix subset
└── templates/                # config.yaml + registration.yaml templates
```

## Running

```bash
# 1. Bring up shared services (nats, postgres, hungryshim, orchestrator).
cp docker-compose.override.example.yml docker-compose.override.yml  # optional
docker compose up -d --build

# 2. Provision a Discord account.
curl -X POST http://localhost:7000/accounts \
     -H "content-type: application/json" \
     -d '{"tenant_id":"acme","label":"acme-sales-1"}'
# -> { "account_id": "abc123...", "tenant_id": "acme", "status": "ready" }

# 3. Login with a Discord user token (scraped from browser).
curl -X POST http://localhost:7000/accounts/abc123/login \
     -H "content-type: application/json" \
     -d '{"token":"YOUR_DISCORD_TOKEN","kind":"user"}'

# 4. Inspect status.
curl http://localhost:7000/accounts/abc123/status

# 5. Tear down.
curl -X DELETE http://localhost:7000/accounts/abc123
```

## Ports

| Service       | Internal | Default external | Env var          |
|---------------|----------|------------------|------------------|
| orchestrator  | 7000     | 7000             | `ORCH_PORT`      |
| hungryshim    | 8008     | 8008             | `HUNGRY_PORT`    |
| postgres      | 5432     | 5432             | `POSTGRES_PORT`  |
| nats client   | 4222     | 4222             | `NATS_PORT`      |
| nats monitor  | 8222     | 8222             | `NATS_MONITOR_PORT` |
| bridge-*      | 29334    | (not exposed)    | n/a              |

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `POSTGRES_USER`     | `bridge`        | shared Postgres user |
| `POSTGRES_PASSWORD` | `bridge`        | shared Postgres password |
| `POSTGRES_DB`       | `bridge`        | shared db (schemas per-account) |
| `HUNGRY_DOMAIN`     | `bridge.local`  | fake Matrix server_name |
| `ORCH_BRIDGE_IMAGE` | `dock.mau.dev/mautrix/discord:latest` | mautrix-discord image tag |
| `ORCH_PORT`         | `7000`          | orchestrator HTTP port |

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST   | `/accounts`               | `{tenant_id, label?}`     | Provision a bridge + container |
| GET    | `/accounts`               | -                          | List all accounts |
| GET    | `/accounts/:id`           | -                          | Get one account record |
| POST   | `/accounts/:id/login`     | `{token, kind?}`           | Pipe Discord token to bridge |
| GET    | `/accounts/:id/status`    | -                          | Container state + last status webhook payload |
| DELETE | `/accounts/:id`           | -                          | Stop container, drop schema, delete config |
| POST   | `/internal/status`        | bridge → here              | Receives `status_endpoint` POSTs from bridges |
| GET    | `/healthz`                | -                          | Liveness probe |

## Troubleshooting

### hungryshim is returning 404

`hungryshim` only implements the small subset of the Matrix C-S API
mautrix-discord is known to call. When it hits an unimplemented
endpoint it logs a line like:

```
hungryshim: unhandled PUT /_matrix/client/r0/rooms/!xyz/state/m.room.topic/
```

Add the route in `hungryshim/main.go` and a matching handler in
`hungryshim/handlers/csapi.go` (most can return a stub success body).
There is a `NOT IMPLEMENTED` list at the top of `main.go` enumerating
common candidates.

### Bridge container won't start

```bash
docker logs bridge-<account_id>
```

The most common causes are:

- `homeserver.address` unreachable from the bridge container — make
  sure it's on the `bridgenet` network and `hungryshim` resolves.
- Postgres schema not yet created — re-run `POST /accounts` or check
  the orchestrator logs.
- `as_token` / `hs_token` mismatch — the orchestrator writes
  `/etc/hungry/tokens.json` on every account change; verify the file is
  present and contains the account's tokens.

### Login fails silently

`/accounts/:id/login` execs `mautrix-discord login-token` inside the
container with the token piped to stdin. If the bridge CLI doesn't
expose that command in your image version you'll need to update
`orchestrator/src/docker.ts:execLoginToken` to drive login via the
bridge's management room instead.

## Known gaps

See the `NOT IMPLEMENTED` block at the top of `hungryshim/main.go` for
the full list, but in short:

1. `/_matrix/media/*` — no media upload/download, so attachments in
   either direction will fail until added.
2. Appservice WebSocket transport — handler returns `501`. We currently
   ship configs with `websocket: false` to force HTTP-push fallback.
3. Login flow assumes the bridge image exposes a `login-token` CLI;
   if not, drive login via the provisioning HTTP API instead.
4. Postgres durability for hungryshim — store is in-memory; rooms /
   events / profiles are lost on restart.
5. No NATS publisher yet — outbound events are stored but not yet
   re-published on `discord.<tenant>.<account>.message`. Add an
   appservice sink hook.
