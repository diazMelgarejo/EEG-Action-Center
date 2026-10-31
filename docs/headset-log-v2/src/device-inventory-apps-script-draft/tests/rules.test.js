// Tests for Rules.gs (run with: node --test tests/rules.test.js). Rules.gs has no Google services, so it runs in plain Node.
/* global HARDWARE_COLUMNS, LEDGER_COLUMNS, SEED_COLUMNS, DATE_DISPLAY, TIME_DISPLAY, DATE_TIME_DISPLAY */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'Rules.gs'), 'utf8'));
const R = globalThis;

const day = (d, h = 9, m = 0) => new Date(2026, 10, d, h, m);
const NOW = day(20, 15, 30);
const seedRow = (when, serial, place, id) => R.rowAt(when, serial, place, 'stated', 'tip', { id: id || `s${serial}-${place}` });
const ledgerOf = (...rows) => rows.map(([when, serial, place], i) => seedRow(when, serial, place, `s${i}`));
const baseEntry = (over) => ({ action: 'in', email: 'a.person@example.org', lab: 'Lab 5', serial: 2222, date: new Date(2026, 10, 3), time: '09:00', timeBasis: 'stated', group: 'g1', source: 'form', ...over });
const options = { domain: 'example.org', now: NOW };
const shared = (ledger, over) => ({ ledger, when: day(2), timeBasis: 'stated', group: 'g', source: 'form', ...over });

test('the schema leads with the Hardware changes columns', () => {
  assert.deepEqual(HARDWARE_COLUMNS, ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes']);
  assert.deepEqual(LEDGER_COLUMNS.slice(0, 7), HARDWARE_COLUMNS);
});

test('Date&Time is derived, never stored, and blank unless both inputs exist', () => {
  const row = R.makeRow({ date: new Date(2021, 0, 15), time: '12:15', lab: 'Lab 12', type: 'Headset', change: 7001, dateTime: new Date(2000, 0, 1) });
  assert.equal(R.dateTime(row).getTime(), new Date(2021, 0, 15, 12, 15).getTime());
  assert.equal('dateTime' in row, false);
  assert.equal(R.dateTime(R.makeRow({ date: new Date(2021, 0, 15), time: '', lab: 'Lab 12', type: 'Headset', change: 1 })), null);
});

test('bad values cannot be constructed', () => {
  const good = { date: new Date(2021, 0, 15), time: '12:15', lab: 'Lab 12', type: 'Headset', change: 1 };
  for (const over of [{ date: '2026-10-11' }, { date: new Date(2021, 0, 15, 3) }, { time: '12:15:30' }, { time: '25:00' }, { date: null }, { lab: 'Lab X' }, { lab: 'None' }, { lab: 'Spare' }, { type: 'Thing' }, { change: '1' }]) {
    assert.throws(() => R.makeRow({ ...good, ...over }), undefined, JSON.stringify(over));
  }
  assert.throws(() => R.makeRow({ ...good, holding: 'Spare' }));
  assert.equal(R.placeOf(R.makeRow({ lab: 'None', holding: 'Spare', type: 'Headset', change: 1 })), 'Spare');
});

test('text is the sheet display format', () => {
  const row = R.makeRow({ date: new Date(2021, 0, 15), time: '12:15', lab: 'Lab 12', type: 'Headset', change: 7001 });
  assert.deepEqual(R.hardwareText(row), ['January 15, 2021', '12:15', '2021/01/15  12:15:00', 'Lab 12', 'Headset', '7001', '']);
  assert.equal(R.timeFraction('08:00'), 1 / 3);
});

test('a row stores one UTC text, and a date with no time stays a date', () => {
  const row = R.makeRow({ date: new Date(2030, 0, 15), time: '03:00', lab: 'Lab 2', type: 'Headset', change: 1 });
  assert.equal(R.utcText(row), '2030-01-15T03:00:00Z');
  const back = R.parseUtcText('2030-01-15T03:00:00Z');
  assert.deepEqual([R.isoDate(back.date), back.time], ['2030-01-15', '03:00']);
  assert.equal(R.utcText(R.makeRow({ date: new Date(2030, 0, 15), lab: 'Lab 2', type: 'Headset', change: 1 })), '2030-01-15');
  assert.equal(R.parseUtcText('2030-01-15').time, '');
  assert.equal(R.parseUtcText('').date, null);
  for (const bad of ['15/01/2030', '2030-01-15 03:00', '2030-01-15T03:00:00+08:00']) assert.throws(() => R.parseUtcText(bad));
  assert.equal(R.dateSerial(2030, 1, 15), 47498);
});

test('assigning into an empty lab makes one row', () => {
  const rows = R.intoLab(shared([], { serial: 7006, lab: 'Lab 5' }));
  assert.equal(rows.length, 1);
  assert.equal(R.placeOf(rows[0]), 'Lab 5');
});

test('assigning into an occupied lab is a two-row swap at one time', () => {
  const rows = R.intoLab(shared(ledgerOf([day(1), 1111, 'Lab 5']), { serial: 2222, lab: 'Lab 5' }));
  assert.equal(rows.length, 2);
  assert.equal(R.dateTime(rows[0]).getTime(), R.dateTime(rows[1]).getTime());
  assert.deepEqual(rows.map((r) => [r.change, R.placeOf(r)]), [[2222, 'Lab 5'], [1111, 'Spare']]);
  assert.deepEqual([rows[1].lab, rows[1].holding], ['None', 'Spare']);
});

test('displaced headset can go to For repair but never to Retired or unknown', () => {
  const args = shared(ledgerOf([day(1), 1111, 'Lab 5']), { serial: 2222, lab: 'Lab 5' });
  assert.equal(R.placeOf(R.intoLab({ ...args, displacedTo: 'For repair' })[1]), 'For repair');
  assert.throws(() => R.intoLab({ ...args, displacedTo: 'Retired' }));
  assert.throws(() => R.intoLab({ ...args, displacedTo: 'unknown' }));
});

test('moving between labs into an occupied lab empties the first lab', () => {
  const led = ledgerOf([day(1), 1111, 'Lab 5'], [day(1), 2222, 'Lab 7']);
  const full = led.concat(R.intoLab(shared(led, { serial: 2222, lab: 'Lab 5' })));
  assert.equal(R.labDisplay(full, 'Lab 7'), null);
  assert.equal(R.labDisplay(full, 'Lab 5'), 2222);
});

test('a matching pull-out is one row and needs a real destination', () => {
  const args = shared(ledgerOf([day(1), 1111, 'Lab 5']), { serial: 1111, lab: 'Lab 5' });
  assert.equal(R.outOfLab({ ...args, destination: 'Spare' }).length, 1);
  for (const bad of [null, '', 'unknown', 'Unknown', 'None']) {
    assert.throws(() => R.outOfLab({ ...args, destination: bad }));
  }
});

test('a mismatched pull-out makes the auto pair with a one-minute gap and the displaced row', () => {
  const rows = R.outOfLab(shared(ledgerOf([day(1), 1111, 'Lab 5']), { serial: 2222, lab: 'Lab 5', destination: 'Spare', when: day(3) }));
  assert.equal(rows.length, 3);
  const pick = (s, p) => rows.find((r) => r.change === s && R.placeOf(r) === p);
  assert.equal(R.dateTime(pick(2222, 'Spare')) - R.dateTime(pick(2222, 'Lab 5')), 60000);
  assert.equal(R.dateTime(pick(1111, 'Spare')).getTime(), R.dateTime(pick(2222, 'Lab 5')).getTime());
  assert.equal(pick(2222, 'Lab 5').auto, true);
});

test('the auto assignment can be earlier but never closer than one minute', () => {
  const args = shared(ledgerOf([day(1), 1111, 'Lab 5']), { serial: 2222, lab: 'Lab 5', destination: 'Spare', when: day(3) });
  assert.throws(() => R.outOfLab({ ...args, assignmentTime: new Date(day(3).getTime() - 59000) }));
  const earlier = new Date(day(3).getTime() - 3 * 3600000);
  assert.ok(R.outOfLab({ ...args, assignmentTime: earlier }).some((r) => R.dateTime(r).getTime() === earlier.getTime()));
});

test('retired is terminal', () => {
  const led = ledgerOf([day(1), 7005, 'Lab 11']);
  const out = R.outOfLab(shared(led, { serial: 7005, lab: 'Lab 11', destination: 'Retired' }));
  assert.equal(R.placeOf(out[0]), 'Retired');
  assert.throws(() => R.intoLab(shared(led.concat(out), { serial: 7005, lab: 'Lab 11', when: day(3), group: 'g2' })));
});

test('violations see two serials in one lab, but not a same-time swap', () => {
  assert.equal(R.findViolations(ledgerOf([day(1), 1111, 'Lab 5'], [day(2), 2222, 'Lab 5'])).length, 1);
  const led = ledgerOf([day(1), 1111, 'Lab 5']);
  assert.equal(R.findViolations(led.concat(R.intoLab(shared(led, { serial: 2222, lab: 'Lab 5' })))).length, 0);
});

test('tip rows with a blank date order before everything and stay blank', () => {
  const led = [seedRow(null, 7003, 'Lab 8', 'a'), seedRow(day(1), 7015, 'Lab 10', 'b')];
  assert.equal(R.labDisplay(led, 'Lab 8'), 7003);
  assert.equal(R.intoLab(shared(led, { serial: 7015, lab: 'Lab 8' }))[1].change, 7003);
  assert.equal(R.dateTime(led[0]), null);
});

test('form labels show the last-known headset and hide retired serials', () => {
  const { labs, serials } = R.formChoices(ledgerOf([day(1), 7001, 'Lab 12'], [day(1), 7005, 'Retired'], [day(1), 7006, 'For repair']), 3);
  assert.deepEqual(labs, ['Lab 1 (empty)', 'Lab 2 (empty)', 'Lab 3 (empty)']);
  assert.deepEqual(serials, ['7001 (Lab 12)', '7006 (For repair)']);
  assert.equal(R.labFromChoice('Lab 12 (7001)'), 'Lab 12');
  assert.equal(R.serialFromChoice('7001 (Lab 12)'), 7001);
  assert.equal(R.serialFromChoice(''), null);
});

test('decideEntry holds, never drops, what it cannot record', () => {
  const led = ledgerOf([day(1), 1111, 'Lab 5'], [day(1), 2222, 'Spare'], [day(1), 7005, 'Retired']);
  for (const over of [{ email: 'someone@outside.example' }, { serial: 4040 }, { serial: 7005 }, { date: new Date(2026, 10, 25) },
    { action: 'out', lab: 'Lab 9', serial: null, destination: 'Spare' }, { action: 'out', serial: null, destination: '' }]) {
    assert.equal(R.decideEntry(baseEntry(over), led, options).kind, 'held', JSON.stringify(over));
  }
});

test('a correction adds rows, supersedes the old ones, and keeps the one-minute rule', () => {
  const led = ledgerOf([day(1), 1111, 'Lab 5']);
  const rows = R.outOfLab(shared(led, { serial: 2222, lab: 'Lab 5', destination: 'Spare', when: day(3) }));
  const full = led.concat(rows);
  const auto = rows.find((r) => r.ruleNote === 'created at removal');
  assert.throws(() => R.correctionRows(full, auto.id, new Date(day(3).getTime() - 30000), 'op'));
  const fixed = R.correctionRows(full, auto.id, new Date(day(3).getTime() - 7200000), 'op');
  assert.ok(fixed.some((r) => r.corrects === auto.id));
  const after = full.concat(fixed);
  assert.equal(R.findViolations(after).length, 0);
  assert.equal(R.currentPlace(after, 2222), 'Spare');
  assert.equal(R.effectiveRows(after).some((r) => r.id === auto.id), false);
});

test('the seed ignores the spacing a sheet gives Date&Time', () => {
  const [row] = R.rowsFromSeed([['January 15, 2021', '12:15', '2021/01/15 12:15:00', 'Lab 12', 'Headset', '7001', '', '', 'stated', 'x']]);
  assert.equal(R.dateTimeText(R.dateTime(row)), '2021/01/15  12:15:00');
});

test('the seed refuses a blank Date&Time when Date and Time are given (operator ruling)', () => {
  assert.throws(() => R.rowsFromSeed([['January 15, 2021', '12:15', '', 'Lab 12', 'Headset', '7001', '', '', 'stated', 'x']]));
});

test('the seed refuses a Date&Time that is not Date + Time', () => {
  assert.throws(() => R.rowsFromSeed([['January 15, 2021', '12:15', '2021/01/15  12:16:00', 'Lab 12', 'Headset', '7001', '', '', 'stated', 'x']]));
});

// Answers computed by the Python source (python3 ../parity_check.py). Rules.gs must match them exactly.
const PARITY = path.join(__dirname, 'parity.json');
const parity = fs.existsSync(PARITY) ? JSON.parse(fs.readFileSync(PARITY, 'utf8')) : null;
const parse = (s) => {
  if (!s) return null;
  const [d, t] = s.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, se || 0);
};
const ledgerFrom = (rows) => rows.map(([date, time, , lab, type, change, notes, holding, timeBasis, id, group, source, auto, ruleNote, corrects]) => R.makeRow({
  date: R.parseDateText(date), time, lab, type, change: Number(change), notes, holding, timeBasis, id, group, source, auto, ruleNote, corrects,
}));

test('columns, display formats and the sheet formula match Python', { skip: !parity }, () => {
  assert.deepEqual({ hardware: HARDWARE_COLUMNS, ledger: LEDGER_COLUMNS, seed: SEED_COLUMNS }, parity.columns);
  assert.deepEqual([DATE_DISPLAY, TIME_DISPLAY, DATE_TIME_DISPLAY], parity.displays);
  assert.equal(R.dateTimeFormula(5), parity.formula);
});

test('every scenario decides exactly as Python does', { skip: !parity }, () => {
  const ledger = ledgerFrom(parity.ledger);
  const now = parse(parity.now);
  for (const c of parity.scenarios) {
    const e = c.entry;
    const entry = { ...e, date: R.parseDateText(e.date), timeBasis: e.time_basis, displacedTo: e.displaced_to };
    const got = R.decideEntry(entry, ledger, { domain: parity.domain, now });
    const shown = got.kind === 'rows' ? { kind: 'rows', rows: got.rows.map(R.rowText) } : got.kind === 'held' ? got : { kind: got.kind, row: R.rowText(got.row) };
    assert.deepEqual(JSON.parse(JSON.stringify(shown)), c.expected, c.name);
  }
});

test('time, labels, seed and corrections match Python', { skip: !parity }, () => {
  const now = parse(parity.now);
  for (const [dateInput, timeInput, dateShown, timeShown, basis] of parity.times) {
    const got = R.resolveWhen(dateInput, timeInput, now);
    assert.deepEqual([R.dateText(got.date), got.time, got.timeBasis], [dateShown, timeShown, basis]);
  }
  const { labs, serials } = R.formChoices(ledgerFrom(parity.ledger), 6);
  assert.deepEqual({ labs: [...labs], serials: [...serials] }, parity.choices);
  assert.deepEqual(JSON.parse(JSON.stringify(R.rowsFromSeed(parity.seed.table).map(R.rowText))), parity.seed.rows);
  const fixed = R.correctionRows(ledgerFrom(parity.correction.ledger), parity.correction.id, parse(parity.correction.when), 'op');
  assert.deepEqual(JSON.parse(JSON.stringify(fixed.map(R.rowText))), parity.correction.rows);
});

test('adding a headset matches Python', { skip: !parity }, () => {
  const ledger = ledgerFrom(parity.ledger);
  for (const c of parity.headsets) {
    let got;
    try {
      got = R.addHeadsetRows({ ledger, serial: c.serial, place: c.place, when: parse('2026-11-03T09:00:00'), timeBasis: 'stated', group: 'h1' }).map(R.rowText);
    } catch (error) {
      got = error.message;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(got)), c.expected, `${c.serial} ${c.place}`);
  }
});

test('replaying the archive matches the Python reference', { skip: !parity }, () => {
  let ledger = [];
  let autos = 0;
  parity.archive.rows.forEach(([stamp, place, serial], i) => {
    const when = parse(stamp);
    const rows = place.startsWith('Lab ')
      ? R.intoLab({ ledger, serial, lab: place, when, timeBasis: 'stated', group: `p${i}`, source: 'replay' })
      : [R.rowAt(when, serial, 'Spare', 'stated', 'replay', { id: `p${i}-0` })];
    autos += rows.filter((r) => r.auto).length;
    ledger = ledger.concat(rows);
  });
  assert.equal(autos, parity.archive.autoRows);
  assert.equal(R.findViolations(ledger).length, parity.archive.violations);
  const places = Object.fromEntries(Object.keys(parity.archive.places).map((s) => [s, R.currentPlace(ledger, Number(s))]));
  assert.deepEqual({ ...places }, parity.archive.places);
});

test('a cell Sheets turned into a date or time value is refused with its cause, never read through a time zone', () => {
  assert.throws(() => R.parseTimeText(new Date(1899, 11, 30, 15, 30)), /time value/);
  assert.throws(() => R.parseDateText(new Date(2026, 9, 22)), /date value/);
});
