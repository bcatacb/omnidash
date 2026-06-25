from __future__ import annotations

import asyncio
import json
import random
import traceback
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from telethon import TelegramClient
from telethon.tl import functions
from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest
from telethon.tl.functions.messages import GetPeerDialogsRequest
from telethon.tl.types import (
    Chat,
    InputDialogPeer,
    InputPeerChat,
    InputPeerChannel,
    InputPeerUser,
    UserStatusEmpty,
    UserStatusLastMonth,
    UserStatusLastWeek,
    UserStatusOffline,
    UserStatusOnline,
    UserStatusRecently,
)

from ..core.database import db, db_write, now_iso
from ..core.security import current_user_id
from ..core.state import (
    CAMPAIGN_PAUSE_REQUESTED,
    CAMPAIGN_SCRAPED_MEMBERS,
    CAMPAIGN_STOP_REQUESTED,
    CAMPAIGN_TASK_LOCK,
    CAMPAIGN_TASKS,
)
from ..helpers.campaign import (
    _campaign_account_label_map,
    _set_campaign_status,
    _start_response,
    _update_campaign_status,
    campaign_to_record,
    check_replied,
    successful_leads,
)
from ..helpers.telegram import (
    _account_session_lock,
    _safe_disconnect,
    _open_account_client_for_user,
    _resolve_entity,
    _message_to_item,
)
from ..models.schemas import CampaignPayload, ConnectedAccount
from ..services.campaign_worker import _campaign_done_callback, _run_campaign_worker

router = APIRouter(prefix="")


def _last_seen_from_status(status: Any) -> str | None:
    now = datetime.now(UTC)
    if isinstance(status, UserStatusOnline):
        return now.isoformat()
    if isinstance(status, UserStatusOffline):
        return status.was_online.isoformat() if status.was_online else None
    if isinstance(status, UserStatusRecently):
        return (now - timedelta(hours=1)).isoformat()
    if isinstance(status, UserStatusLastWeek):
        return (now - timedelta(days=3)).isoformat()
    if isinstance(status, UserStatusLastMonth):
        return (now - timedelta(days=15)).isoformat()
    return None


@router.get("/api/v1/campaigns")
def list_campaigns(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        return {"campaigns": [campaign_to_record(r) for r in rows]}


@router.get("/api/v1/campaigns/leads")
def campaign_leads(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, last_run_summary_json FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    leads: list[dict[str, Any]] = []
    account_ids: set[str] = set()
    for row in rows:
        if not row["last_run_summary_json"]:
            continue
        summary = json.loads(row["last_run_summary_json"])
        # Unique successfully-contacted leads only — failed sends are hidden from the list.
        sent_items = successful_leads(summary.get("sentItems", []))
        for item in sent_items:
            aid = item.get("accountId")
            if aid:
                account_ids.add(aid)
            leads.append(
                {
                    "campaignId": row["id"],
                    "campaignName": row["name"],
                    "target": item.get("target", "Unknown"),
                    "chatId": item.get("chatId"),
                    "accountId": aid,
                    "accountLabel": item.get("accountLabel"),
                    "sentAt": item.get("sentAt"),
                    "replied": item.get("replied", False),
                    "replyMessages": item.get("replyMessages", 0),
                    "lastReplyAt": item.get("lastReplyAt"),
                    "error": item.get("error"),
                    "success": item.get("success", True) is not False,
                }
            )
    if account_ids:
        with db() as conn:
            placeholders = ",".join("?" for _ in account_ids)
            rows_acc = conn.execute(
                f"SELECT id, display_name, username FROM accounts WHERE id IN ({placeholders})",
                list(account_ids),
            ).fetchall()
        name_map: dict[str, str] = {}
        for r in rows_acc:
            name_map[r["id"]] = r["display_name"] or r["username"] or r["id"][:8]
        for lead in leads:
            aid = lead.get("accountId")
            if aid and aid in name_map:
                lead["accountLabel"] = name_map[aid]
    leads.sort(key=lambda x: x["sentAt"] or "", reverse=True)
    return {"leads": leads}


@router.get("/api/v1/campaigns/conversations")
def campaign_conversations(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, last_run_summary_json FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    conversations: list[dict[str, Any]] = []
    account_ids: set[str] = set()
    for row in rows:
        if not row["last_run_summary_json"]:
            continue
        summary = json.loads(row["last_run_summary_json"])
        sent_items = summary.get("sentItems", [])
        for item in sent_items:
            if not item.get("replied") or item.get("success") is False:
                continue
            aid = item.get("accountId")
            if aid:
                account_ids.add(aid)
            conversations.append(
                {
                    "campaignId": row["id"],
                    "campaignName": row["name"],
                    "target": item.get("target", "Unknown"),
                    "chatId": item.get("chatId"),
                    "accountId": aid,
                    "accountLabel": item.get("accountLabel"),
                    "sentAt": item.get("sentAt"),
                    "replied": True,
                    "replyMessages": item.get("replyMessages", 0),
                    "lastReplyAt": item.get("lastReplyAt"),
                    "error": item.get("error"),
                    "success": item.get("success", True),
                }
            )
    if account_ids:
        with db() as conn:
            placeholders = ",".join("?" for _ in account_ids)
            rows_acc = conn.execute(
                f"SELECT id, display_name, username FROM accounts WHERE id IN ({placeholders})",
                list(account_ids),
            ).fetchall()
        name_map: dict[str, str] = {}
        for r in rows_acc:
            name_map[r["id"]] = r["display_name"] or r["username"] or r["id"][:8]
        for conv in conversations:
            aid = conv.get("accountId")
            if aid and aid in name_map:
                conv["accountLabel"] = name_map[aid]
    conversations.sort(key=lambda x: x["lastReplyAt"] or "", reverse=True)
    return {"conversations": conversations}


@router.post("/api/v1/campaigns")
def create_campaign(payload: CampaignPayload, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    cid = str(uuid4())
    ts = now_iso()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO campaigns (
                id, user_id, name, status, account_ids_json, daily_message_limit_per_account,
                messages_json, targets_csv, created_at, updated_at, source_group,
                blacklisted_users_json, message_interval_seconds, campaign_type,
                sort_by_activity, skip_messaged, followup_config_json, source_folder,
                resolution_group, folder_filter_tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid,
                user_id,
                payload.name.strip(),
                "draft",
                json.dumps(payload.accountIds),
                payload.dailyMessageLimitPerAccount,
                json.dumps(payload.messages),
                payload.targetsCsv,
                ts,
                ts,
                payload.sourceGroup,
                json.dumps(payload.blacklistedUsers or []),
                payload.messageIntervalSeconds,
                payload.campaignType,
                payload.sortByActivity,
                int(payload.skipMessaged),
                json.dumps(payload.followUp.dict()) if payload.followUp else None,
                payload.sourceFolder,
                payload.resolutionGroup,
                json.dumps(payload.folderFilterTags or []),
            ),
        )
        row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (cid,)).fetchone()
        return {"campaign": campaign_to_record(row)}


@router.put("/api/v1/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str, payload: CampaignPayload, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with db() as conn:
        exists = conn.execute(
            "SELECT id FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Campaign not found")
        conn.execute(
            """
            UPDATE campaigns
            SET name = ?, account_ids_json = ?, daily_message_limit_per_account = ?,
                messages_json = ?, targets_csv = ?, updated_at = ?,
                source_group = ?, source_folder = ?, resolution_group = ?, blacklisted_users_json = ?,
                message_interval_seconds = ?, campaign_type = ?,
                sort_by_activity = ?, skip_messaged = ?, followup_config_json = ?,
                folder_filter_tags_json = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                payload.name.strip(),
                json.dumps(payload.accountIds),
                payload.dailyMessageLimitPerAccount,
                json.dumps(payload.messages),
                payload.targetsCsv,
                now_iso(),
                payload.sourceGroup,
                payload.sourceFolder,
                payload.resolutionGroup,
                json.dumps(payload.blacklistedUsers or []),
                payload.messageIntervalSeconds,
                payload.campaignType,
                payload.sortByActivity,
                int(payload.skipMessaged),
                json.dumps(payload.followUp.dict()) if payload.followUp else None,
                json.dumps(payload.folderFilterTags or []),
                campaign_id,
                user_id,
            ),
        )
        row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
        return {"campaign": campaign_to_record(row)}


@router.delete("/api/v1/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    CAMPAIGN_STOP_REQUESTED.add(campaign_id)
    async with CAMPAIGN_TASK_LOCK:
        task = CAMPAIGN_TASKS.get(campaign_id)
        if task and not task.done():
            task.cancel()
        CAMPAIGN_TASKS.pop(campaign_id, None)
    with db() as conn:
        conn.execute("DELETE FROM campaigns WHERE id = ? AND user_id = ?", (campaign_id, user_id))
        return {"ok": True}


@router.post("/api/v1/campaigns/{campaign_id}/start")
async def start_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    # Clear any stale stop/pause flags left from a prior run that ended without its worker
    # finally clearing them; otherwise this run's finally would mislabel its terminal status.
    CAMPAIGN_STOP_REQUESTED.discard(campaign_id)
    CAMPAIGN_PAUSE_REQUESTED.discard(campaign_id)
    previous_summary: dict[str, Any] | None = None
    with db() as conn:
        prev_row = conn.execute(
            "SELECT status, last_run_summary_json FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if prev_row and prev_row["last_run_summary_json"]:
            try:
                previous_summary = json.loads(prev_row["last_run_summary_json"])
            except Exception:
                pass
        row = _set_campaign_status(conn, campaign_id, user_id, "running")
        record = campaign_to_record(row)
        summary = _start_response(record, previous_summary)
        if previous_summary is not None:
            conn.execute(
                "UPDATE campaigns SET last_run_summary_json = ? WHERE id = ?",
                (json.dumps(summary), campaign_id),
            )
    async with CAMPAIGN_TASK_LOCK:
        existing = CAMPAIGN_TASKS.get(campaign_id)
        if existing and not existing.done():
            existing.cancel()
        task = asyncio.create_task(_run_campaign_worker(campaign_id, previous_summary))
        CAMPAIGN_TASKS[campaign_id] = task

    task.add_done_callback(_campaign_done_callback(campaign_id))
    return summary


@router.post("/api/v1/campaigns/{campaign_id}/pause")
async def pause_campaign(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    CAMPAIGN_STOP_REQUESTED.add(campaign_id)
    # Mark this as a pause (not a plain stop) so the worker's finally cleanup writes the
    # terminal status 'paused' instead of 'stopped' even if it races this endpoint.
    CAMPAIGN_PAUSE_REQUESTED.add(campaign_id)
    async with CAMPAIGN_TASK_LOCK:
        task = CAMPAIGN_TASKS.get(campaign_id)
        if task and not task.done():
            task.cancel()
        CAMPAIGN_TASKS.pop(campaign_id, None)
    with db() as conn:
        row = conn.execute(
            "SELECT status FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        status = "paused" if row["status"] == "running" else row["status"]
        conn.execute(
            "UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (status, now_iso(), campaign_id, user_id),
        )
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        return {"campaign": campaign_to_record(row)}


@router.post("/api/v1/campaigns/{campaign_id}/remove-unresolved")
def remove_unresolved(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"campaign": campaign_to_record(row)}


@router.post("/api/v1/campaigns/{campaign_id}/remove-previously-messaged")
def remove_previously_messaged(
    campaign_id: str, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    return remove_unresolved(campaign_id, user_id)


@router.post("/api/v1/campaigns/{campaign_id}/refresh-unresolved")
def refresh_unresolved(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    return remove_unresolved(campaign_id, user_id)


@router.get("/api/v1/campaigns/{campaign_id}/reply-stats")
async def reply_stats(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
    summary = record.get("lastRunSummary") or {}
    sent_items = list(summary.get("sentItems") or [])

    # Reply info computed this run, keyed by (accountId, chatId-or-target). Merged onto the
    # latest summary at write time so a concurrently-running worker isn't clobbered.
    reply_info: dict[tuple[str, str], dict[str, Any]] = {}

    # Group successful, resolvable items by account so we open ONE client per account instead
    # of reconnecting per lead. The old per-lead connect/disconnect storm was slow and caused
    # request timeouts / "server closed the connection", so replies often never got recorded.
    by_account: dict[str, list[dict[str, Any]]] = {}
    for item in sent_items:
        if item.get("success") is False:
            continue
        account_id = item.get("accountId")
        chat_id = item.get("chatId") or item.get("target")
        if not account_id or not chat_id:
            continue
        by_account.setdefault(account_id, []).append(item)

    reply_stats_errors: list[str] = []
    for account_id, items in by_account.items():
        lock = _account_session_lock(account_id)
        async with lock:
            client: TelegramClient | None = None
            try:
                _, client = await _open_account_client_for_user(user_id, account_id)
                for item in items:
                    chat_id = item.get("chatId") or item.get("target")
                    key = (account_id, str(chat_id))
                    sent_at_raw = item.get("sentAt")
                    sent_at = None
                    if sent_at_raw:
                        try:
                            sent_at = datetime.fromisoformat(str(sent_at_raw)).astimezone(UTC)
                        except Exception:
                            sent_at = None
                    message_id = int(item.get("messageId") or 0)
                    try:
                        access_hash = item.get("accessHash")
                        if access_hash:
                            entity = InputPeerUser(user_id=int(chat_id), access_hash=int(access_hash))
                        else:
                            entity = await _resolve_entity(client, str(chat_id))
                        _, reply_count, last_reply_at = await asyncio.wait_for(
                            check_replied(client, entity, message_id, sent_at), timeout=20
                        )
                        reply_info[key] = {
                            "replied": reply_count > 0,
                            "replyMessages": reply_count,
                            "lastReplyAt": last_reply_at,
                        }
                    except Exception as exc:
                        msg = f"[REPLY_STATS] check failed campaign={campaign_id} account={account_id} chat={chat_id}: {exc}"
                        print(msg)
                        reply_stats_errors.append(msg)
                        # Don't clear a real reply just because this refresh couldn't reach the
                        # peer — preserve whatever was already recorded on the item.
                        if item.get("replied"):
                            reply_info[key] = {
                                "replied": True,
                                "replyMessages": item.get("replyMessages", 0),
                                "lastReplyAt": item.get("lastReplyAt"),
                            }
            except Exception as exc:
                msg = f"[REPLY_STATS] account open failed campaign={campaign_id} account={account_id}: {exc}"
                print(msg)
                reply_stats_errors.append(msg)
            finally:
                await _safe_disconnect(client)

    def _merge(conn) -> dict[str, Any]:
        cur = conn.execute(
            "SELECT last_run_summary_json FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        latest: dict[str, Any] = {}
        if cur and cur["last_run_summary_json"]:
            try:
                latest = json.loads(cur["last_run_summary_json"])
            except Exception:
                latest = {}
        latest_items = latest.get("sentItems") or sent_items
        merged_items: list[dict[str, Any]] = []
        for it in latest_items:
            if it.get("success") is False:
                merged_items.append({**it, "replied": False, "replyMessages": 0, "lastReplyAt": None})
                continue
            k = (it.get("accountId"), str(it.get("chatId") or it.get("target")))
            info = reply_info.get(k)
            merged_items.append({**it, **info} if info is not None else it)

        account_rollup: dict[str, dict[str, Any]] = {}
        for it in merged_items:
            aid = it.get("accountId")
            if not aid or not it.get("replied"):
                continue
            r = account_rollup.setdefault(aid, {"repliedTargets": 0, "replyMessages": 0, "lastReplyAt": None})
            r["repliedTargets"] += 1
            r["replyMessages"] += int(it.get("replyMessages") or 0)
            lra = it.get("lastReplyAt")
            if lra and (not r["lastReplyAt"] or lra > r["lastReplyAt"]):
                r["lastReplyAt"] = lra

        merged_account_stats = []
        for st in latest.get("accountStats") or []:
            r = account_rollup.get(st.get("accountId"))
            merged_account_stats.append(
                {**st, **r} if r else {**st, "repliedTargets": 0, "replyMessages": 0, "lastReplyAt": None}
            )

        replied = sum(1 for it in merged_items if it.get("replied"))
        reply_msgs = sum(int(it.get("replyMessages") or 0) for it in merged_items)
        latest["sentItems"] = merged_items
        latest["accountStats"] = merged_account_stats
        latest["repliedTargets"] = replied
        latest["replyMessages"] = reply_msgs
        latest["lastReplyAt"] = max([it.get("lastReplyAt") or "" for it in merged_items], default="") or None
        for err in reply_stats_errors:
            latest.setdefault("activityLog", []).append({
                "at": now_iso(), "type": "reply_stats_error",
                "accountId": "", "accountLabel": "", "target": "",
                "message": err,
            })
        conn.execute(
            "UPDATE campaigns SET last_run_summary_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (json.dumps(latest), now_iso(), campaign_id, user_id),
        )
        return {
            "targetStats": merged_items,
            "accountStats": merged_account_stats,
            "repliedTargets": replied,
            "replyMessages": reply_msgs,
        }

    merged = db_write(_merge)
    return {
        "ok": True,
        "campaignId": campaign_id,
        "generatedAt": now_iso(),
        "totalSent": len(merged["targetStats"]),
        "repliedTargets": merged["repliedTargets"],
        "unrepliedTargets": max(0, len(merged["targetStats"]) - merged["repliedTargets"]),
        "replyMessages": merged["replyMessages"],
        "accountStats": merged["accountStats"],
        "targetStats": merged["targetStats"],
    }


@router.get("/api/v1/campaigns/{campaign_id}/leads")
def campaign_leads_by_id(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT id, name, last_run_summary_json FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not row["last_run_summary_json"]:
        return {"leads": []}
    summary = json.loads(row["last_run_summary_json"])
    # Unique successfully-contacted leads only — failed sends are hidden from the list.
    sent_items = successful_leads(summary.get("sentItems", []))
    seen_map: dict[str, dict[str, Any]] = {}
    if sent_items:
        with db() as conn:
            seen_rows = conn.execute(
                """
                SELECT account_id, chat_id, message_id, seen, seen_at
                FROM campaign_seen
                WHERE campaign_id = ? AND user_id = ?
                """,
                (campaign_id, user_id),
            ).fetchall()
        for sr in seen_rows:
            key = f"{sr['account_id']}::{sr['chat_id']}::{sr['message_id']}"
            seen_map[key] = {"seen": bool(sr["seen"]), "seenAt": sr["seen_at"]}
    leads: list[dict[str, Any]] = []
    for item in sent_items:
        aid = item.get("accountId")
        chat_id = item.get("chatId")
        msg_id = item.get("messageId")
        skey = f"{aid}::{chat_id}::{msg_id}"
        s = seen_map.get(skey, {})
        leads.append({
            "campaignId": row["id"],
            "campaignName": row["name"],
            "target": item.get("target", "Unknown"),
            "chatId": chat_id,
            "accountId": aid,
            "accountLabel": item.get("accountLabel"),
            "sentAt": item.get("sentAt"),
            "replied": item.get("replied", False),
            "replyMessages": item.get("replyMessages", 0),
            "lastReplyAt": item.get("lastReplyAt"),
            "error": item.get("error"),
            "success": item.get("success", True) is not False,
            "seen": s.get("seen", False),
            "seenAt": s.get("seenAt"),
        })
    account_ids = {l["accountId"] for l in leads if l.get("accountId")}
    if account_ids:
        with db() as conn:
            placeholders = ",".join("?" for _ in account_ids)
            rows_acc = conn.execute(
                f"SELECT id, display_name, username FROM accounts WHERE id IN ({placeholders})",
                list(account_ids),
            ).fetchall()
        name_map: dict[str, str] = {r["id"]: r["display_name"] or r["username"] or r["id"][:8] for r in rows_acc}
        for lead in leads:
            aid = lead.get("accountId")
            if aid and aid in name_map:
                lead["accountLabel"] = name_map[aid]
    leads.sort(key=lambda x: x["sentAt"] or "", reverse=True)
    return {"leads": leads}


@router.post("/api/v1/campaigns/{campaign_id}/seen-stats")
async def seen_stats(campaign_id: str, user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
    summary = record.get("lastRunSummary") or {}
    sent_items = list(summary.get("sentItems") or [])
    if not sent_items:
        return {"ok": True, "campaignId": campaign_id, "seen": 0, "total": 0}

    seen_count = 0
    checked_at = now_iso()
    by_account: dict[str, list[dict[str, Any]]] = {}
    for item in sent_items:
        aid = item.get("accountId")
        if not aid:
            continue
        by_account.setdefault(aid, []).append(item)

    for account_id, items in by_account.items():
        peer_map: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            chat_id = item.get("chatId") or item.get("target")
            if not chat_id:
                continue
            peer_map.setdefault(str(chat_id), []).append(item)

        lock = _account_session_lock(account_id)
        async with lock:
            client: TelegramClient | None = None
            try:
                _, client = await _open_account_client_for_user(user_id, account_id)
                input_peers: list[InputDialogPeer] = []
                chat_to_input: dict[str, Any] = {}
                for chat_id_str in peer_map:
                    try:
                        entity = await _resolve_entity(client, chat_id_str)
                        if hasattr(entity, 'id'):
                            input_peer = InputPeerUser(user_id=entity.id, access_hash=getattr(entity, 'access_hash', 0))
                            if hasattr(entity, 'chat_id'):
                                input_peer = InputPeerChat(chat_id=entity.id)
                            elif hasattr(entity, 'broadcast') or hasattr(entity, 'megagroup') or hasattr(entity, 'gigagroup'):
                                input_peer = InputPeerChannel(channel_id=entity.id, access_hash=getattr(entity, 'access_hash', 0))
                            input_peers.append(InputDialogPeer(peer=input_peer))
                            chat_to_input[chat_id_str] = input_peer
                    except Exception:
                        pass
                if input_peers:
                    try:
                        dialogs_result = await client(GetPeerDialogsRequest(peers=input_peers))
                        read_max: dict[str, int] = {}
                        for i, dlg in enumerate(dialogs_result.dialogs):
                            if i < len(input_peers):
                                chat_id_str = list(peer_map.keys())[i]
                                read_max[chat_id_str] = getattr(dlg, 'read_inbox_max_id', 0)
                        for chat_id_str, chat_items in peer_map.items():
                            max_read = read_max.get(chat_id_str, 0)

                            def _write_seen(conn, chat_items=chat_items, max_read=max_read, chat_id_str=chat_id_str):
                                local_seen = 0
                                for item in chat_items:
                                    msg_id = int(item.get("messageId") or 0)
                                    if msg_id > 0 and msg_id <= max_read:
                                        local_seen += 1
                                        conn.execute(
                                            """
                                            INSERT INTO campaign_seen (id, user_id, campaign_id, account_id, chat_id, message_id, seen, seen_at, checked_at)
                                            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                                            ON CONFLICT(campaign_id, account_id, chat_id, message_id)
                                            DO UPDATE SET seen = 1, seen_at = COALESCE(seen_at, ?), checked_at = ?
                                            """,
                                            (str(uuid4()), user_id, campaign_id, account_id, chat_id_str, msg_id, checked_at, checked_at, checked_at, checked_at),
                                        )
                                    else:
                                        conn.execute(
                                            """
                                            INSERT INTO campaign_seen (id, user_id, campaign_id, account_id, chat_id, message_id, seen, seen_at, checked_at)
                                            VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
                                            ON CONFLICT(campaign_id, account_id, chat_id, message_id)
                                            DO UPDATE SET seen = seen, seen_at = seen_at, checked_at = ?
                                            """,
                                            (str(uuid4()), user_id, campaign_id, account_id, chat_id_str, msg_id, checked_at, checked_at),
                                        )
                                return local_seen

                            seen_count += db_write(_write_seen)
                    except Exception as exc:
                        print(f"[SEEN_STATS] GetPeerDialogs failed for account={account_id}: {exc}")
            except Exception as exc:
                print(f"[SEEN_STATS] Failed for campaign={campaign_id} account={account_id}: {exc}")
            finally:
                await _safe_disconnect(client)
    return {
        "ok": True,
        "campaignId": campaign_id,
        "generatedAt": checked_at,
        "seen": seen_count,
        "total": len(sent_items),
    }


@router.post("/api/v1/campaigns/{campaign_id}/scrape-group-members")
async def scrape_group_members_for_campaign(
    campaign_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
        source_group = record.get("sourceGroup")
        if not source_group:
            raise HTTPException(status_code=400, detail="No source group set for this campaign")
        account_ids = record["accountIds"]
        if not account_ids:
            raise HTTPException(status_code=400, detail="No accounts assigned to this campaign")
        source_account_id = account_ids[0]
    print(f"[DEBUG] Scraping members for campaign {campaign_id} using account {source_account_id}")
    lock = _account_session_lock(source_account_id)
    async with lock:
        try:
            _, client = await _open_account_client_for_user(user_id, source_account_id)
        except Exception as e:
            print(f"[ERROR] Failed to open client: {e}")
            raise HTTPException(status_code=401, detail=f"Failed to connect to source account: {str(e)}")
        try:
            max_members = 10000
            entity = await _resolve_entity(client, source_group)
            members = []
            async for participant in client.iter_participants(entity, limit=max_members):
                if getattr(participant, "bot", False) or getattr(participant, "deleted", False):
                    continue
                display_name = ""
                if participant.first_name:
                    display_name = participant.first_name + " " + (participant.last_name or "")
                members.append({
                    "userId": str(participant.id),
                    "username": getattr(participant, "username", None),
                    "displayName": display_name.strip(),
                    "accessHash": str(getattr(participant, "access_hash", "")),
                    "lastSeen": _last_seen_from_status(getattr(participant, "status", None)),
                })
                if len(members) >= max_members:
                    break
            CAMPAIGN_SCRAPED_MEMBERS[campaign_id] = members
            with db() as conn:
                conn.execute(
                    "UPDATE campaigns SET scraped_targets_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(members), now_iso(), campaign_id),
                )
            blacklisted = record.get("blacklistedUsers", [])
            filtered_members = [m for m in members if m["userId"] not in blacklisted and (m["username"] or "") not in blacklisted]
            print(f"[DEBUG] Found {len(members)} members, {len(filtered_members)} after blacklist")
            return {
                "ok": True,
                "campaignId": campaign_id,
                "totalMembers": len(members),
                "filteredMembers": len(filtered_members),
                "blacklistedCount": len(members) - len(filtered_members),
                "members": filtered_members[:100],
            }
        except Exception as e:
            print(f"[ERROR] Failed to scrape members: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to scrape members: {str(e)}")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/campaigns/{campaign_id}/scrape-contacts")
async def scrape_contacts_for_campaign(
    campaign_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
        account_ids = record["accountIds"]
        if not account_ids:
            raise HTTPException(status_code=400, detail="No accounts assigned to this campaign")
        source_account_id = account_ids[0]
    print(f"[DEBUG] Scraping contacts for campaign {campaign_id} using account {source_account_id}")
    lock = _account_session_lock(source_account_id)
    async with lock:
        try:
            _, client = await _open_account_client_for_user(user_id, source_account_id)
        except Exception as e:
            print(f"[ERROR] Failed to open client: {e}")
            raise HTTPException(status_code=401, detail=f"Failed to connect to account: {str(e)}")
        try:
            result = await client(functions.contacts.GetContactsRequest(0))
            contacts = result.users if result else []
            members = []
            for c in contacts:
                if getattr(c, "bot", False) or getattr(c, "deleted", False):
                    continue
                display_name = ""
                if c.first_name:
                    display_name = c.first_name + " " + (c.last_name or "")
                phone = getattr(c, "phone", None)
                members.append({
                    "userId": str(c.id),
                    "username": getattr(c, "username", None),
                    "displayName": display_name.strip(),
                    "phone": phone or "",
                    "accessHash": str(getattr(c, "access_hash", "")),
                    "lastSeen": _last_seen_from_status(getattr(c, "status", None)),
                })
            CAMPAIGN_SCRAPED_MEMBERS[campaign_id] = members
            with db() as conn:
                conn.execute(
                    "UPDATE campaigns SET scraped_targets_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(members), now_iso(), campaign_id),
                )
            total_contacts = len(members)
            print(f"[DEBUG] Found {total_contacts} contacts")
            return {
                "ok": True,
                "campaignId": campaign_id,
                "totalContacts": total_contacts,
                "contacts": members[:100],
            }
        except Exception as e:
            print(f"[ERROR] Failed to scrape contacts: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to scrape contacts: {str(e)}")
        finally:
            await _safe_disconnect(client)


@router.post("/api/v1/campaigns/{campaign_id}/load-folder-targets")
async def load_folder_targets_for_campaign(
    campaign_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
        source_folder = record.get("sourceFolder")
        if not source_folder:
            raise HTTPException(status_code=400, detail="No source folder set for this campaign")
        folder_chats = conn.execute(
            "SELECT account_id, chat_id, username, display_name, access_hash, filter_tag FROM folder_chats WHERE folder_id = ?",
            (source_folder,),
        ).fetchall()
    valid_filter_tags = {"excluded", "important", "known", "caution"}
    selected_tags = {t for t in (record.get("folderFilterTags") or []) if t in valid_filter_tags}
    members = []
    for fc in folder_chats:
        if selected_tags and fc["filter_tag"] not in selected_tags:
            continue
        members.append({
            "userId": str(fc["chat_id"]),
            "username": fc["username"],
            "displayName": fc["display_name"],
            "accessHash": fc["access_hash"],
            "ownerAccountId": fc["account_id"],
            "lastSeen": None,
        })
    with db() as conn:
        conn.execute(
            "UPDATE campaigns SET scraped_targets_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(members), now_iso(), campaign_id),
        )
    blacklisted = record.get("blacklistedUsers", [])
    filtered_members = [m for m in members if m["userId"] not in blacklisted and (m["username"] or "") not in blacklisted]
    return {
        "ok": True,
        "campaignId": campaign_id,
        "totalMembers": len(members),
        "filteredMembers": len(filtered_members),
        "blacklistedCount": len(members) - len(filtered_members),
        "appliedFilterTags": sorted(selected_tags),
        "members": filtered_members[:100],
    }


@router.post("/api/v1/campaigns/{campaign_id}/join-group")
async def join_group_for_campaign(
    campaign_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
        source_group = record.get("sourceGroup")
        if not source_group:
            raise HTTPException(status_code=400, detail="No source group set for this campaign")
        account_ids = record["accountIds"]
    print(f"[JOIN_DEBUG] Joining group {source_group} with accounts: {account_ids}")
    results = []
    for account_id in account_ids:
        print(f"[JOIN_DEBUG] Processing account {account_id}...")
        try:
            lock = _account_session_lock(account_id)
            async with lock:
                print(f"[JOIN_DEBUG] Acquired lock for {account_id}, opening client...")
                _, client = await _open_account_client_for_user(user_id, account_id)
                print(f"[JOIN_DEBUG] Client opened for {account_id}")
                try:
                    entity = await _resolve_entity(client, source_group)
                    print(f"[JOIN_DEBUG] Resolved entity {type(entity).__name__} for {source_group}")
                    if isinstance(entity, Chat):
                        print(f"[JOIN_DEBUG] Entity is Chat (basic group), marking joined")
                        results.append({"accountId": account_id, "status": "joined"})
                    else:
                        print(f"[JOIN_DEBUG] Sending JoinChannelRequest...")
                        await client(JoinChannelRequest(entity))
                        print(f"[JOIN_DEBUG] JoinChannelRequest succeeded for {account_id}")
                        results.append({"accountId": account_id, "status": "joined"})
                finally:
                    await _safe_disconnect(client)
                    print(f"[JOIN_DEBUG] Client disconnected for {account_id}")
        except Exception as e:
            err_str = str(e)
            traceback.print_exc()
            print(f"[JOIN_DEBUG] Error for {account_id}: {err_str}")
            if "already" in err_str.lower():
                results.append({"accountId": account_id, "status": "already_joined"})
            else:
                results.append({"accountId": account_id, "status": "failed", "error": err_str[:500]})
        await asyncio.sleep(random.uniform(1.5, 4.5))
    print(f"[JOIN_DEBUG] Final results: {results}")
    return {"ok": True, "campaignId": campaign_id, "results": results}


@router.post("/api/v1/campaigns/{campaign_id}/leave-group")
async def leave_group_for_campaign(
    campaign_id: str,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
            (campaign_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        record = campaign_to_record(row)
        source_group = record.get("sourceGroup")
        if not source_group:
            raise HTTPException(status_code=400, detail="No source group set for this campaign")
        account_ids = record["accountIds"]
    print(f"[LEAVE_DEBUG] Leaving group {source_group} with accounts: {account_ids}")
    semaphore = asyncio.Semaphore(4)

    async def _leave_one(account_id: str) -> dict[str, Any]:
        async with semaphore:
            print(f"[LEAVE_DEBUG] Processing account {account_id}...")
            client = None
            try:
                lock = _account_session_lock(account_id)
                async with lock:
                    print(f"[LEAVE_DEBUG] Acquired lock for {account_id}, opening client...")
                    _, client = await _open_account_client_for_user(user_id, account_id)
                    print(f"[LEAVE_DEBUG] Client opened for {account_id}")
                    entity = await _resolve_entity(client, source_group)
                    print(f"[LEAVE_DEBUG] Resolved entity {type(entity).__name__} for {source_group}")
                    if isinstance(entity, Chat):
                        print(f"[LEAVE_DEBUG] Entity is Chat (basic group), deleting dialog...")
                        await client.delete_dialog(entity)
                    else:
                        print(f"[LEAVE_DEBUG] Sending LeaveChannelRequest...")
                        await client(LeaveChannelRequest(entity))
                    print(f"[LEAVE_DEBUG] Leave succeeded for {account_id}")
                    return {"accountId": account_id, "status": "left"}
            except Exception as e:
                err_str = str(e)
                traceback.print_exc()
                print(f"[LEAVE_DEBUG] Error for {account_id}: {err_str}")
                if "already" in err_str.lower() or "not a participant" in err_str.lower():
                    return {"accountId": account_id, "status": "already_left"}
                return {"accountId": account_id, "status": "failed", "error": err_str[:500]}
            finally:
                await _safe_disconnect(client)
                print(f"[LEAVE_DEBUG] Client disconnected for {account_id}")

    results = await asyncio.gather(*[_leave_one(account_id) for account_id in account_ids])
    print(f"[LEAVE_DEBUG] Final results: {results}")
    return {"ok": True, "campaignId": campaign_id, "results": results}
