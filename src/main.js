// main.js — boot, settings store, top app bar, and screen router (Track E).
import { state } from './state.js?v=v2026-07-23.7';
import { STR } from './i18n/ar.js?v=v2026-07-23.7';
import { APP_VERSION } from './version.js?v=v2026-07-23.7';
import { el, toast } from './ui/components.js?v=v2026-07-23.7';
import { SETTINGS_KEY } from './contracts.js?v=v2026-07-23.7';
import { TAT_LOOKUP } from './seeds/tat-lookup.js?v=v2026-07-23.7';
import { SCORECARD_SEED } from './seeds/scorecard.js?v=v2026-07-23.7';
import { HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED } from './seeds/defaults.js?v=v2026-07-23.7';

/* ------------------------------------------------------------------ *
 * Settings store — prefers Track C's src/store.js, falls back to a
 * self-contained localStorage/seeds implementation so this app runs
 * standalone. All writes are mirrored locally; PHI is never stored.
 * ------------------------------------------------------------------ */

function seedSettings() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    tatLookup: { ...TAT_LOOKUP },
    displayNames: {},
    scorecard: SCORECARD_SEED.map((x) => ({ ...x })),
    historicalConstants: { cancelledByMonth: { ...HISTORICAL_CONSTANTS_SEED.cancelledByMonth } },
    snapshot: JSON.parse(JSON.stringify(SNAPSHOT_SEED)), // nested {asOf, numbers}
    grafana: { ...GRAFANA_SEED },
    cachedTracker: null,
  };
}

// Widen a legacy {prevCompleted, asOf} snapshot to the {asOf, numbers} shape.
function migrateLocalSnapshot(s, seedSnap) {
  if (!s || typeof s !== 'object') return JSON.parse(JSON.stringify(seedSnap));
  if (s.numbers && typeof s.numbers === 'object') {
    return { asOf: s.asOf ?? seedSnap.asOf, numbers: { ...seedSnap.numbers, ...s.numbers } };
  }
  return {
    asOf: s.asOf ?? seedSnap.asOf,
    numbers: {
      ...seedSnap.numbers,
      ...(s.prevCompleted != null ? { completed: Number(s.prevCompleted) } : {}),
    },
  };
}

function canPersist() {
  try {
    const k = '__misbar_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

function readLocalSettings() {
  const seed = seedSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return seed;
    const s = JSON.parse(raw);
    return {
      ...seed, ...s,
      tatLookup: { ...seed.tatLookup, ...(s.tatLookup || {}) },
      displayNames: { ...seed.displayNames, ...(s.displayNames || {}) },
      historicalConstants: {
        // Additive (v2) semantics: stored maps are MANUAL-only. A pre-v2 doc may
        // still carry max-era data-derived values (e.g. 2026-05:6) which would
        // double-count — replace with the seed manual map for those docs.
        cancelledByMonth: s.schemaVersion === 2
          ? { ...seed.historicalConstants.cancelledByMonth, ...((s.historicalConstants || {}).cancelledByMonth || {}) }
          : { ...seed.historicalConstants.cancelledByMonth },
      },
      snapshot: migrateLocalSnapshot(s.snapshot, seed.snapshot),
      grafana: (() => {
        const g = { ...seed.grafana, ...(s.grafana || {}) };
        if (!g.baseUrl) g.baseUrl = seed.grafana.baseUrl; // empty URL is never useful
        return g;
      })(),
      cachedTracker: s.cachedTracker || null,
      scorecard: Array.isArray(s.scorecard) && s.scorecard.length ? s.scorecard : seed.scorecard,
    };
  } catch { return seed; }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/* Self-contained fallback conforming to Track C's store.js interface. */
function createLocalStore(persistent) {
  let cached = null;
  const read = () => { cached = readLocalSettings(); return clone(cached); };
  const write = (s) => {
    s = clone(s);
    s.schemaVersion = 2; // keep the fallback aligned with store.js SCHEMA_VERSION
    s.updatedAt = new Date().toISOString();
    cached = s;
    if (persistent) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
    return clone(s);
  };
  return {
    loadSettings: () => (cached ? clone(cached) : read()),
    saveSettings: (s) => write(s),
    updateSnapshot: ({ asOf, numbers } = {}) => {
      const d = cached ? clone(cached) : read();
      const cur = migrateLocalSnapshot(d.snapshot, seedSettings().snapshot);
      const merged = { ...cur.numbers };
      if (numbers && typeof numbers === 'object') {
        for (const [k, v] of Object.entries(numbers)) {
          if (typeof v === 'number' && Number.isFinite(v)) merged[k] = v;
        }
      }
      d.snapshot = { asOf: asOf != null ? String(asOf) : cur.asOf, numbers: merged };
      return write(d);
    },
    isEphemeral: () => !persistent,
    exportSettings: () => ({
      filename: 'misbar-settings.json',
      blob: new Blob([JSON.stringify(cached ? cached : read(), null, 2)], { type: 'application/json' }),
    }),
    importSettings: (text) => { write({ ...seedSettings(), ...(JSON.parse(text) || {}) }); return { imported: true }; },
  };
}

/* Adapter exposing BOTH Track C's store interface (loadSettings/saveSettings/
 * updateSnapshot/isEphemeral/exportSettings/importSettings) and the convenience
 * accessors this track's screens use (`settings` getter, setTat). */
function makeAdapter(backend, local) {
  const has = (n) => backend && typeof backend[n] === 'function';
  const call = (n, ...a) => (has(n) ? backend[n](...a) : local[n](...a));
  const load = () => {
    try { return call('loadSettings'); } catch (e) { console.warn('[store] loadSettings failed; local', e); return local.loadSettings(); }
  };
  return {
    // Track C interface (pass-through, backend-or-local)
    loadSettings: () => load(),
    saveSettings: (s) => { try { return call('saveSettings', s); } catch (e) { console.warn('[store] saveSettings failed; local', e); return local.saveSettings(s); } },
    updateSnapshot: (snap) => { try { return call('updateSnapshot', snap); } catch (e) { console.warn('[store] updateSnapshot failed; local', e); return local.updateSnapshot(snap); } },
    isEphemeral: () => (has('isEphemeral') ? backend.isEphemeral() : local.isEphemeral()),
    updateCachedTracker(model) {
      try { return call('updateCachedTracker', model); } catch (e) {
        console.warn('[store] updateCachedTracker failed; local', e);
        const d = this.loadSettings();
        d.cachedTracker = model ? { model, updatedAt: new Date().toISOString() } : null;
        return this.saveSettings(d);
      }
    },
    exportSettings: () => call('exportSettings'),
    importSettings: (t) => call('importSettings', t),
    // Convenience for this track's screens
    get settings() { return load(); },
    getSettings() { return load(); },
    get persistent() { return !this.isEphemeral(); },
    setTat(name, days) {
      const doc = load();
      doc.tatLookup = { ...(doc.tatLookup || {}), [name]: Number(days) };
      return this.saveSettings(doc);
    },
  };
}

async function resolveStore() {
  const persistent = canPersist();
  const local = createLocalStore(persistent);
  let backend = null;
  try {
    const mod = await import('./store.js?v=v2026-07-23.7');
    if (mod && typeof mod.loadSettings === 'function' && typeof mod.saveSettings === 'function') {
      const s = mod.loadSettings();
      if (s && s.tatLookup) backend = mod;
    }
  } catch { /* Track C store not present — fall back to local */ }
  return makeAdapter(backend, local);
}

/* ------------------------------------------------------------------ *
 * Router + app shell
 * ------------------------------------------------------------------ */

const SCREEN_MODULES = {
  upload: './ui/screen-upload.js?v=v2026-07-23.7',
  review: './ui/screen-review.js?v=v2026-07-23.7',
  generate: './ui/screen-generate.js?v=v2026-07-23.7',
  settings: './ui/screen-settings.js?v=v2026-07-23.7', // Track C
};

let appEl = null;
let navHome = null;
let navSettings = null;
let journeyEl = null;
let ctx = null;

/* The three-step user journey shown under the app bar on flow screens.
 * Order matters — index derives current/completed/upcoming from state.screen. */
const JOURNEY_STEPS = [
  { id: 'upload', num: '١', full: 'رفع البيانات', short: 'رفع' },
  { id: 'review', num: '٢', full: 'المراجعة والتحرير', short: 'مراجعة' },
  { id: 'generate', num: '٣', full: 'توليد التقارير', short: 'توليد' },
];

/* Render/refresh the journey step-bar for the current screen. Settings (and any
 * non-flow screen) hides the bar. Completed steps are clickable (navigate back). */
function renderJourney() {
  if (!journeyEl) return;
  const idx = JOURNEY_STEPS.findIndex((s) => s.id === state.screen);
  if (idx < 0) { journeyEl.hidden = true; journeyEl.innerHTML = ''; return; }
  journeyEl.hidden = false;
  journeyEl.innerHTML = '';

  const row = el('div', { class: 'journey' });
  JOURNEY_STEPS.forEach((step, i) => {
    if (i > 0) {
      // Connector segment is "done" once we have advanced into or past this step.
      row.appendChild(el('div', { class: 'journey-line' + (i <= idx ? ' is-done' : ''), 'aria-hidden': 'true' }));
    }
    const done = i < idx;
    const current = i === idx;
    const stateCls = done ? ' is-done' : current ? ' is-current' : ' is-upcoming';
    const kids = [
      el('span', { class: 'journey-marker', 'aria-hidden': 'true', text: done ? '✓' : step.num }),
      el('span', { class: 'journey-label journey-label--full', text: step.full }),
      el('span', { class: 'journey-label journey-label--short', text: step.short }),
    ];
    if (done) {
      row.appendChild(el('button', {
        type: 'button',
        class: 'journey-step' + stateCls,
        title: STR.common.back + ': ' + step.full,
        'aria-label': step.full,
        onClick: () => navigate(step.id),
      }, kids));
    } else {
      row.appendChild(el('div', {
        class: 'journey-step' + stateCls,
        'aria-current': current ? 'step' : null,
        'aria-label': step.full,
      }, kids));
    }
  });
  journeyEl.appendChild(row);
}

function goHome() {
  navigate(state.engineOutput ? 'review' : 'upload');
}

function navigate(screenId) {
  state.screen = screenId;
  renderScreen();
  try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
}

function rerender() { renderScreen(); }

function setActiveNav() {
  const onSettings = state.screen === 'settings';
  navHome.setAttribute('aria-current', onSettings ? 'false' : 'page');
  navSettings.setAttribute('aria-current', onSettings ? 'page' : 'false');
}

function placeholderScreen(container, msg) {
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'screen' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card__title', text: STR.common.underConstruction }),
      el('p', { class: 'muted', text: msg || STR.router.missingScreen }),
    ]),
  ]));
}

async function renderScreen() {
  setActiveNav();
  renderJourney();
  const id = state.screen;
  const path = SCREEN_MODULES[id] || SCREEN_MODULES.upload;
  appEl.innerHTML = '';
  appEl.appendChild(el('div', { class: 'screen' }, [
    el('p', { class: 'muted', text: STR.common.loading }),
  ]));
  let mod = null;
  try {
    mod = await import(path);
  } catch (e) {
    console.warn('[router] screen module missing:', id, e);
    return placeholderScreen(appEl, STR.router.missingScreen);
  }
  if (!mod || typeof mod.render !== 'function') {
    return placeholderScreen(appEl, STR.router.missingScreen);
  }
  try {
    appEl.innerHTML = '';
    await mod.render(appEl, ctx);
  } catch (e) {
    console.error('[router] screen render failed:', id, e);
    appEl.innerHTML = '';
    placeholderScreen(appEl, STR.common.error + ': ' + (e && e.message ? e.message : id));
  }
}

/* ------------------------------------------------------------------ *
 * Appearance (light/dark) — per-device, persisted in localStorage.
 * index.html's <head> applies the stored choice before first paint;
 * this toggle only flips data-theme + saves. Absence of the key = follow
 * the OS via the CSS @media(prefers-color-scheme) rules. The report slides
 * use no CSS vars, so the deck is unaffected by the theme.
 * ------------------------------------------------------------------ */
const THEME_KEY = 'misbar.theme.v1';

function effectiveTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function syncThemeButton(btn) {
  const dark = effectiveTheme() === 'dark';
  btn.textContent = dark ? '☀️' : '🌙';
  const label = dark ? 'المظهر الفاتح' : 'المظهر الداكن';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function toggleTheme(btn) {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked — session-only */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#0E1626' : '#1E3A8A');
  syncThemeButton(btn);
}

function buildShell(store) {
  const root = document.getElementById('app-shell') || document.body;

  const logo = el('img', { class: 'appbar__logo', src: 'assets/icon.svg', alt: '' });
  navHome = el('button', { class: 'navbtn', text: STR.nav.home, onClick: goHome });
  navSettings = el('button', { class: 'navbtn', text: STR.nav.settings, onClick: () => navigate('settings') });
  const navTheme = el('button', { class: 'navbtn navbtn--theme', onClick: () => toggleTheme(navTheme) });
  syncThemeButton(navTheme);
  // قفل is now sign-out as well as re-lock: lockMod.lock() clears the unlocked
  // marker AND the remembered username, then blanks the sealed grafana secrets.
  const navLock = (lockMod && typeof lockMod.lock === 'function')
    ? el('button', {
      class: 'navbtn', text: 'قفل 🔒', title: 'تسجيل الخروج وقفل البوابة على هذا الجهاز',
      onClick: () => { try { lockMod.lock(store); } finally { location.reload(); } },
    })
    : null;

  // Who is signed in, shown beside قفل. Display name only — never a password,
  // and it carries no authority (lock.js's isUnlocked is what gates the app).
  // A shared-passphrase sign-in identifies nobody, so it renders no chip.
  // Styled with the existing version-chip pill so it needs no new CSS; dir=ltr
  // because usernames are latin. textContent-only, so the name cannot inject.
  //
  // The app bar is already at its minimum width on a phone (the brand title is
  // fully clipped there), so the chip must not add a fixed 90px: under 560px it
  // collapses to the 👤 glyph alone, with the name on title/aria-label. It also
  // stays shrinkable and capped so a long username can never widen the bar.
  const signedInAs = (lockMod && typeof lockMod.currentUser === 'function') ? lockMod.currentUser() : null;
  let userChip = null;
  if (signedInAs) {
    const label = 'المستخدم الحالي: ' + signedInAs;
    userChip = el('span', {
      class: 'appbar__version appbar__user', dir: 'ltr',
      title: label, 'aria-label': label, text: '👤 ' + signedInAs,
    });
    Object.assign(userChip.style, {
      flex: '0 1 auto', minWidth: '0', maxWidth: 'min(22ch, 30vw)',
      overflow: 'hidden', textOverflow: 'ellipsis',
    });
    const mq = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;
    const syncUserChip = () => {
      const compact = mq ? mq.matches : (document.documentElement.clientWidth <= 560);
      const next = compact ? '👤' : '👤 ' + signedInAs;
      if (userChip.textContent !== next) userChip.textContent = next;
    };
    syncUserChip();
    // Both hooks on purpose: `change` is the right event, but it does not fire
    // under every viewport-override path (device emulation, some orientation
    // changes), and a stale chip would show the wrong width forever.
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', syncUserChip);
    window.addEventListener('resize', syncUserChip);
  }

  // The version pill is the one app-bar item with nothing to lose from being
  // clipped, so it is the one made shrinkable: on a phone it now absorbs the
  // overflow (ellipsised, full string still on the tooltip) instead of pushing
  // the whole bar — and the page — into a horizontal scroll.
  const versionChip = el('span', {
    class: 'appbar__version', title: 'إصدار التطبيق: ' + APP_VERSION, dir: 'ltr', text: APP_VERSION,
  });
  Object.assign(versionChip.style, {
    flex: '0 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis',
  });

  const bar = el('header', { class: 'appbar' }, [
    el('div', { class: 'appbar__brand' }, [logo, el('div', { class: 'appbar__title', text: STR.appTitle })]),
    el('div', { class: 'appbar__spacer' }),
    el('nav', { class: 'appbar__nav' }, [navHome, navSettings, navTheme, userChip, navLock]),
    versionChip,
  ]);

  const storageWarn = el('div', { class: 'storage-warn', text: STR.storage.warn });
  storageWarn.hidden = store.persistent;

  // Journey step-bar host — filled per-screen by renderJourney().
  journeyEl = el('nav', { class: 'journey-wrap', 'aria-label': 'خطوات إنشاء التقرير' });
  journeyEl.hidden = true;

  appEl = el('main', { id: 'app' });

  root.innerHTML = '';
  root.append(bar, storageWarn, journeyEl, appEl);
}

/* ------------------------------------------------------------------ *
 * URL automation trigger (Track 4) — ?auto=1 | ?auto=full
 *
 * ?auto=1     run the pipeline with the user's stored settings.automation.
 *             Honours the master switch: `enabled: false` vetoes the run.
 * ?auto=full  switch every option on for this run — the switched-on values are
 *             NOT written back to settings.automation, but the steps they
 *             enable are the ordinary steps and they do write what a normal run
 *             writes: autoAcceptTat saves the suggested TAT durations, and a
 *             successful generate records the delta-baseline snapshot. Because
 *             this mode ignores the master switch and any link can navigate
 *             here, it asks for an explicit confirmation first (fail-closed:
 *             no confirm(), no run).
 *
 * The trigger is deliberately inert unless everything lines up: boot() returns
 * early on a locked device (a locked device must NEVER auto-run) and the
 * pipeline import is guarded. The bus is claimed synchronously so a panel that
 * mounts while the import is still in flight can see that this run owns the
 * pipeline instead of starting a rival one. Progress is published on that bus —
 * reachable via `window.__misbarAutoRun` or the announce event, in either
 * order — and mirrored to the console + a toast so an unattended run is still
 * observable. The bus itself carries METADATA ONLY: the produced blobs and lab
 * bytes (order-level data) travel in the misbar:autodone detail and are never
 * parked on `window`. Nothing here may throw: a broken trigger must not break
 * the app.
 * ------------------------------------------------------------------ */
const AUTO_BUS_KEY = '__misbarAutoRun';
const AUTO_ANNOUNCE_EVENT = 'misbar:autorun';  // detail = the bus (fires once)
const AUTO_STEP_EVENT = 'misbar:autostep';     // detail = the pipeline event
// detail = { ok, result, summary, alreadyRunning, error }. `result` is the FULL
// pipeline result (blobs + lab bytes) and is handed to listeners here and only
// here — it is deliberately not retained anywhere after the dispatch.
const AUTO_DONE_EVENT = 'misbar:autodone';

/** Read the trigger off the query string. Returns 'auto' | 'full' | null. */
function readAutoMode(params) {
  const raw = String(params.get('auto') || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return null;
  return (raw === 'full' || raw === 'all') ? 'full' : 'auto';
}

function fireWindowEvent(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* older engines — bus still works */ }
}

/* XLSX MIME for the per-lab workbooks the pipeline hands back as raw bytes
 * (same literal ui/late-labs-section.js and ui/automation-panel.js use). */
const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* Save a finished run's per-lab workbooks + .eml drafts. runAutomation's own
 * autoDownload hook covers ONLY the 4 report files (inside its generate step),
 * so on the unattended ?auto= path — where no panel is listening — the XLSX/EML
 * blobs would be produced and then dropped with the tab. Spaced ~300ms apart,
 * the pacing late-labs-section.js uses so browsers don't discard stacked
 * downloads. Fully guarded: a missing helper is a no-op, never a throw. */
async function downloadAutoExtras(result) {
  const items = [];
  for (const f of ((result && result.labFiles) || [])) {
    if (f && f.bytes) items.push({ name: f.fileName || ((f.lab || 'lab') + '.xlsx'), blob: new Blob([f.bytes], { type: SHEET_MIME }) });
  }
  for (const d of ((result && result.drafts) || [])) {
    if (d && d.blob) items.push({ name: d.fileName || ((d.lab || 'lab') + '.eml'), blob: d.blob });
  }
  if (!items.length) return 0;
  let mod = null;
  try {
    mod = await import('./ui/late-labs-section.js?v=v2026-07-23.7');
  } catch (e) {
    console.warn('[auto] download helper unavailable — lab files/drafts not saved', e);
    return 0;
  }
  if (!mod || typeof mod.triggerDownload !== 'function') {
    console.warn('[auto] download helper exports no triggerDownload() — lab files/drafts not saved');
    return 0;
  }
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    try { mod.triggerDownload(items[i].blob, items[i].name); n++; } catch (e) { console.warn('[auto] download failed', items[i].name, e); }
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  console.info('[auto] saved ' + n + ' extra file(s) (lab workbooks + drafts)');
  return n;
}

/** Replay-capable event bus for one automation run. */
function createAutoBus(mode) {
  const events = [];
  const subs = new Set();
  return {
    mode,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    options: null,
    // Metadata-only summary of the finished run — {ok, steps, errors, counts}.
    // Order-level data (files[].blob, labFiles[].bytes, drafts[].blob) must NOT
    // be parked on `window`; it lives in the misbar:autodone detail instead.
    result: null,
    alreadyRunning: false, // true when another caller owned the pipeline
    error: null,
    promise: null,
    events,
    abort() { /* replaced with the AbortController hook below */ },
    /** subscribe(fn) → unsubscribe. Buffered events are replayed immediately. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      for (const ev of events.slice()) {
        try { fn(ev); } catch (e) { console.warn('[auto] subscriber failed', e); }
      }
      return () => subs.delete(fn);
    },
    emit(ev) {
      events.push(ev);
      for (const fn of Array.from(subs)) {
        try { fn(ev); } catch (e) { console.warn('[auto] subscriber failed', e); }
      }
      fireWindowEvent(AUTO_STEP_EVENT, ev);
    },
  };
}

/* Stored options for ?auto=1; every boolean forced on for ?auto=full. The full
 * set is derived from the module's own defaults so a new step added by Track 1
 * is picked up without touching this file. The forced-on VALUES are never
 * written back to settings.automation — but the steps they switch on write
 * whatever a normal run writes, which is why 'full' asks first. */
function autoOptionsFor(mode, defaults, stored) {
  const base = { ...(defaults && typeof defaults === 'object' ? defaults : {}), ...(stored || {}) };
  if (mode !== 'full') return base;
  const shape = (defaults && Object.keys(defaults).length) ? defaults : base;
  const full = { ...base };
  for (const [k, v] of Object.entries(shape)) {
    if (typeof v === 'boolean') full[k] = true;
  }
  full.enabled = true;
  return full;
}

/* runAutomation()'s documented "someone else owns the pipeline" reply:
 * {ok:false, steps:[], files:[], labFiles:[], drafts:[], errors:['already-running']}.
 * That is not a failure of THIS run — the other caller (the upload screen's
 * panel) is doing the work and paints its own progress — so it must never
 * produce an error toast here. */
const ALREADY_RUNNING = 'already-running';

function isAlreadyRunning(res) {
  return !!(res && Array.isArray(res.steps) && res.steps.length === 0
    && Array.isArray(res.errors) && res.errors.length === 1 && res.errors[0] === ALREADY_RUNNING);
}

/* What the bus is allowed to keep: status only, no order-level data. Step
 * messages and errors are counts/lab names, never patient rows. */
function summarizeResult(res) {
  if (!res || typeof res !== 'object') return null;
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    ok: !!res.ok,
    steps: (Array.isArray(res.steps) ? res.steps : [])
      .map((s) => ({ id: s && s.id, status: s && s.status, message: (s && s.message) || '' })),
    errors: (Array.isArray(res.errors) ? res.errors : []).map(String),
    counts: { files: len(res.files), labFiles: len(res.labFiles), drafts: len(res.drafts) },
  };
}

/* ?auto=full ignores the master switch and any link can navigate here, so the
 * navigation itself is the only "consent" there would otherwise be — and the run
 * it starts writes to settings (accepted TAT suggestions, delta-baseline
 * snapshot). Ask the person at the keyboard first, and fail CLOSED: if confirm()
 * is unavailable or blocked, the full run does not happen. */
const FULL_RUN_CONFIRM = 'تشغيل آلي كامل لجميع الخطوات الآن؟\n\n'
  + 'سيتم سحب البيانات، وتوليد التقارير وملفات المختبرات ومسودات البريد (لا يُرسَل أي بريد).\n'
  + 'كما ستُحفَظ في الإعدادات مدد الفحص المقترحة ولقطة الأساس المستخدمة لمقارنة الغد.';

function confirmFullRun() {
  try {
    if (typeof window.confirm !== 'function') return false;
    return window.confirm(FULL_RUN_CONFIRM) === true;
  } catch (e) {
    console.warn('[auto] confirm() unavailable — full run refused', e);
    return false;
  }
}

async function startAutomationRun(mode, store) {
  const existing = window[AUTO_BUS_KEY];
  if (existing && existing.running) return existing; // concurrent-run guard

  // Claim the bus SYNCHRONOUSLY, before the first await. The upload screen and
  // its automation panel mount while the import below is still in flight, so
  // `window.__misbarAutoRun` has to say "a run already owns the pipeline" by the
  // time they look — otherwise both callers race for the pipeline's single-run
  // slot and the loser reports a failure that never happened. Every early return
  // releases the claim again; each of those paths is one where a panel could not
  // have started a run either (no module / master switch off / declined).
  const bus = createAutoBus(mode);
  window[AUTO_BUS_KEY] = bus;
  const release = () => {
    bus.running = false;
    bus.finishedAt = new Date().toISOString();
    if (window[AUTO_BUS_KEY] === bus) window[AUTO_BUS_KEY] = null;
  };

  let mod = null;
  try {
    mod = await import('./automation/pipeline.js?v=v2026-07-23.7');
  } catch (e) {
    console.warn('[auto] pipeline module unavailable — trigger ignored', e);
    release();
    return null;
  }
  if (!mod || typeof mod.runAutomation !== 'function') {
    console.warn('[auto] pipeline module exports no runAutomation() — trigger ignored');
    release();
    return null;
  }

  let stored = null;
  try {
    const s = store.settings;
    if (s && typeof s.automation === 'object' && s.automation) stored = s.automation;
  } catch (e) { console.warn('[auto] could not read settings.automation', e); }

  const options = autoOptionsFor(mode, mod.AUTOMATION_DEFAULTS, stored);
  if (mode !== 'full' && options.enabled === false) {
    console.info('[auto] automation is disabled in settings — nothing to run');
    toast('الأتمتة معطّلة في الإعدادات — لم يُنفَّذ أي إجراء', 'warn', 4500);
    release();
    return null;
  }
  if (mode === 'full' && !confirmFullRun()) {
    console.info('[auto] full run not confirmed — nothing was run and nothing was written');
    toast('أُلغي التشغيل الآلي الكامل', 'warn', 4000);
    release();
    return null;
  }

  bus.options = Object.freeze({ ...options });
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  if (controller) bus.abort = () => { try { controller.abort(); } catch { /* already gone */ } };
  // Nothing about a run outlives the page.
  try {
    window.addEventListener('pagehide', () => {
      bus.result = null; bus.error = null; bus.events.length = 0;
    }, { once: true });
  } catch { /* no pagehide here — the bus dies with the document anyway */ }
  fireWindowEvent(AUTO_ANNOUNCE_EVENT, bus);

  console.info('[auto] starting automation run (mode=' + mode + ')');
  toast(mode === 'full' ? 'بدء التشغيل الآلي الكامل…' : 'بدء التشغيل الآلي…', '', 3000);

  bus.promise = (async () => {
    // `res` is the only reference to the produced blobs/bytes, and it dies with
    // this closure — the bus keeps the summary, listeners get the payload.
    let res = null;
    try {
      res = await mod.runAutomation({
        store,
        state,
        ctx,
        options,
        onEvent: (ev) => {
          const e = ev && typeof ev === 'object' ? ev : { step: 'unknown', status: 'done' };
          console.info('[auto]', e.step, e.status, e.pct != null ? e.pct + '%' : '', e.message || '');
          bus.emit(e);
        },
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      bus.error = e;
      console.error('[auto] run failed', e);
    } finally {
      const already = isAlreadyRunning(res);
      bus.alreadyRunning = already;
      bus.result = already ? null : summarizeResult(res);
      bus.running = false;
      bus.finishedAt = new Date().toISOString();
      const ok = !bus.error && !already && !!(res && res.ok);
      const c = (bus.result && bus.result.counts) || {};
      // Count every artefact the run produced — the deck AND the lab workbooks
      // and drafts, all of which are saved below when autoDownload is on.
      const n = (c.files || 0) + (c.labFiles || 0) + (c.drafts || 0);
      fireWindowEvent(AUTO_DONE_EVENT, {
        ok, result: already ? null : res, summary: bus.result, alreadyRunning: already, error: bus.error,
      });
      if (already) {
        // Another caller owns the pipeline and reports its own progress; this
        // trigger has nothing to add and must not invent a failure.
        console.info('[auto] another automation run is already in flight — deferring to it');
      } else if (ok) {
        toast('اكتمل التشغيل الآلي — ' + n + ' ملف جاهز', 'ok', 5000);
      } else {
        toast('تعذّر إكمال التشغيل الآلي — راجع اللوحة', 'err', 6000);
      }
      // The pipeline downloads the report deck only; save the lab workbooks and
      // drafts too so an unattended run leaves every produced file on disk.
      if (!already && options.autoDownload) await downloadAutoExtras(res);
    }
    return bus.result; // metadata only — never the blobs/bytes
  })();

  return bus;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
let lockMod = null;

/* Fatal-boot painter — shared by boot().catch and the post-unlock start so a
 * failure after sign-in shows the same error card instead of a frozen gate. */
function paintFatal(e) {
  console.error('[boot] fatal', e);
  document.body.appendChild(el('div', { class: 'card', style: 'margin:16px' }, [
    el('div', { class: 'card__title', text: STR.common.error }),
    el('p', { text: String(e && e.message || e) }),
  ]));
}

async function boot() {
  const store = await resolveStore();

  // Access gate — when the lock module is present, EVERYTHING waits behind the
  // sign-in screen (per-user account, or the legacy shared passphrase in the
  // password field alone). Devices remember a successful sign-in plus the
  // display username; the قفل nav button signs out and re-locks.
  //
  // onUnlocked starts the app DIRECTLY with this same store instance — never
  // location.reload(). When the browser blocks localStorage (private mode,
  // "block all cookies", restrictive webviews) the store is in-memory only and
  // applyUnlock's marker write is silently swallowed, so a reload would discard
  // the just-unsealed config, land back on an empty gate, and loop a user with
  // CORRECT credentials forever. Continuing in-place works for persistent and
  // ephemeral storage alike (and drops the reload flash for everyone); the
  // ephemeral case then reaches buildShell/startApp's storage warning, which
  // tells the user the sign-in cannot be remembered on this browser.
  try {
    lockMod = await import('./ui/lock.js?v=v2026-07-23.7');
  } catch { lockMod = null; /* lock module absent — open boot (dev) */ }
  if (lockMod && typeof lockMod.isUnlocked === 'function' && !lockMod.isUnlocked(store)) {
    const root = document.getElementById('app-shell') || document.body;
    root.innerHTML = '';
    lockMod.renderLock(root, {
      store,
      onUnlocked: () => {
        // Thrown errors must not vanish into lock.js's submit handler as an
        // unhandled rejection — paint the same fatal card boot() would.
        try { startApp(store); } catch (e) { paintFatal(e); }
      },
    });
    return;
  }

  startApp(store);
}

/* Everything after the access gate: state wiring, app shell, routing, and the
 * ?auto= trigger. Extracted from boot() so a successful sign-in can start the
 * app in-place with the live store instead of reloading (see the gate note). */
function startApp(store) {
  state.settings = store.settings;

  // TAT-lookup Excel merge hook consumed by the settings screen (Track C).
  state.onTatFileMerge = async (file) => {
    const [{ getXLSX }, { parseTatLookupXlsx }] = await Promise.all([
      import('./vendor-loader.js?v=v2026-07-23.7'),
      import('./ingest/xlsx.js?v=v2026-07-23.7'),
    ]);
    const XLSX = await getXLSX();
    const { tests } = parseTatLookupXlsx(await file.arrayBuffer(), XLSX);
    const doc = store.loadSettings();
    doc.tatLookup = doc.tatLookup || {};
    let added = 0, updated = 0;
    for (const [name, days] of Object.entries(tests || {})) {
      if (!(name in doc.tatLookup)) added++;
      else if (doc.tatLookup[name] !== days) updated++;
      doc.tatLookup[name] = days;
    }
    store.saveSettings(doc);
    state.settings = store.settings;
    return { added, updated };
  };

  // Connection test consumed by the settings screen's اختبار الاتصال button.
  state.onGrafanaTest = async () => {
    try {
      const mod = await import('./ingest/grafana.js?v=v2026-07-23.7');
      const g = store.loadSettings().grafana || {};
      const now = Date.now();
      const res = await mod.fetchKamcOrders(g, { fromMs: now - 7 * 86400000, toMs: now });
      return { ok: true, rows: res.rows.length };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };

  ctx = { state, store, navigate, rerender };

  buildShell(store);

  // Route from ?screen= if provided (dev convenience), else upload. An ?auto=
  // trigger always lands on upload — that is where Track 2's progress panel is.
  const params = new URLSearchParams(location.search);
  const autoMode = readAutoMode(params);
  const start = params.get('screen');
  state.screen = autoMode ? 'upload' : ((start && SCREEN_MODULES[start]) ? start : 'upload');

  // Fire-and-forget: the trigger must never be able to break boot. It runs
  // BEFORE renderScreen() on purpose — startAutomationRun claims the bus
  // synchronously, so by the time the upload screen (and its automation panel)
  // is imported, `window.__misbarAutoRun` already shows this run owns the
  // pipeline and nothing can start a competing one.
  if (autoMode) {
    startAutomationRun(autoMode, store).catch((e) => console.warn('[auto] trigger failed', e));
  }

  renderScreen();

  if (!store.persistent) {
    toast(STR.storage.warn, 'warn', 4000);
  }
}

boot().catch(paintFatal);
