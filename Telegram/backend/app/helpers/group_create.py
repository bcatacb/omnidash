from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from telethon.tl import functions
from telethon.tl.types import InputUser

from ..core.database import db
from .telegram import (
    _account_session_lock,
    _open_account_client_for_user,
    _resolve_entity,
    _safe_disconnect,
)


def _make_input_user(entity: Any) -> InputUser:
    return InputUser(
        user_id=int(entity.id),
        access_hash=getattr(entity, "access_hash", 0) or 0,
    )


async def create_single_group(
    user_id: str,
    creator_account_id: str,
    title: str,
    target_chat_ids: list[str],
    admin_usernames: list[str],
) -> dict[str, Any]:
    """Create one Telegram group with a single creator account.

    - ``creator_account_id`` opens the client that issues ``CreateChatRequest``.
    - ``target_chat_ids`` are members to add (usernames or numeric ids resolved by the creator).
    - ``admin_usernames`` are resolved by the creator and promoted to admin after creation.

    Members the creator cannot resolve are reported with status ``failed``. (The richer
    helper-account fallback used by the interactive endpoint is intentionally omitted here:
    in mass mode the creator is pre-selected precisely because it can resolve the target.)

    Returns a result dict with ``ok``, ``chat_id``, ``title``, ``admin_promoted``,
    ``admin_failed``, ``members_added`` and ``members``.
    """
    lock = _account_session_lock(creator_account_id)
    async with lock:
        _, primary_client = await _open_account_client_for_user(user_id, creator_account_id)
        try:
            # --- Resolve admin usernames ---
            resolved_admins: list[InputUser] = []
            admin_failed_usernames: list[str] = []

            for raw in admin_usernames:
                uname = raw.strip().lstrip("@")
                if not uname:
                    continue
                try:
                    entity = await primary_client.get_entity(uname)
                    resolved_admins.append(_make_input_user(entity))
                except Exception:
                    admin_failed_usernames.append(raw.strip())

            # --- Resolve target members ---
            resolved_members: list[tuple[InputUser, str]] = []  # (input_user, chat_id)
            members_result: list[dict[str, Any]] = []

            for chat_id in target_chat_ids:
                try:
                    entity = await _resolve_entity(primary_client, chat_id)
                    resolved_members.append((_make_input_user(entity), chat_id))
                except Exception as exc:
                    members_result.append({
                        "chat_id": chat_id,
                        "status": "failed",
                        "error": str(exc)[:200] if str(exc) else "Could not resolve user",
                    })

            # --- Deduplicate + combine for group creation ---
            seen: set[int] = set()
            all_users: list[InputUser] = []
            for u in resolved_admins:
                if u.user_id not in seen:
                    seen.add(u.user_id)
                    all_users.append(u)
            for u, _ in resolved_members:
                if u.user_id not in seen:
                    seen.add(u.user_id)
                    all_users.append(u)

            if len(all_users) < 1:
                raise HTTPException(status_code=400, detail="At least one user must be added to create a group")

            # --- Create the group ---
            result = await primary_client(functions.messages.CreateChatRequest(
                users=all_users,
                title=title,
            ))

            created_chat = None
            updates_obj = getattr(result, "updates", None)
            if updates_obj and getattr(updates_obj, "chats", None):
                created_chat = updates_obj.chats[0]
            if not created_chat:
                raise HTTPException(status_code=500, detail="Failed to get created group info")

            group_chat_id = str(created_chat.id)

            for _, chat_id_val in resolved_members:
                members_result.append({
                    "chat_id": chat_id_val,
                    "status": "added_directly",
                })

            # --- Promote admins ---
            admin_promoted = 0
            for admin_user in resolved_admins:
                try:
                    await primary_client(functions.messages.EditChatAdminRequest(
                        chat_id=int(group_chat_id),
                        user_id=admin_user,
                        is_admin=True,
                    ))
                    admin_promoted += 1
                except Exception:
                    admin_failed_usernames.append(str(admin_user.user_id))

            members_added_count = sum(1 for m in members_result if m["status"] == "added_directly")

            return {
                "ok": True,
                "chat_id": group_chat_id,
                "title": title,
                "admin_promoted": admin_promoted,
                "admin_failed": admin_failed_usernames,
                "members_added": members_added_count,
                "members": members_result,
            }
        finally:
            await _safe_disconnect(primary_client)
