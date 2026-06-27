import pytest

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.control_bot import handle_command
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
        return AppealOutcome(account_id, None, SpamBotResult(Status.LIFTED, "clicked_appeal", ""))


async def test_status_summary(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.upsert_account("a2", "+2", "/2.session")
    store.set_account_state("a1", "free", 0, 0, 0)
    store.set_account_state("a2", "refused", 0, 0, 1)
    reply = await handle_command("/status", store, FakeOrchestrator())
    assert "free" in reply and "refused" in reply
    assert "2" in reply  # total count


async def test_status_for_one_account(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.set_account_state("a1", "limited", 123, 999, 2)
    reply = await handle_command("/status a1", store, FakeOrchestrator())
    assert "a1" in reply
    assert "limited" in reply


async def test_status_unknown_account(tmp_path):
    store = make_store(tmp_path)
    reply = await handle_command("/status ghost", store, FakeOrchestrator())
    assert "ghost" in reply
    assert "not found" in reply.lower()


async def test_appeal_command_dispatches(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    orch = FakeOrchestrator()
    reply = await handle_command("/appeal a1", store, orch)
    assert orch.calls == [("a1", Trigger.MANUAL, False)]
    assert "lifted" in reply.lower()


async def test_appeal_force_flag(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    orch = FakeOrchestrator()
    await handle_command("/appeal a1 --force", store, orch)
    assert orch.calls == [("a1", Trigger.MANUAL, True)]


async def test_accounts_list(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.upsert_account("a2", "+2", "/2.session")
    reply = await handle_command("/accounts", store, FakeOrchestrator())
    assert "a1" in reply and "a2" in reply


async def test_history_command(tmp_path):
    store = make_store(tmp_path)
    store.upsert_account("a1", "+1", "/1.session")
    store.record_appeal("a1", 1000, "webhook", "limited", "clicked_appeal", "lifted", "raw")
    reply = await handle_command("/history a1", store, FakeOrchestrator())
    assert "lifted" in reply


async def test_unknown_command(tmp_path):
    store = make_store(tmp_path)
    reply = await handle_command("/wat", store, FakeOrchestrator())
    assert "unknown" in reply.lower() or "help" in reply.lower()
