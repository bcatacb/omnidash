from __future__ import annotations

import asyncio
import glob
import os

from appeal_bot.config import Config
from appeal_bot.notifier import TelegramNotifier
from appeal_bot.orchestrator import AppealOrchestrator
from appeal_bot.scheduler import Scheduler
from appeal_bot.session_provider import SessionProvider
from appeal_bot.spambot_client import SpamBotClient
from appeal_bot.store import Store
from appeal_bot.webhook import WebhookServer


def sync_accounts_from_dir(store: Store, session_dir: str) -> int:
    """Seed the accounts table from .session files. account_id = filename stem.
    Phone is left blank (filled by CRM sync if available). Returns count added."""
    added = 0
    for path in sorted(glob.glob(os.path.join(session_dir, "*.session"))):
        account_id = os.path.splitext(os.path.basename(path))[0]
        if store.get_account(account_id) is None:
            added += 1
        store.upsert_account(account_id, "", path)
    return added


def build_run_flow(session_provider: SessionProvider, spambot: SpamBotClient):
    async def run_flow(account):
        async with session_provider.conversation(account) as conv:
            return await spambot.run(conv)

    return run_flow


async def main() -> None:  # pragma: no cover - exercised manually
    from telethon import TelegramClient, events

    cfg = Config.from_env()
    store = Store(cfg.sqlite_path)
    store.init_db()
    sync_accounts_from_dir(store, cfg.session_dir)

    bot = TelegramClient("appeal-bot", cfg.api_id, cfg.api_hash)
    await bot.start(bot_token=cfg.bot_token)

    notifier = TelegramNotifier(bot, cfg.operator_chat_ids)
    session_provider = SessionProvider(cfg.session_dir, cfg.api_id, cfg.api_hash)
    spambot = SpamBotClient()
    orchestrator = AppealOrchestrator(
        store=store,
        run_flow=build_run_flow(session_provider, spambot),
        notifier=notifier,
        cooldown_base=cfg.cooldown_base_seconds,
        cooldown_cap=cfg.cooldown_cap_seconds,
        max_concurrency=cfg.max_concurrency,
    )

    from appeal_bot.control_bot import handle_command

    @bot.on(events.NewMessage(pattern=r"^/"))
    async def _on_command(event):  # pragma: no cover
        if cfg.operator_chat_ids and event.chat_id not in cfg.operator_chat_ids:
            return
        reply = await handle_command(event.raw_text, store, orchestrator)
        await event.respond(reply)

    webhook = WebhookServer(
        orchestrator, cfg.webhook_secret, cfg.webhook_host, cfg.webhook_port
    )
    await webhook.start()

    scheduler = Scheduler(store, orchestrator, cfg.sweep_interval_seconds)
    sweep_task = asyncio.create_task(scheduler.run())

    try:
        await bot.run_until_disconnected()
    finally:
        scheduler.stop()
        sweep_task.cancel()
        await webhook.stop()


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(main())
