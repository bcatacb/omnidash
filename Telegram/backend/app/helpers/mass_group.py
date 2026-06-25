from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..core.database import db, now_iso

_MAX_EVENTS = 500
_MAX_FAILURES = 500


def _default_mass_stats(usernames: list[str]) -> dict[str, Any]:
    return {
        "totalUsernames": len(usernames),
        "groupsCreated": 0,
        "failed": 0,
        "processed": 0,
        "activeUsername": None,
    }


def _mass_group_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "status": row["status"],
        "titleTemplate": row["title_template"],
        "adminAccountIds": json.loads(row["admin_account_ids_json"]),
        "creatorAccountIds": json.loads(row["creator_account_ids_json"]),
        "usernames": json.loads(row["usernames_json"]),
        "delaySeconds": row["delay_seconds"],
        "stats": json.loads(row["stats_json"]),
        "events": json.loads(row["events_json"]),
        "failures": json.loads(row["failures_json"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastStartedAt": row["last_started_at"],
        "lastFinishedAt": row["last_finished_at"],
    }


def _load_mass_group_row(campaign_id: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            "SELECT * FROM mass_group_campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()


def _append_event(events: list[dict[str, Any]], event: dict[str, Any]) -> list[dict[str, Any]]:
    events = list(events)
    events.append(event)
    if len(events) > _MAX_EVENTS:
        events = events[-_MAX_EVENTS:]
    return events


def _append_failure(failures: list[dict[str, Any]], failure: dict[str, Any]) -> list[dict[str, Any]]:
    failures = list(failures)
    failures.append(failure)
    if len(failures) > _MAX_FAILURES:
        failures = failures[-_MAX_FAILURES:]
    return failures


def _persist_mass_group_runtime(
    campaign_id: str,
    *,
    status: str | None = None,
    stats: dict[str, Any] | None = None,
    events: list[dict[str, Any]] | None = None,
    failures: list[dict[str, Any]] | None = None,
    last_finished_at: str | None = None,
) -> sqlite3.Row | None:
    sets: list[str] = ["updated_at = ?"]
    params: list[Any] = [now_iso()]
    if status is not None:
        sets.append("status = ?")
        params.append(status)
    if stats is not None:
        sets.append("stats_json = ?")
        params.append(json.dumps(stats))
    if events is not None:
        sets.append("events_json = ?")
        params.append(json.dumps(events))
    if failures is not None:
        sets.append("failures_json = ?")
        params.append(json.dumps(failures))
    if last_finished_at is not None:
        sets.append("last_finished_at = ?")
        params.append(last_finished_at)
    params.append(campaign_id)
    with db() as conn:
        conn.execute(
            f"UPDATE mass_group_campaigns SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        return conn.execute(
            "SELECT * FROM mass_group_campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()


def _touch_mass_group_status(
    conn: sqlite3.Connection, campaign_id: str, user_id: str, status: str
) -> sqlite3.Row:
    from fastapi import HTTPException

    row = conn.execute(
        "SELECT * FROM mass_group_campaigns WHERE id = ? AND user_id = ?",
        (campaign_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Campaign not found")
    conn.execute(
        "UPDATE mass_group_campaigns SET status = ?, updated_at = ? WHERE id = ?",
        (status, now_iso(), campaign_id),
    )
    return conn.execute(
        "SELECT * FROM mass_group_campaigns WHERE id = ?", (campaign_id,)
    ).fetchone()
