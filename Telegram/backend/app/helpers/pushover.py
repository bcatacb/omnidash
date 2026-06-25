"""Pushover push-notification helper.

Sends messages via the Pushover API (https://pushover.net/api). Uses the Python
standard library (``urllib``) run in a worker thread so we don't add an HTTP
dependency — Telethon does not ship one we can reuse.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

_PUSHOVER_URL = "https://api.pushover.net/1/messages.json"
_TIMEOUT_SECONDS = 15


def _post_one(token: str, user_key: str, message: str, title: str | None) -> tuple[bool, str | None]:
    data = {"token": token, "user": user_key, "message": message}
    if title:
        data["title"] = title
    encoded = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(_PUSHOVER_URL, data=encoded, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(body) if body else {}
            if parsed.get("status") == 1:
                return True, None
            return False, str(parsed.get("errors") or body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else str(exc)
        return False, f"HTTP {exc.code}: {detail}"
    except Exception as exc:  # noqa: BLE001 - never raise into the caller
        return False, f"{type(exc).__name__}: {exc}"


async def send_pushover(
    token: str,
    user_keys: list[str],
    message: str,
    title: str | None = None,
) -> dict[str, list[str]]:
    """Send ``message`` to each Pushover recipient key.

    Returns ``{"sent": [...keys...], "failed": [...keys...]}``. Never raises — failures
    are logged and reported in the return value so a misconfigured key can't crash the
    Telethon event handler that calls this.
    """
    result: dict[str, list[str]] = {"sent": [], "failed": []}
    if not token or not message:
        logger.warning("[PUSHOVER] missing token or message; skipping")
        result["failed"] = list(user_keys)
        return result
    for key in user_keys:
        if not key:
            continue
        ok, err = await asyncio.to_thread(_post_one, token, key, message, title)
        if ok:
            result["sent"].append(key)
        else:
            result["failed"].append(key)
            logger.warning("[PUSHOVER] send to %s failed: %s", key[:6] + "…", err)
    return result
