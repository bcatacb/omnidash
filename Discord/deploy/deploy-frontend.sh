#!/usr/bin/env bash
# Frontend + extension-zip deploy script.
#
# Builds the React app, rsyncs it to the nginx static folder, then re-bakes
# the extension zip alongside so the "Download" button on /app/sessions keeps
# working after every deploy.
#
# Previously the zip lived in /data/discord-unibox/landing/ but rsync --delete
# would wipe it on each deploy. This script:
#   1. Builds the extension dist
#   2. Builds the React app
#   3. rsyncs dist/ → /data/discord-unibox/landing/ with --exclude for the zip
#   4. Rebuilds the zip from the freshly-built extension dist
#   5. Copies the zip into place
#
# Run from the repo root: bash deploy/deploy-frontend.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
EXT_DIR="$REPO_ROOT/extension"
LANDING_DIR="/data/discord-unibox/landing"
ZIP_PATH="$LANDING_DIR/gg-extension.zip"

echo "==> Building extension dist (via Docker — no host Node required)"
docker run --rm \
  -v "$EXT_DIR:/ext" \
  -w /ext \
  node:20-alpine \
  sh -c "npm install && npx esbuild background.ts content-script.ts options.ts popup.ts page-bridge.ts \
    --bundle --outdir=dist --target=chrome120 --format=esm \
    && cp manifest.json dist/ && cp options.html dist/ && cp popup.html dist/"

echo "==> Building React app (via Docker — no host Node required)"
docker run --rm \
  -v "$APP_DIR:/app" \
  -v "$REPO_ROOT/theme:/theme" \
  -w /app \
  node:20-alpine \
  sh -c "npm install && npx vite build"

echo "==> Rsync dist → landing (excluding gg-extension.zip)"
sudo rsync -a --delete --exclude='gg-extension.zip' "$APP_DIR/dist/" "$LANDING_DIR/"
sudo chmod -R a+rX "$LANDING_DIR"

echo "==> Rebuilding extension zip → $ZIP_PATH"
cd "$EXT_DIR/dist"
sudo rm -f "$ZIP_PATH"
sudo zip -r "$ZIP_PATH" .
sudo chmod a+r "$ZIP_PATH"

echo "==> Smoke-checking landing + zip"
ls -la "$LANDING_DIR/index.html" "$ZIP_PATH"
curl -s -o /dev/null -w "  https://gg.linktree.bond/             → HTTP %{http_code}\n" "https://gg.linktree.bond/"
curl -s -o /dev/null -w "  https://gg.linktree.bond/gg-extension.zip → HTTP %{http_code}\n" "https://gg.linktree.bond/gg-extension.zip"

echo "==> Done"
