import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8",
        extra="ignore"
    )

    app_name: str = Field(default="Telegram Portal API")
    app_env: str = Field(default="development")
    cors_origins: str = Field(default="http://localhost:3000")
    database_url: str = Field(default="sqlite:///./telegram_portal.db")
    jwt_secret: str = Field(default="change-me-in-env")
    telegram_api_id: int = Field(default=0)
    telegram_api_hash: str = Field(default="")


BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")
settings = Settings()


def _parse_sqlite_path(database_url: str) -> str:
    if not database_url.startswith("sqlite:///"):
        raise ValueError("Only sqlite URLs are supported in this restored backend.")
    return database_url.replace("sqlite:///", "", 1)


def _default_data_dir() -> Path:
    """A writable data root that lives OUTSIDE any cloud-synced folder.

    SQLite (the app DB *and* Telethon ``.session`` files) corrupts/locks when a sync client like
    OneDrive grabs handles on the live ``-wal``/``-shm`` files. Default to a local, non-synced
    location; allow an explicit override via ``TELEGRAM_PORTAL_DATA_DIR``.
    """
    env = os.getenv("TELEGRAM_PORTAL_DATA_DIR")
    if env:
        return Path(env).expanduser()
    local_app_data = os.getenv("LOCALAPPDATA")  # Windows, non-synced
    if local_app_data:
        return Path(local_app_data) / "TelegramPortal"
    return Path.home() / ".telegram-portal"


DATA_DIR = _default_data_dir().resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

# DB location: default to DATA_DIR (outside OneDrive). Honor DATABASE_URL ONLY when it is an
# ABSOLUTE path — a deliberate, chosen location. The legacy default `sqlite:///./telegram_portal.db`
# is relative (and resolves back into the synced project folder), so it is intentionally ignored
# here and the DB is moved to DATA_DIR instead (the legacy file is migrated once on startup).
_database_url = settings.database_url
_db_candidate = Path(_parse_sqlite_path(_database_url)).expanduser()
if _db_candidate.is_absolute():
    DB_PATH = _db_candidate.resolve()
else:
    DB_PATH = DATA_DIR / "telegram_portal.db"

SESSION_DIR = DATA_DIR / "sessions"
MEDIA_DIR = DATA_DIR / "media"
SESSION_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

# Legacy (likely OneDrive-synced, CWD-relative) locations used before the move — kept so the app
# can copy existing data into DATA_DIR once, on first run after the upgrade.
LEGACY_DB_PATH = Path(_parse_sqlite_path(settings.database_url)).resolve()
LEGACY_SESSION_DIR = Path("./sessions").resolve()
LEGACY_MEDIA_DIR = Path("./media").resolve()

QR_TTL_SECONDS = 300
