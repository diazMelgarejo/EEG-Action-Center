"""Fails if any artefact drifts from the Hardware changes schema. Run after any change; exit code 1 means drift."""
import csv
import datetime as dt
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import device_inventory_ledger as dil
import hardware_changes as hc
import tip_proposals as tp
from openpyxl import load_workbook

DRAFT = f"{HERE}/device-inventory-apps-script-draft"
WORKBOOK = os.path.expanduser(os.environ.get("HARDWARE_CHANGES_XLSX", "~/Hardware-changes.xlsx"))
TIPS = os.environ.get("TIP_ROWS_XLSX", f"{HERE}/tip-rows.xlsx")
SEED = os.environ.get("PILOT_SEED_CSV", f"{HERE}/pilot-seed.csv")
results = []


def check(name, passed, detail=""):
    results.append(passed)
    print(f"{'PASS' if passed else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


check("Hardware changes header equals the schema", bool(hc.check_header(WORKBOOK, 3) is None))
rules = open(f"{DRAFT}/Rules.gs", encoding="utf-8").read()
code = open(f"{DRAFT}/Code.gs", encoding="utf-8").read()
for name, value in (("HARDWARE_COLUMNS", dil.HARDWARE_COLUMNS), ("ROW_COLUMNS", dil.ROW_COLUMNS), ("ENTRY_COLUMNS", dil.ENTRY_COLUMNS)):
    text = "[" + ", ".join(f"'{c}'" for c in value) + "]"
    check(f"Rules.gs {name} equals Python", f"const {name} = {text};" in rules)
for name, value in (("DATE_DISPLAY", dil.DATE_DISPLAY), ("TIME_DISPLAY", dil.TIME_DISPLAY), ("DATE_TIME_DISPLAY", dil.DATE_TIME_DISPLAY)):
    check(f"Rules.gs {name} equals Python", f"const {name} = '{value}';" in rules)
init = open(f"{DRAFT}/Init.gs", encoding="utf-8").read()
tips_gs = open(f"{DRAFT}/Tips.gs", encoding="utf-8").read()
check("Code.gs reads no Event or Since column", not re.search(r"'(Event|Since|Place)'", code))
check("Init.gs skips column C when reading the source", "const [date, , , lab, type, change, notes] = cells;" in init)
check("Init.gs gates every real-data step on the domain", all(f"function {fn}" in init and "requireDomainUser_();" in init.split(f"function {fn}")[1].split("\nfunction ")[0] for fn in ("setSourceWorkbooks", "loadTipProposals", "seedFromReview")))
check("Setup steps equal Python", "const SETUP_STEPS = [\n" + "".join(f"  '{s}',\n" for s in tp.SETUP_STEPS) + "];" in tips_gs)
check("Manifest scopes are explicit", "oauthScopes" in open(f"{DRAFT}/appsscript.json", encoding="utf-8").read())
check("Row stores no Date&Time field", "date_time" not in dil.Row.__dataclass_fields__)
check("hardware_changes never reads column C", "_, lab, kind" in open(f"{HERE}/hardware_changes.py", encoding="utf-8").read())

with open(SEED, newline="", encoding="utf-8") as fh:
    header, *table = list(csv.reader(fh))
check("Seed header equals SEED_COLUMNS", tuple(header) == dil.SEED_COLUMNS)
check("Every seed row passes rows_from_seed", len(dil.rows_from_seed(table)) == len(table), f"{len(table)} rows")

sheet = load_workbook(TIPS)[hc.SHEET]
check("Tip file header leads with the schema", tuple(c.value for c in sheet[1])[:7] == dil.HARDWARE_COLUMNS)
bad = []
for row in sheet.iter_rows(min_row=2):
    number = row[0].row
    if row[2].value != dil.date_time_formula(number):
        bad.append(f"formula r{number}")
    if row[0].value is not None and (row[0].number_format != dil.DATE_DISPLAY or not isinstance(row[0].value, (dt.date, dt.datetime))):
        bad.append(f"date r{number}")
    if row[1].value is not None and (row[1].number_format != dil.TIME_DISPLAY or not isinstance(row[1].value, dt.time)):
        bad.append(f"time r{number}")
    if row[2].number_format != dil.DATE_TIME_DISPLAY:
        bad.append(f"display r{number}")
check("Tip file Date, Time and Date&Time are standard", not bad, ", ".join(bad[:6]))

parity = json.load(open(f"{DRAFT}/tests/parity.json", encoding="utf-8"))
check("Parity columns equal the schema", tuple(parity["columns"]["hardware"]) == dil.HARDWARE_COLUMNS and tuple(parity["columns"]["ledger"]) == dil.LEDGER_COLUMNS)
print(f"\n{sum(results)} of {len(results)} checks pass")
sys.exit(0 if all(results) else 1)
