/**
 * Headset log: the Google layer. DRAFT, not deployed; run nothing here until the pilot checklist says so.
 *
 * The spreadsheet holds the ledger and this script is bound to it. setup() builds an UNPUBLISHED form.
 * Everything that decides what a row should be lives in Rules.gs; this file only reads and writes.
 * No organization data lives in this code: the domain and lab count are set at install by configure().
 * Every tab leads with the Hardware changes columns. Date&Time is a formula of Date + Time, never typed.
 * Only UTC is stored, in the UTC column. Date, Time and Date&Time show that instant in the sheet's local time; the View tab adds a second zone.
 */
/** Evaluated at call time, so no file needs another file's constants while the project loads (file order is not guaranteed). */
function tabs_() {
  return {
    ledger: LEDGER_COLUMNS,
    maintenance: LEDGER_COLUMNS,
    held: HARDWARE_COLUMNS.concat(['EntryID', 'EntryTime', 'Author', 'Reason', 'Answers']),
    current: HARDWARE_COLUMNS.concat(['Holding', 'TimeBasis', 'UTC', 'Other time']),
    view: ['Local time', 'Other time', 'Lab', 'Type', 'Change', 'Notes', 'Holding', 'UTC'],
    flags: HARDWARE_COLUMNS,
    seed: SEED_COLUMNS,
    review: REVIEW_COLUMNS,
    progress: PROGRESS_COLUMNS,
  };
}
const TAB_NAMES = { ledger: 'Ledger', maintenance: 'Maintenance', held: 'Held', current: 'Current', flags: 'Flags', seed: 'Seed', review: 'Review', progress: 'Progress', view: 'View' };
const PLAIN_TABS = ['review', 'progress', 'view']; // proposals, a checklist, and a display of every row in two zones
const PROTECTED_TABS = ['ledger', 'maintenance', 'held', 'current', 'flags', 'view'];
const FORM_ID_KEY = 'formId';
const LOCK_WAIT_MS = 30000;
const PARTS = ['Cz', 'Pz', 'Fz', 'Drawstring', 'BOA knob', 'Cushion pad']; // list to be confirmed by the operator
const PULL_OUT_REASONS = ['Cleansing', 'Rotation', 'Fault'];
const FIRST_CHOICE_PLACEHOLDER = 'Add headsets first';

function titles() {
  return {
    action: 'What happened?',
    actionIn: 'A headset went into a lab',
    actionOut: 'A headset came out of a lab',
    actionFix: 'A headset was repaired or a part changed',
    labIn: 'Which lab?',
    serialIn: 'Which headset went in?',
    displaced: 'The headset already there goes to',
    labOut: 'Which lab did it leave?',
    serialOut: 'Which headset came out?',
    destination: 'Where did it go?',
    reason: 'Why was it pulled out?',
    serialFix: 'Which headset?',
    parts: 'What was changed?',
    defect: 'Defect ID',
    date: 'Date',
    time: 'Time',
    ticket: 'Ticket link',
    notes: 'Notes',
  };
}

function tab_(key) {
  return SpreadsheetApp.getActive().getSheetByName(TAB_NAMES[key]);
}

/** Every tab says what its time columns are. The Hardware changes column names stay exact, so the zone goes in a note on the header. */
function labelTimeColumns_(sheet, key) {
  if (key === 'progress' || key === 'view') return;
  const columns = tabs_()[key];
  const local = `Local time, ${localZone_()}. For people. The app reads the UTC column only.`;
  ['Date', 'Time', 'Date&Time'].filter((name) => columns.indexOf(name) !== -1).forEach((name) => sheet.getRange(1, columns.indexOf(name) + 1).setNote(local));
  if (columns.indexOf('UTC') !== -1) sheet.getRange(1, columns.indexOf('UTC') + 1).setNote('Saved app data, always UTC. The only time the app reads.');
}

/** Run once by hand from the script editor. Creates tabs, the unpublished form and the submit trigger. */
function setup() {
  requireDomainUser_();
  requireUtcScript_();
  if (setting_(MODE_KEY) === MODE_TEMPLATE) throw new Error('This is the template. Use Add a site, then set up the new file.');
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  Object.keys(tabs_()).forEach((key) => {
    if (ss.getSheetByName(TAB_NAMES[key])) return; // safe to run again: existing tabs are left alone
    const sheet = ss.insertSheet(TAB_NAMES[key]);
    if (key !== 'progress') sheet.appendRow(tabs_()[key]);
    labelTimeColumns_(sheet, key);
    sheet.setFrozenRows(1);
    formatTab_(sheet, key);
    if (PROTECTED_TABS.indexOf(key) !== -1) protectTab_(sheet);
  });
  if (!props.getProperty(FORM_ID_KEY)) {
    const form = buildForm_();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    props.setProperty(FORM_ID_KEY, form.getId());
    ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  }
  refreshProgress();
}

/** The same display formats as Hardware changes. The Seed tab stays plain text so a paste is kept exactly. */
function formatTab_(sheet, key) {
  if (PLAIN_TABS.indexOf(key) !== -1) return;
  const column = (index) => sheet.getRange(2, index, sheet.getMaxRows() - 1, 1);
  if (key === 'seed') {
    sheet.getRange(1, 1, sheet.getMaxRows(), SEED_COLUMNS.length).setNumberFormat('@');
    return;
  }
  column(1).setNumberFormat(DATE_DISPLAY);
  column(2).setNumberFormat(TIME_DISPLAY);
  column(3).setNumberFormat(DATE_TIME_DISPLAY);
  const entryTime = tabs_()[key].indexOf('EntryTime');
  if (entryTime !== -1) column(entryTime + 1).setNumberFormat(DATE_TIME_DISPLAY);
}

function protectTab_(sheet) {
  const protection = sheet.protect().setDescription('Written by the script only');
  protection.removeEditors(protection.getEditors());
}

function buildForm_() {
  const t = titles();
  const form = FormApp.create('Headset log')
    .setDescription('One entry for each move, at the moment it happens.')
    .setConfirmationMessage('Saved. If anything needs fixing, you will get an email.')
    .setCollectEmail(true)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(true)
    .setProgressBar(true);
  if (form.supportsAdvancedResponderPermissions()) form.setPublished(false);

  const action = form.addMultipleChoiceItem().setTitle(t.action).setRequired(true);

  const pageIn = form.addPageBreakItem().setTitle('Into a lab');
  form.addListItem().setTitle(t.labIn).setRequired(true).setChoiceValues([FIRST_CHOICE_PLACEHOLDER]);
  form.addListItem().setTitle(t.serialIn).setRequired(true).setChoiceValues([FIRST_CHOICE_PLACEHOLDER]);
  form.addMultipleChoiceItem().setTitle(t.displaced).setHelpText('Spare unless you choose For repair.').setChoiceValues(HOLDING_PLACES);

  const pageOut = form.addPageBreakItem().setTitle('Out of a lab');
  form.addListItem().setTitle(t.labOut).setRequired(true).setChoiceValues([FIRST_CHOICE_PLACEHOLDER]);
  form.addListItem().setTitle(t.serialOut).setHelpText('Leave blank if it is the headset shown beside the lab.').setChoiceValues([FIRST_CHOICE_PLACEHOLDER]);
  form.addMultipleChoiceItem().setTitle(t.destination).setRequired(true).setChoiceValues(HOLDING_PLACES.concat([RETIRED_PLACE]));
  form.addMultipleChoiceItem().setTitle(t.reason).setChoiceValues(PULL_OUT_REASONS).showOtherOption(true);

  const pageFix = form.addPageBreakItem().setTitle('Maintenance');
  form.addListItem().setTitle(t.serialFix).setRequired(true).setChoiceValues([FIRST_CHOICE_PLACEHOLDER]);
  form.addCheckboxItem().setTitle(t.parts).setChoiceValues(PARTS).showOtherOption(true);
  form.addTextItem().setTitle(t.defect);

  const pageWhen = form.addPageBreakItem().setTitle('When').setHelpText(`Use local time (${localZone_()}). Leave date and time blank if it is happening now.`);
  form.addDateItem().setTitle(t.date);
  form.addTimeItem().setTitle(t.time);
  form.addTextItem().setTitle(t.ticket);
  form.addParagraphTextItem().setTitle(t.notes);

  action.setChoices([
    action.createChoice(t.actionIn, pageIn),
    action.createChoice(t.actionOut, pageOut),
    action.createChoice(t.actionFix, pageFix),
  ]);
  pageOut.setGoToPage(pageWhen); // each section jumps to When; a page break sets the jump for the page before it
  pageFix.setGoToPage(pageWhen);
  return form;
}

function form_() {
  return FormApp.openById(PropertiesService.getScriptProperties().getProperty(FORM_ID_KEY));
}

/** The UTC column is the record. Date, Time and Date&Time are its local display and are only checked. */
function cellsToRow_(cells, columns) {
  const value = (name) => cells[columns.indexOf(name)];
  const { date, time } = parseUtcText(value('UTC'));
  return makeRow({
    date, time, lab: value('Lab'), type: value('Type'), change: Number(value('Change')), notes: value('Notes'),
    holding: value('Holding'), timeBasis: value('TimeBasis'), source: value('Source'), auto: value('Auto') === true,
    ruleNote: value('RuleNote'), id: value('EntryID'), group: value('Group'), corrects: value('Corrects'),
  });
}

function readLedger_() {
  const [columns, ...rows] = tab_('ledger').getDataRange().getValues();
  if (columns.join('|') !== LEDGER_COLUMNS.join('|')) throw new Error('The Ledger columns have changed.');
  return rows.map((cells) => cellsToRow_(cells, columns));
}

/** Local Date, Time and the derived Date&Time formula: the first three cells of every tab. Numbers, so no zone can shift them on the way in. */
function dateCells_(row, rowNumber) {
  const when = row.date && row.time ? dateTime(row) : null;
  if (!when) {
    const serial = row.date ? dateSerial(row.date.getFullYear(), row.date.getMonth() + 1, row.date.getDate()) : '';
    return [serial, '', dateTimeFormula(rowNumber)];
  }
  const [date, time] = Utilities.formatDate(when, localZone_(), 'yyyy-MM-dd HH:mm').split(' ');
  const [year, month, day] = date.split('-').map(Number);
  return [dateSerial(year, month, day), timeFraction(time), dateTimeFormula(rowNumber)];
}

function appendRows_(sheet, rows, stamp, extras) {
  rows.forEach((row) => {
    sheet.appendRow(dateCells_(row, sheet.getLastRow() + 1).concat([
      row.lab, row.type, row.change, row.notes, utcText(row), row.holding, row.timeBasis, row.id, row.group, row.source, row.auto, row.ruleNote, row.corrects,
      stamp.at, stamp.author, extras.defectId || '', extras.ticket || '', extras.reason || '',
    ]));
  });
}

/** A row's time shown in a zone; a date with no time shows only the date. */
function shownIn_(row, zone) {
  if (row.date && row.time) return Utilities.formatDate(dateTime(row), zone, 'yyyy/MM/dd  HH:mm:ss');
  return dateText(row.date);
}

/** Every row in force, in local time and the second zone. Changing a zone rewrites this view; the Ledger is never touched. */
function refreshView_(rows) {
  const sheet = tab_('view').clearContents();
  const local = localZone_();
  const other = otherZone_();
  sheet.appendRow([`Local time (${local})`, `Other time (${other})`].concat(tabs_().view.slice(2)));
  const grid = rows.slice().sort((a, b) => orderMs(a) - orderMs(b)).map((row) => [shownIn_(row, local), shownIn_(row, other), row.lab, row.type, row.change, row.notes, row.holding, utcText(row)]);
  if (grid.length) sheet.getRange(2, 1, grid.length, grid[0].length).setValues(grid);
}

/** Rebuild everything derived from the ledger, and the dropdown labels that show last-known headsets. */
function refreshDerived_(ledger) {
  const current = tab_('current').clearContents();
  current.appendRow(tabs_().current.map((name) => (name === 'Other time' ? `Other time (${otherZone_()})` : name)));
  const rows = effectiveRows(ledger);
  const serials = Array.from(new Set(rows.map((row) => row.change)));
  const latest = serials.map((serial) => rows.filter((row) => row.change === serial && placeOf(row) === currentPlace(rows, serial)).sort((a, b) => orderMs(a) - orderMs(b)).pop());
  latest.sort((a, b) => placeOf(a).localeCompare(placeOf(b), 'en', { numeric: true })).forEach((row) => {
    current.appendRow(dateCells_(row, current.getLastRow() + 1).concat([row.lab, row.type, row.change, row.notes, row.holding, row.timeBasis, utcText(row), shownIn_(row, otherZone_())]));
  });

  refreshView_(rows);

  const flags = tab_('flags').clearContents();
  flags.appendRow(tabs_().flags);
  findViolations(rows).forEach((v) => {
    const when = new Date(v.ms);
    const row = rowAt(when, v.serials[0], v.lab, 'stated', 'flag');
    flags.appendRow(dateCells_(row, flags.getLastRow() + 1).concat([v.lab, HEADSET, v.serials.join(', '), 'More than one headset in this lab']));
  });
  brokenDateTimeRows_().forEach((problem) => flags.appendRow(['', '', '', '', '', problem.id, problem.note]));

  const t = titles();
  const choices = formChoices(ledger, labCount_());
  form_().getItems().forEach((item) => {
    const title = item.getTitle();
    if (title === t.labIn || title === t.labOut) item.asListItem().setChoiceValues(choices.labs);
    if (title === t.serialIn || title === t.serialOut || title === t.serialFix) item.asListItem().setChoiceValues(choices.serials);
  });
}

/** Any Ledger row whose Date&Time cell no longer equals Date + Time, for example an overwritten formula. */
function brokenDateTimeRows_() {
  const [columns, ...cells] = tab_('ledger').getDataRange().getValues();
  const rows = readLedger_();
  const at = columns.indexOf('Date&Time');
  return rows.filter((row, index) => {
    const cell = cells[index][at];
    const derived = dateTime(row);
    if (!derived) return cell !== '';
    return !(cell instanceof Date) || Math.abs(cell.getTime() - derived.getTime()) >= 1000;
  }).map((row) => ({ id: row.id, note: 'Date&Time is not Date + Time' }));
}

/** Run once by hand after pasting the seed CSV into the Seed tab (plain text, so nothing is reinterpreted). */
function seedLedger() {
  requireDomainUser_();
  if (tab_('ledger').getLastRow() > 1) throw new Error('The ledger already has rows; seeding runs once.');
  const [columns, ...table] = tab_('seed').getDataRange().getValues();
  if (columns.join('|') !== SEED_COLUMNS.join('|')) throw new Error('The Seed columns have changed.');
  const rows = rowsFromSeed(table);
  appendRows_(tab_('ledger'), rows, { at: new Date(), author: 'seed' }, {});
  refreshDerived_(rows);
  refreshProgress();
}

function answersOf_(response) {
  const answers = {};
  response.getItemResponses().forEach((itemResponse) => {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  return answers;
}

function entryFromAnswers_(answers, email, group, now) {
  const t = titles();
  const { date, time, timeBasis } = utcFromLocal_(answers[t.date], answers[t.time], now);
  const action = { [t.actionIn]: 'in', [t.actionOut]: 'out', [t.actionFix]: 'fix' }[answers[t.action]];
  const serialChoice = { in: t.serialIn, out: t.serialOut, fix: t.serialFix }[action];
  return {
    action, email, group, date, time, timeBasis, source: 'form',
    lab: labFromChoice(answers[action === 'out' ? t.labOut : t.labIn]),
    serial: serialFromChoice(answers[serialChoice]),
    displacedTo: answers[t.displaced] || '',
    destination: answers[t.destination] || '',
    parts: answers[t.parts] || [],
    defectId: answers[t.defect] || '',
    ticket: answers[t.ticket] || '',
    reason: answers[t.reason] || '',
    notes: answers[t.notes] || '',
  };
}

function hold_(response, email, now, reason, answers, entry) {
  const sheet = tab_('held');
  const known = entry || {};
  sheet.appendRow(dateCells_({ date: known.date, time: known.time }, sheet.getLastRow() + 1).concat([
    known.lab || '', HEADSET, known.serial === undefined || known.serial === null ? '' : known.serial, known.notes || '',
    response.getId(), now, email, reason, JSON.stringify(answers),
  ]));
  if (email) MailApp.sendEmail(email, 'Headset log: entry held', `${reason}\n\nYour entry was kept. Submit it again, or ask the operator to release it.`);
}

/** Installable form-submit trigger. A failure is held, never lost; the raw response also stays in the form. */
function onFormSubmit(e) {
  const response = e.response;
  const email = response.getRespondentEmail();
  const answers = answersOf_(response);
  const now = new Date();
  const lock = LockService.getScriptLock();
  let entry = null;
  try {
    lock.waitLock(LOCK_WAIT_MS);
    const ledger = readLedger_();
    entry = entryFromAnswers_(answers, email, response.getId(), now);
    const decision = decideEntry(entry, ledger, { domain: domain_(), now });
    const stamp = { at: now, author: email };
    if (decision.kind === 'held') {
      hold_(response, email, now, decision.reason, answers, entry);
    } else if (decision.kind === 'maintenance') {
      appendRows_(tab_('maintenance'), [decision.row], stamp, entry);
    } else {
      appendRows_(tab_('ledger'), decision.rows, stamp, entry);
      refreshDerived_(ledger.concat(decision.rows));
      refreshProgress();
    }
  } catch (error) {
    hold_(response, email, now, `Script error: ${error.message}`, answers, entry);
  } finally {
    lock.releaseLock();
  }
}

/** Run by the operator from the editor. Appends correcting rows; the old rows stay in the ledger. */
function applyCorrection(entryId, dateInput, timeInput, author) {
  requireDomainUser_();
  const now = new Date();
  const ledger = readLedger_();
  const { date, time } = utcFromLocal_(dateInput, timeInput, now);
  const rows = correctionRows(ledger, entryId, combineDateTime(date, time), author);
  appendRows_(tab_('ledger'), rows, { at: now, author }, {});
  refreshDerived_(ledger.concat(rows));
}
