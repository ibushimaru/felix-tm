# Felix TM — OAuth Scope Justification

This document is intended to be pasted (or adapted) into the Google OAuth
consent screen "Justification for sensitive scopes" / "Justification for
restricted scopes" fields when submitting Felix TM for verification.

---

## Application overview

**Felix TM** is a Chrome extension that provides translation memory (TM)
and glossary lookup for professional translators working in Google Sheets.
The translator opens a spreadsheet whose source-language column contains
strings to translate (a typical row-per-segment workflow used in software
localization, game UI translation, terminology lists, etc.). As the
translator moves between cells, Felix TM:

1. Reads the active row's source cell.
2. Matches it against the translator's private translation memory
   (stored locally in IndexedDB).
3. Displays fuzzy matches in a side panel.
4. On the translator's explicit click, writes the chosen translation
   into the target column.

This is the same workflow as desktop CAT tools (memoQ, Trados, OmegaT),
but inside Google Sheets — translators choose Sheets because their
source files arrive there.

---

## Requested scopes

| Scope | Sensitivity | Why needed |
|---|---|---|
| `https://www.googleapis.com/auth/spreadsheets` | **Restricted** | Read source-language cells and write target-language cells in the spreadsheet the user has open. |

This is the **only** scope Felix TM requests. We do not request
`userinfo.email` or any other identity scope — the side panel shows
only a binary "signed in / not signed in" state and does not display
or store the user's email address.

---

## Why `spreadsheets` (not a narrower alternative)

### Why not `drive.file`

`drive.file` is the most obvious narrower alternative. It allows access
only to files the app creates or that the user explicitly opens via the
Google Picker. We initially built Felix TM around this scope, but had to
abandon it for two structural reasons:

1. **The Google Picker requires loading remote JavaScript from
   `apis.google.com/js/api.js`, which Manifest V3 forbids inside an
   extension.** This is a published Chrome platform restriction
   ([Manifest V3 — Remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security#remove-remote-code))
   that Picker has not been retrofitted to satisfy. Workarounds (hosting
   Picker on an external https origin and proxying messages back through
   `externally_connectable`) introduce a second domain dependency and
   significantly degrade the sign-in UX, with no security benefit since
   Sheets data still flows through the same browser tab.

2. **Picker imposes a per-file consent click before any read or write
   can happen.** Translators handle dozens of source files per week, and
   Felix TM's value proposition is real-time matching as the translator
   navigates between cells. Forcing a Picker dialog every time the
   translator opens a new sheet — for a tool whose entire job is
   immediate response — eliminates the workflow advantage.

### Why not the JavaScript Sheets app extension API

Chrome extensions for `docs.google.com/spreadsheets` cannot read or write
arbitrary cells through the public DOM (Sheets renders via a canvas-like
custom drawing layer). The only supported way to read source cells and
write target cells programmatically is the Sheets REST API, which
requires an OAuth token with `spreadsheets` scope.

### Why `spreadsheets` is the right size

The `spreadsheets` scope grants exactly what Felix TM needs and nothing
more: read and write of the spreadsheets the user has signed in to.
Felix TM only issues an API call when the user takes an explicit action
in the side panel (Auto Translate, Import from Sheet, Set, etc.); it
never enumerates the user's Drive, never lists other spreadsheets, and
never reads in the background.

---

## Limited Use compliance

Felix TM's use of data obtained via the `spreadsheets` scope adheres to
the **Limited Use** requirements of the Google API Services User Data
Policy:

- **Data is used only to provide the user-facing translation-memory
  features.** Spreadsheet content is matched against the user's local TM
  and shown in the same browser tab. Nothing is sent to any server we
  operate. Felix TM has no backend.
- **No data transfer to third parties.** Felix TM has no analytics, no
  third-party SDKs, no remote logging, no telemetry. The only network
  destinations are `sheets.googleapis.com` and `oauth2.googleapis.com`
  — both Google endpoints, called directly from the user's browser.
- **No human review of user data.** Spreadsheet content never reaches a
  human operator at Veriscio.
- **No advertising use.** Felix TM displays no ads.
- **No AI/ML training.** Matching is performed by deterministic
  algorithms (Levenshtein edit distance, bag distance, token-based
  glossary placement) running locally in the browser. No data is used
  to train, fine-tune, or improve generalized AI/ML models.

---

## Where data is stored

| Data | Storage | Lifetime |
|---|---|---|
| Translation memory entries | Browser IndexedDB | Until user deletes |
| Glossary terms | Browser IndexedDB | Until user deletes |
| Placement rules | Browser IndexedDB | Until user deletes |
| User settings (column letters, threshold) | Browser IndexedDB | Until user deletes |
| OAuth token | `chrome.identity` cache (managed by Chrome) | Until user signs out / Chrome evicts |
| Spreadsheet cell values | Transient, in-memory during matching only | Discarded after each match |

**No data persists outside the user's browser.** Veriscio does not
operate any server that receives Felix TM data.

---

## Verification reviewer access

To evaluate Felix TM, a Google reviewer can:

1. Install Felix TM from the unverified test build (zip provided in
   submission attachments) by enabling Chrome Developer Mode and
   loading the unpacked extension.
2. Open any Google Sheets document.
3. Click the Felix TM side-panel icon.
4. Click "Sign in with Google" in the side panel — the consent screen
   will appear, requesting only the `spreadsheets` scope.
5. Move the active cell among rows in the sheet — fuzzy matches against
   any sample TM data the reviewer imports will appear in real time.
6. Use the "Set" or "Auto Translate" buttons to write a chosen
   translation into the adjacent target cell — this exercises the
   `spreadsheets` write path.

A 2-minute demo video showing the same flow is linked in the submission.

---

## Contact

ibushimaru@veriscio.com — for any reviewer follow-up.
