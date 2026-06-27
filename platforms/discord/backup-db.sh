#!/usr/bin/env bash
# Quick postgres backup before any deploy. Saves to /opt/discord-unibox/backups/.
set -euo pipefail
BACKUP_DIR="/opt/discord-unibox/backups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +"%Y%m%d_%H%M%S")
FILE="$BACKUP_DIR/unibox_${STAMP}.pgdump"
echo "[backup] dumping postgres → $FILE"
docker exec unibox-postgres pg_dump -U unibox -Fc unibox > "$FILE"
echo "[backup] done — $(du -sh "$FILE" | cut -f1)"
ls -1t "$BACKUP_DIR" | tail -n +6 | xargs -I{} rm -f "$BACKUP_DIR/{}"  # keep last 5
