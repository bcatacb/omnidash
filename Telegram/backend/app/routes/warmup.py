from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..core.config import SESSION_DIR, settings
from ..core.security import current_user_id
from ..core.state import (
    WARMUP_ACTIVITY_LOG,
    WARMUP_STATES,
    WARMUP_STOP_REQUESTED,
    WARMUP_TASKS,
)
from ..models.schemas import WarmupStartPayload
from ..services.warmup_worker import _run_warmup_worker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="")


@router.post("/api/v1/warmup/start")
async def warmup_start(
    payload: WarmupStartPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    if len(payload.accountIds) < 2:
        raise HTTPException(status_code=400, detail="At least 2 accounts are required so they can message each other")
    if payload.intervalSeconds < 10:
        raise HTTPException(status_code=400, detail="Interval must be at least 10 seconds")

    existing = WARMUP_TASKS.get(user_id)
    if existing and not existing.done():
        raise HTTPException(status_code=409, detail="Warmup already running for this user")

    task = asyncio.create_task(_run_warmup_worker(
        user_id=user_id,
        account_ids=payload.accountIds,
        interval_seconds=payload.intervalSeconds,
    ))
    WARMUP_TASKS[user_id] = task

    async def _crash_wrapper():
        try:
            await task
        except Exception:
            logger.exception("Warmup task crashed for user %s", user_id)
            WARMUP_TASKS.pop(user_id, None)
            WARMUP_STOP_REQUESTED.discard(user_id)
            WARMUP_STATES.pop(user_id, None)

    asyncio.ensure_future(_crash_wrapper())

    return {"ok": True, "message": "Warmup started"}


@router.post("/api/v1/warmup/stop")
async def warmup_stop(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    WARMUP_STOP_REQUESTED.add(user_id)
    task = WARMUP_TASKS.get(user_id)
    if task and not task.done():
        task.cancel()
    return {"ok": True, "message": "Warmup stopping"}


@router.get("/api/v1/warmup/status")
async def warmup_status(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    task = WARMUP_TASKS.get(user_id)
    running = task is not None and not task.done()
    raw_states = WARMUP_STATES.get(user_id, {})
    meta = raw_states.get("_meta", {}) if isinstance(raw_states, dict) else {}
    states = [v for k, v in raw_states.items() if k != "_meta"]
    stopped_users = user_id in WARMUP_STOP_REQUESTED
    dm_sent = sum(s.get("dmSentToday", 0) for s in states)
    errors = [s for s in states if s.get("lastError")]
    activity = WARMUP_ACTIVITY_LOG.get(user_id, [])
    return {
        "running": running,
        "stopRequested": stopped_users,
        "totalSent": dm_sent,
        "dmSent": dm_sent,
        "accounts": len(states),
        "restingCount": sum(1 for s in states if s.get("state") in ("resting", "cooldown")),
        "errorCount": len(errors),
        "accountStats": states,
        "activity": activity,
        "startedAt": meta.get("startedAt"),
        "intervalSeconds": meta.get("intervalSeconds"),
        "order": meta.get("order", []),
        "rotationOffset": meta.get("rotationOffset"),
    }
