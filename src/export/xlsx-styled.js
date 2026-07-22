// export/xlsx-styled.js — dependency-free, browser+Node styled XLSX writer.
//
// SheetJS Community Edition DROPS all cell styling on write, so the per-lab
// "TAT Late & Due" exports lost the team's navy computed-block formatting. This
// module hand-rolls the minimal OOXML needed to reproduce the reference workbook
// EXACTLY (fonts, fills, number formats, per-column cell styles) — data aside.
//
// No dependencies: strings are written inline (t="inlineStr", no sharedStrings),
// the ZIP uses the STORE method (no compression) with a correct table-based CRC32
// central directory, so the same bytes work identically in the browser and Node
// without CompressionStream. The caller supplies typed cells; d/dt values arrive
// as epoch-ms and are converted here to Excel serials.
//
// Style indices (into the fixed cellXfs below) are supplied by the caller per the
// reference's per-column map — see src/export/late-labs.js. The cellXfs replicate
// the reference styles.xml semantics:
//   0 default (General, Calibri)
//   1 body font (Aptos Narrow 11), General, wrap+vcenter        — header A..N
//   2 bold white Aptos, navy fill FF1F4E78, center+vcenter+wrap — header O..T
//   3 body font, numFmt 165 (m/d/yyyy)                          — date data
//   4 body font, General                                        — general data
//   5 body font, numFmt 166 (0)                                 — integer data
//   6 body font, General, wrap+vtop                             — Test name data
//   7 body font, numFmt 167 (m/d/yyyy h:mm)                     — datetime data
//   8 bold white Aptos, navy fill, center — General             — navy data (O,P,S,T)
//   9 bold white Aptos, navy fill, center — numFmt 165          — navy date (Q)
//  10 bold white Aptos, navy fill, center — numFmt 166          — navy int  (R)

const MS_PER_DAY = 86400000;
// Excel serial 25569 == 1970-01-01 (both naïve/UTC-anchored here → no TZ drift).
const EXCEL_EPOCH_OFFSET = 25569;
/** Full (fractional) Excel serial from epoch-ms — time-of-day preserved. */
const dtSerial = (ms) => ms / MS_PER_DAY + EXCEL_EPOCH_OFFSET;
/** Integer Excel serial (Excel INT semantics) from a midnight/any epoch-ms. */
const dateSerial = (ms) => Math.floor(ms / MS_PER_DAY) + EXCEL_EPOCH_OFFSET;

const enc = new TextEncoder();

/** Minimal XML text escape for element content / attribute values. */
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── CRC32 (standard table-based, polynomial 0xEDB88320) ──────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP (STORE method, no compression) ───────────────────────────────────────
/**
 * Build a ZIP archive (all entries stored, not deflated) from {name,bytes} parts.
 * @param {{name:string, bytes:Uint8Array}[]} files
 * @returns {Uint8Array}
 */
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const push = (arr) => { chunks.push(arr); offset += arr.length; };

  const entries = files.map((f) => {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;
    const localOffset = offset;

    // Local file header
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // method: 0 = store
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0x21, true);        // mod date (1980-01-01)
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, size, true);        // compressed size
    lv.setUint32(22, size, true);        // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra length
    lh.set(nameBytes, 30);
    push(lh);
    push(f.bytes);

    return {
      nameBytes, crc, size, localOffset,
    };
  });

  const localBytes = offset;

  // Central directory
  for (const e of entries) {
    const ch = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0x21, true);        // mod date
    cv.setUint32(16, e.crc, true);       // crc32
    cv.setUint32(20, e.size, true);      // compressed size
    cv.setUint32(24, e.size, true);      // uncompressed size
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk number start
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, e.localOffset, true);
    ch.set(e.nameBytes, 46);
    push(ch);
  }

  const centralSize = offset - localBytes;

  // End of central directory record
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);              // this disk
  ev.setUint16(6, 0, true);              // cd start disk
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true);// total entries
  ev.setUint32(12, centralSize, true);   // central dir size
  ev.setUint32(16, localBytes, true);    // central dir offset
  ev.setUint16(20, 0, true);             // comment length
  push(eocd);

  // Concatenate
  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

// ── OOXML part builders ──────────────────────────────────────────────────────

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function contentTypesXml() {
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';
}

function rootRelsXml() {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + '</Relationships>';
}

function workbookRelsXml() {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>';
}

function coreXml() {
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"`
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>';
}

function appXml() {
  return `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"`
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + '<Application>Misbar</Application></Properties>';
}

function workbookXml(sheetName) {
  return `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`
    + '</workbook>';
}

// styles.xml — replicates the reference numFmts/fonts/fills/cellXfs semantics.
function stylesXml() {
  return `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<numFmts count="4">'
    + '<numFmt numFmtId="164" formatCode="General"/>'
    + '<numFmt numFmtId="165" formatCode="m/d/yyyy"/>'
    + '<numFmt numFmtId="166" formatCode="0"/>'
    + '<numFmt numFmtId="167" formatCode="m/d/yyyy\\ h:mm"/>'
    + '</numFmts>'
    + '<fonts count="6">'
    + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><sz val="10"/><name val="Arial"/><family val="0"/></font>'
    + '<font><sz val="10"/><name val="Arial"/><family val="0"/></font>'
    + '<font><sz val="10"/><name val="Arial"/><family val="0"/></font>'
    + '<font><sz val="11"/><name val="Aptos Narrow"/><family val="0"/><charset val="1"/></font>'
    + '<font><b val="true"/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos Narrow"/><family val="0"/><charset val="1"/></font>'
    + '</fonts>'
    + '<fills count="3">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor rgb="FF003366"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="11">'
    // 0 default
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    // 1 header A..N: body font, no fill, wrap + vertical center
    + '<xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true" applyAlignment="true"><alignment vertical="center" wrapText="true"/></xf>'
    // 2 header O..T: bold white, navy fill, center + vcenter + wrap
    + '<xf numFmtId="164" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="true" applyFill="true" applyAlignment="true"><alignment horizontal="center" vertical="center" wrapText="true"/></xf>'
    // 3 date data
    + '<xf numFmtId="165" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true" applyNumberFormat="true"/>'
    // 4 general data
    + '<xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true"/>'
    // 5 integer data
    + '<xf numFmtId="166" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true" applyNumberFormat="true"/>'
    // 6 test-name data: general, wrap + vtop
    + '<xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true" applyAlignment="true"><alignment vertical="top" wrapText="true"/></xf>'
    // 7 datetime data
    + '<xf numFmtId="167" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="true" applyNumberFormat="true"/>'
    // 8 navy general (O,P,S,T)
    + '<xf numFmtId="164" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="true" applyFill="true" applyAlignment="true"><alignment horizontal="center"/></xf>'
    // 9 navy date (Q)
    + '<xf numFmtId="165" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="true" applyFill="true" applyNumberFormat="true" applyAlignment="true"><alignment horizontal="center"/></xf>'
    // 10 navy integer (R)
    + '<xf numFmtId="166" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="true" applyFill="true" applyNumberFormat="true" applyAlignment="true"><alignment horizontal="center"/></xf>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

const COL_A = 'A'.charCodeAt(0);
/** 0-based column index → A1 column letters (supports up to 2 letters, enough here). */
function colLetter(c) {
  let n = c;
  let s = '';
  do {
    s = String.fromCharCode(COL_A + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Serialize one typed cell {t,v,s} at row r (1-based), col c (0-based). */
function cellXml(cell, r, c) {
  const ref = `${colLetter(c)}${r}`;
  const s = cell.s == null ? 0 : cell.s;
  const sAttr = ` s="${s}"`;
  switch (cell.t) {
    case 's': {
      const text = String(cell.v);
      // xml:space="preserve" keeps leading/trailing spaces (e.g. padded ids).
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }
    case 'n':
      return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
    case 'd':
      return `<c r="${ref}"${sAttr}><v>${dateSerial(cell.v)}</v></c>`;
    case 'dt':
      return `<c r="${ref}"${sAttr}><v>${dtSerial(cell.v)}</v></c>`;
    case 'empty':
    default:
      // Empty cell still carries its column style (matches the reference).
      return `<c r="${ref}"${sAttr}/>`;
  }
}

function sheetXml({
  headerCells, dataRows, colWidths, autofilterRef,
}) {
  const nCols = headerCells.length;
  const lastCol = colLetter(nCols - 1);
  const lastRow = dataRows.length + 1;
  const dimRef = `A1:${lastCol}${lastRow}`;

  let cols = '';
  if (Array.isArray(colWidths) && colWidths.length) {
    cols = '<cols>';
    colWidths.forEach((w, i) => {
      cols += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="true"/>`;
    });
    cols += '</cols>';
  }

  let rows = `<row r="1">${headerCells.map((cell, c) => cellXml(cell, 1, c)).join('')}</row>`;
  dataRows.forEach((cells, ri) => {
    const r = ri + 2;
    rows += `<row r="${r}">${cells.map((cell, c) => cellXml(cell, r, c)).join('')}</row>`;
  });

  const af = autofilterRef ? `<autoFilter ref="${autofilterRef}"/>` : '';

  return `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="${dimRef}"/>`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultColWidth="8.68" defaultRowHeight="15"/>'
    + cols
    + `<sheetData>${rows}</sheetData>`
    + af
    + '</worksheet>';
}

/**
 * Write a single-sheet, fully-styled XLSX to a Uint8Array.
 * @param {Object} args
 * @param {string} args.sheetName
 * @param {{t:string,v?:*,s?:number}[]} args.headerCells        header row cells (with s=)
 * @param {{t:string,v?:*,s?:number}[][]} args.dataRows         data rows (each a cell array)
 * @param {number[]} [args.colWidths]                           per-column widths
 * @param {string} [args.autofilterRef]                         e.g. 'A1:T4'
 * @returns {Uint8Array}
 */
export function writeStyledXlsx({
  sheetName, headerCells, dataRows, colWidths, autofilterRef,
}) {
  const files = [
    { name: '[Content_Types].xml', bytes: enc.encode(contentTypesXml()) },
    { name: '_rels/.rels', bytes: enc.encode(rootRelsXml()) },
    { name: 'docProps/core.xml', bytes: enc.encode(coreXml()) },
    { name: 'docProps/app.xml', bytes: enc.encode(appXml()) },
    { name: 'xl/workbook.xml', bytes: enc.encode(workbookXml(sheetName)) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: enc.encode(workbookRelsXml()) },
    { name: 'xl/styles.xml', bytes: enc.encode(stylesXml()) },
    {
      name: 'xl/worksheets/sheet1.xml',
      bytes: enc.encode(sheetXml({
        headerCells, dataRows, colWidths, autofilterRef,
      })),
    },
  ];
  return zipStore(files);
}

export default writeStyledXlsx;
