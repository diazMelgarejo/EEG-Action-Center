# EEG Action Center — Frontend Console

Minimal, forkable operational dashboard for EEG equipment inventory and headset logistics.

## Architecture

- **Public Frontend Layer (GitHub Pages):** Pure client-side static site (HTML, CSS, Vanilla JS) with zero proprietary company data, zero hardcoded sheet IDs, and zero private links.
- **Private Data Layer (Google Drive / Sheets / Forms):** All proprietary headset serials, movement history, and site settings stay entirely inside organization-owned Google accounts.

This site is not an access boundary. It has no server, so it cannot verify anyone. Google enforces access on every linked file.

## Features

- **Site Links for the Visit:** Paste your private Sheet, Form, Review tab and Drive links at runtime. They stay in memory for that tab and are never saved or committed. An old copy saved by an earlier version is erased on load.
- **Honest State:** Setup progress and lab occupancy read "Not connected". This page has no live data, so it never shows a status it cannot know.
- **Google Links Only:** A link must be `https` on `docs.google.com`, `drive.google.com` or `forms.gle`.
- **Strict Content Security Policy:** The page loads only its own script and stylesheet.
- **Pearl and Ivory Theme:** High-contrast, clean visual design matching the hardware changes operations system.

## Setup & Deployment

1. **Deploy via GitHub Pages:**
   - In your repository, go to **Settings** → **Pages**.
   - Under **Build and deployment**, select **Source:** `Deploy from a branch`.
   - Choose the branch `site` and folder `/ (root)`.
   - Click **Save**.

2. **Add Your Site Links:**
   - Open your deployed GitHub Pages URL.
   - Click **Add Site Links**.
   - Paste your private Google links and click **Use These Links**.
   - Repeat on each visit. Links are not kept.

## Tests

Run `node --test tests/frontend.test.js`.

## Where the Rest Lives

The headset log code and its handoff are on the `docs/headset-log-handoff-20261031` branch. The repair and playbook documents are on `main`.
