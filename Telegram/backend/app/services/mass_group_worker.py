from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from telethon.errors import FloodWaitError

from ..core.database import now_iso
from ..core.state import FLOODED_ACCOUNTS, MASS_GROUP_STOP_REQUESTED
from ..helpers.campaign import _campaign_account_label_map
from ..helpers.group_create import create_single_group
from ..helpers.mass_group import (
    _append_event,
    _append_failure,
    _load_mass_group_row,
    _mass_group_record,
    _persist_mass_group_runtime,
)
from ..helpers.telegram import (
    _account_session_lock,
    _open_account_client_for_user,
    _safe_disconnect,
)

logger = logging.getLogger(__name__)


def _is_flooded(account_id: str) -> bool:
    until = FLOODED_ACCOUNTS.get(account_id)
    return bool(until and until > time.time())


async def _can_resolve(user_id: str, creator_id: str, username: str) -> bool:
    """Probe whether ``creator_id`` can resolve ``username``'s entity."""
    lock = _account_session_lock(creator_id)
    async with lock:
        try:
            _, client = await _open_account_client_for_user(user_id, creator_id)
        except Exception:
            return False
        try:
            await client.get_entity(username)
            return True
        except Exception:
            return False
        finally:
            await _safe_disconnect(client)


async def _run_mass_group_worker(campaign_id: str) -> None:
    row = _load_mass_group_row(campaign_id)
    if not row:
        return
    campaign = _mass_group_record(row)
    user_id = campaign["userId"]
    usernames: list[str] = campaign["usernames"]
    creator_ids: list[str] = campaign["creatorAccountIds"]
    admin_ids: list[str] = campaign["adminAccountIds"]
    title_template: str = campaign["titleTemplate"]
    delay_seconds: int = campaign["delaySeconds"]
    stats: dict[str, Any] = campaign["stats"]
    events: list[dict[str, Any]] = campaign["events"]
    failures: list[dict[str, Any]] = campaign["failures"]

    labels = _campaign_account_label_map(user_id)

    # Resolve the selected admin accounts to public usernames (the creator promotes them
    # by username, same constraint as the interactive endpoint's extra_admin_usernames).
    from ..core.database import db

    admin_usernames: list[str] = []
    with db() as conn:
        for aid in admin_ids:
            arow = conn.execute(
                "SELECT username FROM accounts WHERE id = ? AND user_id = ?",
                (aid, user_id),
            ).fetchone()
            uname = (arow["username"] if arow else None) or ""
            if uname.strip():
                admin_usernames.append(uname.strip())
            else:
                failures = _append_failure(failures, {
                    "username": labels.get(aid, aid),
                    "reason": "Admin account has no public username; cannot be promoted by the creator account",
                    "at": now_iso(),
                })

    events = _append_event(events, {
        "at": now_iso(),
        "type": "run_started",
        "status": "running",
        "message": f"Creating {len(usernames)} group(s) across {len(creator_ids)} account(s)",
    })
    _persist_mass_group_runtime(campaign_id, events=events, failures=failures)

    rotation = 0
    try:
        for index, username in enumerate(usernames):
            if campaign_id in MASS_GROUP_STOP_REQUESTED:
                break

            stats["activeUsername"] = username
            _persist_mass_group_runtime(campaign_id, stats=stats)

            # Build the rotation order so a different account leads each username.
            order = [creator_ids[(rotation + i) % len(creator_ids)] for i in range(len(creator_ids))]
            rotation += 1

            title = title_template.replace("{username}", username)
            created = False
            last_error: str | None = None

            for creator_id in order:
                if campaign_id in MASS_GROUP_STOP_REQUESTED:
                    break
                if _is_flooded(creator_id):
                    continue
                if not await _can_resolve(user_id, creator_id, username):
                    continue

                try:
                    result = await create_single_group(
                        user_id, creator_id, title, [username], admin_usernames
                    )
                    member_failed = any(m["status"] == "failed" for m in result.get("members", []))
                    if member_failed:
                        # Creator resolved during probe but failed to add the target; try next.
                        last_error = next(
                            (m.get("error") for m in result["members"] if m["status"] == "failed"),
                            "Failed to add target user",
                        )
                        continue
                    created = True
                    stats["groupsCreated"] = stats.get("groupsCreated", 0) + 1
                    events = _append_event(events, {
                        "at": now_iso(),
                        "type": "group_created",
                        "status": "created",
                        "username": username,
                        "title": title,
                        "chatId": result.get("chat_id"),
                        "accountId": creator_id,
                        "accountLabel": labels.get(creator_id, creator_id),
                        "adminPromoted": result.get("admin_promoted", 0),
                        "message": f"Created '{title}' (chat {result.get('chat_id')})",
                    })
                    break
                except FloodWaitError as fwe:
                    seconds = getattr(fwe, "seconds", 3600) or 3600
                    FLOODED_ACCOUNTS[creator_id] = time.time() + seconds
                    last_error = f"Flood wait {seconds}s on {labels.get(creator_id, creator_id)}"
                    continue
                except Exception as exc:
                    last_error = str(exc)[:300] or "Unknown error during group creation"
                    continue

            stats["processed"] = index + 1
            if not created:
                stats["failed"] = stats.get("failed", 0) + 1
                failures = _append_failure(failures, {
                    "username": username,
                    "reason": last_error or "No account could resolve or create a group for this username",
                    "at": now_iso(),
                })
                events = _append_event(events, {
                    "at": now_iso(),
                    "type": "group_failed",
                    "status": "failed",
                    "username": username,
                    "message": last_error or "No account could create a group for this username",
                })

            _persist_mass_group_runtime(campaign_id, stats=stats, events=events, failures=failures)

            if index < len(usernames) - 1 and campaign_id not in MASS_GROUP_STOP_REQUESTED:
                await asyncio.sleep(max(0, delay_seconds) + random.uniform(0.5, 2.5))
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - record any unexpected worker failure
        logger.exception("Mass group worker crashed for %s", campaign_id)
        failures = _append_failure(failures, {
            "username": "*",
            "reason": f"Worker error: {str(exc)[:300]}",
            "at": now_iso(),
        })
    finally:
        stopped = campaign_id in MASS_GROUP_STOP_REQUESTED
        stats["activeUsername"] = None
        final_status = "stopped" if stopped else "done"
        _persist_mass_group_runtime(
            campaign_id,
            status=final_status,
            stats=stats,
            events=events,
            failures=failures,
            last_finished_at=now_iso(),
        )
        MASS_GROUP_STOP_REQUESTED.discard(campaign_id)
