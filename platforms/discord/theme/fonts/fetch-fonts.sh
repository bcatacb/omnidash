#!/usr/bin/env bash
# Fetch Inter (variable) woff2 files from the fontsource CDN.
# Run from theme/fonts/ — produces theme/fonts/files/*.woff2.
#
# Usage:
#   chmod +x fetch-fonts.sh
#   ./fetch-fonts.sh

set -euo pipefail

cd "$(dirname "$0")"
mkdir -p files

BASE="https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2"
ITALIC="https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-italic.woff2"

echo "Downloading Inter Variable (upright)..."
curl -fL --retry 3 -o files/inter-latin-wght-normal.woff2 "$BASE"

echo "Downloading Inter Variable (italic)..."
curl -fL --retry 3 -o files/inter-latin-wght-italic.woff2 "$ITALIC" || \
  echo "  (italic file is optional; skipping)"

echo "Done. Files in: $(pwd)/files/"
ls -lh files/
