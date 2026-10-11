// render-pdf.test.mjs — pdf-export's font embedding for chart SVGs. Every SVG (legacy and
// BOTH-deck) gets the same single Cairo variable-font face ('100 900' — the 400/600/700
// woff2 files are byte-identical), and because an inline-SVG <style> leaks its @font-face
// into the whole cloned document, onclone must LOAD those faces before html2canvas
// measures (it awaits fonts.ready only before onclone) — the first-BOTH-PDF corruption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function installFetch(loaded) {
  globalThis.fetch = async (url) => {
    const p = fileURLToPath(url);
    loaded.push(p.split('/').pop());
    const b = fs.readFileSync(p);
    return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
}
const mkSvg = () => ({ kids: [], insertBefore(n) { this.kids.unshift(n); } });
const canvas = () => ({ width: 2, height: 2, getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, 255] }) }), toDataURL: () => 'data:image/jpeg;base64,' });
class JsPDF { addImage() {} addPage() {} output() { return new Blob(['%PDF']); } }

test('every chart SVG gets the one variable-font face; html2canvas waits for the clone fonts to load', async () => {
  const loaded = [];
  installFetch(loaded);
  const { exportPdf } = await import('../src/render/pdf-export.js');
  const a = mkSvg(), b = mkSvg();
  const fontLoads = [];
  let settled = false;
  const doc = {
    querySelectorAll: () => [a, b],
    createElementNS: () => ({ textContent: '' }),
    fonts: {
      load: (spec, text) => { fontLoads.push(spec + '|' + text); return new Promise((r) => setTimeout(() => r([]), 5)); },
      get ready() { return Promise.resolve().then(() => { settled = true; }); },
    },
  };
  const html2canvas = async (el, o) => {
    const ret = o.onclone(doc);
    assert.ok(ret && typeof ret.then === 'function', 'onclone returns a promise for html2canvas to await');
    await ret;
    assert.ok(settled, 'clone fonts.ready awaited AFTER the faces were injected');
    return canvas();
  };
  const slide = { offsetWidth: 1280, offsetHeight: 720 };
  const out = await exportPdf([slide], { jsPDF: JsPDF, html2canvas });
  assert.ok(out instanceof Blob);
  for (const svg of [a, b]) {
    const css = svg.kids[0].textContent;
    assert.equal((css.match(/@font-face/g) || []).length, 2);
    assert.match(css, /font-weight:100 900/);
    assert.doesNotMatch(css, /font-weight:700 900|font-weight:100 600/);
  }
  assert.deepEqual(fontLoads.map((s) => s.split(' ')[0]), ['400', '600', '700']);
  assert.ok(fontLoads.every((s) => /[؀-ۿ]/.test(s) && /[A-Z0-9]/.test(s)), 'sample text hits both the Arabic and the Latin range');
  assert.ok(!loaded.some((f) => /Cairo-700/.test(f)), 'no second (identical) bold file fetched');
});

test('a clone without SVGs is handed back as is; a font that never settles cannot hang the export', async () => {
  installFetch([]);
  const { exportPdf } = await import('../src/render/pdf-export.js');
  let r1;
  const html2canvas = async (el, o) => {
    r1 = o.onclone({ querySelectorAll: () => [], createElementNS: () => ({}) });
    return canvas();
  };
  await exportPdf([{ offsetWidth: 1, offsetHeight: 1 }], { jsPDF: JsPDF, html2canvas });
  assert.equal(r1, undefined, 'nothing injected → nothing to wait for');

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);   // collapse the 3 s cap
  try {
    const never = new Promise(() => {});
    const svg = mkSvg();
    const html2 = async (el, o) => {
      await o.onclone({ querySelectorAll: () => [svg], createElementNS: () => ({ textContent: '' }),
        fonts: { load: () => never, ready: never } });
      return canvas();
    };
    const out = await exportPdf([{ offsetWidth: 1, offsetHeight: 1 }], { jsPDF: JsPDF, html2canvas: html2 });
    assert.ok(out instanceof Blob);
  } finally { globalThis.setTimeout = realSetTimeout; }
});
