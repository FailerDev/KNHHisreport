#!/usr/bin/env bash
# preflight.sh — pre-cutover safety checks + app DB backup.
#
# Refuses to proceed if:
#   - .env is missing or DB_* vars are empty
#   - mysqldump can't reach the app DB
#   - the dump is empty (would mask a connection failure)
#   - an already-running Adonis /health says app_db is down
#
# On success, writes /var/backups/hisreport/pre-cutover-<TS>.sql.gz and
# prints the path so the operator can copy it elsewhere if desired.
#
# Usage: bash scripts/preflight.sh

set -euo pipefail

# Resolve repo root (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

log()  { printf '[preflight] %s\n' "$*"; }
fail() { printf '[preflight] FAIL: %s\n' "$*" >&2; exit 1; }

# 1. Load .env (don't echo it; it has credentials).
[[ -f .env ]] || fail ".env not found at $REPO_ROOT/.env"
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DB_HOST:?DB_HOST missing in .env}"
: "${DB_PORT:?DB_PORT missing in .env}"
: "${DB_USER:?DB_USER missing in .env}"
: "${DB_PASSWORD:?DB_PASSWORD missing in .env}"
: "${DB_DATABASE:?DB_DATABASE missing in .env}"

# 2. Tooling.
command -v mysqldump >/dev/null 2>&1 || fail "mysqldump not installed on PATH"
command -v gzip      >/dev/null 2>&1 || fail "gzip not installed on PATH"
command -v curl      >/dev/null 2>&1 || log  "curl missing — skipping /health probe"

# 3. If Adonis is already up, refuse to back up against a sick DB.
if command -v curl >/dev/null 2>&1; then
  HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3333/health}"
  if HBODY="$(curl -sS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
    case "$HBODY" in
      *'"app_db"'*'"ok":true'*) log "/health says app_db ok — proceeding" ;;
      *'"app_db"'*'"ok":false'*) fail "/health says app_db DOWN — fix DB before backing up" ;;
      *) log "/health responded but app_db status unparseable — proceeding cautiously" ;;
    esac
  else
    log "no Adonis on $HEALTH_URL yet (expected pre-cutover) — skipping health probe"
  fi
fi

# 4. Prepare backup target.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hisreport}"
TS="$(date +%Y%m%dT%H%M%S)"
OUT="$BACKUP_DIR/pre-cutover-$TS.sql.gz"

mkdir -p "$BACKUP_DIR" || fail "cannot create $BACKUP_DIR (run as root or set BACKUP_DIR=)"

log "dumping $DB_DATABASE@$DB_HOST -> $OUT"

# 5. Dump. --single-transaction keeps it consistent without locking the
#    legacy PHP app's reads. Stream straight into gzip to avoid the plain
#    .sql ever hitting disk.
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

# MYSQL_PWD avoids leaking the password into ps(1).
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --quick --skip-lock-tables --routines --triggers \
  --default-character-set=utf8mb4 \
  "$DB_DATABASE" \
  | gzip -c > "$TMP"

# 6. Sanity: must contain at least one CREATE TABLE for the schema we own.
if ! gzip -dc "$TMP" | head -c 200000 | grep -q -i 'CREATE TABLE'; then
  fail "dump appears empty (no CREATE TABLE in first 200KB) — refusing"
fi

SIZE="$(wc -c < "$TMP")"
[[ "$SIZE" -lt 1024 ]] && fail "dump suspiciously small ($SIZE bytes)"

mv "$TMP" "$OUT"
trap - EXIT

log "backup OK: $OUT ($SIZE bytes)"
log "preflight complete — safe to proceed with cutover"
