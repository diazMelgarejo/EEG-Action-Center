"""Writes the answers of device_inventory_ledger.py to tests/parity.json for Rules.gs to match (private; read-only on sources).

Run this, then: node --test device-inventory-apps-script-draft/tests/rules.test.js
"""
import datetime as dt
import json
import os
import sys
from datetime import datetime, timedelta

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import device_inventory_ledger as dil
import hardware_changes as hc
import tip_proposals as tp

HERE = os.path.dirname(os.path.abspath(__file__))
WORKBOOK = os.path.expanduser(os.environ.get("HARDWARE_CHANGES_XLSX", "~/Hardware-changes.xlsx"))
OUT = os.path.join(HERE, "device-inventory-apps-script-draft", "tests", "parity.json")
NOW = datetime(2026, 11, 20, 15, 30)
T0 = datetime(2026, 11, 1, 9, 0)
DOMAIN = "example.org"
PERSON = "a.person@example.org"


def iso(when):
    return when.strftime("%Y-%m-%dT%H:%M:%S") if when else None


LEDGER = tuple(dil.row_at(when, serial, place, "stated" if when else "unknown", "tip", id=f"tip-{serial}", group="tip") for when, serial, place in [
    (T0, 1111, "Lab 5"), (T0, 2222, "Spare"), (T0, 3333, "Lab 7"), (T0, 7005, "Retired"), (None, 7003, "Lab 8"), (T0, 4444, "For repair"),
])
AT = T0 + timedelta(days=2)
SCENARIOS = {
    "into an empty lab": {"action": "in", "serial": 2222, "lab": "Lab 9"},
    "swap into an occupied lab": {"action": "in", "serial": 2222, "lab": "Lab 5"},
    "swap, displaced goes for repair": {"action": "in", "serial": 2222, "lab": "Lab 5", "displaced_to": "For repair"},
    "move between labs": {"action": "in", "serial": 3333, "lab": "Lab 5"},
    "swap over a blank-date tip": {"action": "in", "serial": 2222, "lab": "Lab 8"},
    "same serial again": {"action": "in", "serial": 1111, "lab": "Lab 5"},
    "defaulted time": {"action": "in", "serial": 2222, "lab": "Lab 9", "time_basis": "defaulted"},
    "out, shown headset": {"action": "out", "serial": None, "lab": "Lab 5", "destination": "Spare"},
    "out, named and matching": {"action": "out", "serial": 1111, "lab": "Lab 5", "destination": "For repair"},
    "out, retired": {"action": "out", "serial": 1111, "lab": "Lab 5", "destination": "Retired"},
    "out, mismatch over occupant": {"action": "out", "serial": 2222, "lab": "Lab 5", "destination": "Spare"},
    "out, mismatch in empty lab": {"action": "out", "serial": 2222, "lab": "Lab 9", "destination": "For repair"},
    "fix": {"action": "fix", "serial": 1111},
    "fix with parts and notes": {"action": "fix", "serial": 1111, "parts": ["Cz", "BOA knob"], "notes": "loose"},
    "fix a spare": {"action": "fix", "serial": 2222},
    "wrong domain": {"action": "in", "serial": 2222, "lab": "Lab 9", "email": "someone@outside.example"},
    "no email": {"action": "in", "serial": 2222, "lab": "Lab 9", "email": ""},
    "upper-case email": {"action": "in", "serial": 2222, "lab": "Lab 9", "email": "A.Person@example.org"},
    "future": {"action": "in", "serial": 2222, "lab": "Lab 9", "date": dt.date(2026, 11, 21)},
    "unknown serial": {"action": "in", "serial": 4040, "lab": "Lab 9"},
    "retired into a lab": {"action": "in", "serial": 7005, "lab": "Lab 9"},
    "retired out of a lab": {"action": "out", "serial": 7005, "lab": "Lab 9", "destination": "Spare"},
    "out of an empty lab, nothing named": {"action": "out", "serial": None, "lab": "Lab 9", "destination": "Spare"},
    "blank destination": {"action": "out", "serial": 1111, "lab": "Lab 5", "destination": ""},
    "unknown destination": {"action": "out", "serial": 1111, "lab": "Lab 5", "destination": "unknown"},
    "None destination": {"action": "out", "serial": 1111, "lab": "Lab 5", "destination": "None"},
    "no lab chosen": {"action": "in", "serial": 2222, "lab": ""},
    "displaced to retired refused": {"action": "in", "serial": 2222, "lab": "Lab 5", "displaced_to": "Retired"},
}


def scenario(name, over):
    entry = {"email": PERSON, "date": AT.date(), "time": AT.time(), "time_basis": "stated", "group": "g1", "source": "form", **over}
    got = dil.decide_entry(entry, LEDGER, DOMAIN, NOW)
    if got["kind"] == "rows":
        expected = {"kind": "rows", "rows": [dil.row_text(r) for r in got["rows"]]}
    elif got["kind"] == "held":
        expected = got
    else:
        expected = {"kind": got["kind"], "row": dil.row_text(got["row"])}
    return {"name": name, "entry": {**entry, "date": entry["date"].isoformat(), "time": entry["time"].strftime("%H:%M")}, "expected": expected}


def archive():
    ledger, autos, rows = (), 0, []
    for index, row in enumerate(r for r in hc.load_headsets(WORKBOOK, 4) if r.date):
        when = dt.datetime.combine(row.date, row.time or dt.time.min)  # a date-only row replays at the start of its date
        target = row.lab if row.lab.startswith("Lab ") else "Spare"
        rows.append([iso(when), target, row.change])
        if target == "Spare":
            new = (dil.row_at(when, row.change, "Spare", "stated", "replay", id=f"p{index}-0"),)
        else:
            new = dil.assign(ledger, row.change, target, when, now=NOW, source="replay", group=f"p{index}")
        autos += sum(1 for r in new if r.auto)
        ledger += new
    places = {str(s): dil.current_place(ledger, s) for s in {r[2] for r in rows}}
    return {"rows": rows, "autoRows": autos, "violations": len(dil.violations(ledger)), "places": places}


def tip_inputs():
    d1, d2, d3 = dt.date(2026, 3, 1), dt.date(2026, 5, 1), dt.date(2026, 7, 1)
    rows = [tp.WorkbookRow(*r, dil.HEADSET, *c) for r, c in [
        ((10, d1, dt.time(9, 0), "Lab 1"), (7001, "")), ((11, d2, dt.time(9, 0), "Lab 1"), (7002, "")), ((12, d1, dt.time(9, 0), "Lab 2"), (7003, "")),
        ((13, d2, None, "Lab 3"), (7004, "")), ((14, d2, dt.time(10, 0), "None"), (7005, "")), ((15, None, None, "Lab 2"), (7099, "")),
        ((16, d3, dt.time(9, 0), "Lab 4"), (7006, "")), ((17, d1, dt.time(9, 0), "Lab 5"), (7008, "")), ((18, d2, dt.time(9, 0), "Lab 6"), (7008, "")),
    ]]
    legends = {
        "all agree": tp.Legend({"Lab 1": 7002, "Lab 2": 7003, "Lab 3": 7004, "Lab 4": 7006}, {7005: "Spare"}),
        "lab disagrees": tp.Legend({"Lab 1": 7001, "Lab 2": 7003, "Lab 3": 7004, "Lab 4": 7006}, {}),
        "text cell": tp.Legend({"Lab 1": "7002 = 7001", "Lab 2": 7003, "Lab 3": 7004, "Lab 4": 7006}, {}),
        "spare in a lab": tp.Legend({"Lab 1": 7002, "Lab 2": 7003, "Lab 3": 7004, "Lab 4": 7006}, {7002: "Spare", 7005: "For repair"}),
        "serial moved later": tp.Legend({"Lab 5": 7008, "Lab 6": 7008}, {}),
    }
    return rows, legends


def proposal_plain(p):
    return [p.key, p.place, p.workbook, p.workbook_row, p.legend, p.legend_text, p.status, p.reason, list(p.options)]


def tip_cases():
    rows, legends = tip_inputs()
    cases = []
    for name, legend in legends.items():
        props = tp.propose_tips(rows, legend, lab_count=6)
        base = {"serial 7001": "Retired", "serial 7005": "Spare", "serial 7008": "Spare"}
        for label, decisions in (("none", {}), ("retire and spare", base), ("legend wins", {**base, "Lab 1": tp.USE_LEGEND, "Lab 5": tp.USE_LEGEND, "Lab 6": tp.USE_WORKBOOK}),
                                 ("workbook wins", {**base, "Lab 1": tp.USE_WORKBOOK, "Lab 5": tp.USE_WORKBOOK, "Lab 6": tp.USE_WORKBOOK}), ("hold", {**base, "Lab 1": tp.HOLD, "serial 7005": tp.HOLD}),
                                 ("bad option", {**base, "Lab 1": "Spare"})):
            result = tp.resolve_tips(props, decisions, rows)
            cases.append({"name": f"{name} / {label}", "legend": name, "decisions": decisions,
                          "expected": {"seed": [list(r) for r in result.seed_table], "unresolved": [list(u) for u in result.unresolved], "extra": [proposal_plain(p) for p in result.extra], "held": list(result.held)}})
    return {
        "rows": [[r.number, r.date.isoformat() if r.date else None, r.time.strftime("%H:%M") if r.time else "", r.lab, r.type, r.change, r.notes] for r in rows],
        "legends": {n: {"labs": dict(l.labs), "holding": {str(k): v for k, v in l.holding.items()}} for n, l in legends.items()},
        "proposals": {n: [proposal_plain(p) for p in tp.propose_tips(rows, l, lab_count=6)] for n, l in legends.items()},
        "cases": cases,
        "progress": [{"facts": f, "expected": tp.setup_progress(f)} for f in ({}, {tp.SETUP_STEPS[0]: True}, {tp.SETUP_STEPS[0]: True, tp.SETUP_STEPS[2]: True}, {s: True for s in tp.SETUP_STEPS})],
        "steps": list(tp.SETUP_STEPS),
    }


def zone_cases():
    dates = [(dt.date(2030, 1, 15), dt.time(12, 0)), (dt.date(2030, 7, 15), dt.time(12, 0)), (dt.date(2030, 1, 1), dt.time(2, 0)), (dt.date(2030, 12, 31), dt.time(23, 30))]
    zones = ["UTC", "Asia/Tokyo", "America/New_York", "Europe/Paris", "Australia/Sydney"]
    cases = []
    for day, clock in dates:
        for zone in zones:
            when = dil.local_to_utc(day, clock, zone)
            cases.append({"local": f"{day.isoformat()} {clock.strftime('%H:%M')}", "zone": zone, "utc": when.strftime("%Y-%m-%dT%H:%M:%SZ"), "shown": dil.zone_text(when, zone)})
    return cases


def headset_cases():
    cases = []
    for serial, place in ((7100, "Spare"), (7100, "For repair"), (1111, "Spare"), (7100, "Lab 2"), (7100, "Retired"), (7100, "")):
        try:
            result = [dil.row_text(r) for r in dil.add_headset(LEDGER, serial, place, AT, now=NOW, group="h1")]
        except ValueError as error:
            result = str(error)
        cases.append({"serial": serial, "place": place, "expected": result})
    return cases


pulled = dil.pullout(LEDGER, 2222, "Lab 5", "Spare", AT, now=NOW, group="g2")
auto = next(r for r in pulled if r.rule_note == dil.NOTE_AUTO_ASSIGN)
corrected = dil.correction_rows(LEDGER + pulled, auto.id, AT - timedelta(hours=2), "op")
SEED = [["January 15, 2021", "12:15", "2021/01/15  12:15:00", "Lab 12", "Headset", "7001", "", "", "stated", "workbook r101"],
        ["", "", "", "Lab 8", "Headset", "7003", "", "", "unknown", "legend"],
        ["January 18, 2021", "10:02", "2021/01/18  10:02:00", "None", "Headset", "7007", "", "For repair", "stated", "workbook r101"],
        ["January 19, 2021", "", "", "Lab 2", "Headset", "7008", "", "", "stated", "workbook r101"],
        ["January 20, 2021", "23:30", "2021/01/20 23:30:00", "Lab 3", "Headset", "7009", "", "", "stated", "workbook r101"]]
TIMES = [("", ""), ("2026-11-03", "14:22"), ("2026-11-03", ""), ("", "14:22"), ("2026-11-03", "7:05")]
labs, serials = dil.form_choices(LEDGER, 6)


def time_case(date_in, time_in):
    day, clock, basis = dil.resolve_when(date_in, time_in, NOW)
    return [date_in, time_in, dil.date_text(day), dil.time_text(clock), basis]


result = {
    "columns": {"hardware": list(dil.HARDWARE_COLUMNS), "ledger": list(dil.LEDGER_COLUMNS), "seed": list(dil.SEED_COLUMNS)},
    "displays": [dil.DATE_DISPLAY, dil.TIME_DISPLAY, dil.DATE_TIME_DISPLAY],
    "formula": dil.date_time_formula(5),
    "now": iso(NOW), "domain": DOMAIN, "ledger": [dil.row_text(r) for r in LEDGER],
    "scenarios": [scenario(name, over) for name, over in SCENARIOS.items()],
    "times": [time_case(d, t) for d, t in TIMES],
    "choices": {"labs": labs, "serials": serials},
    "seed": {"table": SEED, "rows": [dil.row_text(r) for r in dil.rows_from_seed(SEED)]},
    "correction": {"ledger": [dil.row_text(r) for r in LEDGER + pulled], "id": auto.id, "when": iso(AT - timedelta(hours=2)), "rows": [dil.row_text(r) for r in corrected]},
    "archive": archive(),
    "tips": tip_cases(),
    "zones": zone_cases(),
    "headsets": headset_cases(),
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(result, fh)
os.chmod(OUT, 0o600)
print(f"scenarios {len(result['scenarios'])}; archive rows {len(result['archive']['rows'])}; added {result['archive']['autoRows']}; violations {result['archive']['violations']}")
