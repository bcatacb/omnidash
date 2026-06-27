from appeal_bot.models import Status, Trigger, SpamBotResult, AccountRecord


def test_status_values_are_strings():
    assert Status.FREE.value == "free"
    assert Status.LIFTED.value == "lifted"
    assert Status.REFUSED == "refused"  # str-enum equality


def test_trigger_values():
    assert {t.value for t in Trigger} == {"webhook", "sweep", "manual"}


def test_spambot_result_defaults():
    r = SpamBotResult(status=Status.FREE, action="checked", raw_text="ok")
    assert r.status is Status.FREE
    assert r.action == "checked"
    assert r.raw_text == "ok"


def test_account_record_fields():
    a = AccountRecord(
        account_id="a1", phone="+100", session_path="/s/a1.session",
        last_status="free", last_checked_at=0, cooldown_until=0,
        consec_failures=0, enabled=True,
    )
    assert a.account_id == "a1"
    assert a.enabled is True
