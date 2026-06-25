import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..core.config import DB_PATH, settings
from ..core.database import db, now_iso
from ..core.security import (
    _check_login_rate_limit as check_login_rate_limit,
    _create_session as create_session,
    _hash_password as hash_password,
    _user_from_token as user_from_token,
    _user_payload as user_payload,
    _verify_password as verify_password,
    current_user_id,
)
from ..models.schemas import LoginPayload, RestoreSessionPayload, SignupPayload

router = APIRouter(prefix="")


@router.get("/health", tags=["health"])
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "env": settings.app_env,
        "sqlite_path": str(DB_PATH),
        "telegramConfigured": bool(settings.telegram_api_id and settings.telegram_api_hash),
    }


@router.post("/api/v1/auth/signup", tags=["auth"])
def signup(payload: SignupPayload) -> dict[str, Any]:
    email = payload.email.strip().lower()
    if not email or not payload.password.strip():
        raise HTTPException(status_code=400, detail="Email and password are required")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    with db() as conn:
        existing = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        user_id = str(uuid4())
        created_at = now_iso()
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, avatar, notification_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                email,
                hash_password(payload.password),
                payload.name.strip() or "User",
                "https://api.dicebear.com/9.x/initials/svg?seed=" + user_id[:8],
                json.dumps(
                    {
                        "newMessages": True,
                        "notificationSound": True,
                        "desktopNotifications": False,
                    }
                ),
                created_at,
                created_at,
            ),
        )
        token = create_session(conn, user_id)
        return {"token": token, "user": user_payload(conn, user_id)}


@router.post("/api/v1/auth/login", tags=["auth"])
def login(payload: LoginPayload, request: Request) -> dict[str, Any]:
    client_ip = request.client.host if request.client else "unknown"
    check_login_rate_limit(client_ip)
    email = payload.email.strip().lower()
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user or not verify_password(payload.password, user["password"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = create_session(conn, user["id"])
        return {"token": token, "user": user_payload(conn, user["id"])}


@router.post("/api/v1/auth/restore-session", tags=["auth"])
def restore_session(payload: RestoreSessionPayload) -> dict[str, Any]:
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (payload.userId,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        token = create_session(conn, payload.userId, replace_existing=False)
        return {"token": token, "user": user_payload(conn, payload.userId)}


@router.get("/api/v1/auth/me", tags=["auth"])
def me(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        return {"user": user_payload(conn, user_id)}


@router.get("/", tags=["info"])
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": settings.app_name,
            "version": "restored",
            "health": "/health",
            "apiBase": "/api/v1",
            "telegramApiIdConfigured": bool(settings.telegram_api_id),
            "telegramApiHashConfigured": bool(settings.telegram_api_hash),
        }
    )
