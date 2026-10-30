"""Tests for tip proposals and setup progress (PROVISIONAL, private).

The loader reads a Hardware changes shaped sheet and a weekly legend, proposes the latest tip for every lab, and lists every disagreement
for the operator to decide. Nothing is guessed: an undecided disagreement blocks seeding, and a held item stays out of the ledger.
"""
import sys
import unittest
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import device_inventory_ledger as dil  # noqa: E402
import tip_proposals as tp  # noqa: E402


def wb(number, day, clock, lab, serial, notes=""):
    return tp.WorkbookRow(number, day, clock, lab, dil.HEADSET, serial, notes)


D1, D2, D3 = date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1)
ROWS = [
    wb(10, D1, time(9, 0), "Lab 1", 7001),
    wb(11, D2, time(9, 0), "Lab 1", 7002),  # latest for Lab 1
    wb(12, D1, time(9, 0), "Lab 2", 7003),
    wb(13, D2, None, "Lab 3", 7004),
    wb(14, D2, time(10, 0), "None", 7005),  # 7005 pulled out to None
    wb(15, None, None, "Lab 2", 7099),  # undated: cannot be ordered, never a tip
]


def legend(labs=None, holding=None):
    return tp.Legend(labs or {}, holding or {})


def by_key(proposals):
    return {p.key: p for p in proposals}


class Propose(unittest.TestCase):
    def test_latest_dated_row_per_lab_is_the_workbook_tip(self):
        got = by_key(tp.propose_tips(ROWS, legend({"Lab 1": 7002, "Lab 2": 7003, "Lab 3": 7004}), lab_count=3))
        self.assertEqual((got["Lab 1"].workbook, got["Lab 1"].workbook_row), (7002, 11))
        self.assertEqual(got["Lab 1"].status, tp.AGREE)
        self.assertEqual(got["Lab 2"].workbook, 7003)  # the undated row is ignored

    def test_a_row_with_a_date_but_no_time_orders_at_the_start_of_its_date(self):
        rows = [wb(1, D2, None, "Lab 1", 7001), wb(2, D2, time(0, 1), "Lab 1", 7002)]
        got = by_key(tp.propose_tips(rows, legend({"Lab 1": 7002}), lab_count=1))
        self.assertEqual(got["Lab 1"].workbook, 7002)

    def test_ties_go_to_the_later_sheet_row(self):
        rows = [wb(1, D2, time(9, 0), "Lab 1", 7001), wb(2, D2, time(9, 0), "Lab 1", 7002)]
        self.assertEqual(by_key(tp.propose_tips(rows, legend({"Lab 1": 7002}), lab_count=1))["Lab 1"].workbook, 7002)

    def test_disagreement_needs_a_decision_and_offers_both_sources(self):
        got = by_key(tp.propose_tips(ROWS, legend({"Lab 1": 7001}), lab_count=1))["Lab 1"]
        self.assertEqual(got.status, tp.DECIDE)
        self.assertEqual(got.options, (tp.USE_WORKBOOK, tp.USE_LEGEND, tp.HOLD))
        self.assertIn("7002", got.reason)
        self.assertIn("7001", got.reason)

    def test_an_empty_lab_with_no_evidence_is_empty_not_a_decision(self):
        got = by_key(tp.propose_tips([], legend(), lab_count=1))["Lab 1"]
        self.assertEqual((got.status, got.options), (tp.EMPTY, ()))

    def test_legend_cell_that_is_not_a_single_serial_needs_a_decision(self):
        got = by_key(tp.propose_tips(ROWS, legend({"Lab 1": "7002 = 7001"}), lab_count=1))["Lab 1"]
        self.assertEqual(got.status, tp.DECIDE)
        self.assertIn("not a single serial", got.reason)
        self.assertEqual(got.options, (tp.USE_WORKBOOK, tp.HOLD))

    def test_the_workbook_moving_the_serial_on_later_needs_a_decision(self):
        rows = [wb(1, D1, time(9, 0), "Lab 1", 7001), wb(2, D2, time(9, 0), "Lab 2", 7001)]
        got = by_key(tp.propose_tips(rows, legend({"Lab 1": 7001, "Lab 2": 7001}), lab_count=2))["Lab 1"]
        self.assertEqual(got.status, tp.DECIDE)
        self.assertIn("Lab 2", got.reason)

    def test_legend_spare_agrees_when_the_workbook_last_put_it_in_none(self):
        got = by_key(tp.propose_tips(ROWS, legend(holding={7005: "Spare"}), lab_count=0))["serial 7005"]
        self.assertEqual((got.status, got.place), (tp.AGREE, "Spare"))

    def test_legend_spare_that_the_workbook_puts_in_a_lab_needs_a_decision(self):
        got = by_key(tp.propose_tips(ROWS, legend({"Lab 1": 7002}, {7002: "Spare"}), lab_count=1))["serial 7002"]
        self.assertEqual((got.status, got.options), (tp.DECIDE, (tp.USE_LEGEND, tp.HOLD)))

    def test_a_serial_nobody_places_needs_a_decision_with_four_options(self):
        got = by_key(tp.propose_tips(ROWS, legend({"Lab 1": 7002, "Lab 2": 7003, "Lab 3": 7004}), lab_count=3))
        self.assertEqual(got["serial 7001"].status, tp.DECIDE)
        self.assertEqual(got["serial 7001"].options, ("Spare", "For repair", "Retired", tp.HOLD))
        self.assertEqual(got["serial 7005"].status, tp.DECIDE)  # in no lab and not in the legend


class Resolve(unittest.TestCase):
    def setUp(self):
        self.leg = legend({"Lab 1": 7002, "Lab 2": 7003, "Lab 3": 7004}, {})
        self.props = tp.propose_tips(ROWS, self.leg, lab_count=3)

    def decide_all(self, **over):
        decisions = {"serial 7001": "Retired", "serial 7005": "Spare"}
        decisions.update(over)
        return decisions

    def test_agreeing_tips_become_seed_rows_with_the_real_date_and_time(self):
        result = tp.resolve_tips(self.props, self.decide_all(), ROWS)
        self.assertEqual(result.unresolved, ())
        first = result.seed_table[0]
        self.assertEqual(first[:6], ["May 01, 2026", "09:00", "2026/05/01  09:00:00", "Lab 1", "Headset", "7002"])
        self.assertEqual(first[8:], ["stated", "workbook r11"])
        self.assertEqual(result.seed_table[2][:3], ["May 01, 2026", "", ""])  # a date with no time keeps the time blank
        self.assertEqual(result.seed_table[2][8], "unknown")

    def test_every_seed_row_passes_the_ledger_schema(self):
        result = tp.resolve_tips(self.props, self.decide_all(), ROWS)
        ledger = dil.rows_from_seed([list(r) for r in result.seed_table])
        self.assertEqual(dil.violations(ledger), [])
        self.assertEqual(dil.current_place(ledger, 7001), "Retired")
        self.assertEqual(dil.current_place(ledger, 7005), "Spare")

    def test_an_undecided_disagreement_blocks_seeding(self):
        props = tp.propose_tips(ROWS, legend({"Lab 1": 7001, "Lab 2": 7003, "Lab 3": 7004}), lab_count=3)
        result = tp.resolve_tips(props, self.decide_all(), ROWS)
        self.assertEqual([k for k, _ in result.unresolved], ["Lab 1"])
        self.assertEqual(result.seed_table, ())

    def test_use_legend_takes_the_legend_serial_and_marks_the_source(self):
        leg = legend({"Lab 1": 7001, "Lab 2": 7003, "Lab 3": 7004})
        props = tp.propose_tips(ROWS, leg, lab_count=3)
        result = tp.resolve_tips(props, {"Lab 1": tp.USE_LEGEND, "serial 7002": "Retired", "serial 7005": "Spare"}, ROWS)
        self.assertEqual(result.unresolved, ())
        row = result.seed_table[0]
        self.assertEqual((row[3], row[5], row[9]), ("Lab 1", "7001", "workbook r10"))  # 7001's latest Lab 1 row

    def test_use_legend_without_a_dated_row_leaves_date_and_time_blank(self):
        leg = legend({"Lab 1": 7777})
        rows = [wb(1, D1, time(9, 0), "Lab 1", 7002)]
        props = tp.propose_tips(rows, leg, lab_count=1)
        result = tp.resolve_tips(props, {"Lab 1": tp.USE_LEGEND, "serial 7002": "Spare"}, rows)
        row = result.seed_table[0]
        self.assertEqual((row[0], row[1], row[2], row[8], row[9]), ("", "", "", "unknown", "legend"))
        self.assertIn("No dated workbook row", row[6])

    def test_a_serial_made_unplaced_by_a_decision_is_asked_about_next(self):
        leg = legend({"Lab 1": 7001, "Lab 2": 7003, "Lab 3": 7004})
        props = tp.propose_tips(ROWS, leg, lab_count=3)
        result = tp.resolve_tips(props, {"Lab 1": tp.USE_LEGEND, "serial 7005": "Spare", "serial 7001": "Retired"}, ROWS)
        self.assertIn("serial 7002", [p.key for p in result.extra])
        self.assertTrue(result.unresolved)

    def test_hold_keeps_an_item_out_and_reports_it(self):
        result = tp.resolve_tips(self.props, self.decide_all(**{"serial 7001": tp.HOLD}), ROWS)
        self.assertEqual(result.held, ("serial 7001",))
        self.assertNotIn("7001", [r[5] for r in result.seed_table])

    def test_one_serial_in_two_places_is_refused(self):
        leg = legend({"Lab 1": 7002, "Lab 2": 7002, "Lab 3": 7004})
        rows = ROWS + [wb(16, D3, time(9, 0), "Lab 2", 7002)]
        props = tp.propose_tips(rows, leg, lab_count=3)
        result = tp.resolve_tips(props, self.decide_all(**{"serial 7003": "Spare", "Lab 1": tp.USE_LEGEND}), rows)
        self.assertTrue(any("two places" in why for _, why in result.unresolved))

    def test_a_decision_must_be_one_of_the_offered_options(self):
        leg = legend({"Lab 1": 7001, "Lab 2": 7003, "Lab 3": 7004})
        props = tp.propose_tips(ROWS, leg, lab_count=3)
        result = tp.resolve_tips(props, {"Lab 1": "Spare", **self.decide_all()}, ROWS)
        self.assertIn("Lab 1", [k for k, _ in result.unresolved])


class Progress(unittest.TestCase):
    FACTS = {step: False for step in tp.SETUP_STEPS}

    def test_first_missing_step_is_next_and_the_rest_wait(self):
        facts = {**self.FACTS, tp.SETUP_STEPS[0]: True, tp.SETUP_STEPS[1]: True}
        got = tp.setup_progress(facts)
        self.assertEqual([s for _, s in got[:4]], ["done", "done", "next", "waiting"])

    def test_a_later_done_step_does_not_hide_an_earlier_gap(self):
        facts = {**self.FACTS, tp.SETUP_STEPS[3]: True}
        self.assertEqual(tp.setup_progress(facts)[0][1], "next")
        self.assertEqual(tp.setup_progress(facts)[3][1], "done")

    def test_fraction_counts_done_steps(self):
        facts = {s: True for s in tp.SETUP_STEPS[:3]}
        self.assertEqual(tp.progress_fraction(tp.setup_progress({**self.FACTS, **facts})), (3, len(tp.SETUP_STEPS)))

    def test_unknown_fact_name_is_refused(self):
        with self.assertRaises(ValueError):
            tp.setup_progress({"Made up step": True})


if __name__ == "__main__":
    unittest.main()
