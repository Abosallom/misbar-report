#!/bin/bash
# Local scheduled exporter (launchd on a Saudi-network Mac — elab.seha.sa
# geo-blocks foreign IPs, so GitHub-hosted runners cannot do this).
# Secrets come from the LaunchAgent's environment: GRAFANA_TOKEN, DATA_KEY.
# Always exits 0: failures are logged and retried on the next tick.
#
# EVERY FAILURE LINE STATES ITS ACTUAL CAUSE — never a guess. From 2026-09-20 to
# 2026-09-28 this job failed 252 runs in a row: a macOS update left the Xcode
# license unaccepted, so every /usr/bin/git call refused to run. Each run logged
# "pull failed (offline?)", which pointed at the network, and it read as a
# connectivity blip for eight days while the published data went stale. Each step's
# output is now captured and its real error written INTO the summary line.
set -u
log() { echo "[kamc-live $(date '+%F %T')] $*"; }

# Node prints this four-line notice on every run: the repo's .js files are ES
# modules with no "type":"module" in package.json — which cannot be added, because
# vendor/ UMD bundles are loaded through require(). Noise, not a failure, and it
# would otherwise be the first thing a reader sees in every failure.
denoise() {
  grep -v -e 'MODULE_TYPELESS_PACKAGE_JSON' -e 'Reparsing as ES module' \
    -e 'add "type": "module"' -e 'node --trace-warnings'
}

# The ONE line that says why a command failed: the last line that reads like an
# error, else the last non-blank line. Capped so a stray blob can't flood the log.
cause() {
  local line
  line=$(printf '%s\n' "$1" | denoise \
    | grep -E -i 'error|fatal|denied|refused|could not|unable|agreed to the xcode' | tail -1)
  [ -n "$line" ] || line=$(printf '%s\n' "$1" | denoise | grep -v '^[[:space:]]*$' | tail -1)
  line=${line:-no output}
  printf '%s' "${line:0:300}"
}

# The full captured output, indented under its summary line. Diagnostics (Grafana's
# DIAG status and cf-ray, the stack) are kept — just no longer the headline.
detail() { printf '%s\n' "$1" | denoise | grep -v '^[[:space:]]*$' | sed 's/^/    /'; }

hour=$(date +%H)
if [ "$hour" -lt 7 ] || [ "$hour" -gt 22 ]; then log "outside 07-22 window"; exit 0; fi

cd "$(dirname "$0")/.." || exit 0

if ! out=$(git pull --rebase --autostash -q 2>&1); then
  case "$out" in
    # The failure that ran for eight days — name it, and give the one-line fix.
    *"Xcode license"*)
      log "pull failed: Xcode license not accepted (after a macOS update) — run in Terminal: sudo xcodebuild -license accept" ;;
    *) log "pull failed: $(cause "$out")" ;;
  esac
  detail "$out"
  exit 0
fi

# Grafana occasionally 504s (origin overload) — retry within the tick instead
# of going stale until the next one.
fetched=0
for attempt in 1 2 3; do
  if out=$(node scripts/fetch-kamc.mjs 2>&1); then
    fetched=1
    printf '%s\n' "$out" | denoise   # the result line ('changed — wrote …') stays in the log
    break
  fi
  log "fetch attempt $attempt failed: $(cause "$out")"
  detail "$out"
  [ "$attempt" -lt 3 ] && sleep 45
done
if [ "$fetched" -ne 1 ]; then log "all fetch attempts failed — keeping previous snapshot"; exit 0; fi

if git status --porcelain data/ | grep -q .; then
  git add data/
  if ! out=$(git commit -q -m "chore: refresh encrypted KAMC snapshot (local export)" 2>&1); then
    log "commit failed: $(cause "$out")"
    detail "$out"
    exit 0
  fi
  if out=$(git push -q 2>&1); then
    log "pushed update"
  else
    log "push failed: $(cause "$out")"
    detail "$out"
  fi
else
  log "unchanged"
fi
