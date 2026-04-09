# felix-tm

Cross-platform Translation Memory engine, reimplemented in Python 3.

The fuzzy matching algorithms and TM architecture are inspired by
[**Felix CAT System**](http://felix-cat.com/) by Ryan Ginstrom
([original source on Bitbucket, archived](https://web.archive.org/web/20190729035158/https://bitbucket.org/ginstrom/felix)).

## Features

- **Fuzzy matching** — Levenshtein edit distance with 3-pass filtering (length check, bag-of-characters, edit distance with early termination)
- **CJK-aware** — Character-level matching for Japanese/Chinese, word-level for Western text (auto-detected)
- **Text normalization** — Full-width/half-width, hiragana/katakana, case folding, HTML tag stripping
- **SQLite storage** — Persistent, indexed storage with FTS5 full-text search
- **TMX 1.4** — Industry-standard translation memory format (import/export)
- **TSV** — Tab-separated values (import/export)
- **CLI + Library** — Use as a command-line tool or import as a Python package

## Install

```bash
pip install -e .
```

## Usage

```bash
# Import a TMX file
felix-tm import memory.tmx -d my_tm.db

# Fuzzy search
felix-tm search "The file has been saved" -d my_tm.db

# Concordance search
felix-tm concordance "file" -d my_tm.db

# Export to TMX
felix-tm export output.tmx -d my_tm.db --source-lang en --target-lang ja
```

## Python API

```python
from felix_tm.memory.store import MemoryStore
from felix_tm.memory.record import Record
from felix_tm.memory.search import SearchEngine

with MemoryStore("my_tm.db") as store:
    store.add(Record(source="Hello", target="こんにちは"))
    engine = SearchEngine(store)
    result = engine.fuzzy_search("Hello world", min_score=0.5)
    for match in result.matches:
        print(f"{match.score:.0%} {match.source} -> {match.target}")
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
