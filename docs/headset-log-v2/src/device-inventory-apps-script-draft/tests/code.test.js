process.env.TZ = 'UTC'; // the script runs in UTC
// Tests for Code.gs against small fakes of the Google services (run with: node --test tests/code.test.js).
// The fakes check our logic and wiring only. They prove nothing about how Google behaves; the pilot does that.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeItem(kind, form) {
  const item = { kind, title: '', choices: [], goTo: null, required: false };
  const self = new Proxy(item, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'setTitle') return (t) => { target.title = t; return self; };
      if (prop === 'setHelpText') return (h) => { target.help = h; return self; };
      if (prop === 'getTitle') return () => target.title;
      if (prop === 'setChoiceValues') return (v) => { target.choices = v.map((value) => ({ value })); return self; };
      if (prop === 'setChoices') return (c) => { target.choices = c; return self; };
      if (prop === 'createChoice') return (value, nav) => ({ value, nav });
      if (prop === 'setGoToPage') return (p) => { target.goTo = p; return self; };
      if (prop === 'setRequired') return (r) => { target.required = r; return self; };
      if (prop === 'asListItem') return () => self;
      if (typeof prop === 'string' && (prop.startsWith('set') || prop.startsWith('show'))) return () => self;
      return undefined;
    },
  });
  form.items.push(self);
  return self;
}

function fakeForm() {
  const form = { items: [], published: null, collects: false };
  return new Proxy(form, {
    get(target, prop, self) {
      if (prop in target) return target[prop];
      if (prop === 'getId') return () => 'form-1';
      if (prop === 'getItems') return () => target.items;
      if (prop === 'supportsAdvancedResponderPermissions') return () => true;
      if (prop === 'setPublished') return (v) => { target.published = v; return self; };
      if (prop === 'setCollectEmail') return (v) => { target.collects = v; return self; };
      if (typeof prop === 'string' && prop.startsWith('add')) return () => fakeItem(prop.slice(3), target);
      if (typeof prop === 'string' && prop.startsWith('set')) return () => self;
      return undefined;
    },
  });
}

// Fakes of Utilities.formatDate and parseDate, built on Intl. They check our wiring only.
function wall(instant, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instant).map((p) => [p.type, p.value]));
  return { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
}
const fakeFormat = (date, zone, pattern) => pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => wall(date, zone)[token]);
function fakeParse(text, zone) {
  const [y, mo, d, h, mi] = text.match(/\d+/g).map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  const w = wall(new Date(target), zone);
  const shift = Date.UTC(Number(w.yyyy), Number(w.MM) - 1, Number(w.dd), Number(w.HH), Number(w.mm)) - target;
  return new Date(target - shift);
}
let sheetZone = 'Asia/Tokyo';
const serialText = (serial) => new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);

// A sheet computes the Date&Time formula in its own zone; a time cell displays as HH:MM.
const evaluate = (row) => row.map((cell) => {
  if (typeof cell !== 'string' || !cell.startsWith('=IF(COUNT')) return cell;
  if (typeof row[0] !== 'number' || typeof row[1] !== 'number') return '';
  const minutes = Math.round(row[1] * 1440);
  return fakeParse(`${serialText(row[0])} ${Math.floor(minutes / 60)}:${minutes % 60}`, sheetZone);
});
const display = (row) => row.map((cell) => {
  if (typeof cell !== 'number' || cell >= 1 || cell < 0) return String(cell);
  const minutes = Math.round(cell * 1440);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function fakeSheet(name, rows) {
  const sheet = {
    name, rows: rows || [], backgrounds: {}, validations: {}, notes: {},
    getName: () => name,
    appendRow: (r) => { sheet.rows.push(r); return sheet; },
    getLastRow: () => sheet.rows.length,
    getMaxRows: () => 1000,
    getRange: (r, c) => ({
      setNumberFormat() { return this; },
      setValue(v) { put(sheet, r, c, [[v]]); return this; },
      setNote(text) { sheet.notes[sheet.rows[r - 1][c - 1]] = text; return this; },
      setValues(v) { put(sheet, r, c, v); return this; },
      setBackgrounds(b) { sheet.backgrounds[`${r},${c}`] = b; return this; },
      setDataValidation(v) { sheet.validations[`${r},${c}`] = v; return this; },
    }),
    getDataRange: () => ({ getValues: () => sheet.rows.map(evaluate), getDisplayValues: () => sheet.rows.map(display) }),
    clearContents: () => { sheet.rows = []; return sheet; },
    setFrozenRows: () => sheet,
    protect: () => ({ setDescription() { return this; }, setWarningOnly() { return this; }, addEditor() { return this; }, removeEditors() { return this; }, getEditors() { return []; } }),
  };
  return sheet;
}

function put(sheet, row, col, grid) {
  grid.forEach((values, i) => {
    while (sheet.rows.length < row + i) sheet.rows.push([]);
    values.forEach((v, j) => { sheet.rows[row + i - 1][col + j - 1] = v; });
  });
}

function load(order) {
  const sheets = new Map();
  const workbooks = new Map();
  const ss = {
    getId: () => world.fileId,
    getSpreadsheetTimeZone: () => world.sheetZone,
    copy: (name) => {
      const file = { name, editors: [], deleted: [], getUrl: () => `https://sheets.invalid/${name}`, getSheetByName: (n) => sheets.get(n), deleteSheet(s) { this.deleted.push(s.name); }, addEditor(e) { this.editors.push(e); } };
      world.copies.push(file);
      return file;
    },
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = fakeSheet(n); sheets.set(n, s); return s; },
  };
  const form = fakeForm();
  const mail = [];
  const triggers = [];
  const props = new Map();
  const world = { fileId: 'ss-1', email: 'a.person@example.org', menu: [], workbooks, sheetZone: 'Asia/Tokyo', scriptZone: 'Etc/UTC', copies: [] };
  sheetZone = world.sheetZone;
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      openById: (id) => {
        if (!workbooks.has(id)) throw new Error('No such spreadsheet');
        return { getSheetByName: (n) => workbooks.get(id).get(n) || null, getSpreadsheetTimeZone: () => world.sourceZone || world.sheetZone };
      },
      newDataValidation: () => { const v = { options: [] }; const chain = { requireValueInList(list) { v.options = list; return chain; }, setAllowInvalid() { return chain; }, build() { return v; } }; return chain; },
      getUi: () => ({
        ButtonSet: { OK_CANCEL: 'ok-cancel' }, Button: { OK: 'ok' },
        createMenu: (title) => { const chain = { addItem(label, fn) { world.menu.push([title, label, fn]); return chain; }, addSeparator() { return chain; }, addToUi() { return chain; } }; return chain; },
      }),
    },
    Utilities: { formatDate: fakeFormat, parseDate: (text, zone) => fakeParse(text, zone) },
    Session: { getActiveUser: () => ({ getEmail: () => world.email }), getScriptTimeZone: () => world.scriptZone },
    FormApp: { create: () => form, openById: () => form, DestinationType: { SPREADSHEET: 'S' } },
    ScriptApp: {
      newTrigger: (fn) => ({ forForm: () => ({ onFormSubmit: () => ({ create: () => triggers.push(fn) }) }) }),
      getProjectTriggers: () => triggers.map((fn) => ({ getHandlerFunction: () => fn })),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: (to, subject) => mail.push({ to, subject }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
  };
  sandbox.Date = Date;
  sandbox.Intl = Intl;
  vm.createContext(sandbox);
  for (const file of order || ['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox);
  }
  if (!order) sandbox.configure('example.org', 12, 'Asia/Tokyo');
  const addWorkbook = (id, tabs) => workbooks.set(id, new Map(Object.entries(tabs).map(([n, rows]) => [n, fakeSheet(n, rows)])));
  return { api: sandbox, ss, form, mail, triggers, sheets, world, addWorkbook, props };
}

const SEED = [['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes', 'Holding', 'TimeBasis', 'Source'],
  ['January 15, 2021', '12:15', '2021/01/15  12:15:00', 'Lab 12', 'Headset', '7001', '', '', 'stated', 'workbook r101'],
  ['January 16, 2021', '14:22', '2021/01/16  14:22:00', 'Lab 7', 'Headset', '7002', '', '', 'stated', 'workbook r101'],
  ['', '', '', 'Lab 8', 'Headset', '7003', '', '', 'unknown', 'legend'],
  ['January 17, 2021', '20:30', '2021/01/17  20:30:00', 'None', 'Headset', '7004', '', 'Spare', 'stated', 'workbook r101']];

function ready() {
  const world = load();
  world.api.setup();
  world.sheets.get('Seed').rows = SEED.map((r) => r.slice());
  world.api.seedLedger();
  return world;
}

function submit(world, email, answers, id) {
  world.api.onFormSubmit({
    response: {
      getId: () => id || 'r1',
      getRespondentEmail: () => email,
      getItemResponses: () => Object.entries(answers).map(([title, value]) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => value })),
    },
  });
}

const titles = (world) => world.api.titles();

test('setup makes an unpublished form that collects email, with branching and a trigger', () => {
  const { form, triggers, api } = ready();
  assert.equal(form.published, false);
  assert.equal(form.collects, true);
  assert.deepEqual(Array.from(triggers), ['onFormSubmit']);
  const action = form.items.find((i) => i.title === api.titles().action);
  assert.deepEqual(Array.from(action.choices, (c) => c.nav.title), ['Into a lab', 'Out of a lab', 'Maintenance']);
  const pages = form.items.filter((i) => i.kind === 'PageBreakItem');
  assert.equal(pages.find((p) => p.title === 'Out of a lab').goTo.title, 'When');
  assert.equal(pages.find((p) => p.title === 'Maintenance').goTo.title, 'When');
});

test('seeding fills the ledger once and the dropdowns show last-known headsets', () => {
  const world = ready();
  assert.equal(world.sheets.get('Ledger').rows.length, 5);
  assert.throws(() => world.api.seedLedger());
  const lab = world.form.items.find((i) => i.title === titles(world).labIn);
  assert.ok(lab.choices.some((c) => c.value === 'Lab 12 (7001)'));
  assert.ok(lab.choices.some((c) => c.value === 'Lab 1 (empty)'));
  const serial = world.form.items.find((i) => i.title === titles(world).serialIn);
  assert.ok(serial.choices.some((c) => c.value === '7004 (Spare)'));
});

test('every tab leads with the Hardware changes columns', () => {
  const world = ready();
  for (const name of ['Ledger', 'Maintenance', 'Held', 'Current', 'Flags', 'Seed']) {
    assert.deepEqual(Array.from(world.sheets.get(name).rows[0]).slice(0, 7), ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes'], name);
  }
});

test('the ledger stores Date, Time as a day fraction, and Date&Time as a formula', () => {
  const world = ready();
  const row = world.sheets.get('Ledger').rows[1];
  assert.equal(row[0], 44211); // the local date
  assert.equal(row[1], (21 * 60 + 15) / 1440); // the seed's UTC time shown in local time
  assert.equal(row[2], '=IF(COUNT(A2:B2)=2,SUM(A2:B2),"")');
  const blank = world.sheets.get('Ledger').rows[3];
  assert.deepEqual([blank[0], blank[1]], ['', '']);
  assert.equal(evaluate(blank)[2], '');
});

test('a swap writes two rows at one time, labels now, and refreshes the dropdown', () => {
  const world = ready();
  const t = titles(world);
  submit(world, 'a.person@example.org', { [t.action]: t.actionIn, [t.labIn]: 'Lab 12 (7001)', [t.serialIn]: '7004 (Spare)' });
  const rows = world.sheets.get('Ledger').rows.slice(5);
  assert.equal(rows.length, 2);
  const cols = world.sheets.get('Ledger').rows[0];
  const at = (r, name) => r[cols.indexOf(name)];
  assert.deepEqual([at(rows[0], 'Lab'), at(rows[0], 'Change')], ['Lab 12', 7004]);
  assert.deepEqual([at(rows[1], 'Lab'), at(rows[1], 'Holding'), at(rows[1], 'Change')], ['None', 'Spare', 7001]);
  assert.equal(at(rows[0], 'Author'), 'a.person@example.org');
  assert.equal(at(rows[0], 'TimeBasis'), 'defaulted');
  assert.equal(at(rows[0], 'Time'), at(rows[1], 'Time'));
  const lab = world.form.items.find((i) => i.title === t.labIn);
  assert.ok(lab.choices.some((c) => c.value === 'Lab 12 (7004)'));
  assert.ok(world.sheets.get('Current').rows.some((r) => r[3] === 'Lab 12' && r[5] === 7004));
  assert.equal(world.mail.length, 0);
  assert.equal(world.sheets.get('Flags').rows.length, 1);
});

test('an overwritten Date&Time cell is flagged', () => {
  const world = ready();
  const t = titles(world);
  world.sheets.get('Ledger').rows[1][2] = new Date(2000, 0, 1);
  submit(world, 'a.person@example.org', { [t.action]: t.actionIn, [t.labIn]: 'Lab 12 (7001)', [t.serialIn]: '7004 (Spare)' });
  assert.ok(world.sheets.get('Flags').rows.some((r) => /Date&Time is not Date \+ Time/.test(r.join(' '))));
});

test('a bad entry is held with its reason and the person is told', () => {
  const world = ready();
  const t = titles(world);
  submit(world, 'someone@outside.example', { [t.action]: t.actionIn, [t.labIn]: 'Lab 12 (7001)', [t.serialIn]: '7004 (Spare)' });
  assert.equal(world.sheets.get('Ledger').rows.length, 5);
  assert.equal(world.sheets.get('Held').rows.length, 2);
  assert.match(world.sheets.get('Held').rows[1].join(' '), /example\.org/);
  assert.equal(world.mail.length, 1);
});

test('maintenance goes to its own tab and does not move the headset', () => {
  const world = ready();
  const t = titles(world);
  submit(world, 'a.person@example.org', { [t.action]: t.actionFix, [t.serialFix]: '7001 (Lab 12)', [t.parts]: ['Cz', 'BOA knob'], [t.defect]: 'D-1' });
  assert.equal(world.sheets.get('Ledger').rows.length, 5);
  const rows = world.sheets.get('Maintenance').rows;
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1][3], rows[1][4], rows[1][5], rows[1][6]], ['Lab 12', 'Equipment Maintenance', 7001, 'Cz, BOA knob']);
});

test('a correction appends rows and leaves earlier rows untouched', () => {
  const world = ready();
  const t = titles(world);
  submit(world, 'a.person@example.org', { [t.action]: t.actionOut, [t.labOut]: 'Lab 12 (7001)', [t.destination]: 'Spare', [t.date]: '2026-10-20', [t.time]: '10:00' }, 'r9');
  const before = JSON.stringify(world.sheets.get('Ledger').rows);
  world.api.applyCorrection('r9-0', '2026-10-20', '09:30', 'op@example.org');
  const after = world.sheets.get('Ledger').rows;
  assert.equal(JSON.stringify(after.slice(0, 6)), before);
  assert.equal(after.length, 7);
});


// ---- Real-data initialization, domain gate and progress (fake Google services; fake serials only) ----
const T = (h, m) => (h * 60 + m) / 1440;
const NOISE = new Date(1999, 0, 1); // column C is stored and rounded in real sheets; it must never be read
const HEADER = ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes'];
const WORKBOOK_ID = 'workbook-id-0000000000';
const LEGEND_ID = 'legend-id-00000000000';
const hardwareChanges = () => [['Please Document Change'], [], HEADER,
  [new Date(2026, 2, 1), T(9, 0), NOISE, 'Lab 1', 'Headset', 7001, ''],
  [new Date(2026, 4, 1), T(9, 0), NOISE, 'Lab 1', 'Headset', 7002, ''],
  [new Date(2026, 2, 1), T(9, 0), NOISE, 'Lab 2', 'Headset', 7003, ''],
  [new Date(2026, 4, 1), '', NOISE, 'Lab 3', 'Headset', 7004, ''],
  [new Date(2026, 4, 1), T(10, 0), NOISE, 'None', 'Headset', 7005, ''],
  [new Date(2026, 4, 2), T(10, 0), NOISE, 'Lab 9', 'Computer', 'ABC123', 'not a headset']];
const legendTab = () => [['', new Date(2021, 0, 8), new Date(2021, 0, 15)], ['Lab', 'EEG SN', 'EEG SN'],
  [1, 7002, 7001], [2, 7003, 7003], [3, 7004, 7004], [null, null, null], ['spare 1', null, 7005], ['under repair 1', null, null]];

function initialized() {
  const world = load();
  world.api.setup();
  world.addWorkbook(WORKBOOK_ID, { 'Hardware changes': hardwareChanges() });
  world.addWorkbook(LEGEND_ID, { EEG: legendTab() });
  world.api.setSourceWorkbooks(`https://docs.google.com/spreadsheets/d/${WORKBOOK_ID}/edit?usp=drivesdk`, LEGEND_ID);
  return world;
}
const reviewRow = (world, key) => world.sheets.get('Review').rows.find((r) => r[0] === key);

test('setup, the sources, tips and seeding all refuse a person outside the domain', () => {
  const world = load();
  world.world.email = 'someone@outside.example';
  assert.throws(() => world.api.setup(), /Sign in with a example\.org account/);
  assert.equal(world.sheets.size, 0);
  const ok = initialized();
  ok.world.email = 'someone@outside.example';
  for (const fn of [() => ok.api.loadTipProposals(), () => ok.api.seedFromReview(), () => ok.api.setSourceWorkbooks(WORKBOOK_ID, ''), () => ok.api.applyCorrection('x', '', '', 'op')]) {
    assert.throws(fn, /Sign in with a example\.org account/);
  }
  assert.equal(ok.sheets.get('Review').rows.length, 1);
});

test('setup is safe to run again: no second form trigger, no second tab', () => {
  const world = load();
  world.api.setup();
  world.api.setup();
  assert.deepEqual(Array.from(world.triggers), ['onFormSubmit']);
  assert.equal(world.sheets.size, 9);
});

test('the Progress tab is a checklist with a bar and one tile per lab, drawn from facts in the file', () => {
  const world = load();
  world.api.setup();
  const rows = world.sheets.get('Progress').rows;
  assert.equal(rows[0][1], '4 of 9 steps done');
  assert.match(rows[0][2], /^=SPARKLINE\(/);
  assert.deepEqual(rows.slice(2, 11).map((r) => r[1]), ['✅ Done', '✅ Done', '✅ Done', '✅ Done', '⏳ Next', '⬜ Waiting', '⬜ Waiting', '⬜ Waiting', '⬜ Waiting']);
  assert.equal(rows[6][2], 'Headset log menu, Set source workbooks.');
  const tiles = rows.slice(12, 15).flat();
  assert.equal(tiles.length, 12);
  assert.equal(tiles[0], 'Lab 1\nempty');
  world.world.email = 'someone@outside.example';
  world.api.refreshProgress();
  assert.equal(world.sheets.get('Progress').rows[5][1], '⏳ Next');
});

test('the form shows its own progress bar to the people who fill it in', () => {
  const calls = [];
  const world = load();
  world.form.setProgressBar = (v) => { calls.push(v); return world.form; };
  world.api.setup();
  assert.deepEqual(calls, [true]);
});

test('source links and ids are checked before anything is stored', () => {
  const world = load();
  world.api.setup();
  assert.throws(() => world.api.setSourceWorkbooks('not a link', ''), /does not look like/);
  assert.throws(() => world.api.setSourceWorkbooks('workbook-id-0000000000', ''), /No such spreadsheet/);
  world.addWorkbook(WORKBOOK_ID, { Other: [] });
  assert.throws(() => world.api.setSourceWorkbooks(WORKBOOK_ID, ''), /no "Hardware changes" tab/);
  assert.equal(world.props.has('sourceWorkbookId'), false);
});

test('tips are proposed from the live workbook; column C is never read and only Review is written', () => {
  const world = initialized();
  const before = world.sheets.get('Ledger').rows.length;
  const result = world.api.loadTipProposals();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { proposals: 12 + 1, decisionsNeeded: 1 });
  const lab1 = reviewRow(world, 'Lab 1');
  assert.deepEqual([lab1[2], lab1[3], lab1[4], lab1[5]], [7002, 5, 7001, 'decision needed']);
  assert.equal(lab1[7], 'Use workbook | Use legend | Hold');
  assert.deepEqual(Array.from(world.sheets.get('Review').validations['2,9'].options), ['Use workbook', 'Use legend', 'Hold']);
  assert.equal(reviewRow(world, 'Lab 3')[5], 'agree');
  assert.equal(reviewRow(world, 'Lab 12')[5], 'empty');
  assert.equal(reviewRow(world, 'serial 7005')[1], 'Spare');
  assert.equal(world.sheets.get('Ledger').rows.length, before);
  assert.equal(world.sheets.get('Progress').rows[7][1], '✅ Done');
});

test('seeding is blocked until every decision is made, then asks about what the decisions left unplaced', () => {
  const world = initialized();
  world.api.loadTipProposals();
  assert.deepEqual(JSON.parse(JSON.stringify(world.api.seedFromReview())), { seeded: false, unresolved: 1, message: '1 decision(s) still needed on the Review tab.' });
  reviewRow(world, 'Lab 1')[8] = 'Use legend';
  const second = world.api.seedFromReview();
  assert.equal(second.seeded, false);
  assert.ok(reviewRow(world, 'serial 7002'), 'the headset left without a place is added to Review');
  reviewRow(world, 'serial 7002')[8] = 'Retired';
  const done = world.api.seedFromReview();
  assert.deepEqual([done.seeded, done.rows], [true, 5]);
  const ledger = world.sheets.get('Ledger').rows.slice(1);
  const cols = world.sheets.get('Ledger').rows[0];
  assert.deepEqual(ledger.map((r) => [r[cols.indexOf('Lab')], r[cols.indexOf('Holding')], r[cols.indexOf('Change')]]),
    [['Lab 1', '', 7001], ['Lab 2', '', 7003], ['Lab 3', '', 7004], ['None', 'Retired', 7002], ['None', 'Spare', 7005]]);
  assert.equal(ledger[2][cols.indexOf('TimeBasis')], 'stated'.replace('stated', 'unknown'));
  assert.equal(world.sheets.get('Progress').rows[2 + 7][1], '✅ Done');
  assert.equal(world.sheets.get('Progress').rows[1 + 9][1], '✅ Done');
});

test('a held decision keeps a lab out of the ledger and says so', () => {
  const world = initialized();
  world.api.loadTipProposals();
  reviewRow(world, 'Lab 1')[8] = 'Hold';
  assert.equal(world.api.seedFromReview().seeded, false); // the two headsets Lab 1 would have placed are now asked about
  reviewRow(world, 'serial 7001')[8] = 'Hold';
  reviewRow(world, 'serial 7002')[8] = 'Hold';
  const done = world.api.seedFromReview();
  assert.equal(done.seeded, true);
  assert.deepEqual(Array.from(done.held), ['Lab 1', 'serial 7001', 'serial 7002']);
  assert.equal(world.sheets.get('Ledger').rows.length - 1, 3);
});

test('the shipped code holds no inventory data: no serial numbers, no ids, no real addresses', () => {
  const allowed = new Set(['1440', '1000']); // minutes in a day; milliseconds in a second
  for (const file of ['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs', 'AuditDateTimeColumn.gs']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const numbers = (text.match(/\b\d{4}\b/g) || []).filter((n) => !/^20\d\d$/.test(n) && !allowed.has(n));
    assert.deepEqual(numbers, [], `${file} has serial-like numbers`);
    assert.doesNotMatch(text, /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{25,}/, `${file} has an id-like string`); // a sheet or form id mixes letters and digits
  }
});

test('the files load in any order: no file needs another file\'s constants while the project loads', () => {
  for (const order of [['Init.gs', 'Code.gs', 'Tips.gs', 'Rules.gs'], ['Code.gs', 'Init.gs', 'Rules.gs', 'Tips.gs'], ['Tips.gs', 'Rules.gs', 'Init.gs', 'Code.gs']]) {
    assert.doesNotThrow(() => load(order), order.join(' '));
  }
});

test('the menu offers the four setup steps in order', () => {
  const world = load();
  world.api.onOpen();
  assert.deepEqual(world.world.menu.map(([, label, fn]) => [label, fn]), [['Check progress', 'refreshProgress'], ['Set source workbooks', 'promptSourceWorkbooks'], ['Load tips from workbook', 'loadTipProposals'], ['Seed from reviewed tips', 'seedFromReview'], ['Set other time zone (admin)', 'promptOtherZone'], ['Add an admin (admin)', 'promptAdmin'], ['Add a headset (admin)', 'promptHeadset'], ['Add a site (template admin)', 'promptSite']]);
});

test('the source workbook and legend are only read: the whole load, review and seed flow writes nothing to them', () => {
  const world = initialized();
  const sources = [world.world.workbooks.get(WORKBOOK_ID).get('Hardware changes'), world.world.workbooks.get(LEGEND_ID).get('EEG')];
  const before = JSON.stringify(sources.map((s) => s.rows));
  for (const sheet of sources) {
    for (const write of ['appendRow', 'clearContents', 'getRange', 'protect']) {
      sheet[write] = () => { throw new Error(`wrote to a source sheet with ${write}`); };
    }
  }
  world.api.loadTipProposals();
  reviewRow(world, 'Lab 1')[8] = 'Use legend';
  world.api.seedFromReview();
  reviewRow(world, 'serial 7002')[8] = 'Retired';
  assert.equal(world.api.seedFromReview().seeded, true);
  assert.equal(JSON.stringify(sources.map((s) => s.rows)), before);
});

test('nothing runs until configure() is done, and it cannot be done from outside the domain or with the wrong local zone', () => {
  const world = load(['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs']);
  const ok = ['example.org', 12, 'Asia/Tokyo'];
  assert.throws(() => world.api.setup(), /Run configure\(\) first/);
  assert.equal(world.sheets.size, 0);
  assert.throws(() => world.api.configure('not a domain', 12, 'Asia/Tokyo'), /organization domain/);
  assert.throws(() => world.api.configure('example.org', 0, 'Asia/Tokyo'), /number of labs/);
  assert.throws(() => world.api.configure('example.org', 12, 'Europe/Paris'), /File, Settings/);
  assert.throws(() => world.api.configure(...ok, 'Not/AZone'), /Unknown time zone/);
  assert.throws(() => world.api.configure(...ok, 'UTC', 'other'), /Choose existing or new/);
  world.world.scriptZone = 'Asia/Tokyo';
  assert.throws(() => world.api.configure(...ok), /set the time zone to UTC/);
  world.world.scriptZone = 'Etc/UTC';
  world.world.email = 'someone@outside.example';
  assert.throws(() => world.api.configure(...ok), /signed in with an account on that domain/);
  world.world.email = 'a.person@example.org';
  world.api.configure(...ok);
  assert.throws(() => world.api.configure(...ok), /Already configured/);
  assert.equal(world.world.sheetZone, 'Asia/Tokyo');
  world.api.setup();
  assert.equal(world.sheets.size, 9);
});

test('no shipped code changes a sheet time zone: sheets stay local', () => {
  for (const file of ['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /setSpreadsheetTimeZone/, file);
  }
});

test('only UTC is stored; the sheet shows local time; the form takes local time', () => {
  const world = ready();
  const t = titles(world);
  submit(world, 'a.person@example.org', { [t.action]: t.actionIn, [t.labIn]: 'Lab 12 (7001)', [t.serialIn]: '7004 (Spare)', [t.date]: '2021-02-01', [t.time]: '02:00' });
  const sheet = world.sheets.get('Ledger');
  const cols = sheet.rows[0];
  const row = sheet.rows[5];
  assert.equal(row[cols.indexOf('UTC')], '2021-01-31T17:00:00Z'); // 02:00 local crosses back a day
  assert.equal(row[cols.indexOf('Time')], 2 / 24);
  assert.equal(row[0], 44228); // the local date, February 01
  assert.equal(world.world.sheetZone, 'Asia/Tokyo');
});

test('local is the first display and the other zone is UTC by default; an admin changes it without touching the Ledger', () => {
  const world = ready();
  const view = () => world.sheets.get('View').rows;
  const led = JSON.stringify(world.sheets.get('Ledger').rows);
  assert.deepEqual(Array.from(view()[0]).slice(0, 2), ['Local time (Asia/Tokyo)', 'Other time (UTC)']);
  const row = view().find((r) => r[7] === '2021-01-15T12:15:00Z');
  assert.deepEqual(row.slice(0, 2), ['2021/01/15  21:15:00', '2021/01/15  12:15:00']);
  world.api.setOtherTimeZone('America/New_York');
  assert.equal(view()[0][1], 'Other time (America/New_York)');
  assert.equal(view().find((r) => r[7] === '2021-01-15T12:15:00Z')[1], '2021/01/15  07:15:00');
  assert.equal(JSON.stringify(world.sheets.get('Ledger').rows), led);
  assert.throws(() => world.api.setOtherTimeZone('Not/AZone'), /Unknown time zone/);
  assert.ok(world.sheets.get('Progress').rows.some((r) => String(r[2]).startsWith('Other (America/New_York)')));
});

test('the app reads the UTC column only: rewriting the local cells changes nothing it decides', () => {
  const world = ready();
  const sheet = world.sheets.get('Ledger');
  const before = JSON.stringify(world.api.readLedger_());
  sheet.rows.slice(1).forEach((row) => { row[0] = 1; row[1] = 0.5; });
  assert.equal(JSON.stringify(world.api.readLedger_()), before);
});

test('every time column is labelled with what it is', () => {
  const world = ready();
  for (const name of ['Ledger', 'Current']) {
    const { notes } = world.sheets.get(name);
    assert.match(notes.Date, /Local time, Asia\/Tokyo/, name);
    assert.match(notes['Date&Time'], /Local time, Asia\/Tokyo/, name);
    assert.match(notes.UTC, /always UTC/, name);
  }
  assert.ok(world.sheets.get('Current').rows[0].includes('Other time (UTC)'));
  world.api.setOtherTimeZone('Europe/Paris');
  assert.ok(world.sheets.get('Current').rows[0].includes('Other time (Europe/Paris)'));
});

test('the form names the local zone beside its date and time', () => {
  const world = ready();
  assert.ok(world.form.items.some((item) => String(item.help).startsWith('Use local time (Asia/Tokyo).')));
});

test('if the sheet zone moves after configure, the app stops instead of mixing zones', () => {
  const world = ready();
  const rows = JSON.stringify(world.sheets.get('Ledger').rows);
  world.world.sheetZone = 'Europe/Paris';
  const t = titles(world);
  const held = world.sheets.get('Held').rows.length;
  assert.throws(() => world.api.setOtherTimeZone('America/New_York'), /Put it back in File, Settings/);
  assert.equal(world.props.get('otherTimeZone') || 'UTC', 'UTC');
  submit(world, 'a.person@example.org', { [t.action]: t.actionIn, [t.labIn]: 'Lab 12 (7001)', [t.serialIn]: '7004 (Spare)' });
  assert.equal(JSON.stringify(world.sheets.get('Ledger').rows), rows);
  assert.equal(world.sheets.get('Held').rows.length, held + 1); // nothing lost
  assert.match(world.sheets.get('Held').rows.at(-1).join(' '), /Put it back in File, Settings/);
});

test('a date with no time stays that date and shows no time', () => {
  const world = ready();
  const cols = world.sheets.get('Ledger').rows[0];
  assert.equal(world.sheets.get('Ledger').rows.find((r) => r[cols.indexOf('UTC')] === '').length > 0, true);
  assert.equal(world.api.parseUtcText('2021-01-15').time, '');
});

test('a source whose local time differs from this sheet is refused, never converted by a guess', () => {
  const world = load();
  world.api.setup();
  world.addWorkbook(WORKBOOK_ID, { 'Hardware changes': hardwareChanges() });
  world.world.sourceZone = 'Europe/Paris';
  assert.throws(() => world.api.setSourceWorkbooks(WORKBOOK_ID, ''), /File, Settings/);
});

test('each file has its own admins; only an admin changes settings', () => {
  const world = load();
  world.api.setup();
  world.world.email = 'b.person@example.org';
  assert.throws(() => world.api.setOtherTimeZone('Europe/Paris'), /Only an admin/);
  assert.throws(() => world.api.addAdmin('b.person@example.org'), /Only an admin/);
  assert.throws(() => world.api.addHeadset(7100), /Only an admin/);
  world.world.email = 'a.person@example.org';
  assert.throws(() => world.api.addAdmin('someone@outside.example'), /must be on example\.org/);
  world.api.addAdmin('B.Person@example.org');
  world.world.email = 'b.person@example.org';
  world.api.setOtherTimeZone('Europe/Paris');
  world.api.setLabCount(14);
  assert.equal(world.props.get('labCount'), '14');
  world.api.removeAdmin('a.person@example.org');
  assert.throws(() => world.api.removeAdmin('b.person@example.org'), /At least one admin/);
});

test('settings do not follow a copied file: a copy starts unconfigured', () => {
  const world = load();
  world.api.setup();
  world.world.fileId = 'a-copy-of-the-file';
  assert.throws(() => world.api.setOtherTimeZone('Europe/Paris'), /Run configure\(\) first/);
  assert.throws(() => world.api.loadTipProposals(), /Run configure\(\) first/);
  world.api.configure('example.org', 3, 'Asia/Tokyo', 'UTC', 'new');
  assert.equal(world.props.get('labCount'), '3');
});

function template() {
  const world = load(['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs']);
  world.api.configureTemplate('example.org');
  return world;
}

test('sites are added from the template only, with a named first admin, and stay out of each other', () => {
  const world = template();
  assert.throws(() => world.api.setup(), /This is the template/);
  assert.throws(() => world.api.addSite('', 'a@example.org'), /Give the site a name/);
  assert.throws(() => world.api.addSite('North', 'x@outside.example'), /first admin must be on example\.org/);
  const url = world.api.addSite('North', 'site.admin@example.org');
  assert.match(url, /North/);
  const [file] = world.world.copies;
  assert.deepEqual([file.editors, file.deleted], [['site.admin@example.org'], ['Sites']]);
  assert.equal(world.sheets.get('Sites').rows[1][0], 'North');
  assert.throws(() => world.api.addSite('north', 'a@example.org'), /already exists/);
  world.world.email = 'b.person@example.org';
  assert.throws(() => world.api.addSite('South', 'a@example.org'), /Only an admin/);
  const site = ready();
  assert.throws(() => site.api.addSite('West', 'a@example.org'), /from the template/);
});

test('a new site starts empty: no source steps, an admin adds headsets, and the form can use them', () => {
  const world = load(['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs']);
  world.api.configure('example.org', 3, 'Asia/Tokyo', 'UTC', 'new');
  world.api.setup();
  const status = () => world.sheets.get('Progress').rows.slice(2, 11).map((r) => r[1]);
  assert.deepEqual(status(), ['✅ Done', '✅ Done', '✅ Done', '✅ Done', '✅ Done', '✅ Done', '✅ Done', '⏳ Next', '⬜ Waiting']);
  world.api.addHeadset('7100');
  assert.throws(() => world.api.addHeadset('7100'), /already on the roster/);
  assert.throws(() => world.api.addHeadset('abc'), /serial number/);
  assert.equal(status()[8], '✅ Done');
  const t = titles(world);
  submit(world, 'a.person@example.org', { [t.action]: t.actionIn, [t.labIn]: 'Lab 1 (empty)', [t.serialIn]: '7100 (Spare)' });
  assert.ok(world.sheets.get('Current').rows.some((r) => r[3] === 'Lab 1' && r[5] === 7100));
});

test('the shipped code names no organization and sets no lab count', () => {
  for (const file of ['Rules.gs', 'Tips.gs', 'Code.gs', 'Init.gs', 'AuditDateTimeColumn.gs']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(text, /\bLAB_COUNT\s*=|\bDOMAIN\s*=\s*'/, file);
    assert.deepEqual(text.match(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z.]+/g) || [], [], `${file} has an address`);
  }
});

const PARITY = path.join(__dirname, 'parity.json');
test('zone conversions in the test fakes match Python', { skip: !fs.existsSync(PARITY) }, () => {
  for (const c of JSON.parse(fs.readFileSync(PARITY, 'utf8')).zones) {
    const instant = fakeParse(c.local, c.zone);
    assert.equal(instant.toISOString().replace('.000Z', 'Z'), c.utc, `${c.local} ${c.zone}`);
    assert.equal(fakeFormat(instant, c.zone, 'yyyy/MM/dd  HH:mm:ss'), c.shown);
  }
});

