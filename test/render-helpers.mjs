// test/render-helpers.mjs — shared helpers for the render-*.test.mjs suites (not a test file).
//  · loadPptxGen(): evaluates the vendored UMD bundle (pptxgenjs 3.12 + JSZip) in this realm,
//    the same way index.html's <script> tag does, and returns { PptxGenJS, JSZip }.
//  · installDom(): a tiny DOM shim — enough of document/Element/style for html-renderer.js —
//    whose serialise() gives a stable HTML string (style properties in assignment order).
//  · unzipPptx(blob): JSZip view of a rendered deck + a part reader.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadPptxGen() {
  if (!globalThis.PptxGenJS) {
    if (!globalThis.window) globalThis.window = globalThis;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'vendor/pptxgen.bundle.js'), 'utf8'));
  }
  return { PptxGenJS: globalThis.PptxGenJS, JSZip: globalThis.JSZip };
}

export async function unzipPptx(blob) {
  const { JSZip } = loadPptxGen();
  const buf = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  const zip = await JSZip.loadAsync(buf);
  const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
  return { zip, read, names: Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort() };
}

// --- DOM shim -----------------------------------------------------------------------
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
function makeStyle() {
  const props = new Map();
  return new Proxy({}, {
    get(_, k) {
      if (k === '__props') return props;
      if (k === 'cssText') return [...props].map(([a, b]) => `${a}: ${b};`).join(' ');
      return props.get(kebab(String(k))) ?? '';
    },
    set(_, k, v) { props.set(kebab(String(k)), String(v)); return true; },
  });
}
class Node {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.attrs = new Map(); this.style = makeStyle(); this.dataset = {}; this._text = null; this._html = null; }
  appendChild(c) {
    if (c && c.tagName === '#fragment') { c.childNodes.forEach((n) => this.childNodes.push(n)); c.childNodes = []; } else this.childNodes.push(c);
    return c;
  }
  insertBefore(c, ref) { const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? 0 : i, 0, c); return c; }
  set textContent(v) { this.childNodes = [new TextNode(String(v))]; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.childNodes = [new RawNode(String(v))]; }
  get innerHTML() { return this.childNodes.map(serialise).join(''); }
  set className(v) { this.attrs.set('class', v); }
  get className() { return this.attrs.get('class') || ''; }
  set rowSpan(v) { this.attrs.set('rowspan', String(v)); }
  get rowSpan() { return Number(this.attrs.get('rowspan') || 1); }
  set colSpan(v) { this.attrs.set('colspan', String(v)); }
  get colSpan() { return Number(this.attrs.get('colspan') || 1); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  get children() { return this.childNodes.filter((c) => c instanceof Node); }
  querySelectorAll(tag) {
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c instanceof Node) { if (c.tagName === tag) out.push(c); walk(c); } });
    walk(this);
    return out;
  }
}
class TextNode { constructor(t) { this.text = t; } get textContent() { return this.text; } }
class RawNode { constructor(h) { this.html = h; } get textContent() { return this.html.replace(/<[^>]*>/g, ''); } }
class CommentNode { constructor(t) { this.text = t; } get textContent() { return ''; } }
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function serialise(n) {
  if (n instanceof TextNode) return escText(n.text);
  if (n instanceof RawNode) return n.html;
  if (n instanceof CommentNode) return `<!--${n.text}-->`;
  if (n.tagName === '#fragment') return n.childNodes.map(serialise).join('');
  const attrs = [...n.attrs].map(([k, v]) => ` ${k}="${v}"`).join('');
  const data = Object.entries(n.dataset).map(([k, v]) => ` data-${kebab(k)}="${v}"`).join('');
  const st = n.style.cssText;
  return `<${n.tagName}${attrs}${data}${st ? ` style="${st}"` : ''}>${n.childNodes.map(serialise).join('')}</${n.tagName}>`;
}
export function installDom() {
  globalThis.document = {
    createElement: (t) => new Node(t),
    createDocumentFragment: () => new Node('#fragment'),
    createTextNode: (t) => new TextNode(t),
    createComment: (t) => new CommentNode(t),
  };
  return globalThis.document;
}
