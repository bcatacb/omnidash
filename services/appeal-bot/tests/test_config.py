from appeal_bot.config import Config


def test_from_env_parses_types(monkeypatch):
    env = {
        "APP_API_ID": "123456",
        "APP_API_HASH": "abc",
        "APP_BOT_TOKEN": "tok",
        "APP_SESSION_DIR": "/s",
        "APP_SQLITE_PATH": "/db.sqlite",
        "APP_WEBHOOK_SECRET": "secret",
        "APP_OPERATOR_CHAT_IDS": "11,22",
        "APP_MAX_CONCURRENCY": "3",
    }
    cfg = Config.from_env(env)
    assert cfg.api_id == 123456
    assert cfg.api_hash == "abc"
    assert cfg.operator_chat_ids == [11, 22]
    assert cfg.max_concurrency == 3
    # defaults applied
    assert cfg.cooldown_base_seconds == 86400
    assert cfg.crm_callback_url is None


def test_from_env_missing_required_raises(monkeypatch):
    import pytest
    with pytest.raises(KeyError):
        Config.from_env({})
