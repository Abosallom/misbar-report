// vendor-loader.js — lazy loaders for heavy vendor libs (Track E).
// Papa (papaparse) is loaded EAGERLY via a <script> tag in index.html -> window.Papa.

/** Dynamic ESM import of SheetJS. Returns the XLSX namespace object. */
export async function getXLSX() {
  const mod = await import('../vendor/xlsx.mjs?v=v2026-07-22.11');
  // xlsx.mjs exposes named exports and (usually) a default namespace.
  return mod.default && mod.default.utils ? mod.default : mod;
}

let _genLibsPromise = null;

/** Inject a UMD <script> once; resolve when it has executed. */
function injectScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-vendor="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('فشل تحميل ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.vendor = src;
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
    s.addEventListener('error', () => reject(new Error('فشل تحميل ' + src)));
    document.head.appendChild(s);
  });
}

/**
 * Lazily inject the three generation UMD bundles (only once) and return their globals.
 * @returns {Promise<{PptxGenJS:any, jsPDF:any, html2canvas:any}>}
 */
export async function getGenLibs() {
  if (_genLibsPromise) return _genLibsPromise;
  _genLibsPromise = (async () => {
    // pptxgen first (independent), then jspdf + html2canvas (used together for PDF).
    await injectScript('vendor/pptxgen.bundle.js');
    await injectScript('vendor/jspdf.umd.min.js');
    await injectScript('vendor/html2canvas.min.js');
    const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    return {
      PptxGenJS: window.PptxGenJS,
      jsPDF,
      html2canvas: window.html2canvas,
    };
  })();
  return _genLibsPromise;
}

/** Papa is eager; expose a tiny getter that waits a tick if the tag hasn't run yet. */
export async function getPapa() {
  if (window.Papa) return window.Papa;
  // Fallback: if the eager tag failed for some reason, give it one microtask.
  await new Promise((r) => setTimeout(r, 0));
  return window.Papa || null;
}
