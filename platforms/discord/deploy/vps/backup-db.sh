#!/usr/bin/env bash
# Backs up critical tables to /opt/discord-unibox/backups/ before each deploy.
# Keeps last 14 daily backups. Safe to run any time — never touches live data.
set -euo pipefail

BACKUP_DIR="/opt/discord-unibox/backups"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/accounts_$STAMP.sql"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping discord_accounts -> $FILE"
docker exec unibox-postgres pg_dump \
  -U unibox \
  -d unibox \
  --no-owner \
  -t tenant_main.discord_accounts \
  -t public.users \
  > "$FILE"

echo "[backup] done ($(wc -c < "$FILE") bytes)"

# Keep only the 14 most recent backups.
ls -tp "$BACKUP_DIR"/accounts_*.sql 2>/dev/null | tail -n +15 | xargs -r rm --
echo "[backup] old backups pruned, $(ls "$BACKUP_DIR"/accounts_*.sql | wc -l) kept"
