from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Config:
    api_id: int
    api_hash: str
    bot_token: str
    session_dir: str
    sqlite_path: str
    webhook_host: str = "0.0.0.0"
    webhook_port: int = 8080
    webhook_secret: str = ""
    sweep_interval_seconds: int = 43200
    cooldown_base_seconds: int = 86400
    cooldown_cap_seconds: int = 604800
    max_concurrency: int = 2
    operator_chat_ids: list[int] = field(default_factory=list)
    crm_callback_url: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Config":
        e = env if env is not None else os.environ

        def opt_int(key: str, default: int) -> int:
            return int(e[key]) if key in e and e[key] != "" else default

        ids_raw = e.get("APP_OPERATOR_CHAT_IDS", "").strip()
        ids = [int(x) for x in ids_raw.split(",") if x.strip()] if ids_raw else []
        callback = e.get("APP_CRM_CALLBACK_URL", "").strip() or None

        return cls(
            api_id=int(e["APP_API_ID"]),
            api_hash=e["APP_API_HASH"],
            bot_token=e["APP_BOT_TOKEN"],
            session_dir=e["APP_SESSION_DIR"],
            sqlite_path=e["APP_SQLITE_PATH"],
            webhook_host=e.get("APP_WEBHOOK_HOST", "0.0.0.0"),
            webhook_port=opt_int("APP_WEBHOOK_PORT", 8080),
            webhook_secret=e.get("APP_WEBHOOK_SECRET", ""),
            sweep_interval_seconds=opt_int("APP_SWEEP_INTERVAL_SECONDS", 43200),
            cooldown_base_seconds=opt_int("APP_COOLDOWN_BASE_SECONDS", 86400),
            cooldown_cap_seconds=opt_int("APP_COOLDOWN_CAP_SECONDS", 604800),
            max_concurrency=opt_int("APP_MAX_CONCURRENCY", 2),
            operator_chat_ids=ids,
            crm_callback_url=callback,
        )
