import pytest

from appeal_bot.models import SpamBotResult, Status, Trigger
from appeal_bot.orchestrator import AppealOrchestrator
from appeal_bot.store import Store


class FakeClock:
    def __init__(self, t=1000):
        self.t = t

    def __call__(self):
        return self.t


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


def orchestrator(store, clock, result=None, alerts=None, base=100, cap=800):
    async def run_flow(account):
        if isinstance(result, Exception):
            raise result
        return result

    alerts = alerts if alerts is not None else []

    class Notifier:
        async def notify(self, text):
            alerts.append(text)

    return AppealOrchestrator(
        store=store, run_flow=run_flow, notifier=Notifier(),
        clock=clock, cooldown_base=base, cooldown_cap=cap, max_concurrency=2,
    )


async def test_skips_unknown_account(tmp_path):
    store = make_store(tmp_path)
    orch = orchestrator(store, FakeClock(), SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("ghost", Trigger.WEBHOOK)
    assert out.skipped_reason == "unknown_account"
    assert out.result is None


async def test_lifted_resets_failures_and_sets_base_cooldown(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 3)
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.LIFTED, "clicked_appeal", "raw"))
    out = await orch.appeal("a1", Trigger.WEBHOOK)
    assert out.result.status is Status.LIFTED
    a = store.get_account("a1")
    assert a.consec_failures == 0
    assert a.cooldown_until == 1000 + 100
    assert a.last_status == "lifted"
    # appeal logged
    assert store.list_appeals("a1")[0].outcome == "lifted"


async def test_refused_increments_failures_with_exponential_backoff(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 2)  # next failure -> 3
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.REFUSED, "clicked_appeal", "r"))
    await orch.appeal("a1", Trigger.WEBHOOK)
    a = store.get_account("a1")
    assert a.consec_failures == 3
    # base * 2^(3-1) = 100 * 4 = 400
    assert a.cooldown_until == 1000 + 400


async def test_backoff_is_capped(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "limited", 0, 0, 9)  # huge -> capped
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.REFUSED, "clicked_appeal", "r"),
                        base=100, cap=800)
    await orch.appeal("a1", Trigger.WEBHOOK)
    a = store.get_account("a1")
    assert a.cooldown_until == 1000 + 800  # capped


async def test_cooldown_blocks_appeal(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "refused", 0, 5000, 1)  # cooling until 5000
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("a1", Trigger.SWEEP)
    assert out.skipped_reason == "cooldown"
    assert out.result is None


async def test_force_overrides_cooldown(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    store.set_account_state("a1", "refused", 0, 5000, 1)
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, SpamBotResult(Status.FREE, "checked", ""))
    out = await orch.appeal("a1", Trigger.MANUAL, force=True)
    assert out.result.status is Status.FREE


async def test_exception_in_flow_records_error(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    clock = FakeClock(1000)
    orch = orchestrator(store, clock, RuntimeError("boom"))
    out = await orch.appeal("a1", Trigger.WEBHOOK)
    assert out.result.status is Status.ERROR
    assert "boom" in out.result.raw_text
    a = store.get_account("a1")
    assert a.consec_failures == 1


async def test_alert_sent_for_refused(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/s.session")
    alerts = []
    orch = orchestrator(store, FakeClock(), SpamBotResult(Status.REFUSED, "clicked_appeal", "r"),
                        alerts=alerts)
    await orch.appeal("a1", Trigger.WEBHOOK)
    assert len(alerts) == 1
    assert "a1" in alerts[0]
