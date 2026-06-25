from __future__ import annotations

import asyncio
import io
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl import functions
from telethon.tl.functions.channels import LeaveChannelRequest
from telethon.tl.functions.contacts import BlockRequest
from telethon.tl.types import User, Chat, Channel, InputUser
from telethon.utils import get_display_name

from ..core.database import db, async_db_read, now_iso
from ..core.security import current_user_id, _user_from_token
from ..core.state import (
    CONVERSATIONS_CACHE,
    CONVERSATION_REFRESH_TASKS,
    FOLDER_CONVERSATIONS_CACHE,
    FOLDER_CONVERSATIONS_REFRESH_TASKS,
)
from ..core.config import settings, SESSION_DIR, MEDIA_DIR
from ..helpers.telegram import (
    _account_session_lock,
    _chat_photo_is_fresh,
    _chat_photo_path,
    _open_account_client_for_user,
    _resolve_entity,
    _message_text,
    _message_media_type,
    _message_to_item,
    _safe_disconnect,
    acquire_warm_client,
    evict_warm_client,
)
from ..models.schemas import BatchLeaveChatsPayload, BlockUserPayload, BatchBlockPayload, SendMessagePayload, ForwardMessagePayload, ForwardBatchPayload, LeaveChatPayload, MarkReadPayload

router = APIRouter(prefix="")

# How long a cached conversation page stays fresh. With warm clients a refresh is cheap, so a
# couple of minutes avoids reconnect churn while keeping the list reasonably live (the frontend
# also background-polls).
_CONVERSATIONS_TTL_SECONDS = 120


def _entity_chat_title(entity: Any, fallback: str) -> str:
    if hasattr(entity, 'first_name') and entity.first_name is not None:
        first = entity.first_name or ''
        last = getattr(entity, 'last_name', None) or ''
        return (first + ' ' + last).strip() or fallback
    if hasattr(entity, 'title') and entity.title:
        return entity.title
    if hasattr(entity, 'username') and entity.username:
        return f"@{entity.username}"
    return fallback


def _dialog_to_conv_item(account: dict[str, Any], account_label: str, dialog: Any) -> dict[str, Any]:
    """Build a conversation dict (the shape the Unibox consumes) from a Telethon dialog."""
    msg = dialog.message
    last_message_outgoing = False
    last_sender_name = None
    if msg:
        last_message_outgoing = bool(msg.out)
        if msg.sender:
            last_sender_name = get_display_name(msg.sender)
    timestamp = (
        msg.date.astimezone(UTC).isoformat()
        if msg and getattr(msg, "date", None)
        else None
    )
    entity = dialog.entity
    is_user = isinstance(entity, User)
    is_channel = isinstance(entity, Channel)
    is_megagroup = is_channel and getattr(entity, "megagroup", False)
    is_group = isinstance(entity, Chat) or is_megagroup
    is_channel_only = is_channel and not is_megagroup
    is_bot = is_user and getattr(entity, "bot", False)

    draft_text = None
    try:
        draft_obj = getattr(dialog, 'draft', None)
        if draft_obj and hasattr(draft_obj, 'text'):
            text = draft_obj.text
            if text and isinstance(text, str) and text.strip():
                draft_text = text
    except Exception:
        pass

    return {
        "id": f"{account['id']}::{dialog.id}",
        "accountId": account["id"],
        "accountLabel": account_label,
        "chatId": str(dialog.id),
        "chatTitle": _entity_chat_title(entity, str(dialog.id)),
        "chatUsername": getattr(entity, "username", None),
        "lastMessage": _message_text(msg) if msg and not getattr(msg, 'action', None) else "",
        "lastSenderName": last_sender_name,
        "lastMessageOutgoing": last_message_outgoing,
        "draft": draft_text,
        "timestamp": timestamp,
        "unreadCount": int(getattr(dialog, "unread_count", 0) or 0),
        "isGroup": is_group,
        "isChannel": is_channel_only,
        "isUser": is_user and not is_bot,
        "isBot": is_bot,
        "chatPhoto": getattr(entity, "photo", None) is not None,
    }



@router.get("/api/v1/messages/conversations")
async def list_conversations(
    limit: int = Query(default=80, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    folder_id: int | None = Query(default=None, ge=0),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    # For omnidash unified layer, prefer unified tables if they have data
    # This is part of the phased DB migration: unified becomes source of truth for inbox
    try:
        with db() as conn:
            rows = conn.execute(
                """
                SELECT c.id, c.platform_account_id as accountId, c.peer_display_name as chatTitle,
                       c.peer_username as chatUsername, c.last_message_preview as lastMessage,
                       c.last_message_at as timestamp, c.unread_count as unreadCount,
                       c.last_message_direction as lastMessageOutgoing
                FROM conversations c
                JOIN platform_accounts pa ON pa.id = c.platform_account_id
                WHERE pa.user_id = ?
                ORDER BY c.last_message_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        if rows:
            items = [dict(r) for r in rows]
            return {
                "conversations": items,
                "errors": [],
                "hasMore": False,
                "nextOffset": None,
                "refreshing": False,
            }
    except Exception:
        pass  # fall back to legacy Telethon-based list below
    safe_limit = max(1, int(limit))
    page_index = offset // safe_limit
    cache_key = f"{user_id}:{page_index}:folder:{folder_id}"
    now = datetime.now(UTC)
    cached = CONVERSATIONS_CACHE.get(cache_key)

    if cached and cached[0] > now:
        return {
            "conversations": cached[1],
            "errors": cached[2],
            "hasMore": cached[3],
            "nextOffset": (offset + safe_limit) if cached[3] else None,
            "refreshing": False,
        }

    account_rows = await async_db_read(
        lambda conn: conn.execute(
            "SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    )

    total_budget = min(safe_limit, 200)
    active_count = len([a for a in account_rows if a["session_file"] and not bool(a["exclude_chats"])])
    per_account_page_size = max(10, min(100, total_budget // max(active_count, 1)))
    per_account_start = page_index * per_account_page_size
    per_account_end = per_account_start + per_account_page_size

    async def _fetch_account_dialogs(account: dict[str, Any]) -> tuple[list[dict[str, Any]], bool, str | None]:
        if not account["session_file"]:
            return [], False, None
        if bool(account["exclude_chats"]):
            return [], False, None
        account_label = account["display_name"] or account["username"] or account["id"][:8]
        max_retries = 3
        for attempt in range(max_retries):
            lock = _account_session_lock(account["id"])
            lock_acquired = False
            client: TelegramClient | None = None
            try:
                await asyncio.wait_for(lock.acquire(), timeout=5)
                lock_acquired = True
                client = await asyncio.wait_for(acquire_warm_client(user_id, account["id"]), timeout=15)
                dialogs = await asyncio.wait_for(
                    client.get_dialogs(limit=per_account_end + 1, folder=folder_id),
                    timeout=20,
                )
                account_has_more = len(dialogs) > per_account_end
                sliced_dialogs = dialogs[per_account_start:per_account_end]
                items = [_dialog_to_conv_item(account, account_label, dialog) for dialog in sliced_dialogs]
                return items, account_has_more, None
            except TimeoutError:
                # A hung connection is the usual culprit — drop the warm client so the retry rebuilds it.
                await evict_warm_client(account["id"])
                if attempt < max_retries - 1:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                return [], False, f"{account_label}: timed out while loading chats"
            except HTTPException as exc:
                await evict_warm_client(account["id"])
                return [], False, f"{account_label}: {exc.detail}"
            except Exception as exc:
                await evict_warm_client(account["id"])
                return [], False, f"{account_label}: {exc}"
            finally:
                # Keep the client connected (warm) for reuse; just release the lock.
                if lock_acquired:
                    lock.release()
            break

    async def _refresh_cache() -> None:
        try:
            tasks = [_fetch_account_dialogs(account) for account in account_rows]
            results = await asyncio.gather(*tasks)

            all_items: list[dict[str, Any]] = []
            errors: list[str] = []
            any_account_has_more = False
            for items, has_more, error in results:
                all_items.extend(items)
                if has_more:
                    any_account_has_more = True
                if error:
                    errors.append(error)

            all_items.sort(key=lambda item: item["timestamp"] or "", reverse=True)
            if all_items:
                CONVERSATIONS_CACHE[cache_key] = (
                    datetime.now(UTC) + timedelta(seconds=_CONVERSATIONS_TTL_SECONDS),
                    all_items,
                    errors,
                    any_account_has_more,
                )
                # Upsert to unified for single DB strategy
                try:
                    from ..core.database import db
                    with db() as conn:
                        for item in all_items:
                            acc_id = item.get("accountId")
                            if acc_id:
                                conn.execute(
                                    "INSERT OR IGNORE INTO platform_accounts (id, user_id, platform, label, external_id, username, status, created_at) VALUES (?, ?, 'telegram', ?, ?, ?, 'connected', ?)",
                                    (acc_id, user_id, acc_id, item.get("chatId"), acc_id, now_iso()),
                                )
                                conn.execute(
                                    "INSERT OR REPLACE INTO conversations (id, platform_account_id, platform, peer_id, peer_display_name, last_message_at, last_message_preview, last_message_direction, unread_count, archived, interested, created_at) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 0, 0, ?)",
                                    (item.get("id"), acc_id, item.get("chatId"), item.get("chatTitle"), item.get("timestamp"), item.get("lastMessage"), item.get("lastMessageOutgoing") and 'out' or 'in', item.get("unreadCount") or 0, now_iso()),
                                )
                except Exception as e:
                    logger.warning("unified upsert failed: %s", e)
            elif CONVERSATIONS_CACHE.get(cache_key):
                stale = CONVERSATIONS_CACHE[cache_key]
                CONVERSATIONS_CACHE[cache_key] = (
                    datetime.now(UTC) + timedelta(seconds=_CONVERSATIONS_TTL_SECONDS),
                    stale[1],
                    stale[2] + errors,
                    stale[3],
                )
            else:
                CONVERSATIONS_CACHE[cache_key] = (
                    datetime.now(UTC) + timedelta(seconds=15),
                    [],
                    errors or ["Chats are still loading. Try again in a moment."],
                    False,
                )
        finally:
            CONVERSATION_REFRESH_TASKS.pop(cache_key, None)

    task = CONVERSATION_REFRESH_TASKS.get(cache_key)
    if task is None or task.done():
        task = asyncio.create_task(_refresh_cache())
        CONVERSATION_REFRESH_TASKS[cache_key] = task

    if cached:
        return {
            "conversations": cached[1],
            "errors": cached[2],
            "hasMore": cached[3],
            "nextOffset": (offset + safe_limit) if cached[3] else None,
            "refreshing": True,
        }

    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=30)
    except (TimeoutError, asyncio.CancelledError):
        # TimeoutError: still warming. CancelledError: client disconnected mid-request
        # (folder switch / navigation). In both cases the shielded refresh task keeps
        # running, so report "refreshing" instead of leaking a traceback.
        return {
            "conversations": [],
            "errors": ["Chats are still loading. Try again in a moment."],
            "hasMore": False,
            "nextOffset": None,
            "refreshing": True,
        }

    cached = CONVERSATIONS_CACHE.get(cache_key)
    cached_items, cached_errors, cached_has_more = (cached[1], cached[2], cached[3]) if cached else ([], [], False)
    return {
        "conversations": cached_items,
        "errors": cached_errors,
        "hasMore": cached_has_more,
        "nextOffset": (offset + safe_limit) if cached_has_more else None,
        "refreshing": False,
    }


async def _member_meta_map(
    user_id: str, account_id: str, chat_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Stored metadata (access_hash / username / display_name) for scraped members, keyed by id.

    Scraped users with no username and no dialog cannot be resolved from a bare numeric id, but the
    group scraper already saved their access_hash + name. We look it up so the folder can show the
    real name and the thread/send endpoints can resolve the peer. The access_hash is per-account, so
    we prefer the candidate row whose ``scraper_account_id`` matches the folder's account.
    """
    ids = [str(c) for c in chat_ids]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)

    def _merge(out: dict[str, dict[str, Any]], mid: str, access_hash, username, display_name) -> None:
        prev = out.get(mid) or {}
        out[mid] = {
            "access_hash": access_hash or prev.get("access_hash"),
            "username": username or prev.get("username"),
            "display_name": display_name or prev.get("display_name"),
        }

    def _q(conn):
        out: dict[str, dict[str, Any]] = {}
        # Lowest priority first; later rows override on a per-field basis.
        for r in conn.execute(
            f"""SELECT member_id, access_hash, username, full_name AS display_name
                FROM group_add_targets
                WHERE user_id = ? AND member_id IN ({placeholders})""",
            (user_id, *ids),
        ).fetchall():
            _merge(out, str(r["member_id"]), r["access_hash"], r["username"], r["display_name"])
        # group_scraper_candidates: prefer the same-account hash (applied last via ASC ordering).
        for r in conn.execute(
            f"""SELECT member_id, access_hash, username, display_name
                FROM group_scraper_candidates
                WHERE user_id = ? AND member_id IN ({placeholders})
                ORDER BY (scraper_account_id = ?) ASC, updated_at ASC""",
            (user_id, *ids, account_id),
        ).fetchall():
            _merge(out, str(r["member_id"]), r["access_hash"], r["username"], r["display_name"])
        # folder_chats is the primary, authoritative source — it's where the scraper-page metadata
        # is persisted at add-time. Match on the same account that owns the entry (access_hash is
        # per-account) and apply last so it wins.
        for r in conn.execute(
            f"""SELECT fc.chat_id AS member_id, fc.access_hash, fc.username, fc.display_name
                FROM folder_chats fc
                JOIN folders f ON f.id = fc.folder_id
                WHERE f.user_id = ? AND fc.account_id = ? AND fc.chat_id IN ({placeholders})""",
            (user_id, account_id, *ids),
        ).fetchall():
            _merge(out, str(r["member_id"]), r["access_hash"], r["username"], r["display_name"])
        return out

    return await async_db_read(_q)


async def _member_meta(user_id: str, account_id: str, chat_id: str) -> dict[str, Any] | None:
    """Single-member variant of ``_member_meta_map`` for the thread/send endpoints."""
    m = await _member_meta_map(user_id, account_id, [str(chat_id)])
    return m.get(str(chat_id))


def _placeholder_member_item(
    account: dict[str, Any], account_label: str, chat_id: str, meta: dict[str, Any] | None = None
) -> dict[str, Any]:
    """A folder member we couldn't resolve to a dialog or entity.

    Uses the scraper-stored name/username when available so the row shows a real name instead of a
    bare numeric id; falls back to the id only when nothing was stored.
    """
    username = (meta or {}).get("username")
    title = (meta or {}).get("display_name") or (f"@{username}" if username else None) or str(chat_id)
    return {
        "id": f"{account['id']}::{chat_id}",
        "accountId": account["id"],
        "accountLabel": account_label,
        "chatId": str(chat_id),
        "chatTitle": title,
        "chatUsername": username,
        "lastMessage": "",
        "lastSenderName": None,
        "lastMessageOutgoing": False,
        "draft": None,
        "timestamp": None,
        "unreadCount": 0,
        "isGroup": False,
        "isChannel": False,
        "isUser": True,
        "isBot": False,
        "chatPhoto": False,
    }


async def _resolve_member_via_entity(
    client: TelegramClient, account: dict[str, Any], account_label: str, chat_id: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Best-effort metadata for a folder member that has no dialog (e.g. a scraped user).

    Passes the scraper-stored access_hash to ``_resolve_entity`` so no-username members resolve;
    on failure falls back to a placeholder built from the stored name (not the raw id).
    """
    access_hash = (meta or {}).get("access_hash")
    try:
        entity = await asyncio.wait_for(
            _resolve_entity(client, str(chat_id), access_hash), timeout=10
        )
    except Exception:
        return _placeholder_member_item(account, account_label, chat_id, meta)

    is_user = isinstance(entity, User)
    is_channel = isinstance(entity, Channel)
    is_megagroup = is_channel and getattr(entity, "megagroup", False)
    is_group = isinstance(entity, Chat) or is_megagroup
    is_channel_only = is_channel and not is_megagroup
    is_bot = is_user and getattr(entity, "bot", False)
    return {
        "id": f"{account['id']}::{chat_id}",
        "accountId": account["id"],
        "accountLabel": account_label,
        "chatId": str(chat_id),
        "chatTitle": _entity_chat_title(entity, str(chat_id)),
        "chatUsername": getattr(entity, "username", None),
        "lastMessage": "",
        "lastSenderName": None,
        "lastMessageOutgoing": False,
        "draft": None,
        "timestamp": None,
        "unreadCount": 0,
        "isGroup": is_group,
        "isChannel": is_channel_only,
        "isUser": is_user and not is_bot,
        "isBot": is_bot,
        "chatPhoto": getattr(entity, "photo", None) is not None,
    }


@router.get("/api/v1/folders/{folder_id}/conversations")
async def list_folder_conversations(
    folder_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Resolve metadata for every chat in a folder.

    Unlike the inbox (which only shows recent dialogs), this returns ALL folder members:
    members the account has a dialog with get full metadata, and members it doesn't (e.g.
    scraped users with no message history) are resolved best-effort, falling back to a
    placeholder so they always appear.
    """
    def _load(conn):
        folder = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
        if not folder:
            return None, None, None
        member_rows = conn.execute(
            "SELECT account_id, chat_id, filter_tag FROM folder_chats WHERE folder_id = ? ORDER BY added_at DESC",
            (folder_id,),
        ).fetchall()
        account_rows = conn.execute(
            "SELECT * FROM accounts WHERE user_id = ?", (user_id,)
        ).fetchall()
        return folder, member_rows, account_rows

    folder, member_rows, account_rows = await async_db_read(_load)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    accounts_by_id = {a["id"]: a for a in account_rows}
    members_by_account: dict[str, list[str]] = {}
    # Per-member filter label, keyed by (account_id, chat_id), attached to each item after resolution.
    tag_by_key: dict[tuple[str, str], str | None] = {}
    for row in member_rows:
        members_by_account.setdefault(row["account_id"], []).append(str(row["chat_id"]))
        tag_by_key[(str(row["account_id"]), str(row["chat_id"]))] = row["filter_tag"]

    cache_key = f"{user_id}:foldconv:{folder_id}"
    now = datetime.now(UTC)
    cached = FOLDER_CONVERSATIONS_CACHE.get(cache_key)
    if cached and cached[0] > now:
        return {"conversations": cached[1], "errors": cached[2], "refreshing": False}

    async def _resolve_account(account_id: str, chat_ids: list[str]) -> tuple[list[dict[str, Any]], str | None]:
        # Pull stored scraper metadata up front (independent of the Telegram client) so even the
        # error/placeholder paths can show real names instead of raw ids.
        meta_map = await _member_meta_map(user_id, account_id, chat_ids)
        account = accounts_by_id.get(account_id)
        if not account or not account["session_file"]:
            label = (account["display_name"] or account["username"] or account_id[:8]) if account else account_id[:8]
            return [_placeholder_member_item({"id": account_id}, label, cid, meta_map.get(cid)) for cid in chat_ids], None
        account = dict(account)
        account_label = account["display_name"] or account["username"] or account["id"][:8]
        lock = _account_session_lock(account_id)
        lock_acquired = False
        try:
            await asyncio.wait_for(lock.acquire(), timeout=5)
            lock_acquired = True
            client = await asyncio.wait_for(acquire_warm_client(user_id, account_id), timeout=15)
            dialogs = await asyncio.wait_for(client.get_dialogs(limit=200), timeout=20)
            dialog_by_id = {str(d.id): d for d in dialogs}
            items: list[dict[str, Any]] = []
            for cid in chat_ids:
                dialog = dialog_by_id.get(cid)
                if dialog is not None:
                    items.append(_dialog_to_conv_item(account, account_label, dialog))
                else:
                    items.append(await _resolve_member_via_entity(client, account, account_label, cid, meta_map.get(cid)))
            return items, None
        except Exception as exc:
            await evict_warm_client(account_id)
            # Couldn't reach this account — still surface its members as placeholders.
            return [_placeholder_member_item(account, account_label, cid, meta_map.get(cid)) for cid in chat_ids], f"{account_label}: {exc}"
        finally:
            if lock_acquired:
                lock.release()

    async def _refresh_cache() -> None:
        try:
            tasks = [_resolve_account(acct_id, cids) for acct_id, cids in members_by_account.items()]
            results = await asyncio.gather(*tasks) if tasks else []
            all_items: list[dict[str, Any]] = []
            errors: list[str] = []
            for items, error in results:
                all_items.extend(items)
                if error:
                    errors.append(error)
            for item in all_items:
                item["filterTag"] = tag_by_key.get(
                    (str(item.get("accountId")), str(item.get("chatId")))
                )
            all_items.sort(key=lambda item: item["timestamp"] or "", reverse=True)
            FOLDER_CONVERSATIONS_CACHE[cache_key] = (
                datetime.now(UTC) + timedelta(seconds=_CONVERSATIONS_TTL_SECONDS),
                all_items,
                errors,
                False,
            )
        finally:
            FOLDER_CONVERSATIONS_REFRESH_TASKS.pop(cache_key, None)

    task = FOLDER_CONVERSATIONS_REFRESH_TASKS.get(cache_key)
    if task is None or task.done():
        task = asyncio.create_task(_refresh_cache())
        FOLDER_CONVERSATIONS_REFRESH_TASKS[cache_key] = task

    if cached:
        # Serve stale immediately while the refresh runs in the background.
        return {"conversations": cached[1], "errors": cached[2], "refreshing": True}

    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=30)
    except (TimeoutError, asyncio.CancelledError):
        # See note in list_conversations: client disconnect or warm-up timeout; the
        # background refresh continues under asyncio.shield.
        return {
            "conversations": [],
            "errors": ["Folder chats are still loading. Try again in a moment."],
            "refreshing": True,
        }

    cached = FOLDER_CONVERSATIONS_CACHE.get(cache_key)
    cached_items, cached_errors = (cached[1], cached[2]) if cached else ([], [])
    return {"conversations": cached_items, "errors": cached_errors, "refreshing": False}


@router.get("/api/v1/messages/unread-summary")
async def unread_summary(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    total_unread = 0
    seen: set[str] = set()
    items: list[dict[str, Any]] = []

    for cache_key, (_, conv_items, _, _) in CONVERSATIONS_CACHE.items():
        if not cache_key.startswith(f"{user_id}:"):
            continue
        for c in conv_items:
            uid = c.get("id", "")
            if uid in seen:
                continue
            seen.add(uid)
            unread = c.get("unreadCount", 0) or 0
            if unread > 0:
                total_unread += 1
                items.append({
                    "id": uid,
                    "accountId": c["accountId"],
                    "chatId": c["chatId"],
                    "chatTitle": c["chatTitle"],
                    "lastMessage": c.get("lastMessage", ""),
                    "timestamp": c.get("timestamp", ""),
                    "unreadCount": unread,
                    "isUser": c.get("isUser", False),
                    "isBot": c.get("isBot", False),
                })

    items.sort(key=lambda n: n["timestamp"] or "", reverse=True)
    items = items[:30]

    return {"total_unread": total_unread, "items": items}


@router.get("/api/v1/messages/folders")
async def list_folders(
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    account_rows = await async_db_read(
        lambda conn: conn.execute(
            "SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    )

    all_folders: dict[str, dict[str, Any]] = {}
    errors: list[str] = []

    for account in account_rows:
        if not account["session_file"]:
            continue
        if bool(account["exclude_chats"]):
            continue
        lock = _account_session_lock(account["id"])
        async with lock:
            client: TelegramClient | None = None
            try:
                _, client = await _open_account_client_for_user(user_id, account["id"])
                result = await client(functions.messages.GetDialogFiltersRequest())
                for item in result:
                    if hasattr(item, 'id') and hasattr(item, 'title'):
                        folder_id = str(item.id)
                        if folder_id not in all_folders:
                            title = ""
                            if hasattr(item.title, 'text'):
                                title = item.title.text
                            elif isinstance(item.title, str):
                                title = item.title
                            all_folders[folder_id] = {
                                "id": folder_id,
                                "title": title or f"Folder {item.id}",
                                "emoticon": getattr(item, 'emoticon', '') or '',
                                "color": getattr(item, 'color', None),
                                "pinned_peers_count": len(getattr(item, 'pinned_peers', []) or []),
                                "include_peers_count": len(getattr(item, 'include_peers', []) or []),
                            }
            except Exception as exc:
                errors.append(f"{account['username']}: {exc}")
            finally:
                if client:
                    await _safe_disconnect(client)

    folders = sorted(all_folders.values(), key=lambda x: int(x["id"]))
    return {
        "folders": folders,
        "errors": errors,
    }


@router.get("/api/v1/messages/thread")
async def thread(
    account_id: str,
    chat_id: str,
    limit: int = Query(default=100, ge=1, le=200),
    before_id: int | None = None,
    after_id: int | None = None,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    # Prefer unified tables for omnidash (phased migration)
    try:
        with db() as conn:
            rows = conn.execute(
                """
                SELECT m.id, m.body as text, m.sent_at as timestamp, m.direction,
                       m.author_name as senderName
                FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE c.platform_account_id = ? AND c.peer_id = ?
                ORDER BY m.sent_at DESC
                LIMIT ?
                """,
                (account_id, chat_id, limit),
            ).fetchall()
        if rows:
            # Convert to legacy shape the old frontend expects, but unified shape for dash
            items = []
            for r in rows:
                items.append({
                    "id": r["id"],
                    "accountId": account_id,
                    "chatId": chat_id,
                    "text": r["text"],
                    "timestamp": r["timestamp"],
                    "outgoing": r["direction"] == "out",
                    "senderName": r["senderName"],
                })
            return {"items": items}
    except Exception:
        pass

    lock = _account_session_lock(account_id)
    async with lock:
        client = await acquire_warm_client(user_id, account_id)
        try:
            meta = await _member_meta(user_id, account_id, chat_id)
            entity = await _resolve_entity(client, chat_id, meta.get("access_hash") if meta else None)
            max_id = before_id if before_id and before_id > 0 else 0
            min_id = after_id if after_id and after_id > 0 else 0
            messages = await client.get_messages(entity, limit=limit, min_id=min_id, max_id=max_id)
            ordered = list(reversed(list(messages)))
            items = [_message_to_item(msg, account_id, chat_id) for msg in ordered if getattr(msg, "id", None) and not getattr(msg, "action", None)]
            return {"items": items}
        except Exception:
            await evict_warm_client(account_id)
            raise


@router.post("/api/v1/messages/send")
async def send_message(payload: SendMessagePayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="Message exceeds Telegram's 4096-character limit")
    lock = _account_session_lock(payload.accountId)
    async with lock:
        client = await acquire_warm_client(user_id, payload.accountId)
        try:
            meta = await _member_meta(user_id, payload.accountId, payload.chatId)
            entity = await _resolve_entity(client, payload.chatId, meta.get("access_hash") if meta else None)
            sent = await client.send_message(entity, text)
            # Write to unified inbox tables (single DB strategy)
            try:
                from ..core.database import db
                with db() as conn:
                    # ensure platform account (simple upsert)
                    conn.execute(
                        "INSERT OR IGNORE INTO platform_accounts (id, user_id, platform, label, external_id, username, status, created_at) VALUES (?, ?, 'telegram', ?, ?, ?, 'connected', ?)",
                        (payload.accountId, user_id, payload.accountId, payload.chatId, payload.accountId, now_iso()),
                    )
                    # upsert conversation
                    conn.execute(
                        """INSERT OR REPLACE INTO conversations (id, platform_account_id, platform, peer_id, peer_display_name, last_message_at, last_message_preview, last_message_direction, unread_count, archived, interested, created_at)
                        VALUES (?, ?, 'telegram', ?, ?, ?, ?, 'out', 0, 0, 0, ?)""",
                        (f"{payload.accountId}::{payload.chatId}", payload.accountId, payload.chatId, payload.chatId, now_iso(), text[:100], now_iso()),
                    )
                    # insert message
                    conn.execute(
                        "INSERT INTO messages (id, conversation_id, platform, direction, body, sent_at, created_at) VALUES (?, ?, 'telegram', 'out', ?, ?, ?)",
                        (str(sent.id), f"{payload.accountId}::{payload.chatId}", text, now_iso(), now_iso()),
                    )
            except Exception as e:
                logger.warning("Failed to write to unified tables: %s", e)
            return {"ok": True, "item": _message_to_item(sent, payload.accountId, payload.chatId)}
        except Exception:
            await evict_warm_client(payload.accountId)
            raise


@router.post("/api/v1/messages/send-file")
async def send_file_message(
    account_id: str = Form(...),
    chat_id: str = Form(...),
    caption: str = Form(default=""),
    file: UploadFile = File(...),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(caption.strip()) > 1024:
        raise HTTPException(status_code=400, detail="Caption exceeds Telegram's 1024-character limit")

    lock = _account_session_lock(account_id)
    async with lock:
        client = await acquire_warm_client(user_id, account_id)
        try:
            meta = await _member_meta(user_id, account_id, chat_id)
            entity = await _resolve_entity(client, chat_id, meta.get("access_hash") if meta else None)
            file_stream = io.BytesIO(content)
            file_stream.name = file.filename or "upload.bin"
            sent = await client.send_file(entity, file=file_stream, caption=(caption.strip() or None))
            return {"ok": True, "item": _message_to_item(sent, account_id, chat_id)}
        except Exception:
            await evict_warm_client(account_id)
            raise


@router.post("/api/v1/messages/forward")
async def forward_message(payload: ForwardMessagePayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    lock = _account_session_lock(payload.accountId)
    async with lock:
        client = await acquire_warm_client(user_id, payload.accountId)
        try:
            from_entity = await _resolve_entity(client, payload.fromChatId)
            to_meta = await _member_meta(user_id, payload.accountId, payload.toChatId)
            to_entity = await _resolve_entity(client, payload.toChatId, to_meta.get("access_hash") if to_meta else None)
            forwarded = await client.forward_messages(to_entity, [payload.messageId], from_peer=from_entity)
            msg = forwarded[0] if forwarded else None
            if not msg:
                raise HTTPException(status_code=500, detail="Forward returned no message")
            return {"ok": True, "item": _message_to_item(msg, payload.accountId, payload.toChatId)}
        except Exception:
            await evict_warm_client(payload.accountId)
            raise


@router.post("/api/v1/messages/forward-batch")
async def forward_batch(payload: ForwardBatchPayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    lock = _account_session_lock(payload.accountId)
    async with lock:
        _, client = await _open_account_client_for_user(user_id, payload.accountId)
        try:
            from_entity = await _resolve_entity(client, payload.fromChatId)
            results: list[dict[str, Any]] = []
            for to_chat_id in payload.toChatIds:
                try:
                    to_meta = await _member_meta(user_id, payload.accountId, to_chat_id)
                    to_entity = await _resolve_entity(client, to_chat_id, to_meta.get("access_hash") if to_meta else None)
                    forwarded = await client.forward_messages(
                        to_entity, [payload.messageId], from_peer=from_entity
                    )
                    msg = forwarded[0] if forwarded else None
                    results.append({
                        "toChatId": to_chat_id,
                        "ok": msg is not None,
                        "item": _message_to_item(msg, payload.accountId, to_chat_id) if msg else None,
                    })
                except Exception as e:  # noqa: BLE001 — per-recipient failure must not abort the batch
                    results.append({"toChatId": to_chat_id, "ok": False, "error": str(e)})
            return {"ok": True, "results": results}
        finally:
            await _safe_disconnect(client)


@router.get("/api/v1/messages/resolve-user")
async def resolve_user(accountId: str, query: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    lock = _account_session_lock(accountId)
    async with lock:
        _, client = await _open_account_client_for_user(user_id, accountId)
        try:
            entity = await _resolve_entity(client, query.strip().lstrip("@"))
            name = " ".join(
                filter(None, [getattr(entity, "first_name", None), getattr(entity, "last_name", None)])
            ) or getattr(entity, "title", None) or getattr(entity, "username", None) or str(entity.id)
            return {
                "ok": True,
                "chatId": str(entity.id),
                "name": name,
                "username": getattr(entity, "username", None),
            }
        except Exception:
            raise HTTPException(status_code=404, detail="Could not find that user")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/messages/leave-chat")
async def leave_chat(
    payload: LeaveChatPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    lock = _account_session_lock(payload.accountId)
    lock_acquired = False
    client: TelegramClient | None = None
    try:
        try:
            await asyncio.wait_for(lock.acquire(), timeout=20)
            lock_acquired = True
        except TimeoutError:
            raise HTTPException(
                status_code=409,
                detail="This account is busy loading messages. Try leaving again in a few seconds.",
            )

        _, client = await asyncio.wait_for(
            _open_account_client_for_user(user_id, payload.accountId),
            timeout=20,
        )
        entity = await asyncio.wait_for(_resolve_entity(client, payload.chatId), timeout=12)
        if isinstance(entity, (User, Chat)):
            await asyncio.wait_for(client.delete_dialog(entity), timeout=15)
        elif isinstance(entity, Channel):
            await asyncio.wait_for(client(LeaveChannelRequest(entity)), timeout=15)
        else:
            raise HTTPException(status_code=400, detail="Selected chat is not a group or channel")

        keys_to_delete = [k for k in CONVERSATIONS_CACHE if k.startswith(f"{user_id}:")]
        for k in keys_to_delete:
            del CONVERSATIONS_CACHE[k]
        return {"ok": True}
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Telegram took too long to leave this chat. Try again in a moment.",
        )
    except FloodWaitError as exc:
        raise HTTPException(
            status_code=429,
            detail=f"Telegram flood wait: {exc.seconds}s remaining. Try again later.",
        )
    finally:
        if client is not None:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=5)
            except Exception:
                pass
        if lock_acquired:
            lock.release()


@router.post("/api/v1/messages/block-user")
async def block_user(
    payload: BlockUserPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    lock = _account_session_lock(payload.account_id)
    async with lock:
        _, client = await _open_account_client_for_user(user_id, payload.account_id)
        try:
            entity = await _resolve_entity(client, payload.chat_id)
            uid = int(getattr(entity, "id", 0))
            ah = getattr(entity, "access_hash", 0) or 0
            await client(BlockRequest(id=InputUser(user_id=uid, access_hash=ah)))
            return {"ok": True}
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/messages/batch-block")
async def batch_block_users(
    payload: BatchBlockPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    blocked = 0
    errors: list[str] = []

    by_account: dict[str, list[str]] = {}
    for entry in payload.items:
        by_account.setdefault(entry.account_id, []).append(entry.chat_id)

    for account_id, chat_ids in by_account.items():
        lock = _account_session_lock(account_id)
        client: TelegramClient | None = None
        try:
            try:
                await asyncio.wait_for(lock.acquire(), timeout=20)
            except TimeoutError:
                for cid in chat_ids:
                    errors.append(f"{account_id}::{cid}: account is busy")
                continue

            _, client = await asyncio.wait_for(
                _open_account_client_for_user(user_id, account_id),
                timeout=20,
            )
            for chat_id in chat_ids:
                try:
                    entity = await asyncio.wait_for(_resolve_entity(client, chat_id), timeout=12)
                    uid = int(getattr(entity, "id", 0))
                    ah = getattr(entity, "access_hash", 0) or 0
                    await client(BlockRequest(id=InputUser(user_id=uid, access_hash=ah)))
                    blocked += 1
                except Exception as exc:
                    errors.append(f"{account_id}::{chat_id}: {exc}")
        except TimeoutError:
            for cid in chat_ids:
                errors.append(f"{account_id}::{cid}: timeout connecting")
        except Exception as exc:
            for cid in chat_ids:
                errors.append(f"{account_id}::{cid}: {exc}")
        finally:
            if client is not None:
                try:
                    await asyncio.wait_for(client.disconnect(), timeout=5)
                except Exception:
                    pass
            lock.release()

    return {"ok": True, "blocked": blocked, "errors": errors}


@router.post("/api/v1/messages/mark-read")
async def mark_read(
    payload: MarkReadPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    lock = _account_session_lock(payload.accountId)
    async with lock:
        client = await acquire_warm_client(user_id, payload.accountId)
        try:
            meta = await _member_meta(user_id, payload.accountId, payload.chatId)
            entity = await _resolve_entity(client, payload.chatId, meta.get("access_hash") if meta else None)
            await client.send_read_acknowledge(entity)
            # Update unified
            try:
                from ..core.database import db
                with db() as conn:
                    conn.execute(
                        "UPDATE conversations SET unread_count = 0 WHERE id = ?",
                        (f"{payload.accountId}::{payload.chatId}",),
                    )
            except Exception:
                pass
            return {"ok": True}
        except Exception:
            await evict_warm_client(payload.accountId)
            raise


@router.post("/api/v1/messages/batch-leave")
async def batch_leave_chats(
    payload: BatchLeaveChatsPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    left = 0
    errors: list[str] = []

    by_account: dict[str, list[str]] = {}
    for entry in payload.chats:
        by_account.setdefault(entry.account_id, []).append(entry.chat_id)

    for account_id, chat_ids in by_account.items():
        lock = _account_session_lock(account_id)
        client: TelegramClient | None = None
        try:
            try:
                await asyncio.wait_for(lock.acquire(), timeout=20)
            except TimeoutError:
                for cid in chat_ids:
                    errors.append(f"{account_id}::{cid}: account is busy, try again later")
                continue

            _, client = await asyncio.wait_for(
                _open_account_client_for_user(user_id, account_id),
                timeout=20,
            )
            for chat_id in chat_ids:
                try:
                    entity = await asyncio.wait_for(_resolve_entity(client, chat_id), timeout=12)
                    if isinstance(entity, (User, Chat)):
                        await asyncio.wait_for(client.delete_dialog(entity), timeout=15)
                    elif isinstance(entity, Channel):
                        await asyncio.wait_for(client(LeaveChannelRequest(entity)), timeout=15)
                    else:
                        errors.append(f"{account_id}::{chat_id}: not a group or channel")
                        continue
                    left += 1
                except TimeoutError:
                    errors.append(f"{account_id}::{chat_id}: timeout leaving chat")
                except FloodWaitError as exc:
                    errors.append(f"{account_id}::{chat_id}: flood wait {exc.seconds}s")
                except Exception as exc:
                    errors.append(f"{account_id}::{chat_id}: {exc}")
        except TimeoutError:
            for cid in chat_ids:
                errors.append(f"{account_id}::{cid}: timeout connecting")
        except Exception as exc:
            for cid in chat_ids:
                errors.append(f"{account_id}::{cid}: {exc}")
        finally:
            if client is not None:
                try:
                    await asyncio.wait_for(client.disconnect(), timeout=5)
                except Exception:
                    pass
            lock.release()

    keys = [k for k in CONVERSATIONS_CACHE if k.startswith(f"{user_id}:")]
    for k in keys:
        del CONVERSATIONS_CACHE[k]
    return {"ok": True, "left": left, "errors": errors}


@router.get("/api/v1/messages/media")
async def get_media(
    account_id: str,
    chat_id: str,
    message_id: int,
    user_id: str = Depends(current_user_id),
) -> Response:
    row = await async_db_read(
        lambda conn: conn.execute(
            """
            SELECT media_path, media_mime_type
            FROM messages
            WHERE id = ? AND account_id = ? AND chat_id = ? AND user_id = ?
            """,
            (message_id, account_id, chat_id, user_id),
        ).fetchone()
    )
    if row and row["media_path"]:
        p = Path(row["media_path"])
        if p.exists():
            return Response(content=p.read_bytes(), media_type=row["media_mime_type"] or "application/octet-stream")

    lock = _account_session_lock(account_id)
    async with lock:
        _, client = await _open_account_client_for_user(user_id, account_id)
        try:
            meta = await _member_meta(user_id, account_id, chat_id)
            entity = await _resolve_entity(client, chat_id, meta.get("access_hash") if meta else None)
            msg = await client.get_messages(entity, ids=message_id)
            if not msg or not getattr(msg, "media", None):
                raise HTTPException(status_code=404, detail="Media not found")
            content = await client.download_media(msg, file=bytes)
            if not content:
                raise HTTPException(status_code=404, detail="Media download failed")
            mime = getattr(getattr(msg, "document", None), "mime_type", None) or "application/octet-stream"
            if getattr(msg, "photo", None):
                mime = "image/jpeg"
            return Response(content=content, media_type=mime)
        finally:
            await _safe_disconnect(client)


@router.get("/api/v1/messages/profile-photo")
async def get_profile_photo(
    account_id: str,
    chat_id: str,
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> Response:
    """Serve a conversation participant's Telegram profile photo (cached on disk for 12h).

    Auth accepts either a Bearer header or a ?token= query param so the URL can be used directly
    as an <img src>. Returns 204 when the entity has no profile photo.
    """
    auth_token = ""
    if authorization.startswith("Bearer "):
        auth_token = authorization.removeprefix("Bearer ").strip()
    elif token:
        auth_token = token.strip()
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    user = await async_db_read(lambda conn: _user_from_token(conn, auth_token))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = user["id"]

    photo_path = _chat_photo_path(account_id, chat_id)
    _IMG_CACHE = {"Cache-Control": "public, max-age=86400"}
    if _chat_photo_is_fresh(account_id, chat_id):
        return Response(content=photo_path.read_bytes(), media_type="image/jpeg", headers=_IMG_CACHE)

    # Reuse the warm (already-connected) client instead of opening a fresh MTProto connection per
    # avatar, fetch only the small thumbnail, and never raise — a broken avatar must fall back to
    # the initial in the UI, not 500.
    lock = _account_session_lock(account_id)
    try:
        await asyncio.wait_for(lock.acquire(), timeout=10)
    except TimeoutError:
        return Response(status_code=204)
    try:
        client = await acquire_warm_client(user_id, account_id)
        try:
            peer: Any = int(chat_id)
        except (TypeError, ValueError):
            peer = chat_id
        buf = io.BytesIO()
        downloaded = await asyncio.wait_for(
            client.download_profile_photo(peer, file=buf, download_big=False),
            timeout=20,
        )
        if not downloaded:
            return Response(status_code=204, headers={"Cache-Control": "public, max-age=600"})
        buf.seek(0)
        photo_bytes = buf.read()
        photo_path.write_bytes(photo_bytes)
        return Response(content=photo_bytes, media_type="image/jpeg", headers=_IMG_CACHE)
    except Exception:
        await evict_warm_client(account_id)
        return Response(status_code=204)
    finally:
        lock.release()
