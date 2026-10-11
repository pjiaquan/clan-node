#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-"$ROOT_DIR/backups"}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"

# Back up the production database by default. clan-db is declared only under
# [env.production] in wrangler.worker.toml, so the export must select that env.
# Without --remote, `d1 export` reads the local wrangler dev database instead.
D1_NAME="${D1_NAME:-clan-db}"
D1_ENV="${D1_ENV:-production}"
R2_BUCKET="${R2_BUCKET:-}"
R2_REMOTE="${R2_REMOTE:-}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-}"

if [[ -z "$D1_NAME" ]]; then
  echo "Missing D1_NAME env var." >&2
  exit 1
fi

if [[ -z "$R2_BUCKET" ]]; then
  echo "Missing R2_BUCKET env var." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

DB_OUT="$BACKUP_DIR/d1-${D1_NAME}-${TIMESTAMP}.sql"
echo "Exporting remote D1 database $D1_NAME (env: $D1_ENV) to $DB_OUT"
wrangler --config "${WRANGLER_CONFIG:-wrangler.worker.toml}" d1 export "$D1_NAME" --remote --env "$D1_ENV" --output "$DB_OUT"
if [[ ! -s "$DB_OUT" ]]; then
  echo "D1 export is empty or missing: $DB_OUT" >&2
  exit 1
fi

AVATAR_OUT="$BACKUP_DIR/avatars-${TIMESTAMP}"
if command -v rclone >/dev/null 2>&1; then
  if [[ -z "$R2_REMOTE" ]]; then
    echo "Missing R2_REMOTE env var for rclone (example: r2)." >&2
    exit 1
  fi
  echo "Backing up R2 avatars with rclone to $AVATAR_OUT"
  rclone sync "${R2_REMOTE}:${R2_BUCKET}" "$AVATAR_OUT" --progress
elif command -v aws >/dev/null 2>&1; then
  if [[ -z "$R2_ACCOUNT_ID" ]]; then
    echo "Missing R2_ACCOUNT_ID env var for aws s3 endpoint." >&2
    exit 1
  fi
  echo "Backing up R2 avatars with aws s3 to $AVATAR_OUT"
  aws s3 sync "s3://${R2_BUCKET}" "$AVATAR_OUT" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
else
  echo "No rclone or aws CLI found for R2 backup." >&2
  exit 1
fi

echo "Backup complete."
