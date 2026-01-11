#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-clan-db}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${DB_NAME}-remote-${TIMESTAMP}.sql}"

mkdir -p "$BACKUP_DIR"

echo "Exporting remote D1 to $EXPORT_PATH..."
wrangler d1 export "$DB_NAME" --remote --output="$EXPORT_PATH"

echo "Dropping local tables..."
wrangler d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS relationships;"
wrangler d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS sessions;"
wrangler d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS users;"
wrangler d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS people;"

echo "Importing into local D1..."
wrangler d1 execute "$DB_NAME" --local --file="$EXPORT_PATH"

echo "Done. Local DB replaced using $EXPORT_PATH"
