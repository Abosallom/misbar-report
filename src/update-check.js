// update-check.js — detect that a NEWER build is deployed and offer a reload.
//
// WHY THIS EXISTS: index.html is the one unversioned file in the app. Every
// module URL inside it carries ?v=<APP_VERSION>, so the module graph busts
// together — but only once the browser re-reads index.html itself. GitHub Pages
// serves it with max-age=600 and an installed (home-screen) web app can hold it
// far longer, so a user can sit on a stale build indefinitely while every
// deploy lands correctly on the server. The version chip then says one thing
// and the running code is another, which is exactly how a fix looks "not
// deployed" to the person waiting for it.
//
// HOW: version.json sits next to index.html, is written by scripts/stamp-version
// from the same APP_VERSION constant, and is fetched with cache:'no-store' so
// the check itself can never be answered from the stale cache. A difference
// means a deploy happened since this tab loaded.
//
// PURE-ish: no DOM. The caller supplies what to do on a hit, so `node --test`
// drives this with a fake fetch and a fake clock.

/** Where the deployed version is published, relative to index.html. */
export const VERSION_URL = 'version.json';

/** Don't re-check more often than this (ms) — visibility flaps on mobile. */
export const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** A version string is only actionable if it is a non-empty, sane token. */
function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[\w.\-+]{1,64}$/.test(s) ? s : '';
}

/**
 * Fetch the deployed version. Returns '' on ANY failure — offline, 404, HTML
 * error page, malformed JSON. A broken check must never surface as a banner or
 * an error; the app simply carries on with what it has.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} [url]
 * @returns {Promise<string>}
 */
export async function fetchDeployedVersion(fetchImpl, url = VERSION_URL) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
    if (!res || !res.ok) return '';
    const body = await res.json();
    return clean(body && body.version);
  } catch {
    return '';
  }
}

/**
 * True when `deployed` names a build different from the one running. Equality,
 * not ordering: a rollback is just as much a reason to reload as a roll-forward,
 * and version strings here are dates, which do not compare reliably as text.
 */
export function isUpdateAvailable(current, deployed) {
  const c = clean(current), d = clean(deployed);
  return Boolean(c && d && c !== d);
}

/**
 * The URL to load to ESCAPE a cached index.html: same page, plus ?v=<version>.
 * A plain reload can be served from cache and would loop the banner forever;
 * a distinct URL is a distinct cache entry, so this is guaranteed to re-fetch.
 * Any existing v= is replaced rather than appended.
 */
export function reloadUrlFor(version, href) {
  const u = new URL(href);
  u.searchParams.set('v', clean(version) || String(Date.now()));
  return u.toString();
}

/**
 * Watch for a newer deploy: once at start, then whenever the tab becomes
 * visible again (throttled to MIN_INTERVAL_MS). `onUpdate(version)` fires at
 * most once — the banner it raises stays until the user acts on it.
 *
 * @returns {() => void} stop function (removes the listener)
 */
export function startUpdateWatch({
  current, onUpdate, fetchImpl, doc, now = () => Date.now(), url = VERSION_URL,
} = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!f || !clean(current)) return () => {};

  let last = 0;
  let fired = false;
  let stopped = false;

  const run = async () => {
    if (stopped || fired) return;
    const t = now();
    if (last && t - last < MIN_INTERVAL_MS) return;
    last = t;
    const deployed = await fetchDeployedVersion(f, url);
    if (stopped || fired) return;
    if (isUpdateAvailable(current, deployed)) {
      fired = true;
      try { onUpdate(deployed); } catch { /* a broken banner must not break boot */ }
    }
  };

  const onVis = () => { if (!d || d.visibilityState === 'visible') run(); };
  if (d && typeof d.addEventListener === 'function') d.addEventListener('visibilitychange', onVis);
  run();

  return () => {
    stopped = true;
    if (d && typeof d.removeEventListener === 'function') d.removeEventListener('visibilitychange', onVis);
  };
}

export default startUpdateWatch;
