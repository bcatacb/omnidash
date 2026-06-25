from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import quote_plus

from ..core.config import QR_TTL_SECONDS, SESSION_DIR, settings
from ..core.state import PENDING_QR_LOGINS, PendingQrLogin
from .telegram import _cleanup_session_files
from .campaign import _normalize_dt


def _qr_png_data_url(value: str) -> str:
    encoded_value = quote_plus(value)
    return f"https://api.qrserver.com/v1/create-qr-code/?size=360x360&data={encoded_value}"


async def _cleanup_expired_qr_logins() -> None:
    now = datetime.now(UTC)
    expired_tokens = [token for token, item in PENDING_QR_LOGINS.items() if item.expires_at <= now]
    for token in expired_tokens:
        pending = PENDING_QR_LOGINS.pop(token, None)
        if pending:
            try:
                await pending.client.disconnect()
            except Exception:
                pass
            _cleanup_session_files(SESSION_DIR / pending.session_name)


async def _drop_user_pending_qr_logins(user_id: str) -> None:
    stale_tokens = [token for token, item in PENDING_QR_LOGINS.items() if item.user_id == user_id]
    for token in stale_tokens:
        pending = PENDING_QR_LOGINS.pop(token, None)
        if pending:
            try:
                await pending.client.disconnect()
            except Exception:
                pass


def _latest_pending_qr_for_user(user_id: str) -> tuple[str, PendingQrLogin] | None:
    candidates = [(token, item) for token, item in PENDING_QR_LOGINS.items() if item.user_id == user_id]
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[1].created_at, reverse=True)
    return candidates[0]


def _effective_qr_expiry(qr_expires_at: datetime | None) -> datetime:
    local_ttl = datetime.now(UTC) + timedelta(seconds=QR_TTL_SECONDS)
    normalized_qr = _normalize_dt(qr_expires_at)
    if normalized_qr is None:
        return local_ttl
    return min(local_ttl, normalized_qr)
