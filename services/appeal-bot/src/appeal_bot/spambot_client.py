from __future__ import annotations

from appeal_bot.models import SpamBotResult, Status
from appeal_bot.parser import classify_followup, classify_status


class NoAppealButton(Exception):
    """Raised by a response.click() when no inline button is present."""


def _join(parts: list[str]) -> str:
    return "\n---\n".join(parts)


class SpamBotClient:
    """Drives the @SpamBot conversation. `conv` must expose async
    send_message(text), get_response() -> resp, where resp has `.text`
    and async `.click(**kwargs)` (raising NoAppealButton if absent)."""

    def __init__(self, appeal_button_hint: str = "never"):
        self._hint = appeal_button_hint

    async def run(self, conv) -> SpamBotResult:
        await conv.send_message("/start")
        first = await conv.get_response()
        transcript = [first.text]

        status = classify_status(first.text)
        if status is not Status.LIMITED:
            # FREE or UNKNOWN: nothing to appeal
            return SpamBotResult(status=status, action="checked",
                                 raw_text=_join(transcript))

        # Limited: try to click the appeal button.
        try:
            await first.click(text=self._hint)
        except NoAppealButton:
            return SpamBotResult(status=Status.UNKNOWN, action="checked",
                                 raw_text=_join(transcript))

        follow = await conv.get_response()
        transcript.append(follow.text)
        outcome = classify_followup(follow.text)
        return SpamBotResult(status=outcome, action="clicked_appeal",
                             raw_text=_join(transcript))
