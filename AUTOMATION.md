# الأتمتة / Automation

التشغيل الآلي لتقرير مسبار — ثلاث طرق للتشغيل، وخيارات مستقلة لكل خطوة.
Hands-off generation of the daily misbar report: three ways to run it, one switch per step.

> **البريد لا يُرسَل تلقائيًا أبدًا. Email drafts are NEVER sent automatically.**
> The pipeline only *prepares* draft files. Opening, reviewing and sending stays a
> manual human action, every single time.

---

## 1. الخيارات / What each option does

كل خيار مستقل — الخطوة التي خيارها `false` لا تُنفَّذ إطلاقًا.
Every option is independent; a step whose option is `false` never runs.

| Option | يفعل / What it does |
| --- | --- |
| `enabled` | المفتاح الرئيسي. Master switch. When off, `?auto=1` and the daily Mac job do nothing. |
| `autoPull` | يسحب أحدث لقطة مشفَّرة من المصدر. Pulls the latest encrypted snapshot / live orders. |
| `autoGenerate` | يشغّل المحرك ويبني الشرائح. Runs the engine and builds the report deck. |
| `autoDownload` | ينزّل ملفات التقرير الأربعة (٢ PPTX + ٢ PDF). Downloads the 4 report files (2 PPTX + 2 PDF). |
| `autoLabFiles` | ينشئ ملفات المختبرات المتأخرة. Builds the per-lab late-orders files. |
| `autoEmailDrafts` | يُجهّز مسوّدات البريد كملفات — **بدون إرسال**. Prepares email drafts as files — **never sends**. |
| `autoAcceptTat` | يقبل اقتراحات TAT المطابقة تلقائيًا. Auto-accepts the confident TAT suggestions. |
| `dailyTime` | وقت المهمة اليومية على الماك (HH:MM). Time of day for the Mac job. |

الافتراضي: كل شيء مُطفأ (`AUTOMATION_DEFAULTS`). Everything defaults to **off** —
automation is strictly opt-in, per option, from the settings screen.

بيانات المرضى لا تُحفَظ ولا تُسجَّل في أي خطوة. No patient data is persisted or logged
by any step, automated or not.

---

## 2. ثلاث طرق للتشغيل / Three ways to run

### أ. زر اللوحة / The panel button
افتح شاشة «رفع البيانات» واضغط زر التشغيل الآلي في لوحة الأتمتة. تظهر كل خطوة مع حالتها.
Open the **upload** screen and press the run button in the automation panel. Each step
reports `start / done / skip / error` live.

### ب. رابط التشغيل / The URL trigger

| URL | يفعل / Behaviour |
| --- | --- |
| `…/misbar-report/?auto=1` | يشغّل الأتمتة بخيارات المستخدم المحفوظة. Runs with your **saved** options. Honours `enabled: false` — if automation is off in settings, nothing happens. |
| `…/misbar-report/?auto=full` | يشغّل **كل** الخطوات لهذه المرة فقط، دون حفظ. Runs **every** step for this one run, without persisting anything to your settings. |

الجهاز المقفل لا يشغّل شيئًا أبدًا: إذا ظهرت شاشة كلمة المرور، ينتظر الرابط حتى فتح القفل.
**A locked device never auto-runs.** If the passphrase gate is showing, the trigger simply
does not fire; it takes effect on the next boot after you unlock. Likewise, if the pipeline
module is missing the trigger is ignored silently — the app still boots normally.

The trigger always lands on the upload screen so the progress panel is visible.

### ج. مهمة الماك اليومية / The daily Mac job
`scripts/misbar-daily.sh`, driven by a launchd agent, does two things each morning:

1. runs `scripts/kamc-live-local.sh` to refresh the encrypted snapshot, then
2. opens `https://abosallom.github.io/misbar-report/?auto=1` in the default browser.

It logs to `~/Library/Logs/misbar-daily.log`, skips silently when the Mac is offline, and
always exits 0 so one bad morning never disables the schedule.

Only a Saudi-network Mac can refresh the snapshot (`elab.seha.sa` geo-blocks foreign IPs),
which is why this half of the job is local rather than a GitHub Action.

---

## 3. تفعيل/إيقاف مهمة الماك / Enabling and disabling the Mac job

```bash
bash scripts/misbar-automation-install.sh status      # هل هي مثبّتة؟ / is it installed?
bash scripts/misbar-automation-install.sh on          # يوميًا 08:00 / daily at 08:00
bash scripts/misbar-automation-install.sh on 07:30    # وقت مخصّص / custom time
bash scripts/misbar-automation-install.sh off         # إيقاف وحذف / unload and remove
```

`on` renders `scripts/com.misbar.daily-report.plist.template` into
`~/Library/LaunchAgents/com.misbar.daily-report.plist` and loads it with `launchctl`.
It is idempotent — re-run it any time to change the hour.

تشغيل تجريبي فوري / dry-run it by hand without waiting for the schedule:

```bash
bash scripts/misbar-daily.sh && tail -20 ~/Library/Logs/misbar-daily.log
```

### أسرار / Secrets
لا يحتوي أي من هذين الملفين على أي سر. Neither the template nor either script contains a
secret. `GRAFANA_TOKEN` and `DATA_KEY` stay in the separate data-export LaunchAgent, which
`kamc-live-local.sh` inherits its environment from. Never add credentials to these files —
they are committed to the repository.

---

## 4. للمطوّرين / Integration notes

While a run is in flight, `window.__misbarAutoRun` exposes a small bus:

```js
{ mode: 'auto'|'full', running, startedAt, finishedAt, options, events, result, error,
  promise,                    // resolves when the run settles (never rejects)
  subscribe(fn) -> unsubscribe,  // buffered events are replayed on subscribe
  abort() }
```

Window events mirror it, so a panel can attach in either order:
`misbar:autorun` (detail = the bus, fires once at start), `misbar:autostep`
(detail = `{step, status, message, pct}`), `misbar:autodone`
(detail = `{ok, result, error}`).
