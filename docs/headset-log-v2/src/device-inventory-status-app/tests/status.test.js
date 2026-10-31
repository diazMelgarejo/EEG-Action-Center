process.env.TZ = 'UTC';
// Tests for the read-only status app (run with: node --test tests/status.test.js) against small fakes of the Google services.
// The fakes check our logic and wiring only. They prove nothing about how Google behaves; the pilot does that.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const serverText = fs.readFileSync(path.join(root, 'Status.gs'), 'utf8');
const pageText = fs.readFileSync(path.join(root, 'Status.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));

const CURRENT = ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes', 'Holding', 'TimeBasis', 'UTC', 'Other time'];
const FLAGS = ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes'];
const STEPS = [['Headset log setup', '1 of 2 steps done', ''], ['Step', 'Status', 'Next action'], ['Tabs created', '✅ Done', ''], ['Form built', '⏳ Next', 'Build the form']];
const sheetFile = {
  Current: [CURRENT, ['2026/10/22', '09:00', '', 'Lab 2', 'Headset', '7002', 'seen', '', 'stated', '2026/10/22  01:00:00', ''], ['2026/10/20', '10:00', '', 'None', 'Headset', '7003', '', 'Spare', 'stated', '', '']],
  Progress: [...STEPS, [], ['Labs now (last-known headset; red means more than one headset in a lab)'], ['Lab 1\nempty', 'Lab 2\n7002', 'Lab 3\n7005']],
  Flags: [FLAGS, ['', '', '', 'Lab 3', 'Headset', '7005, 7006', '', 'More than one headset in this lab']],
};

function fakeSheet(table, id) {
  return {
    getSheetId: () => id,
    getDataRange: () => ({ getNumRows: () => table.length, getNumColumns: () => Math.max(...table.map((r) => r.length)), getDisplayValues: () => table.map((r) => r.map(String)) }),
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value)); // results come from another realm; compare as plain data

function load({ active = 'staff@example.org', effective = 'staff@example.org', enabled = 'true', config, files = { sheet1: sheetFile }, denied = [] } = {}) {
  const props = { statusEnabled: enabled, statusConfig: config === undefined ? JSON.stringify({ version: 1, sites: [{ key: 'a', label: 'Site A', spreadsheetId: 'sheet1', links: { form: 'https://forms.gle/abc' } }] }) : config };
  const calls = [];
  const context = {
    console,
    Session: { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => effective }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    HtmlService: { createHtmlOutputFromFile: (name) => { calls.push(name); return { setTitle: () => ({ title: true, name }) }; } },
    SpreadsheetApp: {
      openById: (id) => {
        if (denied.includes(id) || !files[id]) throw new Error('You do not have access: ' + id);
        const tabs = files[id];
        return {
          getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
          getSpreadsheetTimeZone: () => 'Asia/Example',
          getSheetByName: (name) => (tabs[name] ? fakeSheet(tabs[name], Object.keys(tabs).indexOf(name) + 100) : null),
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(serverText, context);
  return { api: context, calls };
}

test('the app refuses to run without a real user, as the user, and while switched off', () => {
  assert.throws(() => load({ active: '' }).api.getStatusSnapshot(), /Access denied/);
  assert.throws(() => load({ active: 'a@example.org', effective: 'owner@example.org' }).api.getStatusSnapshot(), /Access denied/);
  assert.throws(() => load({ enabled: null }).api.getStatusSnapshot(), /not enabled/);
  assert.throws(() => load({ enabled: 'false' }).api.doGet(), /not enabled/);
});

test('any signed-in user whose Google account can open the sheet sees labs with serials, with no member list', () => {
  const { api } = load({ active: 'someone.else@example.org', effective: 'someone.else@example.org' });
  const snap = plain(api.getStatusSnapshot());
  assert.equal(snap.sites.length, 1);
  assert.equal(snap.unavailable, 0);
  const [site] = snap.sites;
  assert.deepEqual(site.labs.tiles.map((t) => [t.lab, t.serial]), [['Lab 1', null], ['Lab 2', '7002'], ['Lab 3', '7005']]);
});

test('a user who cannot open the sheet gets nothing and no reason', () => {
  const { api } = load({ denied: ['sheet1'] });
  const snap = api.getStatusSnapshot();
  assert.deepEqual(plain(snap.sites), []);
  assert.equal(snap.unavailable, 1);
  assert.doesNotMatch(JSON.stringify(snap), /do not have access|sheet1/);
});

test('labs the sheet flags are marked, and flagged rows are listed', () => {
  const [site] = plain(load().api.getStatusSnapshot().sites);
  assert.deepEqual(site.labs.tiles.map((t) => t.alert), [false, false, true]);
  assert.equal(site.flags.rows.length, 1);
  assert.match(site.flags.rows[0], /Lab 3/);
});

test('headsets outside a lab are listed with where they are held', () => {
  const [site] = plain(load().api.getStatusSnapshot().sites);
  assert.deepEqual(site.notInLab.rows.map((r) => [r.serial, r.holding]), [['7003', 'Spare']]);
});

test('every lab has its serial, last change and notes in a table', () => {
  const [site] = plain(load().api.getStatusSnapshot().sites);
  assert.deepEqual(site.inLab.rows[0], { lab: 'Lab 2', serial: '7002', date: '2026/10/22', time: '09:00', notes: 'seen' });
});

test('a missing or empty tab is Unknown, never an invented empty room', () => {
  const [site] = plain(load({ files: { sheet1: { Current: [CURRENT] } } }).api.getStatusSnapshot().sites);
  assert.equal(site.labs.state, 'unknown');
  assert.deepEqual(site.labs.tiles, []);
  assert.equal(site.steps.state, 'unknown');
  assert.equal(site.inLab.state, 'unknown');
  assert.equal(site.flags.state, 'unknown');
});

test('a current view without the expected columns is Unknown, not guessed', () => {
  const files = { sheet1: { ...sheetFile, Current: [['A', 'B'], ['1', '2']] } };
  const [site] = plain(load({ files }).api.getStatusSnapshot().sites);
  assert.equal(site.inLab.state, 'unknown');
  assert.equal(site.notInLab.state, 'unknown');
});

test('a view over the display limit is refused with a pointer to the sheet', () => {
  const big = [CURRENT, ...Array.from({ length: 1200 }, () => CURRENT.map(() => 'x'))];
  const [site] = plain(load({ files: { sheet1: { ...sheetFile, Current: big } } }).api.getStatusSnapshot().sites);
  assert.equal(site.inLab.state, 'too-large');
});

test('setup steps are counted from the sheet, and say they are not acceptance', () => {
  const [site] = plain(load().api.getStatusSnapshot().sites);
  assert.equal(site.steps.done, 1);
  assert.equal(site.steps.total, 2);
  assert.deepEqual(site.steps.items.map((i) => i.status), ['done', 'next']);
});

test('links use real tab ids and only Google hosts; the form link is the way to add an update', () => {
  const [site] = plain(load().api.getStatusSnapshot().sites);
  assert.match(site.links.sheet, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/sheet1/);
  assert.match(site.links.current, /#gid=100$/);
  assert.equal(site.links.form, 'https://forms.gle/abc');
  assert.doesNotMatch(JSON.stringify(site.links), /gid=Review/);
});

test('the configuration is validated and a bad one fails closed', () => {
  const bad = [
    '{"version":2,"sites":[]}',
    '{"version":1,"sites":[{"key":"a","label":"A","spreadsheetId":"x y"}]}',
    '{"version":1,"sites":[{"key":"a","label":"A","spreadsheetId":"x"},{"key":"a","label":"B","spreadsheetId":"y"}]}',
    '{"version":1,"sites":[{"key":"a","label":"A","spreadsheetId":"x","extra":1}]}',
    '{"version":1,"sites":[{"key":"a","label":"A","spreadsheetId":"x","links":{"form":"https://example.org/f"}}]}',
    '{"version":1,"sites":[{"key":"a","label":"A","spreadsheetId":"x","links":{"form":"http://forms.gle/f"}}]}',
    'not json',
    '',
  ];
  bad.forEach((config) => assert.throws(() => load({ config }).api.getStatusSnapshot(), /configuration is unavailable/, config));
  assert.equal(JSON.stringify(load({ config: '{"version":1,"sites":[]}' }).api.getStatusSnapshot().sites), '[]');
});

test('the page is served only after the same checks', () => {
  const { api, calls } = load();
  api.doGet();
  assert.deepEqual(calls, ['Status']);
});

test('the server code cannot write, trigger or call out: it uses no mutating or network API', () => {
  assert.doesNotMatch(serverText, /\.(setValue|setValues|appendRow|clear|clearContents|deleteRow|insertSheet|setFormula)\(|UrlFetchApp|ScriptApp\.newTrigger|getActive\(|openByUrl|DriveApp|MailApp|LockService/);
});

test('the manifest asks for read-only sheets and the user email, runs as the user, for the domain only, in UTC', () => {
  assert.deepEqual([...manifest.oauthScopes].sort(), ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/userinfo.email']);
  assert.equal(manifest.webapp.executeAs, 'USER_ACCESSING');
  assert.equal(manifest.webapp.access, 'DOMAIN');
  assert.equal(manifest.timeZone, 'Etc/UTC');
});

test('the page renders sheet text as text, never as markup, and its script parses', () => {
  assert.doesNotMatch(pageText, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  const script = pageText.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(pageText, /textContent/);
});

test('the page says what it cannot know', () => {
  assert.match(pageText, /Not connected/);
  assert.match(pageText, /freshness/i);
  assert.match(pageText, /Add an update/);
});

test('no real value is in the code: no domain, id, count or zone other than UTC', () => {
  assert.doesNotMatch(serverText + pageText, /@[a-z0-9-]+\.(?:com|org|ph|net)\b/i);
  assert.doesNotMatch(serverText + pageText, /\bLab \d+\b(?!\\n)/);
});

// A tiny DOM that behaves like the real one where it matters: append returns nothing, and textContent is text.
function fakeDom() {
  const makeNode = (tag) => ({
    tag, children: [], text: '', className: '', attrs: {},
    append(...kids) { this.children.push(...kids); }, // returns undefined, as the real append does
    replaceChildren() { this.children = []; this.text = ''; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    get firstChild() { return this.children[0]; },
    set textContent(v) { this.text = String(v); this.children = []; },
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); },
  });
  const ids = {};
  ['refresh', 'status', 'sites'].forEach((id) => { ids[id] = makeNode('x'); });
  let handlers = null;
  const document = { getElementById: (id) => ids[id], createElement: makeNode };
  const google = { script: { run: { withSuccessHandler(ok) { handlers = { ok }; return this; }, withFailureHandler(f) { handlers.f = f; return this; }, getStatusSnapshot() {} } } };
  return { document, google, ids, deliver: (data) => handlers.ok(data) };
}

test('the page builds every section for a full response and for an all-unknown one, and shows markup as text', () => {
  const script = pageText.match(/<script>([\s\S]*)<\/script>/)[1];
  const dom = fakeDom();
  const context = { document: dom.document, google: dom.google, URL, console };
  vm.createContext(context);
  vm.runInContext(script, context);
  const full = plain(load().api.getStatusSnapshot());
  full.sites[0].labs.tiles.push({ lab: 'Lab 9', serial: '<img src=x onerror=alert(1)>', alert: false });
  dom.deliver(full);
  const text = dom.ids.sites.textContent;
  assert.match(text, /Add an update|Lab 2|7002/);
  assert.match(text, /<img src=x onerror=alert\(1\)>/); // present as text
  assert.doesNotMatch(dom.ids.status.textContent, /Could not display/);
  const unknown = plain(load({ files: { sheet1: {} } }).api.getStatusSnapshot());
  dom.deliver(unknown);
  assert.doesNotMatch(dom.ids.status.textContent, /Could not display/);
  assert.match(dom.ids.sites.textContent, /Unknown/);
});
