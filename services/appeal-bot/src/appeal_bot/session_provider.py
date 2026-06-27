from __future__ import annotations

import os
from contextlib import asynccontextmanager

from appeal_bot.models import AccountRecord

SPAMBOT_PEER = "SpamBot"


class SessionProvider:
    """Opens read-only Telethon clients from CRM .session files and yields
    a conversation with @SpamBot."""

    def __init__(self, session_dir: str, api_id: int, api_hash: str,
                 conversation_timeout: int = 60):
        self._dir = session_dir
        self._api_id = api_id
        self._api_hash = api_hash
        self._timeout = conversation_timeout

    def resolve_path(self, account: AccountRecord, must_exist: bool = False) -> str:
        path = account.session_path or os.path.join(
            self._dir, f"{account.account_id}.session"
        )
        if must_exist and not os.path.exists(path):
            raise FileNotFoundError(path)
        return path

    @asynccontextmanager
    async def conversation(self, account: AccountRecord):
        # Imported lazily so the rest of the package tests without Telethon.
        from telethon import TelegramClient

        path = self.resolve_path(account, must_exist=True)
        # Telethon appends ".session"; strip it if present.
        base = path[:-len(".session")] if path.endswith(".session") else path
        client = TelegramClient(base, self._api_id, self._api_hash)
        await client.connect()
        try:
            async with client.conversation(
                SPAMBOT_PEER, timeout=self._timeout, exclusive=True
            ) as conv:
                yield _ConversationAdapter(conv)
        finally:
            await client.disconnect()


class _ConversationAdapter:
    """Adapts Telethon's Conversation to the interface SpamBotClient expects:
    send_message(text), get_response() -> resp with .text and async .click()."""

    def __init__(self, conv):
        self._conv = conv

    async def send_message(self, text):
        await self._conv.send_message(text)

    async def get_response(self):
        msg = await self._conv.get_response()
        return _ResponseAdapter(msg)


class _ResponseAdapter:
    def __init__(self, msg):
        self._msg = msg
        self.text = msg.message or ""

    async def click(self, **kwargs):
        from appeal_bot.spambot_client import NoAppealButton

        rows = getattr(self._msg, "buttons", None)
        if not rows:
            raise NoAppealButton("no inline buttons on @SpamBot message")
        hint = kwargs.get("text")
        if not hint:
            raise NoAppealButton("no appeal-button hint provided")
        for row in rows:
            for btn in row:
                caption = getattr(btn, "text", "") or ""
                if hint.lower() in caption.lower():
                    await self._msg.click(text=caption)
                    return
        raise NoAppealButton(f"no button matching hint {hint!r}")
