// ui/late-labs-section.js — shared per-lab "TAT Late & Due" Excel export section.
// Extracted from screen-generate so BOTH the generate results screen AND the
// upload screen (the moment order data lands) can offer the exact same UI:
// per-lab تنزيل / نسخ نص البريد / تنزيل الكل, with identical wording, counting
// basis, empty-state, and the sanitized triggerDownload helper. Built from the
// SAME dataset a generate run uses (order rows + TAT lookup + an as-of instant),
// so it works in live-snapshot mode and on the upload screen too.
import { el, toast } from './components.js?v=v2026-07-22.10';
import { todayISO } from '../i18n/ar.js?v=v2026-07-22.10';
import { buildLateLabWorkbooks } from '../export/late-labs.js?v=v2026-07-22.10';
import { parseDateTime } from '../engine/workday.js?v=v2026-07-22.10';

// English email template the team pastes when notifying a lab — verbatim wording.
function labEmailText(lab) {
  const subject = `${lab} | Late Test Results — Action Required`;
  const body = [
    'Dear all,',
    'This is a reminder regarding laboratory orders that require your attention.',
    'Some orders in the attached report are approaching their SLA deadline and will breach within the next 24 hours. These are flagged for priority and should be actioned urgently to avoid an SLA breach.',
    'Please confirm once the listed orders have been addressed. If you have any questions or are facing issues preventing fulfillment, let us know so we can support you.',
    'Please find the attachment for more info about the orders.',
    'Thank you for your cooperation.',
  ].join('\n\n');
  return `Subject: ${subject}\n\n${body}`;
}

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
export async function buildLateLabsSection({ rows, tatTests, reportDate, asOfMs } = {}) {
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

  const labRows = wbs.map((w) => el('div', { class: 'dl-link', style: 'flex-wrap:wrap;gap:8px' }, [
    el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1' }, [
      el('span', { dir: 'ltr', style: 'font-weight:600;overflow-wrap:anywhere', text: w.lab }),
      el('span', { class: 'small muted' }, [
        'فحص متأخر: ', el('span', { dir: 'ltr', text: String(w.late) }),
        ' • مستحق خلال ٢٤ ساعة: ', el('span', { dir: 'ltr', text: String(w.dueSoon) }),
      ]),
    ]),
    el('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, [
      el('button', {
        class: 'btn btn--ghost', text: '⬇ تنزيل',
        onClick: () => downloadOne(w),
      }),
      el('button', {
        class: 'btn btn--ghost', text: '✉ نسخ نص البريد',
        onClick: async () => { if (await copyText(labEmailText(w.lab))) toast('تم نسخ نص البريد', 'ok'); },
      }),
    ]),
  ]));

  const children = [
    el('div', { class: 'card__title', text: title }),
    el('p', { class: 'small muted', style: 'margin:0 0 4px', text: 'الأعداد بعدد الفحوصات (سطور الطلبات) وليس بعدد الطلبات.' }),
    ...labRows,
  ];
  if (wbs.length > 1) {
    children.push(el('button', {
      class: 'btn btn--primary btn--block', style: 'margin-top:10px', text: 'تنزيل الكل',
      // Sequential downloads ~300ms apart so browsers don't drop stacked clicks.
      onClick: async () => {
        for (let i = 0; i < wbs.length; i++) {
          downloadOne(wbs[i]);
          if (i < wbs.length - 1) await new Promise((r) => setTimeout(r, 300));
        }
      },
    }));
  }
  return el('div', { class: 'card', style: 'margin-top:16px;text-align:right' }, children);
}

export default buildLateLabsSection;
