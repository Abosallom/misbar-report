// src/render/pdf-export.js
// exportPdf(slideEls, {jsPDF, html2canvas, onProgress}) -> Blob
// Rasterizes each already-rendered .sl-slide element to a JPEG and places it on a
// 13.333 x 7.5 in landscape PDF page. Fonts are awaited so Cairo shapes correctly.
// iOS/Safari safeguard: if a canvas comes back blank, retry once at a lower scale.

async function ensureFonts() {
  try {
    if (document.fonts) {
      await Promise.all([
        document.fonts.load('400 16px Cairo'),
        document.fonts.load('600 16px Cairo'),
        document.fonts.load('700 16px Cairo'),
      ]);
      await document.fonts.ready;
    }
  } catch (_) { /* non-fatal */ }
}

function isBlank(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return true;
    // sample a small grid; if every sampled pixel is pure white/transparent -> blank
    const pts = [[w * 0.5, h * 0.5], [w * 0.25, h * 0.25], [w * 0.75, h * 0.75], [w * 0.5, h * 0.15], [w * 0.15, h * 0.5]];
    for (const [x, y] of pts) {
      const d = ctx.getImageData(x | 0, y | 0, 1, 1).data;
      if (d[3] !== 0 && !(d[0] === 255 && d[1] === 255 && d[2] === 255)) return false;
    }
    return true;
  } catch (_) { return false; }
}

async function shot(el, html2canvas, scale) {
  return html2canvas(el, { scale, backgroundColor: '#FFFFFF', useCORS: false, logging: false, width: el.offsetWidth, height: el.offsetHeight });
}

/**
 * @param {HTMLElement[]} slideEls  rendered .sl-slide elements (in order)
 * @param {{jsPDF:any, html2canvas:any, onProgress?:(i:number,total:number)=>void}} opts
 * @returns {Promise<Blob>}
 */
export async function exportPdf(slideEls, { jsPDF, html2canvas, onProgress }) {
  await ensureFonts();
  const JsPDF = jsPDF.jsPDF || jsPDF;
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'in', format: [13.333, 7.5], compress: true });
  const total = slideEls.length;

  for (let i = 0; i < total; i++) {
    const el = slideEls[i];
    let canvas = await shot(el, html2canvas, 2);
    if (isBlank(canvas)) canvas = await shot(el, html2canvas, 1.5); // iOS safeguard
    const img = canvas.toDataURL('image/jpeg', 0.92);
    if (i > 0) pdf.addPage([13.333, 7.5], 'landscape');
    pdf.addImage(img, 'JPEG', 0, 0, 13.333, 7.5, undefined, 'FAST');
    canvas.width = 0; canvas.height = 0; canvas = null; // free memory
    if (onProgress) onProgress(i + 1, total);
  }
  return pdf.output('blob');
}

export default exportPdf;
