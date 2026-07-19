// ui/screen-settings.js — Track C settings screen (Arabic RTL, vanilla DOM).
// Screen-module contract: export render(container, ctx) where
//   ctx = { state, store, navigate(screenId), rerender() }.
// Every edit autosaves immediately through ctx.store.saveSettings and flashes a
// subtle 'تم الحفظ' toast. Six tabs: TAT durations, lab readiness scorecard,
// historical constants, previous-report snapshot, live source (Grafana +
// cached-tracker), and backup (export/import).

import { SNAPSHOT_SEED } from '../seeds/defaults.js';

const TABS = [
  { id: 'tat', label: 'مدة الفحوصات' },
  { id: 'labs', label: 'جاهزية المختبرات' },
  { id: 'const', label: 'ثوابت تاريخية' },
  { id: 'snapshot', label: 'لقطة التقرير السابق' },
  { id: 'grafana', label: 'الاتصال المباشر' },
  { id: 'backup', label: 'نسخ احتياطي' },
];

// Shown after any failed live-connection test. The public GitHub Pages origin the
// dashboard is served from must be allow-listed by the Grafana admin for CORS.
const CORS_HINT =
  'إذا كان الخطأ بسبب CORS فيجب على مسؤول Grafana السماح للنطاق https://abosallom.github.io';

// Deterministic 'YYYY-MM-DD HH:MM' formatter — avoids locale drift across browsers.
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Editable snapshot numbers (E6): the full previous-report figure set, in the
// order EngineOutput.deltas exposes them. Labels are Arabic, RTL-friendly.
const SNAPSHOT_FIELDS = [
  { key: 'total', label: 'إجمالي الطلبات' },
  { key: 'collected', label: 'تم السحب' },
  { key: 'dispatched', label: 'تم الإرسال' },
  { key: 'received', label: 'تم الاستلام' },
  { key: 'completed', label: 'نتائج مكتملة' },
  { key: 'awaitingDispatch', label: 'بانتظار الإرسال' },
  { key: 'shippedNotReceived', label: 'أُرسلت ولم تُستلم' },
  { key: 'awaitingResults', label: 'بانتظار النتائج' },
  { key: 'rejected', label: 'نتائج مرفوضة' },
  { key: 'lateNoResult', label: 'متأخرة بدون نتيجة' },
];

// Tiny hyperscript helper — keeps the DOM construction terse and readable.
function h(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (children != null) {
    for (const c of Array.isArray(children) ? children : [children]) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * @param {HTMLElement} container
 * @param {{state?:Object, store:Object, navigate?:Function, rerender?:Function}} ctx
 */
export function render(container, ctx) {
  const store = ctx.store;
  const state = ctx.state || {};
  // Working document holder; reassigned after every save so closures stay fresh.
  const S = { doc: store.loadSettings() };
  const ui = { tab: 'tat', tatSearch: '' };

  container.innerHTML = '';
  container.classList.add('st-root');
  container.setAttribute('dir', 'rtl');

  // ---- toast + autosave -----------------------------------------------------
  const toastEl = h('div', { class: 'st-toast', 'aria-live': 'polite' });
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('st-toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('st-toast--show'), 1400);
  }
  function save() {
    store.saveSettings(S.doc);
    S.doc = store.loadSettings(); // re-read the stamped, fresh copy
  }
  function autosave() {
    save();
    toast('تم الحفظ');
  }

  container.appendChild(toastEl);

  // ---- ephemeral banner -----------------------------------------------------
  if (store.isEphemeral && store.isEphemeral()) {
    container.appendChild(
      h('div', { class: 'st-banner st-banner--warn' }, [
        'تعذّر حفظ الإعدادات في هذا المتصفح (قد يكون وضع التصفح الخاص). ' +
          'التغييرات مؤقتة وستُفقد عند إغلاق الصفحة.',
      ]),
    );
  }

  // ---- header + tabs --------------------------------------------------------
  container.appendChild(
    h('div', { class: 'st-header' }, [h('h1', { class: 'st-title', text: 'الإعدادات' })]),
  );

  const tabBar = h('div', { class: 'st-tabs', role: 'tablist' });
  const panel = h('div', { class: 'st-panel' });

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const t of TABS) {
      const active = ui.tab === t.id;
      tabBar.appendChild(
        h('button', {
          class: 'st-tab' + (active ? ' st-tab--active' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          text: t.label,
          onClick: () => {
            if (ui.tab === t.id) return;
            ui.tab = t.id;
            renderTabs();
            renderPanel();
          },
        }),
      );
    }
  }

  function renderPanel() {
    panel.innerHTML = '';
    if (ui.tab === 'tat') renderTat(panel);
    else if (ui.tab === 'labs') renderLabs(panel);
    else if (ui.tab === 'const') renderConst(panel);
    else if (ui.tab === 'snapshot') renderSnapshot(panel);
    else if (ui.tab === 'grafana') renderGrafana(panel);
    else if (ui.tab === 'backup') renderBackup(panel);
  }

  container.appendChild(tabBar);
  container.appendChild(panel);

  // Small reusable table scaffold in a horizontal-scroll wrapper.
  function tableWrap(table) {
    return h('div', { class: 'st-tablewrap' }, [table]);
  }

  // ===========================================================================
  // (a) مدة الفحوصات — TAT durations
  // ===========================================================================
  function renderTat(root) {
    const lookup = S.doc.tatLookup;
    const badge = h('span', { class: 'st-badge' });

    const searchInput = h('input', {
      class: 'st-input st-search',
      type: 'search',
      placeholder: 'ابحث باسم الفحص…',
      value: ui.tatSearch,
      inputmode: 'search',
      'aria-label': 'بحث',
    });

    const tbody = h('tbody');

    function updateBadge(shown) {
      const total = Object.keys(lookup).length;
      badge.textContent =
        shown != null && shown !== total ? `${shown} / ${total} فحص` : `${total} فحص`;
    }

    function paintRows() {
      tbody.innerHTML = '';
      const q = ui.tatSearch.trim().toLowerCase();
      let shown = 0;
      for (const [name, days] of Object.entries(lookup)) {
        if (q && !name.toLowerCase().includes(q)) continue;
        shown += 1;

        const daysInput = h('input', {
          class: 'st-input st-num',
          type: 'number',
          min: '0',
          step: '1',
          value: String(days),
          inputmode: 'numeric',
          'aria-label': 'المدة بالأيام',
        });
        daysInput.addEventListener('change', () => {
          const v = toInt(daysInput.value);
          if (v != null && v >= 0) {
            lookup[name] = v;
            autosave();
          } else {
            daysInput.value = String(lookup[name]);
          }
        });

        const delBtn = h('button', {
          class: 'st-btn st-btn--danger st-btn--icon',
          type: 'button',
          title: 'حذف',
          'aria-label': `حذف ${name}`,
          text: '×',
          onClick: () => {
            if (confirm(`حذف «${name}» من قائمة المدد؟`)) {
              delete lookup[name];
              autosave();
              paintRows();
            }
          },
        });

        tbody.appendChild(
          h('tr', null, [
            // dir=auto: long Latin test names show their START (not end-clipped) in the RTL table
            h('td', { class: 'st-td-name', dir: 'auto', title: name, text: name }),
            h('td', { class: 'st-td-num' }, [daysInput]),
            h('td', { class: 'st-td-actions' }, [delBtn]),
          ]),
        );
      }
      if (shown === 0) {
        tbody.appendChild(
          h('tr', null, [
            h('td', { colspan: '3', class: 'st-empty', text: 'لا توجد نتائج مطابقة.' }),
          ]),
        );
      }
      updateBadge(shown);
    }

    searchInput.addEventListener('input', () => {
      ui.tatSearch = searchInput.value;
      paintRows();
    });

    // Add-row controls.
    const addName = h('input', {
      class: 'st-input st-grow',
      type: 'text',
      placeholder: 'اسم الفحص الجديد',
    });
    const addDays = h('input', {
      class: 'st-input st-num',
      type: 'number',
      min: '0',
      step: '1',
      placeholder: 'أيام',
      inputmode: 'numeric',
    });
    function addRow() {
      const name = addName.value.trim();
      const days = toInt(addDays.value);
      if (!name) return toast('أدخل اسم الفحص');
      if (name in lookup) return toast('هذا الفحص موجود بالفعل');
      if (days == null || days < 0) return toast('أدخل عدد أيام صالح');
      lookup[name] = days;
      autosave();
      addName.value = '';
      addDays.value = '';
      ui.tatSearch = '';
      searchInput.value = '';
      paintRows();
    }
    addName.addEventListener('keydown', (e) => e.key === 'Enter' && addRow());
    addDays.addEventListener('keydown', (e) => e.key === 'Enter' && addRow());

    // Excel merge file input.
    const fileMsg = h('span', { class: 'st-file-msg' });
    const fileInput = h('input', {
      class: 'st-file',
      type: 'file',
      accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const handler = state.onTatFileMerge;
      if (typeof handler === 'function') {
        fileMsg.textContent = 'جارٍ المعالجة…';
        Promise.resolve(handler(file))
          .then((res) => {
            S.doc = store.loadSettings();
            paintRows();
            const parts = [];
            if (res && res.added != null) parts.push(`أُضيف ${res.added}`);
            if (res && res.updated != null) parts.push(`حُدّث ${res.updated}`);
            fileMsg.textContent = parts.length ? parts.join(' • ') : 'تم التحديث من الملف';
            toast('تم التحديث');
          })
          .catch((err) => {
            fileMsg.textContent = 'تعذّر: ' + ((err && err.message) || err);
          });
      } else {
        fileMsg.textContent = 'متاح بعد التكامل';
      }
    });

    const table = h('table', { class: 'st-table' }, [
      h('thead', null, [
        h('tr', null, [
          h('th', { text: 'اسم الفحص' }),
          h('th', { class: 'st-th-num', text: 'المدة (أيام)' }),
          h('th', { class: 'st-th-actions', text: '' }),
        ]),
      ]),
      tbody,
    ]);

    root.appendChild(
      h('div', { class: 'st-section' }, [
        h('div', { class: 'st-toolbar' }, [
          searchInput,
          badge,
          h('label', { class: 'st-file-label' }, [
            h('span', { text: 'تحديث من ملف Excel' }),
            fileInput,
          ]),
          fileMsg,
        ]),
        h('div', { class: 'st-addbar' }, [
          addName,
          addDays,
          h('button', {
            class: 'st-btn st-btn--primary',
            type: 'button',
            text: 'إضافة فحص',
            onClick: addRow,
          }),
        ]),
        tableWrap(table),
      ]),
    );

    paintRows();
  }

  // ===========================================================================
  // (b) جاهزية المختبرات — scorecard
  // ===========================================================================
  function renderLabs(root) {
    const NUM_KEYS = ['target', 'uploaded', 'notUploaded', 'needFix', 'available'];
    const totalCells = {};

    function recomputeTotals() {
      for (const k of NUM_KEYS) {
        const sum = S.doc.scorecard.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        if (totalCells[k]) totalCells[k].textContent = String(sum);
      }
      const canOrderCount = S.doc.scorecard.filter((r) => r.canOrder).length;
      if (totalCells.canOrder) {
        totalCells.canOrder.textContent = `${canOrderCount} / ${S.doc.scorecard.length}`;
      }
    }

    function numCell(row, key) {
      const input = h('input', {
        class: 'st-input st-num',
        type: 'number',
        min: '0',
        step: '1',
        value: String(row[key] ?? 0),
        inputmode: 'numeric',
        'aria-label': key,
      });
      input.addEventListener('change', () => {
        const v = toInt(input.value);
        row[key] = v != null && v >= 0 ? v : 0;
        input.value = String(row[key]);
        recomputeTotals();
        autosave();
      });
      return h('td', { class: 'st-td-num' }, [input]);
    }

    function buildBody(tbody) {
      tbody.innerHTML = '';
      S.doc.scorecard.forEach((row, idx) => {
        const labInput = h('input', {
          class: 'st-input st-grow',
          type: 'text',
          value: row.lab || '',
          'aria-label': 'اسم المختبر',
        });
        labInput.addEventListener('change', () => {
          row.lab = labInput.value;
          autosave();
        });

        const pctInput = h('input', {
          class: 'st-input st-num',
          type: 'text',
          value: row.pct || '',
          placeholder: '%',
          'aria-label': 'النسبة',
        });
        pctInput.addEventListener('change', () => {
          row.pct = pctInput.value;
          autosave();
        });

        const canOrder = h('input', { type: 'checkbox', class: 'st-check' });
        canOrder.checked = !!row.canOrder;
        canOrder.addEventListener('change', () => {
          row.canOrder = canOrder.checked;
          recomputeTotals();
          autosave();
        });

        const delBtn = h('button', {
          class: 'st-btn st-btn--danger st-btn--icon',
          type: 'button',
          title: 'حذف',
          text: '×',
          onClick: () => {
            if (confirm(`حذف المختبر «${row.lab || '—'}»؟`)) {
              S.doc.scorecard.splice(idx, 1);
              autosave();
              buildBody(tbody);
              recomputeTotals();
            }
          },
        });

        tbody.appendChild(
          h('tr', null, [
            h('td', { class: 'st-td-name', dir: 'auto' }, [labInput]),
            h('td', { class: 'st-td-num' }, [pctInput]),
            numCell(row, 'target'),
            numCell(row, 'uploaded'),
            numCell(row, 'notUploaded'),
            numCell(row, 'needFix'),
            h('td', { class: 'st-td-check' }, [canOrder]),
            numCell(row, 'available'),
            h('td', { class: 'st-td-actions' }, [delBtn]),
          ]),
        );
      });
    }

    const tbody = h('tbody');
    const tfootCells = [
      h('td', { class: 'st-td-total', text: 'الإجمالي' }),
      h('td', { class: 'st-td-total' }), // pct — blank
    ];
    for (const k of NUM_KEYS.slice(0, 4)) {
      const c = h('td', { class: 'st-td-total st-td-num' });
      totalCells[k] = c;
      tfootCells.push(c);
    }
    const canOrderTotal = h('td', { class: 'st-td-total st-td-check' });
    totalCells.canOrder = canOrderTotal;
    tfootCells.push(canOrderTotal);
    const availTotal = h('td', { class: 'st-td-total st-td-num' });
    totalCells.available = availTotal;
    tfootCells.push(availTotal);
    tfootCells.push(h('td', { class: 'st-td-total' }));

    const table = h('table', { class: 'st-table' }, [
      h('thead', null, [
        h('tr', null, [
          h('th', { text: 'المختبر' }),
          h('th', { class: 'st-th-num', text: 'النسبة' }),
          h('th', { class: 'st-th-num', text: 'المستهدف' }),
          h('th', { class: 'st-th-num', text: 'مُحمّل' }),
          h('th', { class: 'st-th-num', text: 'غير محمّل' }),
          h('th', { class: 'st-th-num', text: 'يحتاج إصلاح' }),
          h('th', { text: 'يمكن الطلب' }),
          h('th', { class: 'st-th-num', text: 'متاح' }),
          h('th', { class: 'st-th-actions', text: '' }),
        ]),
      ]),
      tbody,
      h('tfoot', null, [h('tr', null, tfootCells)]),
    ]);

    buildBody(tbody);
    recomputeTotals();

    root.appendChild(
      h('div', { class: 'st-section' }, [
        h('div', { class: 'st-addbar' }, [
          h('button', {
            class: 'st-btn st-btn--primary',
            type: 'button',
            text: 'إضافة مختبر',
            onClick: () => {
              S.doc.scorecard.push({
                lab: '',
                pct: '',
                target: 0,
                uploaded: 0,
                notUploaded: 0,
                needFix: 0,
                canOrder: false,
                available: 0,
              });
              autosave();
              buildBody(tbody);
              recomputeTotals();
            },
          }),
        ]),
        tableWrap(table),
      ]),
    );
  }

  // ===========================================================================
  // (c) ثوابت تاريخية — cancelledByMonth
  // ===========================================================================
  function renderConst(root) {
    function hc() {
      if (!S.doc.historicalConstants) S.doc.historicalConstants = { cancelledByMonth: {} };
      if (!S.doc.historicalConstants.cancelledByMonth) {
        S.doc.historicalConstants.cancelledByMonth = {};
      }
      return S.doc.historicalConstants.cancelledByMonth;
    }

    const tbody = h('tbody');
    const totalEl = h('span', { class: 'st-badge' });

    function updateTotal() {
      const sum = Object.values(hc()).reduce((a, b) => a + (Number(b) || 0), 0);
      totalEl.textContent = `إجمالي الإضافات اليدوية: ${sum} طلب ملغي`;
    }

    function paint() {
      const map = hc();
      tbody.innerHTML = '';
      const months = Object.keys(map).sort();
      for (const m of months) {
        const numInput = h('input', {
          class: 'st-input st-num',
          type: 'number',
          min: '0',
          step: '1',
          value: String(map[m]),
          inputmode: 'numeric',
          'aria-label': 'عدد الملغاة',
        });
        numInput.addEventListener('change', () => {
          const v = toInt(numInput.value);
          map[m] = v != null && v >= 0 ? v : 0;
          numInput.value = String(map[m]);
          updateTotal();
          autosave();
        });
        const delBtn = h('button', {
          class: 'st-btn st-btn--danger st-btn--icon',
          type: 'button',
          title: 'حذف',
          text: '×',
          onClick: () => {
            if (confirm(`حذف شهر ${m}؟`)) {
              delete map[m];
              autosave();
              paint();
            }
          },
        });
        tbody.appendChild(
          h('tr', null, [
            h('td', { class: 'st-td-name', dir: 'auto', text: m }),
            h('td', { class: 'st-td-num' }, [numInput]),
            h('td', { class: 'st-td-actions' }, [delBtn]),
          ]),
        );
      }
      if (months.length === 0) {
        tbody.appendChild(
          h('tr', null, [h('td', { colspan: '3', class: 'st-empty', text: 'لا توجد أشهر.' })]),
        );
      }
      updateTotal();
    }

    const addMonth = h('input', { class: 'st-input st-num', type: 'month', 'aria-label': 'الشهر' });
    const addNum = h('input', {
      class: 'st-input st-num',
      type: 'number',
      min: '0',
      step: '1',
      placeholder: 'عدد الملغاة',
      inputmode: 'numeric',
    });
    function addRow() {
      const m = (addMonth.value || '').trim();
      const n = toInt(addNum.value);
      if (!MONTH_RE.test(m)) return toast('أدخل شهراً بصيغة YYYY-MM');
      if (n == null || n < 0) return toast('أدخل عدداً صالحاً');
      hc()[m] = n;
      autosave();
      addMonth.value = '';
      addNum.value = '';
      paint();
    }
    addNum.addEventListener('keydown', (e) => e.key === 'Enter' && addRow());

    const table = h('table', { class: 'st-table' }, [
      h('thead', null, [
        h('tr', null, [
          h('th', { text: 'الشهر (YYYY-MM)' }),
          h('th', { class: 'st-th-num', text: 'عدد الملغاة' }),
          h('th', { class: 'st-th-actions', text: '' }),
        ]),
      ]),
      tbody,
    ]);

    root.appendChild(
      h('div', { class: 'st-section' }, [
        h('p', { class: 'st-help', text: 'إضافات يدوية للطلبات الملغاة لكل شهر، تُضاف فوق العدد المحسوب من الملف (وليست بديلاً عنه). استخدمها للأشهر التاريخية غير الموجودة في ملف البيانات.' }),
        h('div', { class: 'st-toolbar' }, [totalEl]),
        h('div', { class: 'st-addbar' }, [
          addMonth,
          addNum,
          h('button', {
            class: 'st-btn st-btn--primary',
            type: 'button',
            text: 'إضافة شهر',
            onClick: addRow,
          }),
        ]),
        tableWrap(table),
      ]),
    );

    paint();
  }

  // ===========================================================================
  // (d) لقطة التقرير السابق — snapshot (full 9-number set + asOf)
  // ===========================================================================
  function renderSnapshot(root) {
    // Ensure the working doc carries the widened {asOf, numbers} shape; migrate a
    // legacy {prevCompleted, asOf} snapshot in-place on first paint.
    function snap() {
      if (!S.doc.snapshot || typeof S.doc.snapshot !== 'object') {
        S.doc.snapshot = { asOf: '', numbers: {} };
      }
      const s = S.doc.snapshot;
      if (!s.numbers || typeof s.numbers !== 'object') {
        s.numbers = {
          ...SNAPSHOT_SEED.numbers,
          ...(s.prevCompleted != null ? { completed: Number(s.prevCompleted) } : {}),
        };
        delete s.prevCompleted;
      }
      return s;
    }

    const s = snap();
    const inputs = {};

    const numberFields = SNAPSHOT_FIELDS.map(({ key, label }) => {
      const input = h('input', {
        class: 'st-input st-num',
        type: 'number',
        min: '0',
        step: '1',
        value: String(s.numbers[key] ?? 0),
        inputmode: 'numeric',
        'aria-label': label,
      });
      input.addEventListener('change', () => {
        const v = toInt(input.value);
        // Read the LIVE snapshot each time: autosave() reloads S.doc, so the `s`
        // captured at render goes stale after the first edit. Without this,
        // every edit past the first would mutate the orphaned object and be lost.
        const cur = snap();
        cur.numbers[key] = v != null && v >= 0 ? v : 0;
        input.value = String(cur.numbers[key]);
        autosave();
      });
      inputs[key] = input;
      return h('div', { class: 'st-field' }, [
        h('label', { class: 'st-label', text: label }),
        input,
      ]);
    });

    const asOfInput = h('input', {
      class: 'st-input',
      type: 'date',
      value: s.asOf || '',
      'aria-label': 'حتى تاريخ',
    });
    asOfInput.addEventListener('change', () => {
      snap().asOf = asOfInput.value;
      autosave();
    });

    root.appendChild(
      h('div', { class: 'st-section' }, [
        h('p', {
          class: 'st-help',
          text: 'أرقام آخر تقرير منشور؛ يقارنها المحرّك بأرقام التقرير القادم ليُظهر شارات «+N» للزيادة فقط.',
        }),
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'حتى تاريخ' }),
          asOfInput,
        ]),
        ...numberFields,
        h('div', { class: 'st-addbar' }, [
          h('button', {
            class: 'st-btn',
            type: 'button',
            text: 'إعادة تعيين إلى الافتراضي',
            onClick: () => {
              if (!confirm('إعادة اللقطة إلى القيم الافتراضية؟')) return;
              S.doc.snapshot = { asOf: SNAPSHOT_SEED.asOf, numbers: { ...SNAPSHOT_SEED.numbers } };
              autosave();
              const reset = snap();
              for (const { key } of SNAPSHOT_FIELDS) {
                if (inputs[key]) inputs[key].value = String(reset.numbers[key] ?? 0);
              }
              asOfInput.value = reset.asOf || '';
            },
          }),
        ]),
      ]),
    );
  }

  // ===========================================================================
  // (e) الاتصال المباشر — Grafana live source + cached tracker
  // ===========================================================================
  function renderGrafana(root) {
    function grafana() {
      if (!S.doc.grafana || typeof S.doc.grafana !== 'object') {
        S.doc.grafana = { baseUrl: '', accessToken: '', panelId: 49, enabled: false, dataKey: '' };
      }
      return S.doc.grafana;
    }
    const g = grafana();

    // -- عنوان Grafana --------------------------------------------------------
    const urlInput = h('input', {
      class: 'st-input st-grow',
      type: 'text',
      dir: 'ltr',
      inputmode: 'url',
      placeholder: 'https://elab.seha.sa/hpapm',
      value: g.baseUrl || '',
      'aria-label': 'عنوان Grafana',
    });
    urlInput.addEventListener('change', () => {
      grafana().baseUrl = urlInput.value.trim();
      autosave();
    });

    // -- رمز الوصول العام (password + show/hide) ------------------------------
    const tokenInput = h('input', {
      class: 'st-input st-grow',
      type: 'password',
      dir: 'ltr',
      autocomplete: 'off',
      value: g.accessToken || '',
      'aria-label': 'رمز الوصول العام',
    });
    tokenInput.addEventListener('change', () => {
      grafana().accessToken = tokenInput.value.trim();
      autosave();
    });
    const toggleBtn = h('button', {
      class: 'st-btn st-btn--icon',
      type: 'button',
      title: 'إظهار/إخفاء الرمز',
      'aria-label': 'إظهار أو إخفاء الرمز',
      'aria-pressed': 'false',
      text: '👁',
      onClick: () => {
        const hidden = tokenInput.getAttribute('type') === 'password';
        tokenInput.setAttribute('type', hidden ? 'text' : 'password');
        toggleBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      },
    });

    // -- مفتاح فك تشفير البيانات (password + show/hide) -----------------------
    // AES-256 key (64 hex) for the encrypted live snapshot published by the
    // GitHub Action; used as the automatic fallback when a direct pull is CORS-blocked.
    const dataKeyInput = h('input', {
      class: 'st-input st-grow',
      type: 'password',
      dir: 'ltr',
      autocomplete: 'off',
      placeholder: '64 خانة hex',
      value: g.dataKey || '',
      'aria-label': 'مفتاح فك تشفير البيانات',
    });
    dataKeyInput.addEventListener('change', () => {
      grafana().dataKey = dataKeyInput.value.trim();
      autosave();
    });
    const dataKeyToggle = h('button', {
      class: 'st-btn st-btn--icon',
      type: 'button',
      title: 'إظهار/إخفاء المفتاح',
      'aria-label': 'إظهار أو إخفاء المفتاح',
      'aria-pressed': 'false',
      text: '👁',
      onClick: () => {
        const hidden = dataKeyInput.getAttribute('type') === 'password';
        dataKeyInput.setAttribute('type', hidden ? 'text' : 'password');
        dataKeyToggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      },
    });

    // -- رقم اللوحة -----------------------------------------------------------
    const panelIdInput = h('input', {
      class: 'st-input st-num',
      type: 'number',
      min: '0',
      step: '1',
      value: String(g.panelId ?? 49),
      inputmode: 'numeric',
      'aria-label': 'رقم اللوحة',
    });
    panelIdInput.addEventListener('change', () => {
      const v = toInt(panelIdInput.value);
      grafana().panelId = v != null && v >= 0 ? v : 49;
      panelIdInput.value = String(grafana().panelId);
      autosave();
    });

    // -- تفعيل السحب المباشر --------------------------------------------------
    const enabledCheck = h('input', { type: 'checkbox', class: 'st-check' });
    enabledCheck.checked = !!g.enabled;
    enabledCheck.addEventListener('change', () => {
      grafana().enabled = enabledCheck.checked;
      autosave();
    });

    // -- اختبار الاتصال -------------------------------------------------------
    const testMsg = h('div', { class: 'st-import-msg' });
    const testBtn = h('button', {
      class: 'st-btn st-btn--primary',
      type: 'button',
      text: 'اختبار الاتصال',
      onClick: () => {
        const handler = state.onGrafanaTest;
        if (typeof handler !== 'function') {
          testMsg.className = 'st-import-msg';
          testMsg.textContent = 'متاح بعد التكامل';
          return;
        }
        testMsg.className = 'st-import-msg';
        testMsg.textContent = 'جارٍ الاختبار…';
        testBtn.disabled = true;
        const fail = (err) => {
          testMsg.className = 'st-import-msg st-import-msg--err';
          testMsg.textContent = 'فشل الاتصال: ' + err + ' — ' + CORS_HINT;
        };
        Promise.resolve(handler())
          .then((res) => {
            if (res && res.ok) {
              testMsg.className = 'st-import-msg st-import-msg--ok';
              const rows = res.rows != null ? res.rows : 0;
              testMsg.textContent = `نجح الاتصال — ${rows} صف`;
            } else {
              fail((res && res.error) || 'خطأ غير معروف');
            }
          })
          .catch((err) => fail((err && err.message) || err))
          .finally(() => {
            testBtn.disabled = false;
          });
      },
    });

    // -- الملف المتتبع المحفوظ (cached tracker) -------------------------------
    const cachedInfo = h('span', { class: 'st-badge' });
    const clearCachedBtn = h('button', {
      class: 'st-btn st-btn--danger',
      type: 'button',
      text: 'مسح',
      onClick: () => {
        if (!confirm('مسح آخر ملف متتبع محفوظ؟')) return;
        store.updateCachedTracker(null);
        S.doc = store.loadSettings();
        paintCached();
        toast('تم المسح');
      },
    });
    function paintCached() {
      const ct = S.doc.cachedTracker;
      if (ct && ct.model) {
        const count = Array.isArray(ct.model.tasks) ? ct.model.tasks.length : 0;
        cachedInfo.textContent = `${fmtDateTime(ct.updatedAt)} — ${count} مهمة`;
        clearCachedBtn.style.display = '';
      } else {
        cachedInfo.textContent = 'لا يوجد';
        clearCachedBtn.style.display = 'none';
      }
    }

    root.appendChild(
      h('div', { class: 'st-section' }, [
        h('p', {
          class: 'st-help',
          text: 'مصدر البيانات المباشر عبر واجهة اللوحة العامة في Grafana. رمز الوصول هو رمز اللوحة العامة (للعرض فقط) ولا يُحفظ في المستودع.',
        }),
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'عنوان Grafana' }),
          urlInput,
        ]),
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'رمز الوصول العام' }),
          h('div', { class: 'st-addbar' }, [tokenInput, toggleBtn]),
        ]),
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'مفتاح فك تشفير البيانات (hex)' }),
          h('div', { class: 'st-addbar' }, [dataKeyInput, dataKeyToggle]),
        ]),
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'رقم اللوحة' }),
          panelIdInput,
        ]),
        h('label', { class: 'st-field st-field--check' }, [
          enabledCheck,
          h('span', { class: 'st-label', text: 'تفعيل السحب المباشر' }),
        ]),
        h('div', { class: 'st-addbar' }, [testBtn]),
        testMsg,
        h('div', { class: 'st-field' }, [
          h('label', { class: 'st-label', text: 'آخر ملف متتبع محفوظ' }),
          h('div', { class: 'st-toolbar' }, [cachedInfo, clearCachedBtn]),
        ]),
      ]),
    );

    paintCached();
  }

  // ===========================================================================
  // (f) نسخ احتياطي — backup / export / import
  // ===========================================================================
  function renderBackup(root) {
    const importMsg = h('div', { class: 'st-import-msg' });

    const section = h('div', { class: 'st-section' });

    if (store.isEphemeral && store.isEphemeral()) {
      section.appendChild(
        h('div', { class: 'st-banner st-banner--warn' }, [
          'التخزين غير متاح في هذا المتصفح؛ صدّر نسختك الآن للاحتفاظ بها، فالتغييرات لن تُحفظ تلقائياً.',
        ]),
      );
    }

    // Export.
    const exportBtn = h('button', {
      class: 'st-btn st-btn--primary',
      type: 'button',
      text: 'تصدير الإعدادات (JSON)',
      onClick: () => {
        const { filename, blob } = store.exportSettings();
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename, style: { display: 'none' } });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        toast('تم التصدير');
      },
    });

    // Import.
    const importInput = h('input', { class: 'st-file', type: 'file', accept: '.json,application/json' });
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      importMsg.className = 'st-import-msg';
      importMsg.textContent = 'جارٍ الاستيراد…';
      const done = (text) => {
        try {
          const summary = store.importSettings(text);
          S.doc = store.loadSettings();
          importMsg.className = 'st-import-msg st-import-msg--ok';
          importMsg.textContent =
            `تم الاستيراد — الفحوصات: +${summary.tatLookup.added} جديد، ` +
            `${summary.tatLookup.updated} محدّث • ` +
            `الأشهر: +${summary.cancelledByMonth.added} جديد، ` +
            `${summary.cancelledByMonth.updated} محدّث • ` +
            `المختبرات: ${summary.scorecard.after} صف` +
            (summary.snapshotChanged ? ' • تم تحديث اللقطة' : '');
          toast('تم الاستيراد');
        } catch (err) {
          importMsg.className = 'st-import-msg st-import-msg--err';
          importMsg.textContent = 'فشل الاستيراد: ' + ((err && err.message) || err);
        }
      };
      if (typeof file.text === 'function') {
        file.text().then(done, (err) => {
          importMsg.className = 'st-import-msg st-import-msg--err';
          importMsg.textContent = 'تعذّر قراءة الملف: ' + ((err && err.message) || err);
        });
      } else {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result));
        reader.onerror = () => {
          importMsg.className = 'st-import-msg st-import-msg--err';
          importMsg.textContent = 'تعذّر قراءة الملف.';
        };
        reader.readAsText(file);
      }
    });

    section.appendChild(
      h('div', { class: 'st-field' }, [
        h('label', { class: 'st-label', text: 'تصدير' }),
        h('p', { class: 'st-help', text: 'نزّل ملف JSON يحتوي كامل الإعدادات (بدون أي بيانات مرضى).' }),
        exportBtn,
      ]),
    );
    section.appendChild(
      h('div', { class: 'st-field' }, [
        h('label', { class: 'st-label', text: 'استيراد' }),
        h('p', { class: 'st-help', text: 'اختر ملف JSON مُصدّراً سابقاً؛ تفوز قيم الملف عند التعارض.' }),
        h('label', { class: 'st-file-label' }, [h('span', { text: 'اختيار ملف…' }), importInput]),
        importMsg,
      ]),
    );

    root.appendChild(section);
  }

  // ---- boot -----------------------------------------------------------------
  renderTabs();
  renderPanel();
}
