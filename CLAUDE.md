# felix-tm

Cross-platform Translation Memory engine, reimplemented in Python 3 from Felix CAT.

## Architecture

```
felix_tm/
├── core/           # Matching algorithms (no I/O, no DB)
│   ├── distance.py    # Levenshtein edit distance (single-row DP, early termination)
│   ├── segment.py     # Text normalization (tags, width, hira/kata, case)
│   └── match_maker.py # 3-pass fuzzy matching (length → bag → edit distance)
├── memory/         # Storage and search
│   ├── record.py      # Record dataclass
│   ├── store.py       # SQLite + FTS5 (with source_cmp/source_len pre-filter columns)
│   └── search.py      # Search engine (fuzzy, exact, reverse, concordance, glossary)
├── io/             # Import/export formats
│   ├── tmx.py         # TMX 1.4
│   ├── tsv.py         # Tab-separated values
│   ├── xlsx.py        # Excel (openpyxl)
│   └── xliff.py       # XLIFF 1.2 / 2.0
└── cli.py          # CLI entry point
```

## Development

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest tests/ -v
```

## Key Design Decisions

- **SQLite + FTS5** instead of Felix's in-memory XML for persistence and scale
- **source_cmp / source_len columns** pre-computed at insert time for DB-level filtering
- **Pure Python, no native deps** — runs on Win/Mac/Linux without compilation
- Matching algorithm is a faithful port of Felix CAT's `distance.cpp` + `match_maker.cpp`

## CI

GitHub Actions: Windows / macOS / Linux × Python 3.10-3.13 (12 jobs)

## Pre-release cleanup checklist

The DEV_RELOAD bridge has been removed. The `felix-tm-reload` skill still
exists under `.claude/skills/` but will silently fail against any build
without the bridge — which is the desired post-publish behavior.

If a future dev-only bridge is added (e.g. a fresh hot-reload mechanism),
record it here so it gets stripped before the next submission.

## Loading the Chrome extension during development

**Always load `plugins/chrome-extension/` directly** as an unpacked
extension via `chrome://extensions/` → "Load unpacked". This is the
live source — every edit takes effect after one reload of the
extension card (and a `Cmd+R` on the Sheets tab to re-inject the
content script).

**Never load `dist/felix-tm-v0.1.0/` for development.** That directory
is a frozen snapshot produced by `python3 scripts/build_extension.py`
and is meant exclusively for tester/release distribution. It will
*not* update when source files change, so reloading from `dist/`
silently leaves the user testing stale code. If a tester needs a
zip, run the build script — but the developer should never be looking
at `dist/`.

## Logic tests (no browser)

`plugins/chrome-extension/tests/` holds Node unit tests for the pure
logic in `felix-engine.js` (Auto Translate planners, matching, placement,
etc.). Run them with `cd plugins/chrome-extension && npm test`. These are
the feedback loop for any change to non-DOM logic — add a test there
before reaching for a browser.
