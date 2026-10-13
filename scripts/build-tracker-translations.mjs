#!/usr/bin/env node
// build-tracker-translations.mjs — encrypt the reviewed Arabic for the project tracker
// («متابعة المشروع») into data/tracker-ar.enc, the BUILT-IN translation memory the app
// applies automatically to the user's normal English tracker
// (model/tracker-translate.js layer 'builtin', ingest/tracker-translations.js).
//
// WHY ENCRYPTED, NOT A PLAIN SEED: the entries are the project's own task list (and its
// Arabic), and the repo is PUBLIC. It ships as ciphertext exactly like
// data/sendout-master.enc and data/kamc-live.enc: only a signed-in user, whose access seal
// carries the data key, can read it. The published file reveals nothing, and the plaintext
// JSON this script reads is never written into the repo.
//
// Re-run whenever the reviewed translations change:
//   DATA_KEY=<64 hex chars> node scripts/build-tracker-translations.mjs "<translations.json>" [out.enc]
//
// Input (plaintext JSON, kept OUTSIDE the repo):
//   {"tasks": {"<English task>": "<Arabic>"}, "tracks": {...}, "milestones": {...}}
// Keys are the ENGLISH texts as they appear in the workbook; they are normalised here with
// the app's own normEn (whitespace / case tolerant), so the lookup can never drift from
// the build. Empty Arabic values are skipped; two English spellings that normalise to the
// same key keep the FIRST and are reported.
//
// Output (default data/tracker-ar.enc, relative to the working directory):
//   base64( iv(12) || AES-256-GCM ciphertext+tag ) of
//   {"generatedAt": "...", "entries": {"tasks": {normEn: ar}, "tracks": {...}, "milestones": {...}}}
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { normEn, TM_KEY_MAX, TM_VALUE_MAX } from '../src/model/tracker-translate.js';

const src = process.argv[2];
const out = process.argv[3] || 'data/tracker-ar.enc';
if (!src) {
  console.error('usage: DATA_KEY=<64 hex> node scripts/build-tracker-translations.mjs "<translations.json>" [out.enc]');
  process.exit(1);
}
const keyHex = (process.env.DATA_KEY || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error('DATA_KEY must be 64 hex chars (the same key that encrypts data/kamc-live.enc)');
  process.exit(1);
}

let input;
try {
  input = JSON.parse(readFileSync(src, 'utf8'));
} catch (e) {
  console.error(`cannot read ${src} as JSON: ${e.message}`);
  process.exit(1);
}
if (!input || typeof input !== 'object' || Array.isArray(input)) {
  console.error('the input must be an object {tasks, tracks, milestones}');
  process.exit(1);
}

const KINDS = ['tasks', 'tracks', 'milestones'];
const entries = {};
const counts = {};
let duplicates = 0;
let skipped = 0;
for (const kind of KINDS) {
  const map = input[kind];
  entries[kind] = {};
  if (map == null) { counts[kind] = 0; continue; }
  if (typeof map !== 'object' || Array.isArray(map)) {
    console.error(`"${kind}" must be an object {english: arabic}`);
    process.exit(1);
  }
  for (const [en, ar] of Object.entries(map)) {
    const key = normEn(en);
    const val = typeof ar === 'string' ? ar.trim() : '';
    if (!key || !val || key.length > TM_KEY_MAX || val.length > TM_VALUE_MAX) { skipped++; continue; }
    // First spelling wins; a second one that normalises the same is reported, not merged.
    if (key in entries[kind]) {
      if (entries[kind][key] !== val) duplicates++;
      continue;
    }
    entries[kind][key] = val;
  }
  counts[kind] = Object.keys(entries[kind]).length;
}
if (!KINDS.some((k) => counts[k] > 0)) { console.error('no usable entries found'); process.exit(1); }

// generatedAt is the INPUT's mtime, not the clock: re-running on an unchanged file
// produces identical plaintext, so only a real content change is worth committing.
const generatedAt = statSync(src).mtime.toISOString();
const plaintext = Buffer.from(JSON.stringify({ generatedAt, entries }), 'utf8');

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
const enc = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([iv, enc]).toString('base64'));

// Counts only — never echo an entry: this output lands in terminals and logs.
console.log(`tracker-translations: wrote ${out} (encrypted)`);
console.log(`  ${counts.tasks} tasks · ${counts.tracks} tracks · ${counts.milestones} milestones`
  + ` · ${skipped} empty/oversized skipped · ${duplicates} conflicting duplicates (first kept)`);
console.log('  NOTE: the plaintext translations are never written to the repo.');
