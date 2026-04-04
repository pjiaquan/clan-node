#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-clan-db}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${DB_NAME}-remote-${TIMESTAMP}.sql}"
SKIP_AUDIT_LOGS="${SKIP_AUDIT_LOGS:-1}"

mkdir -p "$BACKUP_DIR"

WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.worker.toml}"

echo "Exporting remote D1 to $EXPORT_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 export "$DB_NAME" --remote --output="$EXPORT_PATH"

IMPORT_PATH="$EXPORT_PATH"
if [[ "$SKIP_AUDIT_LOGS" == "1" || "$SKIP_AUDIT_LOGS" == "true" || "$SKIP_AUDIT_LOGS" == "yes" ]]; then
  FILTERED_PATH="${EXPORT_PATH%.sql}.no-audit.sql"
  echo "Removing audit_logs schema/data from export -> $FILTERED_PATH"
  awk '
    BEGIN {
      in_audit_table = 0;
    }
    {
      lower = tolower($0);
      if (in_audit_table) {
        if ($0 ~ /^[[:space:]]*\)[[:space:]]*;[[:space:]]*$/) {
          in_audit_table = 0;
        }
        next;
      }

      if (lower ~ /^create table[[:space:]]+["`]?audit_logs["`]?/) {
        in_audit_table = 1;
        next;
      }
      if (lower ~ /^insert into[[:space:]]+["`]?audit_logs["`]?/) next;
      if (lower ~ /^create index[[:space:]].*audit_logs/) next;
      if (lower ~ /^drop table[[:space:]].*audit_logs/) next;

      print;
    }
  ' "$EXPORT_PATH" > "$FILTERED_PATH"
  IMPORT_PATH="$FILTERED_PATH"
fi

echo "Dropping local tables..."
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS relationships;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS person_custom_fields;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS notifications;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS audit_logs;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS sessions;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS users;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --command "DROP TABLE IF EXISTS people;"

echo "Importing into local D1 from $IMPORT_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_NAME" --local --file="$IMPORT_PATH"

echo "Done. Local DB replaced using $IMPORT_PATH"
