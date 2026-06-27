import pytest
from appeal_bot.session_provider import _ResponseAdapter
from appeal_bot.spambot_client import NoAppealButton


class FakeButton:
    def __init__(self, text):
        self.text = text


class FakeMsg:
    def __init__(self, buttons):
        self.message = "msg"
        self.buttons = buttons
        self.clicked_text = None

    async def click(self, **kwargs):
        self.clicked_text = kwargs.get("text")


async def test_click_matches_hint_caption():
    msg = FakeMsg([[FakeButton("Cancel"), FakeButton("But I'll never do it again!")]])
    await _ResponseAdapter(msg).click(text="never")
    assert msg.clicked_text == "But I'll never do it again!"


async def test_click_no_buttons_raises():
    with pytest.raises(NoAppealButton):
        await _ResponseAdapter(FakeMsg(None)).click(text="never")


async def test_click_no_matching_button_raises():
    msg = FakeMsg([[FakeButton("Cancel"), FakeButton("Help")]])
    with pytest.raises(NoAppealButton):
        await _ResponseAdapter(msg).click(text="never")
