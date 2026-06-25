# Telegram Portal Backend (Restored)

This is a restored FastAPI backend for the Telegram Portal frontend.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Environment

Edit `.env` and set real Telegram credentials:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

QR login endpoints now use Telethon and create real Telegram sessions in `backend/sessions`.

SQLite is configured by default with:

- `DATABASE_URL=sqlite:///./telegram_portal.db`

## Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Health check

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/`

The API base used by frontend is `/api/v1`.
