#!/bin/bash
# Install / remove / inspect the misbar report LaunchAgents.
#
# TWO jobs, installed and removed independently:
#   • com.misbar.daily-report   — every morning
#   • com.misbar.weekly-report  — Thursday only (the LAST business day of the
#     Saudi work week Sun-Thu, weekend = Fri+Sat). One report per work week,
#     covering the just-ended Sunday..Thursday window. Was Sun+Thu until
#     2026-08-05 (Talal: one weekly report, on Thursday).
#
#   misbar-automation-install.sh on [HH:MM]          # daily, default 08:00
#   misbar-automation-install.sh off                 # daily
#   misbar-automation-install.sh status              # BOTH jobs
#   misbar-automation-install.sh daily  on [HH:MM]   # explicit daily forms
#   misbar-automation-install.sh daily  off | status
#   misbar-automation-install.sh weekly on [HH:MM]   # Thursday, default 08:15
#   misbar-automation-install.sh weekly off | status
#
# The bare on/off/status forms are the original documented interface and still
# mean the DAILY job (status additionally reports the weekly one).
#
# Idempotent — re-running "on" with a new time just re-renders and reloads.
# Contains NO secrets: it only renders the checked-in plist templates.
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
JOB="$SCRIPT_DIR/misbar-daily.sh"
AGENTS_DIR="$HOME/Library/LaunchAgents"
# Both jobs append to the same log; misbar-daily.sh tags each line with its mode.
LOG_FILE="$HOME/Library/Logs/misbar-daily.log"
DOMAIN="gui/$(id -u)"

DAILY_LABEL="com.misbar.daily-report"
WEEKLY_LABEL="com.misbar.weekly-report"
# launchd Weekday: 0 (or 7) = Sunday … 4 = Thursday. The weekly template pins 4.
WEEKLY_DAYS_AR="كل خميس"
WEEKLY_DAYS_EN="Thursday"

say()  { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

# ---- job selection -----------------------------------------------------------
# Sets the per-job globals every cmd_* below reads. Keeping them as globals (not
# arguments) is what lets the daily code path stay byte-for-byte in behaviour.
KIND=""; LABEL=""; TEMPLATE=""; PLIST=""; DEFAULT_TIME=""; TITLE_AR=""; TITLE_EN=""
select_job() {
  case "$1" in
    daily)
      KIND="daily"; LABEL="$DAILY_LABEL"; DEFAULT_TIME="08:00"
      TITLE_AR="التقرير اليومي"; TITLE_EN="Daily report job"
      ;;
    weekly)
      KIND="weekly"; LABEL="$WEEKLY_LABEL"; DEFAULT_TIME="08:15"
      TITLE_AR="التقرير الأسبوعي"; TITLE_EN="Weekly report job"
      ;;
    *) fail "نوع مهمة غير معروف / unknown job kind: '$1' (use: daily | weekly)" ;;
  esac
  TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
  PLIST="$AGENTS_DIR/$LABEL.plist"
}

is_loaded() {
  launchctl print "$DOMAIN/$1" >/dev/null 2>&1 && return 0
  launchctl list "$1" >/dev/null 2>&1
}

# Reads one integer key out of a plist. Prints nothing when absent/non-numeric,
# so every caller can test with [ -n … ] instead of trusting PlistBuddy's text.
plist_int() {
  local v
  v="$(/usr/libexec/PlistBuddy -c "Print $2" "$1" 2>/dev/null)" || v=""
  case "$v" in
    ''|*[!0-9]*) printf '' ;;
    *) printf '%s' "$v" ;;
  esac
}

# Reads Hour/Minute back out of an installed plist. Prints "HH:MM" or nothing.
# Handles both shapes: StartCalendarInterval as a dict (what BOTH templates ship
# today) and as an array of dicts, where the first entry carries the time all
# entries share. The array branch is kept on purpose: a weekly plist installed
# before the Thursday-only change (2026-08-05) is still the Sun+Thu array, and
# `status` must keep reporting it correctly until the user re-runs `weekly on`.
configured_time() {
  [ -f "$1" ] || return 0
  local h m
  h="$(plist_int "$1" ':StartCalendarInterval:Hour')"
  m="$(plist_int "$1" ':StartCalendarInterval:Minute')"
  if [ -z "$h" ] || [ -z "$m" ]; then
    h="$(plist_int "$1" ':StartCalendarInterval:0:Hour')"
    m="$(plist_int "$1" ':StartCalendarInterval:0:Minute')"
  fi
  [ -n "$h" ] && [ -n "$m" ] && printf '%02d:%02d' "$((10#$h))" "$((10#$m))"
}

weekday_ar() {
  case "$1" in
    0|7) printf 'الأحد' ;;
    1) printf 'الاثنين' ;;
    2) printf 'الثلاثاء' ;;
    3) printf 'الأربعاء' ;;
    4) printf 'الخميس' ;;
    5) printf 'الجمعة' ;;
    6) printf 'السبت' ;;
    *) printf '؟' ;;
  esac
}

# Arabic day list of the installed plist's StartCalendarInterval. Reads the
# dict shape first (the Thursday-only weekly template → "الخميس"), then the
# legacy array shape (a pre-2026-08-05 Sun+Thu plist → "الأحد والخميس"). Prints
# nothing for the daily plist — its dict carries no Weekday at all.
configured_days() {
  [ -f "$1" ] || return 0
  local i=0 d out=""
  d="$(plist_int "$1" ':StartCalendarInterval:Weekday')"
  if [ -n "$d" ]; then printf '%s' "$(weekday_ar "$d")"; return 0; fi
  while [ "$i" -lt 7 ]; do
    d="$(plist_int "$1" ":StartCalendarInterval:$i:Weekday")"
    [ -n "$d" ] || break
    if [ -z "$out" ]; then out="$(weekday_ar "$d")"; else out="$out و$(weekday_ar "$d")"; fi
    i=$((i + 1))
  done
  printf '%s' "$out"
}

cmd_on() {
  local when="${1:-$DEFAULT_TIME}" hour minute pretty
  case "$when" in
    [0-9]:[0-9][0-9]|[0-9][0-9]:[0-9][0-9]) : ;;
    *) fail "وقت غير صالح / invalid time: '$when' (expected HH:MM, e.g. $DEFAULT_TIME)" ;;
  esac
  hour=$((10#${when%%:*}))
  minute=$((10#${when##*:}))
  [ "$hour" -ge 0 ] && [ "$hour" -le 23 ] || fail "الساعة خارج النطاق / hour out of range: $hour"
  [ "$minute" -ge 0 ] && [ "$minute" -le 59 ] || fail "الدقيقة خارج النطاق / minute out of range: $minute"
  pretty="$(printf '%02d:%02d' "$hour" "$minute")"

  [ -f "$TEMPLATE" ] || fail "القالب مفقود / template missing: $TEMPLATE"
  [ -f "$JOB" ] || fail "المهمة مفقودة / job script missing: $JOB"

  mkdir -p "$AGENTS_DIR" "$(dirname "$LOG_FILE")"
  chmod +x "$JOB" 2>/dev/null || true

  sed -e "s|__HOUR__|$hour|g" \
      -e "s|__MINUTE__|$minute|g" \
      -e "s|__SCRIPT__|$JOB|g" \
      -e "s|__LOG__|$LOG_FILE|g" \
      "$TEMPLATE" >"$PLIST" || fail "تعذّر كتابة / could not write $PLIST"

  # Unload any previous copy first so the new schedule actually takes effect.
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1; then
    launchctl load -w "$PLIST" >/dev/null 2>&1 || true
  fi
  launchctl enable "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

  if is_loaded "$LABEL"; then
    say "✅ تم تفعيل $TITLE_AR الساعة $pretty"
    say "   $TITLE_EN enabled at $pretty — $PLIST"
  else
    say "⚠️  تمت كتابة الملف لكن التحميل لم يتأكد / plist written but load not confirmed: $PLIST"
  fi
  if [ "$KIND" = "weekly" ]; then
    say "   اليوم / day: $WEEKLY_DAYS_AR ($WEEKLY_DAYS_EN — launchd Weekday 4)"
  fi
  say "   السجل / log: $LOG_FILE"
}

cmd_off() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  [ -f "$PLIST" ] && launchctl unload "$PLIST" >/dev/null 2>&1
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST" || fail "تعذّر الحذف / could not remove $PLIST"
    say "🛑 تم إيقاف $TITLE_AR وحذف الوكيل"
    say "   $TITLE_EN disabled and the LaunchAgent removed."
  else
    say "ℹ️  $TITLE_AR غير مُثبَّت أصلًا — لا شيء لحذفه"
    say "   $TITLE_EN was not installed — nothing to remove."
  fi
}

cmd_status() {
  local when days
  when="$(configured_time "$PLIST")"
  if [ -f "$PLIST" ]; then
    say "📄 الوكيل مثبَّت / LaunchAgent installed: $PLIST"
    say "   الوقت المجدول / scheduled time: ${when:-unknown}"
    if [ "$KIND" = "weekly" ]; then
      days="$(configured_days "$PLIST")"
      say "   اليوم / day: ${days:-$WEEKLY_DAYS_AR} ($WEEKLY_DAYS_EN)"
    fi
  else
    say "📄 الوكيل غير مثبَّت / LaunchAgent not installed."
    if [ "$KIND" = "weekly" ]; then
      say "   للتفعيل / to enable: bash $(basename "$0") weekly on $DEFAULT_TIME"
    fi
  fi
  if is_loaded "$LABEL"; then
    say "🟢 محمّل في launchd / loaded in launchd ($LABEL)"
  else
    say "⚪️ غير محمّل في launchd / not loaded in launchd ($LABEL)"
  fi
  if [ -f "$LOG_FILE" ]; then
    say "📝 السجل / log: $LOG_FILE"
  else
    say "📝 لا يوجد سجل بعد / no log yet: $LOG_FILE"
  fi
  return 0
}

status_all() {
  select_job daily
  say "── $TITLE_AR / $TITLE_EN"
  cmd_status
  say ""
  select_job weekly
  say "── $TITLE_AR ($WEEKLY_DAYS_AR) / $TITLE_EN ($WEEKLY_DAYS_EN)"
  cmd_status
  return 0
}

usage() {
  say "الاستخدام / usage: $(basename "$0") on [HH:MM] | off | status"
  say "                  $(basename "$0") daily  on [HH:MM] | off | status   # يوميًا / every day"
  say "                  $(basename "$0") weekly on [HH:MM] | off | status   # $WEEKLY_DAYS_AR / $WEEKLY_DAYS_EN"
}

# Sub-command dispatch for the explicit 'daily …' / 'weekly …' forms.
run_sub() {
  case "$1" in
    on)     cmd_on "$2" ;;
    off)    cmd_off ;;
    status) cmd_status ;;
    -h|--help|help) usage ;;
    *) fail "أمر غير معروف / unknown sub-command: '$1' (use: on [HH:MM] | off | status)" ;;
  esac
}

case "${1:-status}" in
  on)     select_job daily; cmd_on "${2:-}" ;;
  off)    select_job daily; cmd_off ;;
  status) status_all ;;
  daily)  select_job daily;  run_sub "${2:-status}" "${3:-}" ;;
  weekly) select_job weekly; run_sub "${2:-status}" "${3:-}" ;;
  -h|--help|help) usage ;;
  *)
    fail "أمر غير معروف / unknown command: '$1' (use: on [HH:MM] | off | status | daily … | weekly …)" ;;
esac
