// test/eml-draft.test.mjs — run with:  node --test
// The per-lab Outlook DRAFT (.eml) builder. Asserts the message is a well-formed
// RFC 5322 multipart/mixed document (header set + order, X-Unsent, boundary
// arithmetic, CRLF everywhere), that the attachment round-trips byte-identically,
// that To: appears only when recipients are given, that Arabic lab names are
// RFC 2047 encoded, and — POLICY — that the module never reads the wall clock and
// contains no sending machinery of any kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildLabEmailDraft, labEmailSubject, labEmailText, labDraftFileName,
  formatMailDate, LAB_EMAIL_BODY, SHEET_MIME, EML_MIME,
} from '../src/export/eml-draft.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/export/eml-draft.js'), 'utf8');

// Synthetic "xlsx": a PK zip signature + a deterministic 0..255 byte ramp, so a
// decode mismatch anywhere in the base64 path (padding, 76-col wrap, high bytes)
// shows up as a byte-level diff.
const BYTES = Uint8Array.from([
  0x50, 0x4b, 0x03, 0x04,
  ...Array.from({ length: 256 }, (_, i) => i),
  0x00, 0xff, 0x0d, 0x0a, 0x1a,
]);
const LAB = 'King Fahad Hospital Lab';
const FILE = `${LAB} - TAT Late & Due.xlsx`;

const draft = (over = {}) => buildLabEmailDraft({
  lab: LAB, fileName: FILE, xlsxBytes: BYTES, reportDate: '2026-07-09', ...over,
});

const BOUNDARY = (() => {
  const m = /boundary="([^"]+)"/.exec(draft().text);
  return m && m[1];
})();

// Header lines with RFC 5322 folded continuations re-attached to their own
// header (the fold CRLF + leading space is kept, so encoded-words stay inspectable).
function headerBlock(text) {
  const out = [];
  for (const line of text.split('\r\n\r\n')[0].split('\r\n')) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += `\r\n${line}`;
    else out.push(line);
  }
  return out;
}
const headerNames = (text) => headerBlock(text).map((l) => l.slice(0, l.indexOf(':')));
/** Decode a possibly RFC 2047 encoded-word header value back to its text. */
const decodeHeaderValue = (line) => line.slice(line.indexOf(':') + 2)
  .split('\r\n ')
  .map((w) => {
    const m = /^=\?UTF-8\?B\?([^?]*)\?=$/.exec(w);
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : w;
  })
  .join('');
const countOf = (hay, needle) => hay.split(needle).length - 1;

test('returns the .eml file name and a message/rfc822 blob', () => {
  const out = draft();
  assert.equal(out.fileName, `${LAB} - Late Test Results.eml`);
  assert.equal(labDraftFileName(LAB), out.fileName);
  assert.equal(out.blob.type, EML_MIME);
  assert.ok(out.blob.size > 400, 'blob carries the encoded message');
});

test('headers are present, correctly ordered, and Content-Type carries the boundary', () => {
  const { text } = draft({ recipients: 'lab@example.sa' });
  assert.deepEqual(headerNames(text), ['Date', 'Subject', 'To', 'X-Unsent', 'MIME-Version', 'Content-Type']);
  const lines = headerBlock(text);
  assert.equal(lines[0], 'Date: Thu, 9 Jul 2026 00:00:00 +0000');
  assert.equal(decodeHeaderValue(lines[1]), labEmailSubject(LAB));
  assert.equal(lines[2], 'To: lab@example.sa');
  assert.equal(lines[3], 'X-Unsent: 1');
  assert.equal(lines[4], 'MIME-Version: 1.0');
  assert.equal(lines[5], `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
  // Without recipients the ordering is the same minus the To: line.
  assert.deepEqual(headerNames(draft().text), ['Date', 'Subject', 'X-Unsent', 'MIME-Version', 'Content-Type']);
  // X-Unsent MUST be there: it is what makes Outlook open the file as an
  // editable draft instead of a received message. Nothing is ever auto-sent.
  assert.ok(/^X-Unsent: 1$/m.test(draft().text));
});

test('Subject is the verbatim team wording', () => {
  assert.equal(labEmailSubject(LAB), `${LAB} | Late Test Results — Action Required`);
  assert.equal(labEmailText(LAB), `Subject: ${labEmailSubject(LAB)}\n\n${LAB_EMAIL_BODY}`);
  assert.ok(LAB_EMAIL_BODY.startsWith('Dear all,'));
  assert.ok(LAB_EMAIL_BODY.includes('Please find the attachment for more info about the orders.'));
});

test('the plain-text part carries the standard wording verbatim', () => {
  const { text } = draft();
  const parts = text.split(`--${BOUNDARY}`);
  const body = parts[1].split('\r\n\r\n')[1].trim();
  const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.equal(decoded, LAB_EMAIL_BODY.replace(/\n/g, '\r\n'));
  assert.ok(parts[1].includes('Content-Type: text/plain; charset="utf-8"'));
  assert.ok(parts[1].includes('Content-Transfer-Encoding: base64'));
});

test('boundary delimiter appears exactly 3 times (open, part 2, close)', () => {
  const { text } = draft();
  assert.equal(countOf(text, `--${BOUNDARY}`), 3);
  assert.equal(countOf(text, `--${BOUNDARY}--`), 1);
  assert.ok(text.trimEnd().endsWith(`--${BOUNDARY}--`), 'closes with the final delimiter');
  assert.equal(countOf(text, `boundary="${BOUNDARY}"`), 1);
});

test('attachment part declares the spreadsheet type, name and disposition', () => {
  const attach = draft().text.split(`--${BOUNDARY}`)[2];
  assert.ok(attach.includes(`Content-Type: ${SHEET_MIME}; name="${FILE}"`));
  assert.ok(attach.includes(`Content-Disposition: attachment; filename="${FILE}"`));
  assert.ok(attach.includes('Content-Transfer-Encoding: base64'));
});

test('base64 attachment decodes byte-identical to the input bytes, wrapped at 76 cols', () => {
  const attach = draft().text.split(`--${BOUNDARY}`)[2];
  const b64 = attach.split('\r\n\r\n')[1].trim();
  const lines = b64.split('\r\n');
  for (const line of lines.slice(0, -1)) assert.equal(line.length, 76);
  assert.ok(lines[lines.length - 1].length <= 76);
  const decoded = new Uint8Array(Buffer.from(lines.join(''), 'base64'));
  assert.equal(decoded.length, BYTES.length);
  assert.deepEqual([...decoded], [...BYTES]);
});

test('To: is omitted when there are no recipients, present when there are', () => {
  for (const empty of [undefined, null, '', [], ['', '  '], '  ,  ;']) {
    const lines = headerBlock(draft({ recipients: empty }).text);
    assert.ok(!lines.some((l) => l.startsWith('To:')), `To: must be absent for ${JSON.stringify(empty)}`);
  }
  const withTo = headerBlock(draft({ recipients: ['a@lab.sa', 'b@lab.sa'] }).text);
  assert.ok(withTo.includes('To: a@lab.sa, b@lab.sa'));
  // Ordered right after Subject, before X-Unsent.
  const names = withTo.map((l) => l.slice(0, l.indexOf(':')));
  assert.equal(names.indexOf('To'), names.indexOf('Subject') + 1);
  assert.equal(names[names.indexOf('To') + 1], 'X-Unsent');
  // A comma/semicolon string works too, duplicates collapse.
  const str = headerBlock(draft({ recipients: 'x@lab.sa; y@lab.sa , x@lab.sa' }).text);
  assert.ok(str.includes('To: x@lab.sa, y@lab.sa'));
});

test('Arabic lab names are RFC 2047 encoded in Subject and in the attachment name', () => {
  const arabicLab = 'مختبر مدينة الملك عبدالله الطبية';
  const arabicFile = `${arabicLab} - TAT Late & Due.xlsx`;
  const { text, fileName } = buildLabEmailDraft({
    lab: arabicLab, fileName: arabicFile, xlsxBytes: BYTES, reportDate: '2026-07-09',
  });
  assert.equal(fileName, `${arabicLab} - Late Test Results.eml`);
  const subject = headerBlock(text).find((l) => l.startsWith('Subject:'));
  assert.ok(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/.test(subject), 'subject uses an encoded-word');
  assert.ok(!/[^\x00-\x7f]/.test(text), 'the whole message stays 7-bit ASCII');
  // Encoded words decode back to the exact subject, each word within the 75-char cap.
  assert.equal(decodeHeaderValue(subject), labEmailSubject(arabicLab));
  for (const w of subject.slice('Subject: '.length).split('\r\n ')) assert.ok(w.length <= 75, 'encoded-word ≤ 75 chars');
  assert.ok(/name="=\?UTF-8\?B\?/.test(text) && /filename="=\?UTF-8\?B\?/.test(text));
});

test('CRLF line endings throughout — no bare LF or bare CR', () => {
  const { text } = draft({ recipients: 'a@lab.sa' });
  assert.equal(countOf(text, '\n'), countOf(text, '\r\n'), 'every LF is preceded by CR');
  assert.equal(countOf(text, '\r'), countOf(text, '\r\n'), 'every CR is followed by LF');
  assert.ok(text.includes('\r\n\r\n'), 'blank line separates headers from the body');
});

test('the Date header comes only from the injected reportDate — never the wall clock', () => {
  assert.equal(formatMailDate('2026-07-09'), 'Thu, 9 Jul 2026 00:00:00 +0000');
  assert.equal(formatMailDate(Date.UTC(2026, 0, 1)), 'Thu, 1 Jan 2026 00:00:00 +0000');
  for (const bad of [undefined, null, '', 'not-a-date', NaN]) assert.equal(formatMailDate(bad), null);
  const noDate = headerBlock(draft({ reportDate: undefined }).text);
  assert.ok(!noDate.some((l) => l.startsWith('Date:')), 'Date header omitted when no reportDate');
  // Same inputs → byte-identical output (no clock, no randomness in the boundary).
  assert.equal(draft().text, draft().text);
});

test('POLICY: the module never reads the clock and never sends anything', () => {
  assert.equal(/Date\.now\(\)/.test(SRC), false, 'Date.now() must not appear in the module');
  // Executable code only — the header comment names these to forbid them.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const forbidden of ['mailto:', 'smtp', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'Math.random', 'navigator.']) {
    assert.equal(CODE.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} must not appear in code`);
  }
});

test('header injection via a CRLF-bearing lab name is neutralised', () => {
  const { text } = buildLabEmailDraft({
    lab: 'Evil\r\nBcc: attacker@example.com',
    fileName: 'a\r\nX-Bad: 1.xlsx',
    xlsxBytes: BYTES,
    reportDate: '2026-07-09',
  });
  assert.ok(!/^Bcc:/m.test(text));
  assert.ok(!/^X-Bad:/m.test(text));
  assert.equal(headerBlock(text).length, 5);
});
