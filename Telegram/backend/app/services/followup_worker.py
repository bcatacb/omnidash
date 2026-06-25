"""Background worker that sends automated follow-up sequences.

For each campaign with an enabled follow-up config, it finds recipients who *read* the original
campaign message but never replied, and—after the configured per-step delay—sends the next
follow-up message in the sequence. Each step is sent at most once per recipient (enforced by the
`campaign_followups` UNIQUE constraint), and the sequence halts as soon as the recipient replies.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from telethon import TelegramClient
from telethon.errors import FloodWaitError

from ..core.database import db, db_write, async_db_read, now_iso
from ..helpers.campaign import check_replied, check_seen
from ..helpers.telegram import (
    _account_session_lock,
    _open_account_client_for_user,
    _resolve_entity,
    _safe_disconnect,
)

logger = logging.getLogger(__name__)

# How often the worker scans for due follow-ups.
FOLLOWUP_INTERVAL_SECONDS = 900
# Small pause between individual sends to stay gentle on the account.
_SEND_SPACING_SECONDS = 4


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except Exception:
        return None


def _already_done_steps(campaign_id: str, account_id: str, chat_id: str) -> set[int]:
    with db() as conn:
        rows = conn.execute(
            "SELECT step_index FROM campaign_followups WHERE campaign_id = ? AND account_id = ? AND chat_id = ?",
            (campaign_id, account_id, str(chat_id)),
        ).fetchall()
    return {int(r["step_index"]) for r in rows}


def _record_followup(campaign_id: str, account_id: str, chat_id: str, step_index: int, message_id: int | None) -> None:
    def _write(conn):
        conn.execute(
            """
            INSERT OR IGNORE INTO campaign_followups
                (id, campaign_id, account_id, chat_id, step_index, message_id, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), campaign_id, account_id, str(chat_id), step_index, message_id, now_iso()),
        )
    db_write(_write)


async def _process_campaign(row: Any) -> None:
    campaign_id = row["id"]
    user_id = row["user_id"]
    config = json.loads(row["followup_config_json"]) if row["followup_config_json"] else None
    if not config or not config.get("enabled"):
        return
    steps = config.get("steps") or []
    if not steps:
        return
    summary = json.loads(row["last_run_summary_json"]) if row["last_run_summary_json"] else {}
    sent_items = (summary or {}).get("sentItems") or []
    now = datetime.now(UTC)

    # Group due recipients by account so we open each client once.
    by_account: dict[str, list[dict[str, Any]]] = {}
    for item in sent_items:
        if item.get("success") is False:
            continue
        account_id = item.get("accountId")
        chat_id = item.get("chatId")
        message_id = int(item.get("messageId") or 0)
        if not account_id or not chat_id or not message_id:
            continue
        sent_at = _parse_iso(item.get("sentAt"))
        if not sent_at:
            continue
        done = _already_done_steps(campaign_id, account_id, str(chat_id))
        # The due step is the lowest not-yet-sent step whose delay has elapsed.
        due_step = None
        for idx, step in enumerate(steps):
            if idx in done:
                continue
            delay_hours = float(step.get("delayHours") or 0)
            if (now - sent_at).total_seconds() >= delay_hours * 3600:
                due_step = (idx, step)
            break  # only consider the next pending step in order
        if due_step is None:
            continue
        by_account.setdefault(account_id, []).append({**item, "_dueStep": due_step})

    for account_id, recipients in by_account.items():
        lock = _account_session_lock(account_id)
        async with lock:
            client: TelegramClient | None = None
            try:
                _, client = await _open_account_client_for_user(user_id, account_id)
            except Exception as exc:
                logger.warning("[FOLLOWUP] cannot open account %s: %s", account_id, exc)
                await _safe_disconnect(client)
                continue
            try:
                for item in recipients:
                    chat_id = str(item.get("chatId"))
                    message_id = int(item.get("messageId") or 0)
                    sent_at = _parse_iso(item.get("sentAt"))
                    idx, step = item["_dueStep"]
                    try:
                        entity = await _resolve_entity(client, chat_id)
                        # Only follow up with people who read it but did not reply.
                        replied, _, _ = await check_replied(client, entity, message_id, sent_at)
                        if replied:
                            continue
                        seen = await check_seen(client, entity, message_id)
                        if not seen:
                            continue
                        sent = await client.send_message(entity, step.get("message") or "")
                        _record_followup(campaign_id, account_id, chat_id, idx, getattr(sent, "id", None))
                        logger.info("[FOLLOWUP] campaign=%s account=%s chat=%s step=%s sent", campaign_id, account_id, chat_id, idx)
                        await asyncio.sleep(_SEND_SPACING_SECONDS)
                    except FloodWaitError as fwe:
                        logger.warning("[FOLLOWUP] flood wait %ss on account %s — skipping rest this cycle", getattr(fwe, "seconds", "?"), account_id)
                        break
                    except Exception as exc:
                        logger.warning("[FOLLOWUP] failed campaign=%s chat=%s: %s", campaign_id, chat_id, exc)
            finally:
                await _safe_disconnect(client)


async def run_followup_worker(interval_seconds: int = FOLLOWUP_INTERVAL_SECONDS) -> None:
    """Global periodic loop; runs for the lifetime of the process."""
    logger.info("[FOLLOWUP] worker started (interval=%ss)", interval_seconds)
    while True:
        try:
            rows = await async_db_read(
                lambda conn: conn.execute(
                    "SELECT id, user_id, last_run_summary_json, followup_config_json "
                    "FROM campaigns WHERE followup_config_json IS NOT NULL"
                ).fetchall()
            )
            for row in rows:
                try:
                    await _process_campaign(row)
                except Exception as exc:
                    logger.exception("[FOLLOWUP] campaign %s failed: %s", row["id"], exc)
        except Exception as exc:
            logger.exception("[FOLLOWUP] worker cycle failed: %s", exc)
        await asyncio.sleep(interval_seconds)
