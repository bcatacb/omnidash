from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.database import db, now_iso
from ..core.security import current_user_id
from ..core.state import (
    GROUP_ADD_PAUSE_REQUESTED,
    GROUP_ADD_STOP_REQUESTED,
    GROUP_ADD_TASKS,
)
from ..models.schemas import ForwardContactsStartPayload
from ..services.forward_contacts_worker import launch_group_add_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="")


def _job_or_404(job_id: str, user_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM group_add_jobs WHERE id = ? AND user_id = ?",
            (job_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Forward job not found")
    return dict(row)


def _job_status_payload(job: dict[str, Any]) -> dict[str, Any]:
    try:
        log = json.loads(job["log_json"]) if job["log_json"] else []
    except Exception:
        log = []
    return {
        "jobId": job["id"],
        "status": job["status"],
        "groupId": job["group_id"],
        "groupTitle": job["group_title"],
        "total": job["total"],
        "processed": job["processed"],
        "forwarded": job["forwarded"],
        "added": job["added"],
        "kicked": job["kicked"],
        "skipped": job["skipped"],
        "failed": job["failed"],
        "error": job["error"],
        "log": log,
        "updatedAt": job["updated_at"],
    }


@router.post("/api/v1/forward-contacts/start")
async def forward_contacts_start(
    payload: ForwardContactsStartPayload,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    if not payload.accountId:
        raise HTTPException(status_code=400, detail="Account is required")
    if not payload.groupId:
        raise HTTPException(status_code=400, detail="Destination group is required")
    if not payload.targets:
        raise HTTPException(status_code=400, detail="No contacts to forward")
    interval = max(1, int(payload.intervalSeconds))

    job_id = uuid.uuid4().hex
    now = now_iso()

    # De-dupe targets by member id within this job.
    seen: set[str] = set()
    target_rows: list[tuple] = []
    for t in payload.targets:
        uid = str(t.userId or "").strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        target_rows.append(
            (job_id, user_id, uid, (t.accessHash or None), (t.fullName or None), now)
        )

    if not target_rows:
        raise HTTPException(status_code=400, detail="No valid contacts to forward")

    with db() as conn:
        conn.execute(
            """
            INSERT INTO group_add_jobs (
                id, user_id, account_id, group_id, group_title, interval_seconds,
                status, total, created_at, updated_at, last_started_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
            """,
            (
                job_id, user_id, payload.accountId, payload.groupId, payload.groupTitle,
                interval, len(target_rows), now, now, now,
            ),
        )
        conn.executemany(
            """
            INSERT OR IGNORE INTO group_add_targets (
                job_id, user_id, member_id, access_hash, full_name, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            target_rows,
        )

    await launch_group_add_job(job_id)
    return {"jobId": job_id, "status": "running", "total": len(target_rows)}


@router.get("/api/v1/forward-contacts/jobs")
async def forward_contacts_jobs(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    """List this user's recent group-add jobs so the UI can reattach after a refresh."""
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM group_add_jobs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20",
            (user_id,),
        ).fetchall()
    return {"jobs": [_job_status_payload(dict(r)) for r in rows]}


@router.get("/api/v1/forward-contacts/{job_id}/status")
async def forward_contacts_status(
    job_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    return _job_status_payload(_job_or_404(job_id, user_id))


@router.get("/api/v1/forward-contacts/{job_id}/targets")
async def forward_contacts_targets(
    job_id: str,
    kind: str = Query(..., pattern="^(passed|failed)$"),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Per-target results for export. passed = forwarded/added; failed = failed/skipped."""
    _job_or_404(job_id, user_id)
    statuses = ("forwarded", "added") if kind == "passed" else ("failed", "skipped")
    placeholders = ",".join("?" for _ in statuses)
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT member_id, full_name, username, phone, status, result
            FROM group_add_targets
            WHERE job_id = ? AND user_id = ? AND status IN ({placeholders})
            ORDER BY id
            """,
            (job_id, user_id, *statuses),
        ).fetchall()
    return {"kind": kind, "targets": [dict(r) for r in rows]}


@router.post("/api/v1/forward-contacts/{job_id}/pause")
async def forward_contacts_pause(
    job_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    _job_or_404(job_id, user_id)
    GROUP_ADD_PAUSE_REQUESTED.add(job_id)
    task = GROUP_ADD_TASKS.get(job_id)
    if task and not task.done():
        task.cancel()
    return {"ok": True, "jobId": job_id, "status": "paused"}


@router.post("/api/v1/forward-contacts/{job_id}/resume")
async def forward_contacts_resume(
    job_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    job = _job_or_404(job_id, user_id)
    if job["status"] not in ("paused", "stopped", "failed"):
        raise HTTPException(status_code=400, detail=f"Job is {job['status']}, cannot resume")
    await launch_group_add_job(job_id)
    return {"ok": True, "jobId": job_id, "status": "running"}


@router.post("/api/v1/forward-contacts/{job_id}/stop")
async def forward_contacts_stop(
    job_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    _job_or_404(job_id, user_id)
    GROUP_ADD_STOP_REQUESTED.add(job_id)
    task = GROUP_ADD_TASKS.get(job_id)
    if task and not task.done():
        task.cancel()
    return {"ok": True, "jobId": job_id, "status": "stopped"}
