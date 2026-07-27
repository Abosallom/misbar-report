#!/usr/bin/env node
// scripts/make-user.mjs — manage data/users.json, the per-user account file.
//
// USAGE
//   PASSPHRASE='…' node scripts/make-user.mjs add --user badr
//   PASSPHRASE='…' node scripts/make-user.mjs add --user badr --password '…'
//   node scripts/make-user.mjs remove --user badr
//   node scripts/make-user.mjs list
//   (any command) --file some/other/users.json    # default: data/users.json
//
// WHAT `add` DOES. It needs the SAME payload the shared gate hands out, so it reads
// data/access.seal and unseals it with the shared PASSPHRASE from the environment —
// that is the only way the secrets enter this process, and they are never written to
// disk in the clear, never printed, and never passed on the command line. It then
// re-seals that payload under the new user's own password and stores one row in
// data/users.json. Re-running `add` for an existing username REPLACES that row, which
// is how you reset somebody's password. `remove` deletes one row; everyone else's row
// is untouched, because every row is independently encrypted.
//
// WHY --password IS OPTIONAL AND USUALLY SHOULD BE OMITTED. Left out, the tool draws a
// 20-character password from a cryptographic RNG (~120 bits). It is printed EXACTLY
// ONCE, at the end of the run, and is unrecoverable afterwards — the file stores only
// the ciphertext it produced, never the password or a hash you could reverse. Copy it
// into a password manager before closing the terminal. Passing --password puts the
// secret in your shell history and process list; prefer the generated one.
//
// HONEST SECURITY MODEL — SAY THIS OUT LOUD TO WHOEVER YOU HAND AN ACCOUNT TO.
// data/users.json ships as a PUBLIC file on GitHub Pages, exactly like every other
// asset. Anyone who can open the page can download it, take it away, and grind guesses
// against a user's password offline, on their own hardware, as fast as they like. There
// is no server in this design, so nothing can rate-limit, lock out, or even notice that
// happening. The per-guess cost (PBKDF2-SHA256 × 310000, fresh 16-byte salt per row) and
// the strength of the password are the entire defence. That is why this tool REFUSES
// weak passwords instead of warning about them: a 9-character password here is not
// "slightly weaker", it is breakable on a laptop over a weekend.
//
// Crypto lives in src/auth/users.js (per-user rows) and src/ui/lock.js (the shared
// seal); this file only orchestrates them and does file I/O.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { unseal } from '../src/ui/lock.js';
import {
  sealForUser,
  normalizeUsername,
  listUsernames,
  PBKDF2_ITERATIONS,
} from '../src/auth/users.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_USERS = resolve(ROOT, 'data/users.json');
const DEFAULT_SEAL = resolve(ROOT, 'data/access.seal');

/** Current on-disk schema version of data/users.json. */
const FILE_VERSION = 1;
/** Minimum accepted password length. See the header for why this is a hard floor. */
const MIN_PASSWORD = 12;
/** Below this length we additionally demand 3 of the 4 character classes. */
const SHORTISH = 16;
/** Length of a generated password. */
const GEN_LENGTH = 20;

// ---- output helpers ----------------------------------------------------------
function say(line = '') {
  process.stdout.write(`${line}\n`);
}

function fail(msg) {
  process.stderr.write(`خطأ: ${msg}\n`);
  process.exit(1);
}

// ---- args ---------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--user') { args.user = argv[i + 1]; i += 1; }
    else if (a === '--password') { args.password = argv[i + 1]; i += 1; }
    else if (a === '--file') { args.file = argv[i + 1]; i += 1; }
    else if (a === '--seal') { args.seal = argv[i + 1]; i += 1; }
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  say('الاستخدام:');
  say("  PASSPHRASE='…' node scripts/make-user.mjs add --user NAME [--password PASS]");
  say('  node scripts/make-user.mjs remove --user NAME');
  say('  node scripts/make-user.mjs list');
  say('  خيارات إضافية: --file <path>  --seal <path>');
}

// ---- password strength ----------------------------------------------------------
// Every rule below exists because data/users.json is public and attackable offline.
// The checker reports WHICH RULE failed and never any part of the password itself.
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

const COMMON = [
  'password', 'passwd', 'qwerty', 'azerty', 'letmein', 'welcome', 'admin',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'master', 'shadow', 'superman', 'trustno1', 'changeme', 'secret', 'default',
  'misbar', 'kamc', 'seha', 'grafana', 'report', 'riyadh', 'hospital', 'lab',
];

function classCount(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 1;
  if (/[A-Z]/.test(pw)) n += 1;
  if (/[0-9]/.test(pw)) n += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) n += 1;
  return n;
}

function hasRun(pw, len = 4) {
  let run = 1;
  for (let i = 1; i < pw.length; i += 1) {
    run = pw[i] === pw[i - 1] ? run + 1 : 1;
    if (run >= len) return true;
  }
  return false;
}

function hasSequence(pw, len = 4) {
  const low = pw.toLowerCase();
  for (let i = 0; i + len <= low.length; i += 1) {
    const window = low.slice(i, i + len);
    const back = [...window].reverse().join('');
    for (const seq of SEQUENCES) {
      if (seq.includes(window) || seq.includes(back)) return true;
    }
  }
  return false;
}

/**
 * Reasons this password is not acceptable. Empty array = accepted.
 * Returns rule names in Arabic for direct printing; NEVER echoes the password or any
 * fragment of it, so the caller can print the whole list safely.
 * @param {string} pw
 * @param {string} username normalized — a password must not contain its own username
 * @returns {string[]}
 */
export function passwordProblems(pw, username = '') {
  const problems = [];
  const s = typeof pw === 'string' ? pw : '';

  if (s.length < MIN_PASSWORD) problems.push(`أقصر من ${MIN_PASSWORD} محرفاً`);
  if (new Set(s).size < 8) problems.push('يعتمد على عدد قليل جداً من المحارف المختلفة');
  if (hasRun(s)) problems.push('يحتوي على محرف مكرر ٤ مرات متتالية أو أكثر');
  if (hasSequence(s)) problems.push('يحتوي على تسلسل متوقع (مثل abcd أو 1234 أو qwer)');
  if (s.length < SHORTISH && classCount(s) < 3) {
    problems.push('أقل من ٣ أنواع من المحارف (حروف صغيرة/كبيرة/أرقام/رموز)');
  }
  const low = s.toLowerCase();
  if (COMMON.some((w) => low.includes(w))) problems.push('يحتوي على كلمة شائعة أو متوقعة');
  if (username && username.length >= 3 && low.includes(username.toLowerCase())) {
    problems.push('يحتوي على اسم المستخدم نفسه');
  }
  return problems;
}

// ---- password generation ---------------------------------------------------------
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz' // no l
  + 'ABCDEFGHJKLMNPQRSTUVWXYZ'               // no I, O
  + '23456789'                               // no 0, 1
  + '!@#$%^&*?-_=+';

/** Uniform index into ALPHABET via rejection sampling (no modulo bias). */
function randomIndex(bound) {
  const limit = Math.floor(0xffffffff / bound) * bound;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % bound;
  }
}

/**
 * A fresh strong password. Regenerates until it satisfies passwordProblems() AND uses
 * all four character classes, so a generated password can never trip our own checker.
 * @param {string} username normalized
 * @returns {string}
 */
export function generatePassword(username = '') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let pw = '';
    for (let i = 0; i < GEN_LENGTH; i += 1) pw += ALPHABET[randomIndex(ALPHABET.length)];
    if (classCount(pw) === 4 && passwordProblems(pw, username).length === 0) return pw;
  }
  // Unreachable in practice (each attempt succeeds with overwhelming probability).
  throw new Error('PASSWORD_GENERATION_FAILED');
}

// ---- users.json I/O ----------------------------------------------------------------
function emptyFile() {
  return { v: FILE_VERSION, iterations: PBKDF2_ITERATIONS, users: [] };
}

async function readUsersFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return emptyFile(); // first run — start fresh
    throw e;
  }
  if (!text.trim()) return emptyFile();

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    fail(`${path} ليس JSON صالحاً: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail(`${path} يجب أن يكون كائن JSON.`);
  if (doc.v !== FILE_VERSION) fail(`إصدار الملف غير مدعوم (v=${doc.v})، المتوقع v=${FILE_VERSION}.`);
  if (!Array.isArray(doc.users)) fail(`${path} لا يحتوي على مصفوفة users.`);
  return doc;
}

async function writeUsersFile(path, doc) {
  const ordered = {
    v: FILE_VERSION,
    iterations: PBKDF2_ITERATIONS,
    users: doc.users,
  };
  await writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

/** Unseal data/access.seal with PASSPHRASE and hand back the payload. */
async function loadPayload(sealPath) {
  const passphrase = process.env.PASSPHRASE;
  if (!passphrase) {
    fail('عيّن متغير البيئة PASSPHRASE (عبارة الوصول المشتركة) لقراءة data/access.seal.');
  }
  let sealB64;
  try {
    sealB64 = (await readFile(sealPath, 'utf8')).trim();
  } catch (_e) {
    fail(`تعذّرت قراءة ملف الختم: ${sealPath}`);
  }
  if (!sealB64) fail(`ملف الختم فارغ: ${sealPath}`);
  try {
    return await unseal(passphrase, sealB64);
  } catch (e) {
    const why = e && e.message === 'BAD_PASSPHRASE'
      ? 'عبارة الوصول المشتركة غير صحيحة'
      : `تعذّر فك الختم (${(e && e.message) || e})`;
    return fail(why);
  }
}

function requireUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) fail('مرّر --user <اسم المستخدم>.');
  if (u.length < 2 || u.length > 64) fail('اسم المستخدم يجب أن يكون بين ٢ و ٦٤ محرفاً.');
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\u0000-\u001f\u007f]/.test(u)) fail('اسم المستخدم يحتوي على محارف تحكّم.');
  return u;
}

function securityNote() {
  say('');
  say('تنبيه أمني: data/users.json ملف عام على الإنترنت — يمكن لأي شخص تنزيله');
  say('ومحاولة تخمين كلمات المرور دون اتصال وبلا أي حد للمحاولات. الحماية الوحيدة');
  say(`هي قوة كلمة المرور و PBKDF2-SHA256 × ${PBKDF2_ITERATIONS} مع ملح عشوائي لكل مستخدم.`);
}

// ---- commands -------------------------------------------------------------------
async function cmdAdd(args) {
  const usersPath = args.file ? resolve(process.cwd(), args.file) : DEFAULT_USERS;
  const sealPath = args.seal ? resolve(process.cwd(), args.seal) : DEFAULT_SEAL;
  const u = requireUsername(args.user);

  let password = args.password;
  let generated = false;
  if (password == null || password === '') {
    password = generatePassword(u);
    generated = true;
  } else {
    const problems = passwordProblems(password, u);
    if (problems.length) {
      process.stderr.write('خطأ: كلمة المرور ضعيفة ومرفوضة للأسباب التالية:\n');
      for (const p of problems) process.stderr.write(`  • ${p}\n`);
      process.stderr.write('احذف --password لتوليد كلمة مرور قوية تلقائياً.\n');
      process.exit(1);
    }
  }

  const payload = await loadPayload(sealPath);
  const doc = await readUsersFile(usersPath);
  const record = await sealForUser({ username: u, password, payload });

  const at = doc.users.findIndex((r) => r && normalizeUsername(r.u) === u);
  const replaced = at >= 0;
  if (replaced) doc.users[at] = record; else doc.users.push(record);
  await writeUsersFile(usersPath, doc);

  say(`✓ ${replaced ? 'حُدّث' : 'أُضيف'} المستخدم: ${u}`);
  say(`  الملف: ${usersPath}`);
  say(`  عدد المستخدمين الآن: ${doc.users.length}`);
  say(`  المعاملات: PBKDF2-SHA256 × ${PBKDF2_ITERATIONS} · AES-GCM-256`);
  if (generated) {
    say('');
    say('  ┌─────────────────────────────────────────────┐');
    say('  │ كلمة المرور — تُعرض مرة واحدة فقط ولا يمكن   │');
    say('  │ استرجاعها لاحقاً. انسخها الآن.               │');
    say('  └─────────────────────────────────────────────┘');
    say(`  ${u} : ${password}`);
  }
  securityNote();
}

async function cmdRemove(args) {
  const usersPath = args.file ? resolve(process.cwd(), args.file) : DEFAULT_USERS;
  const u = requireUsername(args.user);
  const doc = await readUsersFile(usersPath);

  const before = doc.users.length;
  doc.users = doc.users.filter((r) => !(r && normalizeUsername(r.u) === u));
  if (doc.users.length === before) fail(`لا يوجد مستخدم بالاسم: ${u}`);

  await writeUsersFile(usersPath, doc);
  say(`✓ حُذف المستخدم: ${u}`);
  say(`  الملف: ${usersPath}`);
  say(`  عدد المستخدمين الآن: ${doc.users.length}`);
  say('  لم يتأثر أي مستخدم آخر — كل سجل مُشفَّر باستقلال.');
}

async function cmdList(args) {
  const usersPath = args.file ? resolve(process.cwd(), args.file) : DEFAULT_USERS;
  const doc = await readUsersFile(usersPath);
  const names = listUsernames(doc);

  say(`الملف: ${usersPath}`);
  say(`عدد المستخدمين: ${names.length}`);
  if (names.length === 0) {
    say('(لا يوجد أي حساب بعد — أضف واحداً بالأمر add)');
  } else {
    for (const n of names) say(`  • ${n}`);
  }
  securityNote();
}

// ---- entry -------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || !cmd) { usage(); process.exit(args.help ? 0 : 1); }

  if (cmd === 'add') await cmdAdd(args);
  else if (cmd === 'remove') await cmdRemove(args);
  else if (cmd === 'list') await cmdList(args);
  else { process.stderr.write(`خطأ: أمر غير معروف: ${cmd}\n`); usage(); process.exit(1); }
}

// Run ONLY when invoked as a CLI. Without this guard, `import`ing this file to unit-test
// passwordProblems()/generatePassword() would execute main(), print usage, and exit(1)
// — killing the test runner. test/users.test.mjs relies on this being importable.
const invokedDirectly = !!process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((e) => {
    // Never print the error object wholesale: it could carry an argument value.
    process.stderr.write(`خطأ: ${(e && e.message) || 'فشل غير متوقع'}\n`);
    process.exit(1);
  });
}
