# Headset log v2: Google Sheets backend, Google Forms frontend

Created 2026-10-31. **Nothing here is deployed**, and nothing here has run against real Google services. Ready to install on a copy and rehearse; not proven.
Real inventory data is not in this bundle. It is read from your own sheets, inside Google, after you sign in with an organization account.

Future agents: start with [`HANDOFF.md`](HANDOFF.md).

This replaces an earlier generated draft. [`REVIEW.md`](REVIEW.md) lists what was wrong with the draft and what changed. Rules and motivation:
[`docs/DESIGN.md`](docs/DESIGN.md).

## What you get

| Part | What it is |
|---|---|
| Backend | A Google Sheet, written only by an Apps Script: Ledger (append-only), Maintenance, Held, Current, View, Flags, Seed, Review, Progress |
| Frontend | A Google Form: three paths (into a lab, out of a lab, repair), dropdowns that show each lab's last-known headset, a progress bar for the person filling it in |
| Real-data load | Menu **Headset log**: set source workbooks, load tips, review, seed. Every step refuses anyone outside the organization's domain |
| Visual progress | The **Progress** tab: a 9-step checklist drawn from facts in the file, a bar, and one tile per lab (red if a lab holds two headsets) |
| Privacy seal | No organization value in code: the domain, lab count, zones and sites are settings or Drive files. Admins change them; `addAdmin()` adds more admins. `src/check_public_safe.py` blocks a push on any leak |
| Rules | `src/device_inventory_ledger.py` and `src/tip_proposals.py` are the source of truth; `Rules.gs` and `Tips.gs` are their translations, tested for parity |
| Theme | Ivory and pearl: header image, preview, settings |

## Two layers

| Layer | Holds | Lives |
|---|---|---|
| Public app | Code, tests with invented fixtures, docs | This repository, open source |
| Private data | Domain, labs, serials, sites, zones, admins, links, sheets | Only the organization's Google Drive, read at run time |

Nothing crosses from private to public. The app ships empty, and meets the data only inside Google after a domain check.

## Time: one rule, two sides

The app is time zone aware and has one clock inside it.

| Side | Time zone | What it holds | Who reads it |
|---|---|---|---|
| Saved app data | UTC only | The `UTC` column of each tab: `YYYY-MM-DDTHH:MM:00Z`, a plain date when the time is unknown, blank when both are | The app, and nothing else in the app reads time |
| Google Sheets | The site's local time, always | Date, Time and Date&Time cells, as plain numbers | People |

- Converting happens only at the edges: a form answer or a source workbook goes from local to UTC on the way in, and the UTC value goes to local on the way out. Rules compare UTC only, so two sites in different zones cannot confuse them.
- The code never changes a sheet's time zone. A person sets it in File, Settings, and names it to `configure()` to confirm it.
- Once confirmed, the zone is locked. If the sheet's zone later differs, the app stops with a message, and a form entry goes to Held. No row is ever written under the wrong zone.
- Everything is labelled: a note on each Date, Time, Date&Time and UTC header, the zone beside the form's date and time, and the zone in the View, Current and Progress headings. The Hardware changes column names stay exact.
- There are two displays. Local comes first. The other is UTC by default and any admin can change it; changing it rewrites the display and never touches the Ledger.
- A form cannot see a person's browser, so "local" means the site's zone, whoever is filling it in.
- The Apps Script project itself runs in UTC (`appsscript.json`, and Project settings). `configure()` and `setup()` refuse otherwise.

## Sites

A site's file holds its own settings, admins, form and local time zone, so nothing is shared between sites.

- **Existing site** (`mode` `existing`, the default): loads from sheets already in the organization's Drive.
- **New site** (`mode` `new`): starts empty. An admin adds headsets from the menu.
- **Adding a site:** in a clean template file, run `configureTemplate('<your domain>')` once. Then **Add a site** copies the template into a new file for the named first admin, who sets its local time zone in File, Settings, sets the script's project time zone to UTC, and runs `configure()` and `setup()` there.
- Settings do not follow a copied file: a copy starts unconfigured.

## How your real data gets in

Work on copies, never on the pristine originals: make a dated BASE copy that nobody touches and a WORK copy to read from (`HANDOFF.md`, section 5).

1. Sign in to Google with your organization account and open the new sheet. Check File, Settings shows the site's local time zone. Set the script's own time zone to UTC in Project settings. In the script editor run `configure('<your domain>', <number of labs>, '<sheet time zone>')` once, then `setup()` once. An optional fourth argument sets the other time zone (UTC by default) and a fifth the mode. You become the first admin.
2. **Headset log, Set source workbooks**: paste the link of your WORK copy of the workbook, and of the weekly legend if it is a sheet.
3. **Load tips from workbook**: the script reads Date and Time (never the Date&Time column), takes the latest dated row per lab, compares it with the
   legend, and writes the **Review** tab. Agreeing labs need nothing. Each disagreement is a row with a dropdown: Use workbook, Use legend, or Hold.
4. You decide. **Seed from reviewed tips** applies your decisions. A headset left without a place by a decision is added to Review and seeding waits.
   Nothing is guessed, a held item stays out of the ledger, and a headset that would be in two places is refused.
5. The Ledger now starts from the latest tips. The old workbook stays untouched as the archive.

If you are not signed in on the domain, steps 1 to 4 stop with a message and write nothing. The check fails closed: an empty email counts as outside.

## Verify on a laptop (no Google needed)

```sh
cd src
python3 -B test_device_inventory_ledger.py     # 50 tests
python3 -B test_tip_proposals.py               # 23 tests
cd device-inventory-apps-script-draft
node --test tests/rules.test.js tests/tips.test.js tests/code.test.js   # parity tests skip until parity.json exists
```

Full parity: `HARDWARE_CHANGES_XLSX=/path/to/workbook.xlsx python3 -B parity_check.py` in `src`, then the node command again. `check_schema.py` fails if any artefact drifts from the schema.

## What is proven, and what is not

Proven locally: the rules, the schema, tip proposals and decisions, setup progress, the domain gate's logic, and the sheet and form wiring against **fake** Google
services; Python and Apps Script give the same answers on 28 scenarios and an archive replay.

Not proven: everything that depends on real Google. The pilot plan lists 30 tests (sign-in prompts, answer formats in Forms, dropdown refresh, two people
at once, whether `getActiveUser().getEmail()` returns the address, sharing, the form's progress bar and theme). The tip logic has not seen a real workbook.

## Layout

`README.md`, `HANDOFF.md`, `REVIEW.md`, `docs/` (design, pilot plan, decision matrix, diagram), `src/` (Python, Apps Script, theme).
Apps Script files to paste: `Rules.gs`, `Tips.gs`, `Code.gs`, `Init.gs`, `appsscript.json`. `AuditDateTimeColumn.gs` is separate: its own project, read-only.
