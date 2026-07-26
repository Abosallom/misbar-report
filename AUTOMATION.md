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

مواعيد التقرير الأسبوعي ليست خيارًا في الإعدادات — هي في LaunchAgent (§3).
There is deliberately **no weekly option in this table**: the weekly run days live in the
`com.misbar.weekly-report` LaunchAgent (§3), not in app settings, so nothing in the app can
claim a schedule the machine is not actually keeping.

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

### ج. مهام الماك / The Mac jobs
`scripts/misbar-daily.sh`, driven by launchd, does two things on every run:

1. runs `scripts/kamc-live-local.sh` to refresh the encrypted snapshot, then
2. opens `https://abosallom.github.io/misbar-report/?auto=1` in the default browser.

هناك **مهمتان** تستخدمان نفس السكربت / **Two agents** share that one script:

| Agent | متى / When | الأمر / Invocation | URL |
| --- | --- | --- | --- |
| `com.misbar.daily-report` | كل يوم / every day, default **08:00** | `misbar-daily.sh` | `?auto=1` |
| `com.misbar.weekly-report` | **الأحد والخميس** / **Sunday + Thursday**, default **08:15** | `misbar-daily.sh weekly` | `?auto=1&mode=weekly` |

التقرير الأسبوعي يُصدر يومي الأحد والخميس (أسبوع العمل السعودي الأحد–الخميس)، فالمهمة
الأسبوعية مربوطة بهذين اليومين لا بـ«كل ٧ أيام».
The weekly report is issued **twice a week — Sunday and Thursday** (the Saudi work week is
Sun–Thu), so the weekly agent is anchored to those two weekdays rather than to a rolling
7-day interval. launchd expresses that as an *array* of `StartCalendarInterval` dicts —
one per weekday — using this mapping:

| `Weekday` | 0 (or 7) | 1 | 2 | 3 | **4** | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| اليوم / Day | **الأحد** Sun | الاثنين Mon | الثلاثاء Tue | الأربعاء Wed | **الخميس** Thu | الجمعة Fri | السبت Sat |

`scripts/com.misbar.weekly-report.plist.template` therefore pins **Weekday 0 and Weekday 4**
at the same hour/minute. Both agents append to the same log,
`~/Library/Logs/misbar-daily.log`, and each line is tagged with its mode so the two runs are
distinguishable:

```
[misbar-daily  2026-07-26 08:00:03] start (mode=daily, scripts=…)
[misbar-weekly 2026-07-26 08:15:04] start (mode=weekly, scripts=…)
```

Both skip silently when the Mac is offline and always exit 0, so one bad morning never
disables a schedule. `misbar-daily.sh` takes the mode as its **only** optional argument
(`daily` — the default — or `weekly`); an unrecognised value degrades to `daily` instead of
failing the run. The mode is an identity, not a different pipeline: what the page actually
builds is decided in the app, and `mode=weekly` simply lets the run be recognised.

Only a Saudi-network Mac can refresh the snapshot (`elab.seha.sa` geo-blocks foreign IPs),
which is why this half of the job is local rather than a GitHub Action.

---

## 3. تفعيل/إيقاف مهام الماك / Enabling and disabling the Mac jobs

### اليومية / Daily job

```bash
bash scripts/misbar-automation-install.sh status      # كلتا المهمتين / BOTH jobs
bash scripts/misbar-automation-install.sh on          # يوميًا 08:00 / daily at 08:00
bash scripts/misbar-automation-install.sh on 07:45    # وقت مخصّص / custom time
bash scripts/misbar-automation-install.sh off         # إيقاف وحذف / unload and remove
```

الصيغ الثلاث أعلاه هي الواجهة الأصلية ولا تزال تعني المهمة اليومية.
Those bare forms are the original interface and still mean the **daily** job (`status` now
additionally reports the weekly one). An explicit `daily` prefix works too:
`… daily on [HH:MM] | daily off | daily status`.

### الأسبوعية — الأحد والخميس / Weekly job — Sunday + Thursday

```bash
bash scripts/misbar-automation-install.sh weekly status    # هل هي مثبّتة؟ / is it installed?
bash scripts/misbar-automation-install.sh weekly on        # الأحد والخميس 08:15 / Sun+Thu 08:15
bash scripts/misbar-automation-install.sh weekly on 09:00  # وقت مخصّص / custom time
bash scripts/misbar-automation-install.sh weekly off       # إيقاف وحذف / unload and remove
```

المهمتان مستقلتان تمامًا: تثبيت إحداهما أو حذفها لا يمسّ الأخرى.
The two agents are fully independent — installing or removing one never touches the other.
`on` renders the matching template into
`~/Library/LaunchAgents/com.misbar.<daily|weekly>-report.plist` and loads it with
`launchctl`. Both are idempotent — re-run either at any time to change the hour.

`com.misbar.kamc-live` تعمل على نفس نسخة العمل — وتنفّذ `git` داخلها — عند كل `:00` و`:30`
من 07:00 إلى 22:30، والافتراضي اليومي **08:00 يقع على هذه الشبكة تمامًا**: عند الثامنة تنطلق
المهمتان معًا. لا ينفّذان `git` بالتوازي مع ذلك، لأن `misbar-daily.sh` يحدّث اللقطة عبر
`launchctl kickstart -k` على `com.misbar.kamc-live`، و`-k` يقتل النسخة الجارية ثم يبدأ نسخة
جديدة. لكن القتل إن وقع داخل `git commit`/`git push` فقد يترك `.git/index.lock`، فتفشل كل
دورة تالية لـ kamc-live عند `git pull` وتبقى اللقطة قديمة بصمت حتى يُحذف الملف. لتفادي هذه
النافذة كليًا ثبّت المهمة اليومية على دقيقة خارج الشبكة، مثل `… on 08:05`.

`com.misbar.kamc-live` drives the same working copy — and runs `git` in it — at every `:00`
and `:30` from 07:00–22:30, and the **daily default 08:00 sits exactly on that grid**: at
08:00 launchd starts both agents. They still do not run `git` concurrently, but only because
`misbar-daily.sh` refreshes the snapshot through
`launchctl kickstart -k gui/$(id -u)/com.misbar.kamc-live`, and `-k` kills the in-flight
kamc-live instance before starting a fresh one. A kill that lands inside `git commit` /
`git push` can leave a stale `.git/index.lock` behind, after which every later kamc-live tick
fails at `git pull` and the snapshot silently goes stale until the lock is removed
(`rm -f .git/index.lock`). To avoid that window entirely, install the daily job on an
**off-grid minute** — `… on 08:05`; the weekly default 08:15 already is one.

On a Sunday or Thursday **both** report agents fire; that is intended — the daily run is
unchanged and the weekly run is the extra, weekday-anchored one.

تشغيل تجريبي فوري / dry-run either by hand without waiting for the schedule:

```bash
bash scripts/misbar-daily.sh          && tail -20 ~/Library/Logs/misbar-daily.log
bash scripts/misbar-daily.sh weekly   && tail -20 ~/Library/Logs/misbar-daily.log
```

لوحة «⚡ التشغيل التلقائي» تعرض أيام التقرير الأسبوعي (الأحد والخميس) كسطر للقراءة فقط مع
أمر التفعيل — الجدولة الحقيقية في LaunchAgent وليست في الصفحة.
The **⚡ التشغيل التلقائي** card shows the weekly days and the enable command as a
**read-only** line. There is deliberately no in-page scheduler: a web page cannot install a
LaunchAgent, and a fake switch would drift out of sync with the real one.

**البريد لا يُرسَل تلقائيًا أبدًا — لا في المهمة اليومية ولا الأسبوعية.**
**Neither job ever sends email.** `autoEmailDrafts` only *writes* `.eml` draft files;
opening, reviewing and sending stays a manual human action on every run, daily or weekly.

### أسرار / Secrets
لا يحتوي أي من هذه الملفات على أي سر. Neither template nor either script contains a
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
