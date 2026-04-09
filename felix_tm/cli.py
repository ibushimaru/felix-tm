"""Command-line interface for felix-tm."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .io.tmx import export_tmx, import_tmx
from .io.tsv import export_tsv, import_tsv
from .io.xliff import export_xliff, import_xliff
from .io.xlsx import export_xlsx, import_xlsx
from .memory.record import Record
from .memory.search import SearchEngine
from .memory.store import MemoryStore


def cmd_import(args: argparse.Namespace) -> None:
    """Import a TMX or TSV file into a TM database."""
    db_path = Path(args.db)
    input_path = Path(args.input)
    fmt = args.format or input_path.suffix.lstrip(".")

    if fmt in ("tmx", "xml"):
        records = import_tmx(input_path, source_lang=args.source_lang,
                             target_lang=args.target_lang)
    elif fmt in ("tsv", "txt", "csv"):
        records = import_tsv(input_path)
    elif fmt in ("xlsx", "xls"):
        records = import_xlsx(
            input_path,
            source_col=args.source_col or 1,
            target_col=args.target_col or 2,
            header_row=args.header_row or 1,
        )
    elif fmt in ("xliff", "xlf", "sdlxliff"):
        records = import_xliff(input_path)
    else:
        print(f"Unsupported format: {fmt}", file=sys.stderr)
        sys.exit(1)

    with MemoryStore(db_path) as store:
        count = store.add_bulk(records)
        total = store.count()

    print(f"Imported {count} records into {db_path} (total: {total})")


def cmd_export(args: argparse.Namespace) -> None:
    """Export TM database to TMX or TSV."""
    db_path = Path(args.db)
    output_path = Path(args.output)
    fmt = args.format or output_path.suffix.lstrip(".")

    with MemoryStore(db_path) as store:
        records = store.all_records()

    if fmt in ("tmx", "xml"):
        export_tmx(records, output_path,
                   source_lang=args.source_lang or "en",
                   target_lang=args.target_lang or "ja")
    elif fmt in ("tsv", "txt"):
        export_tsv(records, output_path)
    elif fmt in ("xlsx", "xls"):
        export_xlsx(records, output_path,
                    source_lang=args.source_lang or "Source",
                    target_lang=args.target_lang or "Target")
    elif fmt in ("xliff", "xlf"):
        export_xliff(records, output_path,
                     source_lang=args.source_lang or "en",
                     target_lang=args.target_lang or "ja")
    else:
        print(f"Unsupported format: {fmt}", file=sys.stderr)
        sys.exit(1)

    print(f"Exported {len(records)} records to {output_path}")


def cmd_search(args: argparse.Namespace) -> None:
    """Search the TM for a query."""
    db_path = Path(args.db)

    with MemoryStore(db_path) as store:
        engine = SearchEngine(store)
        result = engine.fuzzy_search(
            args.query,
            min_score=args.min_score,
            max_results=args.max_results,
        )

    if not result.matches:
        print("No matches found.")
        return

    for i, m in enumerate(result.matches, 1):
        pct = int(m.score * 100)
        print(f"[{i}] {pct}% | {m.source}")
        print(f"     -> {m.target}")
        if m.context:
            print(f"     ctx: {m.context}")
        print()


def cmd_concordance(args: argparse.Namespace) -> None:
    """Concordance search."""
    db_path = Path(args.db)

    with MemoryStore(db_path) as store:
        engine = SearchEngine(store)
        result = engine.concordance_search(args.query, field=args.field)

    if not result.matches:
        print("No matches found.")
        return

    for i, m in enumerate(result.matches, 1):
        print(f"[{i}] {m.source}")
        print(f"  -> {m.target}")
        print()


def cmd_serve(args: argparse.Namespace) -> None:
    """Start the web UI."""
    from .web.app import serve
    serve(db_path=args.db, host=args.host, port=args.port)


def cmd_info(args: argparse.Namespace) -> None:
    """Show TM database info."""
    db_path = Path(args.db)
    with MemoryStore(db_path) as store:
        count = store.count()
        src_lang = store.get_meta("source_lang", "N/A")
        tgt_lang = store.get_meta("target_lang", "N/A")

    print(f"Database: {db_path}")
    print(f"Records:  {count}")
    print(f"Source:   {src_lang}")
    print(f"Target:   {tgt_lang}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="felix-tm",
        description="Felix TM - Cross-platform Translation Memory engine",
    )
    sub = parser.add_subparsers(dest="command")

    # import
    p_import = sub.add_parser("import", help="Import TMX/TSV/XLSX into TM")
    p_import.add_argument("input", help="Input file path")
    p_import.add_argument("-d", "--db", default="memory.db", help="TM database path")
    p_import.add_argument("-f", "--format", help="Force format (tmx/tsv/xlsx)")
    p_import.add_argument("--source-lang", help="Source language code")
    p_import.add_argument("--target-lang", help="Target language code")
    p_import.add_argument("--source-col", type=int, help="Source column (1-based, for xlsx)")
    p_import.add_argument("--target-col", type=int, help="Target column (1-based, for xlsx)")
    p_import.add_argument("--header-row", type=int, help="Header row number (for xlsx)")

    # export
    p_export = sub.add_parser("export", help="Export TM to TMX/TSV/XLSX")
    p_export.add_argument("output", help="Output file path")
    p_export.add_argument("-d", "--db", default="memory.db", help="TM database path")
    p_export.add_argument("-f", "--format", help="Force format (tmx/tsv/xlsx)")
    p_export.add_argument("--source-lang", help="Source language code")
    p_export.add_argument("--target-lang", help="Target language code")

    # search
    p_search = sub.add_parser("search", help="Fuzzy search TM")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("-d", "--db", default="memory.db", help="TM database path")
    p_search.add_argument("-m", "--min-score", type=float, default=0.5,
                          help="Minimum match score (0.0-1.0)")
    p_search.add_argument("-n", "--max-results", type=int, default=10,
                          help="Maximum results")

    # concordance
    p_conc = sub.add_parser("concordance", help="Concordance search")
    p_conc.add_argument("query", help="Search query")
    p_conc.add_argument("-d", "--db", default="memory.db", help="TM database path")
    p_conc.add_argument("--field", default="source",
                        choices=["source", "target", "context"])

    # serve
    p_serve = sub.add_parser("serve", help="Start web UI")
    p_serve.add_argument("-d", "--db", default="memory.db", help="TM database path")
    p_serve.add_argument("--host", default="127.0.0.1", help="Host (default: 127.0.0.1)")
    p_serve.add_argument("-p", "--port", type=int, default=8080, help="Port (default: 8080)")

    # info
    p_info = sub.add_parser("info", help="Show TM info")
    p_info.add_argument("-d", "--db", default="memory.db", help="TM database path")

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "import": cmd_import,
        "export": cmd_export,
        "search": cmd_search,
        "concordance": cmd_concordance,
        "serve": cmd_serve,
        "info": cmd_info,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
