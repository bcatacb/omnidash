from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Status(str, Enum):
    FREE = "free"          # no limits
    LIMITED = "limited"    # limited, appeal button present
    LIFTED = "lifted"      # appeal succeeded
    REFUSED = "refused"    # @SpamBot can't help -> email path
    BACKOFF = "backoff"    # "used buttons too often" -> retry later
    UNKNOWN = "unknown"    # unparseable -> escalate
    ERROR = "error"        # exception during flow


class Trigger(str, Enum):
    WEBHOOK = "webhook"
    SWEEP = "sweep"
    MANUAL = "manual"


@dataclass
class SpamBotResult:
    status: Status
    action: str            # checked | clicked_appeal | none
    raw_text: str          # full transcript joined with "\n---\n"


@dataclass
class AccountRecord:
    account_id: str
    phone: str
    session_path: str
    last_status: str
    last_checked_at: int
    cooldown_until: int
    consec_failures: int
    enabled: bool


@dataclass
class AppealOutcome:
    """Result of AppealOrchestrator.appeal()."""
    account_id: str
    skipped_reason: str | None     # None if an appeal actually ran
    result: SpamBotResult | None   # None if skipped
