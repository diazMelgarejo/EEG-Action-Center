/**
 * Read-only status page. DRAFT, not deployed. Install it in its OWN Apps Script project, never in the ledger's project.
 * It runs as the person looking at it, so Google decides who can open each sheet. The code holds no organization data:
 * the sites to show live in this project's Script Properties.
 *
 * It displays what the ledger already saved in its Current, Progress and Flags tabs. It derives nothing and writes nothing.
 * Updates are added through the Google Form, which keeps the append-only and hold rules.
 */
const STATUS_ENABLED_KEY = 'statusEnabled';
const STATUS_CONFIG_KEY = 'statusConfig';
const STATUS_HOSTS = ['docs.google.com', 'drive.google.com', 'forms.gle'];
const STATUS_MAX_SITES = 50;
const STATUS_MAX_ROWS = 1000;
const STATUS_MAX_COLUMNS = 30;
const STATUS_NO_LAB = 'None'; // the ledger's word for "not in a lab"; Rules.gs NO_LAB
const STATUS_CURRENT_NEEDS = ['Lab', 'Change', 'UTC'];
const STATUS_STEP_WORDS = { Done: 'done', Next: 'next', Waiting: 'waiting' };

function statusIdentity_() {
  const active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!active || active !== effective) throw new Error('Access denied. Use the user-accessing deployment.');
  if (PropertiesService.getScriptProperties().getProperty(STATUS_ENABLED_KEY) !== 'true') throw new Error('Status app not enabled.');
}

function statusGoogleLink_(value) {
  return typeof value === 'string' && new RegExp(`^https://(?:${STATUS_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})/[^\\s<>"\\\\]*$`).test(value) ? value : '';
}

function statusHasOnly_(object, keys) {
  return Boolean(object) && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every((k) => keys.indexOf(k) !== -1);
}

function statusValidSite_(site, seen) {
  if (!statusHasOnly_(site, ['key', 'label', 'spreadsheetId', 'links'])) return false;
  if (typeof site.key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(site.key) || seen.has(site.key)) return false;
  seen.add(site.key);
  if (typeof site.label !== 'string' || !site.label.trim()) return false;
  if (typeof site.spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(site.spreadsheetId)) return false;
  if (site.links === undefined) return true;
  return statusHasOnly_(site.links, ['form', 'folder']) && Object.keys(site.links).every((k) => statusGoogleLink_(site.links[k]));
}

function statusConfig_() {
  try {
    const config = JSON.parse(PropertiesService.getScriptProperties().getProperty(STATUS_CONFIG_KEY) || 'null');
    const seen = new Set();
    const ok = statusHasOnly_(config, ['version', 'sites']) && config.version === 1 && Array.isArray(config.sites) && config.sites.length <= STATUS_MAX_SITES
      && config.sites.every((site) => statusValidSite_(site, seen));
    if (!ok) throw new Error('invalid');
    return config;
  } catch (error) {
    throw new Error('Status configuration is unavailable. Ask the administrator.');
  }
}

/** One saved tab as plain text. A missing or empty tab is Unknown: nothing is invented. */
function statusTab_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return { state: 'unknown', headers: [], rows: [], gid: null };
  const range = sheet.getDataRange();
  if (range.getNumRows() > STATUS_MAX_ROWS || range.getNumColumns() > STATUS_MAX_COLUMNS) return { state: 'too-large', headers: [], rows: [], gid: sheet.getSheetId() };
  const table = range.getDisplayValues().filter((row) => row.some((cell) => String(cell).trim()));
  const available = table.length > 1;
  return { state: available ? 'available' : 'unknown', headers: available ? table[0] : [], rows: available ? table.slice(1) : [], gid: sheet.getSheetId() };
}

function statusPick_(tab, names) {
  const at = names.map((name) => tab.headers.indexOf(name));
  return at.indexOf(-1) === -1 ? tab.rows.map((row) => at.map((i) => row[i])) : null;
}

/** Current, split into headsets in a lab and headsets held elsewhere. Unknown unless the columns are the ones the ledger writes. */
function statusHeadsets_(current) {
  const unknown = { state: current.state === 'too-large' ? 'too-large' : 'unknown', rows: [] };
  const picked = current.state === 'available' && STATUS_CURRENT_NEEDS.every((n) => current.headers.indexOf(n) !== -1)
    ? statusPick_(current, ['Lab', 'Change', 'Holding', 'Date', 'Time', 'Notes'].filter((n) => current.headers.indexOf(n) !== -1)) : null;
  if (!picked) return { inLab: unknown, notInLab: unknown };
  const names = ['Lab', 'Change', 'Holding', 'Date', 'Time', 'Notes'].filter((n) => current.headers.indexOf(n) !== -1);
  const records = picked.map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i]])));
  const shape = (r) => ({ lab: r.Lab, serial: r.Change, holding: r.Holding || '', date: r.Date || '', time: r.Time || '', notes: r.Notes || '' });
  return {
    inLab: { state: 'available', rows: records.filter((r) => r.Lab && r.Lab !== STATUS_NO_LAB && r.Change).map((r) => ({ lab: r.Lab, serial: r.Change, date: r.Date || '', time: r.Time || '', notes: r.Notes || '' })) },
    notInLab: { state: 'available', rows: records.filter((r) => r.Lab === STATUS_NO_LAB && r.Change).map(shape).map((r) => ({ serial: r.serial, holding: r.holding, date: r.date, time: r.time, notes: r.notes })) },
  };
}

/** Labs as the ledger already drew them in Progress: "Lab N" then a line break then the serial, or the word empty. */
function statusLabs_(progress, flags) {
  if (progress.state !== 'available') return { state: 'unknown', tiles: [] };
  const alerts = new Set(statusPick_(flags, ['Lab']) ? statusPick_(flags, ['Lab']).map((r) => r[0]).filter(Boolean) : []);
  const tiles = [];
  [progress.headers].concat(progress.rows).forEach((row) => row.forEach((cell) => {
    const match = /^(Lab \d+)\n([\s\S]*)$/.exec(String(cell));
    if (match) tiles.push({ lab: match[1], serial: match[2].trim() === 'empty' || !match[2].trim() ? null : match[2].trim(), alert: alerts.has(match[1]) });
  }));
  return { state: tiles.length ? 'available' : 'unknown', tiles };
}

function statusSteps_(progress) {
  const rows = progress.state === 'available' ? [progress.headers].concat(progress.rows) : [];
  const head = rows.findIndex((r) => r[0] === 'Step' && r[1] === 'Status');
  if (head < 0) return { state: 'unknown', done: 0, total: 0, items: [] };
  const items = [];
  for (const row of rows.slice(head + 1)) {
    const word = Object.keys(STATUS_STEP_WORDS).find((w) => String(row[1]).indexOf(w) !== -1);
    if (!word) break;
    items.push({ step: row[0], status: STATUS_STEP_WORDS[word], next: row[2] || '' });
  }
  return { state: items.length ? 'available' : 'unknown', done: items.filter((i) => i.status === 'done').length, total: items.length, items };
}

function statusFlags_(flags) {
  if (flags.state === 'too-large') return { state: 'too-large', rows: [] };
  if (flags.headers.length === 0 && flags.state === 'unknown') return { state: 'unknown', rows: [] };
  return { state: 'available', rows: flags.rows.map((row) => row.filter((cell) => String(cell).trim()).join(' · ')) };
}

function statusSite_(site) {
  const spreadsheet = SpreadsheetApp.openById(site.spreadsheetId); // opens as the accessing user: Google enforces their access
  const base = statusGoogleLink_(spreadsheet.getUrl());
  if (!base) throw new Error('Invalid sheet URL.');
  const current = statusTab_(spreadsheet, 'Current');
  const progress = statusTab_(spreadsheet, 'Progress');
  const flags = statusTab_(spreadsheet, 'Flags');
  const review = spreadsheet.getSheetByName('Review');
  const page = base.split('#')[0];
  const links = { sheet: base };
  if (current.gid !== null) links.current = `${page}#gid=${current.gid}`;
  if (progress.gid !== null) links.progress = `${page}#gid=${progress.gid}`;
  if (review) links.review = `${page}#gid=${review.getSheetId()}`;
  Object.keys(site.links || {}).forEach((k) => { links[k] = site.links[k]; });
  const headsets = statusHeadsets_(current);
  return {
    key: site.key, label: site.label, zone: spreadsheet.getSpreadsheetTimeZone(), links,
    labs: statusLabs_(progress, flags), inLab: headsets.inLab, notInLab: headsets.notInLab,
    steps: statusSteps_(progress), flags: statusFlags_(flags),
  };
}

function getStatusSnapshot() {
  statusIdentity_();
  const sites = [];
  let unavailable = 0;
  statusConfig_().sites.forEach((site) => {
    try { sites.push(statusSite_(site)); } catch (error) { unavailable += 1; } // the reason is never sent: it could name a file
  });
  return { version: 2, readAtUtc: new Date().toISOString(), sites, unavailable };
}

function doGet() {
  statusIdentity_();
  return HtmlService.createHtmlOutputFromFile('Status').setTitle('Equipment status');
}
