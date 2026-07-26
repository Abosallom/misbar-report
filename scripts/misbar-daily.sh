#!/bin/bash
# Daily hands-off report job (launchd → com.misbar.daily-report).
#
#   1) refresh the encrypted KAMC snapshot with the existing local exporter
#   2) open the live site with the ?auto=1 trigger so the browser does the rest
#
# NO SECRETS LIVE HERE. The exporter inherits GRAFANA_TOKEN / DATA_KEY from its
# own LaunchAgent (com.misbar.kamc-live); this job only asks launchd to run it.
# Always exits 0 — a bad day is logged and retried on the next tick.
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/misbar-daily.log"
EXPORTER="$SCRIPT_DIR/kamc-live-local.sh"
SITE_URL="${MISBAR_SITE_URL:-https://abosallom.github.io/misbar-report/?auto=1}"
# GitHub Pages needs a moment to serve a freshly pushed snapshot.
PAGES_DELAY="${MISBAR_PAGES_DELAY:-20}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
log() { printf '[misbar-daily %s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE" 2>/dev/null || true; }

# Reachability probe — a laptop off the network should skip silently, not churn.
online() { /usr/bin/curl -sSf -I -m 10 -o /dev/null https://github.com >/dev/null 2>&1; }

log "start (scripts=$SCRIPT_DIR)"

if ! online; then
  log "offline — skipping today's run"
  exit 0
fi

# Refresh through the EXPORT AGENT, not by running the script directly: GRAFANA_TOKEN
# and DATA_KEY live in com.misbar.kamc-live's own plist, so a direct invocation from
# this job would run without them and fail at the fetch. kickstart -k makes launchd
# run that agent now, with its environment. Direct invocation stays as the fallback
# for a machine where the export agent was never installed (it then needs the two
# variables exported in the caller's environment).
EXPORT_AGENT="com.misbar.kamc-live"
if /bin/launchctl kickstart -k "gui/$(id -u)/$EXPORT_AGENT" >>"$LOG_FILE" 2>&1; then
  log "asked $EXPORT_AGENT to refresh the encrypted snapshot"
  sleep 25 # let the fetch + encrypt + push finish before Pages is asked for it
elif [ -f "$EXPORTER" ]; then
  log "$EXPORT_AGENT not loaded — falling back to a direct exporter run"
  if /bin/bash "$EXPORTER" >>"$LOG_FILE" 2>&1; then
    log "snapshot refresh finished"
  else
    log "snapshot refresh reported an error — continuing with the previous snapshot"
  fi
else
  log "no exporter available — continuing with the previous snapshot"
fi

case "$PAGES_DELAY" in
  ''|*[!0-9]*) PAGES_DELAY=20 ;;
esac
[ "$PAGES_DELAY" -gt 0 ] && sleep "$PAGES_DELAY"

log "opening the report trigger in the default browser"
if /usr/bin/open "$SITE_URL" >>"$LOG_FILE" 2>&1; then
  log "browser trigger sent"
else
  log "could not open the browser (no GUI session?) — nothing generated today"
fi

log "done"
exit 0
