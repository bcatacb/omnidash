from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..core.database import db, now_iso
from ..core.security import current_user_id
from ..core.state import MASS_GROUP_STOP_REQUESTED, MASS_GROUP_TASKS
from ..helpers.mass_group import (
    _default_mass_stats,
    _load_mass_group_row,
    _mass_group_record,
    _touch_mass_group_status,
)
from ..models.schemas import MassGroupRunPayload
from ..services.mass_group_worker import _run_mass_group_worker

router = APIRouter(prefix="")


@router.post("/api/v1/mass-groups/run")
def run_mass_group(payload: MassGroupRunPayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    usernames = [u.strip().lstrip("@") for u in payload.usernames if u and u.strip()]
    if not usernames:
        raise HTTPException(status_code=400, detail="Provide at least one username")
    # de-duplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for u in usernames:
        key = u.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(u)
    usernames = deduped

    if "{username}" not in payload.title_template:
        raise HTTPException(
            status_code=400,
            detail="Title template must contain the {username} placeholder",
        )

    with db() as conn:
        account_rows = conn.execute(
            "SELECT id FROM accounts WHERE user_id = ?", (user_id,)
        ).fetchall()
    all_account_ids = [r["id"] for r in account_rows]
    if not all_account_ids:
        raise HTTPException(status_code=400, detail="No connected accounts available to create groups")

    admin_ids = [a for a in payload.admin_account_ids if a in all_account_ids]

    gid = str(uuid4())
    ts = now_iso()
    stats = _default_mass_stats(usernames)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO mass_group_campaigns (
                id, user_id, name, status, title_template, admin_account_ids_json,
                creator_account_ids_json, usernames_json, delay_seconds, stats_json,
                events_json, failures_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                gid,
                user_id,
                f"Mass Groups {ts[:19]}",
                "idle",
                payload.title_template,
                json.dumps(admin_ids),
                json.dumps(all_account_ids),
                json.dumps(usernames),
                max(0, min(3600, payload.delay_seconds)),
                json.dumps(stats),
                json.dumps([
                    {
                        "at": ts,
                        "type": "campaign_created",
                        "status": "ready",
                        "message": f"Ready to create {len(usernames)} group(s)",
                    }
                ]),
                json.dumps([]),
                ts,
                ts,
            ),
        )
        row = conn.execute("SELECT * FROM mass_group_campaigns WHERE id = ?", (gid,)).fetchone()
    return {"campaign": _mass_group_record(row)}


@router.get("/api/v1/mass-groups/campaigns")
def list_mass_group_campaigns(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM mass_group_campaigns WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    return {"campaigns": [_mass_group_record(r) for r in rows]}


@router.get("/api/v1/mass-groups/campaigns/{campaign_id}")
def get_mass_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM mass_group_campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return {"campaign": _mass_group_record(row)}


@router.post("/api/v1/mass-groups/campaigns/{campaign_id}/start")
async def start_mass_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    existing = MASS_GROUP_TASKS.get(campaign_id)
    if existing and not existing.done():
        row = _load_mass_group_row(campaign_id)
        if not row or row["user_id"] != user_id:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"campaign": _mass_group_record(row)}

    with db() as conn:
        _touch_mass_group_status(conn, campaign_id, user_id, "running")
        conn.execute(
            "UPDATE mass_group_campaigns SET last_started_at = ? WHERE id = ?",
            (now_iso(), campaign_id),
        )
    MASS_GROUP_STOP_REQUESTED.discard(campaign_id)
    MASS_GROUP_TASKS[campaign_id] = asyncio.create_task(_run_mass_group_worker(campaign_id))
    row = _load_mass_group_row(campaign_id)
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return {"campaign": _mass_group_record(row)}


@router.post("/api/v1/mass-groups/campaigns/{campaign_id}/stop")
def stop_mass_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    MASS_GROUP_STOP_REQUESTED.add(campaign_id)
    with db() as conn:
        row = _touch_mass_group_status(conn, campaign_id, user_id, "stopped")
    return {"campaign": _mass_group_record(row)}


@router.delete("/api/v1/mass-groups/campaigns/{campaign_id}")
def delete_mass_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    MASS_GROUP_STOP_REQUESTED.add(campaign_id)
    task = MASS_GROUP_TASKS.get(campaign_id)
    if task and not task.done():
        task.cancel()
    MASS_GROUP_TASKS.pop(campaign_id, None)
    with db() as conn:
        conn.execute(
            "DELETE FROM mass_group_campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        )
    return {"ok": True}
