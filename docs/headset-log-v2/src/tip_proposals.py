"""Tip proposals and setup progress (PROVISIONAL, private reference implementation).

Reads rows shaped like the Hardware changes sheet plus a weekly legend, proposes the latest tip for every lab, and lists every
disagreement for the operator. Nothing is guessed: an undecided disagreement blocks seeding, a held item stays out of the ledger, and
a serial that would end up in two places is refused. The result is a seed table in SEED_COLUMNS, which rows_from_seed validates.

device-inventory-apps-script-draft/Tips.gs is the JavaScript translation of this file. Change both together; SYNC.md has the name map.
"""
import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import device_inventory_ledger as dil

AGREE = "agree"
DECIDE = "decision needed"
EMPTY = "empty"
USE_WORKBOOK = "Use workbook"
USE_LEGEND = "Use legend"
HOLD = "Hold"
UNPLACED_OPTIONS = ("Spare", "For repair", dil.RETIRED, HOLD)
NO_DATE_NOTE = "No dated workbook row for this assignment; the legend shows it."
RETIRED_NOTE = "Retired by operator decision."

SETUP_STEPS = (
    "Tabs created",
    "Form built",
    "Submit trigger installed",
    "Signed in on the organization domain",
    "Source workbook set",
    "Tips proposed",
    "Every decision made",
    "Ledger seeded",
    "Derived views and flags clean",
)


@dataclass(frozen=True)
class WorkbookRow:
    number: int
    date: dt.date | None
    time: dt.time | None
    lab: str
    type: str
    change: int
    notes: str = ""


@dataclass(frozen=True)
class Legend:
    labs: Mapping[str, object]  # "Lab 5" -> serial, or blank, or text such as "7002 = 7001"
    holding: Mapping[int, str]  # serial -> "Spare" or "For repair"


@dataclass(frozen=True)
class Proposal:
    key: str  # "Lab 5" or "serial 7002"
    place: str
    workbook: int | None
    workbook_row: int | None
    legend: int | None
    legend_text: str
    status: str
    reason: str
    options: tuple[str, ...]


@dataclass(frozen=True)
class TipResult:
    seed_table: tuple[list[str], ...]
    unresolved: tuple[tuple[str, str], ...]
    extra: tuple[Proposal, ...]
    held: tuple[str, ...]


def _order(row: WorkbookRow) -> tuple[dt.datetime, int]:
    """Blank time orders at the start of its date; ties go to the later sheet row."""
    return dt.datetime.combine(row.date, row.time or dt.time.min), row.number  # type: ignore[arg-type]


def _latest(rows: Sequence[WorkbookRow]) -> tuple[dict[str, WorkbookRow], dict[int, WorkbookRow]]:
    by_lab: dict[str, WorkbookRow] = {}
    by_serial: dict[int, WorkbookRow] = {}
    for row in sorted((r for r in rows if r.type == dil.HEADSET and r.date), key=_order):
        by_lab[row.lab] = row
        by_serial[row.change] = row
    return by_lab, by_serial


def _serial(raw: object) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)) and raw == int(raw):
        return int(raw)
    return int(raw) if isinstance(raw, str) and raw.strip().isdigit() else None


def _blank(raw: object) -> bool:
    return raw is None or str(raw).strip() == ""


def propose_tips(rows: Sequence[WorkbookRow], legend: Legend, lab_count: int) -> tuple[Proposal, ...]:
    by_lab, by_serial = _latest(rows)
    proposals: list[Proposal] = []
    covered: set[int] = set()
    lab_serials = {s for s in (_serial(v) for v in legend.labs.values()) if s is not None}
    for number in range(1, lab_count + 1):
        lab = f"Lab {number}"
        row, raw = by_lab.get(lab), legend.labs.get(lab)
        text = "" if _blank(raw) else str(raw)
        leg = _serial(raw)
        wb = row.change if row else None
        covered |= {s for s in (wb, leg) if s is not None}
        if row is None and not text:
            status, reason, options = EMPTY, "no workbook row and the legend shows nothing", ()
        elif text and leg is None:
            status, reason = DECIDE, f"legend cell is not a single serial: {text}"
            options = (USE_WORKBOOK, HOLD) if row else (HOLD,)
        elif row and leg == wb and by_serial[row.change].lab != lab:
            status, reason, options = DECIDE, f"workbook row {row.number} puts {wb} here, but a later workbook row moves it to {by_serial[row.change].lab}", (USE_WORKBOOK, USE_LEGEND, HOLD)
        elif row and leg == wb:
            status, reason, options = AGREE, "workbook and legend agree", ()
        else:
            status = DECIDE
            reason = f"workbook says {wb if row else 'nothing'}{f' (row {row.number})' if row else ''}; legend says {leg if leg is not None else 'nothing'}"
            options = tuple(o for o, ok in ((USE_WORKBOOK, row is not None), (USE_LEGEND, leg is not None), (HOLD, True)) if ok)
        proposals.append(Proposal(lab, lab, wb, row.number if row else None, leg, text, status, reason, options))
    for serial, kind in sorted(legend.holding.items()):
        covered.add(serial)
        row = by_serial.get(serial)
        if serial in lab_serials:
            status, reason, options = DECIDE, f"legend lists {serial} in a lab and as {kind}", (USE_LEGEND, HOLD)
        elif row and row.lab != dil.NO_LAB:
            status, reason, options = DECIDE, f"workbook's latest row puts it in {row.lab}; legend lists it as {kind}", (USE_LEGEND, HOLD)
        else:
            status, reason, options = AGREE, "workbook and legend agree", ()
        proposals.append(Proposal(f"serial {serial}", kind, serial if row else None, row.number if row else None, serial, "", status, reason, options))
    for serial in sorted(set(by_serial) - covered):
        row = by_serial[serial]
        proposals.append(Proposal(f"serial {serial}", "", serial, row.number, None, "", DECIDE, "no lab or holding place in the workbook tips or the legend", UNPLACED_OPTIONS))
    return tuple(proposals)


def _stamp(row: WorkbookRow | None) -> tuple[dt.date | None, dt.time | None]:
    return (row.date, row.time) if row else (None, None)


def _seed_row(row: WorkbookRow | None, serial: int, lab: str, holding: str, notes: str, source: str) -> list[str]:
    day, clock = _stamp(row)
    combined = dt.datetime.combine(day, clock) if day and clock is not None else None
    basis = "stated" if combined else "unknown"
    return [dil.date_text(day), dil.time_text(clock), dil.date_time_text(combined), lab, dil.HEADSET, str(serial), notes, holding, basis, source]


def _latest_row(rows: Sequence[WorkbookRow], serial: int, lab: str) -> WorkbookRow | None:
    found = [r for r in rows if r.type == dil.HEADSET and r.date and r.change == serial and r.lab == lab]
    return max(found, key=_order) if found else None


def resolve_tips(proposals: Sequence[Proposal], decisions: Mapping[str, str], rows: Sequence[WorkbookRow]) -> TipResult:
    """Apply the operator's decisions. Returns the seed table only when nothing is unresolved."""
    placed: dict[int, list[str]] = {}
    seed: list[tuple[int, list[str]]] = []
    unresolved: list[tuple[str, str]] = []
    held: list[str] = []
    extra: list[Proposal] = []
    known = {p.key for p in proposals}

    def place(serial: int, where: str, table_row: list[str]) -> None:
        placed.setdefault(serial, []).append(where)
        seed.append((serial, table_row))

    for p in proposals:
        choice = decisions.get(p.key)
        if choice == HOLD:
            held.append(p.key)
            continue
        if p.status == EMPTY:
            continue
        if p.status == DECIDE and choice not in p.options:
            unresolved.append((p.key, p.reason if not choice else f"{choice!r} is not one of the offered options"))
            continue
        if p.key.startswith("Lab "):
            serial = p.legend if choice == USE_LEGEND else p.workbook
            assert serial is not None
            row = _latest_row(rows, serial, p.key)
            note = "" if row else NO_DATE_NOTE
            place(serial, p.key, _seed_row(row, serial, p.key, "", note, f"workbook r{row.number}" if row else "legend"))
        elif p.status == DECIDE and choice in UNPLACED_OPTIONS or p.place == "":
            serial = int(p.key.split()[1])
            row = _latest_row(rows, serial, dil.NO_LAB)
            place(serial, str(choice), _seed_row(row, serial, dil.NO_LAB, str(choice), RETIRED_NOTE if choice == dil.RETIRED else "", f"workbook r{row.number}" if row else "operator decision"))
        else:
            serial = int(p.key.split()[1])
            row = _latest_row(rows, serial, dil.NO_LAB)
            place(serial, p.place, _seed_row(row, serial, dil.NO_LAB, p.place, "", f"workbook r{row.number}" if row else "legend"))
    universe = {r.change for r in rows if r.type == dil.HEADSET and r.date} | set(placed)
    held_serials = {int(k.split()[1]) for k in held if k.startswith("serial ")}
    # Serials left without a place are asked about only once every lab and legend question is settled.
    for serial in sorted(universe - set(placed) - held_serials if not unresolved else ()):
        key = f"serial {serial}"
        choice = decisions.get(key)
        if choice == HOLD:
            held.append(key)
        elif choice in UNPLACED_OPTIONS:
            row = _latest_row(rows, serial, dil.NO_LAB)
            place(serial, str(choice), _seed_row(row, serial, dil.NO_LAB, str(choice), RETIRED_NOTE if choice == dil.RETIRED else "", f"workbook r{row.number}" if row else "operator decision"))
        else:
            reason = "no lab or holding place after your decisions"
            extra_proposal = Proposal(key, "", serial, None, None, "", DECIDE, reason, UNPLACED_OPTIONS)
            if key not in known:
                extra.append(extra_proposal)
            if not any(k == key for k, _ in unresolved):
                unresolved.append((key, reason))
    for serial, where in sorted(placed.items()):
        if len(where) > 1:
            unresolved.append((f"serial {serial}", f"{serial} would be in two places: {', '.join(where)}"))
    if unresolved:
        return TipResult((), tuple(unresolved), tuple(extra), tuple(held))
    ordered = [row for _, row in sorted(seed, key=lambda item: (not item[1][3].startswith("Lab "), int(item[1][3].split()[1]) if item[1][3].startswith("Lab ") else 0, item[0]))]
    return TipResult(tuple(ordered), (), tuple(extra), tuple(held))


def setup_progress(facts: Mapping[str, bool]) -> list[tuple[str, str]]:
    """Each step is done, next (the first gap) or waiting. A later done step never hides an earlier gap."""
    unknown = set(facts) - set(SETUP_STEPS)
    if unknown:
        raise ValueError(f"Unknown setup steps: {sorted(unknown)}")
    steps, seen_gap = [], False
    for name in SETUP_STEPS:
        if facts.get(name):
            steps.append((name, "done"))
        else:
            steps.append((name, "waiting" if seen_gap else "next"))
            seen_gap = True
    return steps


def progress_fraction(steps: Sequence[tuple[str, str]]) -> tuple[int, int]:
    return sum(1 for _, status in steps if status == "done"), len(steps)
