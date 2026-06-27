from __future__ import annotations

from typing import Protocol

from appeal_bot.models import AppealOutcome, Status

# Outcomes that warrant pushing an operator alert.
_ALERT_STATUSES = {Status.LIFTED, Status.REFUSED, Status.UNKNOWN, Status.ERROR, Status.BACKOFF}


def should_alert(outcome: AppealOutcome) -> bool:
    if outcome.result is None:
        return False
    return outcome.result.status in _ALERT_STATUSES


def format_outcome(outcome: AppealOutcome) -> str:
    if outcome.result is None:
        return f"[{outcome.account_id}] skipped: {outcome.skipped_reason}"
    r = outcome.result
    return f"[{outcome.account_id}] {r.status.value} (action={r.action})"


class Notifier(Protocol):
    async def notify(self, text: str) -> None: ...


class TelegramNotifier:
    """Sends operator alerts via the control bot client."""

    def __init__(self, bot_client, operator_chat_ids: list[int]):
        self._bot = bot_client
        self._chat_ids = operator_chat_ids

    async def notify(self, text: str) -> None:
        for chat_id in self._chat_ids:
            await self._bot.send_message(chat_id, text)
