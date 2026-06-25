from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import DB_PATH, SESSION_DIR, settings
from .core.database import bootstrap_db, close_db
from .helpers.telegram import (
    _apply_wal_to_session_file,
    _safe_disconnect,
    disconnect_all_persistent_clients,
    disconnect_all_warm_clients,
    sweep_idle_warm_clients,
)
from .services.campaign_worker import resume_running_campaigns
from .services.followup_worker import run_followup_worker
from .services.forward_contacts_worker import resume_running_group_add_jobs
from .core.security import current_user_id
from .models.schemas import ContactImportPayload
from .routes import (
    accounts,
    auth,
    campaigns,
    folders,
    forward_contacts,
    group_scraper,
    groups,
    mass_groups,
    messages,
    notifications,
    scrape,
    stored_messages,
    warmup,
)
from .services.notification_listener_worker import resume_all_listeners
from .services.group_folder_listener_worker import resume_group_folder_listeners
from .services.contact_import import import_contacts

logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in settings.cors_origins.split(",") if item.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _warm_client_sweeper() -> None:
    """Periodically disconnect Telethon clients kept warm for chat reads but now idle."""
    while True:
        try:
            await asyncio.sleep(60)
            await sweep_idle_warm_clients()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("warm client sweeper iteration failed")


@app.on_event("startup")
async def startup() -> None:
    bootstrap_db()
    for sf in SESSION_DIR.glob("*.session"):
        _apply_wal_to_session_file(str(sf))
    await resume_running_campaigns()
    await resume_running_group_add_jobs()
    app.state.followup_task = asyncio.create_task(run_followup_worker())
    app.state.notification_resume_task = asyncio.create_task(resume_all_listeners())
    app.state.group_folder_resume_task = asyncio.create_task(resume_group_folder_listeners())
    app.state.warm_client_sweeper_task = asyncio.create_task(_warm_client_sweeper())


@app.on_event("shutdown")
async def shutdown() -> None:
    """Cancel all background tasks and disconnect Telethon clients on shutdown."""
    logger.info("Shutting down, cancelling background tasks...")

    from .core.state import (
        CAMPAIGN_TASKS,
        CAMPAIGN_TASK_LOCK,
        GROUP_ADD_TASKS,
        GROUP_FOLDER_LISTENER_TASKS,
        GROUP_SCRAPER_TASKS,
        MASS_GROUP_TASKS,
        WARMUP_TASKS,
        CONVERSATION_REFRESH_TASKS,
        FOLDER_CONVERSATIONS_REFRESH_TASKS,
        NOTIFICATION_LISTENER_TASKS,
        PENDING_QR_LOGINS,
        PENDING_PHONE_LOGINS,
    )

    async def _cancel(tasks: dict[str, asyncio.Task]) -> None:
        for tid, task in list(tasks.items()):
            if not task.done():
                task.cancel()
        tasks.clear()

    async with CAMPAIGN_TASK_LOCK:
        await _cancel(CAMPAIGN_TASKS)

    await _cancel(GROUP_SCRAPER_TASKS)
    await _cancel(MASS_GROUP_TASKS)
    await _cancel(WARMUP_TASKS)
    await _cancel(GROUP_ADD_TASKS)
    await _cancel(CONVERSATION_REFRESH_TASKS)
    await _cancel(FOLDER_CONVERSATIONS_REFRESH_TASKS)
    await _cancel(NOTIFICATION_LISTENER_TASKS)
    await _cancel(GROUP_FOLDER_LISTENER_TASKS)

    followup = getattr(app.state, "followup_task", None)
    if followup is not None and not followup.done():
        followup.cancel()

    notify_resume = getattr(app.state, "notification_resume_task", None)
    if notify_resume is not None and not notify_resume.done():
        notify_resume.cancel()

    sweeper = getattr(app.state, "warm_client_sweeper_task", None)
    if sweeper is not None and not sweeper.done():
        sweeper.cancel()
    await disconnect_all_persistent_clients()
    await disconnect_all_warm_clients()

    for pl in list(PENDING_QR_LOGINS.values()):
        await _safe_disconnect(pl.client)
    PENDING_QR_LOGINS.clear()
    for pl in list(PENDING_PHONE_LOGINS.values()):
        await _safe_disconnect(pl.client)
    PENDING_PHONE_LOGINS.clear()

    close_db()

    logger.info("Shutdown complete")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "env": settings.app_env,
        "sqlite_path": str(DB_PATH),
        "telegramConfigured": bool(settings.telegram_api_id and settings.telegram_api_hash),
    }


@app.get("/")
def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": settings.app_name,
            "version": "restored",
            "health": "/health",
            "apiBase": "/api/v1",
            "telegramApiIdConfigured": bool(settings.telegram_api_id),
        }
    )


app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(messages.router)
app.include_router(folders.router)
app.include_router(campaigns.router)
app.include_router(group_scraper.router)
app.include_router(scrape.router)
app.include_router(forward_contacts.router)
app.include_router(warmup.router)
app.include_router(groups.router)
app.include_router(mass_groups.router)
app.include_router(notifications.router)
app.include_router(stored_messages.router)


@app.post("/api/v1/contacts/import")
async def contacts_import(payload: ContactImportPayload, user_id: str = Depends(current_user_id)):
    return await import_contacts(payload, user_id)
