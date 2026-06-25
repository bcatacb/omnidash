from datetime import UTC, datetime

from ..core.config import QR_TTL_SECONDS, SESSION_DIR
from ..core.state import PENDING_PHONE_LOGINS, PendingPhoneLogin
from .telegram import _cleanup_session_files


async def _cleanup_expired_phone_logins() -> None:
    now = datetime.now(UTC)
    expired_tokens = [token for token, item in PENDING_PHONE_LOGINS.items() if item.expires_at <= now]
    for token in expired_tokens:
        pending = PENDING_PHONE_LOGINS.pop(token, None)
        if pending:
            try:
                await pending.client.disconnect()
            except Exception:
                pass
            _cleanup_session_files(SESSION_DIR / pending.session_name)


async def _drop_user_pending_phone_logins(user_id: str) -> None:
    stale_tokens = [token for token, item in PENDING_PHONE_LOGINS.items() if item.user_id == user_id]
    for token in stale_tokens:
        pending = PENDING_PHONE_LOGINS.pop(token, None)
        if pending:
            try:
                await pending.client.disconnect()
            except Exception:
                pass


def _latest_pending_phone_for_user(user_id: str) -> tuple[str, PendingPhoneLogin] | None:
    candidates = [(token, item) for token, item in PENDING_PHONE_LOGINS.items() if item.user_id == user_id]
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[1].created_at, reverse=True)
    return candidates[0]
