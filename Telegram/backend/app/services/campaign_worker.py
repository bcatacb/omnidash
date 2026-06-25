from __future__ import annotations

import asyncio
import json
import logging
import random
import sqlite3
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    PeerFloodError,
    UserAlreadyParticipantError,
    UserChannelsTooMuchError,
    UserPrivacyRestrictedError,
)
from telethon.errors.rpcerrorlist import UsernameNotOccupiedError
from telethon.tl.functions.channels import (
    GetParticipantsRequest,
    InviteToChannelRequest,
    JoinChannelRequest,
)
from telethon.tl.types import (
    ChannelParticipantsSearch,
    Chat,
    InputUser,
    UserStatusEmpty,
    UserStatusLastMonth,
    UserStatusLastWeek,
    UserStatusOffline,
    UserStatusOnline,
    UserStatusRecently,
)

from ..core.database import db, db_write, async_db_read, async_db_write, now_iso
from ..core.config import settings, SESSION_DIR
from ..helpers.campaign import campaign_to_record, _update_campaign_status
from ..core.state import (
    CAMPAIGN_TASKS,
    CAMPAIGN_TASK_LOCK,
    CAMPAIGN_STOP_REQUESTED,
    CAMPAIGN_PAUSE_REQUESTED,
    CAMPAIGN_SCRAPED_MEMBERS,
    FLOODED_ACCOUNTS,
)
from ..helpers.telegram import (
    _account_session_lock,
    _safe_disconnect,
    _apply_fingerprint,
    _parse_proxy_config,
    _open_account_client_for_user,
    _resolve_entity,
    _message_text,
    _message_media_type,
    _message_to_item,
)


logger = logging.getLogger(__name__)


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


def _campaign_done_callback(campaign_id: str) -> Callable[[asyncio.Task], None]:
    def callback(task: asyncio.Task) -> None:
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return
        if not exc:
            return

        def _write(conn: sqlite3.Connection) -> None:
            row = conn.execute(
                "SELECT last_run_summary_json FROM campaigns WHERE id = ?", (campaign_id,)
            ).fetchone()
            summary = json.loads(row["last_run_summary_json"]) if row and row["last_run_summary_json"] else {}
            events = summary.get("activityLog") or []
            events.append({
                "at": now_iso(),
                "type": "campaign_failed",
                "message": f"Campaign crashed: {type(exc).__name__}: {str(exc)[:200]}",
            })
            summary["activityLog"] = events[-120:]
            summary["status"] = "failed"
            conn.execute(
                """
                UPDATE campaigns
                SET status = 'failed', updated_at = ?, last_finished_at = ?, last_run_summary_json = ?
                WHERE id = ?
                """,
                (now_iso(), now_iso(), json.dumps(summary), campaign_id),
            )

        print(f"[CAMPAIGN_CRASH] {campaign_id}: {type(exc).__name__}: {exc}")
        # Must not let a locked DB silently strand the campaign as 'running'. Retry the
        # write; if it still fails, log loudly rather than swallowing the error.
        try:
            asyncio.create_task(async_db_write(_write))
        except Exception:
            logger.exception("Failed to mark campaign %s as failed after crash", campaign_id)
    return callback


async def _run_campaign_worker(campaign_id: str, prev_summary_data: dict[str, Any] | None = None) -> None:
    def _load_campaign(conn):
        row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not row:
            return None, None
        rec = campaign_to_record(row)
        prev = None
        try:
            prev_row = conn.execute(
                "SELECT last_run_summary_json FROM campaigns WHERE id = ?", (campaign_id,)
            ).fetchone()
            if prev_row and prev_row["last_run_summary_json"]:
                prev = json.loads(prev_row["last_run_summary_json"])
        except Exception:
            pass
        return rec, prev

    record, _prev = await async_db_read(_load_campaign)
    if record is None:
        return
    if prev_summary_data is None:
        prev_summary_data = _prev
    user_id = record["userId"]
    account_ids = record["accountIds"]
    messages = record["messages"]
    source_group = record.get("sourceGroup")
    # Staging group used to bootstrap resolution of no-username/no-phone folder contacts: the
    # owning account adds the target here so a different messaging account can resolve it (and get
    # its own valid access_hash), then the target is kicked back out. Empty -> bootstrap disabled.
    resolution_group = (record.get("resolutionGroup") or "").strip()
    blacklisted = record.get("blacklistedUsers", [])
    blacklisted_lower = {b.lower() for b in blacklisted if b}
    interval = record.get("messageIntervalSeconds", 5)
    daily_limit = record.get("dailyMessageLimitPerAccount", 0)
    camp_type = record.get("campaignType", "csv")

    # Collect sender account identities so they never message each other
    sender_ids: set[str] = set()
    sender_usernames: set[str] = set()
    def _load_senders(conn):
        rows = []
        for aid in account_ids:
            acct = conn.execute(
                "SELECT telegram_id, username FROM accounts WHERE id = ? AND user_id = ?",
                (aid, user_id),
            ).fetchone()
            if acct:
                rows.append((acct["telegram_id"], acct["username"]))
        return rows
    for tg_id, uname in await async_db_read(_load_senders):
        if tg_id:
            sender_ids.add(tg_id)
        if uname:
            sender_usernames.add(uname.lower())

    if not account_ids or not messages:
        _update_campaign_status(campaign_id, "failed")
        return
    activity_log: list[dict[str, Any]] = []
    joined_account_ids: list[str] = list(account_ids) if camp_type != "group" else []
    last_sender_account: str | None = None
    last_send_time: float = 0.0

    # Debounce full-summary writes. Every send/interval-tick used to write the entire
    # summary JSON, producing a write storm that caused "database is locked" and stranded
    # the worker. Non-terminal "running" updates are throttled to at most one per
    # PERSIST_MIN_INTERVAL; terminal writes pass force=True and always go through.
    PERSIST_MIN_INTERVAL = 10.0
    _persist_meta = {"last": 0.0}

    async def _persist_campaign_activity(
        *,
        status: str = "running",
        account_stats: list[dict[str, Any]] | None = None,
        sent_items: list[dict[str, Any]] | None = None,
        total_targets: int | None = None,
        sent_count: int | None = None,
        send_failures: int | None = None,
        send_skipped: int | None = None,
        remaining_targets: int | None = None,
        unresolved_count: int | None = None,
        force: bool = False,
    ) -> None:
        # Throttle non-terminal "running" updates to avoid a write storm. Terminal
        # statuses (completed/failed/stopped) and explicit force=True always persist.
        if not force and status == "running":
            nowm = time.monotonic()
            if nowm - _persist_meta["last"] < PERSIST_MIN_INTERVAL:
                return
            _persist_meta["last"] = nowm
        if any(v is None for v in (total_targets, sent_count, send_failures, remaining_targets)):
            try:
                existing_row = await async_db_read(
                    lambda conn: conn.execute(
                        "SELECT last_run_summary_json FROM campaigns WHERE id = ?", (campaign_id,)
                    ).fetchone()
                )
                if existing_row and existing_row["last_run_summary_json"]:
                    existing_summary = json.loads(existing_row["last_run_summary_json"])
                    if total_targets is None:
                        total_targets = existing_summary.get("totalTargets", 0)
                    if sent_count is None:
                        sent_count = existing_summary.get("sentCount", 0)
                    if send_failures is None:
                        send_failures = existing_summary.get("sendFailures", 0)
                    if remaining_targets is None:
                        remaining_targets = existing_summary.get("remainingTargets", 0)
                else:
                    total_targets = total_targets or 0
                    sent_count = sent_count or 0
                    send_failures = send_failures or 0
                    remaining_targets = remaining_targets or 0
            except Exception:
                total_targets = total_targets or 0
                sent_count = sent_count or 0
                send_failures = send_failures or 0
                remaining_targets = remaining_targets or 0
        if unresolved_count is None:
            unresolved_count = len(unresolved_targets)
        resolved = max(0, total_targets - unresolved_count)
        summary = {
            "ok": True,
            "campaignId": campaign_id,
            "name": record["name"],
            "createdAt": record["createdAt"],
            "dailyMessageLimitPerAccount": daily_limit,
            "messageRotation": messages,
            "messageIntervalSeconds": interval,
            "totalTargets": total_targets,
            "resolvedTargets": resolved,
            "unresolvedTargets": unresolved_count,
            "previouslyMessagedTargets": 0,
            "skippedCount": send_skipped or 0,
            "sentCount": sent_count,
            "sendFailures": send_failures,
            "remainingTargets": remaining_targets,
            "lastSenderAccount": last_sender_account,
            "lastSendTime": last_send_time,
            "estimatedSecondsRemaining": int(max(0, remaining_targets) * interval),
            "estimatedMinutesRemaining": round((max(0, remaining_targets) * interval) / 60, 1),
            "assignments": [],
            "unresolved": list(unresolved_targets)[:100],
            "previouslyMessaged": [],
            "activityLog": activity_log[-120:],
            "accountStats": account_stats or [
                {
                    "accountId": aid,
                    "accountLabel": aid[:8],
                    "assignedTargets": 0,
                    "resolvedTargets": 0,
                    "unresolvedTargets": 0,
                    "attemptedTargets": 0,
                    "sentCount": 0,
                    "sendFailures": 0,
                    "sendFailed": 0,
                    "skippedCount": 0,
                    "repliedTargets": 0,
                    "replyMessages": 0,
                    "state": "active",
                }
                for aid in account_ids
            ],
            "sentItems": sent_items or [],
            "status": status,
        }
        payload = json.dumps(summary)
        await async_db_write(
            lambda conn: conn.execute(
                "UPDATE campaigns SET last_run_summary_json = ?, updated_at = ? WHERE id = ?",
                (payload, now_iso(), campaign_id),
            )
        )

    unresolved_targets: set[str] = set()

    if camp_type == "group":
        if prev_summary_data:
            joined_account_ids = list(account_ids)
        else:
            print(f"[DEBUG] Campaign {campaign_id}: Joining {len(account_ids)} accounts to group {source_group}")
            for account_id in account_ids:
                label = account_id[:8]
                try:
                    lock = _account_session_lock(account_id)
                    async with lock:
                        _, client = await _open_account_client_for_user(user_id, account_id)
                        try:
                            entity = await _resolve_entity(client, source_group)
                            is_basic_group = isinstance(entity, Chat)
                            if is_basic_group:
                                if account_id not in joined_account_ids:
                                    joined_account_ids.append(account_id)
                                activity_log.append({
                                    "at": now_iso(), "type": "join_skipped",
                                    "accountId": account_id, "accountLabel": label,
                                    "target": source_group,
                                    "message": "Basic group — join not needed, just start messaging",
                                })
                            else:
                                await client(JoinChannelRequest(entity))
                                if account_id not in joined_account_ids:
                                    joined_account_ids.append(account_id)
                                activity_log.append({
                                    "at": now_iso(), "type": "join_success",
                                    "accountId": account_id, "accountLabel": label,
                                    "target": source_group, "message": "Joined group",
                                })
                        finally:
                            await _safe_disconnect(client)
                except FloodWaitError as fwe:
                    secs = getattr(fwe, 'seconds', 3600)
                    activity_log.append({
                        "at": now_iso(), "type": "join_flood",
                        "accountId": account_id, "accountLabel": label,
                        "target": source_group,
                        "message": f"Flood wait {secs}s joining group for {label}, account resting",
                    })
                except Exception as e:
                    err_str = str(e)
                    if "already" in err_str.lower():
                        if account_id not in joined_account_ids:
                            joined_account_ids.append(account_id)
                        activity_log.append({
                            "at": now_iso(), "type": "join_success",
                            "accountId": account_id, "accountLabel": label,
                            "target": source_group,
                            "message": "Already in group",
                        })
                    else:
                        activity_log.append({
                            "at": now_iso(), "type": "join_failed",
                            "accountId": account_id, "accountLabel": label,
                            "target": source_group,
                            "message": f"Join failed: {err_str[:150]}",
                        })
                await _persist_campaign_activity()
                await asyncio.sleep(random.uniform(1.5, 4.5))
        # Only distribute targets to accounts that successfully joined
        if not joined_account_ids:
            activity_log.append({"at": now_iso(), "type": "campaign_failed", "message": "No accounts could join the source group"})
            await _persist_campaign_activity(status="failed")
            _update_campaign_status(campaign_id, "failed")
            return
        account_ids = joined_account_ids

    activity_log.append({"at": now_iso(), "type": "campaign_started", "message": "Campaign started"})

    # Load targets from DB first (persisted by scrape routes), then fall back to in-memory
    members = []
    scraped_targets = record.get("scrapedTargets")
    if scraped_targets:
        members = scraped_targets
        activity_log.append({
            "at": now_iso(), "type": "scrape_done",
            "message": f"Resuming with {len(members)} previously scraped targets",
        })
    if not members:
        members = CAMPAIGN_SCRAPED_MEMBERS.get(campaign_id, [])
        if members:
            activity_log.append({
                "at": now_iso(), "type": "scrape_done",
                "message": f"Resuming with {len(members)} cached targets (in-memory)",
            })
    if not members and source_group and camp_type == "group":
        if prev_summary_data is not None:
            # Resuming from a pause — never re-scrape even if cache is cold
            activity_log.append({
                "at": now_iso(), "type": "scrape_failed",
                "message": "Warning: cached targets unavailable on resume. Skipping re-scrape.",
            })
            await _persist_campaign_activity()
        else:
            try:
                lock = _account_session_lock(account_ids[0])
                async with lock:
                    _, client = await _open_account_client_for_user(user_id, account_ids[0])
                    try:
                        entity = await _resolve_entity(client, source_group)
                        label = account_ids[0][:8]
                        my_filter = ChannelParticipantsSearch('')
                        offset = 0
                        scraped_total = 0
                        while True:
                            participants = await client(GetParticipantsRequest(channel=entity, offset=offset, filter=my_filter, limit=200, hash=0))
                            for participant in participants.users:
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
                                scraped_total += 1
                            offset += len(participants.users)
                            if len(participants.users) < 200 or scraped_total >= 10000:
                                break
                    finally:
                        await _safe_disconnect(client)
                CAMPAIGN_SCRAPED_MEMBERS[campaign_id] = members
                payload = json.dumps(members)
                await async_db_write(
                    lambda conn: conn.execute(
                        "UPDATE campaigns SET scraped_targets_json = ?, updated_at = ? WHERE id = ?",
                        (payload, now_iso(), campaign_id),
                    )
                )
                activity_log.append({
                    "at": now_iso(), "type": "scrape_done",
                    "accountId": account_ids[0], "accountLabel": label,
                    "message": f"Scraped {len(members)} members from group",
                })
                await _persist_campaign_activity()
            except Exception as e:
                activity_log.append({
                    "at": now_iso(), "type": "scrape_failed",
                    "accountId": account_ids[0], "accountLabel": account_ids[0][:8],
                    "message": f"Failed to scrape members: {str(e)[:100]}",
                })
                await _persist_campaign_activity()

    # Folder campaigns: auto-load targets from the folder's chats when none are cached, so a
    # campaign launched without first clicking "Load Folder Targets" still has targets. Mirrors
    # the group auto-scrape above, but reads from the local folder_chats table (no Telegram call).
    if not members and camp_type == "folder":
        source_folder = record.get("sourceFolder")
        if source_folder:
            folder_chats = await async_db_read(
                lambda conn: conn.execute(
                    "SELECT account_id, chat_id, username, display_name, access_hash FROM folder_chats WHERE folder_id = ?",
                    (source_folder,),
                ).fetchall()
            )
            members = [
                {
                    "userId": str(fc["chat_id"]),
                    "username": fc["username"],
                    "displayName": fc["display_name"],
                    "accessHash": fc["access_hash"],
                    "ownerAccountId": fc["account_id"],
                    "lastSeen": None,
                }
                for fc in folder_chats
            ]
            if members:
                CAMPAIGN_SCRAPED_MEMBERS[campaign_id] = members
                payload = json.dumps(members)
                await async_db_write(
                    lambda conn: conn.execute(
                        "UPDATE campaigns SET scraped_targets_json = ?, updated_at = ? WHERE id = ?",
                        (payload, now_iso(), campaign_id),
                    )
                )
                activity_log.append({
                    "at": now_iso(), "type": "scrape_done",
                    "message": f"Loaded {len(members)} targets from folder",
                })
            else:
                activity_log.append({
                    "at": now_iso(), "type": "scrape_failed",
                    "message": "No chats found in the selected folder",
                })
            await _persist_campaign_activity()

    # Build a unique target list so no two accounts message the same user.
    # Prefer username as the stable key when present (case-insensitive), else fall back to userId.
    unique_targets: list[dict[str, Any]] = []
    seen_targets: set[str] = set()

    # For DM campaigns (no sourceGroup), load targets from targetsCsv
    if not members and not source_group:
        targets_csv = record.get("targetsCsv", "")
        if targets_csv:
            for item in targets_csv.split(","):
                item = item.strip()
                if not item:
                    continue
                if item in blacklisted or item.lower() in blacklisted_lower:
                    continue
                key = f"id:{item}"
                if key in seen_targets:
                    continue
                seen_targets.add(key)
                unique_targets.append({"userId": item, "username": item})
    else:
        for m in members:
            target_user_id = str(m.get("userId", "") or "")
            username = (m.get("username") or "").strip()
            key = f"u:{username.lower()}" if username else f"id:{target_user_id}"
            if not target_user_id and not username:
                continue
            if target_user_id in blacklisted or target_user_id in sender_ids:
                continue
            if username and (username.lower() in blacklisted_lower or username.lower() in sender_usernames):
                continue
            if key in seen_targets:
                continue
            seen_targets.add(key)
            unique_targets.append(m)

    targets = unique_targets

    # Sort by activity if configured
    sort_by_activity = record.get("sortByActivity")
    if sort_by_activity in ("most_recent", "least_recent"):
        def _activity_sort_key(t: dict[str, Any]) -> str:
            ls = t.get("lastSeen")
            return ls if ls else ""
        targets.sort(key=_activity_sort_key, reverse=(sort_by_activity == "most_recent"))

    skip_messaged = record.get("skipMessaged", False)

    if not targets:
        activity_log.append({"at": now_iso(), "type": "campaign_done", "message": "No messageable targets found"})
        await _persist_campaign_activity(status="completed")
        _update_campaign_status(campaign_id, "completed")
        return
    print(f"[DEBUG] Campaign {campaign_id}: Messaging {len(targets)} targets with {len(account_ids)} accounts")

    # Split targets evenly among accounts — each account only messages its own chunk
    total_accounts = len(account_ids)
    chunk_size = len(targets) // total_accounts if total_accounts else 0
    remainder = len(targets) % total_accounts if total_accounts else 0
    account_targets: dict[str, list[dict[str, Any]]] = {}
    start = 0
    for i, account_id in enumerate(account_ids):
        extra = 1 if i < remainder else 0
        end = start + chunk_size + extra
        account_targets[account_id] = targets[start:end]
        start = end

    # Track per-account stats for the summary
    account_stats: list[dict[str, Any]] = []
    for account_id in account_ids:
        label = account_id[:8]
        my_targets = account_targets.get(account_id, [])
        account_stats.append({
            "accountId": account_id,
            "accountLabel": label,
            "assignedTargets": len(my_targets),
            "resolvedTargets": len(my_targets),
            "unresolvedTargets": 0,
            "attemptedTargets": 0,
            "sentCount": 0,
            "dailySent": 0,
            "dailyWindowStart": None,
            "sendFailures": 0,
            "sendFailed": 0,
            "skippedCount": 0,
            "repliedTargets": 0,
            "replyMessages": 0,
            "state": "idle",
        })

    # sent_counts is the cumulative lifetime send total per account — used only for display
    # (per-account "sent" column, summary sentCount). It is NEVER reset, so it cannot drift
    # backwards. The daily limit is enforced by a SEPARATE rolling-24h counter (daily_sent)
    # so an account sending under the cap each day does not accumulate lifetime sends and
    # eventually trip the cap spuriously.
    sent_counts: dict[str, int] = {aid: 0 for aid in account_ids}
    daily_sent: dict[str, int] = {aid: 0 for aid in account_ids}
    fail_counts: dict[str, int] = {aid: 0 for aid in account_ids}
    skip_counts: dict[str, int] = {aid: 0 for aid in account_ids}
    # Two distinct rest clocks per account. Sharing one dict made a flood-wait expiry reset the
    # daily counter (daily_sent -> 0), silently bypassing the daily cap.
    #   daily_reset_at: end of a 24h rest after hitting the daily limit (expiry zeroes daily_sent)
    #   flood_reset_at: end of a Telegram FloodWait rest (expiry does NOT touch daily_sent)
    daily_reset_at: dict[str, datetime | None] = {aid: None for aid in account_ids}
    flood_reset_at: dict[str, datetime | None] = {aid: None for aid in account_ids}
    # Short rest after a generic (non-flood) send failure. Like flood_reset_at, its expiry
    # must NOT touch daily_sent. Removing a just-failed account from the active set briefly
    # makes the other accounts slow down (so they don't pick up the slack in a burst) and
    # stops the failed account from immediately hammering retries.
    fail_cooldown_at: dict[str, datetime | None] = {aid: None for aid in account_ids}
    FAIL_COOLDOWN_SECONDS = 15
    sent_items: list[dict[str, Any]] = []
    # Targets that failed too many times for a non-flood reason. Dropped instead of being
    # re-queued forever (the old behaviour, which made campaigns appear to run endlessly).
    permanently_failed: set[str] = set()
    target_attempts: dict[str, int] = {}
    MAX_TARGET_ATTEMPTS = 3
    # Per-account peer-flood strikes. PeerFloodError is an account-level spam restriction, so
    # re-hitting the same contacts just re-floods. After MAX_PEER_FLOOD_STRIKES the account is
    # burned (drained + removed from rotation) so the run can finish instead of looping.
    peer_flood_strikes: dict[str, int] = {aid: 0 for aid in account_ids}
    MAX_PEER_FLOOD_STRIKES = 3
    # Accounts retired mid-run (burned for repeated peer-floods). Excluded as reassignment
    # recipients so a burned account's leftovers only go to accounts still in play.
    burned_accounts: set[str] = set()
    # Per-account Telethon client cache. A client is opened lazily on first send and
    # DELIBERATELY evicted (disconnected) again after every send in the per-send finally
    # below — do NOT "optimize" that into a long-lived pooled connection. The reply_stats /
    # seen_stats / scrape endpoints open the SAME account's .session under the same
    # per-account lock while a campaign runs; leaving a connection open across the interval
    # wait would put two TelegramClients on one .session file and raise "database is locked".
    clients: dict[str, TelegramClient] = {}
    start_time = datetime.now(UTC)
    # Rolling 24h window for the daily-send limit. daily_window_start[aid] marks when the
    # current window opened; once 24h elapse the window rolls and daily_sent[aid] resets to 0
    # (see _roll_daily_window). This is what makes the cap "N per rolling 24h" rather than a
    # lifetime cap.
    DAILY_WINDOW = timedelta(hours=24)
    daily_window_start: dict[str, datetime] = {aid: start_time for aid in account_ids}
    total_targets = len(targets)

    _account_label_cache: dict[str, str] = {}
    def _account_label(aid: str) -> str:
        if aid in _account_label_cache:
            return _account_label_cache[aid]
        with db() as conn:
            row = conn.execute(
                "SELECT display_name, username FROM accounts WHERE id = ?", (aid,)
            ).fetchone()
            if row:
                label = row["display_name"] or row["username"] or aid[:8]
            else:
                label = aid[:8]
        _account_label_cache[aid] = label
        return label

    # Per-account target queues (pop from front, push failures to back for retry)
    account_queues: dict[str, list[dict[str, Any]]] = {}
    for aid, tgts in account_targets.items():
        account_queues[aid] = list(tgts)

    async def _get_client(aid: str) -> TelegramClient:
        """Return a connected, reused client for ``aid``, opening one if needed."""
        existing = clients.get(aid)
        if existing is not None:
            try:
                if existing.is_connected():
                    return existing
            except Exception:
                pass
            clients.pop(aid, None)
            await _safe_disconnect(existing)
        _, client = await _open_account_client_for_user(user_id, aid)
        clients[aid] = client
        return client

    async def _evict_client(aid: str) -> None:
        client = clients.pop(aid, None)
        if client is not None:
            await _safe_disconnect(client)

    def _requeue_or_drop(target: dict[str, Any], target_repr: Any, account_id: str) -> bool:
        """Re-queue a failed target at the BACK for retry, or drop it past the attempt cap.

        Returns True if the target was dropped. Used for generic failures AND flood/peer-flood
        retries — re-queuing at the back (not the front) stops the account from re-hitting the
        same target the instant its flood rest expires, and the cap stops a target that keeps
        flooding from blocking the queue forever.
        """
        key = str(target_repr)
        attempts = target_attempts.get(key, 0) + 1
        target_attempts[key] = attempts
        if attempts >= MAX_TARGET_ATTEMPTS:
            permanently_failed.add(key)
            activity_log.append({
                "at": now_iso(), "type": "message_failed",
                "accountId": account_id, "accountLabel": _account_label(account_id),
                "target": target_repr,
                "message": f"Dropping {target_repr} after {attempts} failed attempts",
            })
            return True
        account_queues[account_id].append(target)
        return False

    def _burn_account(aid: str, reason: str) -> None:
        """Retire a spam-restricted account. Hand its remaining (un-attempted) targets to the
        accounts still in play so those contacts are still messaged. If no live account remains,
        fail the leftovers so ``remaining_total`` can reach 0. Either way the account's own queue
        is emptied so it is no longer selected and stops counting toward the interval scaling.
        """
        burned_accounts.add(aid)
        leftover = account_queues.get(aid, [])
        account_queues[aid] = []
        recipients = [a for a in account_ids if a not in burned_accounts]
        if leftover and recipients:
            # Round-robin the leftovers onto the back of the surviving accounts' queues. Moving
            # a target is not an attempt, so it gets a fresh try (the global target_attempts cap
            # still stops a genuinely toxic target from bouncing forever).
            for i, t in enumerate(leftover):
                account_queues[recipients[i % len(recipients)]].append(t)
            activity_log.append({
                "at": now_iso(), "type": "account_rest",
                "accountId": aid, "accountLabel": _account_label(aid),
                "message": f"{reason} — reassigned {len(leftover)} targets to {len(recipients)} remaining account(s)",
            })
        else:
            # Last account standing (or nothing to move): fail the leftovers so the run ends.
            for t in leftover:
                t_repr = t.get("username") or t.get("userId", "")
                fail_counts[aid] = fail_counts.get(aid, 0) + 1
                unresolved_targets.add(t_repr)
                sent_items.append({
                    "accountId": aid,
                    "accountLabel": _account_label(aid),
                    "target": t_repr,
                    "sentAt": now_iso(),
                    "error": reason,
                    "success": False,
                })
            activity_log.append({
                "at": now_iso(), "type": "account_rest",
                "accountId": aid, "accountLabel": _account_label(aid),
                "message": f"{reason} (abandoned {len(leftover)} remaining targets — no live accounts left)",
            })

    def _roll_daily_window(aid: str, now: datetime) -> None:
        """Roll ``aid``'s daily-limit window if 24h have elapsed since it opened.

        Resets the rolling gate counter (daily_sent) to 0 and clears any daily rest. Must be
        called before reading daily_sent for the cap check so the limit is "N per rolling 24h"
        rather than a lifetime cap.
        """
        ws = daily_window_start.get(aid)
        if ws is None or (now - ws) >= DAILY_WINDOW:
            daily_sent[aid] = 0
            daily_window_start[aid] = now
            daily_reset_at[aid] = None

    def _is_resting(aid: str, now: datetime) -> bool:
        """True if account ``aid`` currently cannot send (flood / fail-cooldown / daily rest)."""
        for clock in (flood_reset_at, fail_cooldown_at, daily_reset_at):
            t = clock.get(aid)
            if t is not None and t > now:
                return True
        _roll_daily_window(aid, now)
        if daily_limit > 0 and daily_sent.get(aid, 0) >= daily_limit:
            return True
        return False

    def _active_expected(now: datetime) -> tuple[int, int]:
        """Return (expected, active): accounts with work, and the subset able to send now.

        Used to scale the global send interval so each still-active account keeps its
        original ``expected * interval`` cadence instead of speeding up when peers rest.
        """
        with_work = [aid for aid in account_ids if account_queues.get(aid)]
        expected = len(with_work)
        active = sum(1 for aid in with_work if not _is_resting(aid, now))
        return expected, active

    def _refresh_account_states(
        now: datetime,
        *,
        interval_rest: bool = False,
        interval_until: str | None = None,
        interval_secs: int | None = None,
        interval_reason: str | None = None,
    ) -> None:
        """Recompute every account's display state from the authoritative rest clocks.

        Single source of truth so genuinely-resting accounts (flood / fail-cooldown / daily
        limit) keep showing their cooldown chip + countdown no matter which account is currently
        sending — instead of being clobbered back to idle after each send.
        """
        def _set_rest(acct: dict[str, Any], state: str, until: datetime | None, reason: str) -> None:
            acct["state"] = state
            if until is not None:
                acct["restUntil"] = until.isoformat()
                acct["restSeconds"] = max(0, int((until - now).total_seconds()))
            acct["restReason"] = reason

        for acct in account_stats:
            aid = acct["accountId"]
            flood_at = flood_reset_at.get(aid)
            cool_at = fail_cooldown_at.get(aid)
            _roll_daily_window(aid, now)
            daily_at = daily_reset_at.get(aid)
            if flood_at is not None and flood_at > now:
                _set_rest(acct, "cooldown", flood_at, "Flood wait")
            elif cool_at is not None and cool_at > now:
                _set_rest(acct, "cooldown", cool_at, "Recovering from error")
            elif (daily_at is not None and daily_at > now) or (
                daily_limit > 0 and daily_sent.get(aid, 0) >= daily_limit
            ):
                _set_rest(acct, "cooldown", daily_at, f"Daily limit ({daily_limit}) reached")
            elif interval_rest and aid == last_sender_account:
                acct["state"] = "resting"
                acct["restUntil"] = interval_until
                acct["restSeconds"] = interval_secs
                acct["restReason"] = interval_reason
            elif aid == last_sender_account:
                acct["state"] = "active"
                acct.pop("restUntil", None)
                acct.pop("restSeconds", None)
                acct.pop("restReason", None)
            else:
                acct["state"] = "idle"
                acct.pop("restUntil", None)
                acct.pop("restSeconds", None)
                acct.pop("restReason", None)

    stuck_iterations = 0
    MAX_STUCK_ITERATIONS = 30

    # Restore progress if resuming a paused campaign
    try:
        if prev_summary_data:
            prev_sent = prev_summary_data.get("sentCount", 0)
            prev_failed = prev_summary_data.get("sendFailures", 0)
            if prev_sent + prev_failed > 0:
                for s in prev_summary_data.get("accountStats", []):
                    aid = s["accountId"]
                    if aid in sent_counts:
                        sent_counts[aid] = s.get("sentCount", 0)
                        fail_counts[aid] = s.get("sendFailures", 0)
                        skip_counts[aid] = s.get("skippedCount", 0)
                        # Restore the rolling daily-limit window from its own persisted state —
                        # NOT from the cumulative sentCount, which would mistake lifetime sends
                        # for today's and instantly trip the cap on resume.
                        daily_sent[aid] = s.get("dailySent", 0)
                        ws = s.get("dailyWindowStart")
                        if ws:
                            try:
                                daily_window_start[aid] = datetime.fromisoformat(ws)
                            except Exception:
                                daily_window_start[aid] = datetime.now(UTC)
                        else:
                            daily_window_start[aid] = datetime.now(UTC)
                        # Restore daily rest state
                        rest_str = s.get("restUntil")
                        if rest_str:
                            try:
                                rd = datetime.fromisoformat(rest_str)
                                if rd > datetime.now(UTC):
                                    daily_reset_at[aid] = rd
                            except Exception:
                                pass
                # Rebuild queues: remove successfully sent targets from each account's queue,
                # keep failed ones for retry
                sent_success_keys: set[str] = set()
                sent_fail_keys: set[str] = set()
                for item in prev_summary_data.get("sentItems", []):
                    key = (item.get("accountId", ""), item.get("target", ""))
                    if item.get("success") is not False:
                        sent_success_keys.add(key)
                    else:
                        sent_fail_keys.add(key)
                for aid in account_ids:
                    q = account_queues.get(aid, [])
                    new_q: list[dict[str, Any]] = []
                    for t in q:
                        t_repr = t.get("username") or t.get("userId", "")
                        key = (aid, t_repr)
                        if key in sent_success_keys:
                            continue  # Already sent, remove from queue
                        if key in sent_fail_keys:
                            sent_fail_keys.discard(key)  # Will re-add
                        new_q.append(t)
                    # Re-add all previously failed targets for retry
                    for key in list(sent_fail_keys):
                        if key[0] == aid:
                            target_dict = {"userId": key[1], "username": key[1]}
                            new_q.append(target_dict)
                    account_queues[aid] = new_q
                if prev_summary_data.get("sentItems"):
                    sent_items = prev_summary_data["sentItems"][-2000:]
                if prev_summary_data.get("activityLog"):
                    activity_log = prev_summary_data["activityLog"][-120:]
                prev_elapsed = prev_summary_data.get("elapsedSeconds", 0)
                start_time = datetime.now(UTC) - timedelta(seconds=prev_elapsed)
                last_sender_account = prev_summary_data.get("lastSenderAccount")
                last_send_time = prev_summary_data.get("lastSendTime", 0.0)
    except Exception:
        pass

    # Restore account_stats from restored sent/fail/skip counts
    for acct in account_stats:
        aid = acct["accountId"]
        acct["sentCount"] = sent_counts.get(aid, 0)
        acct["dailySent"] = daily_sent.get(aid, 0)
        acct["dailyWindowStart"] = (daily_window_start.get(aid) or start_time).isoformat()
        acct["sendFailures"] = fail_counts.get(aid, 0)
        acct["sendFailed"] = fail_counts.get(aid, 0)
        acct["skippedCount"] = skip_counts.get(aid, 0)
        acct["attemptedTargets"] = acct["sentCount"] + acct["sendFailures"] + acct["skippedCount"]

    msg_rotation_idx: int = 0
    total_targets = sum(len(q) for q in account_queues.values())
    await _persist_campaign_activity(
        account_stats=account_stats,
        sent_items=sent_items,
        total_targets=total_targets,
        sent_count=sum(sent_counts.values()),
        send_failures=sum(fail_counts.values()),
        send_skipped=sum(skip_counts.values()),
        remaining_targets=total_targets,
    )

    # Per-account entity pre-resolution for group campaigns
    account_user_hashes: dict[str, dict[str, str]] = {}
    if camp_type == "group" and source_group:
        resolve_semaphore = asyncio.Semaphore(3)

        async def _resolve_account_hashes(account_id: str) -> None:
            label = _account_label(account_id)
            async with resolve_semaphore:
                if campaign_id in CAMPAIGN_STOP_REQUESTED:
                    return
                try:
                    lock = _account_session_lock(account_id)
                    async with lock:
                        _, client = await _open_account_client_for_user(user_id, account_id)
                        try:
                            entity = await _resolve_entity(client, source_group)
                            activity_log.append({
                                "at": now_iso(), "type": "resolve_start",
                                "accountId": account_id, "accountLabel": label,
                                "message": f"Resolving group members for {label}",
                            })
                            await _persist_campaign_activity(
                                account_stats=account_stats, sent_items=sent_items,
                                total_targets=total_targets,
                                sent_count=sum(sent_counts.values()),
                                send_failures=sum(fail_counts.values()),
                                remaining_targets=sum(len(q) for q in account_queues.values()),
                            )
                            hashes: dict[str, str] = {}
                            count = 0
                            my_filter = ChannelParticipantsSearch('')
                            offset = 0
                            total_in_group = 0
                            while True:
                                if campaign_id in CAMPAIGN_STOP_REQUESTED:
                                    break
                                try:
                                    participants = await client(GetParticipantsRequest(channel=entity, offset=offset, filter=my_filter, limit=200, hash=0))
                                except FloodWaitError as fwe:
                                    secs = getattr(fwe, 'seconds', 60)
                                    activity_log.append({
                                        "at": now_iso(), "type": "resolve_flood",
                                        "accountId": account_id, "accountLabel": label,
                                        "message": f"Flood wait {secs}s during resolve for {label}, pausing",
                                    })
                                    await _persist_campaign_activity(
                                        account_stats=account_stats, sent_items=sent_items,
                                        total_targets=total_targets,
                                        sent_count=sum(sent_counts.values()),
                                        send_failures=sum(fail_counts.values()),
                                        remaining_targets=sum(len(q) for q in account_queues.values()),
                                    )
                                    await asyncio.sleep(secs)
                                    continue
                                for participant in participants.users:
                                    if getattr(participant, "bot", False) or getattr(participant, "deleted", False):
                                        continue
                                    hashes[str(participant.id)] = str(getattr(participant, "access_hash", ""))
                                    count += 1
                                offset += len(participants.users)
                                if total_in_group == 0:
                                    total_in_group = getattr(participants, 'count', 0)
                                total_display = total_in_group if total_in_group > 0 else offset
                                if count % 1000 < 200 or len(participants.users) < 200:
                                    activity_log.append({
                                        "at": now_iso(), "type": "resolve_progress",
                                        "accountId": account_id, "accountLabel": label,
                                        "message": f"Resolved {count}/{total_display} members for {label}",
                                    })
                                    await _persist_campaign_activity(
                                        account_stats=account_stats, sent_items=sent_items,
                                        total_targets=total_targets,
                                        sent_count=sum(sent_counts.values()),
                                        send_failures=sum(fail_counts.values()),
                                        remaining_targets=sum(len(q) for q in account_queues.values()),
                                    )
                                if len(participants.users) < 200:
                                    break
                            account_user_hashes[account_id] = hashes
                            activity_log.append({
                                "at": now_iso(), "type": "resolve_done",
                                "accountId": account_id, "accountLabel": label,
                                "message": f"Resolved {count} members for {label}",
                            })
                            await _persist_campaign_activity(
                                account_stats=account_stats, sent_items=sent_items,
                                total_targets=total_targets,
                                sent_count=sum(sent_counts.values()),
                                send_failures=sum(fail_counts.values()),
                                remaining_targets=sum(len(q) for q in account_queues.values()),
                            )
                        finally:
                            await _safe_disconnect(client)
                except Exception as e:
                    activity_log.append({
                        "at": now_iso(), "type": "resolve_failed",
                        "accountId": account_id, "accountLabel": label,
                        "message": f"Failed to resolve members for {label}: {str(e)[:100]}",
                    })
                    await _persist_campaign_activity(
                        account_stats=account_stats, sent_items=sent_items,
                        total_targets=total_targets,
                        sent_count=sum(sent_counts.values()),
                        send_failures=sum(fail_counts.values()),
                        remaining_targets=sum(len(q) for q in account_queues.values()),
                    )

        resolve_tasks = []
        for account_id in account_ids:
            if account_queues.get(account_id):
                resolve_tasks.append(_resolve_account_hashes(account_id))
        if resolve_tasks and campaign_id not in CAMPAIGN_STOP_REQUESTED:
            await asyncio.gather(*resolve_tasks)

    # --- Staging-group bootstrap (folder campaigns) ---
    # A no-username/no-phone contact can only be resolved by an account that shares context with it.
    # When a staging group is configured, the OWNING account (which holds a valid access_hash) adds
    # the target into the group; a different messaging account then resolves the target FROM the
    # group (getting its own valid hash), sends, and the target is kicked back out.
    staging_enabled = bool(resolution_group) and camp_type == "folder"
    staging_entity_by_account: dict[str, Any] = {}

    async def _ensure_in_staging(aid: str) -> Any | None:
        """Join + resolve the staging group from ``aid``'s own session. Caller holds aid's lock."""
        cached = staging_entity_by_account.get(aid)
        if cached is not None:
            return cached
        sclient = await _get_client(aid)
        entity = await _resolve_entity(sclient, resolution_group)
        try:
            await sclient(JoinChannelRequest(entity))
        except Exception:
            pass  # already a member, or a basic group — fine either way
        staging_entity_by_account[aid] = entity
        return entity

    async def _owner_add_to_staging(owner_aid: str, target_uid: int, owner_hash: str) -> str:
        """Owner adds target into the staging group. Returns ok|privacy|flood|error. Holds owner lock."""
        lock = _account_session_lock(owner_aid)
        async with lock:
            try:
                entity = await _ensure_in_staging(owner_aid)
                if entity is None:
                    return "error"
                oclient = await _get_client(owner_aid)
                user_ref = InputUser(user_id=target_uid, access_hash=int(owner_hash))
                await oclient(InviteToChannelRequest(channel=entity, users=[user_ref]))
                return "ok"
            except UserAlreadyParticipantError:
                return "ok"
            except UserPrivacyRestrictedError:
                return "privacy"
            except (FloodWaitError, PeerFloodError):
                return "flood"
            except UserChannelsTooMuchError:
                return "error"
            except Exception:
                return "error"

    async def _resolve_in_staging(sender_client: TelegramClient, aid: str, target_uid: int) -> Any | None:
        """Find target among the (small) staging group's participants -> sender-valid entity."""
        entity = staging_entity_by_account.get(aid)
        if entity is None:
            return None
        try:
            participants = await sender_client(
                GetParticipantsRequest(
                    channel=entity, offset=0, filter=ChannelParticipantsSearch(""), limit=200, hash=0
                )
            )
            for u in participants.users:
                if int(getattr(u, "id", 0) or 0) == target_uid:
                    return u
        except Exception:
            return None
        return None

    async def _owner_kick_from_staging(owner_aid: str, target_uid: int, owner_hash: str) -> None:
        """Best-effort removal of the target from the staging group after sending. Holds owner lock."""
        lock = _account_session_lock(owner_aid)
        async with lock:
            try:
                oclient = await _get_client(owner_aid)
                entity = staging_entity_by_account.get(owner_aid) or await _resolve_entity(
                    oclient, resolution_group
                )
                user_ref = InputUser(user_id=target_uid, access_hash=int(owner_hash))
                await oclient.kick_participant(entity, user_ref)
            except Exception as exc:
                activity_log.append({
                    "at": now_iso(), "type": "message_failed",
                    "accountId": owner_aid, "accountLabel": _account_label(owner_aid),
                    "target": str(target_uid),
                    "message": f"Could not remove {target_uid} from staging group: {str(exc)[:120]}",
                })

    if staging_enabled and campaign_id not in CAMPAIGN_STOP_REQUESTED:
        for aid in account_ids:
            if not account_queues.get(aid):
                continue
            try:
                lock = _account_session_lock(aid)
                async with lock:
                    await _ensure_in_staging(aid)
                activity_log.append({
                    "at": now_iso(), "type": "join_success",
                    "accountId": aid, "accountLabel": _account_label(aid),
                    "target": resolution_group,
                    "message": "Joined resolution group",
                })
            except Exception as e:
                activity_log.append({
                    "at": now_iso(), "type": "join_failed",
                    "accountId": aid, "accountLabel": _account_label(aid),
                    "target": resolution_group,
                    "message": f"Failed to join resolution group: {str(e)[:120]}",
                })
        await _persist_campaign_activity(
            account_stats=account_stats, sent_items=sent_items,
            total_targets=total_targets,
            sent_count=sum(sent_counts.values()),
            send_failures=sum(fail_counts.values()),
            remaining_targets=sum(len(q) for q in account_queues.values()),
        )

    def _record_unresolved(aid: str, tgt_repr: Any, detail: str) -> None:
        """Mark a target permanently unresolvable (shared by legacy + bootstrap paths)."""
        unresolved_targets.add(tgt_repr)
        fail_counts[aid] = fail_counts.get(aid, 0) + 1
        sent_items.append({
            "accountId": aid,
            "accountLabel": _account_label(aid),
            "target": tgt_repr,
            "sentAt": now_iso(),
            "error": detail,
            "success": False,
            "unresolved": True,
        })
        activity_log.append({
            "at": now_iso(), "type": "message_failed",
            "accountId": aid, "accountLabel": _account_label(aid),
            "target": tgt_repr,
            "message": detail,
        })

    try:
        while campaign_id not in CAMPAIGN_STOP_REQUESTED:
            # Re-check remaining targets
            remaining_total = sum(len(q) for q in account_queues.values())
            if remaining_total == 0:
                break

            # Re-read config from DB for live editing support
            fresh = await async_db_read(
                lambda conn: conn.execute(
                    "SELECT * FROM campaigns WHERE id = ?", (campaign_id,)
                ).fetchone()
            )
            if fresh:
                record = campaign_to_record(fresh)
                messages = record["messages"]
                blacklisted = record.get("blacklistedUsers", [])
                blacklisted_lower = {b.lower() for b in blacklisted if b}
                interval = record.get("messageIntervalSeconds", 5)
                daily_limit = record.get("dailyMessageLimitPerAccount", 0)

            # --- Global post-send interval wait ---
            # Scale the interval by how many accounts are actually able to send right now. When
            # peers are resting (flood / fail-cooldown / daily limit) the survivors slow down to
            # keep their original per-account cadence instead of bursting; it shrinks back to the
            # base interval automatically as accounts wake. Recomputed every iteration.
            now = datetime.now(UTC)
            _expected, _active = _active_expected(now)
            effective_interval = interval * _expected / max(1, _active) if _active else interval
            if last_send_time > 0:
                elapsed_since_send = time.time() - last_send_time
                if elapsed_since_send < effective_interval:
                    wait = effective_interval - elapsed_since_send
                    # Update UI: show the last sender as "resting" (interval), while preserving
                    # any genuine flood/fail/daily cooldown display on the other accounts.
                    now = datetime.now(UTC)
                    ru = now + timedelta(seconds=wait)
                    interval_reason = (
                        "Interval between sends"
                        if _active >= _expected
                        else f"Slowed: {_active}/{_expected} accounts active"
                    )
                    _refresh_account_states(
                        now,
                        interval_rest=True,
                        interval_until=ru.isoformat(),
                        interval_secs=int(wait),
                        interval_reason=interval_reason,
                    )
                    await _persist_campaign_activity(
                        account_stats=account_stats,
                        sent_items=sent_items,
                        total_targets=total_targets,
                        sent_count=sum(sent_counts.values()),
                        send_failures=sum(fail_counts.values()),
                        remaining_targets=remaining_total,
                    )
                    # Sleep in small increments to allow early stop
                    sleep_until = last_send_time + effective_interval
                    while time.time() < sleep_until and campaign_id not in CAMPAIGN_STOP_REQUESTED:
                        await asyncio.sleep(1)
                    if campaign_id in CAMPAIGN_STOP_REQUESTED:
                        break

            # Recompute every account's display state from the rest clocks each iteration, so
            # expired interval rests clear to idle/active while genuine flood/fail/daily cooldowns
            # stay visible (runs even when no interval wait was needed above).
            _refresh_account_states(datetime.now(UTC))

            # --- Find next account to send (round-robin) ---
            chosen_account: str | None = None
            chosen_target: dict[str, Any] | None = None

            # Start looking from the account after the last sender
            if last_sender_account is None:
                search_order = list(account_ids)
            else:
                try:
                    start_idx = account_ids.index(last_sender_account)
                except ValueError:
                    start_idx = -1
                search_order = account_ids[start_idx + 1:] + account_ids[:start_idx + 1]

            for account_id in search_order:
                if campaign_id in CAMPAIGN_STOP_REQUESTED:
                    break

                now = datetime.now(UTC)

                # Flood-wait rest: expiry clears the flood clock only — it must NOT reset the
                # daily counter, otherwise a flood would silently grant a fresh daily quota.
                flood_at = flood_reset_at.get(account_id)
                if flood_at is not None:
                    if now >= flood_at:
                        flood_reset_at[account_id] = None
                    else:
                        remaining = max(0, int((flood_at - now).total_seconds()))
                        for acct in account_stats:
                            if acct["accountId"] == account_id:
                                acct["state"] = "resting"
                                acct["restUntil"] = flood_at.isoformat()
                                acct["restSeconds"] = remaining
                                acct["restReason"] = "Flood wait"
                        continue

                # Generic-failure cooldown: short rest after a non-flood failure. Expiry clears
                # the cooldown only — like flood, it must NOT reset the daily counter.
                cooldown_at = fail_cooldown_at.get(account_id)
                if cooldown_at is not None:
                    if now >= cooldown_at:
                        fail_cooldown_at[account_id] = None
                    else:
                        remaining = max(0, int((cooldown_at - now).total_seconds()))
                        for acct in account_stats:
                            if acct["accountId"] == account_id:
                                acct["state"] = "resting"
                                acct["restUntil"] = cooldown_at.isoformat()
                                acct["restSeconds"] = remaining
                                acct["restReason"] = "Recovering from error"
                        continue

                # Daily-limit rest: expiry resets the daily counter for a fresh 24h window.
                reset_at = daily_reset_at.get(account_id)
                if reset_at is not None:
                    if now >= reset_at:
                        daily_sent[account_id] = 0
                        daily_window_start[account_id] = now
                        daily_reset_at[account_id] = None
                    else:
                        remaining = max(0, int((reset_at - now).total_seconds()))
                        for acct in account_stats:
                            if acct["accountId"] == account_id:
                                acct["state"] = "resting"
                                acct["restUntil"] = reset_at.isoformat()
                                acct["restSeconds"] = remaining
                                acct["restReason"] = f"Daily limit ({daily_limit}) reached"
                        continue

                # Roll the rolling-24h window first, then enforce the daily cap against the
                # window counter (daily_sent) — not the cumulative lifetime total.
                _roll_daily_window(account_id, now)
                if daily_limit > 0 and daily_sent.get(account_id, 0) >= daily_limit:
                    if daily_reset_at.get(account_id) is None:
                        daily_reset_at[account_id] = now + timedelta(hours=24)
                        activity_log.append({
                            "at": now_iso(), "type": "account_rest",
                            "accountId": account_id, "accountLabel": _account_label(account_id),
                            "message": f"Daily limit ({daily_limit}) reached; resting 24h",
                        })
                    for acct in account_stats:
                        if acct["accountId"] == account_id:
                            rd = daily_reset_at[account_id]
                            acct["state"] = "resting"
                            acct["restUntil"] = rd.isoformat()
                            acct["restSeconds"] = max(0, int((rd - now).total_seconds()))
                            acct["restReason"] = f"Daily limit ({daily_limit}) reached"
                    continue

                # Check if account has targets
                queue = account_queues.get(account_id, [])
                if not queue:
                    for acct in account_stats:
                        if acct["accountId"] == account_id:
                            acct["state"] = "idle"
                            acct.pop("restUntil", None)
                            acct.pop("restSeconds", None)
                            acct.pop("restReason", None)
                    continue

                # This account will send
                chosen_account = account_id
                chosen_target = queue.pop(0)
                break

            if chosen_account is None:
                stuck_iterations += 1
                # Staleness guard: force-clear expired rests if stuck too long
                if stuck_iterations >= MAX_STUCK_ITERATIONS:
                    now = datetime.now(UTC)
                    for aid in list(daily_reset_at.keys()):
                        rt = daily_reset_at.get(aid)
                        if rt and rt <= now:
                            daily_reset_at[aid] = None
                            daily_sent[aid] = 0
                            daily_window_start[aid] = now
                    still_stuck = any(
                        daily_reset_at.get(aid) is not None and daily_reset_at[aid] > now
                        for aid in account_ids
                    )
                    if not still_stuck:
                        stuck_iterations = 0
                        continue
                # No account could send — check if all queues empty or all at limit
                all_empty = all(len(account_queues.get(aid, [])) == 0 for aid in account_ids)
                if all_empty:
                    break
                # All remaining accounts are resting (daily limit, flood, or error cooldown) —
                # wait for whichever rest clock expires first, then re-evaluate.
                now = datetime.now(UTC)
                next_reset = None
                for clock in (daily_reset_at, flood_reset_at, fail_cooldown_at):
                    for v in clock.values():
                        if v is not None and v > now and (next_reset is None or v < next_reset):
                            next_reset = v
                if next_reset and next_reset > now:
                    while campaign_id not in CAMPAIGN_STOP_REQUESTED and datetime.now(UTC) < next_reset:
                        await _persist_campaign_activity(
                            account_stats=account_stats,
                            sent_items=sent_items,
                            total_targets=total_targets,
                            sent_count=sum(sent_counts.values()),
                            send_failures=sum(fail_counts.values()),
                            send_skipped=sum(skip_counts.values()),
                            remaining_targets=remaining_total,
                        )
                        await asyncio.sleep(min(30, max(1, int((next_reset - datetime.now(UTC)).total_seconds()))))
                else:
                    break
                continue

            # --- Send the message ---
            account_id = chosen_account
            target = chosen_target
            target_repr = target.get("username") or target["userId"]
            msg = messages[msg_rotation_idx % len(messages)]
            msg_rotation_idx += 1

            # --- Staging-group bootstrap (folder targets this account can't resolve itself) ---
            # No username and no shared context means a plain resolve would raise "Could not find
            # the input entity". Instead the owning account adds the target to the staging group so
            # this account can resolve + message it; it is kicked back out after the send below.
            bootstrap_owner_for_kick: str | None = None
            bootstrap_entity: Any = None
            _username = (target.get("username") or "").strip()
            _own_hash = account_user_hashes.get(account_id, {}).get(str(target.get("userId", "")))
            _owner_aid = target.get("ownerAccountId")
            _tuid_str = str(target.get("userId", "") or "")
            if (
                staging_enabled and not _username and not _own_hash
                and _owner_aid and _owner_aid != account_id
                and target.get("accessHash") and _tuid_str.lstrip("-").isdigit()
            ):
                _tuid = int(_tuid_str)
                add_status = await _owner_add_to_staging(_owner_aid, _tuid, target["accessHash"])
                if add_status == "privacy":
                    _record_unresolved(
                        account_id, target_repr,
                        f"Skipped {target_repr}: privacy settings prevent adding to resolution group",
                    )
                    await _persist_campaign_activity(
                        account_stats=account_stats, sent_items=sent_items, total_targets=total_targets,
                        sent_count=sum(sent_counts.values()), send_failures=sum(fail_counts.values()),
                        remaining_targets=sum(len(q) for q in account_queues.values()),
                    )
                    continue
                if add_status == "flood":
                    # Owner is rate-limited adding to the group — retry this target later.
                    account_queues[account_id].append(target)
                    activity_log.append({
                        "at": now_iso(), "type": "account_rest",
                        "accountId": _owner_aid, "accountLabel": _account_label(_owner_aid),
                        "target": target_repr,
                        "message": f"Owner flood adding {target_repr} to resolution group; will retry",
                    })
                    await asyncio.sleep(random.uniform(3, 8))
                    continue
                if add_status != "ok":
                    _requeue_or_drop(target, target_repr, account_id)
                    continue
                await asyncio.sleep(1)
                async with _account_session_lock(account_id):
                    sclient = await _get_client(account_id)
                    bootstrap_entity = await _resolve_in_staging(sclient, account_id, _tuid)
                if bootstrap_entity is None:
                    await _owner_kick_from_staging(_owner_aid, _tuid, target["accessHash"])
                    _record_unresolved(
                        account_id, target_repr,
                        f"Could not resolve {target_repr} via resolution group after adding",
                    )
                    await _persist_campaign_activity(
                        account_stats=account_stats, sent_items=sent_items, total_targets=total_targets,
                        sent_count=sum(sent_counts.values()), send_failures=sum(fail_counts.values()),
                        remaining_targets=sum(len(q) for q in account_queues.values()),
                    )
                    continue
                bootstrap_owner_for_kick = _owner_aid

            send_success = False
            is_flood = False
            skip_because_messaged = False
            try:
                lock = _account_session_lock(account_id)
                async with lock:
                    try:
                        client = await _get_client(account_id)
                        if bootstrap_entity is not None:
                            entity = bootstrap_entity
                            access_hash = getattr(bootstrap_entity, "access_hash", None)
                        else:
                            own_hash = account_user_hashes.get(account_id, {}).get(str(target.get("userId", "")))
                            access_hash = own_hash or target.get("accessHash")
                            entity = await _resolve_entity(client, target.get("username") or int(target["userId"]), access_hash)
                        if skip_messaged:
                            try:
                                recent = await client.get_messages(entity, limit=10)
                                sent_texts = {
                                    (getattr(m, 'message', '') or '').strip()
                                    for m in recent if getattr(m, 'out', False)
                                }
                                if any((m or '').strip() in sent_texts for m in messages):
                                    skip_because_messaged = True
                            except Exception:
                                pass
                        if not skip_because_messaged:
                            sent_message = await client.send_message(entity, msg)
                            chat_id = str(getattr(entity, "id", target.get("userId") or target_repr))
                            sent_counts[account_id] += 1
                            daily_sent[account_id] += 1
                            send_success = True
                            # One good send ends any lingering error cooldown early and clears
                            # peer-flood strikes (the account is messaging fine again).
                            fail_cooldown_at[account_id] = None
                            peer_flood_strikes[account_id] = 0
                            sent_items.append({
                                "accountId": account_id,
                                "accountLabel": _account_label(account_id),
                                "target": target_repr,
                                "chatId": chat_id,
                                "messageId": getattr(sent_message, "id", None),
                                "message": msg[:100],
                                "sentAt": now_iso(),
                                "accessHash": access_hash,
                            })
                            activity_log.append({
                                "at": now_iso(), "type": "message_sent",
                                "accountId": account_id, "accountLabel": _account_label(account_id),
                                "target": target_repr,
                                "message": f"Sent to {target_repr}",
                            })
                    finally:
                        await _evict_client(account_id)
            except FloodWaitError as fwe:
                seconds = getattr(fwe, 'seconds', 3600)
                FLOODED_ACCOUNTS[account_id] = time.time() + seconds
                rest_until = datetime.now(UTC) + timedelta(seconds=seconds)
                flood_reset_at[account_id] = rest_until
                is_flood = True
                fail_counts[account_id] = fail_counts.get(account_id, 0) + 1
                # Re-queue at the BACK with the attempt cap so the account tries a different
                # target when its flood wait expires instead of re-hitting this one.
                _requeue_or_drop(target, target_repr, account_id)
                detail = f"Flood wait {seconds}s for {target_repr}"
                sent_items.append({
                    "accountId": account_id,
                    "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": msg[:100],
                    "sentAt": now_iso(),
                    "error": detail,
                    "success": False,
                })
                activity_log.append({
                    "at": now_iso(), "type": "message_failed",
                    "accountId": account_id, "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": detail,
                })
            except PeerFloodError:
                FLOODED_ACCOUNTS[account_id] = time.time() + 3600
                rest_until = datetime.now(UTC) + timedelta(hours=1)
                flood_reset_at[account_id] = rest_until
                is_flood = True
                fail_counts[account_id] = fail_counts.get(account_id, 0) + 1
                # PeerFloodError is an account-level spam restriction. Count a strike; after
                # MAX_PEER_FLOOD_STRIKES burn the account (drain + remove) so the run finishes
                # instead of re-flooding forever. Otherwise re-queue this target at the BACK
                # (with the attempt cap) so the account moves on to other targets on wake.
                peer_flood_strikes[account_id] = peer_flood_strikes.get(account_id, 0) + 1
                if peer_flood_strikes[account_id] >= MAX_PEER_FLOOD_STRIKES:
                    _burn_account(account_id, "Peer flood: account spam-restricted, stopping after repeated strikes")
                else:
                    _requeue_or_drop(target, target_repr, account_id)
                detail = f"Peer flood for {target_repr} (cooldown 1h)"
                sent_items.append({
                    "accountId": account_id,
                    "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": msg[:100],
                    "sentAt": now_iso(),
                    "error": detail,
                    "success": False,
                })
                activity_log.append({
                    "at": now_iso(), "type": "message_failed",
                    "accountId": account_id, "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": detail,
                })
            except ValueError as e:
                err_msg = str(e)
                if "Could not find the input entity" in err_msg:
                    # Permanently unresolvable — do NOT re-queue
                    unresolved_targets.add(target_repr)
                    fail_counts[account_id] = fail_counts.get(account_id, 0) + 1
                    detail = f"Unresolvable target {target_repr}: {err_msg[:200]}"
                    sent_items.append({
                        "accountId": account_id,
                        "accountLabel": _account_label(account_id),
                        "target": target_repr,
                        "message": msg[:100],
                        "sentAt": now_iso(),
                        "error": detail,
                        "success": False,
                        "unresolved": True,
                    })
                    activity_log.append({
                        "at": now_iso(), "type": "message_failed",
                        "accountId": account_id, "accountLabel": _account_label(account_id),
                        "target": target_repr,
                        "message": detail,
                    })
                else:
                    fail_counts[account_id] = fail_counts.get(account_id, 0) + 1
                    _requeue_or_drop(target, target_repr, account_id)
                    # Brief cooldown so survivors slow down and this account doesn't burst-retry.
                    fail_cooldown_at[account_id] = datetime.now(UTC) + timedelta(seconds=FAIL_COOLDOWN_SECONDS)
                    detail = f"Failed for {target_repr}: [ValueError] {err_msg[:200]}"
                    sent_items.append({
                        "accountId": account_id,
                        "accountLabel": _account_label(account_id),
                        "target": target_repr,
                        "message": msg[:100],
                        "sentAt": now_iso(),
                        "error": detail,
                        "success": False,
                    })
                    activity_log.append({
                        "at": now_iso(), "type": "message_failed",
                        "accountId": account_id, "accountLabel": _account_label(account_id),
                        "target": target_repr,
                        "message": detail,
                    })
            except Exception as e:
                fail_counts[account_id] = fail_counts.get(account_id, 0) + 1
                err_type = type(e).__name__
                err_msg = str(e)[:200]
                if "FLOOD" in err_type.upper() or "FLOOD" in err_msg.upper():
                    FLOODED_ACCOUNTS[account_id] = time.time() + 3600
                target_uid = target.get("userId", "?")
                target_uname = target.get("username") or "-"
                target_hash = str(target.get("accessHash", ""))[:20]
                detail = f"Failed for {target_repr}: [{err_type}] {err_msg} (uid={target_uid} uname={target_uname} hash={target_hash})"
                sent_items.append({
                    "accountId": account_id,
                    "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": msg[:100],
                    "sentAt": now_iso(),
                    "error": detail,
                    "success": False,
                })
                activity_log.append({
                    "at": now_iso(), "type": "message_failed",
                    "accountId": account_id, "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": detail,
                })
                # Re-queue for retry — put at back of queue (retried after all other targets)
                # unless it has exhausted its attempt budget, in which case it is dropped.
                _requeue_or_drop(target, target_repr, account_id)
                # Brief cooldown so survivors slow down and this account doesn't burst-retry.
                fail_cooldown_at[account_id] = datetime.now(UTC) + timedelta(seconds=FAIL_COOLDOWN_SECONDS)

            # Kick the target back out of the staging group (regardless of send outcome), then a
            # short randomized rest before the next account goes — keeps the group near-empty and
            # paces the add/kick churn.
            if bootstrap_owner_for_kick and _tuid_str.lstrip("-").isdigit():
                await _owner_kick_from_staging(bootstrap_owner_for_kick, int(_tuid_str), target["accessHash"])
                await asyncio.sleep(random.uniform(1.5, 4.0))

            if skip_because_messaged:
                skip_counts[account_id] = skip_counts.get(account_id, 0) + 1
                sent_items.append({
                    "accountId": account_id,
                    "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": msg[:100],
                    "sentAt": now_iso(),
                    "skipped": True,
                })
                activity_log.append({
                    "at": now_iso(), "type": "message_skipped",
                    "accountId": account_id, "accountLabel": _account_label(account_id),
                    "target": target_repr,
                    "message": f"Skipped {target_repr} (already messaged)",
                })
                elapsed = (datetime.now(UTC) - start_time).total_seconds()
                for acct in account_stats:
                    if acct["accountId"] == account_id:
                        acct["sentCount"] = sent_counts.get(account_id, 0)
                        acct["dailySent"] = daily_sent.get(account_id, 0)
                        acct["dailyWindowStart"] = (daily_window_start.get(account_id) or start_time).isoformat()
                        acct["sendFailures"] = fail_counts.get(account_id, 0)
                        acct["sendFailed"] = fail_counts.get(account_id, 0)
                        acct["skippedCount"] = skip_counts.get(account_id, 0)
                        acct["attemptedTargets"] = acct["sentCount"] + acct["sendFailures"] + acct["skippedCount"]
                _refresh_account_states(datetime.now(UTC))
                remaining_total = sum(len(q) for q in account_queues.values())
                unresolved_count = len(unresolved_targets)
                resolved = max(0, total_targets - unresolved_count)
                total_skipped = sum(skip_counts.values())
                await _persist_campaign_activity(
                    account_stats=account_stats,
                    total_targets=total_targets,
                    sent_count=sum(sent_counts.values()),
                    send_failures=sum(fail_counts.values()),
                    send_skipped=total_skipped,
                    remaining_targets=remaining_total,
                )
                continue

            # Always record send time for global interval wait (even on failure)
            # EXCEPT for flood waits — the flood rest period IS the interval
            if not is_flood:
                stuck_iterations = 0
                last_send_time = time.time()
                last_sender_account = account_id

            # Update per-account counters for the sender; state is recomputed below from the
            # rest clocks so flood / fail-cooldown / daily limit all display correctly.
            elapsed = (datetime.now(UTC) - start_time).total_seconds()
            for acct in account_stats:
                if acct["accountId"] == account_id:
                    acct["sentCount"] = sent_counts.get(account_id, 0)
                    acct["dailySent"] = daily_sent.get(account_id, 0)
                    acct["dailyWindowStart"] = (daily_window_start.get(account_id) or start_time).isoformat()
                    acct["sendFailures"] = fail_counts.get(account_id, 0)
                    acct["sendFailed"] = fail_counts.get(account_id, 0)
                    acct["skippedCount"] = skip_counts.get(account_id, 0)
                    acct["attemptedTargets"] = acct["sentCount"] + acct["sendFailures"] + acct["skippedCount"]
            _refresh_account_states(datetime.now(UTC))

            remaining_total = sum(len(q) for q in account_queues.values())
            unresolved_count = len(unresolved_targets)
            resolved = max(0, total_targets - unresolved_count)
            summary = {
                "ok": True,
                "campaignId": campaign_id,
                "name": record["name"],
                "createdAt": record["createdAt"],
                "dailyMessageLimitPerAccount": daily_limit,
                "messageRotation": messages,
                "messageIntervalSeconds": interval,
                "totalTargets": total_targets,
                "resolvedTargets": resolved,
                "unresolvedTargets": unresolved_count,
                "previouslyMessagedTargets": 0,
                "skippedCount": sum(skip_counts.values()),
                "sentCount": sum(sent_counts.values()),
                "sendFailures": sum(fail_counts.values()),
                "remainingTargets": remaining_total,
                "estimatedSecondsRemaining": int(max(0, remaining_total) * interval),
                "estimatedMinutesRemaining": round((max(0, remaining_total) * interval) / 60, 1),
                "elapsedSeconds": int(elapsed),
                "assignments": [],
                "unresolved": list(unresolved_targets)[:100],
                "previouslyMessaged": [],
                "sentItems": sent_items[-2000:],
                "activityLog": activity_log[-120:],
                "lastSenderAccount": last_sender_account,
                "lastSendTime": last_send_time,
                "accountStats": account_stats,
                "status": "running",
            }
            nowm = time.monotonic()
            if nowm - _persist_meta["last"] >= PERSIST_MIN_INTERVAL:
                _persist_meta["last"] = nowm
                payload = json.dumps(summary)
                await async_db_write(
                    lambda conn: conn.execute(
                        "UPDATE campaigns SET last_run_summary_json = ? WHERE id = ?",
                        (payload, campaign_id),
                    )
                )
    except asyncio.CancelledError:
        pass
    finally:
        CAMPAIGN_SCRAPED_MEMBERS.pop(campaign_id, None)
        # Disconnect every reused client opened during this run. Leaving them connected
        # leaks sockets and keeps the .session SQLite file locked for the next run.
        for aid in list(clients.keys()):
            await _evict_client(aid)
        was_paused = campaign_id in CAMPAIGN_PAUSE_REQUESTED
        CAMPAIGN_PAUSE_REQUESTED.discard(campaign_id)
        was_stopped = campaign_id in CAMPAIGN_STOP_REQUESTED
        CAMPAIGN_STOP_REQUESTED.discard(campaign_id)
        remaining_in_queues = sum(len(q) for q in account_queues.values())
        if was_paused:
            final_status = "paused"
        elif was_stopped:
            final_status = "stopped"
        else:
            final_status = "completed_with_failures" if sum(fail_counts.values()) > 0 else "completed"
        total_sent = sum(sent_counts.values())
        if not was_stopped and not was_paused and remaining_in_queues > 0 and total_sent > 0:
            final_status = "completed_with_failures"
        elif not was_stopped and not was_paused and remaining_in_queues == 0:
            final_status = "completed"
        if was_paused:
            done_type, done_msg = "campaign_paused", "Campaign paused"
        elif was_stopped:
            done_type, done_msg = "campaign_stopped", "Campaign stopped"
        else:
            done_type, done_msg = "campaign_done", "Campaign completed"
        activity_log.append({
            "at": now_iso(),
            "type": done_type,
            "message": done_msg,
        })
        await _persist_campaign_activity(
            status=final_status,
            account_stats=account_stats,
            sent_items=sent_items,
            total_targets=total_targets,
            sent_count=total_sent,
            send_failures=sum(fail_counts.values()),
            send_skipped=sum(skip_counts.values()),
            remaining_targets=remaining_in_queues,
            force=True,
        )
        _update_campaign_status(campaign_id, final_status)


async def resume_running_campaigns() -> None:
    """Resume campaigns left as 'running' after the process stopped.

    On a fresh process there are no in-memory tasks, so every DB row marked 'running' is
    an interrupted campaign. Real in-process crashes are now reliably marked 'failed' by
    _campaign_done_callback, so anything still 'running' here was interrupted by a hard
    stop (kill/power loss). We resume those, but guard against a resume-crash loop: if a
    campaign has already been auto-resumed too many times, mark it 'failed' instead of
    resurrecting it forever.
    """
    MAX_RESUME_ATTEMPTS = 3
    rows = await async_db_read(
        lambda conn: conn.execute(
            "SELECT id, last_run_summary_json FROM campaigns WHERE status = 'running'"
        ).fetchall()
    )

    for row in rows:
        campaign_id = row["id"]

        # Skip anything already tracked in this process (defensive — shouldn't happen at startup).
        if campaign_id in CAMPAIGN_TASKS and not CAMPAIGN_TASKS[campaign_id].done():
            continue

        try:
            summary = json.loads(row["last_run_summary_json"]) if row["last_run_summary_json"] else {}
        except Exception:
            summary = {}
        attempts = int(summary.get("resumeAttempts", 0)) + 1

        if attempts > MAX_RESUME_ATTEMPTS:
            logger.warning(
                "Campaign %s exceeded %d auto-resume attempts; marking failed",
                campaign_id, MAX_RESUME_ATTEMPTS,
            )
            summary["status"] = "failed"
            events = summary.get("activityLog") or []
            events.append({
                "at": now_iso(),
                "type": "campaign_failed",
                "message": f"Auto-resume gave up after {MAX_RESUME_ATTEMPTS} attempts",
            })
            summary["activityLog"] = events[-120:]
            payload = json.dumps(summary)
            await async_db_write(
                lambda conn, p=payload, cid=campaign_id: conn.execute(
                    "UPDATE campaigns SET status = 'failed', updated_at = ?, last_finished_at = ?, last_run_summary_json = ? WHERE id = ?",
                    (now_iso(), now_iso(), p, cid),
                )
            )
            continue

        # Record the incremented attempt counter so a relaunch that crashes again converges.
        summary["resumeAttempts"] = attempts
        payload = json.dumps(summary)
        try:
            await async_db_write(
                lambda conn, p=payload, cid=campaign_id: conn.execute(
                    "UPDATE campaigns SET last_run_summary_json = ? WHERE id = ?", (p, cid)
                )
            )
        except Exception:
            logger.exception("Failed to record resume attempt for campaign %s", campaign_id)

        async with CAMPAIGN_TASK_LOCK:
            task = asyncio.create_task(_run_campaign_worker(campaign_id))
            CAMPAIGN_TASKS[campaign_id] = task
            task.add_done_callback(_campaign_done_callback(campaign_id))
