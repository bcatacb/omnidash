from __future__ import annotations

from appeal_bot.models import Status


def classify_status(text: str) -> Status:
    """Classify the FIRST @SpamBot reply (status check)."""
    t = text.lower()
    if "no limits" in t or "no limitations" in t:
        return Status.FREE
    if "limited" in t or "flagged" in t or "restricted" in t or "spam" in t:
        return Status.LIMITED
    return Status.UNKNOWN


def classify_followup(text: str) -> Status:
    """Classify the reply AFTER clicking the appeal button."""
    t = text.lower()
    if "too often" in t or "try again later" in t:
        return Status.BACKOFF
    if (
        "can't help" in t
        or "cannot help" in t
        or "recover@telegram.org" in t
        or "blocked" in t
    ):
        return Status.REFUSED
    if "lifted" in t or "no longer limited" in t or "good to go" in t:
        return Status.LIFTED
    return Status.UNKNOWN
