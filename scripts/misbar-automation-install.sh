#!/bin/bash
# Install / remove / inspect the daily misbar report LaunchAgent.
#
#   misbar-automation-install.sh on [HH:MM]   # default 08:00
#   misbar-automation-install.sh off
#   misbar-automation-install.sh status
#
# Idempotent — re-running "on" with a new time just re-renders and reloads.
# Contains NO secrets: it only renders the checked-in plist template.
set -u

LABEL="com.misbar.daily-report"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
JOB="$SCRIPT_DIR/misbar-daily.sh"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG_FILE="$HOME/Library/Logs/misbar-daily.log"
DOMAIN="gui/$(id -u)"

say()  { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

is_loaded() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && return 0
  launchctl list "$LABEL" >/dev/null 2>&1
}

# Reads Hour/Minute back out of an installed plist. Prints "HH:MM" or nothing.
configured_time() {
  [ -f "$PLIST" ] || return 0
  local h m
  h="$(/usr/libexec/PlistBuddy -c 'Print :StartCalendarInterval:Hour' "$PLIST" 2>/dev/null)" || h=""
  m="$(/usr/libexec/PlistBuddy -c 'Print :StartCalendarInterval:Minute' "$PLIST" 2>/dev/null)" || m=""
  [ -n "$h" ] && [ -n "$m" ] && printf '%02d:%02d' "$h" "$m"
}

cmd_on() {
  local when="${1:-08:00}" hour minute
  case "$when" in
    [0-9]:[0-9][0-9]|[0-9][0-9]:[0-9][0-9]) : ;;
    *) fail "وقت غير صالح / invalid time: '$when' (expected HH:MM, e.g. 08:00)" ;;
  esac
  hour=$((10#${when%%:*}))
  minute=$((10#${when##*:}))
  [ "$hour" -ge 0 ] && [ "$hour" -le 23 ] || fail "الساعة خارج النطاق / hour out of range: $hour"
  [ "$minute" -ge 0 ] && [ "$minute" -le 59 ] || fail "الدقيقة خارج النطاق / minute out of range: $minute"

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

  if is_loaded; then
    say "✅ تم تفعيل التقرير اليومي الساعة $(printf '%02d:%02d' "$hour" "$minute")"
    say "   Daily report job enabled at $(printf '%02d:%02d' "$hour" "$minute") — $PLIST"
    say "   السجل / log: $LOG_FILE"
  else
    say "⚠️  تمت كتابة الملف لكن التحميل لم يتأكد / plist written but load not confirmed: $PLIST"
  fi
}

cmd_off() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  [ -f "$PLIST" ] && launchctl unload "$PLIST" >/dev/null 2>&1
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST" || fail "تعذّر الحذف / could not remove $PLIST"
    say "🛑 تم إيقاف التقرير اليومي وحذف الوكيل"
    say "   Daily report job disabled and the LaunchAgent removed."
  else
    say "ℹ️  التقرير اليومي غير مُثبَّت أصلًا — لا شيء لحذفه"
    say "   Daily report job was not installed — nothing to remove."
  fi
}

cmd_status() {
  local when
  when="$(configured_time)"
  if [ -f "$PLIST" ]; then
    say "📄 الوكيل مثبَّت / LaunchAgent installed: $PLIST"
    say "   الوقت المجدول / scheduled time: ${when:-unknown}"
  else
    say "📄 الوكيل غير مثبَّت / LaunchAgent not installed."
  fi
  if is_loaded; then
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

case "${1:-status}" in
  on)     cmd_on "${2:-08:00}" ;;
  off)    cmd_off ;;
  status) cmd_status ;;
  -h|--help|help)
    say "الاستخدام / usage: $(basename "$0") on [HH:MM] | off | status" ;;
  *)
    fail "أمر غير معروف / unknown command: '$1' (use: on [HH:MM] | off | status)" ;;
esac
