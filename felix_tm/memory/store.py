"""SQLite-backed translation memory storage.

Replaces Felix's in-memory XML storage with a persistent, indexed SQLite database.
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
    reliability INTEGER NOT NULL DEFAULT 0,
    validated   INTEGER NOT NULL DEFAULT 0,
    refcount    INTEGER NOT NULL DEFAULT 0,
    created     TEXT NOT NULL,
    modified    TEXT NOT NULL,
    created_by  TEXT NOT NULL DEFAULT '',
    modified_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_source ON records(source);
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


class MemoryStore:
    """SQLite-backed TM store."""

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
        cur = self._conn.execute(
            """INSERT INTO records
               (source, target, context, reliability, validated, refcount,
                created, modified, created_by, modified_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.source, record.target, record.context,
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
        rows = [
            (
                r.source, r.target, r.context,
                r.reliability, int(r.validated), r.refcount,
                r.created.isoformat() if r.created else now,
                r.modified.isoformat() if r.modified else now,
                r.created_by, r.modified_by,
            )
            for r in records
        ]
        self._conn.executemany(
            """INSERT INTO records
               (source, target, context, reliability, validated, refcount,
                created, modified, created_by, modified_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
        self._conn.execute(
            """UPDATE records SET
               source=?, target=?, context=?, reliability=?, validated=?,
               refcount=?, modified=?, modified_by=?
               WHERE id=?""",
            (
                record.source, record.target, record.context,
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

    def concordance(self, query: str, field: str = "source") -> list[Record]:
        """Full-text concordance search using FTS5."""
        if field not in ("source", "target", "context"):
            raise ValueError(f"Invalid field: {field}")
        # Escape FTS5 special characters
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
