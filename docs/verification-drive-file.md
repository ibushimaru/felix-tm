# Felix TM — drive.file authorization verification

The `drive.file` migration depends on Google's per-file scope semantics
working as documented: the OAuth token only allows access to spreadsheets
the user explicitly granted via the Google Picker (or that the app
itself created). This document is the test plan that proves the
behavior end-to-end before submitting to OAuth verification.

## Prerequisites

Cloud Console (project `429083959906`):

1. **OAuth consent screen** → Scopes — confirm `drive.file` and
   `userinfo.email` are listed; remove `spreadsheets` if still present.
2. **APIs & Services → Library** — enable Google Picker API, Drive
   API, Sheets API.
3. **Credentials → API keys** — create one restricted to the
   extension's origin: `chrome-extension://<EXTENSION_ID>/*`. Paste it
   into `picker.js` `PICKER_API_KEY`.
4. **Credentials → OAuth 2.0 Client IDs** — confirm the existing
   Chrome App client (`429083959906-…`) lists the unpacked extension's
   ID. Add new IDs for any reviewer / tester loads.

Local:

- Build the extension: `python3 scripts/build_extension.py`.
- Load the unpacked tree at `dist/felix-tm-v0.1.0/` via
  `chrome://extensions/` (Developer mode on).
- Note the resulting Extension ID and confirm it matches the OAuth
  client config above.

## Test 1 — Sign-in flow

1. Open the side panel → Settings tab.
2. Status reads "Not signed in". Click **Sign in with Google**.
3. Chrome OAuth consent screen appears. Verify:
   - The requested scopes are **only**
     `https://www.googleapis.com/auth/drive.file` and
     `https://www.googleapis.com/auth/userinfo.email` (no `spreadsheets`).
   - The consent screen says "Felix TM has access to files you've
     opened or created with this app" (Google's drive.file boilerplate).
4. Approve. Status changes to "Signed in as <email>".
5. Sign out, sign back in. Status round-trips correctly.

## Test 2 — Picker authorization

1. Signed in. Open a Google Sheet (call it Sheet A).
2. Side panel → Settings → **Pick another sheet…**.
3. Picker popup appears. Verify:
   - Only spreadsheets are listed (no Docs, Slides, etc.).
   - Picking Sheet A returns it in the Connected sheets list.
4. Open another Sheet (Sheet B), do not pick it.
5. Connected sheets list still shows only Sheet A.

## Test 3 — Scope-limit proof (NDA load-bearing test)

This is the test that verifies Google's drive.file enforcement
actually works as advertised — the foundation of the NDA argument.

1. From Test 2, Sheet A is authorized; Sheet B is not.
2. Open the Service Worker DevTools (`chrome://extensions` → Felix TM
   → "Service worker" link).
3. In the console, run:

   ```js
   chrome.identity.getAuthToken({ interactive: false }, async (token) => {
     // Try to read a cell from Sheet B (NOT authorized via Picker).
     const SHEET_B_ID = 'PASTE_THE_SPREADSHEET_ID_FROM_THE_URL';
     const r = await fetch(
       `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_B_ID}/values/A1`,
       { headers: { 'Authorization': 'Bearer ' + token } },
     );
     console.log('Status:', r.status, await r.text());
   });
   ```

4. **Expected:** `Status: 403` with an error message about insufficient
   permissions / file not granted access.
5. **If 200 OK:** Google's drive.file enforcement is broken or
   misconfigured. Stop and re-check Cloud Console scope.

## Test 4 — Cell write features through the gate

1. Signed in, Sheet A authorized.
2. Cell write paths exercised:
   - **Set**: select a row, click "Set" — adds source/target to TM. ✓
   - **writeToTarget**: click a TM match card — inserts into target. ✓
   - **Auto Translate (↓ Fuzzy)**: walks down filling 100% matches. ✓
   - **Auto Translate Selection (↓ 範囲)**: bulk-fill selected range. ✓
   - **Undo (↩)**: reverts the last write. ✓
3. On Sheet B (not authorized), try the same actions:
   - In-page banner appears: "このスプレッドシートへのアクセス権が
     ありません。…"
   - Click "このシートを許可" → Picker → pick Sheet B → action
     re-runs and succeeds.

## Test 5 — Side panel "Import from Sheet"

1. TM tab → set source/target ranges → click **Import from Sheet**.
2. On Sheet A (authorized): rows imported, toast confirms count.
3. On Sheet B (not authorized): toast says "Felix doesn't have access…
   Opening Picker" → Picker → pick Sheet B → re-run import succeeds.

## Test 6 — Connected sheets list + revoke

1. Settings tab → Connected sheets shows Sheets A and B.
2. Click **Revoke** next to Sheet A.
3. List updates immediately; Sheet A entry is gone.
4. Try **Set** on Sheet A — banner reappears (gate re-armed).

## Test 7 — Service worker restart resilience

1. With Sheets A + B authorized, force the SW to reload:
   `chrome://extensions/` → Felix TM → "Service worker" → click the
   Stop button (or wait ~30s of idle).
2. Click an action that needs the gate. The first read of
   `_authorizedSpreadsheets` lazily reloads from IndexedDB; the
   gate should still find both sheets and let the request through
   without re-prompting.

## Test 8 — Existing v0.1.0 install upgrade

1. Install v0.1.0 first (with old `spreadsheets` scope), add some
   TM/glossary/rules data.
2. Replace with the new build.
3. Confirm:
   - DB upgraded (DevTools → Application → IndexedDB → FelixTM:
     version 3, `authorized_files` store exists, empty).
   - tm/glossary/rules data still present (no loss).
   - Old OAuth token is automatically invalidated by the scope change;
     first sign-in shows the new consent screen.

---

All eight pass → submit OAuth verification + Web Store listing.
