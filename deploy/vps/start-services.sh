#!/usr/bin/env bash
# Run on VPS after envs are prepared in /root/.omnibox-envs
# Best run inside screen or tmux sessions, one per service.

set -e

OMNI=/root/omnibox

echo "Killing old processes on ports..."
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 5174/tcp 2>/dev/null || true
sleep 1

echo "=== Starting Telegram on 8000 ==="
cd $OMNI/Telegram/backend
source .venv/bin/activate || true
cp /root/.omnibox-envs/telegram.env .env 2>/dev/null || true
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/tg.log 2>&1 &
echo "TG started, log /tmp/tg.log"

echo "=== Starting Discord on 4000 ==="
cd $OMNI/Discord/app/server
cp /root/.omnibox-envs/discord.env .env 2>/dev/null || true
nohup env PORT=4000 npx tsx index.ts > /tmp/discord.log 2>&1 &
echo "Discord started"

echo "=== Starting TikTok on 3000 ==="
cd $OMNI/TikTok/server
cp /root/.omnibox-envs/tiktok.env .env 2>/dev/null || true
nohup env PORT=3000 npx tsx index.ts > /tmp/tiktok.log 2>&1 &
echo "TikTok started"

echo "=== Starting OmniDash frontend on 5174 (dev) ==="
cd $OMNI/frontend
cp /root/.omnibox-envs/frontend.env .env.local 2>/dev/null || true
# For server access from outside, the VITE_ values should use the public IP
nohup npm run dev -- --port 5174 --host 0.0.0.0 > /tmp/omnidash.log 2>&1 &
echo "Frontend started"

echo ""
echo "Check:"
echo "  curl -s http://localhost:8000/health | cat"
echo "  curl -s http://localhost:4000/ | head -c 100"
echo "  curl -s http://localhost:3000/ | head -c 100"
echo ""
echo "Open in browser: http://80.208.224.130:5174"
echo "Logs in /tmp/*.log"
