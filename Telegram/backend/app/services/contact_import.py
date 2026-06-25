import asyncio
import json
import random
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.errors.rpcerrorlist import UsernameNotOccupiedError
from telethon.tl import functions
from telethon.tl.types import InputPhoneContact, InputUser

from ..core.config import SESSION_DIR, settings
from ..core.database import db
from ..helpers.telegram import _account_session_lock, _open_account_client_for_user, _safe_disconnect
from ..models.schemas import ContactImportPayload


async def import_contacts(
    payload: ContactImportPayload,
    user_id: str,
) -> StreamingResponse:
    source_account_id = payload.source_account_id.strip()
    target_account_id = payload.target_account_id.strip()
    if not source_account_id or not target_account_id:
        raise HTTPException(status_code=400, detail="Source and target accounts are required")
    if source_account_id == target_account_id:
        raise HTTPException(status_code=400, detail="Source and target accounts must be different")

    with db() as conn:
        source_exists = conn.execute(
            "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
            (source_account_id, user_id),
        ).fetchone()
        target_exists = conn.execute(
            "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
            (target_account_id, user_id),
        ).fetchone()
    if not source_exists or not target_exists:
        raise HTTPException(status_code=404, detail="Source or target account not found")

    def _event(data: dict[str, Any]) -> str:
        return f"data: {json.dumps(data)}\n\n"

    def _normalize_phone(phone: str) -> str:
        phone = phone.strip()
        if not phone:
            return ""
        digits = "".join(ch for ch in phone if ch.isdigit())
        if not digits:
            return ""
        return f"+{digits}"

    def _contact_payload(contact: Any, status: str, reason: str | None = None) -> dict[str, Any]:
        first = getattr(contact, "first_name", None) or ""
        last = getattr(contact, "last_name", None) or ""
        full_name = f"{first} {last}".strip() or str(getattr(contact, "id", ""))
        item = {
            "user_id": str(getattr(contact, "id", "")),
            "username": getattr(contact, "username", None) or "",
            "full_name": full_name,
            "phone": _normalize_phone(getattr(contact, "phone", None) or ""),
            "status": status,
        }
        if reason:
            item["reason"] = reason
        return item

    async def _stream():
        imported_contacts: list[dict[str, Any]] = []
        skipped_contacts: list[dict[str, Any]] = []
        source_client: TelegramClient | None = None
        target_client: TelegramClient | None = None
        try:
            source_lock = _account_session_lock(source_account_id)
            async with source_lock:
                _, source_client = await _open_account_client_for_user(user_id, source_account_id)
                try:
                    result = await source_client(functions.contacts.GetContactsRequest(0))
                    contacts = [
                        c for c in (result.users if result else [])
                        if not getattr(c, "bot", False) and not getattr(c, "deleted", False)
                    ]
                finally:
                    await _safe_disconnect(source_client)
                    source_client = None

            total = len(contacts)
            yield _event({"type": "progress", "current": 0, "total": total})

            target_lock = _account_session_lock(target_account_id)
            async with target_lock:
                _, target_client = await _open_account_client_for_user(user_id, target_account_id)
                try:
                    for idx, contact in enumerate(contacts, start=1):
                        first = getattr(contact, "first_name", None) or ""
                        last = getattr(contact, "last_name", None) or ""
                        username = getattr(contact, "username", None) or ""
                        phone_raw = (getattr(contact, "phone", None) or "").strip()
                        phone = _normalize_phone(phone_raw)

                        if not phone:
                            resolved_user = None
                            if username:
                                try:
                                    resolved = await target_client(
                                        functions.contacts.ResolveUsernameRequest(username)
                                    )
                                    if resolved.users:
                                        user = resolved.users[0]
                                        if not getattr(user, "bot", False) and not getattr(user, "deleted", False):
                                            resolved_user = user
                                except UsernameNotOccupiedError:
                                    pass
                                except Exception:
                                    pass
                            if not resolved_user:
                                try:
                                    src_hash = getattr(contact, "access_hash", 0)
                                    users = await target_client(
                                        functions.users.GetUsersRequest([InputUser(user_id=contact.id, access_hash=src_hash)])
                                    )
                                    if users:
                                        user = users[0]
                                        if not getattr(user, "bot", False) and not getattr(user, "deleted", False) and getattr(user, "id", None):
                                            resolved_user = user
                                except Exception:
                                    pass
                            if resolved_user:
                                try:
                                    await target_client(
                                        functions.contacts.AddContactRequest(
                                            id=InputUser(user_id=resolved_user.id, access_hash=getattr(resolved_user, "access_hash", 0)),
                                            first_name=first or username or "Contact",
                                            last_name=last,
                                            phone="",
                                            add_phone_privacy_exception=False,
                                        )
                                    )
                                    imported_contacts.append(_contact_payload(contact, "imported"))
                                    yield _event({"type": "progress", "current": idx, "total": total})
                                    await asyncio.sleep(0.15)
                                    continue
                                except Exception:
                                    pass
                            skipped_contacts.append(
                                _contact_payload(contact, "skipped", "Contact has no phone number")
                            )
                            yield _event({"type": "progress", "current": idx, "total": total})
                            continue

                        client_id = random.randrange(1, 2**63 - 1)
                        input_contact = InputPhoneContact(
                            client_id=client_id,
                            phone=phone,
                            first_name=first or username or "Contact",
                            last_name=last,
                        )
                        try:
                            import_result = await target_client(
                                functions.contacts.ImportContactsRequest([input_contact])
                            )
                            imported_ids = {
                                getattr(item, "client_id", None)
                                for item in getattr(import_result, "imported", []) or []
                            }
                            if client_id in imported_ids or getattr(import_result, "users", None):
                                imported_contacts.append(_contact_payload(contact, "imported"))
                            else:
                                skipped_contacts.append(
                                    _contact_payload(contact, "skipped", "Telegram did not import this contact")
                                )
                        except FloodWaitError as exc:
                            skipped_contacts.append(
                                _contact_payload(contact, "error", f"Flood wait: {exc.seconds}s")
                            )
                        except Exception as exc:
                            skipped_contacts.append(_contact_payload(contact, "error", str(exc)[:200]))

                        yield _event({"type": "progress", "current": idx, "total": total})
                        await asyncio.sleep(0.15)
                finally:
                    await _safe_disconnect(target_client)
                    target_client = None

            yield _event(
                {
                    "type": "complete",
                    "imported": len(imported_contacts),
                    "skipped": len(skipped_contacts),
                    "total": len(imported_contacts) + len(skipped_contacts),
                    "imported_contacts": imported_contacts,
                    "skipped_contacts": skipped_contacts,
                }
            )
        except Exception as exc:
            if source_client is not None:
                try:
                    await _safe_disconnect(source_client)
                except Exception:
                    pass
            if target_client is not None:
                try:
                    await _safe_disconnect(target_client)
                except Exception:
                    pass
            yield _event({"type": "error", "message": str(exc)[:500]})

    return StreamingResponse(_stream(), media_type="text/event-stream")
