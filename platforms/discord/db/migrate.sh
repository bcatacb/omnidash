#!/bin/sh
# db/migrate.sh — safe incremental migration runner.
#
# Tracks applied migrations in public.schema_migrations.
# Only runs migrations not yet applied — never re-runs, never wipes data.
# Safe to call on every deploy.
#
# Usage (from repo root):
#   COMPOSE_FILE=deploy/vps/docker-compose.prod.yml
#   ENV_FILE=.env
#   sh db/migrate.sh "$COMPOSE_FILE" "$ENV_FILE"

set -e

COMPOSE_FILE="${1:-deploy/vps/docker-compose.prod.yml}"
ENV_FILE="${2:-.env}"

run_sql() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    exec -T postgres psql -U unibox -d unibox -c "$1"
}

run_file() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    exec -T postgres psql -U unibox -d unibox < "$1"
}

echo "[migrate] ensuring schema_migrations table exists..."
run_sql "CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);" > /dev/null

MIGRATIONS_DIR="$(dirname "$0")/migrations"

for filepath in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  filename="$(basename "$filepath")"

  # Check if already applied.
  count=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    exec -T postgres psql -U unibox -d unibox -tAc \
    "SELECT COUNT(*) FROM public.schema_migrations WHERE filename = '$filename';")

  if [ "$count" -gt "0" ]; then
    echo "[migrate] skip  $filename (already applied)"
    continue
  fi

  echo "[migrate] apply $filename ..."
  run_file "$filepath"
  run_sql "INSERT INTO public.schema_migrations (filename) VALUES ('$filename');" > /dev/null
  echo "[migrate] done  $filename"
done

echo "[migrate] all migrations up to date."
