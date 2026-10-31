/**
 * Tip proposals and setup progress. DRAFT, not deployed. No Google services in this file, so it runs and is tested in plain Node.
 * JavaScript translation of tip_proposals.py; change both together (SYNC.md has the name map).
 *
 * Workbook rows are {number, date (Date at local midnight or null), time ("HH:MM" or ""), lab, type, change, notes}.
 * The legend is {labs: {"Lab 5": serial | "" | text}, holding: {"<serial>": "Spare"}}.
 */
const AGREE = 'agree';
const DECIDE = 'decision needed';
const EMPTY = 'empty';
const USE_WORKBOOK = 'Use workbook';
const USE_LEGEND = 'Use legend';
const HOLD = 'Hold';
const UNPLACED_OPTIONS = ['Spare', 'For repair', 'Retired', HOLD]; // literals: no top-level reference to another file
const NO_DATE_NOTE = 'No dated workbook row for this assignment; the legend shows it.';
const RETIRED_NOTE = 'Retired by operator decision.';
const SETUP_STEPS = [
  'Tabs created',
  'Form built',
  'Submit trigger installed',
  'Signed in on the organization domain',
  'Source workbook set',
  'Tips proposed',
  'Every decision made',
  'Ledger seeded',
  'Derived views and flags clean',
];

function tipOrder_(row) {
  return combineDateTime(row.date, row.time || '00:00').getTime() * 1e6 + row.number; // blank time orders at the start of its date; ties go to the later sheet row
}

function latestRows_(rows) {
  const byLab = {};
  const bySerial = {};
  rows.filter((r) => r.type === HEADSET && r.date).sort((a, b) => tipOrder_(a) - tipOrder_(b)).forEach((row) => {
    byLab[row.lab] = row;
    bySerial[row.change] = row;
  });
  return { byLab, bySerial };
}

function serialOf_(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  return typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

function isBlank_(raw) {
  return raw === null || raw === undefined || String(raw).trim() === '';
}

function makeProposal_(key, place, workbook, workbookRow, legend, legendText, status, reason, options) {
  return { key, place, workbook, workbookRow, legend, legendText, status, reason, options };
}

function proposeTips(rows, legend, labCount) {
  const { byLab, bySerial } = latestRows_(rows);
  const proposals = [];
  const covered = new Set();
  const labSerials = new Set(Object.values(legend.labs).map(serialOf_).filter((s) => s !== null));
  for (let n = 1; n <= labCount; n += 1) {
    const lab = `Lab ${n}`;
    const arrival = byLab[lab] || null;
    const left = arrival && bySerial[arrival.change].lab !== lab ? bySerial[arrival.change] : null; // its latest row is elsewhere
    const row = left ? null : arrival;
    const moved = left ? `workbook row ${left.number} moves ${left.change} from here to ${left.lab}` : '';
    const raw = legend.labs[lab];
    const text = isBlank_(raw) ? '' : String(raw);
    const leg = serialOf_(raw);
    const wb = row ? row.change : null;
    [wb, leg].filter((s) => s !== null).forEach((s) => covered.add(s));
    let status;
    let reason;
    let options;
    if (!row && !text) {
      [status, reason, options] = [EMPTY, moved || 'no workbook row and the legend shows nothing', []];
    } else if (text && leg === null) {
      [status, reason] = [DECIDE, `legend cell is not a single serial: ${text}`];
      options = row || left ? [USE_WORKBOOK, HOLD] : [HOLD];
    } else if (row && leg === wb) {
      [status, reason, options] = [AGREE, 'workbook and legend agree', []];
    } else {
      status = DECIDE;
      const workbookSays = moved || `workbook says ${row ? wb : 'nothing'}${row ? ` (row ${row.number})` : ''}`;
      reason = `${workbookSays}; legend says ${leg !== null ? leg : 'nothing'}`;
      options = [[USE_WORKBOOK, row !== null || left !== null], [USE_LEGEND, leg !== null], [HOLD, true]].filter(([, ok]) => ok).map(([o]) => o);
    }
    const shown = row || left;
    proposals.push(makeProposal_(lab, lab, wb, shown ? shown.number : null, leg, text, status, reason, options));
  }
  Object.keys(legend.holding).map(Number).sort((a, b) => a - b).forEach((serial) => {
    const kind = legend.holding[String(serial)];
    covered.add(serial);
    const row = bySerial[serial] || null;
    let status;
    let reason;
    let options;
    if (labSerials.has(serial)) {
      [status, reason, options] = [DECIDE, `legend lists ${serial} in a lab and as ${kind}`, [USE_LEGEND, HOLD]];
    } else if (row && row.lab !== NO_LAB) {
      [status, reason, options] = [DECIDE, `workbook's latest row puts it in ${row.lab}; legend lists it as ${kind}`, [USE_LEGEND, HOLD]];
    } else {
      [status, reason, options] = [AGREE, 'workbook and legend agree', []];
    }
    proposals.push(makeProposal_(`serial ${serial}`, kind, row ? serial : null, row ? row.number : null, serial, '', status, reason, options));
  });
  Object.keys(bySerial).map(Number).filter((s) => !covered.has(s)).sort((a, b) => a - b).forEach((serial) => {
    proposals.push(makeProposal_(`serial ${serial}`, '', serial, bySerial[serial].number, null, '', DECIDE, 'no lab or holding place in the workbook tips or the legend', UNPLACED_OPTIONS.slice()));
  });
  return proposals;
}

function seedRow_(row, serial, lab, holding, notes, source) {
  const stamped = row && row.date && row.time;
  const combined = stamped ? combineDateTime(row.date, row.time) : null;
  return [row ? dateText(row.date) : '', row ? row.time : '', dateTimeText(combined), lab, HEADSET, String(serial), notes, holding, combined ? 'stated' : 'unknown', source];
}

function latestRowFor_(rows, serial, lab) {
  const found = rows.filter((r) => r.type === HEADSET && r.date && r.change === serial && r.lab === lab);
  return found.length ? found.reduce((a, b) => (tipOrder_(b) > tipOrder_(a) ? b : a)) : null;
}

function resolveTips(proposals, decisions, rows) {
  const placed = new Map();
  const seed = [];
  const unresolved = [];
  const held = [];
  const extra = [];
  const known = new Set(proposals.map((p) => p.key));
  const place = (serial, where, tableRow) => {
    placed.set(serial, (placed.get(serial) || []).concat([where]));
    seed.push([serial, tableRow]);
  };
  const sourceOf = (row, fallback) => (row ? `workbook r${row.number}` : fallback);
  proposals.forEach((p) => {
    const choice = decisions[p.key];
    if (choice === HOLD) { held.push(p.key); return; }
    if (p.status === EMPTY) return;
    if (p.status === DECIDE && p.options.indexOf(choice) === -1) {
      unresolved.push([p.key, choice ? `'${choice}' is not one of the offered options` : p.reason]);
      return;
    }
    if (p.key.startsWith('Lab ')) {
      const serial = choice === USE_LEGEND ? p.legend : p.workbook;
      if (serial === null) return; // Use workbook on a headset that left: the lab stays empty and the serial is placed from its own latest row
      const row = latestRowFor_(rows, serial, p.key);
      place(serial, p.key, seedRow_(row, serial, p.key, '', row ? '' : NO_DATE_NOTE, sourceOf(row, 'legend')));
    } else if ((p.status === DECIDE && UNPLACED_OPTIONS.indexOf(choice) !== -1) || p.place === '') {
      const serial = Number(p.key.split(' ')[1]);
      const row = latestRowFor_(rows, serial, NO_LAB);
      place(serial, String(choice), seedRow_(row, serial, NO_LAB, String(choice), choice === RETIRED_PLACE ? RETIRED_NOTE : '', sourceOf(row, 'operator decision')));
    } else {
      const serial = Number(p.key.split(' ')[1]);
      const row = latestRowFor_(rows, serial, NO_LAB);
      place(serial, p.place, seedRow_(row, serial, NO_LAB, p.place, '', sourceOf(row, 'legend')));
    }
  });
  const universe = new Set(rows.filter((r) => r.type === HEADSET && r.date).map((r) => r.change));
  placed.forEach((_, serial) => universe.add(serial));
  const heldSerials = new Set(held.filter((k) => k.startsWith('serial ')).map((k) => Number(k.split(' ')[1])));
  // Serials left without a place are asked about only once every lab and legend question is settled.
  const remainder = unresolved.length ? [] : Array.from(universe).filter((s) => !placed.has(s) && !heldSerials.has(s)).sort((a, b) => a - b);
  remainder.forEach((serial) => {
    const key = `serial ${serial}`;
    const choice = decisions[key];
    if (choice === HOLD) {
      held.push(key);
    } else if (UNPLACED_OPTIONS.indexOf(choice) !== -1) {
      const row = latestRowFor_(rows, serial, NO_LAB);
      place(serial, String(choice), seedRow_(row, serial, NO_LAB, String(choice), choice === RETIRED_PLACE ? RETIRED_NOTE : '', sourceOf(row, 'operator decision')));
    } else {
      const reason = 'no lab or holding place after your decisions';
      if (!known.has(key)) extra.push(makeProposal_(key, '', serial, null, null, '', DECIDE, reason, UNPLACED_OPTIONS.slice()));
      if (!unresolved.some(([k]) => k === key)) unresolved.push([key, reason]);
    }
  });
  Array.from(placed.entries()).sort((a, b) => a[0] - b[0]).forEach(([serial, where]) => {
    if (where.length > 1) unresolved.push([`serial ${serial}`, `${serial} would be in two places: ${where.join(', ')}`]);
  });
  if (unresolved.length) return { seedTable: [], unresolved, extra, held };
  const labNumber = (r) => (r[3].startsWith('Lab ') ? Number(r[3].split(' ')[1]) : 0);
  const ordered = seed.slice().sort((a, b) => {
    const [aLab, bLab] = [a[1][3].startsWith('Lab '), b[1][3].startsWith('Lab ')];
    return (aLab === bLab ? 0 : aLab ? -1 : 1) || labNumber(a[1]) - labNumber(b[1]) || a[0] - b[0];
  }).map(([, r]) => r);
  return { seedTable: ordered, unresolved: [], extra, held };
}

/** Each step is done, next (the first gap) or waiting. A later done step never hides an earlier gap. */
function setupProgress(facts) {
  const unknown = Object.keys(facts).filter((name) => SETUP_STEPS.indexOf(name) === -1);
  if (unknown.length) throw new Error(`Unknown setup steps: ${unknown.sort().join(', ')}`);
  let seenGap = false;
  return SETUP_STEPS.map((name) => {
    if (facts[name]) return [name, 'done'];
    const status = seenGap ? 'waiting' : 'next';
    seenGap = true;
    return [name, status];
  });
}

function progressFraction(steps) {
  return [steps.filter(([, status]) => status === 'done').length, steps.length];
}
