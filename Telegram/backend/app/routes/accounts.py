from __future__ import annotations

import asyncio
import io
import json
import logging
import random
import secrets
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from telethon import TelegramClient
from telethon.errors import (
    AuthKeyDuplicatedError,
    AuthKeyInvalidError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    InputUserDeactivatedError,
    PasswordHashInvalidError,
    PhoneNumberBannedError,
    SessionExpiredError,
    SessionPasswordNeededError,
    SessionRevokedError,
    UnauthorizedError,
    UserDeactivatedBanError,
    UserDeactivatedError,
)
from telethon.tl import functions
from telethon.utils import get_display_name

from ..core.config import MEDIA_DIR, QR_TTL_SECONDS, SESSION_DIR, settings
from ..core.database import db, now_iso
from ..core.security import (
    _user_from_token,
    _user_payload,
    current_user_id,
)
from ..core.state import (
    ACCOUNT_SESSION_LOCKS,
    CAMPAIGN_SCRAPED_MEMBERS,
    CAMPAIGN_STOP_REQUESTED,
    CAMPAIGN_TASK_LOCK,
    CAMPAIGN_TASKS,
    CONVERSATIONS_CACHE,
    CONVERSATION_REFRESH_TASKS,
    FLOODED_ACCOUNTS,
    GROUP_SCRAPER_STOP_REQUESTED,
    GROUP_SCRAPER_TASKS,
    LAST_CONNECT_TIME,
    PENDING_PHONE_LOGINS,
    PENDING_QR_LOGINS,
    PendingPhoneLogin,
    PendingQrLogin,
)
from ..helpers.phone_login import (
    _cleanup_expired_phone_logins,
    _drop_user_pending_phone_logins,
    _latest_pending_phone_for_user,
)
from ..helpers.qr_login import (
    _cleanup_expired_qr_logins,
    _drop_user_pending_qr_logins,
    _latest_pending_qr_for_user,
    _qr_png_data_url,
)
from ..helpers.telegram import (
    DEVICE_PROFILES,
    _account_photo_is_fresh,
    _account_photo_path,
    _account_session_lock,
    _apply_fingerprint,
    _cleanup_session_files,
    _connection_cooldown,
    _ensure_telegram_config,
    _open_account_client_for_user,
    _parse_proxy_config,
    _session_name_for_client,
    _safe_disconnect,

)
from ..models.schemas import (
    BatchExcludePayload,
    PhonePasswordPayload,
    PhoneSendCodePayload,
    PhoneVerifyCodePayload,
    QrCompletePayload,
    QrPasswordPayload,
    QrStartPayload,
    Remove2FAPayload,
    Set2FAPayload,
    ToggleAccountPayload,
    UpdateProfilePayload,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="")


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _effective_qr_expiry(qr_expires_at: datetime | None) -> datetime:
    local_ttl = datetime.now(UTC) + timedelta(seconds=QR_TTL_SECONDS)
    normalized_qr = _normalize_dt(qr_expires_at)
    if normalized_qr is None:
        return local_ttl
    return min(local_ttl, normalized_qr)


def _new_token() -> str:
    return secrets.token_urlsafe(36)


async def _telegram_has_password(client: TelegramClient) -> bool | None:
    """Return True/False for Telegram cloud-password (2FA) state, or None if it can't be read."""
    try:
        pwd = await client(functions.account.GetPasswordRequest())
        return bool(pwd.has_password)
    except Exception:
        return None


async def _finalize_qr_login_and_persist(
    user_id: str, session_name: str, authorized_client: TelegramClient | None = None,
    device_fingerprint: dict[str, str] | None = None,
    api_id_override: int | None = None, api_hash_override: str | None = None,
) -> dict[str, Any]:
    with db() as conn:
        owns_client = authorized_client is None
        qr_api_id = api_id_override or settings.telegram_api_id
        qr_api_hash = api_hash_override or settings.telegram_api_hash
        client = authorized_client or TelegramClient(
            str(SESSION_DIR / session_name), qr_api_id, qr_api_hash
        )
        if owns_client:
            await client.connect()
        try:
            me = await client.get_me()
            if not me:
                raise HTTPException(status_code=400, detail="Telegram authorization not completed")

            has_pwd = await _telegram_has_password(client)
            twofa_val = 1 if has_pwd else 0
            username = me.username or f"user_{me.id}"
            display_name = get_display_name(me) or username
            phone = getattr(me, "phone", None)
            telegram_id = str(me.id)
            temp_session_file = (SESSION_DIR / f"{session_name}.session").resolve()
            canonical_session_base = (SESSION_DIR / f"telegram_{telegram_id}").resolve()
            canonical_session_file = Path(f"{canonical_session_base}.session")

            if temp_session_file.exists() and temp_session_file != canonical_session_file:
                _cleanup_session_files(canonical_session_base)
                try:
                    temp_session_file.replace(canonical_session_file)
                except Exception:
                    canonical_session_file = temp_session_file

            session_file = str(canonical_session_file)
            fp_json = json.dumps(device_fingerprint or {})

            existing = conn.execute(
                "SELECT id, session_file FROM accounts WHERE user_id = ? AND telegram_id = ?",
                (user_id, telegram_id),
            ).fetchone()

            if existing:
                previous_session = existing["session_file"]
                conn.execute(
                    """
                    UPDATE accounts
                    SET username = ?, display_name = ?, phone = ?, status = ?, location = ?, session_file = ?, source = ?,
                        device_fingerprint_json = ?, api_id = ?, api_hash = ?
                    WHERE id = ?
                    """,
                    (username, display_name, phone, "online", "unknown", session_file, "qr",
                     fp_json, qr_api_id, qr_api_hash, existing["id"]),
                )
                if has_pwd is not None:
                    conn.execute(
                        "UPDATE accounts SET twofa_enabled = ? WHERE id = ?",
                        (twofa_val, existing["id"]),
                    )
                if previous_session and previous_session != session_file:
                    _cleanup_session_files(previous_session)
            else:
                conn.execute(
                    """
                    INSERT INTO accounts (
                        id, user_id, username, display_name, phone, telegram_id, status, location, session_file, source,
                        exclude_chats, device_fingerprint_json, api_id, api_hash, twofa_enabled, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid4()),
                        user_id,
                        username,
                        display_name,
                        phone,
                        telegram_id,
                        "online",
                        "unknown",
                        session_file,
                        "qr",
                        0,
                        fp_json,
                        qr_api_id,
                        qr_api_hash,
                        twofa_val,
                        now_iso(),
                    ),
                )

            return _user_payload(conn, user_id)
        finally:
            if owns_client:
                await _safe_disconnect(client)


@router.post("/api/v1/accounts/connect-qr/start")
async def start_qr(payload: QrStartPayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")
    _ensure_telegram_config()
    await _cleanup_expired_qr_logins()
    await _drop_user_pending_qr_logins(auth_user_id)

    qr_api_id = payload.apiId or settings.telegram_api_id
    qr_api_hash = payload.apiHash or settings.telegram_api_hash
    session_name = f"qr_{auth_user_id}_{uuid4().hex}"
    fp = random.choice(DEVICE_PROFILES)
    client = TelegramClient(str(SESSION_DIR / session_name), qr_api_id, qr_api_hash)
    _apply_fingerprint(client, fp)
    try:
        await client.connect()
        qr_login = await client.qr_login()
    except Exception as exc:
        try:
            await _safe_disconnect(client)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to generate Telegram QR: {exc}") from exc
    token = _new_token()
    expires_at = _effective_qr_expiry(getattr(qr_login, "expires", None))

    PENDING_QR_LOGINS[token] = PendingQrLogin(
        user_id=auth_user_id,
        session_name=session_name,
        client=client,
        qr_login=qr_login,
        requires_password=False,
        created_at=datetime.now(UTC),
        expires_at=expires_at,
        device_fingerprint=fp,
        api_id_override=payload.apiId,
        api_hash_override=payload.apiHash,
    )

    return {
        "qrUrl": _qr_png_data_url(qr_login.url),
        "qrToken": token,
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/api/v1/accounts/connect-qr/complete")
async def complete_qr(payload: QrCompletePayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    await _cleanup_expired_qr_logins()
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")

    pending = PENDING_QR_LOGINS.get(payload.qrToken)
    token_to_use = payload.qrToken
    if not pending or pending.user_id != auth_user_id:
        fallback = _latest_pending_qr_for_user(auth_user_id)
        if not fallback:
            raise HTTPException(status_code=404, detail="QR session not found or expired")
        token_to_use, pending = fallback
    if datetime.now(UTC) >= pending.expires_at:
        try:
            await _safe_disconnect(pending.client)
        finally:
            PENDING_QR_LOGINS.pop(payload.qrToken, None)
        raise HTTPException(status_code=410, detail="QR session expired")

    client = pending.client
    if pending.requires_password:
        return {"status": "password_required", "user": None}

    try:
        if await client.is_user_authorized():
            user_payload = await _finalize_qr_login_and_persist(
                auth_user_id, pending.session_name, authorized_client=client,
                device_fingerprint=pending.device_fingerprint,
                api_id_override=pending.api_id_override, api_hash_override=pending.api_hash_override,
            )
            await _safe_disconnect(client)
            PENDING_QR_LOGINS.pop(token_to_use, None)
            return {"status": "connected", "user": user_payload}

        try:
            await pending.qr_login.wait(timeout=8)
        except asyncio.TimeoutError:
            return {"status": "pending", "user": None}
        except SessionPasswordNeededError:
            pending.requires_password = True
            return {"status": "password_required", "user": None}
        except Exception as exc:
            if "SESSION_PASSWORD_NEEDED" in str(exc).upper():
                pending.requires_password = True
                return {"status": "password_required", "user": None}
            raise

        if await client.is_user_authorized():
            user_payload = await _finalize_qr_login_and_persist(
                auth_user_id, pending.session_name, authorized_client=client,
                device_fingerprint=pending.device_fingerprint,
                api_id_override=pending.api_id_override, api_hash_override=pending.api_hash_override,
            )
            await _safe_disconnect(client)
            PENDING_QR_LOGINS.pop(payload.qrToken, None)
            return {"status": "connected", "user": user_payload}
    except SessionPasswordNeededError:
        pending.requires_password = True
        return {"status": "password_required", "user": None}
    except Exception as exc:
        if "SESSION_PASSWORD_NEEDED" in str(exc).upper():
            pending.requires_password = True
            return {"status": "password_required", "user": None}
        raise

    return {"status": "pending", "user": None}


@router.post("/api/v1/accounts/connect-qr/password")
async def qr_password(payload: QrPasswordPayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    await _cleanup_expired_qr_logins()
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")

    pending = PENDING_QR_LOGINS.get(payload.qrToken)
    token_to_use = payload.qrToken
    if not pending or pending.user_id != auth_user_id:
        fallback = _latest_pending_qr_for_user(auth_user_id)
        if not fallback:
            raise HTTPException(status_code=404, detail="QR session not found or expired")
        token_to_use, pending = fallback
    if datetime.now(UTC) >= pending.expires_at:
        try:
            await _safe_disconnect(pending.client)
        finally:
            PENDING_QR_LOGINS.pop(payload.qrToken, None)
        raise HTTPException(status_code=410, detail="QR session expired")

    client = pending.client
    try:
        await client.sign_in(password=payload.password)
    except PasswordHashInvalidError:
        raise HTTPException(status_code=400, detail="Invalid Telegram 2FA password")
    except SessionPasswordNeededError:
        raise HTTPException(status_code=400, detail="Password still required")

    user_payload = await _finalize_qr_login_and_persist(
        auth_user_id, pending.session_name, authorized_client=client,
        device_fingerprint=pending.device_fingerprint,
        api_id_override=pending.api_id_override, api_hash_override=pending.api_hash_override,
    )
    await _safe_disconnect(client)
    PENDING_QR_LOGINS.pop(token_to_use, None)
    return {"status": "connected", "user": user_payload}


@router.post("/api/v1/accounts/connect-phone/send-code")
async def phone_send_code(payload: PhoneSendCodePayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")
    _ensure_telegram_config()
    await _cleanup_expired_phone_logins()
    await _drop_user_pending_phone_logins(auth_user_id)

    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    phone_api_id = payload.apiId or settings.telegram_api_id
    phone_api_hash = payload.apiHash or settings.telegram_api_hash
    session_name = f"phone_{auth_user_id}_{uuid4().hex}"
    fp = random.choice(DEVICE_PROFILES)
    client = TelegramClient(str(SESSION_DIR / session_name), phone_api_id, phone_api_hash)
    _apply_fingerprint(client, fp)
    try:
        await client.connect()
        sent_code = await client.send_code_request(phone)
    except Exception as exc:
        try:
            await _safe_disconnect(client)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to send Telegram code: {exc}") from exc
    token = _new_token()
    expires_at = datetime.now(UTC) + timedelta(seconds=QR_TTL_SECONDS)

    PENDING_PHONE_LOGINS[token] = PendingPhoneLogin(
        user_id=auth_user_id,
        session_name=session_name,
        client=client,
        phone=phone,
        phone_code_hash=sent_code.phone_code_hash,
        requires_password=False,
        created_at=datetime.now(UTC),
        expires_at=expires_at,
        device_fingerprint=fp,
        api_id_override=payload.apiId,
        api_hash_override=payload.apiHash,
    )

    return {
        "phoneToken": token,
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/api/v1/accounts/connect-phone/verify-code")
async def phone_verify_code(payload: PhoneVerifyCodePayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    await _cleanup_expired_phone_logins()
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")

    pending = PENDING_PHONE_LOGINS.get(payload.phoneToken)
    token_to_use = payload.phoneToken
    if not pending or pending.user_id != auth_user_id:
        fallback = _latest_pending_phone_for_user(auth_user_id)
        if not fallback:
            raise HTTPException(status_code=404, detail="Phone session not found or expired")
        token_to_use, pending = fallback
    if datetime.now(UTC) >= pending.expires_at:
        try:
            await _safe_disconnect(pending.client)
        finally:
            PENDING_PHONE_LOGINS.pop(payload.phoneToken, None)
        raise HTTPException(status_code=410, detail="Phone session expired")
    if pending.requires_password:
        return {"status": "password_required", "user": None}

    client = pending.client
    try:
        await client.sign_in(phone=pending.phone, code=payload.code, phone_code_hash=pending.phone_code_hash)
    except SessionPasswordNeededError:
        pending.requires_password = True
        return {"status": "password_required", "user": None}
    except Exception as exc:
        exc_name = type(exc).__name__
        if "SESSION_PASSWORD_NEEDED" in str(exc).upper() or exc_name == "SessionPasswordNeededError":
            pending.requires_password = True
            return {"status": "password_required", "user": None}
        if "PhoneCodeInvalid" in exc_name or "CODE_INVALID" in str(exc).upper():
            raise HTTPException(status_code=400, detail="Invalid verification code")
        if "PhoneNumberInvalid" in exc_name:
            raise HTTPException(status_code=400, detail="Invalid phone number")
        raise

    if await client.is_user_authorized():
        user_payload = await _finalize_qr_login_and_persist(
            auth_user_id, pending.session_name, authorized_client=client,
            device_fingerprint=pending.device_fingerprint,
            api_id_override=pending.api_id_override, api_hash_override=pending.api_hash_override,
        )
        await _safe_disconnect(client)
        PENDING_PHONE_LOGINS.pop(token_to_use, None)
        return {"status": "connected", "user": user_payload}

    return {"status": "pending", "user": None}


@router.post("/api/v1/accounts/connect-phone/password")
async def phone_password(payload: PhonePasswordPayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    await _cleanup_expired_phone_logins()
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")

    pending = PENDING_PHONE_LOGINS.get(payload.phoneToken)
    token_to_use = payload.phoneToken
    if not pending or pending.user_id != auth_user_id:
        fallback = _latest_pending_phone_for_user(auth_user_id)
        if not fallback:
            raise HTTPException(status_code=404, detail="Phone session not found or expired")
        token_to_use, pending = fallback
    if datetime.now(UTC) >= pending.expires_at:
        try:
            await _safe_disconnect(pending.client)
        finally:
            PENDING_PHONE_LOGINS.pop(payload.phoneToken, None)
        raise HTTPException(status_code=410, detail="Phone session expired")

    client = pending.client
    try:
        await client.sign_in(password=payload.password)
    except PasswordHashInvalidError:
        raise HTTPException(status_code=400, detail="Invalid Telegram 2FA password")
    except SessionPasswordNeededError:
        raise HTTPException(status_code=400, detail="Password still required")

    user_payload = await _finalize_qr_login_and_persist(
        auth_user_id, pending.session_name, authorized_client=client,
        device_fingerprint=pending.device_fingerprint,
        api_id_override=pending.api_id_override, api_hash_override=pending.api_hash_override,
    )
    await _safe_disconnect(client)
    PENDING_PHONE_LOGINS.pop(token_to_use, None)
    return {"status": "connected", "user": user_payload}


@router.post("/api/v1/accounts/connect-session")
async def connect_session(
    user_id: str = Form(...),
    session_files: list[UploadFile] = File(..., max_length=20),
    api_id: int | None = Form(None),
    api_hash: str | None = Form(None),
    proxy: str | None = Form(None),
    _: str = Depends(current_user_id),
) -> dict[str, Any]:
    _ensure_telegram_config()
    await _connection_cooldown(user_id)

    session_api_id = api_id or settings.telegram_api_id
    session_api_hash = api_hash or settings.telegram_api_hash
    proxy_config: Any = None
    proxy_dict: dict[str, Any] = {}
    if proxy:
        try:
            parsed = json.loads(proxy)
            proxy_config = _parse_proxy_config(parsed)
            proxy_dict = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass

    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for session_file in session_files:
        content = await session_file.read()
        filename = f"{uuid4()}_{session_file.filename or 'session.session'}"
        file_path = SESSION_DIR / filename
        file_path.write_bytes(content)

        fp = random.choice(DEVICE_PROFILES)
        client = TelegramClient(
            _session_name_for_client(str(file_path)),
            session_api_id,
            session_api_hash,
            proxy=proxy_config,
        )
        _apply_fingerprint(client, fp)
        try:
            await client.connect()
            me = await client.get_me()
            if not me:
                errors.append(f"{session_file.filename}: Session file is not authorized")
                continue

            has_pwd = await _telegram_has_password(client)
            twofa_val = 1 if has_pwd else 0
            username = me.username or f"user_{me.id}"
            display_name = get_display_name(me) or username
            phone = getattr(me, "phone", None)
            telegram_id = str(me.id)

            temp_session_file = Path(f"{_session_name_for_client(str(file_path))}.session").resolve()
            canonical_session_base = (SESSION_DIR / f"telegram_{telegram_id}").resolve()
            canonical_session_file = Path(f"{canonical_session_base}.session")
            if temp_session_file.exists() and temp_session_file != canonical_session_file:
                _cleanup_session_files(canonical_session_base)
                try:
                    temp_session_file.replace(canonical_session_file)
                except Exception:
                    canonical_session_file = temp_session_file

            persisted_session_file = str(canonical_session_file)
            fp_json = json.dumps(fp)
            proxy_json = json.dumps(proxy_dict)

            with db() as conn:
                existing = conn.execute(
                    "SELECT id, session_file FROM accounts WHERE user_id = ? AND telegram_id = ?",
                    (user_id, telegram_id),
                ).fetchone()
                if existing:
                    previous_session = existing["session_file"]
                    conn.execute(
                        """
                        UPDATE accounts
                        SET username = ?, display_name = ?, phone = ?, status = ?, location = ?, session_file = ?, source = ?,
                            device_fingerprint_json = ?, proxy_json = ?, api_id = ?, api_hash = ?
                        WHERE id = ?
                        """,
                        (
                            username, display_name, phone, "online", "unknown",
                            persisted_session_file, "session",
                            fp_json, proxy_json, session_api_id, session_api_hash,
                            existing["id"],
                        ),
                    )
                    if previous_session and previous_session != persisted_session_file:
                        _cleanup_session_files(previous_session)
                    if has_pwd is not None:
                        conn.execute(
                            "UPDATE accounts SET twofa_enabled = ? WHERE id = ?",
                            (twofa_val, existing["id"]),
                        )
                else:
                    conn.execute(
                        """
                        INSERT INTO accounts (
                            id, user_id, username, display_name, phone, telegram_id, status, location,
                            session_file, source, exclude_chats, device_fingerprint_json, proxy_json, api_id, api_hash, twofa_enabled, created_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid4()), user_id, username, display_name, phone,
                            telegram_id, "online", "unknown",
                            persisted_session_file, "session", 0,
                            fp_json, proxy_json, session_api_id, session_api_hash,
                            twofa_val,
                            now_iso(),
                        ),
                    )

                results.append({"username": username, "display_name": display_name, "telegram_id": telegram_id})
        except Exception as exc:
            errors.append(f"{session_file.filename}: {exc}")
        finally:
            await _safe_disconnect(client)

    if not results and errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    with db() as conn:
        return {"user": _user_payload(conn, user_id), "results": results, "errors": errors if errors else None}


@router.delete("/api/v1/accounts/{account_id}")
async def delete_account(
    account_id: str,
    user_id: str = Query(..., alias="user_id"),
    _: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        account = conn.execute(
            "SELECT session_file FROM accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Stop running campaigns that reference this account
    with db() as conn:
        campaign_rows = conn.execute(
            "SELECT id, account_ids_json FROM campaigns WHERE user_id = ?",
            (user_id,),
        ).fetchall()

    for row in campaign_rows:
        account_ids = json.loads(row["account_ids_json"])
        if account_id not in account_ids:
            continue
        campaign_id = row["id"]
        CAMPAIGN_STOP_REQUESTED.add(campaign_id)
        async with CAMPAIGN_TASK_LOCK:
            task = CAMPAIGN_TASKS.get(campaign_id)
            if task and not task.done():
                task.cancel()
            CAMPAIGN_TASKS.pop(campaign_id, None)

    # Stop running group scraper campaigns that source from this account
    with db() as conn:
        scraper_rows = conn.execute(
            "SELECT id, source_account_id, inviter_account_ids_json FROM group_scraper_campaigns WHERE user_id = ?",
            (user_id,),
        ).fetchall()

    for row in scraper_rows:
        if row["source_account_id"] == account_id:
            GROUP_SCRAPER_STOP_REQUESTED.add(row["id"])
            task = GROUP_SCRAPER_TASKS.get(row["id"])
            if task and not task.done():
                task.cancel()
            GROUP_SCRAPER_TASKS.pop(row["id"], None)

    # Clean up DB records
    with db() as conn:
        # Remove account from campaign account lists
        for row in campaign_rows:
            account_ids = json.loads(row["account_ids_json"])
            if account_id not in account_ids:
                continue
            account_ids.remove(account_id)
            if not account_ids:
                conn.execute("DELETE FROM campaigns WHERE id = ?", (row["id"],))
            else:
                conn.execute(
                    "UPDATE campaigns SET account_ids_json = ? WHERE id = ?",
                    (json.dumps(account_ids), row["id"]),
                )

        # Remove account from group scraper campaign references
        for row in scraper_rows:
            inviter_ids: list[str] = json.loads(row["inviter_account_ids_json"])
            if account_id not in inviter_ids and row["source_account_id"] != account_id:
                continue
            inviter_ids = [i for i in inviter_ids if i != account_id]
            source_id = "" if row["source_account_id"] == account_id else row["source_account_id"]
            conn.execute(
                "UPDATE group_scraper_campaigns SET source_account_id = ?, inviter_account_ids_json = ? WHERE id = ?",
                (source_id, json.dumps(inviter_ids), row["id"]),
            )

        # Delete orphaned records
        conn.execute("DELETE FROM messages WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM folder_chats WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM campaign_seen WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM group_scraper_candidates WHERE scraper_account_id = ?", (account_id,))

        # Delete account photo
        try:
            _account_photo_path(account_id).unlink(missing_ok=True)
        except Exception:
            pass

        # Delete the account itself
        conn.execute("DELETE FROM accounts WHERE id = ? AND user_id = ?", (account_id, user_id))
        user_data = _user_payload(conn, user_id)

    # Clean up session file on disk
    if account["session_file"]:
        _cleanup_session_files(account["session_file"])

    # Clean up in-memory state
    ACCOUNT_SESSION_LOCKS.pop(account_id, None)
    LAST_CONNECT_TIME.pop(account_id, None)
    FLOODED_ACCOUNTS.pop(account_id, None)
    CONVERSATIONS_CACHE.pop(account_id, None)
    refresh_task = CONVERSATION_REFRESH_TASKS.pop(account_id, None)
    if refresh_task and not refresh_task.done():
        refresh_task.cancel()

    return {"user": user_data}


@router.post("/api/v1/accounts/{account_id}/toggle-exclude-chats")
def toggle_exclude(
    account_id: str, payload: ToggleAccountPayload, _: str = Depends(current_user_id)
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT exclude_chats FROM accounts WHERE id = ? AND user_id = ?",
            (account_id, payload.userId),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found")
        conn.execute(
            "UPDATE accounts SET exclude_chats = ? WHERE id = ? AND user_id = ?",
            (0 if row["exclude_chats"] else 1, account_id, payload.userId),
        )
        keys_to_delete = [k for k in CONVERSATIONS_CACHE if k.startswith(f"{payload.userId}:")]
        for k in keys_to_delete:
            del CONVERSATIONS_CACHE[k]
        return {"user": _user_payload(conn, payload.userId)}


@router.post("/api/v1/accounts/batch-exclude")
def batch_exclude(
    payload: BatchExcludePayload, _: str = Depends(current_user_id)
) -> dict[str, Any]:
    with db() as conn:
        val = 1 if payload.exclude else 0
        conn.executemany(
            "UPDATE accounts SET exclude_chats = ? WHERE id = ? AND user_id = ?",
            [(val, aid, payload.userId) for aid in payload.accountIds],
        )
        keys_to_delete = [k for k in CONVERSATIONS_CACHE if k.startswith(f"{payload.userId}:")]
        for k in keys_to_delete:
            del CONVERSATIONS_CACHE[k]
        return {"user": _user_payload(conn, payload.userId)}


@router.post("/api/v1/accounts/{account_id}/set-2fa")
async def set_account_2fa(
    account_id: str, payload: Set2FAPayload, _: str = Depends(current_user_id)
) -> dict[str, Any]:
    lock = _account_session_lock(account_id)
    async with lock:
        client = None
        try:
            _, client = await _open_account_client_for_user(payload.userId, account_id)
            pwd = await client(functions.account.GetPasswordRequest())
            if pwd.has_password:
                # Local flag was stale — Telegram already has a password set. Re-sync and tell the user.
                with db() as conn:
                    conn.execute("UPDATE accounts SET twofa_enabled = 1 WHERE id = ?", (account_id,))
                raise HTTPException(
                    status_code=400,
                    detail="This account already has 2FA enabled. Disable it first to set a new password.",
                )
            hint = (payload.hint or "").strip() or None
            try:
                await client.edit_2fa(new_password=payload.password, hint=hint)
            except PasswordHashInvalidError:
                raise HTTPException(status_code=400, detail="Could not set 2FA password on this account.")
            with db() as conn:
                conn.execute("UPDATE accounts SET twofa_enabled = 1 WHERE id = ?", (account_id,))
                return {"user": _user_payload(conn, payload.userId)}
        finally:
            if client:
                await _safe_disconnect(client)


@router.post("/api/v1/accounts/{account_id}/remove-2fa")
async def remove_account_2fa(
    account_id: str, payload: Remove2FAPayload, _: str = Depends(current_user_id)
) -> dict[str, Any]:
    lock = _account_session_lock(account_id)
    async with lock:
        client = None
        try:
            _, client = await _open_account_client_for_user(payload.userId, account_id)
            pwd = await client(functions.account.GetPasswordRequest())
            if not pwd.has_password:
                # Telegram has no password — re-sync flag and report success-as-already-off.
                with db() as conn:
                    conn.execute("UPDATE accounts SET twofa_enabled = 0 WHERE id = ?", (account_id,))
                    return {"user": _user_payload(conn, payload.userId)}
            try:
                await client.edit_2fa(current_password=payload.currentPassword, new_password="")
            except PasswordHashInvalidError:
                raise HTTPException(status_code=400, detail="Invalid current 2FA password.")
            with db() as conn:
                conn.execute("UPDATE accounts SET twofa_enabled = 0 WHERE id = ?", (account_id,))
                return {"user": _user_payload(conn, payload.userId)}
        finally:
            if client:
                await _safe_disconnect(client)


def _classify_session_error(account_id: str, exc: Exception) -> dict[str, Any]:
    """Map a Telethon exception to a session-health result.

    Prefers exact Telethon error types and falls back to a string heuristic only
    for exceptions that don't subclass the known types (older/renamed classes).
    """
    detail = str(exc)[:200]

    # Banned / deactivated accounts.
    if isinstance(
        exc,
        (UserDeactivatedBanError, UserDeactivatedError, InputUserDeactivatedError, PhoneNumberBannedError),
    ):
        return {
            "accountId": account_id,
            "status": "banned",
            "ok": False,
            "needsReconnect": False,
            "detail": f"Account banned/deactivated: {detail}",
        }

    # Flood / temporarily frozen.
    if isinstance(exc, FloodWaitError):
        seconds = getattr(exc, "seconds", 3600)
        return {
            "accountId": account_id,
            "status": "frozen",
            "ok": False,
            "needsReconnect": False,
            "detail": f"Flood wait: ~{seconds}s remaining",
        }

    # Dead / revoked session — needs reconnect.
    if isinstance(
        exc,
        (
            AuthKeyUnregisteredError,
            AuthKeyInvalidError,
            AuthKeyDuplicatedError,
            SessionRevokedError,
            SessionExpiredError,
            UnauthorizedError,
        ),
    ):
        return {
            "accountId": account_id,
            "status": "disconnected",
            "ok": False,
            "needsReconnect": True,
            "detail": detail,
        }

    # Heuristic fallback for anything not covered by the typed branches above.
    name = type(exc).__name__.upper()
    text = detail.upper()
    if "BANNED" in name or "DEACTIVATED" in name or "BANNED" in text or "DEACTIVATED" in text:
        return {
            "accountId": account_id,
            "status": "banned",
            "ok": False,
            "needsReconnect": False,
            "detail": f"Account banned/deactivated: {detail}",
        }
    if "FLOOD" in name or "FLOOD" in text:
        return {
            "accountId": account_id,
            "status": "frozen",
            "ok": False,
            "needsReconnect": False,
            "detail": f"Flood wait: {detail}",
        }
    if (
        "AUTH" in name
        or "SESSION" in name
        or "UNAUTHORIZED" in text
        or "AUTH_KEY" in text
        or "NOT_CONNECTED" in text
    ):
        return {
            "accountId": account_id,
            "status": "disconnected",
            "ok": False,
            "needsReconnect": True,
            "detail": detail,
        }

    return {
        "accountId": account_id,
        "status": "error",
        "ok": False,
        "needsReconnect": True,
        "detail": detail,
    }


@router.get("/api/v1/accounts/session-health")
async def account_session_health(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, session_file, device_fingerprint_json, api_id, api_hash FROM accounts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()

    sem = asyncio.Semaphore(5)

    async def _check_one(row: sqlite3.Row) -> dict[str, Any]:
        async with sem:
            account_id = row["id"]
            if not row["session_file"]:
                return {
                    "accountId": account_id,
                    "status": "error",
                    "ok": False,
                    "needsReconnect": True,
                    "detail": "No session file found",
                }

            lock = _account_session_lock(account_id)
            async with lock:
                client: TelegramClient | None = None
                try:
                    _, client = await _open_account_client_for_user(user_id, account_id)

                    if not await client.is_user_authorized():
                        return {
                            "accountId": account_id,
                            "status": "disconnected",
                            "ok": False,
                            "needsReconnect": True,
                            "detail": "Session is not authorized",
                        }

                    # get_me() raises the ban/deactivation/revoked errors directly when the
                    # account is in a bad state — no channel join/leave probe needed.
                    me = await client.get_me()
                    if not me:
                        return {
                            "accountId": account_id,
                            "status": "disconnected",
                            "ok": False,
                            "needsReconnect": True,
                            "detail": "Session is disconnected",
                        }

                    # Self-heal the stored 2FA flag from Telegram's real password state.
                    has_pwd = await _telegram_has_password(client)
                    if has_pwd is not None:
                        with db() as conn:
                            conn.execute(
                                "UPDATE accounts SET twofa_enabled = ? WHERE id = ?",
                                (1 if has_pwd else 0, account_id),
                            )

                    # Lightweight, side-effect-free liveness call. Surfaces flood/restriction
                    # state without joining or leaving anything.
                    await client(functions.account.GetAccountTTLRequest())
                    return {
                        "accountId": account_id,
                        "status": "good",
                        "ok": True,
                        "needsReconnect": False,
                        "detail": None,
                    }
                except Exception as exc:
                    return _classify_session_error(account_id, exc)
                finally:
                    if client:
                        try:
                            await _safe_disconnect(client)
                        except Exception:
                            pass

    tasks = [_check_one(row) for row in rows]
    results = await asyncio.gather(*tasks)

    now_ts = time.time()
    for r in results:
        aid = r["accountId"]
        if r.get("status") == "good" and aid in FLOODED_ACCOUNTS:
            until = FLOODED_ACCOUNTS[aid]
            if until > now_ts:
                remaining = int(until - now_ts)
                r["status"] = "frozen"
                r["ok"] = False
                r["needsReconnect"] = False
                r["detail"] = f"Flood wait: ~{remaining}s remaining (from campaign)"

    # Persist the latest status so the dashboard can count healthy accounts without
    # re-running live checks on every page load.
    if results:
        with db() as conn:
            for r in results:
                conn.execute(
                    "UPDATE accounts SET session_status = ? WHERE id = ?",
                    (r.get("status") or "unknown", r["accountId"]),
                )

    return {"accounts": results}


@router.get("/api/v1/accounts/{account_id}/photo")
async def get_account_photo(
    account_id: str,
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

    photo_path = _account_photo_path(account_id)

    if _account_photo_is_fresh(account_id):
        return Response(content=photo_path.read_bytes(), media_type="image/jpeg")

    lock = _account_session_lock(account_id)
    async with lock:
        account, client = await _open_account_client_for_user(user_id, account_id)
        try:
            buf = io.BytesIO()
            downloaded = await client.download_profile_photo("me", file=buf)
            if downloaded is None:
                return Response(status_code=204)
            buf.seek(0)
            photo_bytes = buf.read()
            photo_path.write_bytes(photo_bytes)
            with db() as conn:
                conn.execute(
                    "UPDATE accounts SET photo_url = ? WHERE id = ? AND user_id = ?",
                    (photo_path.name, account_id, user_id),
                )
            return Response(content=photo_bytes, media_type="image/jpeg")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/accounts/{account_id}/profile")
async def update_account_profile(
    account_id: str,
    payload: UpdateProfilePayload,
    auth_user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    requested_user_id = payload.userId.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")
    if requested_user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")

    lock = _account_session_lock(account_id)
    async with lock:
        account, client = await _open_account_client_for_user(auth_user_id, account_id)
        try:
            me = await client.get_me()
            if not me:
                raise HTTPException(status_code=400, detail="Could not fetch Telegram profile")
            current_first = getattr(me, "first_name", None) or ""
            current_last = getattr(me, "last_name", None) or ""

            new_first = payload.firstName if payload.firstName is not None else current_first
            new_last = payload.lastName if payload.lastName is not None else current_last

            if payload.firstName is not None or payload.lastName is not None:
                await client(
                    functions.account.UpdateProfileRequest(
                        first_name=new_first,
                        last_name=new_last,
                    )
                )

            if payload.username is not None:
                await client(functions.account.UpdateUsernameRequest(username=payload.username))

            with db() as conn:
                updates: list[str] = []
                params: list[Any] = []
                if payload.firstName is not None or payload.lastName is not None:
                    new_display = f"{new_first} {new_last}".strip()
                    updates.append("display_name = ?")
                    params.append(new_display)
                if payload.username is not None:
                    updates.append("username = ?")
                    params.append(payload.username)
                if updates:
                    params.extend([account_id, auth_user_id])
                    conn.execute(
                        f"UPDATE accounts SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                        params,
                    )
                return {"user": _user_payload(conn, auth_user_id)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to update profile: {exc}")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/accounts/{account_id}/photo")
async def update_account_photo(
    account_id: str,
    user_id: str = Form(...),
    file: UploadFile = File(...),
    _: str = Depends(current_user_id),
) -> dict[str, Any]:
    requested_user_id = user_id.strip()
    if requested_user_id == "":
        raise HTTPException(status_code=400, detail="userId is required")

    lock = _account_session_lock(account_id)
    async with lock:
        account, client = await _open_account_client_for_user(requested_user_id, account_id)
        try:
            content = await file.read()
            uploaded = await client.upload_file(io.BytesIO(content), file_name=file.filename or "photo.jpg")
            await client(functions.photos.UploadProfilePhotoRequest(file=uploaded))
            photo_path = _account_photo_path(account_id)
            photo_path.write_bytes(content)
            with db() as conn:
                conn.execute(
                    "UPDATE accounts SET photo_url = ? WHERE id = ? AND user_id = ?",
                    (photo_path.name, account_id, requested_user_id),
                )
                return {"user": _user_payload(conn, requested_user_id)}
        except FloodWaitError as e:
            logger.error("Photo upload flood wait for account %s: %ss", account_id, e.seconds)
            raise HTTPException(
                status_code=429,
                detail=f"Telegram flood wait: {e.seconds}s remaining. Try again later.",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Photo upload failed for account %s: %s", account_id, e, exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload photo: {str(e)}",
            )


@router.get("/api/v1/accounts")
async def list_accounts(user_id: str = Depends(current_user_id)):
    """List accounts for the unified layer."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, display_name, username, session_file IS NOT NULL as has_session, session_status FROM accounts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "label": r["display_name"] or r["username"] or r["id"][:8],
            "username": r["username"],
            "status": "connected" if r["has_session"] else "disconnected",
            "meta": {"session_status": r["session_status"]},
        }
        for r in rows
    ]
