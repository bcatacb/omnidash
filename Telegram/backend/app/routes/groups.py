from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from telethon.errors import FloodWaitError
from telethon.tl import functions
from telethon.tl.types import InputUser

from ..core.database import db, now_iso
from ..core.security import current_user_id
from ..helpers.group_create import _make_input_user
from ..helpers.telegram import _account_session_lock, _open_account_client_for_user, _resolve_entity, _safe_disconnect
from ..models.schemas import CreateGroupPayload, GroupPresetCreate, GroupPresetUpdate, SelectedUser

router = APIRouter(prefix="")


@router.post("/api/v1/groups/presets")
async def create_preset(payload: GroupPresetCreate, user_id: str = Depends(current_user_id)):
    preset_id = str(uuid4())
    now = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO group_presets (id, user_id, name, admin_usernames_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (preset_id, user_id, payload.name, json.dumps(payload.admin_usernames), now, now),
        )
    return {"id": preset_id, "name": payload.name, "admin_usernames": payload.admin_usernames}


@router.get("/api/v1/groups/presets")
async def list_presets(user_id: str = Depends(current_user_id)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM group_presets WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return {
        "presets": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "name": r["name"],
                "admin_usernames": json.loads(r["admin_usernames_json"]),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    }


@router.put("/api/v1/groups/presets/{preset_id}")
async def update_preset(preset_id: str, payload: GroupPresetUpdate, user_id: str = Depends(current_user_id)):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM group_presets WHERE id = ? AND user_id = ?", (preset_id, user_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Preset not found")
        name = payload.name if payload.name is not None else row["name"]
        admin_usernames = payload.admin_usernames if payload.admin_usernames is not None else json.loads(row["admin_usernames_json"])
        conn.execute(
            "UPDATE group_presets SET name = ?, admin_usernames_json = ?, updated_at = ? WHERE id = ?",
            (name, json.dumps(admin_usernames), now_iso(), preset_id),
        )
    return {"ok": True}


@router.delete("/api/v1/groups/presets/{preset_id}")
async def delete_preset(preset_id: str, user_id: str = Depends(current_user_id)):
    with db() as conn:
        conn.execute("DELETE FROM group_presets WHERE id = ? AND user_id = ?", (preset_id, user_id))
    return {"ok": True}


@router.post("/api/v1/groups/create")
async def create_group(payload: CreateGroupPayload, user_id: str = Depends(current_user_id)):
    # Determine primary account: explicit, first selected user, or first admin
    primary_account_id = payload.account_id
    if not primary_account_id:
        if payload.selected_users:
            primary_account_id = payload.selected_users[0].account_id
        else:
            raise HTTPException(status_code=400, detail="No creator account specified and no users selected")

    lock = _account_session_lock(primary_account_id)
    async with lock:
        _, primary_client = await _open_account_client_for_user(user_id, primary_account_id)
        try:
            # --- Resolve admin usernames ---
            resolved_admins: list[InputUser] = []
            admin_failed_usernames: list[str] = []
            admin_usernames: list[str] = list(payload.extra_admin_usernames)

            if payload.preset_id:
                with db() as conn:
                    preset_row = conn.execute(
                        "SELECT admin_usernames_json FROM group_presets WHERE id = ? AND user_id = ?",
                        (payload.preset_id, user_id),
                    ).fetchone()
                    if preset_row:
                        preset_admins = json.loads(preset_row["admin_usernames_json"])
                        for uname in preset_admins:
                            if uname not in admin_usernames:
                                admin_usernames.append(uname)

            for raw in admin_usernames:
                uname = raw.strip().lstrip("@")
                if not uname:
                    continue
                try:
                    entity = await primary_client.get_entity(uname)
                    resolved_admins.append(_make_input_user(entity))
                except Exception:
                    admin_failed_usernames.append(raw.strip())

            # --- Resolve selected users via primary account ---
            resolved_members: list[tuple[InputUser, str, str]] = []  # (input_user, chat_id, account_id)
            failed_users: list[SelectedUser] = []

            for su in payload.selected_users:
                try:
                    entity = await _resolve_entity(primary_client, su.chat_id)
                    resolved_members.append((_make_input_user(entity), su.chat_id, su.account_id))
                except Exception:
                    failed_users.append(su)

            # --- Deduplicate + combine for group creation ---
            seen: set[int] = set()
            all_users: list[InputUser] = []
            for u in resolved_admins:
                key = u.user_id
                if key not in seen:
                    seen.add(key)
                    all_users.append(u)
            for u, _, _ in resolved_members:
                key = u.user_id
                if key not in seen:
                    seen.add(key)
                    all_users.append(u)

            if len(all_users) < 1:
                raise HTTPException(status_code=400, detail="At least one user must be added to create a group")

            # --- Create the group ---
            result = await primary_client(functions.messages.CreateChatRequest(
                users=all_users,
                title=payload.title,
            ))

            created_chat = None
            updates_obj = getattr(result, "updates", None)
            if updates_obj and getattr(updates_obj, "chats", None):
                created_chat = updates_obj.chats[0]
            if not created_chat:
                raise HTTPException(status_code=500, detail="Failed to get created group info")

            group_chat_id = str(created_chat.id)

            # --- Build member results for the ones added directly ---
            members_result: list[dict[str, Any]] = []
            for _, chat_id_val, _ in resolved_members:
                members_result.append({
                    "chat_id": chat_id_val,
                    "status": "added_directly",
                })

            # --- Helper fallback for users the primary account couldn't resolve ---
            for su in failed_users:
                if su.account_id == primary_account_id:
                    members_result.append({
                        "chat_id": su.chat_id,
                        "status": "failed",
                        "error": "Could not resolve user even from their own account",
                    })
                    continue

                try:
                    helper_lock = _account_session_lock(su.account_id)
                    async with helper_lock:
                        _, helper_client = await _open_account_client_for_user(user_id, su.account_id)
                        try:
                            target_entity = await _resolve_entity(helper_client, su.chat_id)
                            target_input = _make_input_user(target_entity)

                            helper_me = await helper_client.get_me()
                            helper_input = _make_input_user(helper_me)

                            # Add helper account to the group (via primary)
                            await primary_client(functions.messages.AddChatUserRequest(
                                chat_id=int(group_chat_id),
                                user_id=helper_input,
                                fwd_limit=0,
                            ))

                            # Add target user to the group (via helper)
                            await helper_client(functions.messages.AddChatUserRequest(
                                chat_id=int(group_chat_id),
                                user_id=target_input,
                                fwd_limit=0,
                            ))

                            # Helper leaves the group
                            try:
                                await helper_client(functions.messages.LeaveChatRequest(chat_id=int(group_chat_id)))
                            except Exception:
                                try:
                                    chat_entity = await helper_client.get_entity(int(group_chat_id))
                                    await helper_client.delete_dialog(chat_entity)
                                except Exception:
                                    pass

                            members_result.append({
                                "chat_id": su.chat_id,
                                "status": "added_via_helper",
                                "helper_account_id": su.account_id,
                            })
                        except Exception as e:
                            members_result.append({
                                "chat_id": su.chat_id,
                                "status": "failed",
                                "error": str(e)[:200] if str(e) else "Unknown error during helper invite",
                            })
                        finally:
                            await _safe_disconnect(helper_client)
                except Exception as e:
                    members_result.append({
                        "chat_id": su.chat_id,
                        "status": "failed",
                        "error": str(e)[:200] if str(e) else "Could not use helper account",
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

            members_added_count = sum(1 for m in members_result if m["status"] in ("added_directly", "added_via_helper"))

            return {
                "ok": True,
                "chat_id": group_chat_id,
                "title": payload.title,
                "admin_promoted": admin_promoted,
                "admin_failed": admin_failed_usernames,
                "members_added": members_added_count,
                "members": members_result,
            }

        except FloodWaitError as exc:
            raise HTTPException(
                status_code=429,
                detail=f"Telegram flood wait: {exc.seconds}s remaining. Try again later.",
            )
        finally:
            await _safe_disconnect(primary_client)
