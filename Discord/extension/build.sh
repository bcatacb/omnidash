#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
mkdir -p dist
npx esbuild background.ts content-script.ts options.ts popup.ts page-bridge.ts \
  --bundle --outdir=dist --target=chrome120 --format=esm
cp manifest.json dist/
cp options.html dist/
cp popup.html dist/
echo "Built to extension/dist/ — load this folder via chrome://extensions → Load unpacked"
