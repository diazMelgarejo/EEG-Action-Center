"""Tests for the device inventory ledger rules (PROVISIONAL, private).

Rules under test come from the operator's answers of 2026-10-31:
- a row means "serial arrives at place at time"; places are Lab N, Spare, For repair
- a swap or pullout makes 1 or 2 rows; a swap's rows share one time
- a displaced or removed serial always gets a destination row (never unknown)
- an unknown time defaults to now and is labelled "defaulted"
- only auto-created pairs (removal that does not match the lab's last-known serial) have the 1-minute gap
"""
import sys
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import device_inventory_ledger as dil  # noqa: E402

T0 = datetime(2026, 11, 1, 9, 0)
NOW = datetime(2026, 11, 1, 15, 30)


def ledger(*rows):
    return tuple(dil.row_at(when, serial, place, "stated", "test") for when, serial, place in rows)


class AssignAndSwap(unittest.TestCase):
    def test_assign_into_empty_lab_makes_one_row(self):
        rows = dil.assign(ledger(), 7006, "Lab 5", T0, now=NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0].change, rows[0].place, rows[0].date_time), (7006, "Lab 5", T0))

    def test_assign_into_occupied_lab_is_a_two_row_swap_at_one_time(self):
        led = ledger((T0, 1111, "Lab 5"))
        rows = dil.assign(led, 2222, "Lab 5", T0 + timedelta(days=1), now=NOW)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].date_time, rows[1].date_time)
        self.assertEqual({(r.change, r.place) for r in rows}, {(2222, "Lab 5"), (1111, "Spare")})

    def test_displaced_serial_can_go_to_for_repair(self):
        led = ledger((T0, 1111, "Lab 5"))
        rows = dil.assign(led, 2222, "Lab 5", T0 + timedelta(days=1), now=NOW, displaced_to="For repair")
        self.assertIn((1111, "For repair"), {(r.change, r.place) for r in rows})

    def test_moving_a_serial_between_labs_into_an_occupied_lab_is_two_rows(self):
        led = ledger((T0, 1111, "Lab 5"), (T0, 2222, "Lab 7"))
        rows = dil.assign(led, 2222, "Lab 5", T0 + timedelta(days=1), now=NOW)
        self.assertEqual(len(rows), 2)
        full = led + rows
        self.assertEqual(dil.lab_display(full, "Lab 7"), None)
        self.assertEqual(dil.lab_display(full, "Lab 5"), 2222)


class Pullout(unittest.TestCase):
    def test_pullout_is_one_row_with_required_destination(self):
        led = ledger((T0, 1111, "Lab 5"))
        rows = dil.pullout(led, 1111, "Lab 5", "For repair", T0 + timedelta(days=1), now=NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].place, "For repair")

    def test_destination_unknown_or_blank_is_refused(self):
        led = ledger((T0, 1111, "Lab 5"))
        for bad in (None, "", "unknown", "Unknown", "None"):
            with self.assertRaises(ValueError):
                dil.pullout(led, 1111, "Lab 5", bad, T0 + timedelta(days=1), now=NOW)

    def test_pullout_destination_defaults_are_not_invented(self):
        led = ledger((T0, 1111, "Lab 5"))
        with self.assertRaises(TypeError):
            dil.pullout(led, 1111, "Lab 5")  # type: ignore[call-arg]


class Retirement(unittest.TestCase):
    def test_a_serial_can_be_pulled_out_to_retired(self):
        led = ledger((T0, 7005, "Lab 11"))
        rows = dil.pullout(led, 7005, "Lab 11", "Retired", T0 + timedelta(days=1), now=NOW)
        self.assertEqual((len(rows), rows[0].place), (1, "Retired"))

    def test_a_retired_serial_is_never_assigned_again(self):
        led = ledger((T0, 7005, "Retired"))
        with self.assertRaises(ValueError):
            dil.assign(led, 7005, "Lab 11", T0 + timedelta(days=1), now=NOW)

    def test_a_displaced_serial_cannot_be_sent_to_retired_automatically(self):
        led = ledger((T0, 1111, "Lab 5"))
        with self.assertRaises(ValueError):
            dil.assign(led, 2222, "Lab 5", T0 + timedelta(days=1), now=NOW, displaced_to="Retired")


class TimeRules(unittest.TestCase):
    def test_stated_time_is_labelled_stated(self):
        rows = dil.assign(ledger(), 7006, "Lab 5", T0, now=NOW)
        self.assertEqual(rows[0].time_basis, "stated")

    def test_unknown_time_defaults_to_now_and_is_labelled(self):
        rows = dil.assign(ledger(), 7006, "Lab 5", None, now=NOW)
        self.assertEqual(rows[0].date_time, NOW)
        self.assertEqual(rows[0].time_basis, "defaulted")


class SheetsValuesAreNotText(unittest.TestCase):
    """A cell Sheets turned into a date or time value must be refused with a message that names the cause."""

    def test_a_time_value_is_refused_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "time value"):
            dil.parse_time_text(time(15, 30))

    def test_a_date_value_is_refused_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "date value"):
            dil.parse_date_text(date(2026, 10, 22))


class MismatchedRemoval(unittest.TestCase):
    def setUp(self):
        self.led = ledger((T0, 1111, "Lab 5"))  # lab shows 1111; 2222 is pulled out of Lab 5
        self.removal_time = T0 + timedelta(days=2)

    def test_auto_pair_has_one_minute_gap_and_displaced_serial_gets_a_row(self):
        rows = dil.pullout(self.led, 2222, "Lab 5", "Spare", self.removal_time, now=NOW)
        by = {(r.change, r.place): r for r in rows}
        assign = by[(2222, "Lab 5")]
        removal = by[(2222, "Spare")]
        self.assertEqual(removal.date_time - assign.date_time, timedelta(minutes=1))
        self.assertTrue(assign.auto)
        self.assertEqual(by[(1111, "Spare")].date_time, assign.date_time)

    def test_displaced_but_unassigned_headset_is_the_three_row_exception(self):
        # Operator ruling 2026-10-31: the 1 to 2 row limit has one exception, a displaced headset that
        # would otherwise be left without a destination.
        rows = dil.pullout(self.led, 2222, "Lab 5", "Spare", self.removal_time, now=NOW)
        self.assertEqual(len(rows), 3)

    def test_edited_assignment_time_must_be_at_least_one_minute_before_removal(self):
        too_close = self.removal_time - timedelta(seconds=59)
        with self.assertRaises(ValueError):
            dil.pullout(self.led, 2222, "Lab 5", "Spare", self.removal_time, now=NOW, assignment_time=too_close)
        earlier = self.removal_time - timedelta(hours=3)
        rows = dil.pullout(self.led, 2222, "Lab 5", "Spare", self.removal_time, now=NOW, assignment_time=earlier)
        self.assertIn(earlier, {r.date_time for r in rows})

    def test_matching_removal_has_no_auto_rows(self):
        rows = dil.pullout(self.led, 1111, "Lab 5", "Spare", self.removal_time, now=NOW)
        self.assertFalse(any(r.auto for r in rows))


class BlankArchiveDates(unittest.TestCase):
    def test_blank_event_orders_first_and_stays_blank(self):
        led = (dil.row_at(None, 7003, "Lab 8", "unknown", "tip"), dil.row_at(T0, 7015, "Lab 10", "stated", "tip"))
        self.assertEqual(dil.lab_display(led, "Lab 8"), 7003)
        rows = dil.assign(led, 7015, "Lab 8", T0 + timedelta(days=1), now=NOW)
        self.assertEqual(rows[1].change, 7003)


class ResolveWhen(unittest.TestCase):
    def test_blank_defaults_to_now(self):
        self.assertEqual(dil.resolve_when("", "", NOW), (date(2026, 11, 1), time(15, 30), "defaulted"))

    def test_date_and_time_are_stated(self):
        self.assertEqual(dil.resolve_when("2026-11-03", "14:22", NOW), (date(2026, 11, 3), time(14, 22), "stated"))

    def test_date_only_keeps_the_date_and_is_defaulted(self):
        self.assertEqual(dil.resolve_when("2026-11-03", "", NOW), (date(2026, 11, 3), time(15, 30), "defaulted"))

    def test_time_only_uses_today(self):
        self.assertEqual(dil.resolve_when("", "14:22", NOW), (date(2026, 11, 1), time(14, 22), "stated"))


class FormChoices(unittest.TestCase):
    def test_labels_show_last_known_and_hide_retired(self):
        led = ledger((T0, 7001, "Lab 12"), (T0, 7005, "Retired"), (T0, 7006, "For repair"))
        labs, serials = dil.form_choices(led, 3)
        self.assertEqual(labs, ["Lab 1 (empty)", "Lab 2 (empty)", "Lab 3 (empty)"])
        self.assertEqual(serials, ["7001 (Lab 12)", "7006 (For repair)"])
        self.assertEqual(dil.lab_from_choice("Lab 12 (7001)"), "Lab 12")
        self.assertEqual(dil.serial_from_choice("7001 (Lab 12)"), 7001)
        self.assertIsNone(dil.serial_from_choice(""))


class DecideEntry(unittest.TestCase):
    def setUp(self):
        self.led = ledger((T0, 1111, "Lab 5"), (T0, 2222, "Spare"), (T0, 7005, "Retired"))

    def entry(self, **over):
        base = {"action": "in", "email": "a.person@example.org", "lab": "Lab 5", "serial": 2222, "date": T0.date(), "time": time(10, 0),
                "time_basis": "stated", "group": "g1", "source": "form"}
        return {**base, **over}

    def decide(self, **over):
        return dil.decide_entry(self.entry(**over), self.led, "example.org", NOW)

    def test_held_cases_keep_a_reason(self):
        for over in ({"email": "someone@outside.example"}, {"serial": 4040}, {"serial": 7005}, {"date": date(2026, 11, 2)},
                     {"action": "out", "lab": "Lab 9", "serial": None, "destination": "Spare"}, {"action": "out", "serial": None, "destination": ""}):
            result = self.decide(**over)
            self.assertEqual(result["kind"], "held", over)
            self.assertTrue(result["reason"])

    def test_swap_and_pullout_of_the_shown_headset(self):
        self.assertEqual(len(self.decide()["rows"]), 2)
        rows = self.decide(action="out", serial=None, destination="For repair")["rows"]
        self.assertEqual([(r.change, r.place) for r in rows], [(1111, "For repair")])

    def test_maintenance_is_a_record_not_a_row(self):
        result = self.decide(action="fix", serial=1111, parts=["Cz", "BOA knob"], notes="loose", defect_id="D-1")
        self.assertEqual(result["kind"], "maintenance")
        row = result["row"]
        self.assertEqual((row.type, row.change, row.lab, row.notes), ("Equipment Maintenance", 1111, "Lab 5", "Cz, BOA knob; loose"))


class Corrections(unittest.TestCase):
    def test_correction_supersedes_and_keeps_the_one_minute_rule(self):
        led = ledger((T0, 1111, "Lab 5"))
        removal = T0 + timedelta(days=2)
        rows = dil.pullout(led, 2222, "Lab 5", "Spare", removal, now=NOW, group="g")
        full = led + rows
        auto = next(r for r in rows if r.rule_note == "created at removal")
        with self.assertRaises(ValueError):
            dil.correction_rows(full, auto.id, removal - timedelta(seconds=30), "op")
        fixed = dil.correction_rows(full, auto.id, removal - timedelta(hours=2), "op")
        self.assertTrue(any(r.corrects == auto.id for r in fixed))
        after = full + fixed
        self.assertEqual(dil.violations(after), [])
        self.assertEqual(dil.current_place(after, 2222), "Spare")
        self.assertNotIn(auto.id, {r.id for r in dil.effective_rows(after)})


class Seed(unittest.TestCase):
    def test_seed_rows_keep_blank_dates(self):
        table = [["January 15, 2021", "12:15", "2021/01/15  12:15:00", "Lab 12", "Headset", "7001", "", "", "stated", "workbook r101"],
                 ["", "", "", "Lab 8", "Headset", "7003", "", "", "unknown", "legend"]]
        rows = dil.rows_from_seed(table)
        self.assertEqual(rows[0].date_time, datetime(2021, 1, 15, 12, 15))
        self.assertIsNone(rows[1].date_time)

    def test_seed_ignores_the_spacing_a_sheet_gives_date_time(self):
        table = [["January 15, 2021", "12:15", "2021/01/15 12:15:00", "Lab 12", "Headset", "7001", "", "", "stated", "x"]]
        self.assertEqual(dil.rows_from_seed(table)[0].date_time, datetime(2021, 1, 15, 12, 15))

    def test_seed_refuses_a_blank_date_time_when_date_and_time_are_given(self):  # operator ruling 2026-10-31
        table = [["January 15, 2021", "12:15", "", "Lab 12", "Headset", "7001", "", "", "stated", "x"]]
        with self.assertRaises(ValueError):
            dil.rows_from_seed(table)

    def test_seed_refuses_a_date_time_that_is_not_date_plus_time(self):
        table = [["January 15, 2021", "12:15", "2021/01/15  12:16:00", "Lab 12", "Headset", "7001", "", "", "stated", "x"]]
        with self.assertRaises(ValueError):
            dil.rows_from_seed(table)


class Schema(unittest.TestCase):
    """The schema is the Hardware changes sheet: Date, Time, Date&Time derived, Lab, Type, Change, Notes."""

    def test_columns_lead_with_the_hardware_changes_columns(self):
        self.assertEqual(dil.HARDWARE_COLUMNS, ("Date", "Time", "Date&Time", "Lab", "Type", "Change", "Notes"))
        self.assertEqual(dil.LEDGER_COLUMNS[:7], dil.HARDWARE_COLUMNS)

    def test_date_time_is_derived_and_cannot_be_stored(self):
        row = dil.Row(date=date(2021, 1, 15), time=time(12, 15), lab="Lab 12", type="Headset", change=7001)
        self.assertEqual(row.date_time, datetime(2021, 1, 15, 12, 15))
        with self.assertRaises(TypeError):
            dil.Row(date=date(2021, 1, 15), time=time(12, 15), lab="Lab 12", type="Headset", change=7001, date_time=NOW)  # type: ignore[call-arg]

    def test_blank_date_or_time_gives_a_blank_date_time(self):
        self.assertIsNone(dil.Row(date=date(2021, 1, 15), time=None, lab="Lab 12", type="Headset", change=1).date_time)
        self.assertIsNone(dil.Row(date=None, time=None, lab="Lab 12", type="Headset", change=1).date_time)

    def test_bad_values_cannot_be_constructed(self):
        good = {"date": date(2021, 1, 15), "time": time(12, 15), "lab": "Lab 12", "type": "Headset", "change": 1}
        for over in ({"date": "2026-10-11"}, {"date": datetime(2026, 10, 11)}, {"time": "12:15"}, {"time": time(12, 15, 30)},
                     {"date": None}, {"lab": "Lab X"}, {"lab": "None"}, {"lab": "Spare"}, {"type": "Thing"}, {"change": "1"}):
            with self.assertRaises(ValueError, msg=over):
                dil.Row(**{**good, **over})

    def test_none_lab_needs_a_holding_place_and_a_lab_has_none(self):
        self.assertEqual(dil.Row(date=None, time=None, lab="None", holding="Spare", type="Headset", change=1).place, "Spare")
        with self.assertRaises(ValueError):
            dil.Row(date=None, time=None, lab="Lab 2", holding="Spare", type="Headset", change=1)

    def test_text_is_the_sheet_display_format(self):
        row = dil.Row(date=date(2021, 1, 15), time=time(12, 15), lab="Lab 12", type="Headset", change=7001)
        self.assertEqual(dil.hardware_text(row), ["January 15, 2021", "12:15", "2021/01/15  12:15:00", "Lab 12", "Headset", "7001", ""])

    def test_sheet_formula_derives_date_time_and_stays_blank_without_both(self):
        self.assertEqual(dil.date_time_formula(5), '=IF(COUNT(A5:B5)=2,SUM(A5:B5),"")')

    def test_defaulted_now_drops_seconds_to_fit_the_time_column(self):
        rows = dil.assign((), 7006, "Lab 5", None, now=datetime(2026, 11, 1, 15, 30, 45))
        self.assertEqual(rows[0].time, time(15, 30))


class AddHeadset(unittest.TestCase):
    """A new site has no source workbook, so an admin adds its headsets."""

    def test_a_new_headset_is_one_row_in_a_holding_place(self):
        rows = dil.add_headset((), 7001, "Spare", T0, now=NOW, group="h1")
        self.assertEqual([(r.change, r.place, r.time_basis) for r in rows], [(7001, "Spare", "stated")])

    def test_unknown_time_defaults_to_now(self):
        self.assertEqual(dil.add_headset((), 7001, "For repair", None, now=NOW)[0].time_basis, "defaulted")

    def test_a_serial_already_on_the_roster_is_refused(self):
        with self.assertRaises(ValueError):
            dil.add_headset(ledger((T0, 7001, "Lab 2")), 7001, "Spare", NOW, now=NOW)

    def test_only_a_holding_place_is_accepted(self):
        for bad in ("Lab 2", "Retired", "", None):
            with self.assertRaises(ValueError):
                dil.add_headset((), 7001, bad, T0, now=NOW)


class Zones(unittest.TestCase):
    """Only UTC is stored. Local time is a display; another zone is a second display."""

    CASES = [
        (date(2030, 1, 15), time(12, 0), "Asia/Tokyo", "2030-01-15T03:00:00Z"),
        (date(2030, 1, 15), time(12, 0), "America/New_York", "2030-01-15T17:00:00Z"),
        (date(2030, 7, 15), time(12, 0), "America/New_York", "2030-07-15T16:00:00Z"),  # daylight saving
        (date(2030, 7, 15), time(12, 0), "Europe/Paris", "2030-07-15T10:00:00Z"),
        (date(2030, 1, 1), time(2, 0), "Asia/Tokyo", "2029-12-31T17:00:00Z"),  # crosses a date and a year
    ]

    def test_local_time_converts_to_utc(self):
        for day, clock, zone, expected in self.CASES:
            when = dil.local_to_utc(day, clock, zone)
            self.assertEqual(when.strftime("%Y-%m-%dT%H:%M:%SZ"), expected, zone)

    def test_utc_displays_in_any_zone(self):
        when = datetime(2030, 7, 15, 16, 0)
        self.assertEqual(dil.zone_text(when, "America/New_York"), "2030/07/15  12:00:00")
        self.assertEqual(dil.zone_text(when, "UTC"), "2030/07/15  16:00:00")
        self.assertEqual(dil.zone_text(None, "UTC"), "")

    def test_a_row_stores_one_utc_text_and_it_reads_back(self):
        row = dil.Row(date=date(2030, 1, 15), time=time(3, 0), lab="Lab 2", type="Headset", change=1)
        self.assertEqual(dil.utc_text(row), "2030-01-15T03:00:00Z")
        self.assertEqual(dil.parse_utc_text("2030-01-15T03:00:00Z"), (date(2030, 1, 15), time(3, 0)))

    def test_a_date_with_no_time_has_no_instant_and_stays_a_date(self):
        row = dil.Row(date=date(2030, 1, 15), time=None, lab="Lab 2", type="Headset", change=1)
        self.assertEqual(dil.utc_text(row), "2030-01-15")
        self.assertEqual(dil.parse_utc_text("2030-01-15"), (date(2030, 1, 15), None))
        self.assertEqual(dil.parse_utc_text(""), (None, None))

    def test_bad_utc_text_is_refused(self):
        for bad in ("15/01/2030", "2030-01-15 03:00", "2030-01-15T03:00:00+08:00"):
            with self.assertRaises(ValueError):
                dil.parse_utc_text(bad)

    def test_a_sheet_day_number_matches_the_sheet_epoch(self):
        self.assertEqual(dil.date_serial(date(2030, 1, 15)), 47498)

    def test_the_ledger_has_one_utc_column_after_the_seven(self):
        self.assertEqual(dil.LEDGER_COLUMNS[7], "UTC")
        self.assertEqual(dil.LEDGER_COLUMNS.count("UTC"), 1)


class Violations(unittest.TestCase):
    def test_two_serials_in_one_lab_at_one_instant_is_a_violation(self):
        led = ledger((T0, 1111, "Lab 5"), (T0 + timedelta(hours=1), 2222, "Lab 5"))
        self.assertEqual(len(dil.violations(led)), 1)

    def test_a_swap_at_one_time_is_not_a_violation(self):
        led = ledger((T0, 1111, "Lab 5"))
        led = led + dil.assign(led, 2222, "Lab 5", T0 + timedelta(days=1), now=NOW)
        self.assertEqual(dil.violations(led), [])

    def test_ledger_rows_are_immutable(self):
        row = dil.row_at(T0, 1, "Lab 1", "stated", "test")
        with self.assertRaises(Exception):
            row.place = "Lab 2"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
