from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Header, Query
from fastapi.responses import FileResponse, Response

from ..core.database import db, now_iso
from ..core.security import current_user_id, _user_from_token
from ..core.config import MEDIA_DIR, settings

router = APIRouter(prefix="")

STORED_DIR = MEDIA_DIR / "stored"
STORED_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/api/v1/stored-messages")
def list_stored_messages(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM stored_messages WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    messages = []
    for row in rows:
        messages.append({
            "id": row["id"],
            "userId": row["user_id"],
            "type": row["type"],
            "content": row["content"],
            "fileName": row["file_name"],
            "fileMimeType": row["file_mime_type"],
            "fileSize": row["file_size"],
            "createdAt": row["created_at"],
        })
    return {"messages": messages}


@router.post("/api/v1/stored-messages", status_code=201)
async def create_stored_message(
    text: str = Form(None),
    file: UploadFile | None = None,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    mid = str(uuid4())
    ts = now_iso()

    if file:
        content = await file.read()
        ext = Path(file.filename or "file").suffix if file.filename else ""
        dest = STORED_DIR / f"{mid}{ext}"
        dest.write_bytes(content)
        msg_type = "photo" if (file.content_type or "").startswith("image/") else "file"
        with db() as conn:
            conn.execute(
                """
                INSERT INTO stored_messages (id, user_id, type, content, file_name, file_mime_type, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (mid, user_id, msg_type, dest.name, file.filename, file.content_type, len(content), ts),
            )
    else:
        content = (text or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="Text content is required when no file is provided")
        with db() as conn:
            conn.execute(
                """
                INSERT INTO stored_messages (id, user_id, type, content, file_name, file_mime_type, file_size, created_at)
                VALUES (?, ?, 'text', ?, NULL, NULL, NULL, ?)
                """,
                (mid, user_id, content, ts),
            )

    with db() as conn:
        row = conn.execute("SELECT * FROM stored_messages WHERE id = ?", (mid,)).fetchone()
    return {"message": _row_to_dict(row)}


@router.delete("/api/v1/stored-messages/{message_id}")
def delete_stored_message(
    message_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM stored_messages WHERE id = ? AND user_id = ?",
            (message_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Stored message not found")
        if row["type"] != "text":
            file_path = STORED_DIR / row["content"]
            if file_path.exists():
                file_path.unlink()
        conn.execute("DELETE FROM stored_messages WHERE id = ?", (message_id,))
    return {"ok": True}


@router.get("/api/v1/stored-messages/{message_id}/file")
def get_stored_message_file(
    message_id: str,
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> Response:
    auth_token = ""
    if authorization.startswith("Bearer "):
        auth_token = authorization.removeprefix("Bearer ").strip()
    elif token:
        auth_token = token.strip()
    if not auth_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    with db() as conn:
        user = _user_from_token(conn, auth_token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = user["id"]
        row = conn.execute(
            "SELECT * FROM stored_messages WHERE id = ? AND user_id = ?",
            (message_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Stored message not found")
        if row["type"] == "text":
            raise HTTPException(status_code=400, detail="Text messages have no file")
        file_path = STORED_DIR / row["content"]
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        path=str(file_path),
        media_type=row["file_mime_type"] or "application/octet-stream",
        filename=row["file_name"] or row["content"],
    )


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "type": row["type"],
        "content": row["content"],
        "fileName": row["file_name"],
        "fileMimeType": row["file_mime_type"],
        "fileSize": row["file_size"],
        "createdAt": row["created_at"],
    }
