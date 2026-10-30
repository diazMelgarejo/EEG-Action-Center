"""The one reader for Hardware changes shaped sheets (read-only).

Date and Time are the inputs. Date&Time is derived by device_inventory_ledger.Row and column C is never read:
its stored values are rounded (08:00 reads back as 07:59:59.712), and many rows copy, type or omit it.
"""
import datetime as dt
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.expanduser("~/Library/Python/3.13/lib/python/site-packages"))
from openpyxl import load_workbook

import device_inventory_ledger as dil

SHEET = "Hardware changes"


@dataclass(frozen=True)
class SheetRow:
    number: int
    date: dt.date | None
    time: dt.time | None
    lab: str
    type: str
    change: int
    notes: str

    @property
    def date_time(self) -> dt.datetime | None:
        return dt.datetime.combine(self.date, self.time) if self.date and self.time is not None else None

    @property
    def order(self) -> tuple[dt.datetime, int]:
        return dt.datetime.combine(self.date, self.time or dt.time.min) if self.date else dt.datetime.min, self.number


def _serial(value: object) -> int | None:
    if isinstance(value, (int, float)) and value == int(value):
        return int(value)
    return int(value.strip()) if isinstance(value, str) and value.strip().isdigit() else None


def check_header(path: str, header_row: int) -> None:
    sheet = load_workbook(path, read_only=True, data_only=True)[SHEET]
    found = next(sheet.iter_rows(min_row=header_row, max_row=header_row, max_col=7, values_only=True))
    if tuple(found) != dil.HARDWARE_COLUMNS:
        raise ValueError(f"{path}: columns are {found}, expected {dil.HARDWARE_COLUMNS}")


def load_headsets(path: str, first_row: int) -> list[SheetRow]:
    """Headset rows with a numeric serial, in the sheet's date and time order."""
    check_header(path, first_row - 1)
    sheet = load_workbook(path, read_only=True, data_only=True)[SHEET]
    rows = []
    for number, row in enumerate(sheet.iter_rows(min_row=first_row, max_col=7, values_only=True), first_row):
        date, time, _, lab, kind, change, notes = row
        serial = _serial(change)
        if kind != dil.HEADSET or serial is None:
            continue
        day = date.date() if isinstance(date, dt.datetime) else None
        clock = time.replace(second=0, microsecond=0) if isinstance(time, dt.time) else None
        rows.append(SheetRow(number, day, clock if day else None, str(lab or "").strip(), kind, serial, str(notes or "")))
    return sorted(rows, key=lambda r: r.order)
