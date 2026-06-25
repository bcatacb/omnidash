import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from telethon.tl.functions.messages import GetPeerDialogsRequest
from telethon.tl.types import InputDialogPeer, InputPeerChannel, InputPeerChat, InputPeerUser

from ..core.database import db, db_write, now_iso


def dedupe_sent_items(sent_items: list[dict]) -> list[dict]:
    """Collapse retried sends to one entry per contact.

    Keys on the stable target identity (NOT chatId, which is null on failed sends) so a
    success record and a failed record for the same contact collapse to one. Sort order
    keeps the "best" record (success > replied > most recent) as the survivor.
    """
    seen: set[tuple] = set()
    out: list[dict] = []
    for item in sorted(
        sent_items,
        key=lambda x: (x.get("success", True) is not False, bool(x.get("replied")), x.get("sentAt") or ""),
        reverse=True,
    ):
        key = (item.get("accountId"), (item.get("target") or item.get("chatId") or "").strip().lower())
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def successful_leads(sent_items: list[dict]) -> list[dict]:
    """Deduped sent items with failed sends removed — the real, unique contacts."""
    return [i for i in dedupe_sent_items(sent_items) if i.get("success", True) is not False]


def _is_group_entity(entity: Any) -> bool:
    return bool(
        getattr(entity, "broadcast", False)
        or getattr(entity, "megagroup", False)
        or getattr(entity, "gigagroup", False)
        or getattr(entity, "chat", False)
    )


async def check_replied(
    client: Any, entity: Any, message_id: int, sent_at: datetime | None
) -> tuple[bool, int, str | None]:
    """Count incoming messages that arrived after our campaign message.

    Returns (replied, reply_count, last_reply_at_iso). DM-only — groups return (False, 0, None).
    """
    if _is_group_entity(entity):
        return (False, 0, None)
    sent_at = _normalize_dt(sent_at)
    reply_count = 0
    last_reply_at: str | None = None
    messages = await client.get_messages(entity, limit=80)
    for msg in messages:
        if getattr(msg, "out", False):
            continue
        msg_date = getattr(msg, "date", None)
        msg_id = int(getattr(msg, "id", 0) or 0)
        is_after_sent = False
        if message_id and msg_id > message_id:
            is_after_sent = True
        elif sent_at and msg_date and msg_date.astimezone(UTC) > sent_at:
            is_after_sent = True
        if not is_after_sent:
            continue
        reply_count += 1
        if msg_date:
            iso = msg_date.astimezone(UTC).isoformat()
            if not last_reply_at or iso > last_reply_at:
                last_reply_at = iso
    return (reply_count > 0, reply_count, last_reply_at)


async def check_seen(client: Any, entity: Any, message_id: int) -> bool:
    """Return True if our message_id has been read by the recipient (DM read receipt)."""
    if not message_id or _is_group_entity(entity):
        return False
    input_peer: Any = InputPeerUser(user_id=entity.id, access_hash=getattr(entity, "access_hash", 0))
    if hasattr(entity, "chat_id"):
        input_peer = InputPeerChat(chat_id=entity.id)
    elif hasattr(entity, "broadcast") or hasattr(entity, "megagroup") or hasattr(entity, "gigagroup"):
        input_peer = InputPeerChannel(channel_id=entity.id, access_hash=getattr(entity, "access_hash", 0))
    result = await client(GetPeerDialogsRequest(peers=[InputDialogPeer(peer=input_peer)]))
    if not result.dialogs:
        return False
    read_inbox_max_id = getattr(result.dialogs[0], "read_inbox_max_id", 0) or 0
    return int(message_id) <= int(read_inbox_max_id)


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _append_group_event(events: list[dict[str, Any]], event: dict[str, Any], max_size: int = 400) -> list[dict[str, Any]]:
    events.append(event)
    if len(events) > max_size:
        events = events[-max_size:]
    return events


def _append_group_failure(
    failures: list[dict[str, Any]], failure: dict[str, Any], max_size: int = 300
) -> list[dict[str, Any]]:
    failures.append(failure)
    if len(failures) > max_size:
        failures = failures[-max_size:]
    return failures


def _campaign_account_label_map(user_id: str) -> dict[str, str]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name FROM accounts WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    mapping: dict[str, str] = {}
    for row in rows:
        mapping[row["id"]] = row["display_name"] or row["username"] or row["id"]
    return mapping


def _replace_group_candidates(
    campaign_id: str, user_id: str, scraper_account_id: str, members: list[dict[str, Any]]
) -> int:
    with db() as conn:
        conn.execute(
            "DELETE FROM group_scraper_candidates WHERE campaign_id = ? AND user_id = ? AND scraper_account_id = ?",
            (campaign_id, user_id, scraper_account_id),
        )
        ts = now_iso()
        for item in members:
            conn.execute(
                """
                INSERT OR REPLACE INTO group_scraper_candidates (
                    campaign_id, user_id, scraper_account_id, member_id, access_hash, username, display_name,
                    status, invited_by, last_error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
                """,
                (
                    campaign_id,
                    user_id,
                    scraper_account_id,
                    str(item.get("member_id", "")),
                    str(item.get("access_hash")) if item.get("access_hash") is not None else None,
                    item.get("username"),
                    item.get("display_name"),
                    ts,
                    ts,
                ),
            )
        return len(members)


def _next_pending_candidate(campaign_id: str, scraper_account_id: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            """
            SELECT * FROM group_scraper_candidates
            WHERE campaign_id = ? AND scraper_account_id = ? AND status = 'pending'
            ORDER BY id ASC
            LIMIT 1
            """,
            (campaign_id, scraper_account_id),
        ).fetchone()


def _pending_candidate_count(campaign_id: str, scraper_account_id: str | None = None) -> int:
    with db() as conn:
        if scraper_account_id:
            row = conn.execute(
                """
                SELECT COUNT(*) as c
                FROM group_scraper_candidates
                WHERE campaign_id = ? AND scraper_account_id = ? AND status = 'pending'
                """,
                (campaign_id, scraper_account_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) as c FROM group_scraper_candidates WHERE campaign_id = ? AND status = 'pending'",
                (campaign_id,),
            ).fetchone()
        return int(row["c"] if row else 0)


def _mark_candidate_result(
    campaign_id: str,
    scraper_account_id: str,
    member_id: str,
    status: str,
    invited_by: str | None = None,
    error: str | None = None,
) -> None:
    with db() as conn:
        conn.execute(
            """
            UPDATE group_scraper_candidates
            SET status = ?, invited_by = ?, last_error = ?, updated_at = ?
            WHERE campaign_id = ? AND scraper_account_id = ? AND member_id = ?
            """,
            (status, invited_by, error, now_iso(), campaign_id, scraper_account_id, str(member_id)),
        )


def campaign_to_record(row: sqlite3.Row) -> dict[str, Any]:
    summary = json.loads(row["last_run_summary_json"]) if row["last_run_summary_json"] else None
    sent_items = (summary or {}).get("sentItems") or []
    # Count unique successfully-contacted leads so this matches the de-duped leads list.
    deduped = successful_leads(sent_items)
    sent_count = len(deduped)
    replied_count = sum(1 for item in deduped if item.get("replied"))
    with db() as conn:
        seen_row = conn.execute(
            "SELECT COUNT(*) AS c FROM campaign_seen WHERE campaign_id = ? AND seen = 1",
            (row["id"],),
        ).fetchone()
        seen_count = seen_row["c"] if seen_row else 0
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "status": row["status"],
        "accountIds": json.loads(row["account_ids_json"]),
        "dailyMessageLimitPerAccount": row["daily_message_limit_per_account"],
        "messages": json.loads(row["messages_json"]),
        "targetsCsv": row["targets_csv"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastStartedAt": row["last_started_at"],
        "lastFinishedAt": row["last_finished_at"],
        "lastRunSummary": summary,
        "sourceGroup": row["source_group"],
        "sourceFolder": row["source_folder"] if ("source_folder" in row.keys()) else None,
        "resolutionGroup": row["resolution_group"] if ("resolution_group" in row.keys()) else None,
        "folderFilterTags": json.loads(row["folder_filter_tags_json"]) if ("folder_filter_tags_json" in row.keys() and row["folder_filter_tags_json"]) else [],
        "blacklistedUsers": json.loads(row["blacklisted_users_json"]) if row["blacklisted_users_json"] else [],
        "messageIntervalSeconds": row["message_interval_seconds"],
        "campaignType": row["campaign_type"],
        "sortByActivity": row["sort_by_activity"],
        "skipMessaged": bool(row["skip_messaged"]),
        "scrapedTargets": json.loads(row["scraped_targets_json"])
        if row["scraped_targets_json"]
        else None,
        "sentCount": sent_count,
        "seenCount": seen_count,
        "repliedCount": replied_count,
        "followUp": json.loads(row["followup_config_json"])
        if ("followup_config_json" in row.keys() and row["followup_config_json"])
        else None,
    }


def _start_response(record: dict[str, Any], previous_summary: dict[str, Any] | None = None) -> dict[str, Any]:
    targets = []
    camp_type = record.get("campaignType", "csv")
    scraped = record.get("scrapedTargets")
    if scraped:
        for m in scraped:
            targets.append(m.get("username") or m.get("userId") or "")
    elif record.get("sourceGroup"):
        targets = []
    else:
        targets = [item.strip() for item in record["targetsCsv"].split(",") if item.strip()]
    account_ids = record["accountIds"]
    total_accounts = len(account_ids)
    chunk_size = len(targets) // total_accounts if total_accounts else 0
    remainder = len(targets) % total_accounts if total_accounts else 0
    per_account_counts: dict[str, int] = {}
    assignments: list[dict[str, Any]] = []
    start = 0
    for i, aid in enumerate(account_ids):
        extra = 1 if i < remainder else 0
        count = chunk_size + extra
        per_account_counts[aid] = count
        targets_for_aid = targets[start:start + count]
        assignments.append({
            "accountId": aid,
            "accountLabel": aid[:8],
            "assignedTargets": targets_for_aid,
            "resolvableTargets": targets_for_aid,
            "unresolvedTargets": [],
        })
        start += count
    prev_stats_by_id: dict[str, dict[str, Any]] = {}
    if previous_summary:
        for s in previous_summary.get("accountStats", []):
            prev_stats_by_id[s["accountId"]] = s
    stats = [
        {
            "accountId": aid,
            "accountLabel": aid[:8],
            "assignedTargets": per_account_counts.get(aid, 0),
            "resolvedTargets": per_account_counts.get(aid, 0),
            "unresolvedTargets": 0,
            "attemptedTargets": prev_stats_by_id.get(aid, {}).get("attemptedTargets", 0),
            "sentCount": prev_stats_by_id.get(aid, {}).get("sentCount", 0),
            "sendFailures": prev_stats_by_id.get(aid, {}).get("sendFailures", 0),
            "repliedTargets": prev_stats_by_id.get(aid, {}).get("repliedTargets", 0),
            "replyMessages": prev_stats_by_id.get(aid, {}).get("replyMessages", 0),
            "state": "active",
        }
        for aid in account_ids
    ]
    estimated_seconds = len(targets) * record.get("messageIntervalSeconds", 5)
    result: dict[str, Any] = {
        "ok": True,
        "campaignId": record["id"],
        "name": record["name"],
        "createdAt": record["createdAt"],
        "dailyMessageLimitPerAccount": record["dailyMessageLimitPerAccount"],
        "messageRotation": record["messages"],
        "messageIntervalSeconds": record.get("messageIntervalSeconds", 5),
        "totalTargets": len(targets),
        "resolvedTargets": len(targets),
        "unresolvedTargets": 0,
        "previouslyMessagedTargets": 0,
        "estimatedSecondsRemaining": estimated_seconds,
        "estimatedMinutesRemaining": round(estimated_seconds / 60, 1),
        "assignments": assignments,
        "unresolved": [],
        "previouslyMessaged": [],
        "activityLog": (previous_summary or {}).get("activityLog", [])[-120:],
        "accountStats": stats,
        "sentItems": (previous_summary or {}).get("sentItems", [])[-80:],
    }
    if previous_summary:
        result["sentCount"] = previous_summary.get("sentCount", 0)
        result["sendFailures"] = previous_summary.get("sendFailures", 0)
        result["elapsedSeconds"] = previous_summary.get("elapsedSeconds", 0)
    else:
        result["sentCount"] = 0
        result["sendFailures"] = 0
    return result


def _set_campaign_status(conn: sqlite3.Connection, campaign_id: str, user_id: str, status: str) -> sqlite3.Row:
    now = now_iso()
    started = now if status == "running" else None
    finished = now if status in {"stopped", "completed", "completed_with_failures", "failed", "validation_failed"} else None
    conn.execute(
        """
        UPDATE campaigns
        SET status = ?, updated_at = ?, last_started_at = COALESCE(?, last_started_at),
            last_finished_at = COALESCE(?, last_finished_at)
        WHERE id = ? AND user_id = ?
        """,
        (status, now, started, finished, campaign_id, user_id),
    )
    row = conn.execute(
        "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
        (campaign_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return row


def _update_campaign_status(campaign_id: str, status: str) -> None:
    def _write(conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            UPDATE campaigns
            SET status = ?, updated_at = ?,
                last_finished_at = COALESCE(?, last_finished_at)
            WHERE id = ?
            """,
            (
                status,
                now_iso(),
                now_iso()
                if status in {"stopped", "completed", "completed_with_failures", "failed", "validation_failed"}
                else None,
                campaign_id,
            ),
        )

    db_write(_write)


def _default_group_stats(inviter_ids: list[str]) -> dict[str, Any]:
    return {
        "joinedAccounts": len(inviter_ids),
        "totalAccounts": len(inviter_ids),
        "scrapedCount": 0,
        "totalCandidates": 0,
        "remainingCandidates": 0,
        "attempted": 0,
        "added": 0,
        "skipped": 0,
        "failed": 0,
        "blockedAccounts": [],
        "activeAccountId": inviter_ids[0] if inviter_ids else None,
        "activeAccountLabel": inviter_ids[0][:8] if inviter_ids else None,
        "activePhase": "idle",
        "activeGroup": None,
        "initialTargetGroupMembers": 0,
        "targetGroupMembers": 0,
        "addedByCampaign": 0,
        "accountStates": [
            {
                "accountId": inviter_id,
                "accountLabel": inviter_id[:8],
                "state": "idle",
                "attempted": 0,
                "added": 0,
                "skipped": 0,
                "failed": 0,
                "restSeconds": 0,
                "restUntil": None,
                "restReason": None,
                "lastMember": None,
                "lastMessage": None,
                "lastEventAt": None,
                "pendingCandidates": 0,
            }
            for inviter_id in inviter_ids
        ],
    }


def _apply_live_rest_state(stats: dict[str, Any]) -> dict[str, Any]:
    account_states = stats.get("accountStates") or []
    now = datetime.now(UTC)
    for state in account_states:
        rest_until = state.get("restUntil")
        if not rest_until:
            continue
        try:
            until_dt = datetime.fromisoformat(rest_until)
        except Exception:
            state["restUntil"] = None
            state["restSeconds"] = 0
            state["restReason"] = None
            if state.get("state") == "cooldown":
                state["state"] = "idle"
            continue
        remaining = int((until_dt - now).total_seconds())
        if remaining > 0:
            state["restSeconds"] = remaining
            if state.get("state") != "cooldown":
                state["state"] = "cooldown"
        else:
            state["restUntil"] = None
            state["restSeconds"] = 0
            state["restReason"] = None
            if state.get("state") == "cooldown":
                state["state"] = "idle"
    stats["accountStates"] = account_states
    return stats


def _group_record(row: sqlite3.Row) -> dict[str, Any]:
    stats = _apply_live_rest_state(json.loads(row["stats_json"]))
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "status": row["status"],
        "sourceAccountId": row["source_account_id"],
        "inviterAccountIds": json.loads(row["inviter_account_ids_json"]),
        "sourceGroup": row["source_group"],
        "targetGroup": row["target_group"],
        "maxMembers": row["max_members"],
        "delaySeconds": row["delay_seconds"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastStartedAt": row["last_started_at"],
        "lastFinishedAt": row["last_finished_at"],
        "stats": stats,
        "events": json.loads(row["events_json"]),
        "failures": json.loads(row["failures_json"]),
    }


def _load_group_campaign_row(campaign_id: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE id = ?",
            (campaign_id,),
        ).fetchone()


def _persist_group_campaign_runtime(
    campaign_id: str,
    *,
    status: str | None = None,
    stats: dict[str, Any] | None = None,
    events: list[dict[str, Any]] | None = None,
    failures: list[dict[str, Any]] | None = None,
    finished: bool = False,
) -> sqlite3.Row:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE id = ?",
            (campaign_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        conn.execute(
            """
            UPDATE group_scraper_campaigns
            SET status = COALESCE(?, status),
                stats_json = COALESCE(?, stats_json),
                events_json = COALESCE(?, events_json),
                failures_json = COALESCE(?, failures_json),
                updated_at = ?,
                last_finished_at = COALESCE(?, last_finished_at)
            WHERE id = ?
            """,
            (
                status,
                json.dumps(stats) if stats is not None else None,
                json.dumps(events) if events is not None else None,
                json.dumps(failures) if failures is not None else None,
                now_iso(),
                now_iso() if finished else None,
                campaign_id,
            ),
        )
        updated = conn.execute(
            "SELECT * FROM group_scraper_campaigns WHERE id = ?",
            (campaign_id,),
        ).fetchone()
        return updated


def _touch_group_status(
    conn: sqlite3.Connection, campaign_id: str, user_id: str, status: str
) -> sqlite3.Row:
    now = now_iso()
    conn.execute(
        """
        UPDATE group_scraper_campaigns
        SET status = ?, updated_at = ?, last_started_at = COALESCE(?, last_started_at), last_finished_at = COALESCE(?, last_finished_at)
        WHERE id = ? AND user_id = ?
        """,
        (
            status,
            now,
            now if status == "running" else None,
            now if status in {"stopped", "finished"} else None,
            campaign_id,
            user_id,
        ),
    )
    row = conn.execute(
        "SELECT * FROM group_scraper_campaigns WHERE id = ? AND user_id = ?",
        (campaign_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return row
