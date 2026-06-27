# Appeal Bot

Automates appealing @SpamBot messaging limits for a fleet of owned Telegram
user accounts. Operates only on session files you provide, only via Telegram's
official @SpamBot appeal flow. No account creation, no ban evasion.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env   # then edit .env
```

Fill in `.env`:
- `APP_API_ID` / `APP_API_HASH` from https://my.telegram.org
- `APP_BOT_TOKEN` from @BotFather (the control/notification bot)
- `APP_SESSION_DIR` pointing at the CRM's `.session` files
- `APP_OPERATOR_CHAT_IDS` — your Telegram user id(s)
- `APP_WEBHOOK_SECRET` — shared secret the CRM sends in `X-Auth-Token`

## Run

```bash
python -m appeal_bot.app
```

## Reactive trigger (from the CRM)

```bash
curl -X POST http://HOST:8080/appeal \
  -H "X-Auth-Token: $APP_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"account_id": "acc1"}'
```

## Control bot commands

- `/status` — fleet summary
- `/status <account_id>` — one account
- `/appeal <account_id> [--force]` — appeal now
- `/accounts` — list accounts
- `/history <account_id>` — recent outcomes

## Tests

```bash
python -m pytest -v
```
