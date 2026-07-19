// main.js — boot, settings store, top app bar, and screen router (Track E).
import { state } from './state.js';
import { STR } from './i18n/ar.js';
import { el, toast } from './ui/components.js';
import { SETTINGS_KEY } from './contracts.js';
import { TAT_LOOKUP } from './seeds/tat-lookup.js';
import { SCORECARD_SEED } from './seeds/scorecard.js';
import { HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED } from './seeds/defaults.js';

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
      grafana: { ...seed.grafana, ...(s.grafana || {}) },
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
    const mod = await import('./store.js');
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
  upload: './ui/screen-upload.js',
  review: './ui/screen-review.js',
  generate: './ui/screen-generate.js',
  settings: './ui/screen-settings.js', // Track C
};

let appEl = null;
let navHome = null;
let navSettings = null;
let ctx = null;

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

function buildShell(store) {
  const root = document.getElementById('app-shell') || document.body;

  const logo = el('img', { class: 'appbar__logo', src: 'assets/icon.svg', alt: '' });
  navHome = el('button', { class: 'navbtn', text: STR.nav.home, onClick: goHome });
  navSettings = el('button', { class: 'navbtn', text: STR.nav.settings, onClick: () => navigate('settings') });

  const bar = el('header', { class: 'appbar' }, [
    el('div', { class: 'appbar__brand' }, [logo, el('div', { class: 'appbar__title', text: STR.appTitle })]),
    el('div', { class: 'appbar__spacer' }),
    el('nav', { class: 'appbar__nav' }, [navHome, navSettings]),
  ]);

  const storageWarn = el('div', { class: 'storage-warn', text: STR.storage.warn });
  storageWarn.hidden = store.persistent;

  appEl = el('main', { id: 'app' });

  root.innerHTML = '';
  root.append(bar, storageWarn, appEl);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
async function boot() {
  const store = await resolveStore();
  state.settings = store.settings;

  // TAT-lookup Excel merge hook consumed by the settings screen (Track C).
  state.onTatFileMerge = async (file) => {
    const [{ getXLSX }, { parseTatLookupXlsx }] = await Promise.all([
      import('./vendor-loader.js'),
      import('./ingest/xlsx.js'),
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
      const mod = await import('./ingest/grafana.js');
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

  // Route from ?screen= if provided (dev convenience), else upload.
  const params = new URLSearchParams(location.search);
  const start = params.get('screen');
  state.screen = (start && SCREEN_MODULES[start]) ? start : 'upload';

  renderScreen();

  if (!store.persistent) {
    toast(STR.storage.warn, 'warn', 4000);
  }
}

boot().catch((e) => {
  console.error('[boot] fatal', e);
  document.body.appendChild(el('div', { class: 'card', style: 'margin:16px' }, [
    el('div', { class: 'card__title', text: STR.common.error }),
    el('p', { text: String(e && e.message || e) }),
  ]));
});
