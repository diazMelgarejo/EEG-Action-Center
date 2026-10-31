# Live status page: design, deferred

**Status: design only. Nothing here is built.** The launcher on the `site` branch stays as it is until the gates in section 6 are met. This file exists so the next step is decided on evidence, not improvised.

## 1. The problem

The public launcher shows no live state. People want to see lab occupancy and setup progress without opening the ledger. That state is private, so any page that shows it must check who is asking, on a server the organization controls.

A static page on GitHub Pages cannot do that. It has no server. It can decode a token but it cannot verify one, and the earlier version pretended otherwise.

## 2. What Google requires of a server that trusts an ID token

From Google's guide, *Verify the Google ID token on your server side* (checked 2026-10-31):

1. The signature is valid against Google's public keys, which rotate. Re-fetch when the response's `Cache-Control` says so.
2. `aud` equals one of your own client IDs. Without this, a token issued to another app is accepted.
3. `iss` is `accounts.google.com` or `https://accounts.google.com`.
4. `exp` has not passed.
5. For a Workspace-only resource, check the `hd` claim. The domain of the email is not enough.
6. Key the user on `sub`, not on email. Email can change.

Google calls the `tokeninfo` endpoint a tool for development and debugging, and recommends a client library or a general JWT library in production.

## 3. Three options

| | A. Page on GitHub Pages calls an "execute as me" web app with the token | B. The status page is the Apps Script web app itself, "execute as user accessing" | C. Keep the launcher, show nothing live |
|---|---|---|---|
| Who proves identity | Our code, by verifying the token | Google, before our code runs | Nobody. There is nothing to protect |
| Token verification code to write and trust | Yes, all six checks | **None** | None |
| Needs a third-party RSA or JWT library inside the private script | **Probably.** I found no built-in RSA signature check in the Apps Script references I read. Confirm before relying on that | No | No |
| Cross-origin call from the public page | Required. Anecdotal reports say it works for anonymous deployments with a `text/plain` POST. Not documented by Google, so it must be tested | **Not needed.** The public page only links to the web app | Not needed |
| Identity available to the script | From the token | `Session.getActiveUser().getEmail()` for users in the same Workspace domain. Blank under "execute as me" per Google's reference | n/a |
| Sheet access | Script's owner, for everyone. A bug leaks to anyone who passes the check | **The user's own.** Google enforces sheet access on top of our admin check | n/a |
| Where the code lives | Public page plus private script | Private script only. The launcher just links | Public page |

**Recommendation: B.** It deletes the hardest and riskiest piece, the token verification, because Google does it before our code runs. It also keeps least privilege: the page reads the sheet as the person looking at it. The cost is that the status page lives on Google's host, not on GitHub Pages, so the launcher becomes a front door that links to it. That also fits the rule that private state never touches the public layer.

Choose A only if the operator needs the status inside the GitHub Pages page itself. Then add the token checks, vendor one pinned and reviewed JWT library, and test the cross-origin call first.

## 4. Shape of option B

```text
GitHub Pages (public)            Apps Script web app (private, same bundle)
  launcher, no data   --link-->    doGet(e)
                                     1. who: Session.getActiveUser().getEmail()
                                        blank -> "Sign in on the organization domain"
                                     2. allowed: on this file's admin or reader list? else a plain refusal
                                     3. state: the existing Rules.gs functions over the Ledger
                                     4. render: read-only HTML, no write path
```

- **No new rules.** Occupancy comes from the functions that already derive it from each headset's latest movement. A third copy of the rules in a page would drift.
- **Read only.** `doGet` only. Every write still goes through the Form and its submit trigger, which already has the append-only and hold rules.
- **Unknown stays unknown.** A missing tab, an empty ledger or an unreadable range shows "Unknown", never an invented empty room.
- **Nothing company-specific in code.** The domain, lab count and time zone come from the file's own settings, as they do today. The page shows labs that exist in that configuration.
- **Escaping.** Every value rendered from a sheet is escaped as text. A serial or note cannot become markup.
- **Plain refusal.** The refusal says nothing about whether an account exists or what the page would have shown.

## 5. Risks and what would test them

| Risk | Test before relying on it |
|---|---|
| `getActiveUser().getEmail()` is blank for some users | Open the page as an admin, a reader, an outsider and a signed-out browser. Record each result |
| Workspace policy blocks web apps or the consent screen | Try it on a throwaway copy under the real domain |
| Rate limits on new users authorizing a web app that runs as the user | Add several real users on the copy and note the limit |
| A reader without sheet access sees an error, not the refusal | Test it and make the message uniform |
| Rendering breaks on an odd serial or note | Unit-test the renderer with a fake Google, including script-like text |
| Copied files carry the page along | The existing rule already applies: a copy starts unconfigured |

## 6. Gates before any of this is built

Proposed. The operator decides.

1. All 32 pilot tests in `docs/pilot-plan.md` pass on a throwaway copy on real Google, not only the fakes.
2. The v5 Apps Script files have run on the real file for a full working week with no held entries left unexplained.
3. The launcher is deployed on GitHub Pages and checked once in a real browser.
4. The history rewrite of `site` has landed and a fresh clone scans clean.

Then build option B test-first: a fake `Session` and Sheets, the renderer tested in plain Node, Python first for any new rule (there should be none), a new row in `SYNC.md`, and a new pilot test for each risk in section 5.

## 7. Not decided

- Whether readers who are not admins may see the page. This needs a ruling and a place to keep the reader list.
- Whether serials appear on the page or only lab status. A page is easier to share by accident than a sheet is.
