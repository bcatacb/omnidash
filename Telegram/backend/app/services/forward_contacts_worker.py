from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from telethon.errors import (
    FloodWaitError,
    PeerFloodError,
    UserAlreadyParticipantError,
    UserChannelsTooMuchError,
    UserNotMutualContactError,
    UserPrivacyRestrictedError,
)
from telethon.tl.functions.channels import InviteToChannelRequest, JoinChannelRequest
from telethon.tl.types import InputUser

from ..core.database import async_db_write, db, now_iso
from ..core.state import (
    GROUP_ADD_PAUSE_REQUESTED,
    GROUP_ADD_STOP_REQUESTED,
    GROUP_ADD_TASK_LOCK,
    GROUP_ADD_TASKS,
)
from ..helpers.telegram import (
    _account_session_lock,
    _open_account_client_for_user,
    _resolve_entity,
    _safe_disconnect,
)

logger = logging.getLogger(__name__)

MAX_LOG_ENTRIES = 200


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _load_job(job_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM group_add_jobs WHERE id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def _load_pending_targets(job_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM group_add_targets WHERE job_id = ? AND status = 'pending' ORDER BY id",
            (job_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _append_log(state: dict[str, Any], message: str) -> None:
    log: list[dict[str, Any]] = state.setdefault("log", [])
    log.append({"at": now_iso(), "message": message})
    if len(log) > MAX_LOG_ENTRIES:
        del log[: len(log) - MAX_LOG_ENTRIES]


async def _persist_job(job_id: str, state: dict[str, Any], status: str | None = None, finished: bool = False) -> None:
    """Write the current counters/log (and optionally status) to group_add_jobs."""
    now = now_iso()
    fields: dict[str, Any] = {
        "processed": state["processed"],
        "forwarded": state["forwarded"],
        "added": state["added"],
        "kicked": state["kicked"],
        "skipped": state["skipped"],
        "failed": state["failed"],
        "error": state.get("error"),
        "log_json": json.dumps(state.get("log", [])),
        "updated_at": now,
    }
    if status is not None:
        fields["status"] = status
    if finished:
        fields["last_finished_at"] = now

    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [job_id]
    await async_db_write(lambda conn: conn.execute(f"UPDATE group_add_jobs SET {cols} WHERE id = ?", values))


async def _set_target(job_id: str, target_id: int, status: str, result: str | None = None) -> None:
    await async_db_write(
        lambda conn: conn.execute(
            "UPDATE group_add_targets SET status = ?, result = ?, updated_at = ? WHERE id = ?",
            (status, result, now_iso(), target_id),
        )
    )


async def _interruptible_sleep(job_id: str, seconds: int) -> bool:
    """Sleep in 1s increments. Returns True if a stop/pause was requested mid-sleep."""
    remaining = max(0, int(seconds))
    while remaining > 0:
        if job_id in GROUP_ADD_STOP_REQUESTED or job_id in GROUP_ADD_PAUSE_REQUESTED:
            return True
        await asyncio.sleep(1)
        remaining -= 1
    return job_id in GROUP_ADD_STOP_REQUESTED or job_id in GROUP_ADD_PAUSE_REQUESTED


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

async def _run_forward_worker(job_id: str) -> None:
    """Process the pending targets of a group-add job. Driven entirely from the DB so the
    same entry point handles both a fresh start and a resume (a resume simply finds fewer
    pending rows). Survives page refreshes and, via resume_running_group_add_jobs(), restarts.
    """
    job = _load_job(job_id)
    if job is None:
        logger.warning("Group-add job %s not found; nothing to run", job_id)
        return

    user_id = job["user_id"]
    account_id = job["account_id"]
    group_id = job["group_id"]
    interval_seconds = max(1, int(job["interval_seconds"] or 5))

    # Restore running counters from the DB so resume keeps climbing rather than resetting.
    try:
        log = json.loads(job["log_json"]) if job["log_json"] else []
    except Exception:
        log = []
    state: dict[str, Any] = {
        "processed": job["processed"],
        "forwarded": job["forwarded"],
        "added": job["added"],
        "kicked": job["kicked"],
        "skipped": job["skipped"],
        "failed": job["failed"],
        "error": None,
        "log": log,
    }

    targets = _load_pending_targets(job_id)
    await _persist_job(job_id, state, status="running")

    client = None
    lock = _account_session_lock(account_id)
    paused = False
    flooded = False
    try:
        async with lock:
            _, client = await _open_account_client_for_user(user_id, account_id)
            try:
                group = await _resolve_entity(client, group_id)
            except Exception as e:  # noqa: BLE001
                state["error"] = f"Could not resolve destination group: {e}"
                _append_log(state, state["error"])
                await _persist_job(job_id, state, status="failed", finished=True)
                return

            # The inviting account must itself be a member of the destination group.
            try:
                await client(JoinChannelRequest(group))
            except Exception as e:  # noqa: BLE001 — may already be a member; not fatal
                _append_log(state, f"Join destination group: {e}")

            for target in targets:
                if job_id in GROUP_ADD_STOP_REQUESTED:
                    break
                if job_id in GROUP_ADD_PAUSE_REQUESTED:
                    paused = True
                    break

                target_id = target["id"]
                uid = str(target.get("member_id") or "").strip()
                access_hash = str(target.get("access_hash") or "").strip()
                full_name = str(target.get("full_name") or "").strip()
                label = full_name or uid

                # A no-username/no-phone user can only be added via their access hash.
                if not access_hash:
                    state["skipped"] += 1
                    state["processed"] += 1
                    _append_log(state, f"Skipped {label}: no access hash (can't be added)")
                    await _set_target(job_id, target_id, "skipped", "no access hash")
                    await _persist_job(job_id, state)
                    continue

                try:
                    user_ref = InputUser(user_id=int(uid), access_hash=int(access_hash))

                    # Prefer forwarding one of the user's own messages into the group.
                    forwarded = False
                    try:
                        last_msg = None
                        async for m in client.iter_messages(user_ref, limit=50):
                            if not m.out and not m.action:  # incoming, authored by them
                                last_msg = m
                                break
                        if last_msg is not None:
                            await client.forward_messages(group, last_msg)
                            state["forwarded"] += 1
                            _append_log(state, f"Forwarded message from {label}")
                            await _set_target(job_id, target_id, "forwarded", "forwarded message")
                            forwarded = True
                    except (FloodWaitError, PeerFloodError):
                        raise
                    except Exception as e:  # noqa: BLE001 — fall back to adding instead
                        _append_log(state, f"Forward from {label} failed, adding instead: {e}")

                    if not forwarded:
                        # Fallback: add them to the group, then kick them right back out.
                        await client(InviteToChannelRequest(channel=group, users=[user_ref]))
                        state["added"] += 1
                        _append_log(state, f"Added {label}")
                        kick_note = "added"

                        await asyncio.sleep(1)
                        try:
                            await client.kick_participant(group, user_ref)
                            state["kicked"] += 1
                            kick_note = "added + kicked"
                            _append_log(state, f"Kicked {label}")
                        except (FloodWaitError, PeerFloodError):
                            raise
                        except Exception as e:  # noqa: BLE001 — add succeeded; kick is best-effort
                            _append_log(state, f"Could not kick {label}: {e}")
                        await _set_target(job_id, target_id, "added", kick_note)
                except (FloodWaitError, PeerFloodError) as fwe:
                    # Account is rate-limited — pause (not stop) so remaining pending targets
                    # can be resumed later once the flood clears.
                    wait = getattr(fwe, "seconds", None)
                    reason = f"flood wait {wait}s" if wait else "peer flood"
                    _append_log(state, f"Pausing: account rate-limited ({reason}) on {label}")
                    state["error"] = f"Account rate-limited ({reason})"
                    flooded = True
                    break
                except UserPrivacyRestrictedError:
                    state["skipped"] += 1
                    _append_log(state, f"Skipped {label}: privacy settings prevent adding")
                    await _set_target(job_id, target_id, "skipped", "privacy settings")
                except UserAlreadyParticipantError:
                    state["skipped"] += 1
                    _append_log(state, f"Skipped {label}: already in group")
                    await _set_target(job_id, target_id, "skipped", "already in group")
                except UserChannelsTooMuchError:
                    state["skipped"] += 1
                    _append_log(state, f"Skipped {label}: user is in too many groups")
                    await _set_target(job_id, target_id, "skipped", "in too many groups")
                except UserNotMutualContactError:
                    state["skipped"] += 1
                    _append_log(state, f"Skipped {label}: not a mutual contact")
                    await _set_target(job_id, target_id, "skipped", "not a mutual contact")
                except Exception as e:  # noqa: BLE001 — per-target failure must not abort the job
                    state["failed"] += 1
                    _append_log(state, f"Failed on {label}: {e}")
                    await _set_target(job_id, target_id, "failed", str(e))

                state["processed"] += 1
                await _persist_job(job_id, state)

                # Pause between adds (allows early stop/pause). Skip after the last pending target.
                if target is not targets[-1]:
                    if await _interruptible_sleep(job_id, interval_seconds):
                        if job_id in GROUP_ADD_PAUSE_REQUESTED:
                            paused = True
                        break

        if job_id in GROUP_ADD_STOP_REQUESTED:
            final_status = "stopped"
        elif paused or flooded:
            final_status = "paused"
        else:
            final_status = "completed"
        _append_log(state, f"Job {final_status}: {state['processed']}/{job['total']} processed")
        await _persist_job(job_id, state, status=final_status, finished=final_status != "paused")
    except asyncio.CancelledError:
        # Cancellation accompanies a pause or stop request; honour whichever was set.
        final_status = "stopped" if job_id in GROUP_ADD_STOP_REQUESTED else "paused"
        try:
            await _persist_job(job_id, state, status=final_status, finished=final_status != "paused")
        except Exception:
            logger.exception("Failed to persist group-add job %s on cancel", job_id)
        raise
    except Exception as e:  # noqa: BLE001
        state["error"] = str(e)
        _append_log(state, f"Job failed: {e}")
        logger.exception("Group-add job %s failed", job_id)
        try:
            await _persist_job(job_id, state, status="failed", finished=True)
        except Exception:
            logger.exception("Failed to persist group-add job %s failure", job_id)
    finally:
        await _safe_disconnect(client)
        GROUP_ADD_STOP_REQUESTED.discard(job_id)
        GROUP_ADD_PAUSE_REQUESTED.discard(job_id)
        GROUP_ADD_TASKS.pop(job_id, None)


async def launch_group_add_job(job_id: str) -> None:
    """Create and register the asyncio task for a job (start or resume)."""
    GROUP_ADD_STOP_REQUESTED.discard(job_id)
    GROUP_ADD_PAUSE_REQUESTED.discard(job_id)
    async with GROUP_ADD_TASK_LOCK:
        existing = GROUP_ADD_TASKS.get(job_id)
        if existing is not None and not existing.done():
            return
        task = asyncio.create_task(_run_forward_worker(job_id))
        GROUP_ADD_TASKS[job_id] = task


async def resume_running_group_add_jobs() -> None:
    """On startup, relaunch any group-add jobs left as 'running' by an interrupted process."""
    with db() as conn:
        rows = conn.execute("SELECT id FROM group_add_jobs WHERE status = 'running'").fetchall()
    for row in rows:
        job_id = row["id"]
        if job_id in GROUP_ADD_TASKS and not GROUP_ADD_TASKS[job_id].done():
            continue
        try:
            await launch_group_add_job(job_id)
        except Exception:
            logger.exception("Failed to resume group-add job %s", job_id)
