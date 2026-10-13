#!/usr/bin/env node
// build-sendout-master.mjs — encrypt the ops "KAMC Send Out Master File" workbook
// (sheet 'KAMC Send Out') into data/sendout-master.enc for the app to consume.
//
// WHY ENCRYPTED, NOT A PLAIN SEED: the country of every send-out order is decided
// by that workbook, and the app must decide it offline in the browser — but the
// repo is PUBLIC. The catalogue is commercial tender data (vendor names, the
// reference lab behind each one, and every contracted test description), so it
// ships as ciphertext exactly like data/kamc-live.enc: only a signed-in user,
// whose access seal carries the data key, can read it. The published file
// reveals nothing.
//
// Re-run whenever a new master file arrives:
//   DATA_KEY=<64 hex chars> node scripts/build-sendout-master.mjs "<the .xlsx>"
//
// Output: base64( iv(12) || AES-256-GCM ciphertext+tag ) of
//   {"generatedAt": "...", "rows": [{vendor, country, reflab, item}, ...]}
// which is the same envelope shape fetchKamcSnapshot already decrypts.
//
// Columns consumed: Vendor Name, Country, Referance Lab (that misspelling is the
// real header), and Item Description — what a multi-country vendor's orders are
// matched on, by TEST NAME and never by LOINC.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import crypto from 'node:crypto';

const src = process.argv[2];
if (!src) {
  console.error('usage: DATA_KEY=<64 hex> node scripts/build-sendout-master.mjs "<KAMC Send Out Master File.xlsx>"');
  process.exit(1);
}
const keyHex = (process.env.DATA_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error('DATA_KEY must be 64 hex chars (the same key that encrypts data/kamc-live.enc)');
  process.exit(1);
}

const XLSXmod = await import('../vendor/xlsx.mjs');
const XLSX = XLSXmod.default || XLSXmod;
const wb = XLSX.read(readFileSync(src), { type: 'buffer' });

// WHICH SHEET. The first master file named its sheet 'KAMC Send Out'; the 2026-10-13
// v2 file ('Send Out-Master file-QTY NPT0012-24 v2.xlsx') calls it 'Tabelle1' and adds
// a HIDDEN 'Other Items' sheet that holds only cancelled, never-awarded items. So the
// sheet is chosen by its HEADERS, not its name: the first VISIBLE sheet that has the
// four columns this script reads. A hidden sheet is never read — hiding is how the
// workbook's owner says "not part of the catalogue".
const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const NEED = ['Vendor Name', 'Country', 'Referance Lab', 'Item Description'];
const hidden = new Set(((wb.Workbook && wb.Workbook.Sheets) || []).filter((s) => s.Hidden).map((s) => s.name));
const SHEET = wb.SheetNames.find((n) => {
  if (hidden.has(n)) return false;
  const head = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, range: 0 })[0] || []).map(clean);
  return NEED.every((h) => head.includes(h));
});
if (!SHEET) {
  console.error(`no visible sheet has the columns ${NEED.join(' / ')}; sheets are: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}

// CANCELLED ITEMS. v2 keeps cancelled tender items in the same table with 'Cancelled'
// (or 'Cancelled - No Accepted offer') in Vendor Name AND Country. They are not a
// vendor and not a country — read as one, they would put orders into a «Cancelled»
// country bar — so they are dropped here, at the only door into the catalogue.
const isCancelled = (v) => /^cancel+ed\b/i.test(v);
const rows = [];
let skippedCancelled = 0;
for (const r of XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: '' })) {
  const vendor = clean(r['Vendor Name']);
  const country = clean(r['Country']);
  if (!vendor || !country) continue;
  if (isCancelled(vendor) || isCancelled(country)) { skippedCancelled += 1; continue; }
  rows.push({ vendor, country, reflab: clean(r['Referance Lab']), item: clean(r['Item Description']) });
}
if (!rows.length) { console.error('no usable rows found'); process.exit(1); }

// generatedAt is the WORKBOOK's mtime, not the clock: re-running the script on an
// unchanged file then produces identical plaintext, so only a real content change
// shows up as a diff worth committing.
const generatedAt = statSync(src).mtime.toISOString();
const plaintext = Buffer.from(JSON.stringify({ generatedAt, rows }), 'utf8');

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
const enc = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
mkdirSync('data', { recursive: true });
writeFileSync('data/sendout-master.enc', Buffer.concat([iv, enc]).toString('base64'));

const vendors = new Set(rows.map((r) => r.vendor));
const countries = [...new Set(rows.map((r) => r.country))].sort();
console.log(`sendout-master: wrote data/sendout-master.enc (encrypted)`);
console.log(`  sheet '${SHEET}' · ${rows.length} rows · ${vendors.size} vendors · ${skippedCancelled} cancelled items skipped`);
console.log(`  countries: ${countries.join(', ')}`);
console.log('  NOTE: the plaintext catalogue is never written to the repo.');
