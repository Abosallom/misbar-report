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
# output is now captured and its real error written INTO the summary line — and a
# run of failures raises a macOS notification (see "Stuck-refresh alert" below).
set -u

# launchd starts the job with no locale, so bash would slice strings by BYTE and can
# cut an Arabic error in the middle of a character — and osascript rejects a whole
# notification over one invalid byte (-1700), silently. Character semantics, always.
export LC_ALL=en_US.UTF-8
# Never wait on a human, and never wait forever: no terminal credential prompt, and
# abandon a transfer stalled below 1 KB/s for a minute. git has no overall timeout of
# its own — the hard deadlines are deadline() below.
export GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=60
NET_TIMEOUT=${KAMC_NET_TIMEOUT:-300}    # git pull, one Grafana fetch attempt (seconds)
PUSH_TIMEOUT=${KAMC_PUSH_TIMEOUT:-120}  # git push

log() { echo "[kamc-live $(date '+%F %T')] $*"; }

# Run a command under a hard deadline. A hung step must become an ORDINARY failure:
# launchd never starts a second copy of a job that is still running, so a single git
# or node call that never returns would silence every later run — and every alert.
# macOS ships no `timeout`; perl's alarm survives exec, so the command itself is
# killed by SIGALRM at the deadline (exit status 142).
deadline() { local secs=$1; shift; /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$secs" "$@"; }

# Node prints this four-line notice on every run: the repo's .js files are ES
# modules with no "type":"module" in package.json — which cannot be added, because
# vendor/ UMD bundles are loaded through require(). Noise, not a failure, and it
# would otherwise be the first thing a reader sees in every failure.
denoise() {
  grep -v -e 'MODULE_TYPELESS_PACKAGE_JSON' -e 'Reparsing as ES module' \
    -e 'add "type": "module"' -e 'node --trace-warnings'
}

# The ONE line that says why a command failed. A rejected push names its real reason
# on a ' ! [rejected]' / 'remote: error' line — prefer those over git's generic
# closing 'failed to push some refs'. Otherwise the last line that reads like an
# error, else the last non-blank line. Capped (by character — see LC_ALL above).
cause() {
  local text line
  text=$(printf '%s\n' "$1" | denoise | grep -v 'failed to push some refs')
  line=$(printf '%s\n' "$text" | grep -E '^ ! \[|^remote: (error|fatal)|GH[0-9]{3}' | tail -1)
  [ -n "$line" ] || line=$(printf '%s\n' "$text" \
    | grep -E -i 'error|fatal|denied|refused|could not|unable|agreed to the xcode' | tail -1)
  [ -n "$line" ] || line=$(printf '%s\n' "$text" | grep -v '^[[:space:]]*$' | tail -1)
  line=${line:-no output}
  printf '%s' "${line:0:300}"
}

# Cause of a step run under deadline(): a timeout has no output of its own to quote.
why() {  # exit-status output deadline-seconds
  if [ "$1" -eq 142 ]; then printf 'timed out after %ss' "$3"; else cause "$2"; fi
}

# The full captured output, indented under its summary line. Diagnostics (Grafana's
# DIAG status and cf-ray, the stack) are kept — just no longer the headline.
detail() { printf '%s\n' "$1" | denoise | grep -v '^[[:space:]]*$' | sed 's/^/    /'; }

# ── Stuck-refresh alert ──────────────────────────────────────────────────────
# A clear log line only helps someone who reads the log, and for eight days nobody
# did. So the job counts failed runs IN A ROW and raises a macOS notification once
# the published data has been stuck for a while, repeats it while the streak lasts,
# and says so when a run succeeds again.
# The count lives OUTSIDE the repo on purpose: it must never be committed, and the
# `git pull --rebase --autostash` below must never stash or rewrite it.
# LIMIT, stated plainly: an alarm inside the job cannot report the job NOT RUNNING
# (Mac off or asleep, the agent unloaded). Only a check outside this Mac can.
STATE_DIR="$HOME/Library/Application Support/Misbar"
STATE_FILE="$STATE_DIR/kamc-live.failures"  # "<failed runs in a row> <epoch of the first> <alert pending 0|1>"
ALERT_AFTER=3   # first alert on the 3rd failed run in a row (~1.5 h at the 30-min cadence)
ALERT_EVERY=6   # then again every 6 further failures (~3 h) until a run succeeds
LOG_HINT="Details: ~/Library/Logs/misbar-kamc-live.log"

# Valid UTF-8 only: iconv -c drops any byte that is not — one bad byte would make
# osascript refuse the entire notification.
utf8() { printf '%s' "$1" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null; }

# Show a notification; returns 0 only if osascript ACCEPTED it. Text goes in as ARGV,
# never spliced into the AppleScript source: git and Grafana errors carry quotes,
# backslashes and JSON, which must neither break the script nor inject into it.
# If the detailed notification is refused, a fixed ASCII one is tried, so an alert is
# never lost to its own text. (osascript cannot see a notification that macOS then
# hides — Script Editor switched off, or a Focus — so check that setting once.)
AS_NOTIFY='display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name (item 4 of argv)'
notify() {  # title subtitle body sound
  local err
  if err=$(deadline 20 osascript -e 'on run argv' -e "$AS_NOTIFY" -e 'end run' \
      "$(utf8 "$1")" "$(utf8 "$2")" "$(utf8 "$3")" "$4" 2>&1 >/dev/null); then
    return 0
  fi
  log "notification refused ($(cause "$err")) — sending a plain one instead"
  deadline 20 osascript -e 'on run argv' -e "$AS_NOTIFY" -e 'end run' \
    "$1" "" "$LOG_HINT" "$4" >/dev/null 2>&1
}

# Load the streak into n / since / pending. A missing or corrupt file is "no streak".
# 10# forces decimal: a stray '08' would otherwise be read as bad octal and abort the
# arithmetic mid-fail(), letting a failed run fall through as if it had succeeded.
read_state() {
  n=0; since=""; pending=0
  if [ -r "$STATE_FILE" ]; then read -r n since pending < "$STATE_FILE" || true; fi
  if [[ "$n" =~ ^[0-9]{1,6}$ ]]; then n=$((10#$n)); else n=0; fi
  [[ "$since" =~ ^[0-9]{9,11}$ ]] || since=""
  [ "$pending" = 1 ] || pending=0
}

# Write via a temp file + mv, so a partial write never truncates the old count.
save_state() {  # n since pending → 0 only if the count is really on disk
  mkdir -p "$STATE_DIR" 2>/dev/null \
    && printf '%s %s %s\n' "$1" "$2" "$3" > "$STATE_FILE.tmp" 2>/dev/null \
    && mv -f "$STATE_FILE.tmp" "$STATE_FILE" 2>/dev/null
}

# A failed run: log it (with its captured detail), extend the streak, alert when due,
# and end the run. Every failure path goes through here.
fail() {  # summary [captured-output]
  local summary="$1" due=0 counted="failed runs in a row"
  log "$summary"
  if [ -n "${2:-}" ]; then detail "$2"; fi
  read_state
  n=$((n + 1))
  if [ "$n" -eq 1 ] || [ -z "$since" ]; then since=$(date +%s); fi
  if [ "$n" -ge "$ALERT_AFTER" ] \
    && { [ $(( (n - ALERT_AFTER) % ALERT_EVERY )) -eq 0 ] || [ "$pending" -eq 1 ]; }; then
    due=1
  fi
  if ! save_state "$n" "$since" "$pending"; then
    # FAIL SAFE: a streak that cannot be recorded never reaches its threshold, so
    # alert on EVERY failed run until the count can be saved again.
    log "cannot save the failure count to $STATE_FILE — alerting on every failed run until it can"
    due=1; counted="failed run(s) — the count itself cannot be saved"
  fi
  if [ "$due" -eq 1 ]; then
    if notify "Misbar: live data is not updating" \
        "$n $counted, since $(date -r "$since" '+%a %d %b %H:%M')" "$summary" "Basso"; then
      pending=0; log "alert raised — $n failed runs in a row"
    else
      # Not shown: retry on the NEXT failed run, not six runs (~3 h) from now.
      pending=1; log "alert could NOT be shown — will retry on the next failed run"
    fi
    save_state "$n" "$since" "$pending" || true
  fi
  exit 0
}

# A good run: if an alert went out, say it is over — reports built during the streak
# used stale data, which is worth knowing — then forget the streak. The file is
# removed FIRST: if it cannot be, announcing a recovery would repeat on every run.
succeed() {
  read_state
  [ "$n" -gt 0 ] || return 0
  if ! rm -f "$STATE_FILE" "$STATE_FILE.tmp"; then
    log "recovered, but cannot clear the failure count in $STATE_FILE"; return 0
  fi
  if [ "$n" -ge "$ALERT_AFTER" ]; then
    notify "Misbar: live data is updating again" "Recovered after $n failed runs in a row" \
      "Stuck since $(date -r "${since:-$(date +%s)}" '+%a %d %b %H:%M') — reports built in that window used stale data." \
      "Glass" || log "(the recovery notification could not be shown)"
    log "recovered after $n failed runs in a row — alert cleared"
  else
    log "recovered after $n failed run(s)"
  fi
}

hour=$(date +%H)
if [ "$hour" -lt 7 ] || [ "$hour" -gt 22 ]; then log "outside 07-22 window"; exit 0; fi

# Hold the Mac awake until THIS run ends. With the lid closed the Mac is asleep and
# only wakes for a few seconds at a time (Power Nap maintenance). launchd starts a
# due run in one of those wakes — and the Mac used to drop back to sleep seconds
# later, FREEZING the run mid-step: "fetch attempt 2 failed" logged 40 minutes after
# attempt 1, "push failed" over an hour after its slot (2026-09-13, a lid-closed
# Sunday). -s holds off system sleep (macOS honours it on AC power only), -i idle
# sleep; -w releases the hold the moment this script exits — the Mac is kept up for
# the minute a run needs and not a second longer. No setting is changed.
/usr/bin/caffeinate -s -i -w $$ &

cd "$(dirname "$0")/.." || fail "cannot enter the repo at $(dirname "$0")/.."

out=$(deadline "$NET_TIMEOUT" git pull --rebase --autostash -q 2>&1); rc=$?
if [ "$rc" -ne 0 ]; then
  case "$out" in
    # The failure that ran for eight days — name it, and give the one-line fix.
    *"Xcode license"*)
      fail "pull failed: Xcode license not accepted (after a macOS update) — run in Terminal: sudo xcodebuild -license accept" "$out" ;;
    *) fail "pull failed: $(why "$rc" "$out" "$NET_TIMEOUT")" "$out" ;;
  esac
fi

# Grafana occasionally 504s (origin overload) — retry within the tick instead
# of going stale until the next one. A single failed attempt is not a failed RUN.
fetched=0
for attempt in 1 2 3; do
  out=$(deadline "$NET_TIMEOUT" node scripts/fetch-kamc.mjs 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    fetched=1
    printf '%s\n' "$out" | denoise   # the result line ('changed — wrote …') stays in the log
    break
  fi
  log "fetch attempt $attempt failed: $(why "$rc" "$out" "$NET_TIMEOUT")"
  detail "$out"
  [ "$attempt" -lt 3 ] && sleep 45
done
# Each attempt's detail is already logged above, so no second copy here.
[ "$fetched" -eq 1 ] \
  || fail "all 3 fetch attempts failed — keeping the previous snapshot (last error: $(why "$rc" "$out" "$NET_TIMEOUT"))"

# A failing `git status` prints nothing — piped straight into a test it read as
# "unchanged", i.e. a SUCCESS that cleared a real streak. Its exit status counts.
st=$(git status --porcelain data/ 2>&1) || fail "git status failed: $(cause "$st")" "$st"
if [ -n "$st" ]; then
  out=$(git add data/ 2>&1) || fail "git add failed: $(cause "$out")" "$out"
  # `-- data/` commits ONLY the snapshot, whatever else is staged in this working
  # copy. Without it, a half-finished change that happened to be staged when a run
  # fired would be committed as a "snapshot refresh" and pushed to the live site.
  out=$(git commit -q -m "chore: refresh encrypted KAMC snapshot (local export)" -- data/ 2>&1) \
    || fail "commit failed: $(cause "$out")" "$out"
else
  log "unchanged"
fi

# Publish whenever the branch is AHEAD of GitHub — not only when this run committed.
# A push that failed on an earlier run leaves its commit behind; checking only "did I
# just commit" let the next unchanged run count as a SUCCESS and announce a recovery
# while the site was still stale — and that commit was never pushed at all.
ahead=$(git rev-list --count '@{u}..HEAD' 2>&1) || fail "cannot compare with GitHub: $(cause "$ahead")" "$ahead"
if [ "$ahead" != 0 ]; then
  out=$(deadline "$PUSH_TIMEOUT" git push -q 2>&1); rc=$?
  [ "$rc" -eq 0 ] || fail "push failed: $(why "$rc" "$out" "$PUSH_TIMEOUT")" "$out"
  log "pushed update"
fi
succeed
