import pytest

from appeal_bot.models import Status
from appeal_bot.spambot_client import SpamBotClient, NoAppealButton

FREE = "Good news, no limits are currently applied to your account."
LIMITED = "Your account is now limited until tomorrow. Sorry about that."
LIFTED = "Thank you. I've lifted the limitations on your account."


class FakeResponse:
    def __init__(self, text, has_button=True):
        self.text = text
        self._has_button = has_button
        self.clicked = False

    async def click(self, **kwargs):
        if not self._has_button:
            raise NoAppealButton("no buttons")
        self.clicked = True
        return None


class FakeConversation:
    """Serves queued responses in order; records sent messages."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.sent = []

    async def send_message(self, text):
        self.sent.append(text)

    async def get_response(self):
        if not self._responses:
            raise AssertionError("no more responses queued")
        return self._responses.pop(0)


async def test_free_account_only_checks():
    conv = FakeConversation([FakeResponse(FREE)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.FREE
    assert result.action == "checked"
    assert conv.sent == ["/start"]


async def test_limited_clicks_button_and_lifts():
    first = FakeResponse(LIMITED)
    second = FakeResponse(LIFTED)
    conv = FakeConversation([first, second])
    result = await SpamBotClient().run(conv)
    assert first.clicked is True
    assert result.status is Status.LIFTED
    assert result.action == "clicked_appeal"
    assert FREE not in result.raw_text
    assert "limited" in result.raw_text.lower()
    assert "lifted" in result.raw_text.lower()


async def test_limited_without_button_is_unknown():
    conv = FakeConversation([FakeResponse(LIMITED, has_button=False)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.UNKNOWN
    assert result.action == "checked"


async def test_unparseable_first_reply_is_unknown():
    conv = FakeConversation([FakeResponse("???", has_button=False)])
    result = await SpamBotClient().run(conv)
    assert result.status is Status.UNKNOWN
    assert result.action == "checked"
