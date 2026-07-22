#!/usr/bin/env node
// stamp-version.mjs — deploy cache-buster stamper (no deps).
//
// WHY: index.html entry files carry ?v= cache-busters, but INTERNAL module
// imports inside src/ are bare relative specifiers ('./x.js'). Browsers apply
// heuristic caching to those sub-modules, so after a deploy users can run the
// new entry file while it pulls STALE cached inner modules — the version chip
// says "new" while half the app is old. This script appends ?v=<APP_VERSION>
// to every relative import specifier in src/**/*.js so the whole module graph
// is versioned and busts together.
//
// WHAT IT TOUCHES:
//   • src/**/*.{js,mjs} — every CODE-CONTEXT string literal whose whole content
//     is a relative module path (starts with ./ or ../, ends in .js/.mjs, plus
//     an optional existing query). That single rule covers all the ways this
//     app names a module:
//       - static  `import ... from './x.js'`  /  `export ... from './x.js'`
//       - dynamic `import('./x.js')` and `tryImport('./x.js')`
//       - REGISTRY literals loaded via `import(variable)` — e.g. main.js's
//         SCREEN_MODULES map { upload: './ui/screen-upload.js', ... }. These are
//         plain object values, not `import(...)` call arguments, so an
//         import-syntax-only stamper MISSES them and every routed screen loads
//         stale after a deploy (the "new chip, old screen" bug). Treating any
//         relative-module-path string literal as a specifier catches them.
//     Any existing ?v=... query is stripped first, so the script is idempotent.
//   • index.html — every existing ?v=... on <link>/<script> is rewritten to
//     the current APP_VERSION.
//
// WHAT IT LEAVES ALONE: scripts/, test/, vendor/ file CONTENTS; bare/package
// specifiers; non-module strings; JSDoc `import('./x.js').Type` type-refs (they
// live in comments, which are never code-context strings). Imports POINTING at
// ../vendor/*.mjs from src ARE stamped (they are real relative specifiers).
// Only single/double-quoted literals are considered — template literals and
// variables are left alone (a module path here is never dynamically built).
//
// Env: STAMP_SKIP=comma,separated,repo-relative,paths — files to leave
// untouched this run (used when a concurrent worker owns a file). Default none.
//
// Usage: node scripts/stamp-version.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- 1. read APP_VERSION ----------------------------------------------------
const versionSrc = readFileSync(join(ROOT, 'src/version.js'), 'utf8');
const vm = versionSrc.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!vm) {
  console.error('stamp-version: could not find APP_VERSION in src/version.js');
  process.exit(1);
}
const VERSION = vm[1];

const SKIP = new Set(
  (process.env.STAMP_SKIP || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// ---- code-context string scanner --------------------------------------------
// Walk the source with a small state machine and collect the interior span of
// every single/double-quoted string literal that begins in CODE context. This
// deliberately ignores:
//   • comments (line + block) — a quote inside a comment never starts a string,
//     so JSDoc `import('./x.js').Type` type-refs are never collected;
//   • template literals — module paths here are always static, never built;
//   • quotes nested inside another string — only the OUTER literal is a code
//     string, so `"look at './y.js'"` yields one span (the whole thing), whose
//     content is not a bare module path and is therefore left alone.
// Escapes (\\) are honoured when finding the closing quote.
function codeStrings(src) {
  const n = src.length;
  const spans = [];
  let state = 'code'; // code | line | block | str | tpl
  let quote = '';
  let openIdx = -1;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"') { state = 'str'; quote = c; openIdx = i; i++; continue; }
      if (c === '`') { state = 'tpl'; i++; continue; }
      i++; continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; i++; continue; }
    if (state === 'block') { if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; } i++; continue; }
    if (state === 'str') {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { spans.push({ start: openIdx + 1, end: i }); state = 'code'; i++; continue; }
      i++; continue;
    }
    // tpl
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { state = 'code'; i++; continue; }
    i++; continue;
  }
  return spans;
}

// A string literal's ENTIRE content is a relative module path: ./ or ../ ...
// ending in .js/.mjs, with an optional existing query (which we strip + re-add).
const SPEC_RE = /^(\.\.?\/[^'"?]+\.(?:js|mjs))(\?[^'"]*)?$/;

// Stamp one file's text. Returns { text, count }.
function stampContent(src) {
  const edits = [];
  for (const s of codeStrings(src)) {
    const content = src.slice(s.start, s.end);
    const m = SPEC_RE.exec(content);
    if (!m) continue;
    edits.push({ start: s.start, end: s.end, text: `${m[1]}?v=${VERSION}` });
  }
  if (edits.length === 0) return { text: src, count: 0 };
  edits.sort((a, b) => a.start - b.start);

  let out = '';
  let cur = 0;
  for (const e of edits) {
    if (e.start < cur) continue; // guard against overlap (shouldn't happen)
    out += src.slice(cur, e.start) + e.text;
    cur = e.end;
  }
  out += src.slice(cur);
  return { text: out, count: edits.length };
}

// ---- 2. walk src and stamp --------------------------------------------------
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

let filesChanged = 0;
let filesSkipped = 0;
let specStamped = 0;
const skippedList = [];

for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file);
  if (SKIP.has(rel)) { filesSkipped++; skippedList.push(rel); continue; }
  const src = readFileSync(file, 'utf8');
  const { text, count } = stampContent(src);
  specStamped += count;
  if (text !== src) {
    writeFileSync(file, text);
    filesChanged++;
  }
}

// ---- 3. rewrite index.html ?v= on <link>/<script> ---------------------------
const indexPath = join(ROOT, 'index.html');
const indexSrc = readFileSync(indexPath, 'utf8');
let indexHits = 0;
const indexOut = indexSrc.replace(/\?v=[^"'\s>&]*/g, () => {
  indexHits++;
  return `?v=${VERSION}`;
});
if (indexOut !== indexSrc) writeFileSync(indexPath, indexOut);

// ---- 4. summary -------------------------------------------------------------
console.log(`stamp-version: APP_VERSION = ${VERSION}`);
console.log(`  src files changed : ${filesChanged}`);
console.log(`  specifiers stamped: ${specStamped}`);
console.log(`  index.html ?v=    : ${indexHits} rewritten`);
if (filesSkipped) console.log(`  skipped (STAMP_SKIP): ${filesSkipped} -> ${skippedList.join(', ')}`);
