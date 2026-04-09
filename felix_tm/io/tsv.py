"""TSV (tab-separated values) import/export.

Ported from Felix CAT TabbedTextExporter.
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from ..memory.record import Record

_TSV_COLUMNS = [
    "source", "target", "context", "reliability",
    "created", "modified", "validated",
]


def import_tsv(
    path: str | Path,
    source_col: int = 0,
    target_col: int = 1,
    has_header: bool = True,
    encoding: str = "utf-8-sig",
) -> list[Record]:
    """Import records from a TSV file.

    Args:
        path: Path to TSV file.
        source_col: Column index for source text.
        target_col: Column index for target text.
        has_header: Whether the first row is a header.
        encoding: File encoding.

    Returns:
        List of Record objects.
    """
    records: list[Record] = []

    with open(path, encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        if has_header:
            next(reader, None)

        for row in reader:
            if len(row) <= max(source_col, target_col):
                continue

            src = row[source_col].strip()
            tgt = row[target_col].strip()

            if not src and not tgt:
                continue

            rec = Record(source=src, target=tgt)
            records.append(rec)

    return records


def export_tsv(
    records: list[Record],
    path: str | Path,
    encoding: str = "utf-8-sig",
) -> None:
    """Export records to a TSV file.

    Args:
        records: List of Record objects.
        path: Output file path.
        encoding: File encoding.
    """
    with open(path, "w", encoding=encoding, newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(_TSV_COLUMNS)

        for rec in records:
            writer.writerow([
                rec.source,
                rec.target,
                rec.context,
                rec.reliability,
                rec.created.isoformat() if rec.created else "",
                rec.modified.isoformat() if rec.modified else "",
                "Yes" if rec.validated else "No",
            ])
