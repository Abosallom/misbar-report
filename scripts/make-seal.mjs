#!/usr/bin/env node
// scripts/make-seal.mjs — build data/access.seal for the static Misbar site.
//
// Usage:
//   PASSPHRASE='…' PAYLOAD_JSON='{"grafana":{…}}' node scripts/make-seal.mjs
//   PASSPHRASE='…' node scripts/make-seal.mjs --payload-file payload.json
//   (optional) --out some/other/path.seal
//
// The passphrase never lands on disk; only the sealed base64 blob is written.
// Crypto parameters (PBKDF2 iterations, salt/iv sizes, cipher) are shared with
// the browser lock screen by importing seal()+SEAL from src/ui/lock.js.

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { seal, SEAL } from '../src/ui/lock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_OUT = resolve(ROOT, 'data/access.seal');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--payload-file') args.payloadFile = argv[i + 1], (i += 1);
    else if (a === '--out') args.out = argv[i + 1], (i += 1);
  }
  return args;
}

function fail(msg) {
  console.error(`خطأ: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const passphrase = process.env.PASSPHRASE;
  if (!passphrase) fail('عيّن متغير البيئة PASSPHRASE.');

  let payloadText;
  if (args.payloadFile) {
    payloadText = await readFile(resolve(process.cwd(), args.payloadFile), 'utf8');
  } else if (process.env.PAYLOAD_JSON) {
    payloadText = process.env.PAYLOAD_JSON;
  } else {
    fail('مرّر --payload-file <path> أو عيّن متغير البيئة PAYLOAD_JSON.');
  }

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (e) {
    fail(`المحتوى ليس JSON صالحاً: ${e.message}`);
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('يجب أن يكون المحتوى كائن JSON (object).');
  }

  // Stamp grantedAt if the author didn't supply one.
  if (!payload.grantedAt) payload.grantedAt = new Date().toISOString();

  const b64 = await seal(passphrase, payload);
  const outPath = args.out ? resolve(process.cwd(), args.out) : DEFAULT_OUT;
  await writeFile(outPath, b64, 'utf8');

  const bytes = Buffer.byteLength(b64, 'utf8');
  console.log(`✓ كُتب الختم: ${outPath}`);
  console.log(`  الحجم: ${bytes} بايت (base64)`);
  console.log(`  المعاملات: PBKDF2-${SEAL.HASH} × ${SEAL.PBKDF2_ITERATIONS} · ${SEAL.CIPHER}-${SEAL.KEY_BITS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
