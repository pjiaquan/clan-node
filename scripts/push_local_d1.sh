#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-clan-db}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${DB_NAME}-export-${TIMESTAMP}.sql}"

mkdir -p "$BACKUP_DIR"

echo "Exporting local D1 to $EXPORT_PATH..."
wrangler d1 export "$DB_NAME" --local --output="$EXPORT_PATH"

echo "Dropping remote tables (keeping users/sessions)..."
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS relationships;"
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS person_custom_fields;"
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS people;"

echo "Applying schema on remote..."
wrangler d1 execute "$DB_NAME" --remote --file="./schema.sql"

echo "Importing into remote D1 (data only)..."
DATA_PATH="$(mktemp)"
sed '/^CREATE TABLE /,/;$/d' "$EXPORT_PATH" \
  | sed '/^CREATE INDEX /,/;$/d' \
  > "$DATA_PATH"
wrangler d1 execute "$DB_NAME" --remote --file="$DATA_PATH"
rm -f "$DATA_PATH"

echo "Syncing avatars from local to remote..."
LOCAL_API_BASE="${LOCAL_API_BASE:-http://localhost:8787}" \
REMOTE_API_BASE="${REMOTE_API_BASE:-https://clan-node-production.pjiaquan.workers.dev}" \
SYNC_DIRECTION="local-to-remote" \
npm run avatars:sync

echo "Done. Remote DB replaced using $EXPORT_PATH"
