"""Read-only audit of the telegram-portal backend. Runs ON the server."""
import glob
import os
import re
import sqlite3

BACKEND = "/root/Telegram-Portal/backend"


def section(t):
    print("\n=== %s ===" % t)


# --- DB audit ---
section("DB files")
dbs = sorted(set(glob.glob(BACKEND + "/**/*.db", recursive=True)))
dbs = [d for d in dbs if "/.venv/" not in d]
print(dbs)

for db in dbs:
    try:
        con = sqlite3.connect(db)
        cur = con.cursor()
        tabs = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")]
        print("\n%s -> tables: %s" % (db, tabs))
        for t in tabs:
            cols = [r[1] for r in cur.execute("PRAGMA table_info(%s)" % t)]
            low = [c.lower() for c in cols]
            if not any(k in low for k in ("proxy", "session", "phone", "api_id")):
                continue
            n = cur.execute("SELECT count(*) FROM %s" % t).fetchone()[0]
            print("  TABLE %s (%d rows) cols=%s" % (t, n, cols))
            if "proxy" in low:
                wp = cur.execute(
                    "SELECT count(*) FROM %s WHERE proxy IS NOT NULL AND proxy != ''" % t
                ).fetchone()[0]
                print("    rows_with_proxy: %d / %d" % (wp, n))
            for sc in ("status", "state", "is_banned", "banned", "active"):
                if sc in low:
                    rows = cur.execute(
                        "SELECT %s, count(*) FROM %s GROUP BY %s" % (sc, t, sc)
                    ).fetchall()
                    print("    %s: %s" % (sc, [(r[0], r[1]) for r in rows]))
            for ac in ("api_id", "app_id", "api_hash"):
                if ac in low:
                    d = cur.execute(
                        "SELECT count(DISTINCT %s) FROM %s" % (ac, t)).fetchone()[0]
                    print("    distinct_%s: %d" % (ac, d))
        con.close()
    except Exception as e:
        print("  ERR", db, type(e).__name__, e)

# --- PySocks ---
section("PySocks installed?")
try:
    import socks  # noqa
    print("INSTALLED")
except Exception as e:
    print("NOT INSTALLED (%s) -> proxy use would raise" % type(e).__name__)

# --- pacing/config extraction from code ---
def grab(path, patterns, ctx=0):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except Exception as e:
        print("  (cannot read %s: %s)" % (path, e))
        return
    for i, ln in enumerate(lines):
        for p in patterns:
            if re.search(p, ln):
                print("  %d: %s" % (i + 1, ln.strip()[:160]))
                break

cw = BACKEND + "/app/services/campaign_worker.py"
section("interval / daily-limit config reads (campaign_worker)")
grab(cw, [r"record\.get\(", r"settings\.get\(", r"interval", r"daily_limit",
          r"messagesPerAccount", r"perAccount", r"min_interval|max_interval"])

section("how daily_limit==0 is treated")
grab(cw, [r"daily_limit\s*(==|<=|>)\s*0", r"if\s+daily_limit", r"daily_limit\s*and",
          r"no daily", r"unlimited"])

section("api_id source in telegram helper / accounts route")
grab(BACKEND + "/app/helpers/telegram.py", [r"api_id", r"API_ID", r"settings\."])
grab(BACKEND + "/app/routes/accounts.py", [r"qr_api_id|phone_api_id", r"api_id\s*=", r"settings\."])
