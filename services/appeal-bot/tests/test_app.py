from appeal_bot.app import sync_accounts_from_dir
from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "s.db"))
    s.init_db()
    return s


def test_sync_accounts_from_dir_imports_sessions(tmp_path):
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    (sessions / "acc1.session").write_text("x")
    (sessions / "acc2.session").write_text("x")
    (sessions / "notes.txt").write_text("ignore me")
    store = make_store(tmp_path)

    added = sync_accounts_from_dir(store, str(sessions))

    assert added == 2
    ids = {a.account_id for a in store.list_accounts()}
    assert ids == {"acc1", "acc2"}
    acc1 = store.get_account("acc1")
    assert acc1.session_path.endswith("acc1.session")


def test_sync_is_idempotent(tmp_path):
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    (sessions / "acc1.session").write_text("x")
    store = make_store(tmp_path)
    sync_accounts_from_dir(store, str(sessions))
    sync_accounts_from_dir(store, str(sessions))
    assert len(store.list_accounts()) == 1
