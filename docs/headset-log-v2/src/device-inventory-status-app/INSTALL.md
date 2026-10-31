# Install the status page

Draft, not deployed. It ships switched off. Install it in its own Apps Script project, never in the ledger's project: the ledger project can write, this one can only read.

## What it does

- Shows each site's labs with their serials, the headsets held outside a lab, the sheet's flags, and the setup steps.
- Anyone signed in on the organization account sees the sites whose sheet their own Google account can open. There is no member list to keep. Google's file sharing is the only access list.
- **Add an update** opens the site's Google Form. The Form keeps the append-only and hold rules, and records who submitted. Whoever the Form is shared with may add updates.
- It reads the saved Current, Progress and Flags tabs. It recalculates nothing and writes nothing.

## Steps

1. In Apps Script, create a **new** project. Do not open the ledger's project.
2. Open `Code.gs`, delete the starter code, rename the file `Status`, paste `Status.gs`.
3. Choose **+ > HTML**, name it `Status`, paste `Status.html`.
4. Open **Project Settings** and tick **Show appsscript.json manifest file in editor**. Return to the editor, open `appsscript.json` and paste the file from this folder. It asks only for read-only sheets and the user's email.
5. In **Project Settings > Script Properties**, add `statusConfig` with this shape, using your real values only inside Google:

   ```json
   {"version": 1, "sites": [{"key": "site-a", "label": "Site A", "spreadsheetId": "<sheet id>", "links": {"form": "https://forms.gle/<form>", "folder": "https://drive.google.com/drive/folders/<folder>"}}]}
   ```

   `links` is optional. Unknown keys, duplicate keys and links outside docs.google.com, drive.google.com and forms.gle are rejected.
6. In Google Drive, share each site's sheet with the staff who should see it, as **Viewer**. Share the Form with the staff who may add updates.
7. Leave `statusEnabled` absent. Test with **Deploy > Test deployments**. The page refuses to run while it is off.
8. After the checks below pass, add the Script Property `statusEnabled` = `true`, and deploy: **Deploy > New deployment > Web app**, **Execute as: User accessing the web app**, **Who has access: Anyone within your domain**. Copy the `/exec` link into the launcher's Status page field.

## Check on real Google before enabling

| Case | Expect |
|---|---|
| Admin with sheet access | Sees every section |
| Non-admin with the sheet shared as Viewer | Sees every section and the Add an update button |
| Same domain, sheet not shared | "No sites you can open" and no reason |
| Outside the domain, or signed out | Google refuses before any code runs |
| `statusEnabled` absent | The page refuses |
| Submit an update through the Form, then Refresh | The view changes after the ledger saves its views. If it doesn't, the saved views are stale: the page says freshness is unknown |
| A serial or note containing `<b>` | Shown as text |
| Mobile and desktop widths | Readable, no sideways scroll except tables |
| Ledger project | No new triggers, no changes |

If the sign-in shows a blank email for a domain user, stop: the page fails closed on purpose.
