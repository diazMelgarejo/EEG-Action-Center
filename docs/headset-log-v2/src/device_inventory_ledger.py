"""Device inventory ledger rules (PROVISIONAL, private reference implementation).

The schema is the Hardware changes sheet: Date, Time, Date&Time, Lab, Type, Change, Notes. Date and Time are the
inputs; Date&Time is always derived from them and is never stored, so it cannot disagree. System columns come
after those seven. Only UTC is stored: a Row's date and time are UTC, local time is converted on the way in, and every
zone is a display on the way out. A date with no known time has no instant and stays a plain date. A row means "serial arrives at place at time"; Lab is "Lab N" or "None", and Holding says
Spare, For repair or Retired where None cannot. Lab occupancy is derived, never typed. Rows are never edited:
a correction is a new row that names the row it replaces.

The rules mirror the operator's answers of 2026-10-31; see the design doc, sections 11 to 17.
device-inventory-apps-script-draft/Rules.gs is the JavaScript translation of this file. Change both
together; SYNC.md in that folder has the name map and the parity check.
"""
import datetime as dt
import re
from dataclasses import dataclass, replace
from zoneinfo import ZoneInfo

HARDWARE_COLUMNS = ("Date", "Time", "Date&Time", "Lab", "Type", "Change", "Notes")
ROW_COLUMNS = ("UTC", "Holding", "TimeBasis", "EntryID", "Group", "Source", "Auto", "RuleNote", "Corrects")
ENTRY_COLUMNS = ("EntryTime", "Author", "DefectID", "Ticket", "PullOutReason")
LEDGER_COLUMNS = HARDWARE_COLUMNS + ROW_COLUMNS + ENTRY_COLUMNS
SEED_COLUMNS = HARDWARE_COLUMNS + ("Holding", "TimeBasis", "Source")
DATE_DISPLAY = 'mmmm" "dd", "yyyy'
TIME_DISPLAY = 'hh":"mm'
DATE_TIME_DISPLAY = 'yyyy"/"mm"/"dd"  "hh":"mm":"ss'

LAB_PATTERN = re.compile(r"Lab \d+")
NO_LAB = "None"
HEADSET = "Headset"
MAINTENANCE = "Equipment Maintenance"
TYPES = (HEADSET, MAINTENANCE)
HOLDING_PLACES = ("Spare", "For repair")
RETIRED = "Retired"  # terminal: never assigned again; only an explicit pullout can send a serial here
AUTO_GAP = dt.timedelta(minutes=1)
NOTE_AUTO_ASSIGN = "created at removal"
NOTE_DISPLACED = "displaced by assignment"
SHEET_EPOCH = dt.date(1899, 12, 30)
DEFAULT_OTHER_ZONE = "UTC"


@dataclass(frozen=True)
class Row:
    date: dt.date | None
    time: dt.time | None
    lab: str
    type: str
    change: int
    notes: str = ""
    holding: str = ""
    time_basis: str = "stated"  # "stated", "defaulted" or "unknown"
    source: str = "form"
    auto: bool = False
    rule_note: str = ""
    id: str = ""
    group: str = ""
    corrects: str = ""

    def __post_init__(self) -> None:
        if self.date is not None and (not isinstance(self.date, dt.date) or isinstance(self.date, dt.datetime)):
            raise ValueError(f"Date must be a date, got {self.date!r}")
        if self.time is not None and (not isinstance(self.time, dt.time) or self.time.second or self.time.microsecond):
            raise ValueError(f"Time must be a time in whole minutes, got {self.time!r}")
        if self.time is not None and self.date is None:
            raise ValueError("A Time needs a Date.")
        if self.lab != NO_LAB and not LAB_PATTERN.fullmatch(self.lab):
            raise ValueError(f'Lab must look like "Lab 5" or "None", got {self.lab!r}')
        if (self.lab == NO_LAB) != (self.holding in HOLDING_PLACES + (RETIRED,)) or (self.lab != NO_LAB and self.holding):
            raise ValueError(f"Lab None needs a Holding place, and a lab has none: {self.lab!r}, {self.holding!r}")
        if self.type not in TYPES:
            raise ValueError(f"Type must be one of {TYPES}, got {self.type!r}")
        if not isinstance(self.change, int) or isinstance(self.change, bool):
            raise ValueError(f"Change must be a serial number, got {self.change!r}")

    @property
    def date_time(self) -> dt.datetime | None:
        """Date&Time: derived from Date + Time, blank unless both are known."""
        return dt.datetime.combine(self.date, self.time) if self.date and self.time is not None else None

    @property
    def place(self) -> str:
        return self.holding if self.lab == NO_LAB else self.lab


Ledger = tuple[Row, ...]


def place_fields(place: str) -> dict[str, str]:
    """Split a place into the Lab and Holding columns."""
    return {"lab": place, "holding": ""} if LAB_PATTERN.fullmatch(place) else {"lab": NO_LAB, "holding": place}


def row_at(when: dt.datetime | None, serial: int, place: str, time_basis: str = "stated", source: str = "form", **extra: object) -> Row:
    """A headset row from a combined instant, split into the Date and Time inputs."""
    date, time = (when.date(), when.time()) if when else (None, None)
    return Row(date=date, time=time, type=HEADSET, change=serial, time_basis=time_basis, source=source, **place_fields(place), **extra)  # type: ignore[arg-type]


def date_text(date: dt.date | None) -> str:
    return date.strftime("%B %d, %Y") if date else ""


def time_text(time: dt.time | None) -> str:
    return time.strftime("%H:%M") if time is not None else ""


def date_time_text(when: dt.datetime | None) -> str:
    return when.strftime("%Y/%m/%d  %H:%M:%S") if when else ""


def local_to_utc(date: dt.date, time: dt.time, zone: str) -> dt.datetime:
    """A wall-clock date and time in a zone, as naive UTC."""
    return dt.datetime.combine(date, time, ZoneInfo(zone)).astimezone(dt.timezone.utc).replace(tzinfo=None)


def zone_text(when: dt.datetime | None, zone: str) -> str:
    """A UTC instant shown in a zone, in the Date&Time display format."""
    if when is None:
        return ""
    return date_time_text(when.replace(tzinfo=dt.timezone.utc).astimezone(ZoneInfo(zone)).replace(tzinfo=None))


def date_serial(date: dt.date) -> int:
    """The day number a sheet stores for a date."""
    return (date - SHEET_EPOCH).days


def utc_text(row: "Row") -> str:
    """The one stored time. A date with no time stays a plain date; unknown stays blank."""
    if row.date_time:
        return row.date_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    return row.date.isoformat() if row.date else ""


def parse_utc_text(text: str | None) -> tuple[dt.date | None, dt.time | None]:
    value = str(text or "").strip()
    if not value:
        return None, None
    instant = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00Z", value)
    if instant:
        year, month, day, hour, minute = map(int, instant.groups())
        return dt.date(year, month, day), dt.time(hour, minute)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return dt.date.fromisoformat(value), None
    raise ValueError(f"UTC is not in a standard form: {value!r}")


def date_time_formula(row_number: int) -> str:
    """The sheet's =SUM(A:B), blank unless both inputs exist so a missing Time never becomes midnight."""
    return f'=IF(COUNT(A{row_number}:B{row_number})=2,SUM(A{row_number}:B{row_number}),"")'


def hardware_text(row: Row) -> list[str]:
    """The seven Hardware changes columns exactly as the sheet displays them."""
    return [date_text(row.date), time_text(row.time), date_time_text(row.date_time), row.lab, row.type, str(row.change), row.notes]


def row_text(row: Row) -> list[object]:
    """Every column a Row holds, in ledger order. Parity compares this with Rules.gs."""
    return [*hardware_text(row), row.holding, row.time_basis, row.id, row.group, row.source, row.auto, row.rule_note, row.corrects]


def parse_date_text(text: str | None) -> dt.date | None:
    if isinstance(text, (dt.date, dt.time)):  # datetime is a date; Sheets turned the cell into a value
        raise ValueError("Date arrived as a date value, not text; read the displayed text of the cell.")
    text = str(text or "").strip()
    if not text:
        return None
    for fmt in ("%B %d, %Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Date is not in a standard form: {text!r}")


def parse_time_text(text: str | None) -> dt.time | None:
    if isinstance(text, (dt.date, dt.time)):
        raise ValueError("Time arrived as a time value, not text; read the displayed text of the cell.")
    text = str(text or "").strip()
    if not text:
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
    if not match:
        raise ValueError(f"Time is not in a standard form: {text!r}")
    return dt.time(int(match.group(1)), int(match.group(2)))


def effective_rows(ledger: Ledger) -> Ledger:
    """Rows still in force: anything named by a later row's `corrects` is superseded."""
    replaced = {row.corrects for row in ledger if row.corrects}
    return tuple(row for row in ledger if row.id not in replaced)


def order_of(row: Row) -> dt.datetime:
    """Sort position: a blank date orders first; a blank time orders at the start of its date."""
    return dt.datetime.combine(row.date, row.time or dt.time.min) if row.date else dt.datetime.min


def _state(ledger: Ledger, at: dt.datetime | None = None) -> dict[int, tuple[str, tuple[dt.datetime, int]]]:
    """Latest arrival per serial at or before `at`: serial -> (place, ordering key)."""
    latest: dict[int, tuple[str, tuple[dt.datetime, int]]] = {}
    for index, row in enumerate(effective_rows(ledger)):
        key = (order_of(row), index)
        if at is not None and key[0] > at:
            continue
        if row.change not in latest or key > latest[row.change][1]:
            latest[row.change] = (row.place, key)
    return latest


def current_place(ledger: Ledger, serial: int, at: dt.datetime | None = None) -> str | None:
    entry = _state(ledger, at).get(serial)
    return entry[0] if entry else None


def lab_display(ledger: Ledger, lab: str, at: dt.datetime | None = None) -> int | None:
    """The last-known serial in a lab (a lab always displays this)."""
    in_lab = [(key, serial) for serial, (place, key) in _state(ledger, at).items() if place == lab]
    return max(in_lab)[1] if in_lab else None


def violations(ledger: Ledger) -> list[tuple[dt.datetime | None, str, tuple[int, ...]]]:
    """Instants at which a lab holds more than one serial (checked after all rows of that instant)."""
    rows = effective_rows(ledger)
    instants = sorted({order_of(row) for row in rows if row.date})
    checks: list[dt.datetime | None] = [*instants] or [None]
    found = []
    for instant in checks:
        by_lab: dict[str, list[int]] = {}
        for serial, (place, _) in _state(rows, instant).items():
            if LAB_PATTERN.fullmatch(place):
                by_lab.setdefault(place, []).append(serial)
        for lab, serials in sorted(by_lab.items()):
            if len(serials) > 1:
                found.append((instant, lab, tuple(sorted(serials))))
    return found


def minute_of(now: dt.datetime) -> dt.datetime:
    return now.replace(second=0, microsecond=0)


def resolve_when(date_text_in: str | None, time_text_in: str | None, now: dt.datetime) -> tuple[dt.date, dt.time, str]:
    """Blank date and time mean now, labelled "defaulted"; a stated date with no time keeps the date."""
    date = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(date_text_in or ""))
    time = re.match(r"(\d{1,2}):(\d{2})", str(time_text_in or ""))
    clock = minute_of(now)
    if not date and not time:
        return clock.date(), clock.time(), "defaulted"
    day = dt.date(*map(int, date.groups())) if date else clock.date()
    moment = dt.time(*map(int, time.groups())) if time else clock.time()
    return day, moment, "stated" if time else "defaulted"


def _resolve_time(when: dt.datetime | None, now: dt.datetime, time_basis: str | None) -> tuple[dt.datetime, str]:
    if when is None:
        return minute_of(now), "defaulted"
    return when, time_basis or "stated"


def _require_holding(destination: str | None) -> str:
    if destination not in HOLDING_PLACES:
        raise ValueError("The headset needs a destination: Spare or For repair.")
    return destination


def _require_destination(destination: str | None) -> str:
    return destination if destination == RETIRED else _require_holding(destination)


def _require_lab(lab: str) -> str:
    if not LAB_PATTERN.fullmatch(lab or ""):
        raise ValueError(f'Choose a lab, such as Lab 5. Got "{lab}".')
    return lab


def assign(
    ledger: Ledger,
    serial: int,
    lab: str,
    when: dt.datetime | None,
    *,
    now: dt.datetime,
    displaced_to: str = "Spare",
    source: str = "form",
    group: str = "",
    time_basis: str | None = None,
) -> Ledger:
    """Put a serial into a lab. An occupied lab makes a swap: two rows at the same time."""
    _require_lab(lab)
    _require_holding(displaced_to)
    at, basis = _resolve_time(when, now, time_basis)
    if current_place(ledger, serial, at) == RETIRED:
        raise ValueError(f"Headset {serial} is retired and cannot go into a lab.")
    rows = [row_at(at, serial, lab, basis, source, id=f"{group}-0", group=group)]
    occupant = lab_display(ledger, lab, at)
    if occupant is not None and occupant != serial:
        rows.append(row_at(at, occupant, displaced_to, basis, source, auto=True, rule_note=NOTE_DISPLACED, id=f"{group}-1", group=group))
    return tuple(rows)


def pullout(
    ledger: Ledger,
    serial: int,
    lab: str,
    destination: str | None,
    when: dt.datetime | None,
    *,
    now: dt.datetime,
    assignment_time: dt.datetime | None = None,
    source: str = "form",
    group: str = "",
    time_basis: str | None = None,
) -> Ledger:
    """Take a serial out of a lab. The destination is required and is never unknown.

    If the ledger does not show the serial in that lab, the system also creates the missing
    assignment one minute earlier (editable, never closer than one minute), and a displaced
    last-known serial gets its own destination row. That case makes three rows: the operator's
    ruling of 2026-10-31 makes it the one exception to the 1 to 2 row limit.
    """
    _require_lab(lab)
    place = _require_destination(destination)
    removed_at, basis = _resolve_time(when, now, time_basis)

    def removal(index: int) -> Row:
        return row_at(removed_at, serial, place, basis, source, id=f"{group}-{index}", group=group)

    found = current_place(ledger, serial, removed_at)
    if found == lab:
        return (removal(0),)
    if found == RETIRED:
        raise ValueError(f"Headset {serial} is retired.")
    assigned_at = removed_at - AUTO_GAP if assignment_time is None else assignment_time
    if assigned_at > removed_at - AUTO_GAP:
        raise ValueError("The assignment must be at least 1 minute earlier than the removal.")
    assign_basis = basis if assignment_time is None else "stated"
    rows = [row_at(assigned_at, serial, lab, assign_basis, source, auto=True, rule_note=NOTE_AUTO_ASSIGN, id=f"{group}-0", group=group)]
    occupant = lab_display(ledger, lab, assigned_at)
    if occupant is not None and occupant != serial:
        rows.append(row_at(assigned_at, occupant, HOLDING_PLACES[0], assign_basis, source, auto=True, rule_note=NOTE_DISPLACED, id=f"{group}-{len(rows)}", group=group))
    rows.append(removal(len(rows)))
    return tuple(rows)


def add_headset(ledger: Ledger, serial: int, place: str | None, when: dt.datetime | None, *, now: dt.datetime, group: str = "") -> Ledger:
    """Put a new serial on the roster. A site with no source workbook starts this way; the form then moves it into a lab."""
    holding = _require_holding(place)
    if serial in {row.change for row in ledger}:
        raise ValueError(f"Headset {serial} is already on the roster.")
    at, basis = _resolve_time(when, now, None)
    return (row_at(at, serial, holding, basis, "admin", id=f"{group}-0", group=group),)


def lab_from_choice(choice: str | None) -> str:
    match = re.match(r"Lab \d+", str(choice or ""))
    return match.group(0) if match else ""


def serial_from_choice(choice: str | None) -> int | None:
    match = re.match(r"\d+", str(choice or ""))
    return int(match.group(0)) if match else None


def form_choices(ledger: Ledger, lab_count: int) -> tuple[list[str], list[str]]:
    """Dropdown labels: each lab shows its last-known headset, and retired serials are hidden."""
    labs = []
    for number in range(1, lab_count + 1):
        serial = lab_display(ledger, f"Lab {number}")
        labs.append(f"Lab {number} ({'empty' if serial is None else serial})")
    state = _state(ledger)
    serials = [f"{serial} ({state[serial][0]})" for serial in sorted(state) if state[serial][0] != RETIRED]
    return labs, serials


def decide_entry(entry: dict, ledger: Ledger, domain: str, now: dt.datetime) -> dict:
    """Turn one form entry into rows, a maintenance row, or a held entry with a reason. Nothing is dropped."""
    def held(reason: str) -> dict:
        return {"kind": "held", "reason": reason}

    if not str(entry.get("email") or "").lower().endswith(f"@{domain}".lower()):
        return held(f"Sign in with a {domain} account first.")
    when = dt.datetime.combine(entry["date"], entry["time"])
    if when > now:
        return held("The date and time are in the future.")
    lab = entry.get("lab") or ""
    serial = entry.get("serial")
    if entry["action"] == "out" and serial is None:
        serial = lab_display(ledger, lab, when)
    if serial is None:
        return held(f"{lab} shows no headset. Choose the headset that came out.")
    if serial not in {row.change for row in ledger}:
        return held(f"Headset {serial} is not on the roster.")
    group = entry.get("group", "")
    source = entry.get("source", "form")
    basis = entry.get("time_basis")
    if entry["action"] == "fix":
        notes = "; ".join(part for part in (", ".join(entry.get("parts") or []), entry.get("notes") or "") if part)
        place = current_place(ledger, serial, when) or RETIRED
        return {"kind": "maintenance", "row": Row(date=entry["date"], time=entry["time"], type=MAINTENANCE, change=serial, notes=notes,
                                                  time_basis=basis or "stated", source=source, id=f"{group}-0", group=group, **place_fields(place))}
    shared = {"now": now, "source": source, "group": group, "time_basis": basis}
    try:
        if entry["action"] == "in":
            rows = assign(ledger, serial, lab, when, displaced_to=entry.get("displaced_to") or "Spare", **shared)
        else:
            rows = pullout(ledger, serial, lab, entry.get("destination"), when, **shared)
    except ValueError as error:
        return held(str(error))
    return {"kind": "rows", "rows": rows}


def correction_rows(ledger: Ledger, entry_id: str, new_when: dt.datetime, author: str) -> Ledger:
    """Correct an event time with new rows; the old rows stay.

    Moving an auto assignment also moves the row that closed the displaced headset, and the
    assignment stays at least a minute before the removal.
    """
    rows = effective_rows(ledger)
    target = next((row for row in rows if row.id == entry_id), None)
    if target is None:
        raise ValueError(f"Entry {entry_id} is not in force.")

    def redo(row: Row) -> Row:
        return replace(row, id=f"{row.id}-c", date=new_when.date(), time=new_when.time(), time_basis="stated", corrects=row.id, source=f"correction by {author}")

    if target.rule_note != NOTE_AUTO_ASSIGN:
        return (redo(target),)
    family = [row for row in rows if row.group == target.group]
    removal = next((row for row in family if not row.auto), None)
    if removal is not None and removal.date_time is not None and new_when > removal.date_time - AUTO_GAP:
        raise ValueError("The assignment must be at least 1 minute earlier than the removal.")
    return tuple(redo(row) for row in family if row.auto)


def rows_from_seed(table: list[list[str]]) -> Ledger:
    """Seed rows in SEED_COLUMNS, as the sheet displays them. A stated Date&Time must equal Date + Time."""
    rows = []
    for date, time, combined, lab, kind, change, notes, holding, time_basis, source in table:
        row = Row(date=parse_date_text(date), time=parse_time_text(time), lab=lab, type=kind, change=int(change), notes=notes,
                  holding=holding, time_basis=time_basis, source=source, id=f"tip-{change}", group="tip")
        if " ".join((combined or "").split()) != " ".join(date_time_text(row.date_time).split()):  # a sheet may show one space
            raise ValueError(f"Date&Time {combined!r} is not Date + Time for {change}.")
        rows.append(row)
    return tuple(rows)
