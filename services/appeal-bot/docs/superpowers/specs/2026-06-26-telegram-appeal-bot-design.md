# Telegram Appeal Bot — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Purpose

Automate appealing **@SpamBot messaging limits** for the user-account fleet (20+ accounts)
belonging to an advertising business. When one of our own Telegram user accounts gets
limited, the tool talks to **@SpamBot** via that account's authenticated MTProto session,
clicks the official "But I'll never do it again!" appeal button, parses the outcome, and
reports it to operators.

### Scope boundaries (non-negotiable)

- Operates **only** on session files we already own, provided by our CRM.
- Uses **only** Telegram's official appeal channel (@SpamBot).
- **No** account creation, **no** ban evasion / replacement bots, **no** flooding of
  support. Anything @SpamBot refuses is escalated to a human, not retried blindly.
- English-language @SpamBot UI assumed.

### Out of scope

- Bot bans via @BotSupport (human conversation, no API).
- Phone/account deactivation appeals via email.
- Authentication / onboarding flows — sessions already exist in the CRM.

## Architecture

Single async Python service (Approach 1), structured as focused units:

| Unit | Responsibility | Depends on |
|---|---|---|
| `SessionProvider` | Resolve `account_id → .session` path from CRM session dir (read-only); open a Telethon client. | config (session dir, `api_id`/`api_hash`) |
| `SpamBotClient` | Run the @SpamBot conversation: check status, click appeal button, parse outcome. Returns a structured `SpamBotResult`. | a Telethon client |
| `AppealOrchestrator` | Decide whether to appeal (cooldown/backoff), invoke `SpamBotClient`, persist, notify. | store, SpamBotClient, notifier |
| `Store` (SQLite) | Account operational state + appeal audit log. | — |
| `WebhookServer` (aiohttp) | `POST /appeal {account_id}` reactive trigger from CRM. | orchestrator |
| `Scheduler` | Periodic safety-net sweep over due accounts. | orchestrator, store |
| `ControlBot` | Telegram bot: commands + push notifications. | orchestrator, store |

### Data flow

trigger (webhook / sweep / bot command) → `AppealOrchestrator` checks cooldown →
`SessionProvider` opens client → `SpamBotClient` runs flow → result persisted to `Store`
→ `ControlBot` notifies operators (+ optional callback to CRM).

### Triggers

- **Reactive (primary):** CRM/sending system calls `POST /appeal {account_id}` when it
  sees a limit error (`PEER_FLOOD`, etc.).
- **Scheduled sweep (safety net):** low-frequency pass over accounts that are due.
- **Manual:** operator command in the control bot.

## @SpamBot interaction (core flow)

`SpamBotClient` assumes the English UI and is deliberately tolerant of wording changes:

1. Send `/start` to `@SpamBot`; wait for reply (timeout ~30s).
2. Classify the reply by keywords:
   - **Free** — "no limits are currently applied" → status `free`.
   - **Limited** — "your account is now limited" / "flagged" → expect an inline appeal
     button ("But I'll never do it again!").
   - **Unknown** — unparseable → captured raw, status `unknown`, escalated to human.
3. If limited and an appeal button exists → click it, wait for the follow-up.
4. Classify the follow-up:
   - **Lifted** — "I've lifted the limitations" / "no longer limited" → `lifted`.
   - **Refused** — "can't help" / "blocked" / asks to email `recover@telegram.org`
     → `refused`, escalate with raw text.
   - **Backoff** — "used some buttons too often" → `backoff`, schedule a later retry.
5. Always persist the **raw text** of every @SpamBot message for audit and parser tuning.

**Principle:** the parser never guesses success. Unrecognized output becomes
`unknown`/`refused` and is escalated, never silently marked resolved.

## Data model (SQLite)

```
accounts
  account_id      TEXT PRIMARY KEY      -- matches CRM id
  phone           TEXT
  session_path    TEXT                  -- resolved .session file
  last_status     TEXT                  -- free|limited|lifted|refused|unknown
  last_checked_at INTEGER
  cooldown_until  INTEGER               -- no appeal attempts before this
  consec_failures INTEGER DEFAULT 0     -- drives backoff
  enabled         INTEGER DEFAULT 1

appeals
  id              INTEGER PRIMARY KEY
  account_id      TEXT
  created_at      INTEGER
  trigger         TEXT                  -- webhook|sweep|manual
  sb_status       TEXT                  -- parsed status
  action          TEXT                  -- checked|clicked_appeal|none
  outcome         TEXT                  -- free|lifted|refused|backoff|unknown|error
  raw_text        TEXT                  -- full @SpamBot transcript
```

`accounts` is seeded/synced from the CRM (phone + session_path); the tool owns only
operational state. `appeals` is the immutable audit log.

## Guardrails

- **Per-account cooldown:** no second appeal within a configurable window (default 24h).
- **Exponential backoff:** on `refused`/`backoff`, `cooldown_until` grows
  (24h → 48h → 96h…, capped); `consec_failures` drives it.
- **Global rate limit + jitter:** cap concurrent @SpamBot conversations (default 1–2)
  and space them out so the fleet doesn't fire simultaneously.
- **Refused → human:** never blindly retried; operator notified with transcript.
- **Strictly session-scoped:** only operates on provided session files.

## Config & CRM integration

Config via `.env` / `config.toml`:
`api_id`, `api_hash`, `bot_token`, `session_dir`, `sqlite_path`, webhook host/port +
shared secret, sweep interval, cooldown defaults, operator chat IDs.

- **Reactive in:** `POST /appeal {account_id}` with a shared-secret header.
- **Optional callback out:** on outcome, `POST` to a configured CRM URL so the CRM can
  update account state.
- **Account sync:** a `sync` step / `POST /accounts` imports
  `account_id → phone, session_path` from the CRM.

## Control bot commands

- `/status` — fleet summary (counts by status).
- `/status <account_id>` — one account's current state + last appeal.
- `/appeal <account_id>` — force an appeal now (respects cooldown unless `--force`).
- `/accounts` — list managed accounts.
- `/history <account_id>` — recent appeal outcomes.
- Push notifications on: limit detected, appeal lifted, appeal refused/unknown (escalation).

## Testing

- `SpamBotClient` parser: unit-tested against captured real transcripts
  (free / limited / lifted / refused / too-many-buttons / garbage) — no live Telegram.
- `AppealOrchestrator`: cooldown/backoff logic tested with a fake clock + in-memory store.
- `WebhookServer` + `ControlBot`: auth and command handlers tested with a mocked orchestrator.
- Live MTProto calls isolated behind `SessionProvider`/`SpamBotClient` so the rest tests offline.

## Stack

Python 3.11+, Telethon (MTProto sessions + control bot), SQLite, aiohttp.
