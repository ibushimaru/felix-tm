"""SQLite-backed translation memory storage.

Replaces Felix's in-memory XML storage with a persistent, indexed SQLite database.
Includes source_cmp (normalized text) and source_len columns for fast pre-filtering.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from .record import Record

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT '',
    source_cmp  TEXT NOT NULL DEFAULT '',
    source_len  INTEGER NOT NULL DEFAULT 0,
    reliability INTEGER NOT NULL DEFAULT 0,
    validated   INTEGER NOT NULL DEFAULT 0,
    refcount    INTEGER NOT NULL DEFAULT 0,
    created     TEXT NOT NULL,
    modified    TEXT NOT NULL,
    created_by  TEXT NOT NULL DEFAULT '',
    modified_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_source ON records(source);
CREATE INDEX IF NOT EXISTS idx_source_len ON records(source_len);
"""

_FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    source, target, context,
    content='records',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
    INSERT INTO records_fts(rowid, source, target, context)
    VALUES (new.id, new.source, new.target, new.context);
END;

CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
    INSERT INTO records_fts(records_fts, rowid, source, target, context)
    VALUES ('delete', old.id, old.source, old.target, old.context);
END;

CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
    INSERT INTO records_fts(records_fts, rowid, source, target, context)
    VALUES ('delete', old.id, old.source, old.target, old.context);
    INSERT INTO records_fts(rowid, source, target, context)
    VALUES (new.id, new.source, new.target, new.context);
END;
"""

# Migration: add source_cmp and source_len if missing (for DBs created before v0.2)
_MIGRATE_V2 = """
ALTER TABLE records ADD COLUMN source_cmp TEXT NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN source_len INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_source_len ON records(source_len);
"""


def _make_cmp(text: str) -> str:
    """Build normalized comparison string (same logic as Segment but standalone)."""
    import re
    import unicodedata
    s = re.sub(r"<[^>]+>", "", text)              # strip tags
    s = unicodedata.normalize("NFKC", s)          # full-width -> half-width
    s = s.lower()                                  # case fold
    # hiragana -> katakana
    result = []
    for ch in s:
        cp = ord(ch)
        if 0x3041 <= cp <= 0x3096:
            result.append(chr(cp + 0x60))
        else:
            result.append(ch)
    s = "".join(result)
    s = re.sub(r"\s+", " ", s).strip()            # normalize whitespace
    return s


class MemoryStore:
    """SQLite-backed TM store with pre-computed normalization for fast search."""

    def __init__(self, path: str | Path | None = None) -> None:
        """Open or create a TM database.

        Args:
            path: Path to SQLite file. None for in-memory database.
        """
        if path is None:
            self._conn = sqlite3.connect(":memory:")
        else:
            self._conn = sqlite3.connect(str(path))

        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._conn.executescript(_FTS_SCHEMA)
        self._conn.commit()
        self._ensure_migration()

    def _ensure_migration(self) -> None:
        """Add source_cmp/source_len columns if they don't exist (v1 -> v2 migration)."""
        cols = {
            row[1]
            for row in self._conn.execute("PRAGMA table_info(records)").fetchall()
        }
        if "source_cmp" not in cols:
            for stmt in _MIGRATE_V2.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    try:
                        self._conn.execute(stmt)
                    except sqlite3.OperationalError:
                        pass  # column/index already exists
            # Backfill existing records
            rows = self._conn.execute("SELECT id, source FROM records").fetchall()
            for row in rows:
                cmp = _make_cmp(row["source"])
                self._conn.execute(
                    "UPDATE records SET source_cmp=?, source_len=? WHERE id=?",
                    (cmp, len(cmp), row["id"]),
                )
            self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> MemoryStore:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # --- Metadata ---

    def get_meta(self, key: str, default: str = "") -> str:
        row = self._conn.execute(
            "SELECT value FROM meta WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            (key, value),
        )
        self._conn.commit()

    # --- CRUD ---

    def add(self, record: Record) -> int:
        """Add a record and return its assigned ID."""
        now = datetime.now().isoformat()
        cmp = _make_cmp(record.source)
        cur = self._conn.execute(
            """INSERT INTO records
               (source, target, context, source_cmp, source_len,
                reliability, validated, refcount,
                created, modified, created_by, modified_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.source, record.target, record.context,
                cmp, len(cmp),
                record.reliability, int(record.validated), record.refcount,
                record.created.isoformat() if record.created else now,
                record.modified.isoformat() if record.modified else now,
                record.created_by, record.modified_by,
            ),
        )
        self._conn.commit()
        record.id = cur.lastrowid
        return record.id

    def add_bulk(self, records: list[Record]) -> int:
        """Add multiple records efficiently. Returns count added."""
        now = datetime.now().isoformat()
        rows = []
        for r in records:
            cmp = _make_cmp(r.source)
            rows.append((
                r.source, r.target, r.context,
                cmp, len(cmp),
                r.reliability, int(r.validated), r.refcount,
                r.created.isoformat() if r.created else now,
                r.modified.isoformat() if r.modified else now,
                r.created_by, r.modified_by,
            ))
        self._conn.executemany(
            """INSERT INTO records
               (source, target, context, source_cmp, source_len,
                reliability, validated, refcount,
                created, modified, created_by, modified_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        self._conn.commit()
        return len(rows)

    def get(self, record_id: int) -> Record | None:
        row = self._conn.execute(
            "SELECT * FROM records WHERE id = ?", (record_id,)
        ).fetchone()
        return self._row_to_record(row) if row else None

    def update(self, record: Record) -> None:
        cmp = _make_cmp(record.source)
        self._conn.execute(
            """UPDATE records SET
               source=?, target=?, context=?, source_cmp=?, source_len=?,
               reliability=?, validated=?,
               refcount=?, modified=?, modified_by=?
               WHERE id=?""",
            (
                record.source, record.target, record.context,
                cmp, len(cmp),
                record.reliability, int(record.validated), record.refcount,
                datetime.now().isoformat(), record.modified_by,
                record.id,
            ),
        )
        self._conn.commit()

    def delete(self, record_id: int) -> None:
        self._conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
        self._conn.commit()

    def count(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) as cnt FROM records").fetchone()
        return row["cnt"]

    # --- Search ---

    def all_records(self) -> list[Record]:
        """Return all records (for fuzzy matching iteration)."""
        rows = self._conn.execute("SELECT * FROM records").fetchall()
        return [self._row_to_record(r) for r in rows]

    def candidates_by_length(
        self, query_cmp_len: int, min_score: float,
    ) -> list[tuple[Record, str]]:
        """Return records whose source_len passes the length pre-filter.

        Uses SQL WHERE to eliminate records that can't possibly match,
        avoiding full-table scan for fuzzy search.

        Returns:
            List of (Record, source_cmp) tuples.
        """
        # length filter: (max_len - diff) / max_len >= min_score
        # Rearranged: source_len >= query_len * min_score
        #             source_len <= query_len / min_score
        if min_score <= 0:
            min_len = 0
            max_len = 2**31
        else:
            min_len = int(query_cmp_len * min_score)
            max_len = int(query_cmp_len / min_score) + 1

        rows = self._conn.execute(
            """SELECT * FROM records
               WHERE source_len BETWEEN ? AND ?""",
            (min_len, max_len),
        ).fetchall()
        return [(self._row_to_record(r), r["source_cmp"]) for r in rows]

    def concordance(self, query: str, field: str = "source") -> list[Record]:
        """Full-text concordance search using FTS5."""
        if field not in ("source", "target", "context"):
            raise ValueError(f"Invalid field: {field}")
        escaped = query.replace('"', '""')
        rows = self._conn.execute(
            f"""SELECT r.* FROM records r
                JOIN records_fts f ON r.id = f.rowid
                WHERE records_fts MATCH '{field}: "{escaped}"'""",
        ).fetchall()
        return [self._row_to_record(r) for r in rows]

    # --- Helpers ---

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> Record:
        return Record(
            id=row["id"],
            source=row["source"],
            target=row["target"],
            context=row["context"],
            reliability=row["reliability"],
            validated=bool(row["validated"]),
            refcount=row["refcount"],
            created=datetime.fromisoformat(row["created"]),
            modified=datetime.fromisoformat(row["modified"]),
            created_by=row["created_by"],
            modified_by=row["modified_by"],
        )
