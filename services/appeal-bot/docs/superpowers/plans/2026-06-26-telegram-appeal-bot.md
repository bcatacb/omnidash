# Telegram Appeal Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single async Python service that automates appealing @SpamBot messaging limits for a fleet of 20+ owned Telegram user accounts, with reactive + scheduled + manual triggers, cooldown/backoff guardrails, a SQLite audit log, and a Telegram control/notification bot.

**Architecture:** One async process. A pure parser classifies @SpamBot replies; a `SpamBotClient` drives the conversation via an injected Telethon `Conversation`; a `SessionProvider` opens read-only `.session` files from the CRM; an `AppealOrchestrator` enforces cooldown/backoff and persists results to a SQLite `Store`; an aiohttp `WebhookServer`, a `Scheduler` sweep, and a Telethon `ControlBot` are the three trigger surfaces. Live MTProto is isolated behind `SessionProvider`/`SpamBotClient` so everything else tests offline.

**Tech Stack:** Python 3.11+, Telethon, aiohttp, SQLite (stdlib `sqlite3`), pytest + pytest-asyncio.

---

## File Structure

```
AppellantBot/
  pyproject.toml                     # deps + pytest config
  .env.example                       # config template
  src/appeal_bot/
    __init__.py
    config.py                        # Config dataclass + from_env()
    models.py                        # Status/Trigger enums, dataclasses, SpamBotResult, AppealOutcome
    parser.py                        # pure classify_status() / classify_followup()
    store.py                         # SQLite Store (accounts + appeals)
    spambot_client.py                # SpamBotClient.run(conv) -> SpamBotResult
    session_provider.py              # SessionProvider.conversation(account) ctx mgr
    notifier.py                      # format_outcome() + Notifier protocol + TelegramNotifier
    orchestrator.py                  # AppealOrchestrator.appeal(...) cooldown/backoff
    webhook.py                       # aiohttp WebhookServer (POST /appeal)
    control_bot.py                   # handle_command() dispatcher + ControlBot wiring
    scheduler.py                     # Scheduler.sweep_once(now) + run loop
    app.py                           # wiring + main() entrypoint
  tests/
    test_parser.py
    test_store.py
    test_spambot_client.py
    test_orchestrator.py
    test_notifier.py
    test_webhook.py
    test_control_bot.py
    test_scheduler.py
```

---

## Task 1: Project scaffold + config

**Files:**
- Create: `pyproject.toml`
- Create: `.env.example`
- Create: `src/appeal_bot/__init__.py`
- Create: `src/appeal_bot/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "appeal-bot"
version = "0.1.0"
description = "Automate @SpamBot limit appeals for owned Telegram accounts"
requires-python = ">=3.11"
dependencies = [
    "telethon>=1.36",
    "aiohttp>=3.9",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Create `.env.example`**

```bash
# MTProto app credentials from https://my.telegram.org
APP_API_ID=123456
APP_API_HASH=0123456789abcdef0123456789abcdef
# Control/notification bot token from @BotFather
APP_BOT_TOKEN=123456:ABC-DEF
# Directory containing the CRM's .session files
APP_SESSION_DIR=/data/crm/sessions
# SQLite state file
APP_SQLITE_PATH=/data/appeal-bot/state.db
# Reactive webhook
APP_WEBHOOK_HOST=0.0.0.0
APP_WEBHOOK_PORT=8080
APP_WEBHOOK_SECRET=change-me
# Scheduling / guardrails (seconds)
APP_SWEEP_INTERVAL_SECONDS=43200
APP_COOLDOWN_BASE_SECONDS=86400
APP_COOLDOWN_CAP_SECONDS=604800
APP_MAX_CONCURRENCY=2
# Comma-separated operator chat ids that may command the bot / receive alerts
APP_OPERATOR_CHAT_IDS=11111111,22222222
# Optional: POST outcomes back to the CRM
APP_CRM_CALLBACK_URL=
```

- [ ] **Step 3: Create `src/appeal_bot/__init__.py`** (empty marker)

```python
```

- [ ] **Step 4: Write the failing test** — `tests/test_config.py`

```python
from appeal_bot.config import Config


def test_from_env_parses_types(monkeypatch):
    env = {
        "APP_API_ID": "123456",
        "APP_API_HASH": "abc",
        "APP_BOT_TOKEN": "tok",
        "APP_SESSION_DIR": "/s",
        "APP_SQLITE_PATH": "/db.sqlite",
        "APP_WEBHOOK_SECRET": "secret",
        "APP_OPERATOR_CHAT_IDS": "11,22",
        "APP_MAX_CONCURRENCY": "3",
    }
    cfg = Config.from_env(env)
    assert cfg.api_id == 123456
    assert cfg.api_hash == "abc"
    assert cfg.operator_chat_ids == [11, 22]
    assert cfg.max_concurrency == 3
    # defaults applied
    assert cfg.cooldown_base_seconds == 86400
    assert cfg.crm_callback_url is None


def test_from_env_missing_required_raises(monkeypatch):
    import pytest
    with pytest.raises(KeyError):
        Config.from_env({})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `python -m pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.config'`

- [ ] **Step 6: Implement `src/appeal_bot/config.py`**

```python
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Config:
    api_id: int
    api_hash: str
    bot_token: str
    session_dir: str
    sqlite_path: str
    webhook_host: str = "0.0.0.0"
    webhook_port: int = 8080
    webhook_secret: str = ""
    sweep_interval_seconds: int = 43200
    cooldown_base_seconds: int = 86400
    cooldown_cap_seconds: int = 604800
    max_concurrency: int = 2
    operator_chat_ids: list[int] = field(default_factory=list)
    crm_callback_url: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Config":
        e = env if env is not None else os.environ

        def opt_int(key: str, default: int) -> int:
            return int(e[key]) if key in e and e[key] != "" else default

        ids_raw = e.get("APP_OPERATOR_CHAT_IDS", "").strip()
        ids = [int(x) for x in ids_raw.split(",") if x.strip()] if ids_raw else []
        callback = e.get("APP_CRM_CALLBACK_URL", "").strip() or None

        return cls(
            api_id=int(e["APP_API_ID"]),
            api_hash=e["APP_API_HASH"],
            bot_token=e["APP_BOT_TOKEN"],
            session_dir=e["APP_SESSION_DIR"],
            sqlite_path=e["APP_SQLITE_PATH"],
            webhook_host=e.get("APP_WEBHOOK_HOST", "0.0.0.0"),
            webhook_port=opt_int("APP_WEBHOOK_PORT", 8080),
            webhook_secret=e.get("APP_WEBHOOK_SECRET", ""),
            sweep_interval_seconds=opt_int("APP_SWEEP_INTERVAL_SECONDS", 43200),
            cooldown_base_seconds=opt_int("APP_COOLDOWN_BASE_SECONDS", 86400),
            cooldown_cap_seconds=opt_int("APP_COOLDOWN_CAP_SECONDS", 604800),
            max_concurrency=opt_int("APP_MAX_CONCURRENCY", 2),
            operator_chat_ids=ids,
            crm_callback_url=callback,
        )
```

- [ ] **Step 7: Run test to verify it passes**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS (2 passed)

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml .env.example src/appeal_bot/__init__.py src/appeal_bot/config.py tests/test_config.py
git commit -m "feat: project scaffold and config loader"
```

---

## Task 2: Domain models

**Files:**
- Create: `src/appeal_bot/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing test** — `tests/test_models.py`

```python
from appeal_bot.models import Status, Trigger, SpamBotResult, AccountRecord


def test_status_values_are_strings():
    assert Status.FREE.value == "free"
    assert Status.LIFTED.value == "lifted"
    assert Status.REFUSED == "refused"  # str-enum equality


def test_trigger_values():
    assert {t.value for t in Trigger} == {"webhook", "sweep", "manual"}


def test_spambot_result_defaults():
    r = SpamBotResult(status=Status.FREE, action="checked", raw_text="ok")
    assert r.status is Status.FREE
    assert r.action == "checked"
    assert r.raw_text == "ok"


def test_account_record_fields():
    a = AccountRecord(
        account_id="a1", phone="+100", session_path="/s/a1.session",
        last_status="free", last_checked_at=0, cooldown_until=0,
        consec_failures=0, enabled=True,
    )
    assert a.account_id == "a1"
    assert a.enabled is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.models'`

- [ ] **Step 3: Implement `src/appeal_bot/models.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Status(str, Enum):
    FREE = "free"          # no limits
    LIMITED = "limited"    # limited, appeal button present
    LIFTED = "lifted"      # appeal succeeded
    REFUSED = "refused"    # @SpamBot can't help -> email path
    BACKOFF = "backoff"    # "used buttons too often" -> retry later
    UNKNOWN = "unknown"    # unparseable -> escalate
    ERROR = "error"        # exception during flow


class Trigger(str, Enum):
    WEBHOOK = "webhook"
    SWEEP = "sweep"
    MANUAL = "manual"


@dataclass
class SpamBotResult:
    status: Status
    action: str            # checked | clicked_appeal | none
    raw_text: str          # full transcript joined with "\n---\n"


@dataclass
class AccountRecord:
    account_id: str
    phone: str
    session_path: str
    last_status: str
    last_checked_at: int
    cooldown_until: int
    consec_failures: int
    enabled: bool


@dataclass
class AppealOutcome:
    """Result of AppealOrchestrator.appeal()."""
    account_id: str
    skipped_reason: str | None     # None if an appeal actually ran
    result: SpamBotResult | None   # None if skipped
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_models.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/models.py tests/test_models.py
git commit -m "feat: domain models and enums"
```

---

## Task 3: @SpamBot reply parser (pure, the core)

**Files:**
- Create: `src/appeal_bot/parser.py`
- Test: `tests/test_parser.py`

- [ ] **Step 1: Write the failing test** — `tests/test_parser.py`

```python
from appeal_bot.models import Status
from appeal_bot.parser import classify_status, classify_followup

FREE = "Good news, no limits are currently applied to your account."
LIMITED = (
    "I'm afraid some Telegram users flagged your account as a scam or spam. "
    "Your account is now limited until 26 Jun 2026."
)
LIFTED = "Thank you. I've lifted the limitations on your account. You're good to go!"
REFUSED = (
    "Unfortunately, your account was blocked by our moderators. "
    "I can't help with that. Please write to recover@telegram.org"
)
BACKOFF = "Looks like you used some buttons too often. Please try again later."
GARBAGE = "\U0001F914 something totally unexpected here"


def test_status_free():
    assert classify_status(FREE) is Status.FREE


def test_status_limited():
    assert classify_status(LIMITED) is Status.LIMITED


def test_status_unknown():
    assert classify_status(GARBAGE) is Status.UNKNOWN


def test_followup_lifted():
    assert classify_followup(LIFTED) is Status.LIFTED


def test_followup_refused():
    assert classify_followup(REFUSED) is Status.REFUSED


def test_followup_backoff():
    assert classify_followup(BACKOFF) is Status.BACKOFF


def test_followup_unknown():
    assert classify_followup(GARBAGE) is Status.UNKNOWN


def test_case_insensitive():
    assert classify_status(FREE.upper()) is Status.FREE
    assert classify_followup(LIFTED.upper()) is Status.LIFTED
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.parser'`

- [ ] **Step 3: Implement `src/appeal_bot/parser.py`**

```python
from __future__ import annotations

from appeal_bot.models import Status


def classify_status(text: str) -> Status:
    """Classify the FIRST @SpamBot reply (status check)."""
    t = text.lower()
    if "no limits" in t or "no limitations" in t:
        return Status.FREE
    if "limited" in t or "flagged" in t or "restricted" in t or "spam" in t:
        return Status.LIMITED
    return Status.UNKNOWN


def classify_followup(text: str) -> Status:
    """Classify the reply AFTER clicking the appeal button."""
    t = text.lower()
    if "too often" in t or "try again later" in t:
        return Status.BACKOFF
    if (
        "can't help" in t
        or "cannot help" in t
        or "recover@telegram.org" in t
        or "blocked" in t
    ):
        return Status.REFUSED
    if "lifted" in t or "no longer limited" in t or "good to go" in t:
        return Status.LIFTED
    return Status.UNKNOWN
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_parser.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/parser.py tests/test_parser.py
git commit -m "feat: @SpamBot reply parser with transcript tests"
```

---

## Task 4: SQLite Store

**Files:**
- Create: `src/appeal_bot/store.py`
- Test: `tests/test_store.py`

- [ ] **Step 1: Write the failing test** — `tests/test_store.py`

```python
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "state.db"))
    s.init_db()
    return s


def test_upsert_and_get_account(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s/a1.session")
    acct = s.get_account("a1")
    assert acct.account_id == "a1"
    assert acct.phone == "+100"
    assert acct.session_path == "/s/a1.session"
    assert acct.enabled is True
    assert acct.last_status == "unknown"


def test_upsert_is_idempotent_and_updates_path(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/old.session")
    s.upsert_account("a1", "+100", "/new.session")
    assert s.get_account("a1").session_path == "/new.session"
    assert len(s.list_accounts()) == 1


def test_get_missing_account_returns_none(tmp_path):
    s = make_store(tmp_path)
    assert s.get_account("nope") is None


def test_set_account_state(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s.session")
    s.set_account_state("a1", "limited", 1000, 1000 + 86400, 1)
    a = s.get_account("a1")
    assert a.last_status == "limited"
    assert a.last_checked_at == 1000
    assert a.cooldown_until == 1000 + 86400
    assert a.consec_failures == 1


def test_record_and_list_appeals(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s.session")
    s.record_appeal("a1", 1000, "webhook", "limited", "clicked_appeal", "lifted", "raw")
    s.record_appeal("a1", 2000, "sweep", "free", "checked", "free", "raw2")
    rows = s.list_appeals("a1", limit=10)
    assert len(rows) == 2
    # newest first
    assert rows[0].created_at == 2000
    assert rows[0].outcome == "free"


def test_due_for_sweep(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("ready", "+1", "/r.session")
    s.upsert_account("cooling", "+2", "/c.session")
    s.upsert_account("off", "+3", "/o.session")
    s.set_account_state("ready", "free", 0, 500, 0)
    s.set_account_state("cooling", "refused", 0, 99999, 1)
    s.set_account_enabled("off", False)
    due = s.due_for_sweep(now=1000)
    ids = {a.account_id for a in due}
    assert ids == {"ready"}  # cooling still cooling, off disabled
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.store'`

- [ ] **Step 3: Implement `src/appeal_bot/store.py`**

```python
from __future__ import annotations

import sqlite3

from appeal_bot.models import AccountRecord


class AppealRow:
    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.account_id = row["account_id"]
        self.created_at = row["created_at"]
        self.trigger = row["trigger"]
        self.sb_status = row["sb_status"]
        self.action = row["action"]
        self.outcome = row["outcome"]
        self.raw_text = row["raw_text"]


class Store:
    def __init__(self, path: str):
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row

    def init_db(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                account_id      TEXT PRIMARY KEY,
                phone           TEXT,
                session_path    TEXT,
                last_status     TEXT DEFAULT 'unknown',
                last_checked_at INTEGER DEFAULT 0,
                cooldown_until  INTEGER DEFAULT 0,
                consec_failures INTEGER DEFAULT 0,
                enabled         INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS appeals (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id  TEXT,
                created_at  INTEGER,
                trigger     TEXT,
                sb_status   TEXT,
                action      TEXT,
                outcome     TEXT,
                raw_text    TEXT
            );
            """
        )
        self._conn.commit()

    def upsert_account(self, account_id: str, phone: str, session_path: str) -> None:
        self._conn.execute(
            """
            INSERT INTO accounts (account_id, phone, session_path)
            VALUES (?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                phone = excluded.phone,
                session_path = excluded.session_path
            """,
            (account_id, phone, session_path),
        )
        self._conn.commit()

    def _row_to_account(self, row: sqlite3.Row) -> AccountRecord:
        return AccountRecord(
            account_id=row["account_id"],
            phone=row["phone"],
            session_path=row["session_path"],
            last_status=row["last_status"],
            last_checked_at=row["last_checked_at"],
            cooldown_until=row["cooldown_until"],
            consec_failures=row["consec_failures"],
            enabled=bool(row["enabled"]),
        )

    def get_account(self, account_id: str) -> AccountRecord | None:
        row = self._conn.execute(
            "SELECT * FROM accounts WHERE account_id = ?", (account_id,)
        ).fetchone()
        return self._row_to_account(row) if row else None

    def list_accounts(self) -> list[AccountRecord]:
        rows = self._conn.execute(
            "SELECT * FROM accounts ORDER BY account_id"
        ).fetchall()
        return [self._row_to_account(r) for r in rows]

    def set_account_state(
        self,
        account_id: str,
        last_status: str,
        last_checked_at: int,
        cooldown_until: int,
        consec_failures: int,
    ) -> None:
        self._conn.execute(
            """
            UPDATE accounts SET
                last_status = ?, last_checked_at = ?,
                cooldown_until = ?, consec_failures = ?
            WHERE account_id = ?
            """,
            (last_status, last_checked_at, cooldown_until, consec_failures, account_id),
        )
        self._conn.commit()

    def set_account_enabled(self, account_id: str, enabled: bool) -> None:
        self._conn.execute(
            "UPDATE accounts SET enabled = ? WHERE account_id = ?",
            (1 if enabled else 0, account_id),
        )
        self._conn.commit()

    def record_appeal(
        self,
        account_id: str,
        created_at: int,
        trigger: str,
        sb_status: str,
        action: str,
        outcome: str,
        raw_text: str,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO appeals
                (account_id, created_at, trigger, sb_status, action, outcome, raw_text)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (account_id, created_at, trigger, sb_status, action, outcome, raw_text),
        )
        self._conn.commit()

    def list_appeals(self, account_id: str, limit: int = 10) -> list[AppealRow]:
        rows = self._conn.execute(
            """
            SELECT * FROM appeals WHERE account_id = ?
            ORDER BY created_at DESC, id DESC LIMIT ?
            """,
            (account_id, limit),
        ).fetchall()
        return [AppealRow(r) for r in rows]

    def due_for_sweep(self, now: int) -> list[AccountRecord]:
        rows = self._conn.execute(
            """
            SELECT * FROM accounts
            WHERE enabled = 1 AND cooldown_until <= ?
            ORDER BY last_checked_at ASC
            """,
            (now,),
        ).fetchall()
        return [self._row_to_account(r) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_store.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/store.py tests/test_store.py
git commit -m "feat: SQLite store for accounts and appeal log"
```

---

## Task 5: SpamBotClient conversation flow

The live flow is driven through an injected `Conversation`-like object exposing `send_message(text)` and `get_response()`, where each response exposes `.text` and an async `.click(...)`. This lets us test the flow with fakes; production passes a real Telethon `Conversation`.

**Files:**
- Create: `src/appeal_bot/spambot_client.py`
- Test: `tests/test_spambot_client.py`

- [ ] **Step 1: Write the failing test** — `tests/test_spambot_client.py`

```python
import pytest

from appeal_bot.models import Status
from appeal_bot.spambot_client import SpamBotClient, NoAppealButton

FREE = "Good news, no limits are currently applied to your account."
LIMITED = "Your account is now limited until tomorrow. Sorry about that."
LIFTED = "Thank you. I've lifted the limitations on your account."


class FakeResponse:
    def __init__(self, text, has_button=True):
        self.text = text
        self._has_button = has_button
        self.clicked = False

    async def click(self, **kwargs):
        if not self._has_button:
            raise NoAppealButton("no buttons")
        self.clicked = True
        return None


class FakeConversation:
    """Serves queued responses in order; records sent messages."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.sent = []

    async def send_message(self, text):
        self.sent.append(text)

    async def get_response(self):
        if not self._responses:
            raise AssertionError("no more responses queued")
        return self._responses.pop(0)


async def test_free_account_only_checks():
    conv = FakeConversation([FakeResponse(FREE)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.FREE
    assert result.action == "checked"
    assert conv.sent == ["/start"]


async def test_limited_clicks_button_and_lifts():
    first = FakeResponse(LIMITED)
    second = FakeResponse(LIFTED)
    conv = FakeConversation([first, second])
    result = await SpamBotClient().run(conv)
    assert first.clicked is True
    assert result.status is Status.LIFTED
    assert result.action == "clicked_appeal"
    assert FREE not in result.raw_text
    assert "limited" in result.raw_text.lower()
    assert "lifted" in result.raw_text.lower()


async def test_limited_without_button_is_unknown():
    conv = FakeConversation([FakeResponse(LIMITED, has_button=False)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.UNKNOWN
    assert result.action == "checked"


async def test_unparseable_first_reply_is_unknown():
    conv = FakeConversation([FakeResponse("???", has_button=False)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.UNKNOWN
    assert result.action == "checked"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_spambot_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.spambot_client'`

- [ ] **Step 3: Implement `src/appeal_bot/spambot_client.py`**

```python
from __future__ import annotations

from appeal_bot.models import SpamBotResult, Status
from appeal_bot.parser import classify_followup, classify_status


class NoAppealButton(Exception):
    """Raised by a response.click() when no inline button is present."""


def _join(parts: list[str]) -> str:
    return "\n---\n".join(parts)


class SpamBotClient:
    """Drives the @SpamBot conversation. `conv` must expose async
    send_message(text), get_response() -> resp, where resp has `.text`
    and async `.click(**kwargs)` (raising NoAppealButton if absent)."""

    def __init__(self, appeal_button_hint: str = "never"):
        self._hint = appeal_button_hint

    async def run(self, conv) -> SpamBotResult:
        await conv.send_message("/start")
        first = await conv.get_response()
        transcript = [first.text]

        status = classify_status(first.text)
        if status is not Status.LIMITED:
            # FREE or UNKNOWN: nothing to appeal
            return SpamBotResult(status=status, action="checked",
                                 raw_text=_join(transcript))

        # Limited: try to click the appeal button.
        try:
            await first.click(text=self._hint)
        except NoAppealButton:
            return SpamBotResult(status=Status.UNKNOWN, action="checked",
                                 raw_text=_join(transcript))

        follow = await conv.get_response()
        transcript.append(follow.text)
        outcome = classify_followup(follow.text)
        return SpamBotResult(status=outcome, action="clicked_appeal",
                             raw_text=_join(transcript))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_spambot_client.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/spambot_client.py tests/test_spambot_client.py
git commit -m "feat: SpamBotClient conversation flow"
```

---

## Task 6: SessionProvider (live MTProto, thin)

This unit is the only place that touches Telethon's network client. It is intentionally thin and not unit-tested against the live network; it is verified manually in Task 12. We test only its path resolution.

**Files:**
- Create: `src/appeal_bot/session_provider.py`
- Test: `tests/test_session_provider.py`

- [ ] **Step 1: Write the failing test** — `tests/test_session_provider.py`

```python
import pytest

from appeal_bot.models import AccountRecord
from appeal_bot.session_provider import SessionProvider


def make_account(path):
    return AccountRecord(
        account_id="a1", phone="+1", session_path=path,
        last_status="unknown", last_checked_at=0, cooldown_until=0,
        consec_failures=0, enabled=True,
    )


def test_resolve_uses_account_path_when_present(tmp_path):
    sess = tmp_path / "a1.session"
    sess.write_text("x")
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    assert sp.resolve_path(make_account(str(sess))) == str(sess)


def test_resolve_falls_back_to_dir_plus_id(tmp_path):
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    acct = make_account("")  # no explicit path
    expected = str(tmp_path / "a1.session")
    assert sp.resolve_path(acct) == expected


def test_resolve_missing_file_raises(tmp_path):
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    acct = make_account(str(tmp_path / "missing.session"))
    with pytest.raises(FileNotFoundError):
        sp.resolve_path(acct, must_exist=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_session_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.session_provider'`

- [ ] **Step 3: Implement `src/appeal_bot/session_provider.py`**

```python
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from appeal_bot.models import AccountRecord

SPAMBOT_PEER = "SpamBot"


class SessionProvider:
    """Opens read-only Telethon clients from CRM .session files and yields
    a conversation with @SpamBot."""

    def __init__(self, session_dir: str, api_id: int, api_hash: str,
                 conversation_timeout: int = 60):
        self._dir = session_dir
        self._api_id = api_id
        self._api_hash = api_hash
        self._timeout = conversation_timeout

    def resolve_path(self, account: AccountRecord, must_exist: bool = False) -> str:
        path = account.session_path or os.path.join(
            self._dir, f"{account.account_id}.session"
        )
        if must_exist and not os.path.exists(path):
            raise FileNotFoundError(path)
        return path

    @asynccontextmanager
    async def conversation(self, account: AccountRecord):
        # Imported lazily so the rest of the package tests without Telethon.
        from telethon import TelegramClient

        path = self.resolve_path(account, must_exist=True)
        # Telethon appends ".session"; strip it if present.
        base = path[:-len(".session")] if path.endswith(".session") else path
        client = TelegramClient(base, self._api_id, self._api_hash)
        await client.connect()
        try:
            async with client.conversation(
                SPAMBOT_PEER, timeout=self._timeout, exclusive=True
            ) as conv:
                yield _ConversationAdapter(conv)
        finally:
            await client.disconnect()


class _ConversationAdapter:
    """Adapts Telethon's Conversation to the interface SpamBotClient expects:
    send_message(text), get_response() -> resp with .text and async .click()."""

    def __init__(self, conv):
        self._conv = conv

    async def send_message(self, text):
        await self._conv.send_message(text)

    async def get_response(self):
        msg = await self._conv.get_response()
        return _ResponseAdapter(msg)


class _ResponseAdapter:
    def __init__(self, msg):
        self._msg = msg
        self.text = msg.message or ""

    async def click(self, **kwargs):
        from appeal_bot.spambot_client import NoAppealButton

        buttons = getattr(self._msg, "buttons", None)
        if not buttons:
            raise NoAppealButton("no inline buttons on @SpamBot message")
        try:
            # Prefer matching by hint text; fall back to the first button.
            await self._msg.click(**kwargs)
        except Exception:
            await self._msg.click(0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_session_provider.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/session_provider.py tests/test_session_provider.py
git commit -m "feat: SessionProvider with read-only session resolution"
```

---

## Task 7: Notifier (formatting + protocol)

**Files:**
- Create: `src/appeal_bot/notifier.py`
- Test: `tests/test_notifier.py`

- [ ] **Step 1: Write the failing test** — `tests/test_notifier.py`

```python
from appeal_bot.models import SpamBotResult, Status, AppealOutcome
from appeal_bot.notifier import format_outcome, should_alert


def test_format_lifted_outcome():
    res = SpamBotResult(Status.LIFTED, "clicked_appeal", "raw")
    out = AppealOutcome("a1", skipped_reason=None, result=res)
    msg = format_outcome(out)
    assert "a1" in msg
    assert "lifted" in msg.lower()


def test_format_skipped_outcome():
    out = AppealOutcome("a1", skipped_reason="cooldown", result=None)
    msg = format_outcome(out)
    assert "a1" in msg
    assert "cooldown" in msg.lower()


def test_should_alert_true_for_refused_and_unknown():
    for st in (Status.REFUSED, Status.UNKNOWN, Status.ERROR, Status.LIFTED):
        out = AppealOutcome("a1", None, SpamBotResult(st, "checked", ""))
        assert should_alert(out) is True


def test_should_alert_false_for_free_and_skips():
    out_free = AppealOutcome("a1", None, SpamBotResult(Status.FREE, "checked", ""))
    out_skip = AppealOutcome("a1", "cooldown", None)
    assert should_alert(out_free) is False
    assert should_alert(out_skip) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_notifier.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.notifier'`

- [ ] **Step 3: Implement `src/appeal_bot/notifier.py`**

```python
from __future__ import annotations

from typing import Protocol

from appeal_bot.models import AppealOutcome, Status

# Outcomes that warrant pushing an operator alert.
_ALERT_STATUSES = {Status.LIFTED, Status.REFUSED, Status.UNKNOWN, Status.ERROR}


def should_alert(outcome: AppealOutcome) -> bool:
    if outcome.result is None:
        return False
    return outcome.result.status in _ALERT_STATUSES


def format_outcome(outcome: AppealOutcome) -> str:
    if outcome.result is None:
        return f"[{outcome.account_id}] skipped: {outcome.skipped_reason}"
    r = outcome.result
    return f"[{outcome.account_id}] {r.status.value} (action={r.action})"


class Notifier(Protocol):
    async def notify(self, text: str) -> None: ...


class TelegramNotifier:
    """Sends operator alerts via the control bot client."""

    def __init__(self, bot_client, operator_chat_ids: list[int]):
        self._bot = bot_client
        self._chat_ids = operator_chat_ids

    async def notify(self, text: str) -> None:
        for chat_id in self._chat_ids:
            await self._bot.send_message(chat_id, text)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_notifier.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/notifier.py tests/test_notifier.py
git commit -m "feat: notifier formatting and alert policy"
```

---

## Task 8: AppealOrchestrator (cooldown/backoff)

**Files:**
- Create: `src/appeal_bot/orchestrator.py`
- Test: `tests/test_orchestrator.py`

- [ ] **Step 1: Write the failing test** — `tests/test_orchestrator.py`

```python
import pytest

from appeal_bot.models import SpamBotResult, Status, Trigger
from appeal_bot.orchestrator import AppealOrchestrator
from appeal_bot.store import Store


class FakeClock:
    def __init__(self, t=1000):
        self.t = t

    def __call__(self):
        return self.t


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


def orchestrator(store, clock, result=None, alerts=None, base=100, cap=800):
    async def run_flow(account):
        if isinstance(result, Exception):
            raise result
        return result

    alerts = alerts if alerts is not None else []

    class Notifier:
        async def notify(self, text):
            alerts.append(text)

    return AppealOrchestrator(
        store=store, run_flow=run_flow, notifier=Notifier(),
        clock=clock, cooldown_base=base, cooldown_cap=cap, max_concurrency=2,
    )


async def test_skips_unknown_account(tmp_path):
    store = make_store(tmp_path)
    orch = orchestrator(store, FakeClock(), SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("ghost", Trigger.WEBHOOK)
    assert out.skipped_reason == "unknown_account"
    assert out.result is None


async def test_lifted_resets_failures_and_sets_base_cooldown(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 3)
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.LIFTED, "clicked_appeal", "raw"))
    out = await orch.appeal("a1", Trigger.WEBHOOK)
    assert out.result.status is Status.LIFTED
    a = store.get_account("a1")
    assert a.consec_failures == 0
    assert a.cooldown_until == 1000 + 100
    assert a.last_status == "lifted"
    # appeal logged
    assert store.list_appeals("a1")[0].outcome == "lifted"


async def test_refused_increments_failures_with_exponential_backoff(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 2)  # next failure -> 3
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.REFUSED, "clicked_appeal", "r"))
    await orch.appeal("a1", Trigger.WEBHOOK)
    a = store.get_account("a1")
    assert a.consec_failures == 3
    # base * 2^(3-1) = 100 * 4 = 400
    assert a.cooldown_until == 1000 + 400


async def test_backoff_is_capped(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 9)  # huge -> capped
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.REFUSED, "clicked_appeal", "r"),
                        base=100, cap=800)
    await orch.appeal("a1", Trigger.WEBHOOK)
    a = store.get_account("a1")
    assert a.cooldown_until == 1000 + 800  # capped


async def test_cooldown_blocks_appeal(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "refused", 0, 5000, 1)  # cooling until 5000
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("a1", Trigger.SWEEP)
    assert out.skipped_reason == "cooldown"
    assert out.result is None


async def test_force_overrides_cooldown(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "refused", 0, 5000, 1)
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("a1", Trigger.MANUAL, force=True)
    assert out.result.status is Status.FREE


async def test_exception_in_flow_records_error(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, RuntimeError("boom"))
    out = await orch.appeal("a1", Trigger.WEBHOOK)
    assert out.result.status is Status.ERROR
    assert "boom" in out.result.raw_text
    a = store.get_account("a1")
    assert a.consec_failures == 1


async def test_alert_sent_for_refused(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    alerts = []
    orch = orchestrator(store, FakeClock(), SpamBotResult(Status.REFUSED, "clicked_appeal", "r"),
                        alerts=alerts)
    await orch.appeal("a1", Trigger.WEBHOOK)
    assert len(alerts) == 1
    assert "a1" in alerts[0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_orchestrator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.orchestrator'`

- [ ] **Step 3: Implement `src/appeal_bot/orchestrator.py`**

```python
from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

from appeal_bot.models import AccountRecord, AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.notifier import Notifier, format_outcome, should_alert
from appeal_bot.store import Store

RunFlow = Callable[[AccountRecord], Awaitable[SpamBotResult]]

# Statuses that count as a successful resolution (reset backoff).
_RESOLVED = {Status.FREE, Status.LIFTED}
# Statuses that grow the backoff window.
_FAILED = {Status.REFUSED, Status.BACKOFF, Status.UNKNOWN, Status.ERROR}


class AppealOrchestrator:
    def __init__(
        self,
        store: Store,
        run_flow: RunFlow,
        notifier: Notifier,
        clock: Callable[[], float] = time.time,
        cooldown_base: int = 86400,
        cooldown_cap: int = 604800,
        max_concurrency: int = 2,
    ):
        self._store = store
        self._run_flow = run_flow
        self._notifier = notifier
        self._clock = clock
        self._base = cooldown_base
        self._cap = cooldown_cap
        self._sem = asyncio.Semaphore(max_concurrency)

    async def appeal(
        self, account_id: str, trigger: Trigger, force: bool = False
    ) -> AppealOutcome:
        acct = self._store.get_account(account_id)
        if acct is None:
            return AppealOutcome(account_id, "unknown_account", None)
        if not acct.enabled and not force:
            return AppealOutcome(account_id, "disabled", None)

        now = int(self._clock())
        if not force and acct.cooldown_until and now < acct.cooldown_until:
            return AppealOutcome(account_id, "cooldown", None)

        async with self._sem:
            try:
                result = await self._run_flow(acct)
            except Exception as exc:  # noqa: BLE001 - any flow failure becomes ERROR
                result = SpamBotResult(Status.ERROR, "none", repr(exc))

        consec, cooldown_until = self._next_state(acct, result, now)
        self._store.set_account_state(
            account_id, result.status.value, now, cooldown_until, consec
        )
        self._store.record_appeal(
            account_id, now, trigger.value, result.status.value,
            result.action, result.status.value, result.raw_text,
        )

        outcome = AppealOutcome(account_id, None, result)
        if should_alert(outcome):
            await self._notifier.notify(format_outcome(outcome))
        return outcome

    def _next_state(
        self, acct: AccountRecord, result: SpamBotResult, now: int
    ) -> tuple[int, int]:
        if result.status in _RESOLVED:
            return 0, now + self._base
        # Failure path: grow backoff exponentially, capped.
        consec = acct.consec_failures + 1
        delay = min(self._base * (2 ** (consec - 1)), self._cap)
        return consec, now + delay
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_orchestrator.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/orchestrator.py tests/test_orchestrator.py
git commit -m "feat: appeal orchestrator with cooldown and backoff"
```

---

## Task 9: WebhookServer (reactive trigger)

**Files:**
- Create: `src/appeal_bot/webhook.py`
- Test: `tests/test_webhook.py`

- [ ] **Step 1: Write the failing test** — `tests/test_webhook.py`

```python
import pytest
from aiohttp.test_utils import TestClient, TestServer

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.webhook import build_app


class FakeOrchestrator:
    def __init__(self):
        self.calls = []

    async def appeal(self, account_id, trigger, force=False):
        self.calls.append((account_id, trigger, force))
        return AppealOutcome(account_id, None, SpamBotResult(Status.FREE, "checked", ""))


@pytest.fixture
async def client(aiohttp_client):
    orch = FakeOrchestrator()
    app = build_app(orch, secret="s3cret")
    app["orch"] = orch
    return await aiohttp_client(app)


async def test_rejects_missing_secret(client):
    resp = await client.post("/appeal", json={"account_id": "a1"})
    assert resp.status == 401
    assert client.app["orch"].calls == []


async def test_rejects_wrong_secret(client):
    resp = await client.post(
        "/appeal", json={"account_id": "a1"}, headers={"X-Auth-Token": "nope"}
    )
    assert resp.status == 401


async def test_rejects_missing_account_id(client):
    resp = await client.post(
        "/appeal", json={}, headers={"X-Auth-Token": "s3cret"}
    )
    assert resp.status == 400


async def test_accepts_and_dispatches(client):
    resp = await client.post(
        "/appeal", json={"account_id": "a1"}, headers={"X-Auth-Token": "s3cret"}
    )
    assert resp.status == 202
    # the background task should have run by now
    await _wait_for(lambda: client.app["orch"].calls)
    assert client.app["orch"].calls[0] == ("a1", Trigger.WEBHOOK, False)


async def _wait_for(predicate, tries=50):
    import asyncio
    for _ in range(tries):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_webhook.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.webhook'`

- [ ] **Step 3: Implement `src/appeal_bot/webhook.py`**

```python
from __future__ import annotations

import asyncio

from aiohttp import web

from appeal_bot.models import Trigger


def build_app(orchestrator, secret: str) -> web.Application:
    app = web.Application()
    app["_tasks"] = set()

    async def handle_appeal(request: web.Request) -> web.Response:
        if request.headers.get("X-Auth-Token") != secret:
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad json"}, status=400)
        account_id = body.get("account_id")
        if not account_id:
            return web.json_response({"error": "account_id required"}, status=400)

        # Run the (slow) appeal in the background; ack immediately.
        task = asyncio.create_task(
            orchestrator.appeal(account_id, Trigger.WEBHOOK)
        )
        app["_tasks"].add(task)
        task.add_done_callback(app["_tasks"].discard)
        return web.json_response({"status": "accepted"}, status=202)

    app.router.add_post("/appeal", handle_appeal)
    return app


class WebhookServer:
    def __init__(self, orchestrator, secret: str, host: str, port: int):
        self._app = build_app(orchestrator, secret)
        self._host = host
        self._port = port
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self._host, self._port)
        await site.start()

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_webhook.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/webhook.py tests/test_webhook.py
git commit -m "feat: aiohttp webhook for reactive triggers"
```

---

## Task 10: ControlBot command dispatcher

The Telethon event wiring is thin; the testable logic is a pure `handle_command(text, store, orchestrator)` coroutine returning reply text.

**Files:**
- Create: `src/appeal_bot/control_bot.py`
- Test: `tests/test_control_bot.py`

- [ ] **Step 1: Write the failing test** — `tests/test_control_bot.py`

```python
import pytest

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.control_bot import handle_command
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


class FakeOrchestrator:
    def __init__(self):
        self.calls = []

    async def appeal(self, account_id, trigger, force=False):
        self.calls.append((account_id, trigger, force))
        return AppealOutcome(account_id, None, SpamBotResult(Status.LIFTED, "clicked_appeal", ""))


async def test_status_summary(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.upsert_account("a2", "+2", "/2.session")
    store.set_account_state("a1", "free", 0, 0, 0)
    store.set_account_state("a2", "refused", 0, 0, 1)
    reply = await handle_command("/status", store, FakeOrchestrator())
    assert "free" in reply and "refused" in reply
    assert "2" in reply  # total count


async def test_status_for_one_account(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.set_account_state("a1", "limited", 123, 999, 2)
    reply = await handle_command("/status a1", store, FakeOrchestrator())
    assert "a1" in reply
    assert "limited" in reply


async def test_status_unknown_account(tmp_path):
    store = make_store(tmp_path)
    reply = await handle_command("/status ghost", store, FakeOrchestrator())
    assert "ghost" in reply
    assert "not found" in reply.lower()


async def test_appeal_command_dispatches(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    orch = FakeOrchestrator()
    reply = await handle_command("/appeal a1", store, orch)
    assert orch.calls == [("a1", Trigger.MANUAL, False)]
    assert "lifted" in reply.lower()


async def test_appeal_force_flag(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    orch = FakeOrchestrator()
    await handle_command("/appeal a1 --force", store, orch)
    assert orch.calls == [("a1", Trigger.MANUAL, True)]


async def test_accounts_list(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.upsert_account("a2", "+2", "/2.session")
    reply = await handle_command("/accounts", store, FakeOrchestrator())
    assert "a1" in reply and "a2" in reply


async def test_history_command(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.record_appeal("a1", 1000, "webhook", "limited", "clicked_appeal", "lifted", "raw")
    reply = await handle_command("/history a1", store, FakeOrchestrator())
    assert "lifted" in reply


async def test_unknown_command(tmp_path):
    store = make_store(tmp_path)
    reply = await handle_command("/wat", store, FakeOrchestrator())
    assert "unknown" in reply.lower() or "help" in reply.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_control_bot.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.control_bot'`

- [ ] **Step 3: Implement `src/appeal_bot/control_bot.py`**

```python
from __future__ import annotations

from appeal_bot.models import Trigger
from appeal_bot.notifier import format_outcome
from appeal_bot.store import Store

HELP = (
    "Commands:\n"
    "/status [account_id] — fleet summary or one account\n"
    "/appeal <account_id> [--force] — appeal now\n"
    "/accounts — list managed accounts\n"
    "/history <account_id> — recent appeal outcomes"
)


async def handle_command(text: str, store: Store, orchestrator) -> str:
    parts = text.strip().split()
    if not parts:
        return HELP
    cmd, args = parts[0], parts[1:]

    if cmd == "/status":
        return _status(store, args)
    if cmd == "/appeal":
        return await _appeal(store, orchestrator, args)
    if cmd == "/accounts":
        return _accounts(store)
    if cmd == "/history":
        return _history(store, args)
    if cmd in ("/help", "/start"):
        return HELP
    return f"Unknown command: {cmd}\n\n{HELP}"


def _status(store: Store, args: list[str]) -> str:
    if args:
        acct = store.get_account(args[0])
        if acct is None:
            return f"Account {args[0]} not found."
        return (
            f"{acct.account_id}: {acct.last_status}\n"
            f"last_checked_at={acct.last_checked_at} "
            f"cooldown_until={acct.cooldown_until} "
            f"consec_failures={acct.consec_failures} "
            f"enabled={acct.enabled}"
        )
    accounts = store.list_accounts()
    counts: dict[str, int] = {}
    for a in accounts:
        counts[a.last_status] = counts.get(a.last_status, 0) + 1
    breakdown = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
    return f"Fleet: {len(accounts)} accounts ({breakdown})"


async def _appeal(store: Store, orchestrator, args: list[str]) -> str:
    if not args:
        return "Usage: /appeal <account_id> [--force]"
    account_id = args[0]
    force = "--force" in args[1:]
    outcome = await orchestrator.appeal(account_id, Trigger.MANUAL, force=force)
    return format_outcome(outcome)


def _accounts(store: Store) -> str:
    accounts = store.list_accounts()
    if not accounts:
        return "No accounts."
    return "\n".join(f"{a.account_id} ({a.phone}): {a.last_status}" for a in accounts)


def _history(store: Store, args: list[str]) -> str:
    if not args:
        return "Usage: /history <account_id>"
    rows = store.list_appeals(args[0], limit=10)
    if not rows:
        return f"No appeals for {args[0]}."
    return "\n".join(
        f"{r.created_at} [{r.trigger}] {r.sb_status} -> {r.outcome}" for r in rows
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_control_bot.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/control_bot.py tests/test_control_bot.py
git commit -m "feat: control bot command dispatcher"
```

---

## Task 11: Scheduler (safety-net sweep)

**Files:**
- Create: `src/appeal_bot/scheduler.py`
- Test: `tests/test_scheduler.py`

- [ ] **Step 1: Write the failing test** — `tests/test_scheduler.py`

```python
import pytest

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.scheduler import Scheduler
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


class FakeOrchestrator:
    def __init__(self):
        self.calls = []

    async def appeal(self, account_id, trigger, force=False):
        self.calls.append((account_id, trigger, force))
        return AppealOutcome(account_id, None, SpamBotResult(Status.FREE, "checked", ""))


async def test_sweep_appeals_only_due_accounts(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("ready", "+1", "/r.session")
    store.upsert_account("cooling", "+2", "/c.session")
    store.set_account_state("ready", "free", 0, 500, 0)
    store.set_account_state("cooling", "refused", 0, 99999, 1)
    orch = FakeOrchestrator()
    sched = Scheduler(store, orch, interval=10, clock=lambda: 1000)
    n = await sched.sweep_once()
    assert n == 1
    assert orch.calls == [("ready", Trigger.SWEEP, False)]


async def test_sweep_empty_when_nothing_due(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("cooling", "+2", "/c.session")
    store.set_account_state("cooling", "refused", 0, 99999, 1)
    orch = FakeOrchestrator()
    sched = Scheduler(store, orch, interval=10, clock=lambda: 1000)
    n = await sched.sweep_once()
    assert n == 0
    assert orch.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_scheduler.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.scheduler'`

- [ ] **Step 3: Implement `src/appeal_bot/scheduler.py`**

```python
from __future__ import annotations

import asyncio
import time
from typing import Callable

from appeal_bot.models import Trigger
from appeal_bot.store import Store


class Scheduler:
    def __init__(
        self,
        store: Store,
        orchestrator,
        interval: int,
        clock: Callable[[], float] = time.time,
    ):
        self._store = store
        self._orch = orchestrator
        self._interval = interval
        self._clock = clock
        self._stopped = asyncio.Event()

    async def sweep_once(self) -> int:
        now = int(self._clock())
        due = self._store.due_for_sweep(now)
        for acct in due:
            await self._orch.appeal(acct.account_id, Trigger.SWEEP)
        return len(due)

    async def run(self) -> None:
        while not self._stopped.is_set():
            await self.sweep_once()
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass

    def stop(self) -> None:
        self._stopped.set()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_scheduler.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/appeal_bot/scheduler.py tests/test_scheduler.py
git commit -m "feat: scheduler sweep over due accounts"
```

---

## Task 12: Application wiring + entrypoint

This task wires everything together and is verified by a smoke test plus a manual run. The control bot's Telethon event handler delegates to the already-tested `handle_command`.

**Files:**
- Create: `src/appeal_bot/app.py`
- Test: `tests/test_app.py`

- [ ] **Step 1: Write the failing test** — `tests/test_app.py`

```python
from appeal_bot.app import sync_accounts_from_dir
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


def test_sync_accounts_from_dir_imports_sessions(tmp_path):
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    (sessions / "acc1.session").write_text("x")
    (sessions / "acc2.session").write_text("x")
    (sessions / "notes.txt").write_text("ignore me")
    store = make_store(tmp_path)

    added = sync_accounts_from_dir(store, str(sessions))

    assert added == 2
    ids = {a.account_id for a in store.list_accounts()}
    assert ids == {"acc1", "acc2"}
    acc1 = store.get_account("acc1")
    assert acc1.session_path.endswith("acc1.session")


def test_sync_is_idempotent(tmp_path):
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    (sessions / "acc1.session").write_text("x")
    store = make_store(tmp_path)
    sync_accounts_from_dir(store, str(sessions))
    sync_accounts_from_dir(store, str(sessions))
    assert len(store.list_accounts()) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'appeal_bot.app'`

- [ ] **Step 3: Implement `src/appeal_bot/app.py`**

```python
from __future__ import annotations

import asyncio
import glob
import os

from appeal_bot.config import Config
from appeal_bot.notifier import TelegramNotifier
from appeal_bot.orchestrator import AppealOrchestrator
from appeal_bot.scheduler import Scheduler
from appeal_bot.session_provider import SessionProvider
from appeal_bot.spambot_client import SpamBotClient
from appeal_bot.store import Store
from appeal_bot.webhook import WebhookServer


def sync_accounts_from_dir(store: Store, session_dir: str) -> int:
    """Seed the accounts table from .session files. account_id = filename stem.
    Phone is left blank (filled by CRM sync if available). Returns count added."""
    added = 0
    for path in sorted(glob.glob(os.path.join(session_dir, "*.session"))):
        account_id = os.path.splitext(os.path.basename(path))[0]
        if store.get_account(account_id) is None:
            added += 1
        store.upsert_account(account_id, "", path)
    return added


def build_run_flow(session_provider: SessionProvider, spambot: SpamBotClient):
    async def run_flow(account):
        async with session_provider.conversation(account) as conv:
            return await spambot.run(conv)

    return run_flow


async def main() -> None:  # pragma: no cover - exercised manually
    from telethon import TelegramClient, events

    cfg = Config.from_env()
    store = Store(cfg.sqlite_path)
    store.init_db()
    sync_accounts_from_dir(store, cfg.session_dir)

    bot = TelegramClient("appeal-bot", cfg.api_id, cfg.api_hash)
    await bot.start(bot_token=cfg.bot_token)

    notifier = TelegramNotifier(bot, cfg.operator_chat_ids)
    session_provider = SessionProvider(cfg.session_dir, cfg.api_id, cfg.api_hash)
    spambot = SpamBotClient()
    orchestrator = AppealOrchestrator(
        store=store,
        run_flow=build_run_flow(session_provider, spambot),
        notifier=notifier,
        cooldown_base=cfg.cooldown_base_seconds,
        cooldown_cap=cfg.cooldown_cap_seconds,
        max_concurrency=cfg.max_concurrency,
    )

    from appeal_bot.control_bot import handle_command

    @bot.on(events.NewMessage(pattern=r"^/"))
    async def _on_command(event):  # pragma: no cover
        if cfg.operator_chat_ids and event.chat_id not in cfg.operator_chat_ids:
            return
        reply = await handle_command(event.raw_text, store, orchestrator)
        await event.respond(reply)

    webhook = WebhookServer(
        orchestrator, cfg.webhook_secret, cfg.webhook_host, cfg.webhook_port
    )
    await webhook.start()

    scheduler = Scheduler(store, orchestrator, cfg.sweep_interval_seconds)
    sweep_task = asyncio.create_task(scheduler.run())

    try:
        await bot.run_until_disconnected()
    finally:
        scheduler.stop()
        sweep_task.cancel()
        await webhook.stop()


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_app.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -v`
Expected: PASS (all tests across all modules green)

- [ ] **Step 6: Commit**

```bash
git add src/appeal_bot/app.py tests/test_app.py
git commit -m "feat: application wiring and entrypoint"
```

---

## Task 13: README + manual verification checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Manual verification (one account, off-peak)**

1. Put one real `.session` into a test `APP_SESSION_DIR`.
2. Start the service: `python -m appeal_bot.app`.
3. DM the control bot `/status acc1` — confirm it reports a status.
4. Trigger an appeal: `/appeal acc1 --force`. Confirm the @SpamBot transcript is
   captured in the `appeals` table (`sqlite3 state.db "SELECT * FROM appeals"`).
5. Confirm a notification arrives for a `lifted`/`refused`/`unknown` outcome.
6. Confirm a second immediate `/appeal acc1` (without `--force`) is blocked by cooldown.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README and manual verification checklist"
```

---

## Self-Review Notes

- **Spec coverage:** SessionProvider (Task 6), SpamBotClient flow (Task 5) + parser (Task 3), AppealOrchestrator with cooldown/backoff (Task 8), Store schema matching the spec's data model (Task 4), WebhookServer reactive trigger (Task 9), Scheduler sweep (Task 11), ControlBot commands + notifications (Tasks 7, 10), config + CRM session-dir sync (Tasks 1, 12). All spec sections map to a task.
- **Guardrails:** per-account cooldown + exponential backoff + cap (Task 8), global concurrency semaphore (Task 8), refused/unknown → operator alert never silently "resolved" (Tasks 7, 8), strictly session-scoped — no creation/evasion anywhere.
- **Type consistency:** `Status`/`Trigger` enums, `SpamBotResult(status, action, raw_text)`, `AccountRecord` fields, `AppealOutcome(account_id, skipped_reason, result)`, and Store method names (`get_account`, `set_account_state`, `record_appeal`, `due_for_sweep`, `list_appeals`) are used identically across all tasks.
- **CRM callback (out):** `crm_callback_url` is captured in config; wiring an outbound POST is deferred until the CRM endpoint contract is known (noted, not silently dropped). If needed before launch, add a one-task extension calling it from the orchestrator after `record_appeal`.
