# Felix CAT — vendored upstream source

Snapshot of the upstream Felix CAT source tree by Ryan Ginstrom. Kept
in this repository because the original Bitbucket project is offline
(Bitbucket dropped Mercurial hosting in 2020) and the only remaining
copy is in the Wayback Machine, which is not a stable distribution
channel.

## Provenance

- **Origin**: `https://bitbucket.org/ginstrom/felix` (Mercurial repo,
  no longer reachable)
- **Snapshot**: `0eb229b09823` (Mercurial changeset id), retrieved as
  the `get/` zip download archived by the Wayback Machine on
  2020-06-23
- **Wayback URL** (verified working as of 2026-04):
  `https://web.archive.org/web/20200623194423/https://bitbucket.org/ginstrom/felix/get/0eb229b09823.zip`
- **Original archive name**: `ginstrom-felix-0eb229b09823`

## License

MIT (see `LICENSE.txt` / `LICENSE_JP.txt` in this directory). The MIT
license explicitly permits redistribution and modification with the
copyright notice preserved.

## Why it's here

The Python and JavaScript ports under `felix_tm/` and
`plugins/chrome-extension/` reference Felix sources by filename in
their port comments (`distance.cpp`, `match_maker.cpp`,
`gloss_placement.cpp`, `MatchStringPairing.cpp`, `record_local.h`,
`segment.h`, etc.). Without the upstream source available, those
references can't be cross-checked against actual behavior, and any
port decision becomes guesswork against the manual + existing port
conventions. This vendored snapshot makes the upstream behavior
inspectable.

## What this is NOT

- Not a fork — we don't develop against this tree
- Not a build target — the Felix CAT app itself is Windows COM /
  C++ / ATL and is not built from this repo
- Not authoritative for our port — the Python and JS implementations
  are the supported codebase; this directory is for cross-reference
  only

## Layout

The original repository structure is preserved verbatim:

- `Felix/` — the main Felix CAT app source (translation memory engine,
  UI, COM glue)
- `WordAssist/`, `ExcelAssist/`, `PowerPointAssist/` — Office add-ins
- `common/` — shared utilities used across the assists
- `Test_*/` — per-app test suites
- `python_tools/` — auxiliary Python scripts shipped with Felix
- `manual/` — original manual sources (the rendered HTML lives in
  `docs/manual-en` and `docs/manual-ja` of this repo)
- `setup/`, `settings/` — installer + default configuration
