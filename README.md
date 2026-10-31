# EEG Action Center — Frontend Console

Minimal, forkable operational dashboard for EEG equipment inventory and headset logistics.

## Architecture

- **Public Frontend Layer (GitHub Pages):** Pure client-side static site (HTML, CSS, Vanilla JS) with zero proprietary company data, zero hardcoded sheet IDs, and zero private links.
- **Private Data Layer (Google Drive / Sheets / Forms):** All proprietary headset serials, movement history, and site settings stay entirely inside organization-owned Google accounts.

## Features

- **Google Workspace Sign-In:** Authenticates users via Google Identity Services (`google.accounts.id`).
- **Dynamic Site Links:** Operators configure their private Master Google Sheet, Google Form, and Google Drive folder links at runtime in the browser. Links are persisted in local browser storage (`localStorage`) and never committed to GitHub.
- **Visual Progress & Lab Grid:** Displays the verified 9-stage setup progress checklist and room-by-room headset occupancy status.
- **Pearl and Ivory Theme:** High-contrast, clean visual design matching the hardware changes operations system.

## Setup & Deployment

1. **Deploy via GitHub Pages:**
   - In your repository, go to **Settings** → **Pages**.
   - Under **Build and deployment**, select **Source:** `Deploy from a branch`.
   - Choose the branch `site` and folder `/ (root)`.
   - Click **Save**.

2. **Configure Your Site Links:**
   - Open your deployed GitHub Pages URL.
   - Click **Configure Site Links**.
   - Paste your private Master Google Sheet URL, Google Form URL, and Drive Folder URL.
   - Click **Save Configuration**.
