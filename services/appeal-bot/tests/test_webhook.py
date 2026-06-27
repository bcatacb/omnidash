import pytest
from aiohttp.test_utils import TestClient, TestServer

from appeal_bot.models import AppealOutcome, SpamBotResult, Status, Trigger
from appeal_bot.webhook import build_app


class FakeOrchestrator:
    def __init__(self):
        self.calls = []

    async def appeal(self, account_id, trigger, force=False):
        self.calls.append((account_id, trigger, force))
        return AppealOutcome(account_id, None, SpamBotResult(Status.FREE, "checked", ""))


@pytest.fixture
async def client(aiohttp_client):
    orch = FakeOrchestrator()
    app = build_app(orch, secret="s3cret")
    app["orch"] = orch
    return await aiohttp_client(app)


async def test_rejects_missing_secret(client):
    resp = await client.post("/appeal", json={"account_id": "a1"})
    assert resp.status == 401
    assert client.app["orch"].calls == []


async def test_rejects_wrong_secret(client):
    resp = await client.post(
        "/appeal", json={"account_id": "a1"}, headers={"X-Auth-Token": "nope"}
    )
    assert resp.status == 401


async def test_rejects_missing_account_id(client):
    resp = await client.post(
        "/appeal", json={}, headers={"X-Auth-Token": "s3cret"}
    )
    assert resp.status == 400


async def test_accepts_and_dispatches(client):
    resp = await client.post(
        "/appeal", json={"account_id": "a1"}, headers={"X-Auth-Token": "s3cret"}
    )
    assert resp.status == 202
    # the background task should have run by now
    await _wait_for(lambda: client.app["orch"].calls)
    assert client.app["orch"].calls[0] == ("a1", Trigger.WEBHOOK, False)


def test_build_app_rejects_empty_secret():
    with pytest.raises(ValueError):
        build_app(FakeOrchestrator(), secret="")


async def _wait_for(predicate, tries=50):
    import asyncio
    for _ in range(tries):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met")
