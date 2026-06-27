import pytest

from appeal_bot.models import AccountRecord
from appeal_bot.session_provider import SessionProvider


def make_account(path):
    return AccountRecord(
        account_id="a1", phone="+1", session_path=path,
        last_status="unknown", last_checked_at=0, cooldown_until=0,
        consec_failures=0, enabled=True,
    )


def test_resolve_uses_account_path_when_present(tmp_path):
    sess = tmp_path / "a1.session"
    sess.write_text("x")
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    assert sp.resolve_path(make_account(str(sess))) == str(sess)


def test_resolve_falls_back_to_dir_plus_id(tmp_path):
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    acct = make_account("")  # no explicit path
    expected = str(tmp_path / "a1.session")
    assert sp.resolve_path(acct) == expected


def test_resolve_missing_file_raises(tmp_path):
    sp = SessionProvider(session_dir=str(tmp_path), api_id=1, api_hash="h")
    acct = make_account(str(tmp_path / "missing.session"))
    with pytest.raises(FileNotFoundError):
        sp.resolve_path(acct, must_exist=True)
