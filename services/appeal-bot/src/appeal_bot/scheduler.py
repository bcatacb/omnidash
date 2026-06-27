from __future__ import annotations

import asyncio
import time
from typing import Callable

from appeal_bot.models import Trigger
from appeal_bot.store import Store


class Scheduler:
    def __init__(
        self,
        store: Store,
        orchestrator,
        interval: int,
        clock: Callable[[], float] = time.time,
    ):
        self._store = store
        self._orch = orchestrator
        self._interval = interval
        self._clock = clock
        self._stopped = asyncio.Event()

    async def sweep_once(self) -> int:
        now = int(self._clock())
        due = self._store.due_for_sweep(now)
        for acct in due:
            await self._orch.appeal(acct.account_id, Trigger.SWEEP)
        return len(due)

    async def run(self) -> None:
        while not self._stopped.is_set():
            await self.sweep_once()
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass

    def stop(self) -> None:
        self._stopped.set()
