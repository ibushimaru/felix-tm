# Felix TM — CASA Tier 2 Self-Assessment Draft

This document captures Felix TM's pre-prepared answers to the **Cloud
Application Security Assessment (CASA) Tier 2** self-attestation
questionnaire that Google requires for apps using Restricted OAuth
scopes (here: `spreadsheets`).

CASA Tier 2 is the self-assessed, free track. It is appropriate for
Felix TM because:

1. The app has **no backend / no server-side storage** — all user data
   resides in the user's browser (IndexedDB).
2. The number of users is small (private beta → public launch).
3. There is no shared infrastructure between users.

The Tier 2 questionnaire is administered through a third-party
assessment platform (currently Bishop Fox / DEKRA-managed). When the
form is opened, paste in the matching answer below.

---

## A. Application overview

**App name:** Felix TM
**Vendor:** Veriscio (sole proprietor: Ibushimaru)
**App type:** Chrome browser extension (Manifest V3)
**Architecture:** Client-side only — no backend service operated by the vendor.
**Restricted scope used:** `https://www.googleapis.com/auth/spreadsheets` (only scope requested)
**Estimated user count at first review:** < 100 (private beta)
**Source code location:** Public on GitHub — `https://github.com/ibushimaru/felix-tm`

---

## B. Data inventory

| Data category | In scope? | Where stored | How protected |
|---|---|---|---|
| User OAuth access token | Yes | Chrome's `chrome.identity` token cache | Managed by Chrome; Felix TM never persists it to disk |
| Spreadsheet cell values (transient) | Yes | In-memory during matching | Discarded after each match cycle; never written to disk |
| Translation memory entries | Yes (user-created) | Browser IndexedDB (`FelixTM` database) | Browser-managed sandbox; per-origin isolated |
| Glossary entries | Yes (user-created) | Browser IndexedDB | Same |
| Settings | Yes | Browser IndexedDB | Same |
| Server-side logs / analytics / telemetry | **No** | N/A | N/A — none collected |
| Backups of user data | **No** | N/A | N/A — vendor has no copies |

---

## C. Authentication & access control

| Question | Answer |
|---|---|
| Does the app authenticate users? | Yes — via Google OAuth 2.0 (`chrome.identity.getAuthToken`). |
| Multi-factor authentication? | Inherited from the user's Google account. |
| Are credentials stored by the vendor? | No. Tokens stay in `chrome.identity` cache, managed by Chrome. |
| Are there admin / privileged accounts? | No. The app has no backend, so there are no operator accounts. |
| Session timeout? | OAuth tokens follow Google's standard expiry (~1 hour). Refreshes are handled by `chrome.identity`. |
| Sign-out behavior? | "Sign out" button calls `chrome.identity.removeCachedAuthToken` and revokes the token at `oauth2.googleapis.com/revoke`. |

---

## D. Cryptography

| Question | Answer |
|---|---|
| Data in transit | All Google API calls use HTTPS (TLS 1.2+). Endpoints: `sheets.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com`. |
| Data at rest | IndexedDB is encrypted at rest by the OS file-system on platforms where Chrome enables it (macOS FileVault, Windows BitLocker, etc.). The vendor does not manage encryption keys because it does not store user data. |
| Custom cryptography? | None. No homemade crypto. |
| Certificate pinning? | Not implemented. Standard browser TLS validation. |

---

## E. Data deletion

| Question | Answer |
|---|---|
| Can the user delete their data? | Yes. (1) "Sign out" revokes OAuth tokens. (2) Uninstalling the extension removes all IndexedDB data. (3) Users can revoke API access at `myaccount.google.com/permissions`. |
| Vendor-side deletion? | N/A — no vendor-side storage exists. |
| Retention period? | Indefinite for local data, controlled entirely by the user. |

---

## F. Logging & monitoring

| Question | Answer |
|---|---|
| Application logs? | None transmitted off-device. Chrome DevTools console logs exist for debugging during development; production builds emit no logs by default. |
| Audit trail of restricted-scope use? | Implicit — every API call is initiated by an explicit user action in the side panel. There is no background polling. |
| Security monitoring / SIEM? | Not applicable — no backend infrastructure. |

---

## G. Incident response

| Question | Answer |
|---|---|
| Do you have an incident response process? | For a vendor-side incident: not applicable, no backend. For an extension-side incident (e.g., a malicious update is published): Veriscio will (1) immediately yank the affected version from the Chrome Web Store, (2) publish an advisory at `https://github.com/ibushimaru/felix-tm/security/advisories`, (3) email registered beta users. |
| Contact for security reports? | `ibushimaru@veriscio.com` |
| Time-to-acknowledge SLA? | 5 business days. |
| Coordinated disclosure policy? | Documented in `SECURITY.md` (to be published in repo root before launch). |

---

## H. Software development & supply chain

| Question | Answer |
|---|---|
| Source control? | Git, hosted on GitHub (`github.com/ibushimaru/felix-tm`). |
| Code review? | Solo developer at this stage; PRs are reviewed via the GitHub PR workflow with automated checks. |
| Static analysis? | `npm test` runs the unit-test suite (currently 269 tests). Plain JavaScript with no build step beyond minification, so transpiler-level vulnerabilities do not apply. |
| Dependency management? | The shipped extension has **zero runtime npm dependencies**. The Python sibling (`felix_tm/`) uses standard library only at runtime. Dev-only dependencies are listed in `package.json` and `pyproject.toml`. |
| Vulnerability scanning of dependencies? | `npm audit` clean as of the last commit. The dependency surface is empty for the shipped artifact, so the residual surface is nil. |
| How is the extension built? | `python3 scripts/build_extension.py` produces a deterministic zip from the source tree. No third-party build pipeline. |
| How is the extension signed? | Chrome Web Store handles publication-time signing. The `key` field in `manifest.json` pins the extension ID. |

---

## I. Cloud / infrastructure security

| Question | Answer |
|---|---|
| Cloud provider? | None. The vendor operates no cloud infrastructure. |
| Compute / storage / networking? | None operated by the vendor. |
| Documentation hosted at? | GitHub Pages (`ibushimaru.github.io/felix-tm/`) — static HTML, no dynamic backend. |

---

## J. Third-party services

| Question | Answer |
|---|---|
| Third-party SDKs in the extension? | None. |
| Third-party libraries (runtime)? | None. The extension's runtime is plain ES2020 JavaScript, no bundler, no React, no analytics SDK. |
| Sub-processors handling user data? | None. |
| Are user data ever sent to third parties? | Only to Google's own API endpoints when the user takes an action that requires the Sheets API. |

---

## K. Limited Use attestation (verbatim)

> Felix TM's use of information received from Google APIs adheres to
> the Google API Services User Data Policy, including the Limited Use
> requirements.
>
> 1. We use access to spreadsheet data only to provide the user-facing
>    translation-memory features (matching, write-back, import) within
>    the running extension.
> 2. We do not transfer this data to others except as necessary to
>    provide or improve user-facing features, comply with applicable
>    law, or as part of a merger, acquisition, or sale of assets with
>    the user's prior consent.
> 3. We do not use this data to serve advertisements, including
>    personalized, retargeted, or interest-based ads.
> 4. We do not allow humans to read this data unless we have the user's
>    affirmative agreement, it is necessary for security purposes, to
>    comply with applicable law, or the data is aggregated and used
>    for internal operations in accordance with applicable law.
> 5. We do not use this data to develop, improve, or train generalized
>    AI and/or ML models. Matching is performed entirely by
>    deterministic algorithms running locally in the user's browser.

---

## L. Notes for the assessor

Felix TM's security posture is dominated by a single architectural
decision: **the vendor operates no backend**. There is no server to
breach, no database to exfiltrate, no operator console to phish. The
restricted scope is exercised entirely browser-side, with each API call
authenticated by a token Google issues directly to the user's Chrome
profile.

Any control that asks "how is data on the vendor's servers protected"
collapses to "no such servers exist." We have answered N/A wherever the
question presupposes vendor-side infrastructure rather than reflexively
filling in a synthetic answer, because the integrity of the assessment
depends on the assessor seeing where the architecture eliminates the
risk surface entirely.

For controls that are genuinely applicable (sign-in, data deletion,
incident response for the extension itself), specific answers are above.

---

## Submission checklist

- [ ] Read Google's current CASA Tier 2 eligibility page to confirm Felix TM still qualifies for Tier 2 (vs Tier 3).
- [ ] Open the Tier 2 questionnaire when granted access through the OAuth verification flow.
- [ ] Paste responses from sections A–K.
- [ ] Attach as supporting evidence:
  - [ ] `manifest.json` showing the requested scopes.
  - [ ] Screenshot of `package.json` (zero runtime deps).
  - [ ] `scope-justification.md`.
  - [ ] Privacy policy URL.
  - [ ] Demo video URL.
- [ ] Receive the Letter of Validation (LoV).
- [ ] Forward the LoV in the OAuth verification thread.
