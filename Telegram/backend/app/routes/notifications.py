"""Notification Center: configure Pushover + watched group chats for `/m` commands."""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.database import db, db_write, now_iso
from ..core.security import current_user_id
from ..core.state import NOTIFICATION_LISTENER_TASKS
from ..helpers.pushover import send_pushover
from ..services.notification_listener_worker import reconcile_listeners

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


class ConfigPayload(BaseModel):
    enabled: bool = True
    pushoverToken: str = ""
    pushoverUsers: list[str] = []
    commandPrefix: str = "/m"


class WatcherPayload(BaseModel):
    accountId: str
    chatId: str
    chatTitle: str | None = None


def _get_config_row(user_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM notification_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return {
            "enabled": True,
            "pushover_token": "",
            "pushover_users_json": "[]",
            "command_prefix": "/m",
        }
    return dict(row)


def _serialize_config(user_id: str) -> dict[str, Any]:
    row = _get_config_row(user_id)
    token = row.get("pushover_token") or ""
    return {
        "enabled": bool(row.get("enabled", True)),
        # Never echo the full token back; just report whether one is saved.
        "hasToken": bool(token),
        "tokenPreview": (token[:4] + "…" + token[-4:]) if len(token) > 8 else ("•" * len(token)),
        "pushoverUsers": json.loads(row.get("pushover_users_json") or "[]"),
        "commandPrefix": row.get("command_prefix") or "/m",
    }


def _serialize_watchers(user_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM notification_watchers WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        account_id = str(r["account_id"])
        task = NOTIFICATION_LISTENER_TASKS.get(account_id)
        out.append(
            {
                "id": r["id"],
                "accountId": account_id,
                "chatId": str(r["chat_id"]),
                "chatTitle": r["chat_title"],
                "createdAt": r["created_at"],
                "listenerRunning": task is not None and not task.done(),
            }
        )
    return out


@router.get("/config")
def get_config(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return {
        "config": _serialize_config(user_id),
        "watchers": _serialize_watchers(user_id),
    }


@router.put("/config")
async def put_config(payload: ConfigPayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    token = (payload.pushoverToken or "").strip()
    # Allow saving without re-typing the token: empty token keeps the existing one.
    if not token:
        token = _get_config_row(user_id).get("pushover_token") or ""
    users = [u.strip() for u in payload.pushoverUsers if u and u.strip()]
    prefix = (payload.commandPrefix or "/m").strip() or "/m"

    def _write(conn):
        conn.execute(
            """
            INSERT INTO notification_config
                (user_id, pushover_token, pushover_users_json, command_prefix, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                pushover_token = excluded.pushover_token,
                pushover_users_json = excluded.pushover_users_json,
                command_prefix = excluded.command_prefix,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at
            """,
            (
                user_id,
                token,
                json.dumps(users),
                prefix,
                1 if payload.enabled else 0,
                now_iso(),
            ),
        )

    db_write(_write)
    await reconcile_listeners(user_id)
    return {"ok": True, "config": _serialize_config(user_id), "watchers": _serialize_watchers(user_id)}


@router.post("/watchers")
async def add_watcher(payload: WatcherPayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if not payload.accountId or not payload.chatId:
        raise HTTPException(status_code=400, detail="accountId and chatId are required")
    with db() as conn:
        account = conn.execute(
            "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
            (payload.accountId, user_id),
        ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    def _write(conn):
        conn.execute(
            """
            INSERT OR IGNORE INTO notification_watchers
                (id, user_id, account_id, chat_id, chat_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                user_id,
                payload.accountId,
                str(payload.chatId),
                payload.chatTitle,
                now_iso(),
            ),
        )

    db_write(_write)
    await reconcile_listeners(user_id)
    return {"ok": True, "watchers": _serialize_watchers(user_id)}


@router.delete("/watchers/{watcher_id}")
async def delete_watcher(watcher_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    def _write(conn):
        conn.execute(
            "DELETE FROM notification_watchers WHERE id = ? AND user_id = ?",
            (watcher_id, user_id),
        )

    db_write(_write)
    await reconcile_listeners(user_id)
    return {"ok": True, "watchers": _serialize_watchers(user_id)}


@router.post("/test")
async def test_notification(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    row = _get_config_row(user_id)
    token = row.get("pushover_token") or ""
    users = json.loads(row.get("pushover_users_json") or "[]")
    if not token or not users:
        raise HTTPException(status_code=400, detail="Add a Pushover app token and at least one user key first")
    result = await send_pushover(
        token,
        users,
        "Test notification from your Telegram Portal Notification Center.",
        title="Telegram Portal",
    )
    if not result["sent"]:
        raise HTTPException(status_code=502, detail="Pushover rejected all recipients — check your token and user keys")
    return {"ok": True, "sent": len(result["sent"]), "failed": len(result["failed"])}
