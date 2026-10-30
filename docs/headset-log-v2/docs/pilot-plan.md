# Headset log: test pilot plan (DRAFT)

Created 2026-10-31. Nothing here has been run. No Google file, form or trigger exists yet.

## Purpose

Prove on real moves that entries made at the moment of change give the right answer to "where was this headset, and what did this lab hold?",
while the old workbook carries on untouched.

## What is proven and what is not

Proven on a laptop with fake Google services: the rules, the schema, tip proposals, setup progress, the domain gate's logic and the sheet wiring.
**Nothing below T01 has been proven on real Google.** A simulator result is never one of these tests.

## Before starting (operator)

1. Confirm the domain and the number of labs for `configure()`, and name the pilot people and the Held tab owner.
2. Confirm the parts list and pull-out reasons in `Code.gs`, and who may choose Retired.
3. Choose the start date.

## Setup (run by the operator, signed in with the organization account)

1. Copy the sources first: for the workbook and the legend, make a dated BASE copy nobody touches and a WORK copy (`../HANDOFF.md`, section 5). Create a new spreadsheet in the organization's Drive; check File, Settings shows the site's local time zone. Sheets stay in local time and the code never changes them.
2. Extensions, Apps Script: paste `Rules.gs`, `Tips.gs`, `Code.gs`, `Init.gs` and `appsscript.json`. Never paste `tests/`. In Project settings, set the script's own time zone to UTC; `configure()` and `setup()` refuse if it differs. Saved app data is UTC only.
3. Run `configure('<your domain>', <number of labs>, '<sheet time zone>')` once, naming the zone File, Settings shows, then `setup()` once, and grant access. The person who runs it becomes the first admin; admins change the other time zone and lab count and add other admins from the menu or with `setOtherTimeZone()`, `setLabCount()` and `addAdmin()`. The form is created unpublished. Reload the sheet: the **Headset log** menu appears and the **Progress** tab shows the checklist.
4. Menu, **Set source workbooks**: paste the link of the WORK copy of the workbook, and of the legend if you have it as a sheet.
5. Menu, **Load tips from workbook**. The Review tab lists every lab with its proposed tip. Rows that agree need nothing; every row marked
   *decision needed* has a dropdown in the Decision column. Real data now lives only inside this spreadsheet.
6. Fill the Decision column. Menu, **Seed from reviewed tips**. If the decisions leave a headset without a place, it is added to Review for you to decide, and seeding waits.
7. Apply `THEME.md` in the form editor, restrict the form to the organization's domain, publish it to the pilot people only, and send the link.

## Stages

| Stage | Who | Length | Done when |
|---|---|---|---|
| Rehearsal | Operator, on a throwaway copy | First | T01 to T30 run |
| First week | Operator plus one named person | 1 week | Each entry reconciled by hand the same day |
| Rest of the month | All pilot people | 3 weeks | Weekly review held; acceptance below passes |

## Tests against real Google services

| ID | Test | Pass |
|---|---|---|
| T01 | Open the form with a personal Gmail account | Asked to sign in to the domain; no form shown |
| T02 | Submit from two named accounts | Author is each person's email |
| T03 | Choose each of the three actions | Each goes to its section, then to When |
| T04 | Submit a stated date and time | Date and Time show exactly that in the site's local time; the UTC column is the same moment in UTC |
| T05 | Leave date and time blank | Event is now; TimeBasis says defaulted |
| T06 | Swap into an occupied lab | Two rows, same time; dropdown label changes within a minute |
| T07 | Pull out a headset the lab does not show | Three rows; assignment 1 minute earlier; displaced headset gets a row |
| T08 | Submit from a form left open, after its choice changed | Recorded correctly or held; never lost |
| T09 | Two people submit at the same moment | Both recorded, in order; no violation |
| T10 | Assign a retired serial | Held, and the person gets an email |
| T11 | Run `applyCorrection` on an auto row | New rows appended; old rows unchanged |
| T12 | Try to edit the Ledger tab as a pilot person | Refused. The owner can still edit, so this is a guard and not a lock |
| T13 | Check the Current tab against the lab | Every lab matches what is physically there |
| T14 | Check the theme on a phone and a laptop | Header not cropped badly; Submit readable; the form's progress bar shows |
| T15 | Check a Ledger row | Date, Time and Date&Time display as in Hardware changes; Date&Time is the formula; a time reads back unchanged |
| T16 | Run **Load tips from workbook** signed in with a personal account | Refused with the domain message; nothing written |
| T17 | Run it signed in with the organization account | Review lists every lab; every agreeing row matches what the workbook and legend show; no row reads column C |
| T18 | Run **Seed from reviewed tips** with a decision missing | Refused, with the count; Review gains a row for any headset left unplaced |
| T19 | Seed with every decision made | Ledger tips equal the reviewed decisions; Current shows every lab; Flags empty |
| T20 | Open the Progress tab at each stage | The checklist, the bar and the lab tiles match the real state; red tile if a lab holds two headsets |
| T21 | Share the sheet with someone outside the domain and ask them to open the Review tab | They cannot see it |
| T22 | After the whole flow, compare the WORK copy with BASE | No cell changed; version history shows no edit by the script |
| T23 | Compare File, Settings before and after the whole flow | The sheet's time zone never changed |
| T24 | Hover over the Date, Time, Date&Time and UTC headers; open the form's When page | Each says what it is and names its zone |
| T25 | Check one row near midnight local time | Local date and UTC date differ as they should; the Sheets formula still gives the local Date&Time |
| T26 | Change the other time zone as an admin, and try as a non-admin | View, Current and Progress change for the admin; Ledger unchanged; the non-admin is refused |
| T27 | On a throwaway file, change File, Settings after `configure()` and submit an entry | The app stops with the message; the entry is in Held and the Ledger is unchanged; put the zone back |
| T28 | In a template, run **Add a site** | A new file exists, the named admin can edit it, the Sites tab is gone from it, and it is listed in the template |
| T29 | Open that copy | The script is present and starts unconfigured, or record what Google actually did; set its zone by hand, then `configure()` with mode `new` and `setup()` |
| T30 | Add a headset as that site's admin, and submit it into a lab | It appears on the form and in Current; the first site is unchanged |

## Weekly review

Held tab cleared; Flags tab explained; Ledger export compared with new workbook rows; every difference listed. Export the Ledger and replay it
through `device_inventory_ledger.py` for an independent check.

## Acceptance (pass or fail; no invented thresholds)

1. No submitted entry is missing from Ledger, Maintenance or Held.
2. Replaying the Ledger through Python gives the same current places as the Current tab.
3. The Flags tab is empty, or each flag has an explanation.
4. Every move found in the old workbook during the pilot is in the Ledger, or the difference is listed.
5. A physical check of every lab at the end matches the Current tab, or each difference is explained.
6. Independent review of the code and the results, with no private chat content.

## Stop and go back to the workbook if

An entry is lost; the script writes a wrong row and the cause is not found the same day; or pilot people stop using the form. The workbook has
stayed current throughout, so stopping loses nothing. To stop, close the form to responses.

## Known limits

Checks run after Submit, so a person can send a bad entry and hears about it by email. Sheet protection is not a security measure; the owner can edit
anything. `Session.getActiveUser().getEmail()` can come back empty depending on account settings, in which case the domain gate refuses (it fails closed).
Late entries are checked at their event time, but a back-dated entry that clashes with later rows shows only in Flags.
