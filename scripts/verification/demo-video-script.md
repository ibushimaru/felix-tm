# Felix TM — OAuth Verification Demo Video Script

**Target length:** ≤ 2 minutes (Google's hard cap is "concise"; under 2 min is the safe target).
**Language:** English narration. UI may be in Japanese — narration explains.
**Resolution:** 1920×1080 minimum. Use a recent Chrome version on macOS or Windows.
**Recording tools:** Loom, OBS, QuickTime Screen Recording, or similar. Hosted unlisted on YouTube.

Google requires the demo to:
1. Show the OAuth consent screen with the actual scopes the user will see.
2. Show the requested scope being used for its claimed purpose.
3. Show the URL bar so reviewers can confirm the consent screen origin is `accounts.google.com`.

---

## Scene-by-scene script

### Scene 1 — Title card (0:00–0:05) [5 s]

**Visual:**
- Static slide: white background, centered text:
  - **Felix TM**
  - "Translation Memory for Google Sheets"
  - "OAuth Verification Demo"

**Narration:**
> Felix TM is a Chrome extension that brings translation memory into
> Google Sheets. This demo shows how it uses the spreadsheets OAuth
> scope.

---

### Scene 2 — Install + open Sheets (0:05–0:20) [15 s]

**Visual:**
- Show `chrome://extensions/` with Felix TM already installed (unpacked, dev mode).
- Click on a Google Sheets bookmark or paste a `https://docs.google.com/spreadsheets/...` URL.
- The spreadsheet loads with two columns: Column A (English source strings, ~10 sample rows from the deck-builder sample), Column B (empty target).
- Click the Felix TM extension icon in the toolbar — the side panel opens on the right.

**Narration:**
> A translator opens a Google Sheet whose left column contains source
> text and right column will hold translations. They open the Felix TM
> side panel.

---

### Scene 3 — Sign-in / consent screen (0:20–0:45) [25 s]

**Visual:**
- Side panel shows "Not signed in" with a "Sign in with Google" button.
- Click "Sign in with Google".
- Google's account chooser appears in a popup. Hover briefly so the URL bar shows `accounts.google.com`.
- Select the Google account.
- The OAuth consent screen appears, listing:
  - "Felix TM wants to access your Google Account"
  - **See, edit, create, and delete all your Google Sheets spreadsheets**
  - **Associate you with your personal info on Google**
- Slow scroll to make both scopes readable.
- Click "Continue" / "Allow".
- The popup closes, side panel updates to "Signed in as <email>".

**Narration:**
> Sign-in opens Google's standard consent screen. Felix TM requests two
> scopes: spreadsheets — to read source cells and write target cells —
> and userinfo email, so the side panel can show which account is
> connected. The consent dialog is served from accounts.google.com, as
> the URL bar shows. After granting, the side panel confirms the
> connected account.

---

### Scene 4 — Real-time fuzzy match (0:45–1:10) [25 s]

**Visual:**
- The user clicks a cell in column A (e.g., row 3, source: "Draw two cards.").
- The side panel immediately shows fuzzy matches from a pre-imported sample TM:
  - "Draw a card." — 75 % match — target "カードを 1 枚引く。"
  - "Draw three cards." — 80 % match — target "カードを 3 枚引く。"
- Move to row 5 ("Discard one card."). Side panel updates within ~1 second.

**Narration:**
> As the translator moves between cells, Felix TM uses the spreadsheets
> scope to read the source value of each active cell and matches it
> against a translation memory stored locally in the browser. Matches
> appear in real time. No data leaves the browser — matching runs
> entirely in IndexedDB.

---

### Scene 5 — Write back to target (1:10–1:30) [20 s]

**Visual:**
- With row 3 still active, click the "Set" button next to the 80 % match.
- The target cell B3 fills with "カードを 2 枚引く。" (numbers automatically adapted).
- Brief pause.
- Click "Auto Translate" button — applies 100 % matches across the
  selected range; 3 cells fill in column B.

**Narration:**
> The translator confirms a match — Felix TM writes the translation
> into the target cell using the same spreadsheets scope. Auto
> Translate applies 100 % matches across a selected range in one
> action. These are the only situations where Felix TM writes — every
> write is initiated by an explicit user click.

---

### Scene 6 — Sign out / data residency (1:30–1:50) [20 s]

**Visual:**
- Open the Settings tab in the side panel.
- Show the "Signed in as <email>" line + "Sign out" button.
- Click "Sign out". Side panel returns to "Not signed in".
- Open Chrome DevTools → Application → IndexedDB → FelixTM. Show the
  stores: `tm`, `glossary`, `rules`, `settings`. Briefly highlight an
  entry to show TM data lives here.

**Narration:**
> Sign-out revokes the OAuth token and clears it from Chrome's
> identity cache. The translator's TM stays in their browser's
> IndexedDB — Felix TM has no backend, so there is nothing to delete
> server-side.

---

### Scene 7 — Closing card (1:50–2:00) [10 s]

**Visual:**
- Static slide:
  - **Felix TM**
  - "github.com/ibushimaru/felix-tm"
  - "ibushimaru.github.io/felix-tm/privacy/"
  - "ibushimaru@veriscio.com"

**Narration:**
> Felix TM source code, privacy policy, and contact information are
> linked here. Thank you.

---

## Pre-recording checklist

- [ ] Browser zoom at 100 %. Window at 1920×1080 or larger.
- [ ] Chrome theme set to default light. No personal info visible in toolbar / bookmarks.
- [ ] Use a clean Chrome profile without other extensions visible.
- [ ] Pre-load a sample Google Sheet with the deck-builder source data in column A, column B empty.
- [ ] Pre-import the sample TM (`samples/sample-tm.tmx`) so matches are immediate.
- [ ] Pre-import the sample glossary so number placement demos work.
- [ ] Sign out of Felix TM before recording so the consent flow shows from cold.
- [ ] Clear `chrome.identity` cache: `chrome://identity-internals/` → revoke any cached Felix TM tokens.
- [ ] Practice the cell-clicking pace once before recording — too fast hides the real-time matching impact, too slow wastes seconds.
- [ ] Keep screen-recording cursor visible. Disable mouse-trail / fancy cursor effects.

## Post-recording

- [ ] Trim dead air at start/end.
- [ ] Verify total length ≤ 2:00.
- [ ] Verify URL bar showing `accounts.google.com` is legible at full-screen playback.
- [ ] Verify scope text on consent screen is legible.
- [ ] Upload to YouTube as **Unlisted**. Title: `Felix TM — OAuth Verification Demo`. Description: 1-line summary + link to homepage and privacy policy.
- [ ] Paste the YouTube URL into the verification submission.
