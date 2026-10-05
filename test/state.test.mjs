// test/state.test.mjs — `node --test test/state.test.mjs`
//
// THE GUARD BEHIND THE FILTERED CSV DOWNLOAD. state.parsed.raw holds the uploaded
// file's ORIGINAL rows — every column, patient names and IDs included — and the
// download looks each exported order up by raw.records[order.lineNo]. That lookup is
// only right while raw and orders come from the SAME upload. If new orders arrive
// from anywhere else (the live pull, the encrypted snapshot, the automation's own
// pull step, which assigns theState.parsed.orders directly and does not know raw
// exists) and an old raw survived, the line numbers would point at a DIFFERENT
// patient's row. state.js closes that with an accessor: assigning a different orders
// array drops raw. Nothing pinned it until now — this file does.
import test from 'node:test';
import assert from 'node:assert/strict';

import { state, resetRunData } from '../src/state.js';

// Synthetic only: no real row ever enters a test.
const RAW = Object.freeze({ fields: ['Order ID', 'Patient Name'], records: [{ 'Order ID': '1', 'Patient Name': 'مريض تجريبي' }], fileName: 'A.csv' });
const ordersA = [{ orderId: '1', lineNo: 0 }];

test('a CSV upload pairs orders with raw (orders FIRST, then raw — as screen-upload does)', () => {
  resetRunData();
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  assert.equal(state.parsed.raw, RAW);
});

test('re-assigning the SAME orders array keeps raw', () => {
  resetRunData();
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  state.parsed.orders = ordersA;
  assert.equal(state.parsed.raw, RAW, 'a no-op re-assignment must not lose the upload');
});

test('ANY other orders array drops raw — the automation pull step writes orders directly', () => {
  resetRunData();
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  // Exactly what automation/pipeline.js's pull step does, with no thought of raw:
  state.parsed.orders = [{ orderId: '1', lineNo: 0 }];
  assert.equal(state.parsed.raw, null, 'old patient rows must never pair with new orders');
});

test('clearing the orders drops raw too', () => {
  resetRunData();
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  state.parsed.orders = null;
  assert.equal(state.parsed.raw, null);
});

test('resetRunData starts with no raw', () => {
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  resetRunData();
  assert.equal(state.parsed.raw, null);
  assert.equal(state.parsed.orders, null);
});

test('the accessor is not lost by reset — a fresh parsed object still guards', () => {
  resetRunData();
  state.parsed.orders = ordersA;
  state.parsed.raw = RAW;
  state.parsed.orders = [];
  assert.equal(state.parsed.raw, null);
});
