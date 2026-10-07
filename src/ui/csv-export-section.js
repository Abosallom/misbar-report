// ui/csv-export-section.js — the OPTIONAL «filtered CSV» download on the upload screen.
//
// WHAT IT DOES. The operator ticks one or more labs (or «كل المختبرات») and one or more
// order stages (or «كل المراحل») and downloads THEIR OWN uploaded rows — every column of
// the file, in the file's column order, values exactly as parsed — cut down to the
// matching order lines. The rules (what a stage is, how labs match, how the file is
// written) all live in model/csv-filter.js; this file only collects the choice, shows
// the counts, and hands the produced text to the browser as a download. It never
// computes a stage or a lab match itself, so the chips' counts, the live line and the
// file can never disagree.
//
// PRIVACY POSTURE — the one surface that hands patient columns back out. The original
// rows (state.parsed.raw: name, national id, MRN …) exist in memory only, and they leave
// the browser ONLY as the file the user explicitly clicks to download. So, here:
//   • rows are never logged — a failure logs its message, never a record or a row;
//   • the selection lives in this section's closure, nowhere else (no settings, no
//     localStorage, no state field) — it is a one-off tool, not a preference;
//   • the object URL of a produced file is revoked shortly after the click, so the
//     patient-bearing Blob is not kept addressable for the rest of the session;
//   • the privacy line sits next to the button, every time.
//
// RAW MUST BELONG TO THESE ORDERS. raw.records[order.lineNo] is an order's original
// record, so a raw left over from an earlier upload next to different orders would
// export OTHER PATIENTS' rows under these orders' filter. state.js already resets raw
// with every non-CSV source; this section does not take that on trust, it CHECKS it
// (rawBelongsTo: every order's record exists and carries its Order ID) and, when the
// pair does not hold, offers nothing but the noRaw note — the same note the live pull /
// encrypted snapshot get, since neither carries patient columns at all. And because the
// section can outlive the data it was built from (an upload, a re-pull, a reset under an
// open screen), the download click and the card's opening both re-check that the live
// state still holds the SAME orders and raw; if not, the card rebuilds itself from the
// live state (selection reset) and says so, rather than export from a stale snapshot.
//
// STAGES ARE A LADDER. notCollected → notShipped → notReceived → notResulted → resulted
// is the order's procedure, and the user's rule is that the ticked ladder stages must be
// NEIGHBOURS (no "not shipped + not resulted" with "not received" left out). The section
// makes a gap IMPOSSIBLE to create: a ladder chip csv-filter's canToggle refuses is
// DISABLED (its title — and the visible hint under the chips — says why), so only a
// run's ends can be removed and only its neighbours added. «مرفوضة» / «ملغاة» are decided
// by status, outside the ladder, and toggle freely. filterOrders also throws on a gap,
// as a second wall; here a throw is treated as "nothing to download", never a file.
//
// Collapsed by default: the daily flow is the report, this is an occasional tool.
// Strings come ONLY from STR.upload.csvExport.
import { el, toast } from './components.js?v=v2026-10-07.1';
import { STR, todayISO } from '../i18n/ar.js?v=v2026-10-07.1';
// The ONE sanitized download helper (filesystem-illegal characters stripped from the
// name) — shared with the late-labs and generate screens rather than re-implemented.
import { triggerDownload } from './late-labs-section.js?v=v2026-10-07.1';
// Papa the way the upload screen gets it: the eager <script> tag's window.Papa, with
// getPapa's one-tick fallback. Never imported from vendor/ any other way.
import { getPapa } from '../vendor-loader.js?v=v2026-10-07.1';
import {
  LADDER, STATUS_STAGES, canToggle, stageCounts, labCounts, filterOrders,
  buildFilteredCsv, filteredFileName,
} from '../model/csv-filter.js?v=v2026-10-07.1';

const S = STR.upload.csvExport;

/** Every stage key in display order: the ladder in procedure order, then the two
 *  status stages. The selection is ALWAYS kept in this order, so whatever reads it
 *  (isContiguous inside filterOrders, canToggle) sees ladder keys in ladder order. */
const STAGE_ORDER = Object.freeze([...LADDER, ...STATUS_STAGES]);

/** How long a produced file's object URL stays alive after the click. Long enough for
 *  the slowest browser to start the download (revoking too early cancels it in some),
 *  short enough that the patient-bearing Blob does not outlive the moment. */
const REVOKE_AFTER_MS = 60000;

/* The chip look of the review screen's «نطاق التقرير» card (screen-review.js
 * scopeChipStyle): a SELECTION, so an unchosen chip is a plain outline — never the slide
 * toggles' strike-through, which reads as "removed". `disabled` adds the dimmed,
 * not-allowed look of a ladder chip that would open a gap. */
const chipStyle = (on, disabled) => 'display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 12px;font-weight:700;font-size:.82rem;cursor:pointer;min-height:36px;line-height:1.3;max-width:100%;text-align:start;'
  + (on
    ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
    : 'background:var(--white);color:var(--slate-600);border:1px solid var(--border-dark);')
  + (disabled ? 'opacity:.45;cursor:not-allowed;' : '');
const COUNT_STYLE = 'font-size:.72rem;font-weight:700;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.2);unicode-bidi:isolate';
const NOTE_STYLE = 'margin:0;padding:8px 12px;border-radius:6px;overflow-wrap:anywhere;background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A)';
const PRIVACY_STYLE = 'margin:8px 0 0;display:flex;gap:6px;align-items:flex-start;font-weight:600;color:var(--warn-text,#92400E)';

/**
 * Is `raw` the parse of THESE orders? Every order needs its own original record at
 * raw.records[lineNo], carrying the same Order ID (ingest/csv.js trims it into orderId).
 * One O(n) pass at build time; cheap next to the parse that produced both.
 * @param {*} raw
 * @param {Object[]} orders
 * @returns {boolean}
 */
function rawBelongsTo(raw, orders) {
  if (!raw || !Array.isArray(raw.fields) || !raw.fields.length || !Array.isArray(raw.records)) return false;
  for (const o of orders) {
    const rec = o && Number.isInteger(o.lineNo) ? raw.records[o.lineNo] : null;
    if (!rec || typeof rec !== 'object') return false;
    if (String(rec['Order ID'] ?? '').trim() !== String(o.orderId ?? '')) return false;
  }
  return true;
}

/**
 * One chip: a pressed-state button with an optional count pill. Returns the button and
 * setters, so the section updates chips IN PLACE — rebuilding them on every click would
 * drop keyboard focus from the chip the operator just pressed.
 * @param {string} label
 * @param {number|null} count  null = no pill (the «كل …» chips: the absence of a filter)
 */
function makeChip(label, count) {
  const countEl = count == null ? null : el('span', { dir: 'ltr', style: COUNT_STYLE, text: String(count) });
  const btn = el('button', { type: 'button', 'aria-pressed': 'false', style: chipStyle(false, false) }, [
    el('span', { dir: 'auto', text: label }),
    countEl,
  ]);
  // One spoken name for the two visual parts (a Latin lab name + its count pill).
  const setCount = (n) => {
    if (!countEl) { btn.setAttribute('aria-label', label); return; }
    countEl.textContent = String(n);
    btn.setAttribute('aria-label', `${label} (${n})`);
  };
  setCount(count);
  const setState = (on, disabled = false) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.disabled = !!disabled;
    btn.style.cssText = chipStyle(on, disabled);
  };
  return { btn, setCount, setState };
}

/**
 * The optional filtered-CSV card for the upload screen.
 * Reads state.parsed.orders (the OrderRow[] every surface uses), state.parsed.raw (the
 * uploaded file's own rows — null for every non-CSV source) and state.files.csv?.name
 * (the downloaded file is named after it).
 * @param {Object} state  the app state (src/state.js shape)
 * @returns {HTMLElement|null} a collapsed <details> card, or null when there are no orders
 */
export function buildCsvExportSection(state) {
  const parsed = (state && state.parsed) || {};
  const orders = Array.isArray(parsed.orders) ? parsed.orders : null;
  if (!orders || !orders.length) return null;
  const raw = parsed.raw ?? null;
  const usable = rawBelongsTo(raw, orders);

  // The live state no longer holds what this card was built from (see header).
  const isStale = () => {
    const p = (state && state.parsed) || {};
    return p.orders !== orders || (p.raw ?? null) !== raw;
  };

  const chevron = el('span', {
    'aria-hidden': 'true', text: '▾',
    style: 'margin-inline-start:auto;font-size:1.15rem;line-height:1;color:var(--slate-500)',
  });
  const summary = el('summary', {
    style: 'cursor:pointer;list-style:none;display:flex;flex-direction:column;gap:2px',
  }, [
    el('div', { class: 'card__title', style: 'margin:0' }, [el('span', { text: S.title }), chevron]),
    el('p', { class: 'small muted', style: 'margin:0', text: S.hint }),
  ]);
  const body = el('div', { style: 'margin-top:14px' });
  const card = el('details', { class: 'card csv-export-card', style: 'text-align:right' }, [summary, body]);

  // Rebuild from the live state (selection reset), keep it open, and say why.
  const rebuild = () => {
    const fresh = buildCsvExportSection(state);
    if (fresh) { fresh.open = true; card.replaceWith(fresh); } else card.remove();
    toast(S.stale, 'warn', 6000);
  };
  card.addEventListener('toggle', () => {
    chevron.textContent = card.open ? '▴' : '▾';
    if (card.open && isStale()) rebuild();
  });

  // No (matching) original rows → nothing to hand back: the note replaces the whole
  // selection, so there is not even a button to press.
  if (!usable) {
    body.appendChild(el('p', { class: 'small', style: NOTE_STYLE, text: S.noRaw }));
    return card;
  }

  let labs = [];   // [] = «كل المختبرات» (no lab filter); normFacility names from labCounts
  let stages = []; // [] = «كل المراحل»; always in STAGE_ORDER (see above)

  /* ---- labs: «كل المختبرات» is the ABSENCE of a lab filter — lit exactly when no lab
   * is chosen; choosing a lab turns it off, un-choosing the last lab turns it back on.
   * Lab list + counts are over ALL orders and do not move with the stage choice. */
  const allLabsChip = makeChip(S.allLabs, null);
  allLabsChip.btn.addEventListener('click', () => { labs = []; refresh(); });
  // Guarded like every csv-filter call here: this card is an optional extra, and a
  // throw out of the builder would take the whole upload screen's paint() down with it.
  let labList = [];
  try { labList = labCounts(orders); } catch { labList = []; }
  const labChips = labList.map(({ lab, count }) => {
    const c = makeChip(lab, count);
    c.btn.addEventListener('click', () => {
      labs = labs.includes(lab) ? labs.filter((l) => l !== lab) : [...labs, lab];
      refresh();
    });
    return { lab, ...c };
  });

  /* ---- stages: the same «all» semantics; the counts follow the chosen labs. */
  const allStagesChip = makeChip(S.allStages, null);
  allStagesChip.btn.addEventListener('click', () => { stages = []; refresh(); });
  const stageChips = STAGE_ORDER.map((key) => {
    const c = makeChip(S.stage[key], 0);
    c.btn.addEventListener('click', () => {
      // The disabled attribute already blocks this; the check keeps a programmatic
      // click (or a stale enabled state) from ever opening a gap.
      if (!canToggle(stages, key)) return;
      const next = new Set(stages);
      if (next.has(key)) next.delete(key); else next.add(key);
      stages = STAGE_ORDER.filter((k) => next.has(k));
      refresh();
    });
    return { key, ladder: LADDER.includes(key), ...c };
  });

  const countLine = el('div', { class: 'small', 'aria-live': 'polite', style: 'font-weight:700;color:var(--slate-600)' });
  const downloadBtn = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: S.download });

  /** The matching ORIGINAL order rows, or null when the filter refuses the choice. */
  const matches = () => {
    try { return filterOrders(orders, { labs, stages }); } catch { return null; }
  };

  function refresh() {
    allLabsChip.setState(!labs.length);
    for (const c of labChips) c.setState(labs.includes(c.lab));

    let counts = null;
    try { counts = stageCounts(orders, labs); } catch { counts = null; }
    allStagesChip.setState(!stages.length);
    for (const c of stageChips) {
      // A ladder chip that would open a gap (adding a non-neighbour, removing a middle
      // stage) is disabled; its title carries the reason for a pointer user.
      const allowed = !c.ladder || canToggle(stages, c.key);
      c.setState(stages.includes(c.key), !allowed);
      c.btn.title = allowed ? '' : S.contiguityHint;
      c.setCount(counts && Number.isFinite(counts[c.key]) ? counts[c.key] : 0);
    }

    const m = matches();
    const n = m ? m.length : 0;
    countLine.textContent = S.count(n);
    downloadBtn.disabled = n === 0;
  }

  downloadBtn.addEventListener('click', async () => {
    if (isStale()) { rebuild(); return; }
    const matched = matches();
    if (!matched || !matched.length) { refresh(); return; }
    downloadBtn.disabled = true;
    try {
      // window.Papa first, SYNCHRONOUSLY (no await before the download in the normal
      // case, so the click's user activation still covers it); getPapa only as fallback.
      const Papa = window.Papa || await getPapa();
      if (!Papa || typeof Papa.unparse !== 'function') throw new Error('PapaParse unavailable');
      const text = buildFilteredCsv(raw, matched, Papa);
      // Named after the file THESE rows came from (raw.fileName, set with raw on upload)
      // — never the live state.files.csv, which a newer upload may already have taken.
      const name = filteredFileName((raw && raw.fileName) || '', todayISO());
      const url = triggerDownload(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }, REVOKE_AFTER_MS);
    } catch (e) {
      // The message only — an error object could carry a record in its context.
      console.warn('[csv-export] download failed:', (e && e.message) || 'unknown error');
      toast(S.failed, 'err');
    } finally {
      refresh(); // re-enables the button from the live count
    }
  });

  const chipRow = (label, chips) => el('div', {
    role: 'group', 'aria-label': label, style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center',
  }, chips);
  // The ladder and the two status stages are different kinds of choice; a thin rule
  // between them says so without another heading.
  const divider = el('span', {
    'aria-hidden': 'true', style: 'width:1px;align-self:stretch;min-height:24px;background:var(--border-dark);margin:0 4px',
  });

  body.append(
    el('div', { class: 'field', style: 'margin:0 0 16px' }, [
      el('label', { text: S.labs }),
      chipRow(S.labs, [allLabsChip.btn, ...labChips.map((c) => c.btn)]),
    ]),
    el('div', { class: 'field', style: 'margin:0 0 16px' }, [
      el('label', { text: S.stages }),
      chipRow(S.stages, [
        allStagesChip.btn,
        ...stageChips.filter((c) => c.ladder).map((c) => c.btn),
        divider,
        ...stageChips.filter((c) => !c.ladder).map((c) => c.btn),
      ]),
      el('div', { class: 'hint', text: S.contiguityHint }),
    ]),
    el('div', {
      style: 'display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--border)',
    }, [downloadBtn, countLine]),
    el('p', { class: 'small', style: PRIVACY_STYLE }, [
      el('span', { 'aria-hidden': 'true', text: '⚠' }),
      el('span', { text: S.privacy }),
    ]),
  );
  refresh();
  return card;
}

export default buildCsvExportSection;
