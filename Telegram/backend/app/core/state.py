import asyncio
from datetime import datetime
from dataclasses import dataclass
from typing import Any
from telethon import TelegramClient


@dataclass
class PendingQrLogin:
    user_id: str
    session_name: str
    client: TelegramClient
    qr_login: Any
    requires_password: bool
    created_at: datetime
    expires_at: datetime
    device_fingerprint: dict[str, str] | None = None
    api_id_override: int | None = None
    api_hash_override: str | None = None


PENDING_QR_LOGINS: dict[str, PendingQrLogin] = {}


@dataclass
class PendingPhoneLogin:
    user_id: str
    session_name: str
    client: TelegramClient
    phone: str
    phone_code_hash: str
    requires_password: bool
    created_at: datetime
    expires_at: datetime
    device_fingerprint: dict[str, str] | None = None
    api_id_override: int | None = None
    api_hash_override: str | None = None


PENDING_PHONE_LOGINS: dict[str, PendingPhoneLogin] = {}
ACCOUNT_SESSION_LOCKS: dict[str, asyncio.Lock] = {}
GROUP_SCRAPER_TASKS: dict[str, asyncio.Task] = {}
GROUP_SCRAPER_STOP_REQUESTED: set[str] = set()
MASS_GROUP_TASKS: dict[str, asyncio.Task] = {}
MASS_GROUP_STOP_REQUESTED: set[str] = set()
CONVERSATIONS_CACHE: dict[str, tuple[datetime, list[dict[str, Any]], list[str], bool]] = {}
CONVERSATION_REFRESH_TASKS: dict[str, asyncio.Task] = {}
# Per-folder membership-resolved conversation cache (folder view). Same tuple shape as
# CONVERSATIONS_CACHE: (expires_at, items, errors, has_more). Keyed by "{user_id}:foldconv:{folder_id}".
FOLDER_CONVERSATIONS_CACHE: dict[str, tuple[datetime, list[dict[str, Any]], list[str], bool]] = {}
FOLDER_CONVERSATIONS_REFRESH_TASKS: dict[str, asyncio.Task] = {}
# Warm Telethon clients kept connected between chat-reading requests so we avoid paying the
# MTProto connect()+auth round-trip on every call. Keyed by account_id. Access is serialized
# by ACCOUNT_SESSION_LOCKS; an idle sweeper disconnects clients unused for a while.
WARM_CLIENTS: dict[str, TelegramClient] = {}
WARM_CLIENT_LAST_USED: dict[str, float] = {}
GROUP_SCRAPER_CANDIDATES: dict[str, list[int]] = {}
CAMPAIGN_TASKS: dict[str, asyncio.Task] = {}
CAMPAIGN_TASK_LOCK: asyncio.Lock = asyncio.Lock()
CAMPAIGN_STOP_REQUESTED: set[str] = set()
# Campaigns the user paused (a subset of stop-requested). The worker uses this to choose
# the terminal status 'paused' instead of 'stopped', so a pause can't be downgraded by the
# worker's cleanup racing the pause endpoint.
CAMPAIGN_PAUSE_REQUESTED: set[str] = set()
CAMPAIGN_SCRAPED_MEMBERS: dict[str, list[dict[str, Any]]] = {}
LAST_CONNECT_TIME: dict[str, float] = {}
FLOODED_ACCOUNTS: dict[str, float] = {}
LOGIN_ATTEMPTS: dict[str, list[float]] = {}

# Notification listeners: one persistent Telethon client per account that has at least
# one enabled watcher, listening for outgoing `/m` commands in watched group chats.
# Keyed by account_id. In-memory only; re-armed on startup by resume_all_listeners().
NOTIFICATION_LISTENER_TASKS: dict[str, asyncio.Task] = {}
NOTIFICATION_LISTENER_STOP_REQUESTED: set[str] = set()

# Group-chat folder listeners: one persistent Telethon client per account that owns a
# 'group_chat' folder, watching the chosen group for forwarded messages and adding each
# forwarded message's original author to the folder. Keyed by account_id. In-memory only;
# re-armed on startup by resume_group_folder_listeners().
GROUP_FOLDER_LISTENER_TASKS: dict[str, asyncio.Task] = {}
GROUP_FOLDER_LISTENER_STOP_REQUESTED: set[str] = set()

# Persistent listener clients are account-owned Telethon clients used by always-on
# background listeners. Transient routes may borrow these instead of opening a second
# client against the same .session file.
PERSISTENT_ACCOUNT_CLIENTS: dict[str, TelegramClient] = {}
PERSISTENT_CLIENT_IDS: set[int] = set()

WARMUP_TASKS: dict[str, asyncio.Task] = {}
WARMUP_STOP_REQUESTED: set[str] = set()
WARMUP_STATES: dict[str, dict[str, Any]] = {}
WARMUP_ACTIVITY_LOG: dict[str, list[dict[str, Any]]] = {}

# Group-add (a.k.a. forward-contacts) jobs: forward DM history (or add+kick) for
# no-username/no-phone scraped users into a chosen group. Progress is DB-backed
# (group_add_jobs / group_add_targets); these registries only track the in-process
# asyncio task and pause/stop requests so the job survives page refreshes and restarts.
GROUP_ADD_TASKS: dict[str, asyncio.Task] = {}
GROUP_ADD_TASK_LOCK: asyncio.Lock = asyncio.Lock()
GROUP_ADD_STOP_REQUESTED: set[str] = set()
GROUP_ADD_PAUSE_REQUESTED: set[str] = set()
