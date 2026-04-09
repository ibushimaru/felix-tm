# felix-tm

Cross-platform Translation Memory engine inspired by [Felix CAT](http://felix-cat.com/).

## Features

- Fuzzy matching with Levenshtein edit distance (3-pass filtering)
- CJK-aware matching (character-level for Japanese/Chinese, word-level for Western text)
- Text normalization (full-width/half-width, hiragana/katakana, case folding)
- SQLite-backed persistent storage with FTS5 full-text search
- TMX 1.4 import/export
- TSV import/export
- CLI and Python library interface

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

## License

MIT (based on Felix CAT by Ryan Ginstrom)
