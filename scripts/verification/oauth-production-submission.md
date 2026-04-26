# OAuth Consent Screen — Move to Production & Submit Verification

This is the user-action walkthrough for moving the Felix TM OAuth
consent screen from **Testing** to **In production** and triggering
Google's verification review.

**Cloud project:** `429083959906` (the project tied to the OAuth client
already in `manifest.json`).

## Prerequisites (must be in place before this step)

- [x] Privacy policy live at `https://ibushimaru.github.io/felix-tm/privacy/`
- [x] Homepage live at `https://ibushimaru.github.io/felix-tm/`
- [x] GitHub Pages enabled (see `github-pages-setup.md`)
- [ ] Demo video uploaded as Unlisted to YouTube; URL saved
- [x] `manifest.json` scope is `spreadsheets` + `userinfo.email` (no `drive.file`)
- [x] `scope-justification.md` ready to paste
- [x] `casa-tier2-draft.md` ready to paste

## Step-by-step

### 1. Open the consent screen settings

<https://console.cloud.google.com/apis/credentials/consent?project=felix-tm>
(or whichever project name `429083959906` resolves to in your account).

### 2. Verify "OAuth consent screen" Edit App fields

Click **Edit App** and confirm:

| Field | Value |
|---|---|
| App name | **Felix TM** |
| User support email | **ibushimaru@veriscio.com** |
| App logo | Upload `plugins/chrome-extension/icons/icon128.png` (Google needs ≥120×120 PNG, square) |
| Application home page | `https://ibushimaru.github.io/felix-tm/` |
| Application privacy policy link | `https://ibushimaru.github.io/felix-tm/privacy/` |
| Application terms of service link | (leave blank or use privacy URL) |
| Authorized domains | `ibushimaru.github.io` |
| Developer contact information | `ibushimaru@veriscio.com` |

Click **Save and continue**.

### 3. Verify scopes

In **Scopes**, ensure exactly these two are listed:

- `https://www.googleapis.com/auth/spreadsheets` (Restricted)
- `https://www.googleapis.com/auth/userinfo.email`

Remove any others (especially `drive.file` if it's still there from the
earlier Picker experiment). Save.

### 4. Verify test users (will be ignored after publish)

Listed test users can stay; they only matter while the app is in
Testing.

### 5. Publish to Production

Back on the consent screen overview, click **Publish App** under the
**Publishing status: Testing** banner. Confirm.

Status moves to **In production — Verification required** because
`spreadsheets` is a Restricted scope.

### 6. Submit verification

A **Submit for verification** button appears. Click it. Google then
shows a multi-section form:

1. **Application home page** — paste `https://ibushimaru.github.io/felix-tm/`
2. **Privacy policy URL** — paste `https://ibushimaru.github.io/felix-tm/privacy/`
3. **Authorized domains** — confirm `ibushimaru.github.io`
4. **Demo video URL** — paste the YouTube unlisted URL
5. **Justification for sensitive scopes** — paste the relevant section from `scope-justification.md`
6. **Justification for restricted scopes** — paste the same plus the Limited Use attestation from the privacy policy
7. **CASA assessment** — when prompted, follow the link to start the Tier 2 self-assessment, paste answers from `casa-tier2-draft.md`, obtain the Letter of Validation, and attach it here

Submit.

### 7. Wait

Initial Google response: **3–5 business days** for first feedback.
Total verification time: **4–8 weeks** typically. Expect 1–2 rounds of
clarifying questions.

While waiting:

- Do **not** make scope changes — every change resets the review clock.
- Do **not** rename the app — same.
- You **can** keep iterating on the extension code (matching, UI, bugs)
  as long as the manifest scopes stay the same.

### 8. After approval

Google sends an email with the approval. The "Verification needed"
banner disappears from the consent screen. Users will see "Felix TM"
in the consent flow without the "Google hasn't verified this app"
warning.

Then move on to Chrome Web Store submission (separate process — see
`web-store-listing.md`).

---

## Common reject reasons & avoidance

| Reject reason | Avoidance (already done) |
|---|---|
| Privacy policy is generic / doesn't mention specific scopes | Our policy enumerates both scopes by name and the data each handles |
| Homepage looks parked or unrelated to the app | Our homepage describes the actual product with screenshots, links to the policy and source |
| Demo video doesn't show the consent screen URL bar | Scene 3 of the script explicitly captures `accounts.google.com` |
| Demo video doesn't show the requested scope being used | Scenes 4–5 demonstrate read and write under the spreadsheets scope |
| App name on consent screen ≠ app name on Web Store | Brand checklist enforces "Felix TM" everywhere |
| Restricted scope used for unrelated functionality | Our scope justification explains the single, specific use |
| Email contact bounces | Verify ibushimaru@veriscio.com accepts mail before submitting |

---

## What "minor changes" trigger re-verification

After approval, these need re-verification:

- Adding any scope.
- Changing the app name.
- Changing the privacy policy URL or domain.
- Changing OAuth client ID.
- Material change to data handling (e.g., adding a backend that stores user data).

These do **not** trigger re-verification:

- Updating extension version.
- Bug fixes, UI changes, algorithm improvements.
- Removing scopes.
- Adding new test users (no longer relevant after publish).
