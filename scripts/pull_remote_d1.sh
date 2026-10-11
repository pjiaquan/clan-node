#!/usr/bin/env bash
set -euo pipefail

# The two sides are different databases now. The remote one is production.
REMOTE_DB_NAME="${REMOTE_DB_NAME:-clan-db}"
# clan-db is declared only under [env.production] in wrangler.worker.toml, so
# remote commands must select that env or wrangler cannot resolve the name and
# the API answers with a misleading "Authentication error [code: 10000]".
REMOTE_ENV="${REMOTE_ENV:-production}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-clan-db-dev}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${REMOTE_DB_NAME}-remote-${TIMESTAMP}.sql}"
SKIP_AUDIT_LOGS="${SKIP_AUDIT_LOGS:-1}"

mkdir -p "$BACKUP_DIR"

WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.worker.toml}"

echo "Exporting remote D1 to $EXPORT_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 export "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --output="$EXPORT_PATH"

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
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS relationships;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS person_custom_fields;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS notifications;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS audit_logs;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS sessions;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS users;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --command "DROP TABLE IF EXISTS people;"

echo "Importing into local D1 from $IMPORT_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 execute "$LOCAL_DB_NAME" --local --file="$IMPORT_PATH"

echo "Done. Local DB replaced using $IMPORT_PATH"
