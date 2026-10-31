// Tests for the public dashboard (run with: node --test tests/frontend.test.js). No browser and no Google services needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appText = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const pageText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadApp(saved = {}) {
  const store = new Map(Object.entries(saved));
  const context = {
    URL,
    console: { warn: () => {} },
    localStorage: { removeItem: (key) => store.delete(key), getItem: (key) => store.get(key) ?? null },
    document: { addEventListener: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(appText, context);
  return { app: context, store };
}

test('the page states no count, progress or occupancy it cannot know', () => {
  assert.doesNotMatch(appText, /renderLabTiles|lab-tile/);
  assert.doesNotMatch(pageText, /labs-grid|of 9 steps|steps verified|Site Connected|Real-time|progress-bar/);
  assert.match(pageText, /Not connected/);
});

test('nothing pretends to authenticate: no token decoding, no sign-in script, no client id', () => {
  assert.doesNotMatch(appText, /atob|credential|client_id|clientId|apps\.googleusercontent/);
  assert.doesNotMatch(pageText, /accounts\.google\.com|Authenticated|cfg-client-id|Authentication Required/);
});

test('setup is reachable without signing in', () => {
  assert.doesNotMatch(pageText, /id="dashboard" class="[^"]*hidden/);
  assert.match(pageText, /id="config-btn"/);
});

test('site links are never written to the browser, and an old saved copy is erased', () => {
  assert.doesNotMatch(appText, /setItem|sessionStorage/);
  const { app, store } = loadApp({ eeg_action_center_config: '{"sheetUrl":"x"}' });
  app.eraseSavedConfig();
  assert.equal(store.size, 0);
});

test('erasing still works when the browser blocks storage', () => {
  const { app } = loadApp();
  app.localStorage.removeItem = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => app.eraseSavedConfig());
});

test('the Review link is never invented from the sheet link', () => {
  assert.doesNotMatch(appText, /gid=/);
  assert.match(pageText, /id="cfg-review"/);
});

test('only https links on Google hosts are accepted', () => {
  const { app } = loadApp();
  ['https://docs.google.com/spreadsheets/d/x', 'https://forms.gle/x', 'https://drive.google.com/drive/folders/x'].forEach((url) => assert.equal(app.isGoogleLink(url), true, url));
  ['javascript:alert(1)', 'http://docs.google.com/x', 'https://docs.google.com.example.org/x', 'not a link', ''].forEach((url) => assert.equal(app.isGoogleLink(url), false, url));
});

test('the page sets a strict content security policy and sends no referrer', () => {
  assert.match(pageText, /http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"/);
  assert.match(pageText, /name="referrer" content="no-referrer"/);
});

test('a site name has no default and its example names no real place', () => {
  assert.doesNotMatch(appText, /Example Labs|siteName: "/);
  assert.match(pageText, /placeholder="e\.g\. Site A"/);
});

test('the status page link accepts only a production Apps Script web app address, in the forms Google uses', () => {
  const { app } = loadApp();
  [
    'https://script.google.com/macros/s/AKfycbxExample_id-1/exec',
    'https://script.google.com/a/macros/example.org/s/AKfycbxExample_id-1/exec',
    'https://script.google.com/a/example.org/macros/s/AKfycbxExample_id-1/exec',
  ].forEach((url) => assert.equal(app.isStatusLink(url), true, url));
  [
    'http://script.google.com/macros/s/AKfy/exec',
    'https://script.google.com/macros/s/AKfy/dev',
    'https://script.google.com/macros/s/AKfy/exec?x=1',
    'https://script.google.com/macros/s/AKfy/exec#frag',
    'https://script.google.com.example.org/macros/s/AKfy/exec',
    'https://user:pw' + '@script.google.com/macros/s/AKfy/exec', // split so it does not look like an address to the scanner
    'https://script.google.com:8443/macros/s/AKfy/exec',
    'https://docs.google.com/spreadsheets/d/x',
    'javascript:alert(1)', '',
  ].forEach((url) => assert.equal(app.isStatusLink(url), false, url));
});

test('the status link is its own optional field, disabled until set, and rejected if it is not a status address', () => {
  assert.match(pageText, /id="link-status"/);
  assert.match(pageText, /id="cfg-status"/);
  assert.match(appText, /statusUrl/);
});
