from __future__ import annotations

import sqlite3
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.database import db, now_iso
from ..core.security import current_user_id
from ..core.state import FOLDER_CONVERSATIONS_CACHE
from ..models.schemas import (
    BatchChatEntry,
    FolderChatAdd,
    FolderChatBatchMove,
    FolderChatFilterSet,
    FolderChatMove,
    FolderCreate,
    FolderUpdate,
)

# Canonical per-member filter labels used by the scraper page and unibox folder tabs.
# "unknown"/untagged is represented by a NULL filter_tag, not a stored value.
VALID_FILTER_TAGS = {"excluded", "important", "known", "caution"}
from ..services.group_folder_listener_worker import reconcile_group_folder_listeners

router = APIRouter(prefix="")


def _folder_json(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "name": row["name"],
        "icon": row["icon"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "folder_type": row["folder_type"],
        "draft_text": row["draft_text"],
        "watch_account_id": row["watch_account_id"],
        "watch_chat_id": row["watch_chat_id"],
        "watch_chat_title": row["watch_chat_title"],
    }


def _require_standard_folder(conn: sqlite3.Connection, folder_id: str, user_id: str) -> sqlite3.Row:
    folder = conn.execute(
        "SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
    ).fetchone()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder["folder_type"] != "standard":
        raise HTTPException(status_code=400, detail="Chat operations not supported on draft folders")
    return folder


@router.post("/api/v1/folders")
async def create_folder(
    body: FolderCreate,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    folder_id = uuid4().hex
    now = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO folders (id, user_id, name, icon, sort_order, folder_type, draft_text, watch_account_id, watch_chat_id, watch_chat_title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (folder_id, user_id, body.name, body.icon, body.sort_order, body.folder_type, body.draft_text,
             body.watch_account_id, body.watch_chat_id, body.watch_chat_title, now),
        )
    if body.folder_type == "group_chat":
        await reconcile_group_folder_listeners(user_id)
    return {
        "id": folder_id, "name": body.name, "icon": body.icon,
        "sort_order": body.sort_order, "folder_type": body.folder_type,
        "draft_text": body.draft_text, "watch_account_id": body.watch_account_id,
        "watch_chat_id": body.watch_chat_id, "watch_chat_title": body.watch_chat_title,
        "created_at": now,
    }


@router.get("/api/v1/folders")
async def list_custom_folders(
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, user_id, name, icon, sort_order, created_at, folder_type, draft_text, watch_account_id, watch_chat_id, watch_chat_title FROM folders WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
            (user_id,),
        ).fetchall()
    return {"folders": [_folder_json(r) for r in rows]}


@router.put("/api/v1/folders/{folder_id}")
async def update_folder(
    folder_id: str,
    body: FolderUpdate,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")
        new_name = body.name if body.name is not None else existing["name"]
        new_icon = body.icon if body.icon is not None else existing["icon"]
        new_sort = body.sort_order if body.sort_order is not None else existing["sort_order"]
        new_type = body.folder_type if body.folder_type is not None else existing["folder_type"]
        new_draft = body.draft_text if body.draft_text is not None else existing["draft_text"]
        new_wacct = body.watch_account_id if body.watch_account_id is not None else existing["watch_account_id"]
        new_wchat = body.watch_chat_id if body.watch_chat_id is not None else existing["watch_chat_id"]
        new_wtitle = body.watch_chat_title if body.watch_chat_title is not None else existing["watch_chat_title"]
        conn.execute(
            "UPDATE folders SET name = ?, icon = ?, sort_order = ?, folder_type = ?, draft_text = ?, watch_account_id = ?, watch_chat_id = ?, watch_chat_title = ? WHERE id = ?",
            (new_name, new_icon, new_sort, new_type, new_draft, new_wacct, new_wchat, new_wtitle, folder_id),
        )
    if new_type == "group_chat" or existing["folder_type"] == "group_chat":
        await reconcile_group_folder_listeners(user_id)
    return {"ok": True}


@router.delete("/api/v1/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")
        was_group_chat = existing["folder_type"] == "group_chat"
        conn.execute("DELETE FROM folder_chats WHERE folder_id = ?", (folder_id,))
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    if was_group_chat:
        await reconcile_group_folder_listeners(user_id)
    return {"ok": True}


@router.get("/api/v1/folders/{folder_id}/chats")
async def list_folder_chats(
    folder_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        folder = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        rows = conn.execute(
            "SELECT account_id, chat_id, added_at, filter_tag FROM folder_chats WHERE folder_id = ? ORDER BY added_at DESC",
            (folder_id,),
        ).fetchall()
    return {"chats": [dict(r) for r in rows]}


@router.post("/api/v1/folders/{folder_id}/chats")
async def add_chat_to_folder(
    folder_id: str,
    body: FolderChatAdd,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        _require_standard_folder(conn, folder_id, user_id)
        chat_entry_id = uuid4().hex
        now = now_iso()
        filter_tag = body.filter_tag if body.filter_tag in VALID_FILTER_TAGS else None
        try:
            conn.execute(
                "INSERT INTO folder_chats (id, folder_id, account_id, chat_id, added_at, username, display_name, access_hash, filter_tag) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (chat_entry_id, folder_id, body.account_id, body.chat_id, now,
                 body.username, body.display_name, body.access_hash, filter_tag),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Chat already in folder")
    _invalidate_folder_conversations_cache(user_id, folder_id)
    return {"ok": True}


def _invalidate_folder_conversations_cache(user_id: str, folder_id: str) -> None:
    FOLDER_CONVERSATIONS_CACHE.pop(f"{user_id}:foldconv:{folder_id}", None)


@router.post("/api/v1/folders/{folder_id}/chats/filter")
async def set_folder_chat_filter(
    folder_id: str,
    body: FolderChatFilterSet,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Set (or clear) the filter label on one or more members of a folder."""
    filter_tag = body.filter_tag if body.filter_tag in VALID_FILTER_TAGS else None
    chat_ids = [str(c) for c in body.chat_ids if str(c)]
    if not chat_ids:
        return {"ok": True, "updated": 0}
    with db() as conn:
        _require_standard_folder(conn, folder_id, user_id)
        placeholders = ",".join("?" for _ in chat_ids)
        cur = conn.execute(
            f"UPDATE folder_chats SET filter_tag = ? "
            f"WHERE folder_id = ? AND account_id = ? AND chat_id IN ({placeholders})",
            (filter_tag, folder_id, body.account_id, *chat_ids),
        )
        updated = cur.rowcount
    _invalidate_folder_conversations_cache(user_id, folder_id)
    return {"ok": True, "updated": updated}


@router.delete("/api/v1/folders/{folder_id}/chats")
async def remove_chat_from_folder(
    folder_id: str,
    account_id: str = Query(...),
    chat_id: str = Query(...),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        _require_standard_folder(conn, folder_id, user_id)
        conn.execute(
            "DELETE FROM folder_chats WHERE folder_id = ? AND account_id = ? AND chat_id = ?",
            (folder_id, account_id, chat_id),
        )
    return {"ok": True}


@router.post("/api/v1/folders/move-chat")
async def move_chat(
    body: FolderChatMove,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        _require_standard_folder(conn, body.to_folder_id, user_id)
        if body.from_folder_id:
            _require_standard_folder(conn, body.from_folder_id, user_id)
            conn.execute(
                "DELETE FROM folder_chats WHERE folder_id = ? AND account_id = ? AND chat_id = ?",
                (body.from_folder_id, body.account_id, body.chat_id),
            )
        chat_entry_id = uuid4().hex
        now = now_iso()
        try:
            conn.execute(
                "INSERT INTO folder_chats (id, folder_id, account_id, chat_id, added_at) VALUES (?, ?, ?, ?, ?)",
                (chat_entry_id, body.to_folder_id, body.account_id, body.chat_id, now),
            )
        except sqlite3.IntegrityError:
            pass
    return {"ok": True}


@router.post("/api/v1/folders/batch-move")
async def batch_move_chats(
    body: FolderChatBatchMove,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        _require_standard_folder(conn, body.to_folder_id, user_id)
        if body.from_folder_id:
            _require_standard_folder(conn, body.from_folder_id, user_id)
            conn.executemany(
                "DELETE FROM folder_chats WHERE folder_id = ? AND account_id = ? AND chat_id = ?",
                [(body.from_folder_id, c.account_id, c.chat_id) for c in body.chats],
            )
        now = now_iso()
        for c in body.chats:
            chat_entry_id = uuid4().hex
            try:
                conn.execute(
                    "INSERT INTO folder_chats (id, folder_id, account_id, chat_id, added_at) VALUES (?, ?, ?, ?, ?)",
                    (chat_entry_id, body.to_folder_id, c.account_id, c.chat_id, now),
                )
            except sqlite3.IntegrityError:
                pass
    return {"ok": True, "moved": len(body.chats)}
