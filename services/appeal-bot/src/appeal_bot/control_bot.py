from __future__ import annotations

from appeal_bot.models import Trigger
from appeal_bot.notifier import format_outcome
from appeal_bot.store import Store

HELP = (
    "Commands:\n"
    "/status [account_id] — fleet summary or one account\n"
    "/appeal <account_id> [--force] — appeal now\n"
    "/accounts — list managed accounts\n"
    "/history <account_id> — recent appeal outcomes"
)


async def handle_command(text: str, store: Store, orchestrator) -> str:
    parts = text.strip().split()
    if not parts:
        return HELP
    cmd, args = parts[0], parts[1:]

    if cmd == "/status":
        return _status(store, args)
    if cmd == "/appeal":
        return await _appeal(store, orchestrator, args)
    if cmd == "/accounts":
        return _accounts(store)
    if cmd == "/history":
        return _history(store, args)
    if cmd in ("/help", "/start"):
        return HELP
    return f"Unknown command: {cmd}\n\n{HELP}"


def _status(store: Store, args: list[str]) -> str:
    if args:
        acct = store.get_account(args[0])
        if acct is None:
            return f"Account {args[0]} not found."
        return (
            f"{acct.account_id}: {acct.last_status}\n"
            f"last_checked_at={acct.last_checked_at} "
            f"cooldown_until={acct.cooldown_until} "
            f"consec_failures={acct.consec_failures} "
            f"enabled={acct.enabled}"
        )
    accounts = store.list_accounts()
    counts: dict[str, int] = {}
    for a in accounts:
        counts[a.last_status] = counts.get(a.last_status, 0) + 1
    breakdown = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
    return f"Fleet: {len(accounts)} accounts ({breakdown})"


async def _appeal(store: Store, orchestrator, args: list[str]) -> str:
    if not args:
        return "Usage: /appeal <account_id> [--force]"
    account_id = args[0]
    force = "--force" in args[1:]
    outcome = await orchestrator.appeal(account_id, Trigger.MANUAL, force=force)
    return format_outcome(outcome)


def _accounts(store: Store) -> str:
    accounts = store.list_accounts()
    if not accounts:
        return "No accounts."
    return "\n".join(f"{a.account_id} ({a.phone}): {a.last_status}" for a in accounts)


def _history(store: Store, args: list[str]) -> str:
    if not args:
        return "Usage: /history <account_id>"
    rows = store.list_appeals(args[0], limit=10)
    if not rows:
        return f"No appeals for {args[0]}."
    return "\n".join(
        f"{r.created_at} [{r.trigger}] {r.sb_status} -> {r.outcome}" for r in rows
    )
