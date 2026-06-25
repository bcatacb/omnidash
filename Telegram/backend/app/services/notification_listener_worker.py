"""Always-on Telegram listeners that turn outgoing `/m` commands into Pushover pushes.

For each account that has at least one enabled watcher (a group chat the user picked in
the Notification Center) we keep a persistent Telethon client connected with a
``NewMessage`` event handler. When the user types ``/m {message}`` from that account in a
watched group, the handler forwards ``{message}`` to the user's configured Pushover keys.

This is the first real-time listener in the backend; it follows the same task-tracking +
crash-wrapper pattern as the warmup worker (``routes/warmup.py``).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from telethon import TelegramClient, events

from ..core.database import db
from ..core.state import (
    NOTIFICATION_LISTENER_STOP_REQUESTED,
    NOTIFICATION_LISTENER_TASKS,
)
from ..helpers.pushover import send_pushover
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


def _load_config(user_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM notification_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "token": row["pushover_token"] or "",
        "users": json.loads(row["pushover_users_json"] or "[]"),
        "prefix": (row["command_prefix"] or "/m").strip(),
        "enabled": bool(row["enabled"]),
    }


def _watched_chat_ids(user_id: str, account_id: str) -> list[str]:
    with db() as conn:
        rows = conn.execute(
            "SELECT chat_id FROM notification_watchers WHERE user_id = ? AND account_id = ?",
            (user_id, account_id),
        ).fetchall()
    return [str(r["chat_id"]) for r in rows]


def _extract_command_message(text: str, prefix: str) -> str | None:
    """Return the message after the command prefix, or None if the text isn't a command."""
    if not text:
        return None
    stripped = text.strip()
    if stripped == prefix:
        return ""
    if stripped.startswith(prefix + " "):
        return stripped[len(prefix) + 1:].strip()
    return None


async def run_account_listener(user_id: str, account_id: str) -> None:
    """Keep a persistent client connected and forward `/m` commands to Pushover."""
    config = _load_config(user_id)
    if not config or not config["enabled"] or not config["token"] or not config["users"]:
        logger.info("[NOTIFY] account %s: no usable Pushover config, listener not started", account_id)
        return

    chat_ids = _watched_chat_ids(user_id, account_id)
    if not chat_ids:
        logger.info("[NOTIFY] account %s: no watched groups, listener not started", account_id)
        return

    client: TelegramClient | None = None
    try:
        lock = _account_session_lock(account_id)
        async with lock:
            await evict_warm_client(account_id)
            _, client = await _open_account_client_for_user(user_id, account_id)
            register_persistent_account_client(account_id, client)

            entities = []
            for chat_id in chat_ids:
                try:
                    entities.append(await _resolve_entity(client, chat_id))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[NOTIFY] account %s: cannot resolve chat %s: %s", account_id, chat_id, exc)
            if not entities:
                logger.warning("[NOTIFY] account %s: no resolvable watched chats, stopping", account_id)
                return

            async def _handler(event: events.NewMessage.Event) -> None:
                try:
                    # Re-read config each time so UI changes take effect without a restart.
                    cfg = _load_config(user_id)
                    if not cfg or not cfg["enabled"] or not cfg["token"] or not cfg["users"]:
                        return
                    message = _extract_command_message(event.raw_text or "", cfg["prefix"])
                    if message is None:
                        return
                    if not message:
                        return
                    await send_pushover(cfg["token"], cfg["users"], message, title="Telegram")
                    logger.info("[NOTIFY] account %s: forwarded command to Pushover", account_id)
                except Exception as exc:  # noqa: BLE001 - never let a handler error kill the loop
                    logger.warning("[NOTIFY] account %s: handler error: %s", account_id, exc)

            client.add_event_handler(_handler, events.NewMessage(outgoing=True, chats=entities))
        logger.info("[NOTIFY] account %s: listener armed for %s group(s)", account_id, len(entities))
        await client.run_until_disconnected()
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("[NOTIFY] account %s: listener stopped: %s", account_id, exc)
    finally:
        lock = _account_session_lock(account_id)
        async with lock:
            unregister_persistent_account_client(account_id, client)
            await _safe_disconnect(client)


def _start_listener(user_id: str, account_id: str) -> None:
    """Create the listener task with a crash wrapper that cleans up state."""
    existing = NOTIFICATION_LISTENER_TASKS.get(account_id)
    if existing and not existing.done():
        return
    NOTIFICATION_LISTENER_STOP_REQUESTED.discard(account_id)
    task = asyncio.create_task(run_account_listener(user_id, account_id))
    NOTIFICATION_LISTENER_TASKS[account_id] = task

    async def _crash_wrapper() -> None:
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("[NOTIFY] listener task crashed for account %s", account_id)
        finally:
            if NOTIFICATION_LISTENER_TASKS.get(account_id) is task:
                NOTIFICATION_LISTENER_TASKS.pop(account_id, None)

    asyncio.ensure_future(_crash_wrapper())


async def _stop_listener(account_id: str) -> None:
    NOTIFICATION_LISTENER_STOP_REQUESTED.add(account_id)
    task = NOTIFICATION_LISTENER_TASKS.pop(account_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    NOTIFICATION_LISTENER_STOP_REQUESTED.discard(account_id)


def _accounts_with_enabled_watchers(user_id: str) -> set[str]:
    config = _load_config(user_id)
    if not config or not config["enabled"] or not config["token"] or not config["users"]:
        return set()
    with db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT account_id FROM notification_watchers WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return {str(r["account_id"]) for r in rows}


async def reconcile_listeners(user_id: str) -> None:
    """Restart this user's listeners so they match the current config + watchers.

    Called after any config or watcher change. Stops every listener belonging to the
    user's accounts and restarts the ones that should still be running. Restarting
    (rather than diffing) keeps each listener's resolved-entity set fresh.
    """
    with db() as conn:
        account_rows = conn.execute(
            "SELECT id FROM accounts WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    user_account_ids = {str(r["id"]) for r in account_rows}

    for account_id in user_account_ids:
        if account_id in NOTIFICATION_LISTENER_TASKS:
            await _stop_listener(account_id)

    for account_id in _accounts_with_enabled_watchers(user_id):
        _start_listener(user_id, account_id)


async def resume_all_listeners() -> None:
    """Start listeners for every user that has an enabled config + watchers (startup)."""
    try:
        with db() as conn:
            rows = conn.execute("SELECT user_id FROM notification_config WHERE enabled = 1").fetchall()
        for row in rows:
            user_id = str(row["user_id"])
            for account_id in _accounts_with_enabled_watchers(user_id):
                _start_listener(user_id, account_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[NOTIFY] resume_all_listeners failed: %s", exc)
