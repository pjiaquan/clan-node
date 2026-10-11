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
EXPORT_PATH="${EXPORT_PATH:-$BACKUP_DIR/${REMOTE_DB_NAME}-export-${TIMESTAMP}.sql}"

mkdir -p "$BACKUP_DIR"

WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.worker.toml}"

REMOTE_BACKUP_PATH="${REMOTE_BACKUP_PATH:-$BACKUP_DIR/${REMOTE_DB_NAME}-remote-pre-push-${TIMESTAMP}.sql}"

# This script replaces people/relationships/avatars/custom-fields on the
# REMOTE database. `d1 execute --remote --env "$REMOTE_ENV"` resolves by
# database name within that env, so with the defaults it targets production. It used to run unattended with no
# confirmation and no remote backup, which made `npm run d1:push` a one-typo
# irrecoverable wipe.
cat <<BANNER
About to REPLACE remote D1 data.

  config          : $WRANGLER_CONFIG
  database        : $REMOTE_DB_NAME (resolved remotely -- this is production unless
                    REMOTE_DB_NAME says otherwise)
  wrangler env    : $REMOTE_ENV
  tables replaced : people, person_avatars, person_custom_fields, relationships
  tables kept     : users, sessions
  source          : local D1 export
  remote backup   : $REMOTE_BACKUP_PATH

BANNER

if [ "${CONFIRM_REMOTE_WIPE:-}" = "yes" ]; then
  echo "CONFIRM_REMOTE_WIPE=yes given; continuing."
elif [ -t 0 ]; then
  printf 'Type the database name (%s) to continue: ' "$REMOTE_DB_NAME"
  read -r REPLY_DB_NAME
  if [ "$REPLY_DB_NAME" != "$REMOTE_DB_NAME" ]; then
    echo "Aborted: input did not match '$REMOTE_DB_NAME'." >&2
    exit 1
  fi
else
  echo "Aborted: refusing to wipe remote data non-interactively." >&2
  echo "Re-run with CONFIRM_REMOTE_WIPE=yes if that is really what you want." >&2
  exit 1
fi

echo "Backing up REMOTE D1 to $REMOTE_BACKUP_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 export "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --output="$REMOTE_BACKUP_PATH"
if [ ! -s "$REMOTE_BACKUP_PATH" ]; then
  echo "Aborted: remote backup is empty or missing; not touching remote data." >&2
  exit 1
fi

echo "Exporting local D1 to $EXPORT_PATH..."
wrangler --config "$WRANGLER_CONFIG" d1 export "$LOCAL_DB_NAME" --local --output="$EXPORT_PATH"

echo "Dropping remote tables (keeping users/sessions)..."
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DROP TABLE IF EXISTS relationships;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DROP TABLE IF EXISTS person_custom_fields;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DROP TABLE IF EXISTS person_avatars;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DROP TABLE IF EXISTS people;"

echo "Applying schema on remote..."
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --file="./migrations/schema.sql"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DELETE FROM relationships;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DELETE FROM person_custom_fields;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DELETE FROM person_avatars;"
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --command "DELETE FROM people;"

echo "Importing into remote D1 (data only)..."
DATA_PATH="$(mktemp)"
EXPORT_PATH="$EXPORT_PATH" DATA_PATH="$DATA_PATH" python3 - <<'PY'
import os
import sqlite3
from pathlib import Path

export_path = Path(os.environ["EXPORT_PATH"])
data_path = Path(os.environ["DATA_PATH"])

conn = sqlite3.connect(":memory:")
conn.executescript(export_path.read_text(encoding="utf-8"))

def write_inserts(table, columns):
    cols = ", ".join(columns)
    quoted_cols = ", ".join(f'"{col}"' for col in columns)
    query = f"SELECT {cols} FROM {table}"
    rows = conn.execute(query).fetchall()
    with data_path.open("a", encoding="utf-8") as f:
        for row in rows:
            values = ",".join(conn.execute("SELECT quote(?)", (value,)).fetchone()[0] for value in row)
            f.write(f'INSERT INTO "{table}" ({quoted_cols}) VALUES({values});\n')

data_path.write_text("", encoding="utf-8")

write_inserts(
    "people",
    [
        "id",
        "name",
        "english_name",
        "gender",
        "dob",
        "dod",
        "tob",
        "tod",
        "avatar_url",
        "metadata",
        "created_at",
        "updated_at",
    ],
)
write_inserts(
    "person_avatars",
    [
        "id",
        "person_id",
        "avatar_url",
        "storage_key",
        "is_primary",
        "sort_order",
        "created_at",
        "updated_at",
    ],
)
write_inserts(
    "relationships",
    [
        "from_person_id",
        "to_person_id",
        "type",
        "metadata",
        "created_at",
    ],
)
write_inserts(
    "person_custom_fields",
    [
        "person_id",
        "label",
        "value",
        "created_at",
        "updated_at",
    ],
)

conn.close()
PY
wrangler --config "$WRANGLER_CONFIG" d1 execute "$REMOTE_DB_NAME" --remote --env "$REMOTE_ENV" --file="$DATA_PATH"
rm -f "$DATA_PATH"

echo "Syncing avatars from local to remote..."
LOCAL_API_BASE="${LOCAL_API_BASE:-http://localhost:8787}" \
REMOTE_API_BASE="${REMOTE_API_BASE:-https://clan-node-production.pjiaquan.workers.dev}" \
ORIGIN_LOCAL="${ORIGIN_LOCAL:-http://localhost:5173}" \
ORIGIN_REMOTE="${ORIGIN_REMOTE:-https://clan-frontend.pages.dev}" \
SYNC_DIRECTION="local-to-remote" \
npm run avatars:sync

echo "Done. Remote DB replaced using $EXPORT_PATH"
echo "Pre-push remote backup kept at $REMOTE_BACKUP_PATH"
