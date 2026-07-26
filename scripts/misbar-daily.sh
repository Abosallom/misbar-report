#!/bin/bash
# Hands-off report job (launchd → com.misbar.daily-report / com.misbar.weekly-report).
#
#   misbar-daily.sh            # mode=daily  (default — unchanged behaviour)
#   misbar-daily.sh weekly     # mode=weekly (the Sunday + Thursday agent)
#
#   1) refresh the encrypted KAMC snapshot with the existing local exporter
#   2) open the live site with the ?auto=1 trigger so the browser does the rest
#
# The mode is an IDENTITY, never a switch inside this script: both agents run the
# very same two steps. It tags every log line ([misbar-daily …] /
# [misbar-weekly …]) and, for weekly, puts &mode=weekly on the trigger URL as the
# run's marker. What the page does with that marker — including the choice between
# the weekday-anchored weekly-sun / weekly-thu comparisons — is decided in the app
# (src/main.js), not here; this job never writes a setting and never claims the
# page acted on it.
#
# NO SECRETS LIVE HERE. The exporter inherits GRAFANA_TOKEN / DATA_KEY from its
# own LaunchAgent (com.misbar.kamc-live); this job only asks launchd to run it.
# Always exits 0 — a bad day is logged and retried on the next tick.
set -u

# Unknown values fall back to 'daily' rather than failing: a mistyped launchd
# argument must never cost a run.
MODE="${1:-daily}"
case "$MODE" in
  daily|weekly) : ;;
  *) MODE="daily" ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/misbar-daily.log"
EXPORTER="$SCRIPT_DIR/kamc-live-local.sh"
SITE_BASE="${MISBAR_SITE_URL:-https://abosallom.github.io/misbar-report/?auto=1}"
# Daily keeps the exact URL it always used; weekly appends &mode=weekly (or
# ?mode=weekly when MISBAR_SITE_URL was overridden without a query string).
SITE_URL="$SITE_BASE"
if [ "$MODE" != "daily" ]; then
  case "$SITE_BASE" in
    *\?*) SITE_URL="$SITE_BASE&mode=$MODE" ;;
    *)    SITE_URL="$SITE_BASE?mode=$MODE" ;;
  esac
fi
# GitHub Pages needs a moment to serve a freshly pushed snapshot.
PAGES_DELAY="${MISBAR_PAGES_DELAY:-20}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
log() { printf '[misbar-%s %s] %s\n' "$MODE" "$(date '+%F %T')" "$*" >>"$LOG_FILE" 2>/dev/null || true; }

# Reachability probe — a laptop off the network should skip silently, not churn.
online() { /usr/bin/curl -sSf -I -m 10 -o /dev/null https://github.com >/dev/null 2>&1; }

log "start (mode=$MODE, scripts=$SCRIPT_DIR)"

if ! online; then
  log "offline — skipping this $MODE run"
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

log "opening the report trigger in the default browser (mode=$MODE)"
if /usr/bin/open "$SITE_URL" >>"$LOG_FILE" 2>&1; then
  log "browser trigger sent"
else
  log "could not open the browser (no GUI session?) — nothing generated today"
fi

log "done"
exit 0
