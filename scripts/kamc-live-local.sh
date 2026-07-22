#!/bin/bash
# Local scheduled exporter (launchd on a Saudi-network Mac — elab.seha.sa
# geo-blocks foreign IPs, so GitHub-hosted runners cannot do this).
# Secrets come from the LaunchAgent's environment: GRAFANA_TOKEN, DATA_KEY.
# Always exits 0: failures are logged and retried on the next tick.
set -u
log() { echo "[kamc-live $(date '+%F %T')] $*"; }

hour=$(date +%H)
if [ "$hour" -lt 7 ] || [ "$hour" -gt 22 ]; then log "outside 07-22 window"; exit 0; fi

cd "$(dirname "$0")/.." || exit 0
git pull --rebase --autostash -q || { log "pull failed (offline?)"; exit 0; }
# Grafana occasionally 504s (origin overload) — retry within the tick instead
# of going stale until the next one.
fetched=0
for attempt in 1 2 3; do
  if node scripts/fetch-kamc.mjs; then fetched=1; break; fi
  log "fetch attempt $attempt failed (VPN/Grafana down?)"
  [ "$attempt" -lt 3 ] && sleep 45
done
if [ "$fetched" -ne 1 ]; then log "all fetch attempts failed — keeping previous snapshot"; exit 0; fi
if git status --porcelain data/ | grep -q .; then
  git add data/
  git commit -q -m "chore: refresh encrypted KAMC snapshot (local export)"
  git push -q && log "pushed update" || log "push failed"
else
  log "unchanged"
fi
