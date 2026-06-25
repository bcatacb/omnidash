"""Always-on listeners that auto-populate 'group_chat' folders.

For each connected account that owns at least one ``group_chat`` folder, we keep a
persistent Telethon client connected with a ``NewMessage`` handler on the watched
group(s). Whenever a message is **forwarded into** a watched group, we read the original
author from the forward header (``fwd_from``), resolve a ``(account_id, chat_id)`` to file
them under, and add them to the matching folder's ``folder_chats``.

Mirrors ``notification_listener_worker.py`` (persistent client + reconcile/resume lifecycle).
"""
from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from telethon import TelegramClient, events, utils
from telethon.tl.types import PeerUser

from ..core.database import async_db_write, db, now_iso
from ..core.state import (
    GROUP_FOLDER_LISTENER_STOP_REQUESTED,
    GROUP_FOLDER_LISTENER_TASKS,
)
from ..helpers.telegram import (
    _account_session_lock,
    _open_account_client_for_user,
    _resolve_entity,
    _safe_disconnect,
    evict_warm_client,
    register_persistent_account_client,
    unregister_persistent_account_client,
)

logger = logging.getLogger(__name__)


def _group_chat_folders_for_account(account_id: str) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, watch_account_id, watch_chat_id
            FROM folders
            WHERE folder_type = 'group_chat' AND watch_account_id = ? AND watch_chat_id != ''
            """,
            (account_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _user_account_ids(user_id: str) -> list[str]:
    with db() as conn:
        rows = conn.execute("SELECT id FROM accounts WHERE user_id = ?", (user_id,)).fetchall()
    return [str(r["id"]) for r in rows]


async def _resolve_filing_account(user_id: str, watch_account_id: str, orig_id: int, watch_client: TelegramClient) -> str:
    """Pick the account to file the user under.

    Prefer the watching account, then any other connected account that has/knows them,
    else fall back to the watching account ("add anyway").
    """
    try:
        await watch_client.get_entity(orig_id)
        return watch_account_id
    except Exception:  # noqa: BLE001 - fall through to scanning other accounts
        pass

    for other_id in _user_account_ids(user_id):
        if other_id == watch_account_id:
            continue
        lock = _account_session_lock(other_id)
        client: TelegramClient | None = None
        try:
            async with lock:
                _, client = await _open_account_client_for_user(user_id, other_id)
                await _resolve_entity(client, str(orig_id))
                return other_id
        except Exception:  # noqa: BLE001 - this account cannot resolve them; try the next
            continue
        finally:
            await _safe_disconnect(client)

    return watch_account_id


async def run_account_listener(account_id: str) -> None:
    """Keep a persistent client connected and add forwarded authors to group_chat folders."""
    folders = _group_chat_folders_for_account(account_id)
    if not folders:
        return
    user_id = folders[0]["user_id"]

    client: TelegramClient | None = None
    try:
        lock = _account_session_lock(account_id)
        async with lock:
            await evict_warm_client(account_id)
            _, client = await _open_account_client_for_user(user_id, account_id)
            register_persistent_account_client(account_id, client)

            entities = []
            chat_to_folders: dict[int, list[str]] = {}
            for f in folders:
                try:
                    entity = await _resolve_entity(client, f["watch_chat_id"])
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "[GROUPFOLDER] account %s: cannot resolve group %s: %s",
                        account_id,
                        f["watch_chat_id"],
                        exc,
                    )
                    continue
                entities.append(entity)
                peer_id = utils.get_peer_id(entity)
                chat_to_folders.setdefault(peer_id, []).append(f["id"])
            if not entities:
                logger.warning("[GROUPFOLDER] account %s: no resolvable watched groups, stopping", account_id)
                return

            async def _handler(event: events.NewMessage.Event) -> None:
                try:
                    msg = event.message
                    fwd = getattr(msg, "fwd_from", None)
                    if fwd is None:
                        return
                    from_id = getattr(fwd, "from_id", None)
                    if not isinstance(from_id, PeerUser):
                        return
                    orig_id = int(from_id.user_id)

                    folder_ids = chat_to_folders.get(event.chat_id, [])
                    if not folder_ids:
                        return

                    filing_account = await _resolve_filing_account(user_id, account_id, orig_id, client)
                    chat_id = str(orig_id)
                    now = now_iso()
                    for folder_id in folder_ids:
                        await async_db_write(
                            lambda conn, fid=folder_id: conn.execute(
                                "INSERT OR IGNORE INTO folder_chats (id, folder_id, account_id, chat_id, added_at) VALUES (?, ?, ?, ?, ?)",
                                (uuid4().hex, fid, filing_account, chat_id, now),
                            )
                        )
                    logger.info(
                        "[GROUPFOLDER] account %s: added user %s to %d folder(s)",
                        account_id,
                        orig_id,
                        len(folder_ids),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[GROUPFOLDER] account %s: handler error: %s", account_id, exc)

            client.add_event_handler(_handler, events.NewMessage(chats=entities))
        logger.info("[GROUPFOLDER] account %s: listener armed for %s group(s)", account_id, len(entities))
        await client.run_until_disconnected()
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("[GROUPFOLDER] account %s: listener stopped: %s", account_id, exc)
    finally:
        lock = _account_session_lock(account_id)
        async with lock:
            unregister_persistent_account_client(account_id, client)
            await _safe_disconnect(client)


def _start_listener(account_id: str) -> None:
    """Create the listener task with a crash wrapper that cleans up state."""
    existing = GROUP_FOLDER_LISTENER_TASKS.get(account_id)
    if existing and not existing.done():
        return
    GROUP_FOLDER_LISTENER_STOP_REQUESTED.discard(account_id)
    task = asyncio.create_task(run_account_listener(account_id))
    GROUP_FOLDER_LISTENER_TASKS[account_id] = task

    async def _crash_wrapper() -> None:
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("[GROUPFOLDER] listener task crashed for account %s", account_id)
        finally:
            if GROUP_FOLDER_LISTENER_TASKS.get(account_id) is task:
                GROUP_FOLDER_LISTENER_TASKS.pop(account_id, None)

    asyncio.ensure_future(_crash_wrapper())


async def _stop_listener(account_id: str) -> None:
    GROUP_FOLDER_LISTENER_STOP_REQUESTED.add(account_id)
    task = GROUP_FOLDER_LISTENER_TASKS.pop(account_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    GROUP_FOLDER_LISTENER_STOP_REQUESTED.discard(account_id)


def _accounts_with_group_chat_folders(user_id: str) -> set[str]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT watch_account_id FROM folders
            WHERE user_id = ? AND folder_type = 'group_chat' AND watch_account_id != ''
            """,
            (user_id,),
        ).fetchall()
    return {str(r["watch_account_id"]) for r in rows}


async def reconcile_group_folder_listeners(user_id: str) -> None:
    """Restart this user's group-folder listeners to match the current set of group_chat folders."""
    for account_id in _user_account_ids(user_id):
        if account_id in GROUP_FOLDER_LISTENER_TASKS:
            await _stop_listener(account_id)
    for account_id in _accounts_with_group_chat_folders(user_id):
        _start_listener(account_id)


async def resume_group_folder_listeners() -> None:
    """Start a listener for every account that owns a group_chat folder (startup)."""
    try:
        with db() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT watch_account_id FROM folders
                WHERE folder_type = 'group_chat' AND watch_account_id != ''
                """,
            ).fetchall()
        for row in rows:
            _start_listener(str(row["watch_account_id"]))
    except Exception as exc:  # noqa: BLE001
        logger.exception("[GROUPFOLDER] resume_group_folder_listeners failed: %s", exc)
