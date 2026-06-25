from __future__ import annotations

import asyncio
import json
import random
import sqlite3
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from telethon.tl.functions.channels import LeaveChannelRequest
from telethon.tl.types import Channel, Chat
from telethon.utils import get_display_name

from ..core.database import db, now_iso
from ..core.security import current_user_id
from ..core.state import GROUP_SCRAPER_CANDIDATES, GROUP_SCRAPER_STOP_REQUESTED, GROUP_SCRAPER_TASKS
from ..helpers.campaign import (
    _append_group_event,
    _append_group_failure,
    _apply_live_rest_state,
    _campaign_account_label_map,
    _default_group_stats,
    _group_record,
    _load_group_campaign_row,
    _mark_candidate_result,
    _next_pending_candidate,
    _pending_candidate_count,
    _persist_group_campaign_runtime,
    _replace_group_candidates,
    _touch_group_status,
)
from ..helpers.telegram import (
    _account_session_lock,
    _join_group_reference,
    _open_account_client_for_user,
    _resolve_joinable_entity,
    _message_text,
    _safe_disconnect,
)
from ..models.schemas import GroupDelayPayload, GroupRunPayload
from ..services.group_scraper_worker import _run_group_scraper_worker

router = APIRouter(prefix="")


@router.get("/api/v1/group-scraper/groups")
async def list_groups(
    account_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    lock = _account_session_lock(account_id)
    async with lock:
        try:
            _, client = await _open_account_client_for_user(user_id, account_id)
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Failed to connect account: {str(e)}")
        try:
            dialogs = await client.get_dialogs(limit=limit)
            groups: list[dict[str, Any]] = []
            for dialog in dialogs:
                entity = dialog.entity
                is_channel = isinstance(entity, Channel)
                is_group = isinstance(entity, Chat) or (is_channel and getattr(entity, "megagroup", False))
                if not (is_group or is_channel):
                    continue
                is_channel = isinstance(entity, Channel)

                groups.append(
                    {
                        "id": str(dialog.id),
                        "title": dialog.name or str(dialog.id),
                        "username": getattr(entity, "username", None),
                        "isChannel": is_channel,
                        "isMegagroup": is_channel and bool(getattr(entity, "megagroup", False)),
                    }
                )
                if len(groups) >= limit:
                    break
            return {"groups": groups}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load groups: {str(e)}")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/group-scraper/run")
def run_group(payload: GroupRunPayload, auth_user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    if payload.userId != auth_user_id:
        raise HTTPException(status_code=403, detail="userId does not match current session")
    gid = str(uuid4())
    ts = now_iso()
    labels = _campaign_account_label_map(payload.userId)
    stats = _default_group_stats(payload.inviterAccountIds)
    stats["accountStates"] = [
        {
            **state,
            "accountLabel": labels.get(state["accountId"], state["accountId"]),
        }
        for state in stats.get("accountStates", [])
    ]
    with db() as conn:
        conn.execute(
            """
            INSERT INTO group_scraper_campaigns (
                id, user_id, name, status, source_account_id, inviter_account_ids_json, source_group,
                target_group, max_members, delay_seconds, stats_json, events_json, failures_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                gid,
                payload.userId,
                f"Group Campaign {ts[:19]}",
                "idle",
                payload.sourceAccountId,
                json.dumps(payload.inviterAccountIds),
                payload.sourceGroup,
                payload.targetGroup,
                0,
                payload.delaySeconds,
                json.dumps(stats),
                json.dumps(
                    [
                        {
                            "at": ts,
                            "type": "campaign_created",
                            "status": "ready",
                            "accountId": payload.sourceAccountId,
                            "accountLabel": labels.get(payload.sourceAccountId, payload.sourceAccountId),
                            "group": payload.sourceGroup,
                            "message": "Campaign created and ready",
                        }
                    ]
                ),
                json.dumps([]),
                ts,
                ts,
            ),
        )
        row = conn.execute("SELECT * FROM group_scraper_campaigns WHERE id = ?", (gid,)).fetchone()
        return {"campaign": _group_record(row)}


@router.get("/api/v1/group-scraper/campaigns")
def list_group_campaigns(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        return {"campaigns": [_group_record(r) for r in rows]}


@router.get("/api/v1/group-scraper/campaigns/{campaign_id}")
def get_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"campaign": _group_record(row)}


@router.post("/api/v1/group-scraper/campaigns/{campaign_id}/start")
async def start_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    existing = GROUP_SCRAPER_TASKS.get(campaign_id)
    if existing and not existing.done():
        with db() as conn:
            row = conn.execute(
                "SELECT * FROM group_scraper_campaigns WHERE id = ? AND user_id = ?",
                (campaign_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Campaign not found")
            return {"campaign": _group_record(row)}

    with db() as conn:
        row = _touch_group_status(conn, campaign_id, user_id, "running")
        conn.execute("UPDATE group_scraper_campaigns SET last_started_at = ? WHERE id = ?", (now_iso(), campaign_id))
    GROUP_SCRAPER_STOP_REQUESTED.discard(campaign_id)
    GROUP_SCRAPER_TASKS[campaign_id] = asyncio.create_task(_run_group_scraper_worker(campaign_id))
    row = _load_group_campaign_row(campaign_id)
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return {"campaign": _group_record(row)}


@router.post("/api/v1/group-scraper/campaigns/{campaign_id}/stop")
def stop_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    GROUP_SCRAPER_STOP_REQUESTED.add(campaign_id)
    with db() as conn:
        row = _touch_group_status(conn, campaign_id, user_id, "stopped")
        return {"campaign": _group_record(row)}


@router.post("/api/v1/group-scraper/campaigns/{campaign_id}/leave-groups")
async def leave_groups(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    row = _load_group_campaign_row(campaign_id)
    if not row or row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign = _group_record(row)
    events = campaign["events"] or []
    failures = campaign["failures"] or []
    labels = _campaign_account_label_map(user_id)
    semaphore = asyncio.Semaphore(4)

    async def _leave_one(inviter_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        async with semaphore:
            client = None
            account_label = labels.get(inviter_id, inviter_id)
            try:
                lock = _account_session_lock(inviter_id)
                async with lock:
                    _, client = await _open_account_client_for_user(user_id, inviter_id)
                    entity = await _resolve_joinable_entity(client, campaign["targetGroup"])
                    if isinstance(entity, Chat):
                        await client.delete_dialog(entity)
                    else:
                        await client(LeaveChannelRequest(entity))
                return (
                    {
                        "at": now_iso(),
                        "type": "leave_group",
                        "status": "success",
                        "accountId": inviter_id,
                        "accountLabel": account_label,
                        "group": campaign["targetGroup"],
                        "message": "Left target group",
                    },
                    None,
                )
            except Exception as exc:
                return (
                    None,
                    {
                        "accountId": inviter_id,
                        "accountLabel": account_label,
                        "member": campaign["targetGroup"],
                        "reason": str(exc)[:500],
                        "at": now_iso(),
                    },
                )
            finally:
                if client is not None:
                    try:
                        await _safe_disconnect(client)
                    except Exception:
                        pass

    leave_results = await asyncio.gather(*[_leave_one(inviter_id) for inviter_id in campaign["inviterAccountIds"]])
    for event, failure in leave_results:
        if event:
            events = _append_group_event(events, event)
        if failure:
            failures = _append_group_failure(failures, failure)
    updated = _persist_group_campaign_runtime(campaign_id, events=events, failures=failures)
    return {"campaign": _group_record(updated)}


@router.post("/api/v1/group-scraper/campaigns/{campaign_id}/join-groups")
async def join_groups(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    row = _load_group_campaign_row(campaign_id)
    if not row or row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign = _group_record(row)
    events = campaign["events"] or []
    failures = campaign["failures"] or []
    labels = _campaign_account_label_map(user_id)
    joined = 0
    for inviter_id in campaign["inviterAccountIds"]:
        try:
            lock = _account_session_lock(inviter_id)
            async with lock:
                _, client = await _open_account_client_for_user(user_id, inviter_id)
                try:
                    await _join_group_reference(client, campaign["sourceGroup"])
                    await _join_group_reference(client, campaign["targetGroup"])
                finally:
                    await _safe_disconnect(client)
            joined += 1
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "join_group",
                    "status": "joined",
                    "accountId": inviter_id,
                    "accountLabel": labels.get(inviter_id, inviter_id),
                    "group": campaign["targetGroup"],
                    "message": "Joined source and target groups",
                },
            )
        except Exception as exc:
            failures = _append_group_failure(
                failures,
                {
                    "accountId": inviter_id,
                    "accountLabel": labels.get(inviter_id, inviter_id),
                    "member": campaign["targetGroup"],
                    "reason": str(exc)[:500],
                    "at": now_iso(),
                },
            )
        await asyncio.sleep(random.uniform(1.5, 4.5))
    for inviter_id in campaign["inviterAccountIds"]:
        scraped_members: list[dict[str, Any]] = []
        try:
            scrape_lock = _account_session_lock(inviter_id)
            async with scrape_lock:
                _, scrape_client = await _open_account_client_for_user(user_id, inviter_id)
                try:
                    source_entity = await _resolve_joinable_entity(scrape_client, campaign["sourceGroup"])
                    async for participant in scrape_client.iter_participants(source_entity):
                        if getattr(participant, "bot", False) or getattr(participant, "deleted", False):
                            continue
                        scraped_members.append(
                            {
                                "member_id": int(participant.id),
                                "access_hash": getattr(participant, "access_hash", None),
                                "username": getattr(participant, "username", None),
                                "display_name": get_display_name(participant) or str(participant.id),
                            }
                        )
                finally:
                    await _safe_disconnect(scrape_client)
            scraped_count = _replace_group_candidates(campaign_id, user_id, inviter_id, scraped_members)
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "scrape_done",
                    "status": "done",
                    "accountId": inviter_id,
                    "accountLabel": labels.get(inviter_id, inviter_id),
                    "group": campaign["sourceGroup"],
                    "message": f"Scraped {scraped_count} source members for invite phase",
                    "scrapedCount": scraped_count,
                    "totalScraped": scraped_count,
                },
            )
        except Exception as exc:
            failures = _append_group_failure(
                failures,
                {
                    "accountId": inviter_id,
                    "accountLabel": labels.get(inviter_id, inviter_id),
                    "member": campaign["sourceGroup"],
                    "reason": f"Scrape failed: {str(exc)[:500]}",
                    "at": now_iso(),
                },
            )
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "scrape_failed",
                    "status": "failed",
                    "accountId": inviter_id,
                    "accountLabel": labels.get(inviter_id, inviter_id),
                    "group": campaign["sourceGroup"],
                    "message": f"Failed scraping source members: {exc}",
                },
            )
        await asyncio.sleep(random.uniform(2, 5))

    stats = campaign["stats"] or _default_group_stats(campaign["inviterAccountIds"])
    stats["joinedAccounts"] = joined
    pending_count = _pending_candidate_count(campaign_id)
    if pending_count > 0:
        stats["scrapedCount"] = pending_count
        stats["totalCandidates"] = pending_count
        stats["remainingCandidates"] = pending_count
        stats["activePhase"] = "ready"
        stats["activeGroup"] = campaign["targetGroup"]
        account_states = stats.get("accountStates") or []
        for item in account_states:
            item["pendingCandidates"] = _pending_candidate_count(campaign_id, item.get("accountId"))
        stats["accountStates"] = account_states

    updated = _persist_group_campaign_runtime(
        campaign_id,
        status="ready" if pending_count > 0 else None,
        stats=stats,
        events=events,
        failures=failures,
    )
    return {"campaign": _group_record(updated)}


@router.put("/api/v1/group-scraper/campaigns/{campaign_id}/delay")
def update_delay(
    campaign_id: str, payload: GroupDelayPayload, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with db() as conn:
        conn.execute(
            """
            UPDATE group_scraper_campaigns
            SET delay_seconds = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (max(0, min(3600, payload.delaySeconds)), now_iso(), campaign_id, user_id),
        )
        row = conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"campaign": _group_record(row)}


@router.delete("/api/v1/group-scraper/campaigns/{campaign_id}")
def delete_group_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    GROUP_SCRAPER_STOP_REQUESTED.add(campaign_id)
    task = GROUP_SCRAPER_TASKS.get(campaign_id)
    if task and not task.done():
        task.cancel()
    GROUP_SCRAPER_TASKS.pop(campaign_id, None)
    with db() as conn:
        conn.execute(
            "DELETE FROM group_scraper_campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        )
        conn.execute("DELETE FROM group_scraper_candidates WHERE campaign_id = ? AND user_id = ?", (campaign_id, user_id))
        return {"ok": True}
