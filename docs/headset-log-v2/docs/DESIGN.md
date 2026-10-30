# Design: headset log

Provisional. Written 2026-10-31. Serial numbers in code and tests are fake.

## 1. Problem

Headset moves were recorded in four places with no precedence: a "Hardware changes" workbook tab, a weekly legend, tickets and a
private chat. Nothing enforced that a serial is in one place, times were often missing, movement hid in free-text Notes, "None" could not
say Spare or For repair, and there was no author or entry time. History had to be reconstructed, and reconstructions disagreed.
The cure is mostly at the moment of capture, not in a better database.

## 2. Rulings (decided by the operator)

| Topic | Ruling |
|---|---|
| One headset per lab | A lab holds one headset and must be emptied before another goes in. A lab always displays its last-known headset |
| Sources | Workbook first; chat only where the workbook is silent; where both speak and differ, show the workbook value and keep the chat value in Notes. Tickets and the legend carry equal weight, no winner: the operator decides |
| Who | Named people on Google accounts of the organization's domain; outsiders are asked to sign in to it first |
| None | Old rows keep Lab = None. New entries say Spare (default) or For repair. Cleansing and rotation are Spare with an optional pull-out reason |
| Old rows | Never touched. Clean slate: only the latest tip per lab and per serial is carried over; the old workbook stays an untouched archive |
| Parts | In Notes by default. An optional Part list only with specific names (electrode positions, drawstring, knob). No part records |
| Swap | Two rows, the same time, created automatically. One entry makes 1 or 2 rows |
| Destination | Required; "unknown" is never accepted. A displaced headset always gets a row |
| Mismatched pull-out | Pulling H out of a lab that does not show H creates an assignment of H one minute earlier (editable, never closer than a minute), the removal, and a row for the displaced headset: 3 rows, the one exception to the 2-row limit. Only this auto pair has the gap |
| Unknown time | A new entry with a blank date and time defaults to now, labelled `defaulted`; the operator may change it. Old data keeps unknown as blank |
| Retired | Terminal: set only by an explicit pull-out; never assigned again |
| Time | Saved app data is UTC only and is the only time the app reads. Sheets are always in the site's local time, set by a person; code never changes them. Every time is labelled |
| Layers | The public app and the private company data are separate |
| Schema | Hardware changes columns; Date and Time are inputs; Date&Time is derived and column C of any source is never read (its stored values are rounded, e.g. 08:00 reads back 07:59:59.712) |
| Languages | Python is the source; Apps Script JavaScript is its translation; both change together |
| Cost | Free or open source preferred; cheapest acceptable solution wins |

## 3. Model

A row means "serial arrives at place at time". Lab is `Lab N` or `None`; Holding says Spare, For repair or Retired where Lab is None.
Occupancy is derived from the latest arrival of each serial and is never typed. Rows are never edited: a correction is a new row naming
the row it replaces. Rules are checked at the event time, so a late entry is checked against the ledger as it stood then. A bad entry
goes to a Held tab with its reason and an email to the person; nothing is dropped. Sheet formula for Date&Time:
`=IF(COUNT(A2:B2)=2,SUM(A2:B2),"")`, the original `=SUM(A:B)` kept blank when an input is missing.

## 4. Options scanned (public sources; see `decision-matrix.xlsx`)

| Option | Shape | Notes |
|---|---|---|
| A. Google only | A1: Sheet ledger, Form entry, Apps Script validator. A2: swap the Form for an AppSheet entry app | Cheapest; no server; keeps time of day. Checks run after Submit; Sheet protection is not a security measure and the owner can edit anything |
| B. Grist | Ledger table, form entry, Python formulas | Free tier caps records per document; change history is short; Google login unread |
| C. Snipe-IT | Asset tracker with check-out and check-in | Strong history; import takes dates only (no time of day) and cannot load past events; you own hosting and patching |

Recommendation (the decision is the operator's): A, staged. A1 first because every piece was read from primary documentation; move to A2 only if
the pilot shows the after-the-fact check lets bad entries through. B is the fallback; C wins only if people assignment, tickets or QR labels become needs.
The scan was bounded: about 30 sources, a handful read as full pages, and AppSheet and Grist were under-read.

## 5. Pilot

One month, named people, the workbook carrying on in parallel, all current tips seeded (one headset per lab needs the whole fleet). Rehearse on a
throwaway Google copy first. Fifteen tests on real Google services are listed in `pilot-plan.md`. Acceptance is pass or fail with no invented
thresholds: no entry lost, replay through Python equals the Current tab, flags explained, every move in the old workbook also in the ledger or
listed, a physical check of every lab, and an independent review.

## 6. Limits

Checks run after Submit and the sender hears by email. An owner can edit the ledger. A back-dated entry that clashes with later rows shows only in
Flags. Everything about real Google behaviour is untested; the Google layer has only run against fakes. Most third-party comparison pages
were written by vendors and were used only for orientation. Prices and limits were read on 2026-10-31.

## 7. v2 additions

Real data enters only inside Google, after a domain check that fails closed: the script reads Date and Time from a copy of the workbook and the legend, proposes the latest tip per lab, and lists every
disagreement on a Review tab for the operator. An undecided item blocks seeding, a held item stays out, and a serial in two places is refused. The Progress tab draws a checklist, a bar and lab tiles from
facts in the file. The form shows its own progress bar. Work happens on copies, with an untouched BASE kept for a later 3-way comparison (`../HANDOFF.md`, section 5).

