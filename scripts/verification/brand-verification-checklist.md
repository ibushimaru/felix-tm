# Felix TM — Brand Verification Checklist

Google's verification process includes a "brand" review that looks for
**consistent identity signals across every surface a user sees** before
they are asked to grant access. Mismatches (different app name on
consent screen vs Web Store, parked-looking homepage, generic Gmail
contact, etc.) are a common reject reason.

This checklist enumerates every surface and the value it must contain.
Use it as a final pre-submission audit.

---

## Identity baseline (decide once, copy everywhere)

| Field | Value |
|---|---|
| Application name | **Felix TM** |
| Vendor / publisher | **Veriscio** |
| Application logo | `plugins/chrome-extension/icons/icon128.png` (128×128 PNG, transparent background) |
| Application home page | `https://ibushimaru.github.io/felix-tm/` |
| Privacy policy URL | `https://ibushimaru.github.io/felix-tm/privacy/` |
| Authorized domain | `ibushimaru.github.io` |
| Support email | `ibushimaru@veriscio.com` |
| Source repository | `https://github.com/ibushimaru/felix-tm` |
| Single-purpose statement | "Felix TM provides translation memory and glossary lookup for translators working in Google Sheets." |

**Rule:** every field below must read back exactly one of the values above. Differences (e.g. "Felix Translation Memory" on one surface, "Felix TM" on another) are reject signals.

---

## Surface-by-surface checklist

### Google Cloud Console — OAuth consent screen

- [ ] App name: **Felix TM**
- [ ] User support email: **ibushimaru@veriscio.com**
- [ ] App logo: 120×120 minimum PNG, square, on transparent or white background — derived from `icons/icon128.png`. Verify it is sharp at 120×120 in the consent dialog preview.
- [ ] Application home page: `https://ibushimaru.github.io/felix-tm/`
- [ ] Application privacy policy link: `https://ibushimaru.github.io/felix-tm/privacy/`
- [ ] Application terms of service link: same as privacy policy URL OR omit (Google does not require TOS for free non-commercial apps). If included, content must exist at the URL.
- [ ] Authorized domains: `ibushimaru.github.io`
- [ ] Developer contact email: **ibushimaru@veriscio.com**

### Chrome Web Store listing

- [ ] Extension name: **Felix TM**
- [ ] Publisher: **Veriscio** (configure in CWS dashboard's group/publisher settings)
- [ ] Short description (132 char max): _"Real-time translation memory and glossary for Google Sheets. Local-first, no backend, free for translators."_ (108 char)
- [ ] Detailed description: includes the exact same single-purpose statement as Cloud Console.
- [ ] Privacy policy link: `https://ibushimaru.github.io/felix-tm/privacy/`
- [ ] Homepage link: `https://ibushimaru.github.io/felix-tm/`
- [ ] Support link: `https://github.com/ibushimaru/felix-tm/issues`
- [ ] Contact email: **ibushimaru@veriscio.com**
- [ ] Icon: identical to `icons/icon128.png`
- [ ] Screenshots: see #37 — all must show the actual extension UI, not mockups.

### Extension `manifest.json`

- [ ] `name`: **Felix TM** (currently set)
- [ ] `version`: matches the build artifact (currently `0.1.0`)
- [ ] `description`: matches Web Store short description
- [ ] `oauth2.scopes`: `spreadsheets` only (no `userinfo.email`, no `drive.file`)
- [ ] `oauth2.client_id`: matches the verified OAuth client in Cloud Console

### GitHub repository

- [ ] `README.md` opens with "Felix TM" and the same single-purpose statement.
- [ ] README links to homepage and privacy policy.
- [ ] README contains a Felix CAT acknowledgement section (already in homepage, mirror to README).
- [ ] `LICENSE` is MIT (matches what the homepage states).
- [ ] `SECURITY.md` exists with disclosure contact `ibushimaru@veriscio.com`.
- [ ] Repository is public, not archived, has commits within the last 30 days.
- [ ] Repository description (GitHub field): "Translation Memory for Google Sheets — real-time fuzzy matching." (matches manifest)

### Homepage (`docs/index.html`)

- [ ] Title contains "Felix TM".
- [ ] Acknowledges Felix CAT lineage explicitly (already done — see "About Felix CAT" section).
- [ ] Links to privacy policy.
- [ ] Lists `ibushimaru@veriscio.com` as contact.
- [ ] No Lorem Ipsum, no broken links, no "coming soon" pages behind the menu.

### Privacy policy (`docs/privacy/index.html`)

- [ ] Lists `ibushimaru@veriscio.com` as contact.
- [ ] Documents both requested scopes.
- [ ] Includes Limited Use attestation.
- [ ] "Last updated" date within the last 90 days at submission time.

### Demo video (YouTube)

- [ ] Title: `Felix TM — OAuth Verification Demo`
- [ ] Visibility: **Unlisted** (not Private — Google reviewers need the URL to work; not Public — irrelevant to end users at this stage).
- [ ] Description includes the homepage URL and privacy policy URL.
- [ ] Channel name reflects Veriscio or "Felix TM" (avoid a personal-looking handle that contradicts the vendor identity).

---

## Felix CAT trademark — defensive notes

Felix TM intentionally references Felix CAT as its inspiration. To stay
on the right side of any unregistered trademark concern:

1. **Do not claim** Felix TM is the official successor or maintained
   version of Felix CAT.
2. **Do not** use Ryan Ginstrom's name in the product UI or store
   listing (acknowledgement is fine; implication of endorsement is not).
3. **Do** include the explicit "not affiliated" disclaimer (already in
   homepage `About Felix CAT` section).
4. **Do** keep the MIT license attribution to upstream code in
   `vendor/felix-cat-upstream/LICENSE` if any code was reused
   verbatim. (Current implementation is a re-implementation, not a
   copy, so the dependency is on algorithm only — no license attribution
   strictly required, but acknowledging is good etiquette.)

If Ryan Ginstrom asks the project to rename, the path of least
resistance is renaming to "Veriscio TM" or similar; nothing in the
codebase hard-depends on the "Felix" string beyond user-facing labels.

---

## Email contact infrastructure

The OAuth consent screen and Web Store both display
`ibushimaru@veriscio.com`. Reviewers may send test emails to this
address before verification. Confirm before submission:

- [ ] The address accepts mail (send a test from an unrelated account).
- [ ] Replies are sent from the same address (not a generic Gmail).
- [ ] The autoresponder (if any) does not contain anything that
      contradicts the privacy policy.
- [ ] SPF / DKIM / DMARC are configured for `veriscio.com` so
      reviewer emails do not bounce to spam.

---

## Final pre-submission audit script

Run this from repo root before clicking Submit on any verification
form:

```bash
# Sanity-check: does every surface contain the same identity strings?
grep -l "Felix TM"     docs/ plugins/chrome-extension/manifest.json -r
grep -l "veriscio.com" docs/ plugins/chrome-extension/ -r
grep -l "ibushimaru.github.io" docs/ plugins/chrome-extension/manifest.json -r
```

Inconsistent strings here mean inconsistent strings on the surfaces a
reviewer will see.
