from appeal_bot.store import Store


def make_store(tmp_path):
    s = Store(str(tmp_path / "state.db"))
    s.init_db()
    return s


def test_upsert_and_get_account(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s/a1.session")
    acct = s.get_account("a1")
    assert acct.account_id == "a1"
    assert acct.phone == "+100"
    assert acct.session_path == "/s/a1.session"
    assert acct.enabled is True
    assert acct.last_status == "unknown"


def test_upsert_is_idempotent_and_updates_path(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/old.session")
    s.upsert_account("a1", "+100", "/new.session")
    assert s.get_account("a1").session_path == "/new.session"
    assert len(s.list_accounts()) == 1


def test_get_missing_account_returns_none(tmp_path):
    s = make_store(tmp_path)
    assert s.get_account("nope") is None


def test_set_account_state(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s.session")
    s.set_account_state("a1", "limited", 1000, 1000 + 86400, 1)
    a = s.get_account("a1")
    assert a.last_status == "limited"
    assert a.last_checked_at == 1000
    assert a.cooldown_until == 1000 + 86400
    assert a.consec_failures == 1


def test_record_and_list_appeals(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("a1", "+100", "/s.session")
    s.record_appeal("a1", 1000, "webhook", "limited", "clicked_appeal", "lifted", "raw")
    s.record_appeal("a1", 2000, "sweep", "free", "checked", "free", "raw2")
    rows = s.list_appeals("a1", limit=10)
    assert len(rows) == 2
    # newest first
    assert rows[0].created_at == 2000
    assert rows[0].outcome == "free"


def test_due_for_sweep(tmp_path):
    s = make_store(tmp_path)
    s.upsert_account("ready", "+1", "/r.session")
    s.upsert_account("cooling", "+2", "/c.session")
    s.upsert_account("off", "+3", "/o.session")
    s.set_account_state("ready", "free", 0, 500, 0)
    s.set_account_state("cooling", "refused", 0, 99999, 1)
    s.set_account_enabled("off", False)
    due = s.due_for_sweep(now=1000)
    ids = {a.account_id for a in due}
    assert ids == {"ready"}  # cooling still cooling, off disabled
