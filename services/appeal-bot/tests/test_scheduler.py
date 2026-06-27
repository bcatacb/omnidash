import pytest

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.scheduler import Scheduler
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


class FakeOrchestrator:
    def __init__(self):
        self.calls = []

    async def appeal(self, account_id, trigger, force=False):
        self.calls.append((account_id, trigger, force))
        return AppealOutcome(account_id, None, SpamBotResult(Status.FREE, "checked", ""))


async def test_sweep_appeals_only_due_accounts(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("ready", "+1", "/r.session")
    store.upsert_account("cooling", "+2", "/c.session")
    store.set_account_state("ready", "free", 0, 500, 0)
    store.set_account_state("cooling", "refused", 0, 99999, 1)
    orch = FakeOrchestrator()
    sched = Scheduler(store, orch, interval=10, clock=lambda: 1000)
    n = await sched.sweep_once()
    assert n == 1
    assert orch.calls == [("ready", Trigger.SWEEP, False)]


async def test_sweep_empty_when_nothing_due(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("cooling", "+2", "/c.session")
    store.set_account_state("cooling", "refused", 0, 99999, 1)
    orch = FakeOrchestrator()
    sched = Scheduler(store, orch, interval=10, clock=lambda: 1000)
    n = await sched.sweep_once()
    assert n == 0
    assert orch.calls == []
