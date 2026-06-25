import asyncio
import json
import logging
import random
import time
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.utils import get_display_name

from ..core.config import SESSION_DIR, settings
from ..core.database import db, now_iso
from ..core.state import (
    ACCOUNT_SESSION_LOCKS,
    WARMUP_ACTIVITY_LOG,
    WARMUP_STATES,
    WARMUP_STOP_REQUESTED,
    WARMUP_TASKS,
)
from ..helpers.telegram import (
    _account_session_lock,
    _apply_fingerprint,
    _open_account_client_for_user,
    _parse_proxy_config,
    _resolve_entity,
    _safe_disconnect,

)

_WARMUP_POOLS: dict[str, list[str]] = {
    "reactions": [
        "lol", "😂", "👀", "Wow", "😮", "True", "Facts", "No way",
        "😅", "💀", "Haha", "😭", "🤣", "OMG", "Bruh", "Yikes",
        "🙌", "🔥", "💯", "😬",
    ],
    "agreements": [
        "Exactly", "100%", "Totally agree", "Same", "For real",
        "Yep", "Agreed", "Absolutely", "This", "So true",
        "Can't argue with that", "Spot on", "Couldn't have said it better",
        "Preach", "Valid point",
    ],
    "questions": [
        "Did you see that?", "Anyone else notice this?", "What do you all think?",
        "Has anyone tried it?", "Thoughts?", "Wait really?",
        "How did that happen?", "Anyone know more about this?",
        "Is that confirmed?", "Where did you find that?",
    ],
    "casual": [
        "Morning everyone", "How's everyone doing?", "Weekend plans?",
        "Good morning!", "Hey everyone!", "Good afternoon!",
        "Hope everyone's having a good day", "How's it going?",
        "What's up?", "Evening all",
    ],
    "acks": [
        "Makes sense", "Got it", "Noted", "Good to know",
        "Thanks for the info", "Thanks for sharing", "Appreciate it",
        "Got it, thanks", "Will check it out", "Sounds good!",
        "Let me know if you need anything", "👍", "Okay cool",
        "Understood", "Good to know",
    ],
    "engagement": [
        "That's wild", "Didn't expect that", "Interesting point",
        "That's actually helpful", "Nice find", "Wow good catch",
        "That changes things", "Solid", "Not bad at all",
        "That tracks", "Makes total sense now", "Good call",
    ],
}

_WARMUP_POOL_WEIGHTS = [20, 15, 15, 15, 20, 15]
_WARMUP_POOL_KEYS = list(_WARMUP_POOLS.keys())

WARMUP_MESSAGES: list[str] = [m for pool in _WARMUP_POOLS.values() for m in pool]


def _pick_warmup_message(last_pool: str | None = None) -> tuple[str, str]:
    weights = list(_WARMUP_POOL_WEIGHTS)
    if last_pool and last_pool in _WARMUP_POOL_KEYS:
        idx = _WARMUP_POOL_KEYS.index(last_pool)
        weights[idx] = max(1, weights[idx] // 4)
    pool_key = random.choices(_WARMUP_POOL_KEYS, weights=weights, k=1)[0]
    return random.choice(_WARMUP_POOLS[pool_key]), pool_key


async def _run_warmup_worker(
    user_id: str,
    account_ids: list[str],
    interval_seconds: int,
) -> None:
    try:
        account_entities: dict[str, Any] = {}

        for aid in account_ids:
            try:
                lock = _account_session_lock(aid)
                async with lock:
                    row, client = await _open_account_client_for_user(user_id, aid)
                    me = await client.get_me()
                    account_entities[aid] = me
                    await _safe_disconnect(client)
            except Exception as exc:
                logger.warning("Warmup: failed to get entity for account %s: %s", aid, exc)

        now = datetime.now(UTC)
        states: dict[str, dict[str, Any]] = {}
        for aid in account_ids:
            me = account_entities.get(aid)
            states[aid] = {
                "accountId": aid,
                "displayName": get_display_name(me) if me else aid[:8],
                "state": "idle",
                "sentToday": 0,
                "dmSentToday": 0,
                "dailyLimit": 15,
                "restUntil": None,
                "restSeconds": 0,
                "lastError": None,
                "incomingDmFrom": None,
            }
        # Fixed-order ring of the reachable accounts — rotation is deterministic, not random.
        order = [aid for aid in account_ids if aid in account_entities]
        position_of = {aid: i for i, aid in enumerate(order)}
        n = len(order)
        rotation_round = 0
        offset = 1 if n > 1 else 0

        WARMUP_STATES[user_id] = states
        WARMUP_ACTIVITY_LOG[user_id] = []
        WARMUP_STATES[user_id]["_meta"] = {
            "startedAt": now_iso(),
            "intervalSeconds": interval_seconds,
            "order": [{"accountId": aid, "displayName": states[aid]["displayName"]} for aid in order],
            "rotationOffset": offset,
        }

        account_cycle = order
        cycle_idx = 0
        last_pool_used: str | None = None

        while user_id not in WARMUP_STOP_REQUESTED:
            now = datetime.now(UTC)
            if n < 2:
                # Need at least two reachable accounts to DM each other; idle until that changes.
                await asyncio.sleep(interval_seconds)
                continue
            idx = cycle_idx % n
            cycle_idx += 1
            # When a full pass over the ring completes, rotate the pairing so each account
            # cycles through every other account in order (A→B, then A→C, …).
            if idx == 0 and cycle_idx > 1:
                rotation_round += 1
                offset = 1 + (rotation_round % (n - 1))
                WARMUP_STATES[user_id]["_meta"]["rotationOffset"] = offset
            aid = account_cycle[idx]
            state = states[aid]

            if state["sentToday"] >= 15:
                state["state"] = "idle"
                state["incomingDmFrom"] = None
                continue

            if state["state"] == "cooldown" and state["restUntil"]:
                rest_dt = state["restUntil"]
                if isinstance(rest_dt, str):
                    rest_dt = datetime.fromisoformat(rest_dt)
                if now < rest_dt:
                    state["restSeconds"] = max(0, int((rest_dt - now).total_seconds()))
                    continue
                else:
                    state["state"] = "idle"
                    state["restUntil"] = None
                    state["restSeconds"] = 0

            # Warmup is DM-only with an ordered rotation: reply to a pending incoming DM, otherwise
            # initiate to the next account in the ring at the current rotation offset.
            pending_reply_to = state.get("incomingDmFrom")
            if pending_reply_to and pending_reply_to in account_entities:
                target_aid = pending_reply_to
                target_entity = account_entities.get(target_aid)
                chat_id = str(target_entity.id)
                target_label = get_display_name(target_entity)
                state["incomingDmFrom"] = None
            else:
                target_aid = order[(position_of[aid] + offset) % n]
                target_entity = account_entities[target_aid]
                chat_id = str(target_entity.id)
                target_label = get_display_name(target_entity)

            message, last_pool_used = _pick_warmup_message(last_pool_used)
            lock = _account_session_lock(aid)
            async with lock:
                try:
                    _, client = await _open_account_client_for_user(user_id, aid)
                    try:
                        entity = await _resolve_entity(client, chat_id)
                        await client.send_message(entity, message)
                        state["sentToday"] += 1
                        state["dmSentToday"] += 1
                        target_state = states.get(target_aid)
                        if target_state and not target_state.get("incomingDmFrom"):
                            target_state["incomingDmFrom"] = aid
                        state["state"] = "active"
                        state["lastError"] = None
                        state["restUntil"] = None
                        state["restSeconds"] = 0
                        log_entry = {
                            "at": now_iso(),
                            "accountId": aid,
                            "displayName": state["displayName"],
                            "target": target_label,
                            "type": "dm",
                            "message": message,
                        }
                        WARMUP_ACTIVITY_LOG[user_id].append(log_entry)
                        if len(WARMUP_ACTIVITY_LOG[user_id]) > 200:
                            WARMUP_ACTIVITY_LOG[user_id] = WARMUP_ACTIVITY_LOG[user_id][-200:]
                    except FloodWaitError as fwe:
                        seconds = getattr(fwe, "seconds", 14400)
                        rhs = now + timedelta(seconds=seconds)
                        state["restUntil"] = rhs.isoformat()
                        state["restSeconds"] = seconds
                        state["state"] = "cooldown"
                        state["lastError"] = f"Flood wait: {seconds}s"
                    except Exception as e:
                        rhs = now + timedelta(hours=4)
                        state["restUntil"] = rhs.isoformat()
                        state["restSeconds"] = 14400
                        state["state"] = "cooldown"
                        state["lastError"] = str(e)[:200]
                    finally:
                        await _safe_disconnect(client)
                except Exception as e:
                    state["lastError"] = f"Connection error: {str(e)[:200]}"
                    rhs = now + timedelta(hours=4)
                    state["restUntil"] = rhs.isoformat()
                    state["restSeconds"] = 14400
                    state["state"] = "cooldown"

            await asyncio.sleep(interval_seconds * random.uniform(0.75, 1.45))

    except asyncio.CancelledError:
        pass
    finally:
        WARMUP_STATES.pop(user_id, None)
        WARMUP_ACTIVITY_LOG.pop(user_id, None)
        WARMUP_STOP_REQUESTED.discard(user_id)
        WARMUP_TASKS.pop(user_id, None)
