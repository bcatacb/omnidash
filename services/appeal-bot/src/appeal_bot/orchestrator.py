from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

from appeal_bot.models import AccountRecord, AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.notifier import Notifier, format_outcome, should_alert
from appeal_bot.store import Store

RunFlow = Callable[[AccountRecord], Awaitable[SpamBotResult]]

# Statuses that count as a successful resolution (reset backoff).
_RESOLVED = {Status.FREE, Status.LIFTED}
# Statuses that grow the backoff window.
_FAILED = {Status.REFUSED, Status.BACKOFF, Status.UNKNOWN, Status.ERROR}


class AppealOrchestrator:
    def __init__(
        self,
        store: Store,
        run_flow: RunFlow,
        notifier: Notifier,
        clock: Callable[[], float] = time.time,
        cooldown_base: int = 86400,
        cooldown_cap: int = 604800,
        max_concurrency: int = 2,
    ):
        self._store = store
        self._run_flow = run_flow
        self._notifier = notifier
        self._clock = clock
        self._base = cooldown_base
        self._cap = cooldown_cap
        self._sem = asyncio.Semaphore(max_concurrency)

    async def appeal(
        self, account_id: str, trigger: Trigger, force: bool = False
    ) -> AppealOutcome:
        acct = self._store.get_account(account_id)
        if acct is None:
            return AppealOutcome(account_id, "unknown_account", None)
        if not acct.enabled and not force:
            return AppealOutcome(account_id, "disabled", None)

        now = int(self._clock())
        if not force and acct.cooldown_until and now < acct.cooldown_until:
            return AppealOutcome(account_id, "cooldown", None)

        async with self._sem:
            try:
                result = await self._run_flow(acct)
            except Exception as exc:  # noqa: BLE001 - any flow failure becomes ERROR
                result = SpamBotResult(Status.ERROR, "none", repr(exc))

        consec, cooldown_until = self._next_state(acct, result, now)
        self._store.set_account_state(
            account_id, result.status.value, now, cooldown_until, consec
        )
        self._store.record_appeal(
            account_id, now, trigger.value, result.status.value,
            result.action, result.status.value, result.raw_text,
        )

        outcome = AppealOutcome(account_id, None, result)
        if should_alert(outcome):
            await self._notifier.notify(format_outcome(outcome))
        return outcome

    def _next_state(
        self, acct: AccountRecord, result: SpamBotResult, now: int
    ) -> tuple[int, int]:
        if result.status in _RESOLVED:
            return 0, now + self._base
        # Failure path: grow backoff exponentially, capped.
        consec = acct.consec_failures + 1
        delay = min(self._base * (2 ** (consec - 1)), self._cap)
        return consec, now + delay
