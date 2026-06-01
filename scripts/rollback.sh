#!/usr/bin/env bash
# rollback.sh — stop Adonis, swap nginx back to PHP FPM, verify PHP serves.
#
# Designed for the cutover described in CUTOVER.md §4. Leaves the
# `audit_logs` table alone (it's useful forensic data even after rollback).
#
# Strategy: rather than parse/rewrite nginx.conf in-place, this script
# assumes two upstream config snippets exist:
#
#   /etc/nginx/sites-available/hisreport-php      (PHP FPM upstream)
#   /etc/nginx/sites-available/hisreport-adonis   (Adonis upstream)
#
# It re-symlinks /etc/nginx/sites-enabled/hisreport to the PHP file and
# reloads. If your setup edits a single file instead, set ROLLBACK_MODE=manual
# and this script will only stop Adonis + remind you to flip nginx by hand.
#
# Env overrides:
#   SERVICE_NAME      (default: hisreport)
#   START_METHOD      auto|systemd|pm2  (default: auto)
#   NGINX_LINK        (default: /etc/nginx/sites-enabled/hisreport)
#   NGINX_PHP_CONF    (default: /etc/nginx/sites-available/hisreport-php)
#   PHP_PROBE_URL     (default: http://127.0.0.1/index.php)
#   ROLLBACK_MODE     auto|manual  (default: auto)

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-hisreport}"
START_METHOD="${START_METHOD:-auto}"
NGINX_LINK="${NGINX_LINK:-/etc/nginx/sites-enabled/hisreport}"
NGINX_PHP_CONF="${NGINX_PHP_CONF:-/etc/nginx/sites-available/hisreport-php}"
PHP_PROBE_URL="${PHP_PROBE_URL:-http://127.0.0.1/index.php}"
ROLLBACK_MODE="${ROLLBACK_MODE:-auto}"

log()  { printf '[rollback] %s\n' "$*"; }
fail() { printf '[rollback] FAIL: %s\n' "$*" >&2; exit 1; }

# 1. Stop Adonis first so users stop hitting it.
detect_method() {
  if [[ "$START_METHOD" != "auto" ]]; then
    echo "$START_METHOD"; return
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
    echo "systemd"; return
  fi
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    echo "pm2"; return
  fi
  echo "none"
}

METHOD="$(detect_method)"
case "$METHOD" in
  systemd)
    log "stopping systemd unit: $SERVICE_NAME.service"
    sudo systemctl stop "$SERVICE_NAME.service" || log "(systemctl stop returned non-zero — already stopped?)"
    ;;
  pm2)
    log "stopping pm2 app: $SERVICE_NAME"
    pm2 stop "$SERVICE_NAME" || log "(pm2 stop returned non-zero — already stopped?)"
    ;;
  none)
    log "no managed Adonis process found — assuming already stopped"
    ;;
esac

# 2. Flip nginx back to PHP.
if [[ "$ROLLBACK_MODE" == "manual" ]]; then
  log "ROLLBACK_MODE=manual — skipping nginx flip"
  log "ACTION REQUIRED: re-enable the PHP upstream in your nginx config, then run:"
  log "  sudo nginx -t && sudo systemctl reload nginx"
else
  command -v nginx >/dev/null 2>&1 || fail "nginx not on PATH"
  [[ -f "$NGINX_PHP_CONF" ]] || fail "PHP nginx config not found at $NGINX_PHP_CONF (set NGINX_PHP_CONF= or use ROLLBACK_MODE=manual)"

  log "pointing $NGINX_LINK -> $NGINX_PHP_CONF"
  sudo ln -sfn "$NGINX_PHP_CONF" "$NGINX_LINK"

  log "validating nginx config"
  sudo nginx -t

  log "reloading nginx"
  sudo systemctl reload nginx
fi

# 3. Verify PHP is serving 200.
command -v curl >/dev/null 2>&1 || fail "curl not on PATH (needed for PHP probe)"

log "probing $PHP_PROBE_URL"
deadline=$(( $(date +%s) + 30 ))
while [[ "$(date +%s)" -lt "$deadline" ]]; do
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PHP_PROBE_URL" || echo "000")"
  case "$CODE" in
    200|301|302) log "PHP responding ($CODE) — rollback complete"; exit 0 ;;
  esac
  log "PHP not ready yet (HTTP $CODE) — retrying"
  sleep 2
done

fail "PHP did not respond 2xx/3xx within 30s — investigate FPM + nginx logs"
