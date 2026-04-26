# GitHub Pages — One-time enablement

This is a manual step: GitHub Pages must be enabled through the GitHub
web UI. There is no API path that does it without elevated tokens, and
even then the UI is faster.

## Steps (≈ 2 minutes)

1. Open <https://github.com/ibushimaru/felix-tm/settings/pages>.
2. Under **Source**, choose **Deploy from a branch**.
3. **Branch:** `main` &nbsp;&nbsp; **Folder:** `/docs` &nbsp;&nbsp; → click **Save**.
4. Wait ~1 minute for the first build. The settings page will show the
   live URL: **`https://ibushimaru.github.io/felix-tm/`**.
5. Tick **Enforce HTTPS** when the option becomes available (it appears
   after the cert is provisioned, usually within 5 minutes).

## Verification

Open these URLs in a browser:

- `https://ibushimaru.github.io/felix-tm/` — the homepage we just wrote
  should render with the "Felix TM" header.
- `https://ibushimaru.github.io/felix-tm/privacy/` — the privacy policy
  should render.

If either returns 404, check:

- Branch + folder is exactly `main` and `/docs`.
- `docs/.nojekyll` exists (already committed) so the static HTML isn't
  processed by Jekyll.
- The repository is **public**. GitHub Pages on free accounts only
  serves public repositories.

## Why these specific URLs

The OAuth consent screen and Web Store listing both reference these
exact URLs. They must resolve before submission:

| Field | Value |
|---|---|
| Application home page | `https://ibushimaru.github.io/felix-tm/` |
| Privacy policy URL | `https://ibushimaru.github.io/felix-tm/privacy/` |
| Authorized domain | `ibushimaru.github.io` |

## Custom domain (later)

If `felix-tm.app` (or similar) is registered later, add a `CNAME` file
inside `docs/` containing just the domain name, configure DNS at the
registrar (CNAME record pointing to `ibushimaru.github.io`), and update
the consent screen + listing URLs.

The `felix-cat.com` domain is held by Ryan Ginstrom (renewed 2026-04-25,
expires 2027-04-25) and is **not** available.
