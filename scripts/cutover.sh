#!/usr/bin/env bash
# cutover.sh — run migrations, start Adonis, wait until /health is green.
#
# Idempotent: safe to re-run if the previous attempt died half-way.
# Picks pm2 OR systemd automatically (whichever is available).
#
# Refuses to mark the cutover complete unless both app_db AND his_db
# come back "ok":true from /health within HEALTH_TIMEOUT seconds.
#
# Env overrides:
#   HEALTH_URL       (default: http://127.0.0.1:3333/health)
#   HEALTH_TIMEOUT   (default: 60)  seconds to wait for green /health
#   SERVICE_NAME     (default: hisreport)  systemd unit OR pm2 app name
#   START_METHOD     auto|systemd|pm2  (default: auto)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3333/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
SERVICE_NAME="${SERVICE_NAME:-hisreport}"
START_METHOD="${START_METHOD:-auto}"

log()  { printf '[cutover] %s\n' "$*"; }
fail() { printf '[cutover] FAIL: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node not on PATH"
command -v curl >/dev/null 2>&1 || fail "curl not on PATH (needed for /health probe)"

# 1. Run migrations. --force is required outside dev.
log "running migrations (idempotent)"
node ace migration:run --force

# 2. Build TypeScript -> build/.
log "compiling"
node ace build

# 3. Decide how to (re)start.
detect_method() {
  if [[ "$START_METHOD" != "auto" ]]; then
    echo "$START_METHOD"; return
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
    echo "systemd"; return
  fi
  if command -v pm2 >/dev/null 2>&1; then
    echo "pm2"; return
  fi
  echo "none"
}

METHOD="$(detect_method)"
case "$METHOD" in
  systemd)
    log "restarting systemd unit: $SERVICE_NAME.service"
    sudo systemctl restart "$SERVICE_NAME.service"
    ;;
  pm2)
    if pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
      log "reloading pm2 app: $SERVICE_NAME"
      pm2 reload "$SERVICE_NAME" --update-env
    else
      log "starting pm2 app: $SERVICE_NAME"
      pm2 start build/bin/server.js --name "$SERVICE_NAME" --node-args="--no-warnings"
      pm2 save
    fi
    ;;
  none|*)
    fail "no process manager found — install pm2 or define systemd unit $SERVICE_NAME.service (see DEPLOY.md §4)"
    ;;
esac

# 4. Poll /health until both databases report ok, or timeout.
log "polling $HEALTH_URL (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
last_body=""
while [[ "$(date +%s)" -lt "$deadline" ]]; do
  if BODY="$(curl -sS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
    last_body="$BODY"
    # Both keys must be "ok":true. Crude but enough — /health is JSON we own.
    case "$BODY" in
      *'"app_db"'*'"ok":true'*'"his_db"'*'"ok":true'*) log "/health GREEN"; printf '%s\n' "$BODY"; exit 0 ;;
      *'"his_db"'*'"ok":true'*'"app_db"'*'"ok":true'*) log "/health GREEN"; printf '%s\n' "$BODY"; exit 0 ;;
    esac
  fi
  sleep 2
done

# Timed out. Print whatever the last response was (if any) so the operator
# can diagnose without grepping logs.
log "TIMEOUT — last /health body:"
[[ -n "$last_body" ]] && printf '%s\n' "$last_body" >&2 || log "(no response at all — service likely not listening)"
fail "/health did not turn green within ${HEALTH_TIMEOUT}s — consider rollback (scripts/rollback.sh)"
