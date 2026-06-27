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
