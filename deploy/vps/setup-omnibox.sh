#!/usr/bin/env bash
# Run this on the VPS as root.
# Usage: bash setup-omnibox.sh

set -e

echo "=== OmniBox VPS Setup (Telegram 8000, Discord 4000, TikTok 3000, Frontend 5174) ==="
echo "Server: $(hostname -I | awk '{print $1}')"

apt-get update -y
apt-get install -y \
  python3 python3-venv python3-pip \
  nodejs npm \
  git curl wget \
  postgresql-client \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
  libasound2 libatspi2.0-0 libxshmfence1 \
  ca-certificates

echo "=== Node & Python versions ==="
node --version || true
npm --version || true
python3 --version

echo "=== Clone or update repo (adjust if you use different location) ==="
REPO_DIR="/data/omnibox"
if [ ! -d "$REPO_DIR" ]; then
  # If you scp'ed instead, this will be skipped
  git clone https://github.com/your-org/omnibox.git "$REPO_DIR" || echo "git clone failed or private - use scp from your machine instead"
fi
cd "$REPO_DIR"

echo "=== Telegram backend setup ==="
cd Telegram/backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cd ../..

echo "=== Discord server deps ==="
cd Discord/app/server
npm ci || npm install
cd ../../..

echo "=== TikTok server + Playwright ==="
cd TikTok/server
npm ci || npm install
npx playwright install --with-deps chromium || true
cd ../../..

echo "=== Frontend deps ==="
cd frontend
npm ci || npm install
cd ..

echo "=== Create example env files (EDIT THESE WITH REAL VALUES) ==="
mkdir -p /root/.omnibox-envs

cat > /root/.omnibox-envs/telegram.env << 'EOT'
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef0123456
DATABASE_URL=sqlite:///./telegram_portal.db
# For unified migration later
EOT

cat > /root/.omnibox-envs/discord.env << 'EOT'
PORT=4000
DATABASE_URL=postgres://discord_user:CHANGE_ME@127.0.0.1:5432/discord_unibox
# Add any other keys your server uses (TOKEN_ENCRYPTION_KEY etc.)
EOT

cat > /root/.omnibox-envs/tiktok.env << 'EOT'
PORT=3000
# Supabase or direct PG
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
# or DATABASE_URL if direct
EOT

cat > /root/.omnibox-envs/frontend.env << 'EOT'
# Build-time vars for the unified frontend (baked at npm run build)
VITE_TELEGRAM_API=http://20.81.133.252:8000
VITE_DISCORD_API=http://20.81.133.252:4000
VITE_TIKTOK_API=http://20.81.133.252:3000
EOT

echo "=== Unified DB schema (run after you have postgres + UNIFIED_DATABASE_URL) ==="
echo "Example:"
echo "  psql -U postgres -c \"CREATE DATABASE omnibox;\""
echo "  UNIFIED_DATABASE_URL=postgres://... python db/migrate/backfill.py --apply-schema"

echo ""
echo "=== NEXT: Edit the env files in /root/.omnibox-envs/ with your real secrets and DB strings."
echo "=== Then start services (examples below, run in separate screen/tmux or make systemd units)."
echo ""
echo "To start (example in screen):"
echo "  screen -S tg"
echo "  cd /root/omnibox/Telegram/backend && source .venv/bin/activate && cp /root/.omnibox-envs/telegram.env .env && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "  screen -S discord"
echo "  cd /root/omnibox/Discord/app/server && cp /root/.omnibox-envs/discord.env .env && PORT=4000 npx tsx index.ts"
echo ""
echo "  screen -S tiktok"
echo "  cd /root/omnibox/TikTok/server && cp /root/.omnibox-envs/tiktok.env .env && PORT=3000 npx tsx index.ts"
echo ""
echo "  screen -S omnidash"
echo "  cd /root/omnibox/frontend && cp /root/.omnibox-envs/frontend.env .env.local && npm run dev -- --port 5174 --host 0.0.0.0"
echo ""
echo "Health checks:"
echo "  curl http://localhost:8000/health"
echo "  curl http://localhost:4000/ | head -c 200"
echo "  curl http://localhost:3000/ | head -c 200"
echo ""
echo "Then from your machine: http://20.81.133.252:5174 (or build + serve)"
echo "Done with base setup."
