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
