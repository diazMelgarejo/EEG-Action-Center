# Review of the generated draft

Reviewed 2026-10-31 against our rulings. The draft was treated as untrusted input: unzipped into a fresh folder, read, never run or installed.
No secrets, no external calls and no downloads were found in its code.

## What held up

- **The rules engine.** `Rules.gs`, the Python reference and its tests are the same as ours; only the domain constant differs.
- **`rules.ts`.** The draft simulator's TypeScript engine had no parity test, so "faithful" was a claim. Tested against Python, it **passed** 28 scenarios and an archive replay.
  The simulator stays out of this public folder because it carried organization branding.

## What was wrong, and what v2 does

| # | Draft | Evidence | v2 |
|---|---|---|---|
| 1 | No way to load real data; the only seed was made up | `seed-data/` held made-up serials for fewer labs than its name claimed, and a promised `.json` was missing | Authenticated load from the live workbook into Review, with every disagreement left to the operator; the fake seed is gone |
| 2 | "Pilot tests T01 to T15" passed in the browser | They run the simulator, not Google. T12 passed on `length >= effective length` (always true). T14 passed with no check. T09 claimed to test the lock but only counted violations. T13 tested fewer labs than it claimed | The 22 real tests are in the pilot plan; a simulator result is never reported as one of them |
| 3 | "Production-ready" in the guide, the modal and `metadata.json` | Nothing has run on real Google | Removed. The README says what is unproven |
| 4 | Tabs "locked against unauthorized edits" | Google says sheet protection is not a security measure; the owner can edit anything | Said plainly; T12 and T21 in the pilot plan test the guard |
| 5 | Restricting the form to the domain was a manual step with no test | | Still manual (Forms has no current script setting), now T01 |
| 6 | Dependencies the app never used | `@google/genai`, `express`, `dotenv`, a Gemini capability flag; versions such as `typescript ^7.0.2` and `vite ^8.3.0` could not be verified | Unused ones removed. The rest are unverified; run `npm install` only after checking them |
| 7 | A button to download a zip that exists only on the draft's host | Dead link outside it | Removed |
| 8 | A third implementation of the rules to keep in sync | | Kept out of the deployable bundle |
| 9 | No progress indicator in Google | The "visual progress" lived only in the simulator | The Progress tab (checklist, bar, lab tiles) and the form's own progress bar |
| 10 | `Code.gs` at file load used constants from `Rules.gs` | Apps Script does not promise a load order | Lazy lookups; a test loads the files in several orders |
| 11 | `setup()` could not be run twice | It created tabs, a form and a trigger every time | Idempotent: existing tabs are left alone, one form, one trigger |
| 12 | No domain check on any interactive step | Only the form-submit path checked the email | `requireDomainUser_()` on setup, sources, load, seed and corrections; fails closed |
| 13 | Organization values were written in the code | The domain and lab count were constants | Settings, made with `configure()` and changed by admins; tests and `check_public_safe.py` fail if a value returns to code |

## Still open

- Everything real-Google (see the README). The first honest test is the rehearsal on a throwaway copy.
- `Session.getActiveUser().getEmail()` is documented to depend on account settings. If it comes back empty on your domain the gate will refuse everyone, which is safe but needs a different check.
- The tip proposals follow our rulings (workbook first, legend and tickets equal, operator decides). They were tested on made-up data, not on your workbook.
