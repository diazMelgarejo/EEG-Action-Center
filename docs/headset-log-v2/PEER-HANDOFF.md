# Peer handoff: what changed, why, and what to do next time

For the reviewing agent, Perplexity (GPT-6.1 Sol Thinking Medium), which gave the operator patches for the live Apps Script project. The operator made those edits; the agent had no connector to the script. An earlier version of this file wrongly said the agent edited the script itself. Nothing here is blame. Each decision has a reason, and each reason is something you can reuse.

## 1. The three rules that decided everything

1. **Python is the source of truth.** `device_inventory_ledger.py` and `tip_proposals.py` come first, then `Rules.gs` and `Tips.gs`, then `SYNC.md`, then `parity_check.py`. An edit made only in the live script has no twin, so the next sync silently deletes it or lets the two languages disagree.
2. **A failing test comes before the fix.** Every fix below started as a red test in both languages.
3. **The public repo holds the app layer only.** No serials, lab assignments, names, domain, lab count, time zone, sheet ids or links. Fixtures are invented.

## 2. Your edits, one by one

| Your edit | Verdict | Why |
|---|---|---|
| `seedLedger` reads `getDisplayValues()` | **Same idea already in the repo, taken further** | The repo also writes the Seed tab as plain text in one block and passes the table straight to `seedFromTable_`, so nothing is read back from a sheet that may reinterpret it. |
| `parseTimeText` / `parseDateText` convert a `Date` | **Not adopted. Replaced by a loud refusal** | See section 3. |
| `rowsFromSeed` collapses spacing before comparing Date&Time | **Adopted** (`singleSpaced_`, and `" ".join(x.split())` in Python) | Same cause you found: the app writes two spaces, the sheet shows one. |
| `rowsFromSeed` lets a blank Date&Time pass (`if (actual && ...)`) | **Not adopted. Operator ruled: reject a blank** | It loosened a rule that Python enforces, so the two languages would disagree. A test in each language now pins the ruling. |
| `runInitialConfiguration` hard-codes the domain, a time zone and a lab count | **Kept out of the repo** | Company values never go in the public layer. Keep it in the private script. |

Your claim that the Ledger's Date&Time column is a live formula is true. `tests/code.test.js` asserts `=IF(COUNT(A2:B2)=2,SUM(A2:B2),"")`. That claim was checked against the source before it was relied on.

## 3. Why a `Date` is refused, not converted

Sheets stores a time-only cell as a day fraction on a 1899 base date. Apps Script hands it back as a `Date`. Reading `getHours()` on it looks right when the script zone and the spreadsheet zone happen to match, and breaks when they do not. Two further problems:

- The 1899 base date carries historical zone offsets, so minutes and seconds can shift.
- The project rule is that sheets stay in local time and code never changes a sheet's zone, while the script runs in UTC. A fix that depends on both zones agreeing quietly couples them.

So `parse_time_text` and `parseTimeText` now raise "Time arrived as a time value, not text; read the displayed text of the cell.", and the date versions say the same for dates. The error names the cause instead of printing an 1899 timestamp. Python and JavaScript behave the same, and there is one test in each.

The fix for the cause is upstream: read `getDisplayValues()`, or write the cell with the text format `@`.

## 4. The bug you did not report, found while merging

A headset can be the latest row of one lab and have moved to another lab later. Proposing that lab's row as its tip produced two "latest" rows for one serial. `proposeTips` now checks the serial's own latest row first. Test T32 in `docs/pilot-plan.md` covers it.

## 5. How to make an edit next time

1. Reproduce it with a fake Google that behaves like Google (a Seed tab that turns text times into values). A fake that never converts text hides this class of bug.
2. Write the failing test in Python, then in JavaScript.
3. Fix Python, then JavaScript. Add a row to `SYNC.md`.
4. Run the tests, `parity_check.py`, and the privacy scanner on the exact files you will push.
5. Only then paste into the live script. Never the other way round.

## 6. Why the privacy rules exist, with sources

The rules are not decoration. Each one answers a documented way that data leaks.

**Removing names does not make data anonymous.** A handful of ordinary attributes, taken together, point to one person. Sweeney showed that three fields (place, gender, date of birth) were likely unique for 87% of the US population in one count and 53% in another. Narayanan and Shmatikov re-identified Netflix subscribers from a few dated ratings plus public background knowledge, and showed that dates alone carry a lot of identifying power. A log of who held which device on which day is exactly that kind of data, so serials, dates and lab assignments are kept out of the public layer even though no name appears.
- Sweeney, L. (2000). *Simple Demographics Often Identify People Uniquely.* https://dataprivacylab.org/projects/identifiability/paper1.pdf
- Narayanan, A. and Shmatikov, V. (2008). *Robust De-anonymization of Large Sparse Datasets.* IEEE S&P. https://www.cs.cornell.edu/~shmat/shmat_oak08netflix.pdf

**Identifiable information needs protection by context.** NIST SP 800-122 says PII must be identified first, then protected at a level that matches the harm from disclosure. It also covers de-identification and response plans for incidents. That is the reasoning behind the scanner and the private blocklist.
- NIST SP 800-122 (2010). https://csrc.nist.gov/pubs/sp/800/122/final

**OPSEC treats scattered facts as one risk.** NIST defines operations security as identifying critical information, analyzing threats and vulnerabilities, assessing risk, then applying countermeasures, because unclassified details can be pieced together. That is why a clean scan is never treated as proof, and why the blocklist stores hashes only.
- NIST CSRC glossary, "operations security". https://csrc.nist.gov/glossary/term/operations_security

**Published history cannot be fully taken back.** GitHub's own guidance says rewriting history and force-pushing may leave the sensitive commits reachable in forks, cached views and by commit SHA, and tells you to contact support to purge them. So the rule is to keep private data out in the first place. A force-push is a cleanup tool, not a safeguard, and it is not run without the operator's approval.
- GitHub Docs, *Removing sensitive data from a repository.* https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

Your own national data-protection law also applies to staff data. Name it in the private companion note, not here, because the jurisdiction is itself a fact the public layer does not state.

## 7. Where the rules are best expressed in our repositories

| Rule | Where to read it |
|---|---|
| A scanner that fails closed, with a hashed blocklist and generic rules for paths, tokens and file links | [`src/check_public_safe.py`](https://github.com/diazMelgarejo/EEG-Action-Center/blob/d78528aa3743a42ccc23b5983d04f40a2c876dca/docs/headset-log-v2/src/check_public_safe.py) and its tests [`src/test_check_public_safe.py`](https://github.com/diazMelgarejo/EEG-Action-Center/blob/d78528aa3743a42ccc23b5983d04f40a2c876dca/docs/headset-log-v2/src/test_check_public_safe.py) |
| The operating rules, including the precaution against adding functions that hold a domain, lab count or time zone to the pasted files | [`HANDOFF.md`](https://github.com/diazMelgarejo/EEG-Action-Center/blob/d78528aa3743a42ccc23b5983d04f40a2c876dca/docs/headset-log-v2/HANDOFF.md), section 10 |
| Python and JavaScript kept in step, one name map | [`SYNC.md`](https://github.com/diazMelgarejo/EEG-Action-Center/blob/d78528aa3743a42ccc23b5983d04f40a2c876dca/docs/headset-log-v2/src/device-inventory-apps-script-draft/SYNC.md) |
| The portable-memory invariant: tracked rules name categories only, never the concrete forbidden value, and superseding is not sanitizing | [`orama-system` docs/v2/47](https://github.com/diazMelgarejo/orama-system/blob/main/docs/v2/47-portable-memory-local-topology-invariant.md) |
| No workstation paths in tracked files | [`orama-system` .cursor/rules/no-workstation-paths.mdc](https://github.com/diazMelgarejo/orama-system/blob/main/.cursor/rules/no-workstation-paths.mdc) |
| Lessons learned from earlier leaks and near-misses | [`orama-system` docs/LESSONS.md](https://github.com/diazMelgarejo/orama-system/blob/main/docs/LESSONS.md) |

## 8. Rulings made while merging

- A blank Date&Time on the Seed tab is rejected when Date and Time are given (operator, 2026-10-31).
- The place name that the blocklist flagged on the `site` branch was replaced with a neutral example (operator, 2026-10-31).

## 9. Your review of the frontend, and what changed

You accepted this handoff and reviewed the `site` branch. Each frontend finding was checked at source and held. All were fixed on `site`, plus one that neither review caught.

| Finding | Fix on `site` |
|---|---|
| A literal count in the dashboard matched the real lab count. No scan caught it, and your review listed the line without treating it as a leak | The tile grid is gone. The scanner gained a generic `lab count` rule, because a number that short cannot live in a hash list |
| The token was decoded, never verified, and the page reported "Authenticated" | Sign-in is removed. A static page has no server to verify a token, so it protected nothing. Google enforces access on every linked file. Add sign-in back only with a real backend |
| Progress and occupancy were hard-coded and shown as live facts | Both now read "Not connected" and point to the private sheet |
| Site links persisted in `localStorage` | Links stay in memory for the visit, and the old saved key is erased on load |
| Setup sat behind sign-in, with a sample client ID as fallback | Setup is reachable at once, and the client ID is gone |
| `#gid=Review` was invented | The Review link is its own optional field. It stays disabled until set |
| `site` still carried `docs/` | Removed from `site`. The bundle stays on this branch, and the older docs stay on `main` |

Two additions came from the same review: links must be `https` on Google's own hosts, and the page sets a strict content security policy.
