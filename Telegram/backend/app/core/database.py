import asyncio
import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import DB_PATH, MEDIA_DIR, SESSION_DIR


logger = logging.getLogger(__name__)

# Keep the Python-level connect timeout in step with the SQLite busy handler so the
# binding does not give up before the busy_timeout PRAGMA has had a chance to wait out
# a lock. Both are in different units: connect() takes seconds, busy_timeout takes ms.
_CONNECT_TIMEOUT_SECONDS = 30
_BUSY_TIMEOUT_MS = 30000

# Per-thread connections instead of one globally-locked connection. Sharing a single connection
# behind a process-wide lock serialised *every* read and write, throwing away WAL's "many readers
# + one writer" concurrency — so a campaign worker's writes blocked unibox reads. Now each thread
# (event loop, Starlette threadpool workers, and the asyncio.to_thread pool used by the async
# helpers below) gets its own connection, so reads run concurrently under WAL and writers serialise
# via SQLite's busy_timeout (waited, not errored) with db_write/async_db_write as the retry net.
# Connections are created lazily per thread and tracked so close_db() can shut them all down.
_local = threading.local()
_conns: "list[sqlite3.Connection]" = []
_conns_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            DB_PATH,
            timeout=_CONNECT_TIMEOUT_SECONDS,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(f"PRAGMA busy_timeout={_BUSY_TIMEOUT_MS}")
        _local.conn = conn
        with _conns_lock:
            _conns.append(conn)
    return conn


@contextmanager
def db() -> sqlite3.Connection:
    conn = _get_conn()
    # No process-wide lock: the connection belongs to this thread alone. Each `with db()` block
    # must stay a single synchronous transaction (no awaits inside) so a write never holds the WAL
    # writer lock across a network round-trip.
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def close_db() -> None:
    """Close every per-thread connection (call on app shutdown)."""
    with _conns_lock:
        for conn in _conns:
            try:
                conn.close()
            except Exception:
                pass
        _conns.clear()
    try:
        del _local.conn
    except AttributeError:
        pass


T = TypeVar("T")


def db_write(fn: Callable[[sqlite3.Connection], T], *, attempts: int = 5, base_delay: float = 0.3) -> T:
    """Run a write callback inside a fresh ``db()`` connection, retrying on lock.

    SQLite serialises writers, so under a write-heavy campaign a concurrent writer can
    raise ``sqlite3.OperationalError: database is locked`` even with WAL + busy_timeout.
    This retries the whole transaction with linear backoff. Use this for every write that
    runs while a campaign is active (worker loop, crash handler, status updates).

    ``fn`` receives the open connection and may return a value; the connection is
    committed automatically by the ``db()`` context manager on success.

    **Sync version** — uses ``time.sleep()`` which blocks the event loop.
    Prefer ``async_db_write`` in coroutines.
    """
    last_exc: sqlite3.OperationalError | None = None
    for attempt in range(attempts):
        try:
            with db() as conn:
                return fn(conn)
        except sqlite3.OperationalError as exc:
            if "database is locked" not in str(exc).lower():
                raise
            last_exc = exc
            if attempt == attempts - 1:
                break
            time.sleep(base_delay * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def _run_txn(fn: Callable[[sqlite3.Connection], T]) -> T:
    with db() as conn:
        return fn(conn)


async def async_db(fn: Callable[[sqlite3.Connection], T]) -> T:
    """Run a DB callback OFF the event loop, in a threadpool thread (its own connection).

    Use this for any DB access inside an ``async def`` route handler or an ``asyncio`` worker
    task: the blocking sqlite call (and any busy-wait) then happens on a threadpool thread instead
    of freezing the loop that serves the UI. ``fn`` receives the connection; the transaction is
    committed on success. For reads, ``async_db_read`` is a readable alias.
    """
    return await asyncio.to_thread(_run_txn, fn)


# Reads carry no retry (WAL readers don't get "database is locked"); the alias just documents intent.
async_db_read = async_db


async def async_db_write(fn: Callable[[sqlite3.Connection], T], *, attempts: int = 5, base_delay: float = 0.3) -> T:
    """Async variant of ``db_write`` — runs each attempt OFF the event loop via
    ``asyncio.to_thread`` and backs off with ``await asyncio.sleep()`` between retries, so neither
    the blocking write nor the lock-wait ever blocks the loop.
    """
    last_exc: sqlite3.OperationalError | None = None
    for attempt in range(attempts):
        try:
            return await asyncio.to_thread(_run_txn, fn)
        except sqlite3.OperationalError as exc:
            if "database is locked" not in str(exc).lower():
                raise
            last_exc = exc
            if attempt == attempts - 1:
                break
            await asyncio.sleep(base_delay * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def checkpoint_wal() -> None:
    """Truncate the WAL file so reads never stall on a long checkpoint."""
    try:
        with db() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        pass


def migrate_legacy_data() -> None:
    """One-time copy of DB/sessions/media from the old (OneDrive) location into DATA_DIR.

    Runs before any connection is opened against the new DB_PATH. Best-effort: if the new DB
    already exists we assume the move happened. Sessions/media are copied file-by-file so an
    existing target is never clobbered.
    """
    import shutil
    from .config import LEGACY_DB_PATH, LEGACY_MEDIA_DIR, LEGACY_SESSION_DIR

    try:
        if (
            not DB_PATH.exists()
            and LEGACY_DB_PATH.exists()
            and LEGACY_DB_PATH.resolve() != DB_PATH.resolve()
        ):
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            for suffix in ("", "-wal", "-shm"):
                src = Path(str(LEGACY_DB_PATH) + suffix)
                if src.exists():
                    shutil.copy2(src, Path(str(DB_PATH) + suffix))
            logger.warning("Migrated SQLite DB from %s to %s", LEGACY_DB_PATH, DB_PATH)

        for legacy_dir, new_dir in ((LEGACY_SESSION_DIR, SESSION_DIR), (LEGACY_MEDIA_DIR, MEDIA_DIR)):
            if legacy_dir.exists() and legacy_dir.resolve() != new_dir.resolve():
                new_dir.mkdir(parents=True, exist_ok=True)
                for item in legacy_dir.iterdir():
                    target = new_dir / item.name
                    if target.exists():
                        continue
                    if item.is_dir():
                        shutil.copytree(item, target)
                    else:
                        shutil.copy2(item, target)
    except Exception as exc:  # never let migration crash startup
        logger.warning("Legacy data migration skipped: %s", exc)


def bootstrap_db() -> None:
    migrate_legacy_data()
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT NOT NULL,
                notification_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Unified tables for operator + inbox (shared across platforms)
            CREATE TABLE IF NOT EXISTS platform_accounts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                label TEXT,
                external_id TEXT,
                username TEXT,
                status TEXT DEFAULT 'connected',
                credentials TEXT,
                last_connected_at TEXT,
                meta TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                platform_account_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                peer_id TEXT NOT NULL,
                peer_display_name TEXT,
                peer_username TEXT,
                last_message_at TEXT,
                last_message_preview TEXT,
                last_message_direction TEXT,
                unread_count INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                interested INTEGER DEFAULT 0,
                meta TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                direction TEXT NOT NULL,
                body TEXT,
                sent_at TEXT NOT NULL,
                author_name TEXT,
                meta TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                display_name TEXT,
                phone TEXT,
                telegram_id TEXT NOT NULL,
                status TEXT NOT NULL,
                location TEXT,
                session_file TEXT,
                source TEXT NOT NULL,
                exclude_chats INTEGER NOT NULL DEFAULT 0,
                api_id INTEGER,
                api_hash TEXT,
                device_fingerprint_json TEXT NOT NULL DEFAULT '{}',
                proxy_json TEXT NOT NULL DEFAULT '{}',
                photo_url TEXT,
                twofa_enabled INTEGER NOT NULL DEFAULT 0,
                session_status TEXT NOT NULL DEFAULT 'unknown',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                account_ids_json TEXT NOT NULL,
                daily_message_limit_per_account INTEGER NOT NULL,
                messages_json TEXT NOT NULL,
                targets_csv TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_started_at TEXT,
                last_finished_at TEXT,
                last_run_summary_json TEXT,
                source_group TEXT,
                blacklisted_users_json TEXT NOT NULL DEFAULT '[]',
                message_interval_seconds INTEGER NOT NULL DEFAULT 5,
                campaign_type TEXT NOT NULL DEFAULT 'csv',
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS group_scraper_campaigns (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                source_account_id TEXT NOT NULL,
                inviter_account_ids_json TEXT NOT NULL,
                source_group TEXT NOT NULL,
                target_group TEXT NOT NULL,
                max_members INTEGER NOT NULL DEFAULT 0,
                delay_seconds INTEGER NOT NULL DEFAULT 0,
                stats_json TEXT NOT NULL,
                events_json TEXT NOT NULL,
                failures_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_started_at TEXT,
                last_finished_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                chat_title TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                outgoing INTEGER NOT NULL,
                sender_name TEXT,
                has_media INTEGER NOT NULL DEFAULT 0,
                media_type TEXT,
                media_mime_type TEXT,
                media_file_name TEXT,
                media_path TEXT
            );

            CREATE TABLE IF NOT EXISTS group_scraper_candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                scraper_account_id TEXT NOT NULL DEFAULT '',
                member_id TEXT NOT NULL,
                access_hash TEXT,
                username TEXT,
                display_name TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                invited_by TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(campaign_id, scraper_account_id, member_id)
            );

            CREATE TABLE IF NOT EXISTS group_add_jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                group_title TEXT,
                interval_seconds INTEGER NOT NULL DEFAULT 5,
                status TEXT NOT NULL,
                total INTEGER NOT NULL DEFAULT 0,
                processed INTEGER NOT NULL DEFAULT 0,
                forwarded INTEGER NOT NULL DEFAULT 0,
                added INTEGER NOT NULL DEFAULT 0,
                kicked INTEGER NOT NULL DEFAULT 0,
                skipped INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                log_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_started_at TEXT,
                last_finished_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS group_add_targets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                member_id TEXT NOT NULL,
                access_hash TEXT,
                full_name TEXT,
                username TEXT,
                phone TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                result TEXT,
                updated_at TEXT,
                UNIQUE(job_id, member_id)
            );

            CREATE INDEX IF NOT EXISTS idx_group_add_targets_job ON group_add_targets(job_id, status);

            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT 'folder',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS folder_chats (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                added_at TEXT NOT NULL,
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
                UNIQUE(folder_id, account_id, chat_id)
            );

            CREATE INDEX IF NOT EXISTS idx_folder_chats_folder ON folder_chats(folder_id);

            CREATE TABLE IF NOT EXISTS campaign_seen (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                campaign_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                message_id INTEGER,
                seen INTEGER NOT NULL DEFAULT 0,
                seen_at TEXT,
                checked_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(campaign_id, account_id, chat_id, message_id)
            );

            CREATE TABLE IF NOT EXISTS campaign_followups (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                message_id INTEGER,
                sent_at TEXT NOT NULL,
                UNIQUE(campaign_id, account_id, chat_id, step_index)
            );

            CREATE TABLE IF NOT EXISTS group_presets (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                admin_usernames_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS notification_config (
                user_id TEXT PRIMARY KEY,
                pushover_token TEXT,
                pushover_users_json TEXT NOT NULL DEFAULT '[]',
                command_prefix TEXT NOT NULL DEFAULT '/m',
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS notification_watchers (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                chat_title TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, account_id, chat_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS mass_group_campaigns (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                title_template TEXT NOT NULL,
                admin_account_ids_json TEXT NOT NULL DEFAULT '[]',
                creator_account_ids_json TEXT NOT NULL DEFAULT '[]',
                usernames_json TEXT NOT NULL DEFAULT '[]',
                delay_seconds INTEGER NOT NULL DEFAULT 30,
                stats_json TEXT NOT NULL,
                events_json TEXT NOT NULL,
                failures_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_started_at TEXT,
                last_finished_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )
        # Backward compatibility for already-created DBs.
        existing_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(group_scraper_candidates)").fetchall()
        }
        if "scraper_account_id" not in existing_cols:
            conn.execute(
                "ALTER TABLE group_scraper_candidates ADD COLUMN scraper_account_id TEXT NOT NULL DEFAULT ''"
            )

        # folder_chats: carry the member's scraped identity so no-username members resolve and
        # show a real name (the scraper has access_hash/name client-side; we persist it on add).
        folder_chat_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(folder_chats)").fetchall()
        }
        for col in ("access_hash", "username", "display_name", "filter_tag"):
            if col not in folder_chat_cols:
                conn.execute(f"ALTER TABLE folder_chats ADD COLUMN {col} TEXT")
        table_sql_row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'group_scraper_candidates'"
        ).fetchone()
        table_sql = (table_sql_row["sql"] if table_sql_row else "") or ""
        expected_unique = "UNIQUE(campaign_id, scraper_account_id, member_id)"
        if expected_unique not in table_sql:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS group_scraper_candidates_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    scraper_account_id TEXT NOT NULL DEFAULT '',
                    member_id TEXT NOT NULL,
                    access_hash TEXT,
                    username TEXT,
                    display_name TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    invited_by TEXT,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(campaign_id, scraper_account_id, member_id)
                )
                """
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO group_scraper_candidates_v2 (
                    campaign_id,
                    user_id,
                    scraper_account_id,
                    member_id,
                    access_hash,
                    username,
                    display_name,
                    status,
                    invited_by,
                    last_error,
                    created_at,
                    updated_at
                )
                SELECT
                    campaign_id,
                    user_id,
                    COALESCE(scraper_account_id, ''),
                    member_id,
                    access_hash,
                    username,
                    display_name,
                    status,
                    invited_by,
                    last_error,
                    created_at,
                    updated_at
                FROM group_scraper_candidates
                """
            )
            conn.execute("DROP TABLE group_scraper_candidates")
            conn.execute("ALTER TABLE group_scraper_candidates_v2 RENAME TO group_scraper_candidates")

        # Add photo_url column to accounts if missing
        account_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(accounts)").fetchall()
        }
        if "photo_url" not in account_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN photo_url TEXT")

        # Add scraped_targets_json column to campaigns if missing
        campaign_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(campaigns)").fetchall()
        }
        if "scraped_targets_json" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN scraped_targets_json TEXT")
        if "sort_by_activity" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN sort_by_activity TEXT")
        if "skip_messaged" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN skip_messaged INTEGER NOT NULL DEFAULT 0")
        if "followup_config_json" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN followup_config_json TEXT")
        if "source_folder" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN source_folder TEXT")
        if "resolution_group" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN resolution_group TEXT")
        if "folder_filter_tags_json" not in campaign_cols:
            conn.execute("ALTER TABLE campaigns ADD COLUMN folder_filter_tags_json TEXT")

        # Create stored_messages table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stored_messages (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'text',
                content TEXT NOT NULL,
                file_name TEXT,
                file_mime_type TEXT,
                file_size INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )

        # Add twofa_enabled column to accounts if missing
        account_cols_now = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(accounts)").fetchall()
        }
        if "twofa_enabled" not in account_cols_now:
            conn.execute("ALTER TABLE accounts ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0")
        if "session_status" not in account_cols_now:
            conn.execute("ALTER TABLE accounts ADD COLUMN session_status TEXT NOT NULL DEFAULT 'unknown'")

        # Add folder_type and draft_text columns to folders if missing
        folder_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(folders)").fetchall()
        }
        if "folder_type" not in folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN folder_type TEXT NOT NULL DEFAULT 'standard'")
        if "draft_text" not in folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN draft_text TEXT NOT NULL DEFAULT ''")
        # Group-chat folders: the (account, group) whose forwarded messages auto-populate the folder.
        if "watch_account_id" not in folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN watch_account_id TEXT NOT NULL DEFAULT ''")
        if "watch_chat_id" not in folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN watch_chat_id TEXT NOT NULL DEFAULT ''")
        if "watch_chat_title" not in folder_cols:
            conn.execute("ALTER TABLE folders ADD COLUMN watch_chat_title TEXT NOT NULL DEFAULT ''")

        # Filter-tag taxonomy migration: the labels changed to excluded/important/known/caution, and
        # "unknown" is now represented by a NULL tag (untagged). Remap any legacy values. Idempotent.
        conn.execute("UPDATE folder_chats SET filter_tag = 'known' WHERE filter_tag = 'special'")
        conn.execute("UPDATE folder_chats SET filter_tag = NULL WHERE filter_tag = 'unknown'")
        # Campaign folder filters store the tag list as JSON — migrate each row the same way.
        for row in conn.execute(
            "SELECT id, folder_filter_tags_json FROM campaigns WHERE folder_filter_tags_json IS NOT NULL"
        ).fetchall():
            try:
                tags = json.loads(row["folder_filter_tags_json"])
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if not isinstance(tags, list):
                continue
            migrated: list[str] = []
            for t in tags:
                if t == "special":
                    t = "known"
                elif t == "unknown":
                    continue  # untagged is no longer a selectable filter
                if t not in migrated:
                    migrated.append(t)
            if migrated != tags:
                conn.execute(
                    "UPDATE campaigns SET folder_filter_tags_json = ? WHERE id = ?",
                    (json.dumps(migrated), row["id"]),
                )
