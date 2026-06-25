from __future__ import annotations

import asyncio
import json
import random
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.channels import GetParticipantsRequest, InviteToChannelRequest
from telethon.tl.types import ChannelParticipantsSearch, InputUser
from telethon.utils import get_display_name

from ..core.database import db, now_iso
from ..core.config import settings, SESSION_DIR
from ..core.state import (
    ACCOUNT_SESSION_LOCKS,
    FLOODED_ACCOUNTS,
    GROUP_SCRAPER_CANDIDATES,
    GROUP_SCRAPER_STOP_REQUESTED,
)
from ..helpers.campaign import (
    _append_group_event,
    _append_group_failure,
    _campaign_account_label_map,
    _default_group_stats,
    _group_record,
    _load_group_campaign_row,
    _mark_candidate_result,
    _next_pending_candidate,
    _pending_candidate_count,
    _persist_group_campaign_runtime,
    _replace_group_candidates,
)
from ..helpers.telegram import (
    _account_session_lock,
    _join_group_reference,
    _open_account_client_for_user,
    _safe_disconnect,

)


async def _run_group_scraper_worker(campaign_id: str) -> None:
    row = _load_group_campaign_row(campaign_id)
    if not row:
        return

    campaign = _group_record(row)
    user_id = campaign["userId"]
    inviter_ids = campaign["inviterAccountIds"]
    if not inviter_ids:
        updated = _persist_group_campaign_runtime(campaign_id, status="failed", finished=True)
        return

    stats = campaign["stats"] or _default_group_stats(inviter_ids)
    events = campaign["events"] or []
    failures = campaign["failures"] or []
    label_map = _campaign_account_label_map(user_id)

    # ensure account state labels are readable
    account_states = stats.get("accountStates") or []
    state_by_id: dict[str, dict[str, Any]] = {}
    for inviter_id in inviter_ids:
        existing = next((item for item in account_states if item.get("accountId") == inviter_id), None)
        if existing:
            state = dict(existing)
        else:
            state = {
                "accountId": inviter_id,
                "accountLabel": label_map.get(inviter_id, inviter_id),
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
        state["accountLabel"] = label_map.get(inviter_id, inviter_id)
        state_by_id[inviter_id] = state
    stats["accountStates"] = list(state_by_id.values())
    stats["activePhase"] = "scraping"
    stats["activeGroup"] = campaign["sourceGroup"]
    stats["activeAccountId"] = campaign["sourceAccountId"]
    stats["activeAccountLabel"] = label_map.get(campaign["sourceAccountId"], campaign["sourceAccountId"])
    events = _append_group_event(
        events,
        {
            "at": now_iso(),
            "type": "scrape_start",
            "status": "running",
            "accountId": campaign["sourceAccountId"],
            "accountLabel": stats["activeAccountLabel"],
            "group": campaign["sourceGroup"],
            "message": "Fetching source members",
        },
    )
    _persist_group_campaign_runtime(campaign_id, status="running", stats=stats, events=events, failures=failures)

    pending_by_inviter = {
        inviter_id: _pending_candidate_count(campaign_id, inviter_id) for inviter_id in inviter_ids
    }
    for inviter_id in inviter_ids:
        if pending_by_inviter.get(inviter_id, 0) > 0:
            continue
        members_to_store: list[dict[str, Any]] = []
        try:
            lock = _account_session_lock(inviter_id)
            async with lock:
                _, scrape_client = await _open_account_client_for_user(user_id, inviter_id)
                try:
                    source_entity = await _join_group_reference(scrape_client, campaign["sourceGroup"])
                    label = label_map.get(inviter_id, inviter_id)
                    events = _append_group_event(
                        events,
                        {
                            "at": now_iso(), "type": "scrape_progress",
                            "status": "running",
                            "accountId": inviter_id, "accountLabel": label,
                            "group": campaign["sourceGroup"],
                            "message": f"Started scraping members for {label}",
                        },
                    )
                    _persist_group_campaign_runtime(campaign_id, stats=stats, events=events, failures=failures)
                    my_filter = ChannelParticipantsSearch('')
                    offset = 0
                    total_count = 0
                    while True:
                        try:
                            participants = await scrape_client(GetParticipantsRequest(channel=source_entity, offset=offset, filter=my_filter, limit=200, hash=0))
                        except FloodWaitError as fwe:
                            secs = getattr(fwe, 'seconds', 60)
                            events = _append_group_event(
                                events,
                                {
                                    "at": now_iso(), "type": "scrape_flood",
                                    "status": "cooldown",
                                    "accountId": inviter_id, "accountLabel": label,
                                    "group": campaign["sourceGroup"],
                                    "message": f"Flood wait {secs}s scraping for {label}, pausing",
                                },
                            )
                            _persist_group_campaign_runtime(campaign_id, stats=stats, events=events, failures=failures)
                            await asyncio.sleep(secs)
                            continue
                        for participant in participants.users:
                            if getattr(participant, "bot", False) or getattr(participant, "deleted", False):
                                continue
                            members_to_store.append(
                                {
                                    "member_id": int(participant.id),
                                    "access_hash": getattr(participant, "access_hash", None),
                                    "username": getattr(participant, "username", None),
                                    "display_name": get_display_name(participant) or str(participant.id),
                                }
                            )
                            total_count += 1
                        offset += len(participants.users)
                        if total_count % 1000 < 200 or len(participants.users) < 200:
                            events = _append_group_event(
                                events,
                                {
                                    "at": now_iso(), "type": "scrape_progress",
                                    "status": "running",
                                    "accountId": inviter_id, "accountLabel": label,
                                    "group": campaign["sourceGroup"],
                                    "message": f"Scraped {total_count} members for {label}",
                                },
                            )
                            _persist_group_campaign_runtime(campaign_id, stats=stats, events=events, failures=failures)
                        if len(participants.users) < 200:
                            break
                finally:
                    await _safe_disconnect(scrape_client)
            _replace_group_candidates(campaign_id, user_id, inviter_id, members_to_store)
        except Exception as exc:
            failures = _append_group_failure(
                failures,
                {
                    "accountId": inviter_id,
                    "accountLabel": label_map.get(inviter_id, inviter_id),
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
                    "accountLabel": label_map.get(inviter_id, inviter_id),
                    "group": campaign["sourceGroup"],
                    "message": f"Failed to fetch source members for account: {exc}",
                },
            )
        await asyncio.sleep(random.uniform(2, 5))
    total_candidates = sum(_pending_candidate_count(campaign_id, inviter_id) for inviter_id in inviter_ids)

    stats["scrapedCount"] = total_candidates
    stats["totalCandidates"] = total_candidates
    stats["remainingCandidates"] = total_candidates
    for inviter_id in inviter_ids:
        state_by_id[inviter_id]["pendingCandidates"] = _pending_candidate_count(campaign_id, inviter_id)
    stats["accountStates"] = list(state_by_id.values())
    events = _append_group_event(
        events,
        {
            "at": now_iso(),
            "type": "scrape_done",
            "status": "done",
            "group": campaign["sourceGroup"],
            "message": f"Loaded {total_candidates} members",
        },
    )
    _persist_group_campaign_runtime(campaign_id, stats=stats, events=events, failures=failures)

    if total_candidates == 0:
        _persist_group_campaign_runtime(campaign_id, status="completed", stats=stats, events=events, failures=failures, finished=True)
        return

    delay_seconds = max(0.0, float(campaign["delaySeconds"] or 0))
    stats["activePhase"] = "inviting"
    stats["activeGroup"] = campaign["targetGroup"]
    _persist_group_campaign_runtime(campaign_id, stats=stats)

    inviter_cursor = 0
    while True:
        if campaign_id in GROUP_SCRAPER_STOP_REQUESTED:
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "stopped",
                    "status": "stopped",
                    "message": "Campaign stop requested",
                },
            )
            _persist_group_campaign_runtime(
                campaign_id,
                status="stopped",
                stats=stats,
                events=events,
                failures=failures,
                finished=True,
            )
            GROUP_SCRAPER_STOP_REQUESTED.discard(campaign_id)
            return

        remaining_total = sum(_pending_candidate_count(campaign_id, aid) for aid in inviter_ids)
        if remaining_total <= 0:
            break

        inviter_id: str | None = None
        for offset in range(len(inviter_ids)):
            idx = (inviter_cursor + offset) % len(inviter_ids)
            candidate_inviter_id = inviter_ids[idx]
            state_candidate = state_by_id[candidate_inviter_id]
            rest_until_candidate = state_candidate.get("restUntil")
            if rest_until_candidate:
                try:
                    if datetime.fromisoformat(rest_until_candidate) > datetime.now(UTC):
                        continue
                except Exception:
                    pass
            if _next_pending_candidate(campaign_id, candidate_inviter_id):
                inviter_id = candidate_inviter_id
                inviter_cursor = (idx + 1) % len(inviter_ids)
                break

        if inviter_id is None:
            await asyncio.sleep(0.5)
            continue
        state = state_by_id[inviter_id]
        candidate = _next_pending_candidate(campaign_id, inviter_id)
        if not candidate:
            state["state"] = "idle"
            state["pendingCandidates"] = 0
            stats["accountStates"] = list(state_by_id.values())
            _persist_group_campaign_runtime(campaign_id, stats=stats)
            await asyncio.sleep(0.1)
            continue
        rest_until = state.get("restUntil")
        if rest_until:
            try:
                if datetime.fromisoformat(rest_until) > datetime.now(UTC):
                    await asyncio.sleep(0.5)
                    continue
                state["restUntil"] = None
                state["restSeconds"] = 0
                state["restReason"] = None
                state["state"] = "idle"
            except Exception:
                pass

        state["state"] = "active"
        member_id = int(candidate["member_id"])
        state["lastMember"] = str(member_id)
        state["lastEventAt"] = now_iso()
        state["pendingCandidates"] = max(0, _pending_candidate_count(campaign_id, inviter_id))
        state["accountLabel"] = label_map.get(inviter_id, inviter_id)
        stats["activeAccountId"] = inviter_id
        stats["activeAccountLabel"] = state["accountLabel"]

        try:
            lock = _account_session_lock(inviter_id)
            async with lock:
                _, inviter_client = await _open_account_client_for_user(user_id, inviter_id)
                try:
                    target_entity = await _join_group_reference(inviter_client, campaign["targetGroup"])
                    access_hash = candidate["access_hash"]
                    user_ref: Any = member_id
                    if access_hash not in (None, ""):
                        try:
                            user_ref = InputUser(user_id=member_id, access_hash=int(access_hash))
                        except Exception:
                            user_ref = member_id
                    await inviter_client(InviteToChannelRequest(channel=target_entity, users=[user_ref]))
                finally:
                    await _safe_disconnect(inviter_client)

            _mark_candidate_result(campaign_id, inviter_id, str(member_id), "invited", invited_by=inviter_id)
            stats["attempted"] = int(stats.get("attempted", 0)) + 1
            stats["added"] = int(stats.get("added", 0)) + 1
            stats["addedByCampaign"] = int(stats.get("addedByCampaign", 0)) + 1
            stats["remainingCandidates"] = sum(_pending_candidate_count(campaign_id, aid) for aid in inviter_ids)
            state["attempted"] = int(state.get("attempted", 0)) + 1
            state["added"] = int(state.get("added", 0)) + 1
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "invite_success",
                    "status": "success",
                    "accountId": inviter_id,
                    "accountLabel": state["accountLabel"],
                    "group": campaign["targetGroup"],
                    "member": state["lastMember"],
                    "message": "Invited member",
                },
            )
        except FloodWaitError:
            rest_seconds = 3600
            FLOODED_ACCOUNTS[inviter_id] = time.time() + rest_seconds
            until = datetime.now(UTC) + timedelta(seconds=rest_seconds)
            state["state"] = "cooldown"
            state["restSeconds"] = rest_seconds
            state["restUntil"] = until.isoformat()
            state["restReason"] = "flood_wait"
            stats["blockedAccounts"] = sorted(set((stats.get("blockedAccounts") or []) + [inviter_id]))
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": "account_rest",
                    "status": "cooldown",
                    "accountId": inviter_id,
                    "accountLabel": state["accountLabel"],
                    "restSeconds": rest_seconds,
                    "restUntil": until.isoformat(),
                    "message": f"Flood wait: resting {rest_seconds}s",
                },
            )
        except Exception as exc:
            text = str(exc)
            stats["attempted"] = int(stats.get("attempted", 0)) + 1
            state["attempted"] = int(state.get("attempted", 0)) + 1
            is_skip = any(keyword in text.lower() for keyword in ["privacy", "already", "not mutual", "forbidden"])
            if is_skip:
                _mark_candidate_result(campaign_id, inviter_id, str(member_id), "skipped", invited_by=inviter_id, error=text[:500])
                stats["skipped"] = int(stats.get("skipped", 0)) + 1
                state["skipped"] = int(state.get("skipped", 0)) + 1
                event_type = "invite_skipped"
                status = "skipped"
            else:
                _mark_candidate_result(campaign_id, inviter_id, str(member_id), "failed", invited_by=inviter_id, error=text[:500])
                stats["failed"] = int(stats.get("failed", 0)) + 1
                state["failed"] = int(state.get("failed", 0)) + 1
                event_type = "invite_failed"
                status = "failed"
                failures = _append_group_failure(
                    failures,
                    {
                        "accountId": inviter_id,
                        "accountLabel": state["accountLabel"],
                        "member": state["lastMember"],
                        "reason": text[:500],
                        "at": now_iso(),
                    },
                )
            stats["remainingCandidates"] = sum(_pending_candidate_count(campaign_id, aid) for aid in inviter_ids)
            events = _append_group_event(
                events,
                {
                    "at": now_iso(),
                    "type": event_type,
                    "status": status,
                    "accountId": inviter_id,
                    "accountLabel": state["accountLabel"],
                    "group": campaign["targetGroup"],
                    "member": state["lastMember"],
                    "message": text[:500],
                },
            )

        stats["accountStates"] = list(state_by_id.values())
        _persist_group_campaign_runtime(campaign_id, stats=stats, events=events, failures=failures)
        if delay_seconds > 0:
            if state.get("state") != "cooldown":
                until = datetime.now(UTC) + timedelta(seconds=delay_seconds)
                state["state"] = "cooldown"
                state["restSeconds"] = delay_seconds
                state["restUntil"] = until.isoformat()
                state["restReason"] = "campaign_delay"
                stats["accountStates"] = list(state_by_id.values())
                _persist_group_campaign_runtime(campaign_id, stats=stats)
            await asyncio.sleep(delay_seconds)

    stats["activePhase"] = "done"
    stats["activeGroup"] = None
    for item in state_by_id.values():
        if item.get("state") == "active":
            item["state"] = "idle"
    stats["accountStates"] = list(state_by_id.values())
    events = _append_group_event(
        events,
        {
            "at": now_iso(),
            "type": "campaign_done",
            "status": "done",
            "message": "Group scraper campaign completed",
            "added": stats.get("added", 0),
            "failed": stats.get("failed", 0),
            "skipped": stats.get("skipped", 0),
        },
    )
    _persist_group_campaign_runtime(
        campaign_id,
        status="completed",
        stats=stats,
        events=events,
        failures=failures,
        finished=True,
    )
