import asyncio
import json
import random
import sqlite3
import time
from datetime import UTC
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException
from telethon import TelegramClient
from telethon.errors import UserAlreadyParticipantError
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest
from telethon.tl.functions.users import GetUsersRequest
from telethon.tl.types import ChatInviteAlready, InputUser
from telethon.utils import get_display_name

from ..core.config import DB_PATH, MEDIA_DIR, settings
from ..core.database import db
from ..core.state import (
    ACCOUNT_SESSION_LOCKS,
    LAST_CONNECT_TIME,
    PERSISTENT_ACCOUNT_CLIENTS,
    PERSISTENT_CLIENT_IDS,
    WARM_CLIENT_LAST_USED,
    WARM_CLIENTS,
)


DEVICE_PROFILES: list[dict[str, str]] = [
    {"device_model": "iPhone15,2", "system_version": "16.5", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone14,3", "system_version": "15.7", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone14,2", "system_version": "15.6", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone13,4", "system_version": "15.5", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone13,3", "system_version": "15.4", "app_version": "9.3.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone13,2", "system_version": "15.3", "app_version": "9.2.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone14,6", "system_version": "16.4", "app_version": "9.5.1", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "iPhone14,4", "system_version": "16.3", "app_version": "9.4.1", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-S918B", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-S901B", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-S908B", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-S906B", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-G998B", "system_version": "SDK 31", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-A536E", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-A135F", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "SM-N986B", "system_version": "SDK 31", "app_version": "9.3.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "2210132G", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "22081212C", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "23021RAAEG", "system_version": "SDK 33", "app_version": "9.5.1", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "22111317G", "system_version": "SDK 33", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Pixel 7 Pro", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Pixel 7", "system_version": "SDK 33", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Pixel 6a", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Pixel 6", "system_version": "SDK 32", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Pixel Fold", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "PHB110", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "PHB221", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "CPH2357", "system_version": "SDK 32", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "LE2123", "system_version": "SDK 31", "app_version": "9.3.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "CPH2487", "system_version": "SDK 33", "app_version": "9.5.1", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "V2238", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "V2180", "system_version": "SDK 32", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "F2023", "system_version": "SDK 33", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "PFDM00", "system_version": "SDK 33", "app_version": "9.6.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "RMX3686", "system_version": "SDK 33", "app_version": "9.5.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "2201116SG", "system_version": "SDK 32", "app_version": "9.4.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "2201117TG", "system_version": "SDK 31", "app_version": "9.3.0", "lang_pack": "en", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Desktop", "system_version": "Windows 11 Pro", "app_version": "4.9.0", "lang_pack": "tdesktop", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Desktop", "system_version": "Windows 10 Pro", "app_version": "4.8.0", "lang_pack": "tdesktop", "lang_code": "en", "system_lang_code": "en"},
    {"device_model": "Desktop", "system_version": "Windows 11 Home", "app_version": "4.7.0", "lang_pack": "tdesktop", "lang_code": "en", "system_lang_code": "en"},
]


def _apply_fingerprint(client: TelegramClient, fp: dict[str, str]) -> None:
    client._init_request.app_version = fp.get("app_version", "9.6.0")
    client._init_request.system_version = fp.get("system_version", "SDK 33")
    client._init_request.device_model = fp.get("device_model", "Pixel 7 Pro")
    client._init_request.lang_pack = fp.get("lang_pack", "en")
    client._init_request.lang_code = fp.get("lang_code", "en")
    client._init_request.system_lang_code = fp.get("system_lang_code", "en")


def _parse_proxy_config(proxy_config: dict[str, Any] | None) -> tuple[Any, dict[str, Any]] | None:
    if not proxy_config or not isinstance(proxy_config, dict):
        return None
    proxy_host = proxy_config.get("host") or proxy_config.get("addr")
    proxy_port = proxy_config.get("port")
    if not proxy_host or not proxy_port:
        return None
    proxy_type_str = (proxy_config.get("type") or "socks5").lower()
    try:
        import socks as socks_lib
    except ImportError:
        raise HTTPException(status_code=500, detail="Proxy support requires PySocks: pip install PySocks")
    proxy_type_map = {"socks5": socks_lib.SOCKS5, "socks4": socks_lib.SOCKS4, "http": socks_lib.HTTP}
    proxy_enum = proxy_type_map.get(proxy_type_str, socks_lib.SOCKS5)
    proxy_user = proxy_config.get("username") or proxy_config.get("user")
    proxy_pass = proxy_config.get("password") or proxy_config.get("pass")
    if proxy_user and proxy_pass:
        return (proxy_enum, proxy_host, int(proxy_port), True, proxy_user, proxy_pass)
    return (proxy_enum, proxy_host, int(proxy_port), True)


async def _connection_cooldown(user_id: str) -> None:
    now = time.time()
    last = LAST_CONNECT_TIME.get(user_id, 0)
    if last and now - last < 60:
        delay = random.uniform(30, 90)
        await asyncio.sleep(delay)
    LAST_CONNECT_TIME[user_id] = time.time()


def _account_session_lock(account_id: str) -> asyncio.Lock:
    lock = ACCOUNT_SESSION_LOCKS.get(account_id)
    if lock is None:
        lock = asyncio.Lock()
        ACCOUNT_SESSION_LOCKS[account_id] = lock
    return lock


def _cleanup_session_files(session_name_or_path: str) -> None:
    base = Path(session_name_or_path)
    session_file = base if str(base).endswith(".session") else Path(f"{base}.session")
    candidates = [
        session_file,
        Path(f"{session_file}-journal"),
        Path(f"{session_file}-wal"),
        Path(f"{session_file}-shm"),
    ]
    for candidate in candidates:
        try:
            if candidate.exists():
                candidate.unlink()
        except Exception:
            pass


def _account_photo_path(account_id: str) -> Path:
    return MEDIA_DIR / f"account_{account_id}_photo.jpg"


def _account_photo_is_fresh(account_id: str) -> bool:
    path = _account_photo_path(account_id)
    if not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age < 12 * 3600


def _chat_photo_path(account_id: str, chat_id: str) -> Path:
    safe_chat = str(chat_id).replace("/", "_").replace("\\", "_")
    return MEDIA_DIR / f"chat_{account_id}_{safe_chat}_photo.jpg"


def _chat_photo_is_fresh(account_id: str, chat_id: str) -> bool:
    path = _chat_photo_path(account_id, chat_id)
    if not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age < 12 * 3600


def _ensure_telegram_config() -> None:
    if not settings.telegram_api_id or not settings.telegram_api_hash.strip():
        raise HTTPException(
            status_code=500,
            detail="Telegram API credentials are missing in backend .env",
        )


def _session_name_for_client(session_file: str) -> str:
    as_str = str(Path(session_file))
    if as_str.endswith(".session"):
        return as_str[: -len(".session")]
    return as_str


_SESSION_BUSY_TIMEOUT_MS = 30_000


def _apply_wal_to_session_file(session_name: str) -> None:
    """Apply WAL journal mode and busy_timeout to a .session SQLite file.

    WAL mode is stored in the SQLite file header and persists across connections —
    calling this once ensures every future client for the same file uses WAL.
    Idempotent. No-op if the file does not exist yet.
    """
    path = Path(session_name)
    if not str(path).endswith(".session"):
        path = Path(str(path) + ".session")
    if not path.exists():
        return
    try:
        conn = sqlite3.connect(str(path), timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout={_SESSION_BUSY_TIMEOUT_MS}")
        conn.commit()
        conn.close()
    except Exception:
        pass


def _apply_session_busy_timeout(client: TelegramClient, timeout_ms: int = _SESSION_BUSY_TIMEOUT_MS) -> None:
    """Set busy_timeout on the Telethon client's own .session SQLite connection.

    Telethon's SQLiteSession opens its connection without a busy_timeout, so a write that
    hits a held lock fails instantly with ``database is locked``. Now that we keep clients
    connected (warm reuse) they overlap on the same session file with the persistent
    listeners and disconnect-time state saves. Setting busy_timeout here makes those tiny
    writes wait for the WAL lock instead of erroring. WAL is applied defensively too (it
    persists in the file header). Connection-level PRAGMAs only stick on this connection,
    which is exactly the one Telethon uses for the client's lifetime.

    No-op for non-SQLite sessions (e.g. StringSession).
    """
    try:
        session = getattr(client, "session", None)
        if session is None:
            return
        conn = getattr(session, "_conn", None)
        if conn is None:
            cursor_factory = getattr(session, "_cursor", None)
            if cursor_factory is None:
                return
            cursor_factory().close()  # forces SQLiteSession to open its connection
            conn = getattr(session, "_conn", None)
        if conn is None:
            return
        conn.execute(f"PRAGMA busy_timeout={int(timeout_ms)}")
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception:
        pass


async def _safe_disconnect(client: TelegramClient | None) -> None:
    """Disconnect a Telethon client, ignoring session-file lock errors.

    The campaign worker reuses clients across sends, keeping the .session SQLite file
    open.  When a second client (e.g. reply_stats / seen_stats) opens the same session
    and disconnects, Telethon's ``_save_states_and_entities`` write can hit
    ``database is locked``.  Catching that specific error is safe because the session
    state is ephemeral and will be persisted on the next connect.
    """
    if client is None:
        return
    if id(client) in PERSISTENT_CLIENT_IDS:
        return
    try:
        await client.disconnect()
    except sqlite3.OperationalError as exc:
        if "database is locked" not in str(exc).lower():
            raise


def is_persistent_account_client(client: TelegramClient | None) -> bool:
    return client is not None and id(client) in PERSISTENT_CLIENT_IDS


def register_persistent_account_client(account_id: str, client: TelegramClient) -> None:
    previous = PERSISTENT_ACCOUNT_CLIENTS.get(account_id)
    if previous is not None and previous is not client:
        PERSISTENT_CLIENT_IDS.discard(id(previous))
    PERSISTENT_ACCOUNT_CLIENTS[account_id] = client
    PERSISTENT_CLIENT_IDS.add(id(client))


def unregister_persistent_account_client(account_id: str, client: TelegramClient | None = None) -> None:
    current = PERSISTENT_ACCOUNT_CLIENTS.get(account_id)
    if client is not None and current is not client:
        PERSISTENT_CLIENT_IDS.discard(id(client))
        return
    removed = PERSISTENT_ACCOUNT_CLIENTS.pop(account_id, None)
    if removed is not None:
        PERSISTENT_CLIENT_IDS.discard(id(removed))


def _telethon_proxy_from_json(raw: str | None):
    """Build a Telethon/PySocks proxy tuple from an account's proxy_json so each
    account egresses from its own IP (ban-risk hardening). Returns None when unset,
    which preserves the previous (no-proxy) behavior exactly.

    proxy_json shape: {"type": "socks5"|"socks4"|"http", "host": str, "port": int,
                       "username"?: str, "password"?: str}
    """
    if not raw:
        return None
    try:
        cfg = json.loads(raw)
    except Exception:
        return None
    if not isinstance(cfg, dict) or not cfg.get("host") or not cfg.get("port"):
        return None
    import socks  # PySocks
    kind = {
        "socks5": socks.SOCKS5,
        "socks4": socks.SOCKS4,
        "http": socks.HTTP,
        "https": socks.HTTP,
    }.get(str(cfg.get("type") or cfg.get("protocol") or "socks5").lower(), socks.SOCKS5)
    return (
        kind,
        str(cfg["host"]),
        int(cfg["port"]),
        True,
        cfg.get("username") or None,
        cfg.get("password") or None,
    )


async def _open_account_client_for_user(user_id: str, account_id: str) -> tuple[sqlite3.Row, TelegramClient]:
    with db() as conn:
        account = conn.execute(
            "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not account["session_file"]:
        raise HTTPException(status_code=400, detail="Account has no session file")

    persistent = PERSISTENT_ACCOUNT_CLIENTS.get(account_id)
    if persistent is not None:
        try:
            if persistent.is_connected():
                return account, persistent
        except Exception:
            pass
        unregister_persistent_account_client(account_id, persistent)

    api_id = account["api_id"] or settings.telegram_api_id
    api_hash = account["api_hash"] or settings.telegram_api_hash
    fp_json = account["device_fingerprint_json"] or "{}"
    fp = json.loads(fp_json)
    proxy = _telethon_proxy_from_json(account["proxy_json"])
    last_error: Exception | None = None
    for attempt in range(10):
        client: TelegramClient | None = None
        try:
            client = TelegramClient(
                _session_name_for_client(account["session_file"]),
                api_id,
                api_hash,
                proxy=proxy,
            )
            if fp.get("device_model"):
                _apply_fingerprint(client, fp)
            await client.connect()
            _apply_wal_to_session_file(_session_name_for_client(account["session_file"]))
            _apply_session_busy_timeout(client)
            if not await client.is_user_authorized():
                await _safe_disconnect(client)
                raise HTTPException(
                    status_code=401,
                    detail="Account session is disconnected, reconnect this account",
                )
            last_error = None
            break
        except HTTPException:
            raise
        except (sqlite3.OperationalError, TimeoutError, ConnectionError, OSError) as exc:
            if isinstance(exc, sqlite3.OperationalError) and "database is locked" not in str(exc).lower():
                raise
            last_error = exc
            if client is not None:
                await _safe_disconnect(client)
            await asyncio.sleep(0.3 * (attempt + 1))
    if last_error is not None:
        if isinstance(last_error, sqlite3.OperationalError):
            raise HTTPException(
                status_code=503,
                detail="Telegram session is busy, retry in a moment",
            ) from last_error
        raise RuntimeError(
            f"Telegram account connection failed after 10 attempts: {type(last_error).__name__}: {last_error}"
        ) from last_error
    return account, client


async def acquire_warm_client(user_id: str, account_id: str) -> TelegramClient:
    """Return a connected Telethon client for an account, reusing a warm one if available.

    The dominant cost of the chat-reading endpoints was opening + connecting a fresh client
    on every request. This keeps the client connected between requests so the MTProto
    connect()/auth round-trip is paid only once until the idle sweeper evicts it.

    The caller MUST already hold ``_account_session_lock(account_id)`` so the warm client is
    never used by two requests concurrently. On any connection/auth trouble the caller should
    call ``evict_warm_client`` so the next request rebuilds it.
    """
    client = WARM_CLIENTS.get(account_id)
    if client is not None:
        try:
            if client.is_connected():
                WARM_CLIENT_LAST_USED[account_id] = time.time()
                return client
        except Exception:
            pass
        # Stale/dead handle — drop it and reopen below.
        await evict_warm_client(account_id)

    _, client = await _open_account_client_for_user(user_id, account_id)
    if is_persistent_account_client(client):
        return client
    WARM_CLIENTS[account_id] = client
    WARM_CLIENT_LAST_USED[account_id] = time.time()
    return client


async def evict_warm_client(account_id: str) -> None:
    """Disconnect and forget the warm client for an account (best-effort)."""
    client = WARM_CLIENTS.pop(account_id, None)
    WARM_CLIENT_LAST_USED.pop(account_id, None)
    if client is not None:
        await _safe_disconnect(client)


async def sweep_idle_warm_clients(max_idle: float = 60.0) -> None:
    """Disconnect warm clients that haven't been used within ``max_idle`` seconds."""
    now = time.time()
    stale = [
        account_id
        for account_id, last in list(WARM_CLIENT_LAST_USED.items())
        if now - last > max_idle
    ]
    for account_id in stale:
        await evict_warm_client(account_id)


async def disconnect_all_warm_clients() -> None:
    """Disconnect every warm client (used on shutdown)."""
    for account_id in list(WARM_CLIENTS.keys()):
        await evict_warm_client(account_id)


async def disconnect_all_persistent_clients() -> None:
    """Disconnect every registered persistent listener client (used on shutdown)."""
    for account_id, client in list(PERSISTENT_ACCOUNT_CLIENTS.items()):
        unregister_persistent_account_client(account_id, client)
        await _safe_disconnect(client)


async def _resolve_entity(client: TelegramClient, chat_id: str, access_hash: str | None = None):
    if not chat_id:
        raise ValueError("Empty chat_id provided to _resolve_entity")
    is_numeric = False
    numeric_id = None
    try:
        numeric_id = int(chat_id)
        is_numeric = True
    except (ValueError, TypeError):
        pass
    if is_numeric:
        try:
            return await client.get_entity(numeric_id)
        except ValueError:
            pass
        if access_hash:
            try:
                users = await client(GetUsersRequest([InputUser(user_id=numeric_id, access_hash=int(access_hash))]))
                if users and users[0]:
                    return users[0]
            except Exception:
                pass
        try:
            users = await client(GetUsersRequest([InputUser(user_id=numeric_id, access_hash=0)]))
            if users and users[0]:
                return users[0]
        except Exception:
            pass
        raise ValueError(f"Could not find the input entity for PeerUser(user_id={numeric_id})")
    return await client.get_entity(chat_id)


def _extract_invite_hash(chat_ref: str) -> str | None:
    value = (chat_ref or "").strip()
    if not value:
        return None
    if value.startswith("+"):
        return value[1:].strip() or None
    if value.lower().startswith("joinchat/"):
        return value.split("/", 1)[1].strip() or None

    parsed = urlparse(value)
    if parsed.scheme == "tg" and parsed.netloc.lower() == "join":
        invite = parse_qs(parsed.query).get("invite", [None])[0]
        return invite.strip() if invite else None
    if parsed.netloc.lower() in {"t.me", "telegram.me", "telegram.dog"}:
        path = parsed.path.strip("/")
        if path.startswith("+"):
            return path[1:].strip() or None
        if path.lower().startswith("joinchat/"):
            return path.split("/", 1)[1].strip() or None
    return None


async def _resolve_joinable_entity(client: TelegramClient, chat_ref: str):
    invite_hash = _extract_invite_hash(chat_ref)
    if not invite_hash:
        return await _resolve_entity(client, chat_ref)

    invite = await client(CheckChatInviteRequest(invite_hash))
    if isinstance(invite, ChatInviteAlready):
        return invite.chat
    raise ValueError("Account has not joined this private invite link yet")


async def _join_group_reference(client: TelegramClient, chat_ref: str):
    invite_hash = _extract_invite_hash(chat_ref)
    if invite_hash:
        try:
            updates = await client(ImportChatInviteRequest(invite_hash))
            chats = getattr(updates, "chats", None) or []
            if chats:
                return chats[0]
        except UserAlreadyParticipantError:
            pass
        invite = await client(CheckChatInviteRequest(invite_hash))
        if isinstance(invite, ChatInviteAlready):
            return invite.chat
        raise ValueError("Could not join private invite link")

    entity = await _resolve_entity(client, chat_ref)
    try:
        await client(JoinChannelRequest(entity))
    except UserAlreadyParticipantError:
        pass
    return entity


def _message_text(value: Any) -> str:
    text = (getattr(value, "message", None) or "").strip()
    if text:
        return text
    if getattr(value, "media", None):
        return "[Media]"
    return ""


def _message_media_type(value: Any) -> str | None:
    if getattr(value, "photo", None):
        return "photo"
    if getattr(value, "video", None):
        return "video"
    document = getattr(value, "document", None)
    if document:
        mime = (getattr(document, "mime_type", None) or "").lower()
        if mime.startswith("image/"):
            return "photo"
        if mime.startswith("video/"):
            return "video"
        return "file"
    return None


def _message_to_item(value: Any, account_id: str, chat_id: str) -> dict[str, Any]:
    media_type = _message_media_type(value)
    document = getattr(value, "document", None)
    mime = getattr(document, "mime_type", None)
    if not mime and getattr(value, "photo", None):
        mime = "image/jpeg"
    file_name = None
    if document and getattr(document, "attributes", None):
        for attr in document.attributes:
            if hasattr(attr, "file_name"):
                file_name = getattr(attr, "file_name")
                break
    sender = getattr(value, "sender", None)
    sender_name = get_display_name(sender) if sender else None
    return {
        "id": int(value.id),
        "accountId": account_id,
        "chatId": chat_id,
        "text": _message_text(value),
        "timestamp": value.date.astimezone(UTC).isoformat() if getattr(value, "date", None) else None,
        "outgoing": bool(getattr(value, "out", False)),
        "senderName": sender_name,
        "hasMedia": bool(media_type),
        "mediaType": media_type,
        "mediaMimeType": mime,
        "mediaFileName": file_name,
    }
