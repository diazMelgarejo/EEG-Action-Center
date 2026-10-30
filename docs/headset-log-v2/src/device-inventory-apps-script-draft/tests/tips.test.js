// Tests for Tips.gs (run with: node --test tests/tips.test.js). Pure logic; the answers must equal tip_proposals.py.
/* global AGREE, DECIDE, EMPTY, USE_WORKBOOK, USE_LEGEND, HOLD, SETUP_STEPS */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['Rules.gs', 'Tips.gs']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const R = globalThis;

const day = (s) => (s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null);
const row = (number, date, time, lab, change) => ({ number, date: day(date), time, lab, type: 'Headset', change, notes: '' });
const ROWS = [row(10, '2026-03-01', '09:00', 'Lab 1', 7001), row(11, '2026-05-01', '09:00', 'Lab 1', 7002), row(12, '2026-03-01', '09:00', 'Lab 2', 7003),
  row(13, '2026-05-01', '', 'Lab 3', 7004), row(14, '2026-05-01', '10:00', 'None', 7005), row(15, null, '', 'Lab 2', 7099)];
const legend = (labs, holding) => ({ labs: labs || {}, holding: holding || {} });
const keyed = (proposals) => Object.fromEntries(proposals.map((p) => [p.key, p]));

test('the latest dated row per lab is the workbook tip, and undated rows are never a tip', () => {
  const got = keyed(R.proposeTips(ROWS, legend({ 'Lab 1': 7002, 'Lab 2': 7003, 'Lab 3': 7004 }), 3));
  assert.deepEqual([got['Lab 1'].workbook, got['Lab 1'].workbookRow, got['Lab 1'].status], [7002, 11, AGREE]);
  assert.equal(got['Lab 2'].workbook, 7003);
});

test('a disagreement needs a decision and offers both sources', () => {
  const got = keyed(R.proposeTips(ROWS, legend({ 'Lab 1': 7001 }), 1))['Lab 1'];
  assert.deepEqual([got.status, got.options], [DECIDE, [USE_WORKBOOK, USE_LEGEND, HOLD]]);
  assert.ok(got.reason.includes('7002') && got.reason.includes('7001'));
});

test('an empty lab with no evidence is empty, and a text legend cell needs a decision', () => {
  assert.deepEqual([keyed(R.proposeTips([], legend(), 1))['Lab 1'].status, keyed(R.proposeTips([], legend(), 1))['Lab 1'].options], [EMPTY, []]);
  const got = keyed(R.proposeTips(ROWS, legend({ 'Lab 1': '7002 = 7001' }), 1))['Lab 1'];
  assert.ok(got.reason.includes('not a single serial'));
  assert.deepEqual(got.options, [USE_WORKBOOK, HOLD]);
});

test('an undecided disagreement blocks seeding; a decision unblocks it', () => {
  const leg = legend({ 'Lab 1': 7001, 'Lab 2': 7003, 'Lab 3': 7004 });
  const props = R.proposeTips(ROWS, leg, 3);
  const base = { 'serial 7005': 'Spare', 'serial 7002': 'Retired' };
  const blocked = R.resolveTips(props, base, ROWS);
  assert.deepEqual(blocked.unresolved.map(([k]) => k), ['Lab 1']);
  assert.deepEqual(blocked.seedTable, []);
  const done = R.resolveTips(props, { ...base, 'Lab 1': USE_LEGEND }, ROWS);
  assert.deepEqual(done.unresolved, []);
  assert.equal(done.seedTable[0][5], '7001');
});

test('seed rows pass the ledger schema and keep real dates and blank times', () => {
  const leg = legend({ 'Lab 1': 7002, 'Lab 2': 7003, 'Lab 3': 7004 });
  const result = R.resolveTips(R.proposeTips(ROWS, leg, 3), { 'serial 7001': 'Retired', 'serial 7005': 'Spare' }, ROWS);
  assert.deepEqual(result.seedTable[0].slice(0, 6), ['May 01, 2026', '09:00', '2026/05/01  09:00:00', 'Lab 1', 'Headset', '7002']);
  assert.deepEqual([result.seedTable[2][1], result.seedTable[2][8]], ['', 'unknown']);
  const ledger = R.rowsFromSeed(result.seedTable);
  assert.equal(R.findViolations(ledger).length, 0);
  assert.equal(R.currentPlace(ledger, 7001), 'Retired');
});

test('setup progress: first gap is next, later steps wait, an unknown step is refused', () => {
  const steps = R.setupProgress({ [SETUP_STEPS[0]]: true, [SETUP_STEPS[1]]: true });
  assert.deepEqual(steps.slice(0, 4).map(([, s]) => s), ['done', 'done', 'next', 'waiting']);
  assert.deepEqual(R.progressFraction(steps), [2, SETUP_STEPS.length]);
  assert.throws(() => R.setupProgress({ 'Made up': true }));
});

// Answers computed by the Python source (python3 ../parity_check.py). Tips.gs must match them exactly.
const PARITY = path.join(__dirname, 'parity.json');
const parity = fs.existsSync(PARITY) ? JSON.parse(fs.readFileSync(PARITY, 'utf8')).tips : null;
const rowsOf = (table) => table.map(([number, date, time, lab, type, change, notes]) => ({ number, date: day(date), time, lab, type, change, notes }));
const plain = (p) => [p.key, p.place, p.workbook, p.workbookRow, p.legend, p.legendText, p.status, p.reason, p.options];
const json = (value) => JSON.parse(JSON.stringify(value));

test('proposals match Python for every legend', { skip: !parity }, () => {
  const rows = rowsOf(parity.rows);
  for (const [name, leg] of Object.entries(parity.legends)) {
    assert.deepEqual(json(R.proposeTips(rows, leg, 6).map(plain)), parity.proposals[name], name);
  }
});

test('every decision case resolves exactly as Python does', { skip: !parity }, () => {
  const rows = rowsOf(parity.rows);
  for (const c of parity.cases) {
    const got = R.resolveTips(R.proposeTips(rows, parity.legends[c.legend], 6), c.decisions, rows);
    assert.deepEqual(json({ seed: got.seedTable, unresolved: got.unresolved, extra: got.extra.map(plain), held: got.held }), c.expected, c.name);
  }
});

test('setup progress matches Python', { skip: !parity }, () => {
  assert.deepEqual([...SETUP_STEPS], parity.steps);
  for (const c of parity.progress) assert.deepEqual(json(R.setupProgress(c.facts)), c.expected);
});
