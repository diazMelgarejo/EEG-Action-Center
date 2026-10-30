/**
 * Real-data initialization, domain gate and visual progress. DRAFT, not deployed.
 *
 * Real inventory data is never in this code. It is read from the organization's own sheets by the signed-in person, only after
 * their account is checked against DOMAIN, and it is written only into this spreadsheet (Review, Seed, Ledger). Every question the
 * data raises is shown on the Review tab for the operator to decide; nothing is guessed, and an undecided item blocks seeding.
 * What each step does is decided in Tips.gs and Rules.gs; this file reads and writes.
 */
const DOMAIN_KEY = 'organizationDomain';
const LAB_COUNT_KEY = 'labCount';
const OTHER_ZONE_KEY = 'otherTimeZone';
const LOCAL_ZONE_KEY = 'localTimeZone';
const SITE_FILE_KEY = 'siteFileId';
const MODE_KEY = 'siteMode';
const MODE_TEMPLATE = 'template';
const MODE_EXISTING = 'existing'; // loads from existing sheets in the organization's Drive
const MODE_NEW = 'new'; // starts empty; an admin adds its headsets
const DEFAULT_OTHER_ZONE = 'UTC';
const SITES_TAB = 'Sites';
const SITES_COLUMNS = ['Site', 'File', 'First admin', 'Created (UTC)', 'Created by'];
const ADMINS_KEY = 'admins';
const SOURCE_WORKBOOK_KEY = 'sourceWorkbookId';
const SOURCE_LEGEND_KEY = 'sourceLegendId';
const SOURCE_TAB = 'Hardware changes';
const LEGEND_TAB = 'EEG';
const REVIEW_COLUMNS = ['Key', 'Place', 'Workbook serial', 'Workbook row', 'Legend serial', 'Status', 'Why', 'Options', 'Decision'];
const PROGRESS_COLUMNS = ['Step', 'Status', 'Next action'];
const PROGRESS_TAB = 'Progress';
const REVIEW_TAB = 'Review';
const GRID_COLUMNS = 5;
const COLORS = { pearl: '#F1EEE6', ivory: '#FBF9F1', alert: '#F3D7D3', bar: '#6E6A5F' };
const STATUS_TEXT = { done: '✅ Done', next: '⏳ Next', waiting: '⬜ Waiting' };
const NEXT_ACTION = {
  'Tabs created': 'Run setup() once from the script editor.',
  'Form built': 'Run setup() once from the script editor.',
  'Submit trigger installed': 'Run setup() once; the same account must own the sheet and the trigger.',
  'Signed in on the organization domain': 'Open this sheet signed in with your organization account.',
  'Source workbook set': 'Headset log menu, Set source workbooks.',
  'Tips proposed': 'Headset log menu, Load tips from workbook.',
  'Every decision made': 'Fill the Decision column on the Review tab for every row that needs one.',
  'Ledger seeded': 'Headset log menu: Seed from reviewed tips, or Add a headset on a new site.',
  'Derived views and flags clean': 'Open the Flags tab and explain every row, or fix its cause.',
};

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '');
}

/** A setting counts only in the file that made it, so a copied file can never inherit another site's settings. */
function setting_(key) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(SITE_FILE_KEY) === SpreadsheetApp.getActive().getId() ? props.getProperty(key) : null;
}

function requireDomainValue_(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) throw new Error('Give the organization domain, such as example.org.');
  if (setting_(DOMAIN_KEY)) throw new Error('Already configured. An admin can change the settings.');
  if (!currentEmail_().toLowerCase().endsWith(`@${value}`)) throw new Error('Run this signed in with an account on that domain.');
  return value;
}

function saveSettings_(domain, mode, extra) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(SITE_FILE_KEY, SpreadsheetApp.getActive().getId());
  props.setProperty(DOMAIN_KEY, domain);
  props.setProperty(MODE_KEY, mode);
  props.setProperty(ADMINS_KEY, JSON.stringify([currentEmail_().toLowerCase()]));
  Object.keys(extra).forEach((key) => props.setProperty(key, extra[key]));
}

/**
 * Set once in a site's file. The domain, lab count and other time zone are settings, never written in code.
 * Sheets are always in local time and this code never changes that: a person sets it in File, Settings, and confirms it here by naming it.
 * Whoever runs this must be on that domain and becomes the site's first admin.
 * mode: 'existing' loads from sheets already in the organization's Drive; 'new' starts empty.
 */
function configure(domain, labCount, confirmedLocalZone, otherZone, mode) {
  const siteMode = mode || MODE_EXISTING;
  if (siteMode !== MODE_EXISTING && siteMode !== MODE_NEW) throw new Error(`Choose ${MODE_EXISTING} or ${MODE_NEW}.`);
  requireLabCount_(labCount);
  if (confirmedLocalZone !== localZone_()) {
    throw new Error(`This sheet's local time zone is ${localZone_()}. If that is wrong, a person changes it in File, Settings. Then name it here to confirm.`);
  }
  const zone = otherZone || DEFAULT_OTHER_ZONE;
  requireZone_(zone);
  requireUtcScript_();
  const value = requireDomainValue_(domain);
  saveSettings_(value, siteMode, { [LAB_COUNT_KEY]: String(labCount), [OTHER_ZONE_KEY]: zone, [LOCAL_ZONE_KEY]: confirmedLocalZone });
}

/** Set once in the clean template file. The template holds the Sites list and never any inventory data. */
function configureTemplate(domain) {
  requireUtcScript_();
  saveSettings_(requireDomainValue_(domain), MODE_TEMPLATE, {});
  const sheet = SpreadsheetApp.getActive().insertSheet(SITES_TAB);
  sheet.appendRow(SITES_COLUMNS);
  sheet.setFrozenRows(1);
}

function requireLabCount_(labCount) {
  if (!Number.isInteger(labCount) || labCount < 1) throw new Error('Give the number of labs as a whole number.');
}

/** The script always runs in UTC, so what the rules hold is UTC. Local time is converted at the edges. */
function requireUtcScript_() {
  if (['Etc/UTC', 'UTC', 'GMT', 'Etc/GMT'].indexOf(Session.getScriptTimeZone()) === -1) {
    throw new Error('In Apps Script, open Project settings and set the time zone to UTC, then run this again.');
  }
}

function requireZone_(zone) {
  const value = String(zone || '');
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) throw new Error('Give a time zone name, such as UTC or Europe/Paris.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch (error) {
    throw new Error(`Unknown time zone: ${value}.`);
  }
}

/**
 * Local time is autodetected: it is this sheet's own time zone, the zone of every Date, Time and Date&Time cell.
 * Once confirmed by configure(), a different zone stops the app, so a label can never disagree with the cells already written.
 */
function localZone_() {
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const confirmed = setting_(LOCAL_ZONE_KEY);
  if (confirmed && zone !== confirmed) throw new Error(`This site's local time zone is ${confirmed} but the sheet now says ${zone}. Put it back in File, Settings.`);
  return zone;
}

function otherZone_() {
  return setting_(OTHER_ZONE_KEY) || DEFAULT_OTHER_ZONE;
}

/** Local wall-clock inputs to UTC. Blank means now; the same rules as resolveWhen, applied in local time. */
function utcFromLocal_(dateInput, timeInput, now) {
  const zone = localZone_();
  const [day, clock] = Utilities.formatDate(now, zone, 'yyyy-MM-dd HH:mm').split(' ');
  const wall = combineDateTime(parseDateText(day), clock);
  const { date, time, timeBasis } = resolveWhen(dateInput, timeInput, wall);
  const instant = Utilities.parseDate(`${isoDate(date)} ${time}`, zone, 'yyyy-MM-dd HH:mm');
  return { date: dateOnly_(instant), time: clockOf_(instant), timeBasis };
}

function admins_() {
  return JSON.parse(setting_(ADMINS_KEY) || '[]');
}

function requireAdmin_() {
  requireDomainUser_();
  if (admins_().indexOf(currentEmail_().toLowerCase()) === -1) throw new Error('Only an admin of this file can do that.');
}

/** Admins only. Rewrites the displays; the Ledger stores UTC and does not change. */
function setOtherTimeZone(zone) {
  requireAdmin_();
  requireZone_(zone);
  localZone_();
  PropertiesService.getScriptProperties().setProperty(OTHER_ZONE_KEY, zone);
  if (tab_('ledger')) refreshDerived_(readLedger_());
  refreshProgress();
}

function setLabCount(labCount) {
  requireAdmin_();
  requireLabCount_(labCount);
  PropertiesService.getScriptProperties().setProperty(LAB_COUNT_KEY, String(labCount));
  refreshProgress();
}

/** Admins are kept per file, so each site has its own. */
function addAdmin(email) {
  requireAdmin_();
  const value = String(email || '').trim().toLowerCase();
  if (!value.endsWith(`@${domain_()}`)) throw new Error(`An admin must be on ${domain_()}.`);
  const admins = admins_();
  if (admins.indexOf(value) === -1) PropertiesService.getScriptProperties().setProperty(ADMINS_KEY, JSON.stringify(admins.concat([value])));
}

function removeAdmin(email) {
  requireAdmin_();
  const value = String(email || '').trim().toLowerCase();
  const admins = admins_().filter((a) => a !== value);
  if (!admins.length) throw new Error('At least one admin must remain.');
  PropertiesService.getScriptProperties().setProperty(ADMINS_KEY, JSON.stringify(admins));
}

/** Template admins only. Copies the clean template into a new file for a site. Its first admin sets the file's local time zone in File, Settings. */
function addSite(name, firstAdmin) {
  requireAdmin_();
  if (setting_(MODE_KEY) !== MODE_TEMPLATE) throw new Error('Add sites from the template file.');
  const site = String(name || '').trim();
  if (!site) throw new Error('Give the site a name.');
  const admin = String(firstAdmin || '').trim().toLowerCase();
  if (!admin.endsWith(`@${domain_()}`)) throw new Error(`The first admin must be on ${domain_()}.`);
  const ss = SpreadsheetApp.getActive();
  const list = ss.getSheetByName(SITES_TAB);
  if (list.getDataRange().getValues().slice(1).some((row) => String(row[0]).toLowerCase() === site.toLowerCase())) throw new Error(`${site} already exists.`);
  const file = ss.copy(`Headset log - ${site}`);
  file.deleteSheet(file.getSheetByName(SITES_TAB)); // a site never sees the list of other sites
  file.addEditor(admin);
  const now = new Date();
  list.appendRow([site, file.getUrl(), admin, `${isoDate(now)}T${clockOf_(now)}:00Z`, currentEmail_()]);
  return file.getUrl();
}

/** Site admins only. A site with no source workbook starts here; the form then moves the headset into a lab. */
function addHeadset(serial, place) {
  requireAdmin_();
  const number = Number(serial);
  if (!Number.isInteger(number) || number < 1) throw new Error('Give the serial number.');
  const now = new Date();
  const ledger = readLedger_();
  const rows = addHeadsetRows({ ledger, serial: number, place: place || HOLDING_PLACES[0], when: now, timeBasis: 'defaulted', group: `admin-${now.getTime()}` });
  appendRows_(tab_('ledger'), rows, { at: now, author: currentEmail_() }, {});
  refreshDerived_(ledger.concat(rows));
  refreshProgress();
}

function domain_() {
  const value = setting_(DOMAIN_KEY);
  if (!value) throw new Error('Run configure() first.');
  return value;
}

function labCount_() {
  const value = Number(setting_(LAB_COUNT_KEY));
  if (!value) throw new Error('Run configure() first.');
  return value;
}

/** Fails closed: not configured, or an empty address, counts as outside. */
function onDomain_() {
  const value = setting_(DOMAIN_KEY);
  return Boolean(value) && currentEmail_().toLowerCase().endsWith(`@${value}`);
}

/** Real data is read and written only for a signed-in person on the organization's domain. */
function requireDomainUser_() {
  if (!onDomain_()) {
    throw new Error(`Sign in with a ${domain_()} account first. This step reads the organization's inventory data.`);
  }
  return currentEmail_();
}

/** A sheet id from a pasted link or a bare id. */
function idFromInput_(text) {
  const value = String(text || '').trim();
  const link = value.match(/\/d\/([A-Za-z0-9_-]+)/);
  const id = link ? link[1] : value;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error('That does not look like a Google Sheets link or id.');
  return id;
}

/** Stores the ids of the source workbook (required) and the weekly legend (optional). Only the ids are kept. */
function setSourceWorkbooks(workbookInput, legendInput) {
  requireDomainUser_();
  const props = PropertiesService.getScriptProperties();
  const workbookId = idFromInput_(workbookInput);
  const source = SpreadsheetApp.openById(workbookId);
  if (!source.getSheetByName(SOURCE_TAB)) throw new Error(`The workbook has no "${SOURCE_TAB}" tab.`);
  if (source.getSpreadsheetTimeZone() !== localZone_()) {
    throw new Error(`The workbook's local time is ${source.getSpreadsheetTimeZone()} but this sheet's is ${localZone_()}. A person should check both in File, Settings.`);
  }
  props.setProperty(SOURCE_WORKBOOK_KEY, workbookId);
  if (String(legendInput || '').trim()) {
    const legendId = idFromInput_(legendInput);
    if (!SpreadsheetApp.openById(legendId).getSheetByName(LEGEND_TAB)) throw new Error(`The legend has no "${LEGEND_TAB}" tab.`);
    props.setProperty(SOURCE_LEGEND_KEY, legendId);
  }
  refreshProgress();
}

/** Hardware changes rows. Date and Time are the inputs; column C is never read. */
function readSourceRows_() {
  const id = PropertiesService.getScriptProperties().getProperty(SOURCE_WORKBOOK_KEY);
  if (!id) throw new Error('Set the source workbook first.');
  const source = SpreadsheetApp.openById(id);
  const zone = source.getSpreadsheetTimeZone();
  const range = source.getSheetByName(SOURCE_TAB).getDataRange();
  const values = range.getValues();
  const shown = range.getDisplayValues();
  const header = values.findIndex((row) => HARDWARE_COLUMNS.every((name, i) => row[i] === name));
  if (header === -1) throw new Error(`No header row with ${HARDWARE_COLUMNS.join(', ')} was found.`);
  const rows = [];
  values.slice(header + 1).forEach((cells, index) => {
    const [date, , , lab, type, change, notes] = cells;
    if (type !== HEADSET || !Number.isInteger(Number(change)) || change === '') return;
    const time = /^\d{1,2}:\d{2}$/.test(shown[header + 1 + index][1]) ? parseTimeText(shown[header + 1 + index][1]) : '';
    const day = date instanceof Date ? Utilities.formatDate(date, zone, 'yyyy-MM-dd') : '';
    const instant = day && time ? Utilities.parseDate(`${day} ${time}`, zone, 'yyyy-MM-dd HH:mm') : null;
    rows.push({ number: header + 2 + index, date: instant ? dateOnly_(instant) : parseDateText(day), time: instant ? clockOf_(instant) : '', lab: String(lab).trim(), type, change: Number(change), notes: String(notes || '') });
  });
  return rows;
}

/** The latest weekly snapshot of the legend tab, or an empty legend when none is set. */
function readSourceLegend_() {
  const id = PropertiesService.getScriptProperties().getProperty(SOURCE_LEGEND_KEY);
  const legend = { labs: {}, holding: {} };
  if (!id) return legend;
  const grid = SpreadsheetApp.openById(id).getSheetByName(LEGEND_TAB).getDataRange().getValues();
  let last = -1;
  grid[0].forEach((cell, i) => { if (cell instanceof Date) last = i; });
  if (last === -1) throw new Error('The legend has no dated column.');
  grid.slice(2).forEach((row) => {
    const label = row[0];
    const cell = row[last];
    if (typeof label === 'number') legend.labs[`Lab ${label}`] = cell;
    else if (typeof label === 'string' && Number.isInteger(cell)) legend.holding[String(cell)] = /repair/i.test(label) ? 'For repair' : /spare/i.test(label) ? 'Spare' : '';
  });
  Object.keys(legend.holding).filter((k) => !legend.holding[k]).forEach((k) => delete legend.holding[k]);
  return legend;
}

function proposalRow_(p) {
  return [p.key, p.place, p.workbook === null ? '' : p.workbook, p.workbookRow === null ? '' : p.workbookRow, p.legend === null ? (p.legendText || '') : p.legend, p.status, p.reason, p.options.join(' | '), ''];
}

function writeReview_(proposals) {
  const sheet = tab_('review');
  sheet.clearContents();
  sheet.appendRow(REVIEW_COLUMNS);
  proposals.forEach((p) => sheet.appendRow(proposalRow_(p)));
  const decision = REVIEW_COLUMNS.indexOf('Decision') + 1;
  proposals.forEach((p, i) => {
    if (!p.options.length) return;
    sheet.getRange(i + 2, decision).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(p.options, true).setAllowInvalid(false).build());
  });
}

/** Proposes the latest tip for every lab from the live workbook. Writes only the Review tab. */
function loadTipProposals() {
  requireDomainUser_();
  const proposals = proposeTips(readSourceRows_(), readSourceLegend_(), labCount_());
  writeReview_(proposals);
  refreshProgress();
  return { proposals: proposals.length, decisionsNeeded: proposals.filter((p) => p.status === DECIDE).length };
}

function readDecisions_() {
  const [columns, ...rows] = tab_('review').getDataRange().getValues();
  const key = columns.indexOf('Key');
  const decision = columns.indexOf('Decision');
  const decisions = {};
  rows.forEach((row) => { if (String(row[decision]).trim()) decisions[row[key]] = String(row[decision]).trim(); });
  return decisions;
}

/** Applies the operator's decisions, recomputed from the live sources, then seeds the ledger. Nothing is guessed. */
function seedFromReview() {
  requireDomainUser_();
  const rows = readSourceRows_();
  const proposals = proposeTips(rows, readSourceLegend_(), labCount_());
  const result = resolveTips(proposals, readDecisions_(), rows);
  if (result.unresolved.length) {
    const sheet = tab_('review');
    const known = new Set(sheet.getDataRange().getValues().map((r) => r[0]));
    result.extra.filter((p) => !known.has(p.key)).forEach((p) => sheet.appendRow(proposalRow_(p)));
    refreshProgress();
    return { seeded: false, unresolved: result.unresolved.length, message: `${result.unresolved.length} decision(s) still needed on the Review tab.` };
  }
  const seed = tab_('seed');
  seed.clearContents();
  seed.appendRow(SEED_COLUMNS);
  seed.getRange(2, 1, result.seedTable.length, SEED_COLUMNS.length).setNumberFormat('@');
  result.seedTable.forEach((row) => seed.appendRow(row));
  seedLedger();
  return { seeded: true, rows: result.seedTable.length, held: result.held };
}

function labTiles_(ledger) {
  const flagged = new Set(findViolations(ledger).map((v) => v.lab));
  const tiles = [];
  for (let n = 1; n <= labCount_(); n += 1) {
    const lab = `Lab ${n}`;
    const serial = labDisplay(ledger, lab);
    tiles.push({ text: `${lab}\n${serial === null ? 'empty' : serial}`, color: flagged.has(lab) ? COLORS.alert : serial === null ? COLORS.ivory : COLORS.pearl });
  }
  return tiles;
}

/** Facts come from what exists in the file, never from a typed flag, so the checklist cannot drift from reality. */
function gatherFacts_() {
  const props = PropertiesService.getScriptProperties();
  const names = Object.keys(TAB_NAMES).map((k) => TAB_NAMES[k]).concat([REVIEW_TAB, PROGRESS_TAB]);
  const ss = SpreadsheetApp.getActive();
  const present = (name) => Boolean(ss.getSheetByName(name));
  const ledgerRows = present(TAB_NAMES.ledger) ? Math.max(0, tab_('ledger').getLastRow() - 1) : 0;
  const reviewRows = present(REVIEW_TAB) ? tab_('review').getDataRange().getValues().slice(1) : [];
  const status = REVIEW_COLUMNS.indexOf('Status');
  const decision = REVIEW_COLUMNS.indexOf('Decision');
  const open = reviewRows.filter((r) => r[status] === DECIDE && !String(r[decision]).trim()).length;
  const flags = present(TAB_NAMES.flags) ? tab_('flags').getLastRow() - 1 : 1;
  const startsEmpty = setting_(MODE_KEY) === MODE_NEW;
  let formReady = false;
  try { formReady = Boolean(form_()); } catch (error) { formReady = false; }
  return {
    'Tabs created': names.every(present),
    'Form built': formReady,
    'Submit trigger installed': ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'onFormSubmit'),
    'Signed in on the organization domain': onDomain_(),
    'Source workbook set': startsEmpty || Boolean(props.getProperty(SOURCE_WORKBOOK_KEY)),
    'Tips proposed': startsEmpty || reviewRows.length > 0 || ledgerRows > 0,
    'Every decision made': startsEmpty || (reviewRows.length > 0 && open === 0) || ledgerRows > 0,
    'Ledger seeded': ledgerRows > 0,
    'Derived views and flags clean': ledgerRows > 0 && flags <= 0,
  };
}

/** Rewrites the Progress tab: a checklist, a bar, and one tile per lab. Safe to run any time; it only reads and draws. */
function refreshProgress() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(PROGRESS_TAB);
  if (!sheet) return null;
  const steps = setupProgress(gatherFacts_());
  const [done, total] = progressFraction(steps);
  sheet.clearContents();
  sheet.appendRow(['Headset log setup', `${done} of ${total} steps done`, `=SPARKLINE(${done / total},{"charttype","bar";"max",1;"color1","${COLORS.bar}"})`]);
  sheet.appendRow(PROGRESS_COLUMNS);
  steps.forEach(([name, status]) => sheet.appendRow([name, STATUS_TEXT[status], status === 'done' ? '' : NEXT_ACTION[name]]));
  const ledger = SpreadsheetApp.getActive().getSheetByName(TAB_NAMES.ledger) && tab_('ledger').getLastRow() > 1 ? readLedger_() : [];
  const tiles = setting_(LAB_COUNT_KEY) ? labTiles_(ledger) : [];
  const start = sheet.getLastRow() + 2;
  sheet.getRange(start - 1, 1).setValue('Labs now (last-known headset; red means more than one headset in a lab)');
  for (let r = 0; r * GRID_COLUMNS < tiles.length; r += 1) {
    const slice = tiles.slice(r * GRID_COLUMNS, (r + 1) * GRID_COLUMNS);
    const range = sheet.getRange(start + r, 1, 1, slice.length);
    range.setValues([slice.map((t) => t.text)]);
    range.setBackgrounds([slice.map((t) => t.color)]);
  }
  const now = new Date();
  sheet.appendRow([]);
  sheet.appendRow(['Time zones', `Local (${localZone_()}): ${Utilities.formatDate(now, localZone_(), 'yyyy/MM/dd  HH:mm')}`, `Other (${otherZone_()}): ${Utilities.formatDate(now, otherZone_(), 'yyyy/MM/dd  HH:mm')}`]);
  return { steps, done, total };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Headset log')
    .addItem('Check progress', 'refreshProgress')
    .addItem('Set source workbooks', 'promptSourceWorkbooks')
    .addItem('Load tips from workbook', 'loadTipProposals')
    .addItem('Seed from reviewed tips', 'seedFromReview')
    .addSeparator()
    .addItem('Set other time zone (admin)', 'promptOtherZone')
    .addItem('Add an admin (admin)', 'promptAdmin')
    .addItem('Add a headset (admin)', 'promptHeadset')
    .addItem('Add a site (template admin)', 'promptSite')
    .addToUi();
}

function promptSourceWorkbooks() {
  const ui = SpreadsheetApp.getUi();
  const workbook = ui.prompt('Source workbook', 'Paste the link of the workbook with the Hardware changes tab:', ui.ButtonSet.OK_CANCEL);
  if (workbook.getSelectedButton() !== ui.Button.OK) return;
  const legend = ui.prompt('Weekly legend (optional)', 'Paste the link of the weekly legend, or leave blank:', ui.ButtonSet.OK_CANCEL);
  if (legend.getSelectedButton() !== ui.Button.OK) return;
  setSourceWorkbooks(workbook.getResponseText(), legend.getResponseText());
}

function promptOtherZone() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Other time zone', 'Time zone name, such as UTC or Europe/Paris:', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() === ui.Button.OK) setOtherTimeZone(answer.getResponseText().trim());
}

function promptHeadset() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Add a headset', 'Serial number:', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() === ui.Button.OK) addHeadset(answer.getResponseText().trim());
}

function promptSite() {
  const ui = SpreadsheetApp.getUi();
  const asked = ['Site name:', 'First admin email:'].map((text) => ui.prompt('Add a site', text, ui.ButtonSet.OK_CANCEL));
  if (asked.every((a) => a.getSelectedButton() === ui.Button.OK)) ui.alert(`Created: ${addSite(...asked.map((a) => a.getResponseText()))}`);
}

function promptAdmin() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Add an admin', 'Email address on the organization domain:', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() === ui.Button.OK) addAdmin(answer.getResponseText());
}
