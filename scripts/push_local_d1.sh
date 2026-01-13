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
wrangler d1 execute "$DB_NAME" --remote --command "DELETE FROM relationships;"
wrangler d1 execute "$DB_NAME" --remote --command "DELETE FROM person_custom_fields;"
wrangler d1 execute "$DB_NAME" --remote --command "DELETE FROM people;"

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
wrangler d1 execute "$DB_NAME" --remote --file="$DATA_PATH"
rm -f "$DATA_PATH"

echo "Syncing avatars from local to remote..."
LOCAL_API_BASE="${LOCAL_API_BASE:-http://localhost:8787}" \
REMOTE_API_BASE="${REMOTE_API_BASE:-https://clan-node-production.pjiaquan.workers.dev}" \
SYNC_DIRECTION="local-to-remote" \
npm run avatars:sync

echo "Done. Remote DB replaced using $EXPORT_PATH"
