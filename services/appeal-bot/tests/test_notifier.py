from appeal_bot.models import SpamBotResult, Status, AppealOutcome
from appeal_bot.notifier import format_outcome, should_alert


def test_format_lifted_outcome():
    res = SpamBotResult(Status.LIFTED, "clicked_appeal", "raw")
    out = AppealOutcome("a1", skipped_reason=None, result=res)
    msg = format_outcome(out)
    assert "a1" in msg
    assert "lifted" in msg.lower()


def test_format_skipped_outcome():
    out = AppealOutcome("a1", skipped_reason="cooldown", result=None)
    msg = format_outcome(out)
    assert "a1" in msg
    assert "cooldown" in msg.lower()


def test_should_alert_true_for_refused_and_unknown():
    for st in (Status.REFUSED, Status.UNKNOWN, Status.ERROR, Status.LIFTED):
        out = AppealOutcome("a1", None, SpamBotResult(st, "checked", ""))
        assert should_alert(out) is True


def test_should_alert_false_for_free_and_skips():
    out_free = AppealOutcome("a1", None, SpamBotResult(Status.FREE, "checked", ""))
    out_skip = AppealOutcome("a1", "cooldown", None)
    assert should_alert(out_free) is False
    assert should_alert(out_skip) is False


def test_should_alert_true_for_backoff():
    from appeal_bot.models import AppealOutcome, SpamBotResult, Status
    from appeal_bot.notifier import should_alert
    out = AppealOutcome("a1", None, SpamBotResult(Status.BACKOFF, "clicked_appeal", ""))
    assert should_alert(out) is True
