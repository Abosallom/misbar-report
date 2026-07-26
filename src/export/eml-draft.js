// export/eml-draft.js — build a per-lab Outlook DRAFT (.eml) carrying the team's
// standard "Late Test Results" wording plus the lab's Excel file as an attachment.
//
// ⚠ POLICY — THIS MODULE ONLY *PREPARES* A DRAFT. NOTHING IS EVER SENT.
//   No SMTP, no mailto:, no network call, no auto-open, no background delivery of
//   any kind exists here or may ever be added. The output is a file the user
//   downloads, opens in Outlook (X-Unsent: 1 makes it an editable draft, not a
//   received message), reviews, and sends with their OWN hand. A human press of
//   Send is the only path by which any of this reaches a recipient.
//
// PURE module: no DOM, no vendor imports, no wall-clock read (no reading the
// current time anywhere — the Date header comes only from the injected
// reportDate), so the browser and `node --test` share one deterministic path.
//
// Output = RFC 5322 message, CRLF line endings throughout, multipart/mixed:
//   headers  Date (only when reportDate resolves) · Subject · To (only when
//            recipients are given) · X-Unsent · MIME-Version · Content-Type
//   part 1   text/plain; charset="utf-8", base64 — the standard wording, verbatim
//   part 2   the .xlsx, base64 in 76-char lines, Content-Disposition: attachment
// Any non-ASCII in Subject / attachment file name is RFC 2047 encoded-word wrapped
// (=?UTF-8?B?…?=, ≤75 chars per word) — lab names come from CSV data and may be
// Arabic; an unencoded 8-bit header byte would make the message malformed. In To:
// the encoding is applied PER ADDRESS and only to a `Display Name <addr>` phrase —
// an encoded-word is illegal inside an addr-spec or around a whole address list.

/** Spreadsheet MIME type for the attachment part. */
export const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** MIME type of the produced .eml blob. */
export const EML_MIME = 'message/rfc822';

// Distinctive enough that it cannot occur inside base64 payloads or the wording.
const BOUNDARY = '----=_Misbar_LabDraft_Boundary_7c1f';

/**
 * The team's standard notification wording — the SINGLE source of truth shared by
 * the .eml body and the "نسخ نص البريد" clipboard button. Verbatim: do not reword.
 */
export const LAB_EMAIL_BODY = [
  'Dear all,',
  'This is a reminder regarding laboratory orders that require your attention.',
  'Some orders in the attached report are approaching their SLA deadline and will breach within the next 24 hours. These are flagged for priority and should be actioned urgently to avoid an SLA breach.',
  'Please confirm once the listed orders have been addressed. If you have any questions or are facing issues preventing fulfillment, let us know so we can support you.',
  'Please find the attachment for more info about the orders.',
  'Thank you for your cooperation.',
].join('\n\n');

/** Subject line for a lab — verbatim wording. */
export function labEmailSubject(lab) {
  return `${lab} | Late Test Results — Action Required`;
}

/** Subject + body, the exact text the copy-to-clipboard button puts on the clipboard. */
export function labEmailText(lab) {
  return `Subject: ${labEmailSubject(lab)}\n\n${LAB_EMAIL_BODY}`;
}

/** File name of a lab's draft. */
export function labDraftFileName(lab) {
  return `${lab} - Late Test Results.eml`;
}

// ── base64 ───────────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of a byte sequence (own encoder — btoa-free, works everywhere). */
function bytesToBase64(bytes) {
  const parts = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    chunk += B64[b0 >> 2];
    chunk += B64[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)];
    chunk += b1 < 0 ? '=' : B64[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)];
    chunk += b2 < 0 ? '=' : B64[b2 & 63];
    if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
  }
  parts.push(chunk);
  return parts.join('');
}

/** Break base64 into the MIME-canonical 76-char CRLF lines. */
function wrap76(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/** Anything byte-ish → Uint8Array (Uint8Array / ArrayBuffer / plain array). */
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return new Uint8Array(0);
}

const utf8 = (s) => new TextEncoder().encode(String(s));

// ── headers ──────────────────────────────────────────────────────────────────
const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

/** Collapse CR/LF/TAB/other controls to spaces — header values carry CSV-sourced
 *  lab names, and a bare CRLF inside a header would be a header-injection hole. */
const oneLine = (s) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/ +/g, ' ').trim();

/**
 * RFC 2047 encode a header value when it is not plain ASCII. Splits on code-point
 * boundaries into =?UTF-8?B?…?= words ≤75 chars, folded with CRLF + space.
 */
function encodeHeaderValue(value) {
  const s = oneLine(value);
  if (isAscii(s)) return s;
  // 45 source bytes → 60 base64 chars; + '=?UTF-8?B?' (10) + '?=' (2) = 72 ≤ 75.
  const MAX_BYTES = 45;
  const words = [];
  let buf = [];
  let size = 0;
  for (const cp of Array.from(s)) {
    const b = utf8(cp);
    if (size + b.length > MAX_BYTES && buf.length) {
      words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(buf))}?=`);
      buf = []; size = 0;
    }
    for (const byte of b) buf.push(byte);
    size += b.length;
  }
  if (buf.length) words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(buf))}?=`);
  return words.join('\r\n ');
}

/** Quote-safe parameter value for name=/filename= (RFC 2047 when non-ASCII). */
function encodeParamValue(value) {
  const s = oneLine(value).replace(/[\\"]/g, '_');
  return isAscii(s) ? s : encodeHeaderValue(s);
}

/**
 * RFC 2047 ONE address entry. Encoded-words are not legal inside an addr-spec nor
 * anywhere in an address list except a display-name phrase, so encoding a whole
 * `To:` value would collapse the list into a single unresolvable recipient. Plain
 * ASCII passes through verbatim; for `اسم المختبر <lab@x.com>` only the phrase is
 * encoded. An entry whose addr-spec itself carries non-ASCII cannot be represented
 * in a header at all — it is dropped ('') rather than turned into a bogus address.
 */
function encodeAddress(entry) {
  const s = oneLine(entry);
  if (!s || isAscii(s)) return s;
  const m = /^(.*?)\s*<([^<>]*)>$/.exec(s);
  if (!m) return '';
  const addr = m[2].trim();
  if (!addr || !isAscii(addr)) return '';
  const phrase = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
  return phrase ? `${encodeHeaderValue(phrase)} <${addr}>` : `<${addr}>`;
}

/** Recipients (string | string[]) → a clean, header-ready comma-separated To:, or ''. */
function normalizeRecipients(recipients) {
  const list = Array.isArray(recipients)
    ? recipients
    : String(recipients == null ? '' : recipients).split(/[,;]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const addr = oneLine(raw).replace(/,/g, ' ').trim();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    const enc = encodeAddress(addr);
    if (enc) out.push(enc);
  }
  return out.join(', ');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * RFC 5322 date from the INJECTED report date ('YYYY-MM-DD', or epoch-ms), anchored
 * at 00:00:00 +0000. Returns null (→ header omitted) when nothing usable is given —
 * the current time is never consulted, so output stays byte-stable across runs.
 */
export function formatMailDate(reportDate) {
  let ms = null;
  if (typeof reportDate === 'number' && Number.isFinite(reportDate)) {
    ms = reportDate;
  } else if (typeof reportDate === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(reportDate.trim());
    if (m) ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0000`;
}

/**
 * Build one lab's ready-to-review Outlook draft. NOTHING IS SENT — the caller
 * downloads the file and the user presses Send in Outlook themselves.
 *
 * @param {object} args
 * @param {string} args.lab          Performing lab name (may be Arabic).
 * @param {string} [args.fileName]   Attachment file name (defaults to `${lab} - TAT Late & Due.xlsx`).
 * @param {Uint8Array|ArrayBuffer|number[]} args.xlsxBytes  The workbook bytes.
 * @param {string|string[]} [args.recipients]  To: addresses; omitted entirely when empty.
 * @param {string|number} [args.reportDate]    'YYYY-MM-DD' or epoch-ms; omitted when absent.
 * @returns {{fileName:string, blob:Blob, text:string}} `.eml` name + blob (+ raw message).
 */
export function buildLabEmailDraft({
  lab, fileName, xlsxBytes, recipients, reportDate,
} = {}) {
  const labName = oneLine(lab) || 'Lab';
  const attachName = oneLine(fileName) || `${labName} - TAT Late & Due.xlsx`;
  const to = normalizeRecipients(recipients);
  const date = formatMailDate(reportDate);
  const param = encodeParamValue(attachName);

  const headers = [];
  if (date) headers.push(`Date: ${date}`);
  headers.push(`Subject: ${encodeHeaderValue(labEmailSubject(labName))}`);
  if (to) headers.push(`To: ${to}`); // already per-address encoded by normalizeRecipients
  headers.push('X-Unsent: 1');
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);

  const bodyText = LAB_EMAIL_BODY.replace(/\r?\n/g, '\r\n');

  const lines = [
    ...headers,
    '',
    'This is a multi-part message in MIME format.',
    '',
    `--${BOUNDARY}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(utf8(bodyText))),
    '',
    `--${BOUNDARY}`,
    `Content-Type: ${SHEET_MIME}; name="${param}"`,
    `Content-Disposition: attachment; filename="${param}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(toBytes(xlsxBytes))),
    '',
    `--${BOUNDARY}--`,
    '',
  ];
  const text = lines.join('\r\n');

  return { fileName: labDraftFileName(labName), blob: new Blob([text], { type: EML_MIME }), text };
}

export default buildLabEmailDraft;
