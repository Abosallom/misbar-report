// ui/late-labs-section.js — shared per-lab "TAT Late & Due" Excel export section.
// Extracted from screen-generate so BOTH the generate results screen AND the
// upload screen (the moment order data lands) can offer the exact same UI:
// per-lab تنزيل / نسخ نص البريد / تنزيل الكل, with identical wording, counting
// basis, empty-state, and the sanitized triggerDownload helper. Built from the
// SAME dataset a generate run uses (order rows + TAT lookup + an as-of instant),
// so it works in live-snapshot mode and on the upload screen too.
import { el, toast } from './components.js?v=v2026-08-05.1';
import { todayISO } from '../i18n/ar.js?v=v2026-08-05.1';
import { buildLateLabWorkbooks } from '../export/late-labs.js?v=v2026-08-05.1';
import { parseDateTime } from '../engine/workday.js?v=v2026-08-05.1';
// The English email template the team pastes when notifying a lab — VERBATIM
// wording, now owned by export/eml-draft.js so the clipboard text and the .eml
// draft body can never drift apart. buildLabEmailDraft only PREPARES a draft
// file: nothing here sends mail — the user opens it in Outlook and presses Send.
import { buildLabEmailDraft, labEmailText } from '../export/eml-draft.js?v=v2026-08-05.1';

// Copy text to the clipboard with an execCommand fallback (keeps user activation
// on browsers where navigator.clipboard is unavailable). Mirrors buildShareCard.
async function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return fallback();
}

// Trigger a browser download for a blob. Lab names come from CSV data — strip path
// separators and other filesystem-illegal characters before using them as a name.
// Exported so screen-generate reuses this single sanitized copy for its own files.
export function triggerDownload(blob, name) {
  const safe = String(name).replace(/[/\\<>:"|?*\u0000-\u001f]/g, '-');
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: safe });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); }, 4000);
  return url;
}

// Per-lab "Late & Due" Excel export section. Built from the SAME dataset a generate
// run uses (order rows + settings.tatLookup + an as-of instant), so it works in
// live-snapshot mode and on the upload screen. Returns a DOM node, or the empty
// state card. asOf resolves from `asOfMs` (epoch-ms) when given — the upload screen
// passes Date.now() — else from `reportDate` (the generate screen passes the report
// date); only the calendar day of the as-of instant affects classification.
// `labRecipients` is OPTIONAL (callers that omit it behave exactly as before): a
// { [labName]: string | string[] } map — normally store.settings.automation
// .labRecipients — used ONLY to pre-fill the To: line of a downloaded .eml draft.
// No address is ever contacted from here; drafts are files the user sends by hand.
export async function buildLateLabsSection({
  rows, tatTests, reportDate, asOfMs, labRecipients,
} = {}) {
  const title = 'ملفات المختبرات — المتأخر والمستحق (Excel)';
  const orderRows = rows || null;
  const tests = tatTests || {};
  const ms = (asOfMs != null && Number.isFinite(Number(asOfMs)))
    ? Number(asOfMs)
    : parseDateTime(reportDate || todayISO());

  const emptyCard = (msg) => el('div', { class: 'card', style: 'margin-top:16px;text-align:right' }, [
    el('div', { class: 'card__title', text: title }),
    el('p', { class: 'small muted', style: 'margin:0', text: msg }),
  ]);

  if (!orderRows || !orderRows.length || ms == null) return emptyCard('لا توجد فحوصات متأخرة أو مستحقة خلال 24 ساعة ✅');

  let wbs = [];
  try {
    wbs = buildLateLabWorkbooks({ rows: orderRows, tatTests: tests, asOfMs: ms });
  } catch (e) {
    console.warn('[late-labs] build failed', e);
    return emptyCard('تعذّر إنشاء ملفات المختبرات.');
  }
  if (!wbs.length) return emptyCard('لا توجد فحوصات متأخرة أو مستحقة خلال 24 ساعة ✅');

  const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const downloadOne = (w) => {
    triggerDownload(new Blob([w.xlsxBytes], { type: SHEET_MIME }), w.fileName);
  };

  // Recipients are optional and fully guarded: a missing/!object map, a missing
  // lab key, or a non-string value simply means the draft carries no To: line.
  const recipientsFor = (lab) => {
    const map = labRecipients;
    if (!map || typeof map !== 'object') return null;
    const v = map[lab];
    if (Array.isArray(v)) return v;
    return typeof v === 'string' && v.trim() ? v : null;
  };

  // Download ONE lab's Outlook draft. This only writes a file to disk — no mail
  // is sent, no address is contacted; the user reviews it in Outlook and sends.
  const downloadDraft = (w) => {
    try {
      const d = buildLabEmailDraft({
        lab: w.lab,
        fileName: w.fileName,
        xlsxBytes: w.xlsxBytes,
        recipients: recipientsFor(w.lab),
        reportDate,
      });
      triggerDownload(d.blob, d.fileName);
      return true;
    } catch (e) {
      console.warn('[late-labs] draft failed', e);
      toast('تعذّر إنشاء مسودة البريد', 'err');
      return false;
    }
  };

  const labRows = wbs.map((w) => el('div', { class: 'dl-link', style: 'flex-wrap:wrap;gap:8px' }, [
    el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1' }, [
      // Lab names come from the CSV and are Arabic OR Latin ('NUPCO', 'مختبر …').
      // A hard dir=ltr blockified this stretched flex item to text-align:left, so an
      // ARABIC lab name sat left-aligned above its right-aligned counts line. Keep the
      // inherited RTL alignment and isolate instead, so either script reads correctly
      // and both lines share the same (right) edge.
      el('span', { style: 'font-weight:600;overflow-wrap:anywhere;unicode-bidi:isolate', text: w.lab }),
      el('span', { class: 'small muted' }, [
        'فحص متأخر: ', el('span', { dir: 'ltr', text: String(w.late) }),
        ' • مستحق خلال ٢٤ ساعة: ', el('span', { dir: 'ltr', text: String(w.dueSoon) }),
      ]),
    ]),
    // The action group MUST wrap and shrink: three buttons are 433px at their
    // natural size, wider than the row's 283px content box at a 375px viewport.
    // Pinned (flex-shrink:0, no wrap) the third button overflowed the RTL
    // inline-start edge to x=-104 with no scrollbar — physically untappable on a
    // phone. Wrapping keeps every button in-bounds down to 320px and leaves the
    // desktop layout byte-identical (the group still sits on one line at ≥441px).
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;min-width:0' }, [
      el('button', {
        class: 'btn btn--ghost', text: '⬇ تنزيل',
        onClick: () => downloadOne(w),
      }),
      el('button', {
        class: 'btn btn--ghost', text: '✉ نسخ نص البريد',
        onClick: async () => { if (await copyText(labEmailText(w.lab))) toast('تم نسخ نص البريد', 'ok'); },
      }),
      el('button', {
        // U+2066…U+2069 (LRI…PDI): without the isolate the '.' — a neutral between an
        // Arabic run and the Latin 'eml' — resolves to the RTL paragraph level and the
        // group renders '(eml.)'. Inside the isolate it renders '(.eml)' as authored.
        class: 'btn btn--ghost', text: '✉ مسودة بريد ⁦(.eml)⁩',
        title: 'ينزّل مسودة Outlook بالمرفق — لا يُرسل البريد، أنت من يضغط إرسال',
        onClick: () => { if (downloadDraft(w)) toast('تم تنزيل المسودة — افتحها في Outlook وأرسلها بنفسك', 'ok'); },
      }),
    ]),
  ]));

  const children = [
    el('div', { class: 'card__title', text: title }),
    el('p', { class: 'small muted', style: 'margin:0 0 4px', text: 'الأعداد بعدد الفحوصات (سطور الطلبات) وليس بعدد الطلبات.' }),
    ...labRows,
  ];
  if (wbs.length > 1) {
    children.push(el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
      el('button', {
        class: 'btn btn--primary', style: 'flex:1 1 160px', text: 'تنزيل الكل',
        // Sequential downloads ~300ms apart so browsers don't drop stacked clicks.
        onClick: async () => {
          for (let i = 0; i < wbs.length; i++) {
            downloadOne(wbs[i]);
            if (i < wbs.length - 1) await new Promise((r) => setTimeout(r, 300));
          }
        },
      }),
      el('button', {
        class: 'btn btn--ghost', style: 'flex:1 1 160px', text: 'تنزيل كل المسودات',
        title: 'ينزّل مسودة Outlook لكل مختبر — لا يُرسل أي بريد',
        // Same 300ms spacing; each draft is just a downloaded file, never sent.
        onClick: async () => {
          let ok = 0;
          for (let i = 0; i < wbs.length; i++) {
            if (downloadDraft(wbs[i])) ok += 1;
            if (i < wbs.length - 1) await new Promise((r) => setTimeout(r, 300));
          }
          if (ok) toast('تم تنزيل المسودات — راجعها في Outlook وأرسلها بنفسك', 'ok');
        },
      }),
    ]));
  }
  return el('div', { class: 'card', style: 'margin-top:16px;text-align:right' }, children);
}

export default buildLateLabsSection;
