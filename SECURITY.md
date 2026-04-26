# Security Policy

## Reporting a vulnerability

If you discover a security issue in Felix TM, please report it
**privately** rather than opening a public GitHub issue.

**Contact:** ibushimaru@veriscio.com

We will acknowledge your report within **5 business days** and aim to
publish a fix or mitigation within 30 days for confirmed issues.

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal proof-of-concept is ideal).
- The affected version (`manifest.json` `version` field, or git commit
  SHA for source-level issues).
- Whether the issue affects the Chrome extension, the Python sibling
  (`felix_tm/`), or both.

## Scope

In scope:

- The published Felix TM Chrome extension and its source under
  `plugins/chrome-extension/`.
- The Python `felix_tm/` package.
- The static GitHub Pages site under `docs/`.

Out of scope:

- Vulnerabilities in third-party services Felix TM connects to
  (Google APIs) — please report those to the upstream provider.
- Vulnerabilities in browsers themselves — report to the browser
  vendor.
- Vendored historical reference material under `vendor/` (this is the
  archived Felix CAT source preserved for algorithm comparison; it is
  not executed and not shipped).

## Coordinated disclosure

We follow a 90-day coordinated disclosure window from acknowledgement.
If a fix is not feasible within 90 days, we will work with you on a
mutually acceptable timeline before any public disclosure.

## Security architecture summary

Felix TM is a client-side-only Chrome extension. There is no backend
service operated by the maintainer. User data (translation memory,
glossary, settings) lives in the browser's IndexedDB. OAuth tokens
are managed by Chrome's `chrome.identity` cache and never persisted by
Felix TM itself. The only network destinations contacted from the
extension are Google's own API endpoints, called directly from the
user's browser.

This means most server-side vulnerability classes (SSRF, SQL injection
on the vendor's database, etc.) are structurally impossible. The
attack surface is dominated by the extension code itself.
