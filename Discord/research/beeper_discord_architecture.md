# Beeper / mautrix-discord — Architecture Brief for a Discord Multi-Account SaaS

## 1. Beeper repo inventory

Beeper does **not** publish a `beeper/discord-bridge` repo. They consume the upstream `mautrix/discord` bridge. The relevant Beeper repos are:

- **github.com/beeper/bridge-manager** (`bbctl`) — Go CLI that downloads, configures, registers and runs official mautrix bridges (including `mautrix-discord`) against Beeper's hosted Matrix server. Per the README: *"This tool can not be used with any other Matrix homeserver, like self-hosted Synapse instances. It is only for connecting self-hosted bridges to the beeper.com server."*
- **github.com/beeper/discordgo** — Beeper's fork of bwmarrin/discordgo, used by `mautrix-discord`. Description: *"Discord API library in Go for mautrix-discord."*
- **github.com/beeper/mautrix-asmux** — Legacy (2020–2022) appservice multiplexer. **Deprecated**; Beeper replaced it with internal `hungryserv` / `megahungry` / `megabridge`, which are **not** open source.
- **github.com/beeper/synapse**, **synapse-fork** — Their Synapse forks (not directly relevant).
- **github.com/beeper/dummybridge** — Test bridge generator.

The real upstream is **github.com/mautrix/discord** + **github.com/mautrix/go** (the `bridgev2` framework).

## 2. mautrix-discord — how it works

**Stack:** Go, built on `discordgo` (gateway WebSocket + REST), exposes itself as a Matrix Application Service. State in SQLite or Postgres (`database.type` in `example-config.yaml`).

**Login flow** (docs.mau.fi/bridges/go/discord/authentication.html). Three methods, all driver-bot commands in a DM with `@discordbot:server`:
1. `login-qr` — scan with Discord mobile app. Docs warn: *"QR code login is considered a self-bot and is forbidden by Discord. It can result in an account termination."*
2. `login-token user <token>` — paste a user token scraped from the browser's Authorization header. Same self-bot risk class.
3. `login-token bot <token>` — official Discord bot from the developer portal. Safe but no DMs / can't read arbitrary servers.

For an outreach SaaS, **user-token is the only viable mode** — bots can't initiate DMs to arbitrary users.

**State per user (`/database/*.go`):** `user`, `puppet`, `portal`, `userportal`, `message`, `reaction`, `guild`, `role`, `thread`, `file` (attachment cache). Plus `upgrades/` for schema migrations.

**Inbound (Discord → Matrix):** the bridge holds a persistent **Discord gateway WebSocket** as that user. Events arrive in real time → bridge maps `channel_id` to a "portal" (Matrix room) → posts as a "puppet" Matrix user via the appservice API. Includes message_create, edits, deletes (Discord→Matrix only per ROADMAP), reactions (unicode both ways; custom emoji partial), typing (DM-only Discord→Matrix), presence, threads (auto-join + backfill), attachments.

**Outbound (Matrix → Discord):** Matrix homeserver pushes events to the appservice HTTP endpoint (or via appservice WebSocket — see §4); bridge converts the Matrix event back to a discordgo REST call (`POST /channels/{id}/messages`, etc.).

**DM vs guild:** DM portals auto-create on first message; guilds are opt-in (`guilds bridge <id>`). Group DMs supported Discord→Matrix.

**Not supported:** voice, stickers (partial), Matrix→Discord typing in guilds is partial, no message-deletion Matrix→Discord per ROADMAP.

## 3. Multi-account orchestration

There is **no shared multi-tenant runtime in the open-source stack**. Beeper's production multiplexer (`megabridge` / `megahungry`) is private.

`bbctl run` (from `cmd/bbctl/run.go`) is the public template: one OS process per bridge. Layout:

- Base dir: `~/.config/beeper/data/bridges/`
- Per bridge: `{dataDir}/{sh-name}/config.yaml`, `logs/`, optional Python venv
- Shared binaries: `{dataDir}/binaries/`

So the de-facto pattern for "many user accounts on one host" is **one `mautrix-discord` process per Discord account**, each with its own DB and config. Confirmed by the bridgev2 blog post (mau.fi/blog/2024-h1-mautrix-updates) — Beeper's own infra still runs *"hungryserv and bridges in a single-tenant model"* and `megabridge` (running many bridges in one process) is a stated future direction, not yet shipped.

For our SaaS this implies **process- or container-per-account isolation** is the supported model today.

## 4. Matrix homeserver requirement — can we skip it?

**Officially, no.** `docs.mau.fi/bridges/go/setup.html`: *"A Matrix homeserver that supports application services (e.g. Synapse). You need access to register an appservice."* The example-config has a mandatory `homeserver: { address, domain }` plus `as_token` / `hs_token`.

**Practical paths:**
1. **Run a minimal homeserver** (Synapse or Dendrite) alongside bridges. Adds operational weight but is the path of least resistance.
2. **Implement a fake homeserver shim.** Since bridgev2 supports **appservice websockets** (per Tulir's blog: *"All bridgev2 bridges support appservice websockets, so using bbctl proxy is not necessary"*), our backend could speak just the small subset of the C-S API mautrix-discord actually calls (login, room create, send, redact, react, upload media). This is exactly what Beeper's `hungryserv` does — *"hungryserv does not implement the entire Matrix client-server API."* Non-trivial but feasible — call it 2–3 weeks of work for a Go shim.
3. **Fork mautrix-discord** and short-circuit the Matrix layer entirely. Hostile to upstream; lose all bridge updates. Not recommended.

The `appservice` config also has two pre-built escape hatches: `status_endpoint` (connection state POSTs) and `message_send_checkpoint_endpoint` (per-message delivery POSTs). Useful as side-channels, but not a substitute for the C-S API.

**Recommendation:** option 1 for v1 (single small Synapse, treat it as a black-box bus), option 2 once we have scale pressure.

## 5. ToS / detection risk profile

Mautrix-discord uses **`discordgo`**, i.e., it speaks the **real Discord gateway WebSocket and REST API** as a regular client. No browser/puppeteer. It does not specifically mimic the official client's `super_properties` / `X-Super-Properties` fingerprints — which is how Discord most commonly fingerprints selfbots — though Beeper's discordgo fork may set realistic defaults (worth a code audit).

Official upstream stance: *"Discord may ban users who are too suspicious"* and recommends bots for risk-averse users. Community report: *"we haven't heard of any cases of users getting banned for using their user token with a Discord bridge, you do so at your own risk."*

Known higher-risk vectors: (a) login via `login-qr` (treated as selfbot), (b) high message-send rates, (c) joining many servers fast, (d) reactions/typing from headless sessions, (e) operating from datacenter IPs.

**For a SaaS we should:** route each account through residential/mobile proxies, throttle aggressively, possibly patch the discordgo fork to set up-to-date `super_properties` matching a current desktop client build, and warm accounts gradually. Treat account loss as expected baseline cost.

## 6. SaaS integration shape — recommended IPC pattern

Concrete recommended topology:

```
[Our SaaS backend (Node/Go)]
        |
        |  (a) gRPC/HTTP control plane: provision account, login, send msg
        |  (b) event stream: NATS / Redis Streams / Postgres LISTEN
        |
[Per-account orchestrator] -- spawns -->  [mautrix-discord process]  --AS websocket-->  [minimal Synapse OR hungryserv-shim]
                                                  |                                              |
                                                  +--> Postgres (per-tenant schema)              +--> our event tap (room.message → NATS subject)
```

- **Process-per-account**, packaged as a container; orchestrator (k8s Job, Nomad, or systemd-per-tenant) owns lifecycle.
- **Per-tenant Postgres schema** (cheap isolation, easy backups) rather than per-tenant DB instance.
- **Event ingestion:** instead of polling, tap the appservice transaction stream. Cleanest: run a tiny "AS sink" service that registers itself with the homeserver covering all bridge user-id namespaces; every `m.room.message` from any bridge ghost gets POSTed to it → re-published on NATS subject `discord.{tenant}.{account}.message`. The unibox subscribes.
- **Sending:** call the bridge's `provisioning` HTTP API (config section `appservice.provisioning`) or, simpler, send a Matrix event into the portal room from a backend Matrix client — bridge converts and ships it to Discord.
- Use the `status_endpoint` POST for connection-state UI ("account disconnected / captcha / banned").

This keeps mautrix-discord untouched and upgrade-clean; all SaaS-specific logic lives in the orchestrator + AS sink.

## 7. Open questions / unknowns

- **discordgo fingerprint freshness.** Need to audit whether Beeper's discordgo fork updates `super_properties` / client build numbers. If stale, our ban rate will spike.
- **Captcha handling.** Login docs say QR login *"may encounter CAPTCHAs which are currently not supported."* User-token login presumably skips initial CAPTCHA but mid-session challenges are undocumented — need to test.
- **Token rotation.** Discord rotates user tokens on password change / new device. We need to detect 401 from gateway and prompt the customer to re-paste; bridge has no built-in flow for that on token-auth.
- **megabridge timeline.** Tulir's roadmap mentions in-process multi-tenancy but ships nothing public yet. If/when this lands, our process-per-account model could collapse to one process per host.
- **hungryserv-shim scope.** Unverified exactly which C-S endpoints mautrix-discord calls. Need to instrument a run against a logging proxy to enumerate them before committing to building a shim.
- **Storage estimate per account.** No public number. Rough order-of-magnitude from schema: a few KB per portal, ~1 KB per cached message + attachment metadata (files are streamed, not stored). An account in 50 DMs + 20 guilds with 30-day backfill ≈ 50–200 MB. Need empirical measurement.
- **Rate limit sharing.** If one user is in N guilds, Discord's per-route limits apply per-token; discordgo handles backoff but under SaaS-scale aggregated sending we may hit global limits — model after first deploy.
- **Encryption.** Bridge supports MSC2659 / Olm end-to-end encryption to Matrix clients. Irrelevant if we own both ends; turn off for simplicity.

---
Source files / docs cited: `github.com/mautrix/discord/{README.md, ROADMAP.md, example-config.yaml, database/*.go, remoteauth/}`, `docs.mau.fi/bridges/go/{setup.html, discord/authentication.html}`, `github.com/beeper/bridge-manager/{README.md, cmd/bbctl/run.go, bridgeconfig/bridgeconfig.go}`, `github.com/beeper/mautrix-asmux/README`, `mau.fi/blog/2024-h1-mautrix-updates/`, `etke.cc/help/bridges/mautrix-discord`.
