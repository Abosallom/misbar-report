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

// html2canvas rasterizes inline <svg> by serializing it into an isolated <img>,
// which cannot see the page's @font-face — chart labels would fall back to a
// generic font. Embed Cairo as base64 @font-face rules INSIDE each cloned svg.
let fontCssPromise = null;
function svgFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const b64 = async (rel) => {
        const buf = await (await fetch(new URL(rel, import.meta.url))).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const RANGE_AR = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
      const RANGE_LA = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212';
      const face = (data, range) => `@font-face{font-family:'Cairo';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`;
      const [ar, la] = await Promise.all([
        b64('../../assets/fonts/Cairo-400-arabic.woff2'),
        b64('../../assets/fonts/Cairo-400-latin.woff2'),
      ]);
      return face(ar, RANGE_AR) + face(la, RANGE_LA);
    })().catch((e) => { console.warn('[pdf] svg font embed unavailable', e); return ''; });
  }
  return fontCssPromise;
}

async function shot(el, html2canvas, scale, fontCss) {
  return html2canvas(el, {
    scale, backgroundColor: '#FFFFFF', useCORS: false, logging: false,
    width: el.offsetWidth, height: el.offsetHeight,
    onclone: (doc) => {
      if (!fontCss) return;
      doc.querySelectorAll('svg').forEach((svg) => {
        const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
        st.textContent = fontCss;
        svg.insertBefore(st, svg.firstChild);
      });
    },
  });
}

/**
 * @param {HTMLElement[]} slideEls  rendered .sl-slide elements (in order)
 * @param {{jsPDF:any, html2canvas:any, onProgress?:(i:number,total:number)=>void}} opts
 * @returns {Promise<Blob>}
 */
export async function exportPdf(slideEls, { jsPDF, html2canvas, onProgress }) {
  await ensureFonts();
  const fontCss = await svgFontCss();
  const JsPDF = jsPDF.jsPDF || jsPDF;
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'in', format: [13.333, 7.5], compress: true });
  const total = slideEls.length;

  for (let i = 0; i < total; i++) {
    const el = slideEls[i];
    let canvas = await shot(el, html2canvas, 2, fontCss);
    if (isBlank(canvas)) canvas = await shot(el, html2canvas, 1.5, fontCss); // iOS safeguard
    const img = canvas.toDataURL('image/jpeg', 0.92);
    if (i > 0) pdf.addPage([13.333, 7.5], 'landscape');
    pdf.addImage(img, 'JPEG', 0, 0, 13.333, 7.5, undefined, 'FAST');
    canvas.width = 0; canvas.height = 0; canvas = null; // free memory
    if (onProgress) onProgress(i + 1, total);
  }
  return pdf.output('blob');
}

export default exportPdf;
