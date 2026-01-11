#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-clan-db}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${DB_NAME}-export-${TIMESTAMP}.sql}"

mkdir -p "$BACKUP_DIR"

echo "Exporting local D1 to $EXPORT_PATH..."
wrangler d1 export "$DB_NAME" --local --output="$EXPORT_PATH"

echo "Dropping remote tables..."
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS relationships;"
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS sessions;"
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS users;"
wrangler d1 execute "$DB_NAME" --remote --command "DROP TABLE IF EXISTS people;"

echo "Importing into remote D1..."
wrangler d1 execute "$DB_NAME" --remote --file="$EXPORT_PATH"

echo "Done. Remote DB replaced using $EXPORT_PATH"
