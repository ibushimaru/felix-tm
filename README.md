# felix-tm

[日本語](README.ja.md)

Cross-platform Translation Memory engine, reimplemented in Python 3.

The fuzzy matching algorithms and TM architecture are inspired by
[**Felix CAT System**](http://felix-cat.com/) by Ryan Ginstrom
([original source on Bitbucket, archived](https://web.archive.org/web/20190729035158/https://bitbucket.org/ginstrom/felix)).

## Features

- **Fuzzy matching** — Levenshtein edit distance with 3-pass filtering (DB length filter, bag-of-characters, edit distance with early termination)
- **CJK-aware** — Character-level matching for Japanese/Chinese, word-level for Western text (auto-detected)
- **Text normalization** — Full-width/half-width, hiragana/katakana, case folding, HTML tag stripping
- **SQLite storage** — Persistent, indexed storage with FTS5 full-text search and pre-computed normalization
- **Multiple formats** — TMX 1.4, XLIFF 1.2/2.0, XLSX, TSV (import/export)
- **CLI + Library** — Use as a command-line tool or import as a Python package
- **Cross-platform** — Windows, macOS, Linux (CI tested on all three)

## Requirements

- Python 3.10+
- No native/compiled dependencies — pure Python

## Install

```bash
git clone https://github.com/ibushimaru/felix-tm.git
cd felix-tm
pip install -e .
```

Or with a virtual environment:

```bash
git clone https://github.com/ibushimaru/felix-tm.git
cd felix-tm
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -e .
```

## Usage (CLI)

```bash
# Import from various formats
felix-tm import memory.tmx -d my_tm.db                          # TMX
felix-tm import data.xlsx -d my_tm.db --source-col 1 --target-col 2  # Excel
felix-tm import project.xlf -d my_tm.db                         # XLIFF
felix-tm import pairs.tsv -d my_tm.db                            # TSV

# Fuzzy search
felix-tm search "The file has been saved" -d my_tm.db
felix-tm search "ファイルが保存された" -d my_tm.db -m 0.7       # min score 70%

# Concordance search (substring match via FTS5)
felix-tm concordance "file" -d my_tm.db
felix-tm concordance "保存" -d my_tm.db --field target           # search in target

# Export to various formats
felix-tm export output.tmx -d my_tm.db --source-lang en --target-lang ja
felix-tm export output.xlsx -d my_tm.db
felix-tm export output.xlf -d my_tm.db

# Show TM info
felix-tm info -d my_tm.db
```

## Usage (Python API)

```python
from felix_tm.memory.store import MemoryStore
from felix_tm.memory.record import Record
from felix_tm.memory.search import SearchEngine

# Create/open a TM database
with MemoryStore("my_tm.db") as store:
    # Add records
    store.add(Record(source="Hello", target="こんにちは"))
    store.add(Record(source="Goodbye", target="さようなら"))

    # Fuzzy search
    engine = SearchEngine(store)
    result = engine.fuzzy_search("Hello world", min_score=0.5)
    for match in result.matches:
        print(f"{match.score:.0%} {match.source} -> {match.target}")

    # Concordance search
    result = engine.concordance_search("Hello")

    # Reverse search (by target text)
    result = engine.reverse_search("こんにちは", min_score=0.5)

    # Glossary search (find terms within a sentence)
    result = engine.glossary_search("Say Hello to the world", min_score=0.9)
```

### Import/export programmatically

```python
from felix_tm.io.tmx import import_tmx, export_tmx
from felix_tm.io.xliff import import_xliff, export_xliff
from felix_tm.io.xlsx import import_xlsx, export_xlsx

# Import from file
records = import_tmx("memory.tmx", source_lang="en", target_lang="ja")
records = import_xliff("project.xlf")
records = import_xlsx("data.xlsx", source_col=1, target_col=3, header_row=1)

# Export to file
export_tmx(records, "output.tmx", source_lang="en", target_lang="ja")
export_xliff(records, "output.xlf", source_lang="en", target_lang="ja", version="2.0")
export_xlsx(records, "output.xlsx")
```

## Acknowledgments

This project is a clean-room reimplementation of the core algorithms from
[Felix CAT System](http://felix-cat.com/) (Copyright 1999-2015 Ryan Ginstrom, MIT License).

Felix CAT was a Windows-based computer-assisted translation tool with Word/Excel/PowerPoint
integration. This project ports its translation memory engine — fuzzy matching, text
normalization, and TM storage — to a modern, cross-platform Python 3 codebase.

- **Original author**: [Ryan Ginstrom](https://bitbucket.org/ginstrom/) (Ginstrom IT Solutions)
- **Original repository**: [bitbucket.org/ginstrom/felix](https://web.archive.org/web/20190729035158/https://bitbucket.org/ginstrom/felix) (archived)
- **Original website**: [felix-cat.com](http://felix-cat.com/)
- **Original documentation**: [felix-cat.com/media/docs/](http://felix-cat.com/media/docs/)
- **User manual (Japanese)**: [jp.felix-cat.com/media/manuals/jp/felix/](http://jp.felix-cat.com/media/manuals/jp/felix/)

## License

MIT — see [LICENSE](LICENSE) for details.

Original Felix CAT license is included in the Third-Party Notices section of the LICENSE file.
