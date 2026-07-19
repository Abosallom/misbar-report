// ui/components.js — shared DOM helpers used by Track E screens.
import { STR } from '../i18n/ar.js';

/** Tiny hyperscript helper. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== 'list' && typeof v !== 'boolean') {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * File drop zone with drag-drop AND tap-to-pick.
 * @param {{title:string, hint:string, accept:string, onFile:(f:File)=>void}} o
 */
export function dropZone({ title, hint, accept, onFile }) {
  const input = el('input', { type: 'file', accept });
  const iconEl = el('div', { class: 'dropzone__icon', text: '📄' });
  const titleEl = el('div', { class: 'dropzone__title', text: title });
  const hintEl = el('div', { class: 'dropzone__hint', text: hint });
  const fileEl = el('div', { class: 'dropzone__file', dir: 'ltr' }); // filenames mix AR+digits+'.ext' — isolate LTR

  const zone = el('label', { class: 'dropzone' }, [iconEl, titleEl, hintEl, fileEl, input]);

  const pick = (f) => { if (f) { fileEl.textContent = f.name; onFile(f); } };

  input.addEventListener('change', () => pick(input.files && input.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((ev) =>
    zone.addEventListener(ev, () => zone.classList.remove('is-drag')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    pick(f);
  });

  return {
    el: zone,
    setLoaded(name) { zone.classList.remove('is-error'); zone.classList.add('is-loaded'); iconEl.textContent = '✅'; if (name) fileEl.textContent = name; },
    setError() { zone.classList.remove('is-loaded'); zone.classList.add('is-error'); iconEl.textContent = '⚠️'; },
    setBusy(busy) { hintEl.textContent = busy ? STR.upload.parsing : hint; },
    reset() { zone.classList.remove('is-loaded', 'is-error'); iconEl.textContent = '📄'; fileEl.textContent = ''; input.value = ''; },
  };
}

/**
 * Summary card with a title and a grid of {label,value} stats.
 * @param {{title:string, stats:{label:string, value:string|number, small?:boolean}[]}} o
 */
export function fileSummaryCard({ title, stats }) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: title }),
    el('div', { class: 'summary' },
      stats.map((s) => el('div', { class: 'stat' }, [
        el('div', { class: 'stat__label', text: s.label }),
        el('div', { class: 'stat__value' + (s.small ? ' small' : ''), text: String(s.value) }),
      ]))),
  ]);
}

let toastHost = null;
/** Transient toast message. type: 'ok' | 'err' | 'warn' | ''. */
export function toast(message, type = '', ms = 2600) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
  toastHost.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, ms);
}

/** Determinate progress bar. */
export function progressBar() {
  const bar = el('div', { class: 'progress__bar' });
  const label = el('div', { class: 'progress__label' });
  const wrap = el('div', {}, [el('div', { class: 'progress' }, [bar]), label]);
  return {
    el: wrap,
    set(pct, text) {
      bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (text != null) label.textContent = text;
    },
  };
}

/**
 * Editable table backed by an array of row objects.
 * @param {{
 *   columns:{key:string, label:string, type?:'text'|'textarea'|'select'|'date', options?:string[], width?:string}[],
 *   rows:Object[],
 *   onChange:(rows:Object[])=>void,
 *   addLabel?:string,
 *   newRow?:()=>Object,
 *   minWidth?:string
 * }} o
 */
export function editableTable({ columns, rows, onChange, addLabel = STR.review.addRow, newRow, minWidth }) {
  const data = rows.map((r) => ({ ...r }));

  const emit = () => onChange(data.map((r) => ({ ...r })));

  const table = el('table', { class: 'etable' });
  if (minWidth) table.style.minWidth = minWidth;
  const thead = el('thead', {}, [
    el('tr', {}, [
      ...columns.map((c) => el('th', { text: c.label, style: c.width ? `width:${c.width}` : '' })),
      el('th', { style: 'width:34px' }),
    ]),
  ]);
  const tbody = el('tbody');
  table.append(thead, tbody);

  function cellControl(col, row) {
    const common = { value: row[col.key] == null ? '' : String(row[col.key]) };
    let ctrl;
    if (col.type === 'select') {
      ctrl = el('select', {}, (col.options || []).map((opt) =>
        el('option', { value: opt, text: opt, selected: String(row[col.key]) === opt })));
    } else if (col.type === 'textarea') {
      ctrl = el('textarea', { rows: 2, ...common });
    } else if (col.type === 'date') {
      ctrl = el('input', { type: 'text', placeholder: 'YYYY-MM-DD', ...common });
    } else {
      ctrl = el('input', { type: 'text', ...common });
    }
    ctrl.addEventListener('input', () => { row[col.key] = ctrl.value; emit(); });
    ctrl.addEventListener('change', () => { row[col.key] = ctrl.value; emit(); });
    return ctrl;
  }

  function renderRows() {
    tbody.innerHTML = '';
    data.forEach((row, i) => {
      const tr = el('tr', {}, [
        ...columns.map((c) => el('td', { class: c.type === 'select' ? 'status-cell' : '' }, [cellControl(c, row)])),
        el('td', {}, [el('button', {
          class: 'rm', title: STR.common.remove, text: '✕',
          onClick: () => { data.splice(i, 1); renderRows(); emit(); },
        })]),
      ]);
      tbody.appendChild(tr);
    });
  }
  renderRows();

  const wrap = el('div', {}, [el('div', { class: 'etable-wrap' }, [table])]);
  if (newRow) {
    wrap.appendChild(el('div', { class: 'table-actions' }, [
      el('button', {
        class: 'btn btn--ghost btn--sm', text: '＋ ' + addLabel,
        onClick: () => { data.push(newRow()); renderRows(); emit(); },
      }),
    ]));
  }
  return wrap;
}

/** Simple labelled textarea field. */
export function textareaField({ label, value, hint, onInput, rows = 4 }) {
  const ta = el('textarea', { rows, value: value || '' });
  ta.addEventListener('input', () => onInput(ta.value));
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    ta,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}
