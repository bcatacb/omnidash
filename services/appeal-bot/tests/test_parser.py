from appeal_bot.models import Status
from appeal_bot.parser import classify_status, classify_followup

FREE = "Good news, no limits are currently applied to your account."
LIMITED = (
    "I'm afraid some Telegram users flagged your account as a scam or spam. "
    "Your account is now limited until 26 Jun 2026."
)
LIFTED = "Thank you. I've lifted the limitations on your account. You're good to go!"
REFUSED = (
    "Unfortunately, your account was blocked by our moderators. "
    "I can't help with that. Please write to recover@telegram.org"
)
BACKOFF = "Looks like you used some buttons too often. Please try again later."
GARBAGE = "\U0001F914 something totally unexpected here"


def test_status_free():
    assert classify_status(FREE) is Status.FREE


def test_status_limited():
    assert classify_status(LIMITED) is Status.LIMITED


def test_status_unknown():
    assert classify_status(GARBAGE) is Status.UNKNOWN


def test_followup_lifted():
    assert classify_followup(LIFTED) is Status.LIFTED


def test_followup_refused():
    assert classify_followup(REFUSED) is Status.REFUSED


def test_followup_backoff():
    assert classify_followup(BACKOFF) is Status.BACKOFF


def test_followup_unknown():
    assert classify_followup(GARBAGE) is Status.UNKNOWN


def test_case_insensitive():
    assert classify_status(FREE.upper()) is Status.FREE
    assert classify_followup(LIFTED.upper()) is Status.LIFTED
