/**
 * Headset log rules. DRAFT, not deployed. No Google services in this file, so it runs and is tested in plain Node.
 *
 * A ledger row means "serial arrives at place at time". What each lab holds is derived from the
 * latest arrival of each serial and is never typed. Rows are never edited: a correction is a new
 * row that names the row it replaces. Rules mirror device_inventory_ledger.py.
 *
 * Only UTC is stored. This file runs in a UTC script zone, so a row's date and time are UTC. Local time is converted on the way in and
 * every zone is a display on the way out; that happens in Code.gs and Init.gs.
 */
const HARDWARE_COLUMNS = ['Date', 'Time', 'Date&Time', 'Lab', 'Type', 'Change', 'Notes'];
const ROW_COLUMNS = ['UTC', 'Holding', 'TimeBasis', 'EntryID', 'Group', 'Source', 'Auto', 'RuleNote', 'Corrects'];
const ENTRY_COLUMNS = ['EntryTime', 'Author', 'DefectID', 'Ticket', 'PullOutReason'];
const LEDGER_COLUMNS = HARDWARE_COLUMNS.concat(ROW_COLUMNS, ENTRY_COLUMNS);
const SEED_COLUMNS = HARDWARE_COLUMNS.concat(['Holding', 'TimeBasis', 'Source']);
const DATE_DISPLAY = 'mmmm" "dd", "yyyy';
const TIME_DISPLAY = 'hh":"mm';
const DATE_TIME_DISPLAY = 'yyyy"/"mm"/"dd"  "hh":"mm":"ss';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const LAB_PATTERN = /^Lab \d+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_LAB = 'None';
const HEADSET = 'Headset';
const MAINTENANCE = 'Equipment Maintenance';
const TYPES = [HEADSET, MAINTENANCE];
const HOLDING_PLACES = ['Spare', 'For repair'];
const RETIRED_PLACE = 'Retired';
const AUTO_GAP_MS = 60000;
const NOTE_AUTO_ASSIGN = 'created at removal';
const NOTE_DISPLACED = 'displaced by assignment';

/**
 * A row in the Hardware changes schema. `date` is a Date at local midnight, `time` is "HH:MM" in whole minutes
 * (JavaScript has no time-only type), and Date&Time is never stored: dateTime(row) derives it.
 */
function makeRow(fields) {
  const row = {
    date: fields.date || null,
    time: fields.time || '',
    lab: fields.lab,
    type: fields.type,
    change: fields.change,
    notes: fields.notes || '',
    holding: fields.holding || '',
    timeBasis: fields.timeBasis || 'stated',
    source: fields.source || 'form',
    auto: Boolean(fields.auto),
    ruleNote: fields.ruleNote || '',
    id: fields.id || '',
    group: fields.group || '',
    corrects: fields.corrects || '',
  };
  if (row.date && (!(row.date instanceof Date) || row.date.getHours() || row.date.getMinutes() || row.date.getSeconds())) {
    throw new Error(`Date must be a date, got ${fields.date}`);
  }
  if (row.time && !TIME_PATTERN.test(row.time)) throw new Error(`Time must be HH:MM in whole minutes, got ${row.time}`);
  if (row.time && !row.date) throw new Error('A Time needs a Date.');
  if (row.lab !== NO_LAB && !LAB_PATTERN.test(row.lab || '')) throw new Error(`Lab must look like "Lab 5" or "None", got ${row.lab}`);
  const holds = HOLDING_PLACES.concat([RETIRED_PLACE]).indexOf(row.holding) !== -1;
  if ((row.lab === NO_LAB) !== holds || (row.lab !== NO_LAB && row.holding)) {
    throw new Error(`Lab None needs a Holding place, and a lab has none: ${row.lab}, ${row.holding}`);
  }
  if (TYPES.indexOf(row.type) === -1) throw new Error(`Type must be one of ${TYPES.join(', ')}, got ${row.type}`);
  if (!Number.isInteger(row.change)) throw new Error(`Change must be a serial number, got ${row.change}`);
  return row;
}

/** Date&Time: derived from Date + Time, blank (null) unless both are known. */
function dateTime(row) {
  return row.date && row.time ? combineDateTime(row.date, row.time) : null;
}

function combineDateTime(date, time) {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
}

function placeOf(row) {
  return row.lab === NO_LAB ? row.holding : row.lab;
}

function placeFields(place) {
  return LAB_PATTERN.test(place) ? { lab: place, holding: '' } : { lab: NO_LAB, holding: place };
}

function pad_(n) {
  return String(n).padStart(2, '0');
}

function dateOnly_(when) {
  return new Date(when.getFullYear(), when.getMonth(), when.getDate());
}

function clockOf_(when) {
  return `${pad_(when.getHours())}:${pad_(when.getMinutes())}`;
}

/** A headset row from a combined instant, split into the Date and Time inputs. */
function rowAt(when, serial, place, timeBasis, source, extra) {
  return makeRow({ date: when ? dateOnly_(when) : null, time: when ? clockOf_(when) : '', type: HEADSET, change: serial, timeBasis, source, ...placeFields(place), ...extra });
}

function dateText(date) {
  return date ? `${MONTHS[date.getMonth()]} ${pad_(date.getDate())}, ${date.getFullYear()}` : '';
}

function dateTimeText(when) {
  if (!when) return '';
  const day = `${when.getFullYear()}/${pad_(when.getMonth() + 1)}/${pad_(when.getDate())}`;
  return `${day}  ${pad_(when.getHours())}:${pad_(when.getMinutes())}:${pad_(when.getSeconds())}`;
}

/** The one stored time. A date with no time stays a plain date; unknown stays blank. */
function utcText(row) {
  const when = dateTime(row);
  if (when) return `${isoDate(row.date)}T${row.time}:00Z`;
  return row.date ? isoDate(row.date) : '';
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad_(date.getMonth() + 1)}-${pad_(date.getDate())}`;
}

function parseUtcText(text) {
  const value = String(text || '').trim();
  if (!value) return { date: null, time: '' };
  const instant = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}):00Z$/);
  if (instant) return { date: new Date(Number(instant[1]), Number(instant[2]) - 1, Number(instant[3])), time: instant[4] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: parseDateText(value), time: '' };
  throw new Error(`UTC is not in a standard form: ${value}`);
}

/** The day number a sheet stores for a date (days since the sheet epoch). */
function dateSerial(year, month, day) {
  return Date.UTC(year, month - 1, day) / 86400000 + 25569;
}

/** The sheet's =SUM(A:B), blank unless both inputs exist so a missing Time never becomes midnight. */
function dateTimeFormula(rowNumber) {
  return `=IF(COUNT(A${rowNumber}:B${rowNumber})=2,SUM(A${rowNumber}:B${rowNumber}),"")`;
}

/** A sheet time cell is a fraction of a day, as in Hardware changes. */
function timeFraction(time) {
  const [hour, minute] = time.split(':').map(Number);
  return (hour * 60 + minute) / 1440;
}

/** The seven Hardware changes columns exactly as the sheet displays them. */
function hardwareText(row) {
  return [dateText(row.date), row.time, dateTimeText(dateTime(row)), row.lab, row.type, String(row.change), row.notes];
}

/** Every column a row holds, in ledger order. Parity compares this with Python. */
function rowText(row) {
  return hardwareText(row).concat([row.holding, row.timeBasis, row.id, row.group, row.source, row.auto, row.ruleNote, row.corrects]);
}

function parseDateText(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const long = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (long && MONTHS.indexOf(long[1]) !== -1) return new Date(Number(long[3]), MONTHS.indexOf(long[1]), Number(long[2]));
  throw new Error(`Date is not in a standard form: ${value}`);
}

function parseTimeText(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Time is not in a standard form: ${value}`);
  return `${pad_(Number(match[1]))}:${match[2]}`;
}

/** Rows still in force: anything named by a later row's `corrects` is superseded. */
function effectiveRows(ledger) {
  const replaced = new Set(ledger.map((row) => row.corrects).filter(Boolean));
  return ledger.filter((row) => !replaced.has(row.id));
}

/** Sort position: a blank date orders first; a blank time orders at the start of its date. */
function orderMs(row) {
  return row.date ? combineDateTime(row.date, row.time || '00:00').getTime() : -Infinity;
}

/** Latest arrival per serial at or before atMs: Map(serial -> {place, ms, index}). */
function stateAt_(ledger, atMs) {
  const state = new Map();
  effectiveRows(ledger).forEach((row, index) => {
    const ms = orderMs(row);
    if (ms > atMs) return;
    const held = state.get(row.change);
    if (!held || ms > held.ms || (ms === held.ms && index > held.index)) {
      state.set(row.change, { place: placeOf(row), ms, index });
    }
  });
  return state;
}

function msOf_(when) {
  return when ? when.getTime() : Infinity;
}

function currentPlace(ledger, serial, at) {
  const held = stateAt_(ledger, msOf_(at)).get(serial);
  return held ? held.place : null;
}

/** The last-known serial in a lab; a lab always displays this. */
function labDisplay(ledger, lab, at) {
  let best = null;
  stateAt_(ledger, msOf_(at)).forEach((held, serial) => {
    if (held.place !== lab) return;
    if (!best || held.ms > best.ms || (held.ms === best.ms && held.index > best.index)) {
      best = { ms: held.ms, index: held.index, serial };
    }
  });
  return best ? best.serial : null;
}

/** Instants at which a lab holds more than one serial, checked after all rows of that instant. */
function findViolations(ledger) {
  const rows = effectiveRows(ledger);
  const instants = Array.from(new Set(rows.filter((r) => r.date).map(orderMs))).sort((a, b) => a - b);
  const found = [];
  (instants.length ? instants : [Infinity]).forEach((ms) => {
    const byLab = new Map();
    stateAt_(rows, ms).forEach((held, serial) => {
      if (!LAB_PATTERN.test(held.place)) return;
      byLab.set(held.place, (byLab.get(held.place) || []).concat([serial]));
    });
    byLab.forEach((serials, lab) => {
      if (serials.length > 1) found.push({ ms, lab, serials: serials.slice().sort((a, b) => a - b) });
    });
  });
  return found;
}

function requireLab_(lab) {
  if (!LAB_PATTERN.test(lab || '')) throw new Error(`Choose a lab, such as Lab 5. Got "${lab}".`);
}

function requireHolding_(place) {
  if (HOLDING_PLACES.indexOf(place) === -1) throw new Error('The headset needs a destination: Spare or For repair.');
}

function requireDestination_(place) {
  if (place !== RETIRED_PLACE) requireHolding_(place);
}

/** Put a serial into a lab. An occupied lab makes a swap: two rows at the same time. */
function intoLab(args) {
  const { ledger, serial, lab, when, timeBasis, group, source } = args;
  const displacedTo = args.displacedTo || HOLDING_PLACES[0];
  requireLab_(lab);
  requireHolding_(displacedTo);
  if (currentPlace(ledger, serial, when) === RETIRED_PLACE) {
    throw new Error(`Headset ${serial} is retired and cannot go into a lab.`);
  }
  const rows = [rowAt(when, serial, lab, timeBasis, source, { id: `${group}-0`, group })];
  const occupant = labDisplay(ledger, lab, when);
  if (occupant !== null && occupant !== serial) {
    rows.push(rowAt(when, occupant, displacedTo, timeBasis, source, { id: `${group}-1`, group, auto: true, ruleNote: NOTE_DISPLACED }));
  }
  return rows;
}

/**
 * Take a serial out of a lab. If the ledger does not show it there, also create the missing assignment
 * one minute earlier, and give any displaced last-known serial its own row. That three-row case is the
 * operator's one exception to the 1 to 2 row limit (ruling of 2026-10-31).
 */
function outOfLab(args) {
  const { ledger, serial, lab, destination, when, timeBasis, group, source, assignmentTime } = args;
  requireLab_(lab);
  requireDestination_(destination);
  const removal = (index) => rowAt(when, serial, destination, timeBasis, source, { id: `${group}-${index}`, group });
  const place = currentPlace(ledger, serial, when);
  if (place === lab) return [removal(0)];
  if (place === RETIRED_PLACE) throw new Error(`Headset ${serial} is retired.`);
  const assignedAt = assignmentTime || new Date(when.getTime() - AUTO_GAP_MS);
  if (assignedAt.getTime() > when.getTime() - AUTO_GAP_MS) {
    throw new Error('The assignment must be at least 1 minute earlier than the removal.');
  }
  const assignBasis = assignmentTime ? 'stated' : timeBasis;
  const rows = [rowAt(assignedAt, serial, lab, assignBasis, source, { id: `${group}-0`, group, auto: true, ruleNote: NOTE_AUTO_ASSIGN })];
  const occupant = labDisplay(ledger, lab, assignedAt);
  if (occupant !== null && occupant !== serial) {
    rows.push(rowAt(assignedAt, occupant, HOLDING_PLACES[0], assignBasis, source, { id: `${group}-${rows.length}`, group, auto: true, ruleNote: NOTE_DISPLACED }));
  }
  return rows.concat([removal(rows.length)]);
}

/** Put a new serial on the roster. A site with no source workbook starts this way; the form then moves it into a lab. */
function addHeadsetRows(args) {
  const { ledger, serial, place, when, timeBasis, group } = args;
  requireHolding_(place);
  if (ledger.some((row) => row.change === serial)) throw new Error(`Headset ${serial} is already on the roster.`);
  return [rowAt(when, serial, place, timeBasis, 'admin', { id: `${group}-0`, group })];
}

/** Blank date and time mean now, labelled "defaulted"; a stated date with no time keeps the date. */
function resolveWhen(dateInput, timeInput, now) {
  const date = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const time = String(timeInput || '').match(/^(\d{1,2}):(\d{2})/);
  if (!date && !time) return { date: dateOnly_(now), time: clockOf_(now), timeBasis: 'defaulted' };
  return {
    date: date ? new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])) : dateOnly_(now),
    time: time ? `${pad_(Number(time[1]))}:${time[2]}` : clockOf_(now),
    timeBasis: time ? 'stated' : 'defaulted',
  };
}

function labFromChoice(choice) {
  const match = String(choice || '').match(/^Lab \d+/);
  return match ? match[0] : '';
}

function serialFromChoice(choice) {
  const match = String(choice || '').match(/^\d+/);
  return match ? Number(match[0]) : null;
}

/** Dropdown labels: each lab shows its last-known headset, and retired serials are hidden. */
function formChoices(ledger, labCount) {
  const labs = [];
  for (let n = 1; n <= labCount; n += 1) {
    const serial = labDisplay(ledger, `Lab ${n}`);
    labs.push(`Lab ${n} (${serial === null ? 'empty' : serial})`);
  }
  const state = stateAt_(ledger, Infinity);
  const serials = Array.from(state.keys()).sort((a, b) => a - b)
    .filter((serial) => state.get(serial).place !== RETIRED_PLACE)
    .map((serial) => `${serial} (${state.get(serial).place})`);
  return { labs, serials };
}

/** Turn one form entry into rows, a maintenance row, or a held entry with a reason. Nothing is dropped. */
function decideEntry(entry, ledger, options) {
  const held = (reason) => ({ kind: 'held', reason });
  const domain = `@${options.domain}`.toLowerCase();
  if (!String(entry.email || '').toLowerCase().endsWith(domain)) {
    return held(`Sign in with a ${options.domain} account first.`);
  }
  const when = combineDateTime(entry.date, entry.time);
  if (when.getTime() > options.now.getTime()) return held('The date and time are in the future.');
  const known = new Set(ledger.map((row) => row.change));
  const lab = entry.lab || '';
  const serial = entry.action === 'out' && entry.serial === null ? labDisplay(ledger, lab, when) : entry.serial;
  if (serial === null) return held(`${lab} shows no headset. Choose the headset that came out.`);
  if (!known.has(serial)) return held(`Headset ${serial} is not on the roster.`);
  const { group, source, timeBasis } = entry;
  if (entry.action === 'fix') {
    const notes = [(entry.parts || []).join(', '), entry.notes || ''].filter(Boolean).join('; ');
    const place = currentPlace(ledger, serial, when) || RETIRED_PLACE;
    return { kind: 'maintenance', row: makeRow({ date: entry.date, time: entry.time, type: MAINTENANCE, change: serial, notes, timeBasis, source, id: `${group}-0`, group, ...placeFields(place) }) };
  }
  const shared = { ledger, serial, lab, when, timeBasis, group, source };
  try {
    const rows = entry.action === 'in'
      ? intoLab({ ...shared, displacedTo: entry.displacedTo })
      : outOfLab({ ...shared, destination: entry.destination });
    return { kind: 'rows', rows };
  } catch (error) {
    return held(error.message);
  }
}

/**
 * Correct an event time with new rows; the old rows stay. Moving an auto assignment also moves the row
 * that closed the displaced headset, and the assignment stays at least a minute before the removal.
 */
function correctionRows(ledger, entryId, newWhen, author) {
  const rows = effectiveRows(ledger);
  const target = rows.find((row) => row.id === entryId);
  if (!target) throw new Error(`Entry ${entryId} is not in force.`);
  const redo = (row) => makeRow({ ...row, id: `${row.id}-c`, date: dateOnly_(newWhen), time: clockOf_(newWhen), timeBasis: 'stated', corrects: row.id, source: `correction by ${author}` });
  if (target.ruleNote !== NOTE_AUTO_ASSIGN) return [redo(target)];
  const family = rows.filter((row) => row.group === target.group);
  const removal = family.find((row) => !row.auto);
  if (removal && dateTime(removal) && newWhen.getTime() > dateTime(removal).getTime() - AUTO_GAP_MS) {
    throw new Error('The assignment must be at least 1 minute earlier than the removal.');
  }
  return family.filter((row) => row.auto).map(redo);
}

/** Seed rows in SEED_COLUMNS, as the sheet displays them. A stated Date&Time must equal Date + Time. */
function rowsFromSeed(table) {
  return table.map(([date, time, combined, lab, type, change, notes, holding, timeBasis, source]) => {
    const row = makeRow({ date: parseDateText(date), time: parseTimeText(time), lab, type, change: Number(change), notes, holding, timeBasis, source, id: `tip-${change}`, group: 'tip' });
    if ((combined || '') !== dateTimeText(dateTime(row))) throw new Error(`Date&Time ${combined} is not Date + Time for ${change}.`);
    return row;
  });
}
