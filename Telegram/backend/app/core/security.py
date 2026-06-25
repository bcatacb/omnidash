from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, Header, HTTPException

from .config import DB_PATH, settings
from .database import db
from .state import LOGIN_ATTEMPTS


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}:{dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    parts = stored.split(":", 1)
    if len(parts) != 2:
        return False
    salt, hash_val = parts
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return dk.hex() == hash_val


def _check_login_rate_limit(ip: str) -> None:
    now = time.time()
    attempts = LOGIN_ATTEMPTS.get(ip, [])
    attempts = [t for t in attempts if now - t < 300]
    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in 5 minutes.")
    attempts.append(now)
    LOGIN_ATTEMPTS[ip] = attempts


def _new_token() -> str:
    return secrets.token_urlsafe(36)


def _get_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def _get_user_by_id(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def _accounts_for_user(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, username, display_name, phone, telegram_id, status, location, session_file, source, exclude_chats, photo_url, twofa_enabled, session_status
        FROM accounts
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "displayName": r["display_name"],
            "phone": r["phone"],
            "telegramId": r["telegram_id"],
            "status": r["status"],
            "location": r["location"],
            "sessionFile": r["session_file"],
            "source": r["source"],
            "excludeChats": bool(r["exclude_chats"]),
            "photoUrl": f"/api/v1/accounts/{r['id']}/photo",
            "twofaEnabled": bool(r["twofa_enabled"]),
            "sessionStatus": r["session_status"],
        }
        for r in rows
    ]


def _user_payload(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = _get_user_by_id(conn, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "avatar": row["avatar"],
        "notificationSettings": json.loads(row["notification_json"]),
        "connectedAccounts": _accounts_for_user(conn, row["id"]),
    }


def _create_session(conn: sqlite3.Connection, user_id: str, replace_existing: bool = True) -> str:
    if replace_existing:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    token = _new_token()
    created = now_iso()
    expires = (datetime.now(UTC) + timedelta(days=14)).isoformat()
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, user_id, expires, created),
    )
    return token


def _user_from_token(conn: sqlite3.Connection, token: str) -> sqlite3.Row:
    session = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if datetime.fromisoformat(session["expires_at"]) < datetime.now(UTC):
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = _get_user_by_id(conn, session["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    with db() as conn:
        user = _user_from_token(conn, token)
        return user["id"]
