# Keeping Python and JavaScript in sync

Private. `../device_inventory_ledger.py` is the original source. `Rules.gs` is its JavaScript translation. Change both
in the same step. `Code.gs` is Google-only and has no Python twin.

## The schema

Everything follows the Hardware changes sheet: Date, Time, Date&Time, Lab, Type, Change, Notes, then system columns.
Date and Time are the inputs. Date&Time is derived and is never stored in Python or JavaScript; in Sheets it is a formula.
Column C of the source is never read (`hardware_changes.py` is the one reader).

Saved app data is UTC only, and the logic reads only that. Date, Time and Date&Time on a sheet are local display for people. `local_to_utc`, `zone_text` and `add_headset` have JavaScript twins; zone cases and headset cases are in `parity.json`.

## Files

| File | Twin | Notes |
|---|---|---|
| `Rules.gs` | `device_inventory_ledger.py` (source of truth) | Pure logic |
| `Tips.gs` | `tip_proposals.py` (source of truth) | Pure logic: tip proposals, decisions, setup progress |
| `Code.gs`, `Init.gs` | none (Google only) | Read and write; the domain gate, the Review and Progress tabs, the menu |
| `AuditDateTimeColumn.gs` | none | Read-only audit, to be pasted into its own project |

No file may use another file's constants while the project loads (Apps Script does not promise a load order); `tests/code.test.js` loads the files
in several orders to catch it.

## Name map

| Python | Rules.gs | Note |
|---|---|---|
| `Row` (frozen dataclass, validated on construction) | `makeRow` (validated) | Date is `date` / a Date at local midnight; Time is `time` / "HH:MM"; Change is `change` |
| `Row.date_time` | `dateTime(row)` | Derived from Date + Time, never stored; blank unless both exist |
| `Row.place` | `placeOf(row)` | Lab, or Holding when Lab is None |
| `row_at`, `place_fields` | `rowAt`, `placeFields` | |
| `hardware_text`, `row_text` | `hardwareText`, `rowText` | Exact sheet display text; parity compares these |
| `date_time_formula` | `dateTimeFormula` | Same formula in the sheet and the tip file |
| `order_of` | `orderMs` | Blank date first; blank time at the start of its date |
| `effective_rows` | `effectiveRows` | |
| `_state` | `stateAt_` | Blank event orders first: `datetime.min` / `-Infinity` |
| `current_place` | `currentPlace` | |
| `lab_display` | `labDisplay` | |
| `violations` | `findViolations` | Python returns tuples, JavaScript objects |
| `resolve_when` | `resolveWhen` | Python returns a tuple, JavaScript an object |
| `assign` | `intoLab` | Python takes arguments, JavaScript one object. Python turns `when=None` into now; JavaScript gets the time from `resolveWhen` |
| `pullout` | `outOfLab` | Same |
| `lab_from_choice` | `labFromChoice` | |
| `serial_from_choice` | `serialFromChoice` | |
| `form_choices` | `formChoices` | Python returns a tuple, JavaScript an object |
| `decide_entry` | `decideEntry` | Python takes `domain, now`; JavaScript takes `{domain, now}` |
| `correction_rows` | `correctionRows` | |
| `form_choices(ledger, lab_count)`, `propose_tips(rows, legend, lab_count)` | Same, with `labCount` | The lab count is always passed in; it is never a constant |
| `rows_from_seed` | `rowsFromSeed` | Python takes `now` for tests. Date&Time is compared with spacing collapsed, because a sheet may show one space |
| `WorkbookRow`, `Legend`, `Proposal`, `TipResult` | plain objects, same fields in camelCase | `workbook_row` is `workbookRow`, `legend_text` is `legendText`, `seed_table` is `seedTable` |
| `propose_tips`, `resolve_tips` | `proposeTips`, `resolveTips` | Decisions are `{key: choice}`; a decision must be one of the offered options |
| `setup_progress`, `progress_fraction`, `SETUP_STEPS` | `setupProgress`, `progressFraction`, `SETUP_STEPS` | The step names are compared by `check_schema.py` |
| `RETIRED`, `HOLDING_PLACES`, `AUTO_GAP`, `NOTE_*` | `RETIRED_PLACE`, `HOLDING_PLACES`, `AUTO_GAP_MS`, `NOTE_*` | |
| `HARDWARE_COLUMNS`, `ROW_COLUMNS`, `ENTRY_COLUMNS`, `DATE_DISPLAY`, `TIME_DISPLAY`, `DATE_TIME_DISPLAY` | Same names | `check_schema.py` compares them |

Error and held messages are identical on purpose; the parity check compares them.

## After any rule change

```sh
cd ..                                   # the private export folder
python3 -B test_device_inventory_ledger.py
python3 -B test_tip_proposals.py
python3 -B parity_check.py              # writes tests/parity.json from the Python answers
cd device-inventory-apps-script-draft
node --test tests/rules.test.js tests/tips.test.js tests/code.test.js
cd .. && python3 -B check_schema.py   # exit 1 means an artefact drifted from the schema
```

A new rule gets a Python test first, then a scenario in `parity_check.py`, then the JavaScript. `tests/parity.json`
holds real serial numbers, so it is ignored by git, stays on the operator's machine, and is never pasted into Apps Script.
