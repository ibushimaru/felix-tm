#!/usr/bin/env python3
"""Insert BudouX phrase-boundary break points into the site's Japanese text.

Japanese line wrapping breaks anywhere by default, splitting phrases
mid-word. BudouX (Google's ML line-break model) finds 文節 boundaries;
this script marks them with <wbr> tags at build time, and the page CSS
(`word-break: keep-all`) forbids breaking anywhere else. Build-time
processing keeps the site free of runtime/third-party JavaScript.

Idempotent: existing <wbr> tags are stripped before re-applying, so run
it freely after every text edit. <wbr> is invisible to build_fonts.py's
text extraction (tags are stripped there), so the font subset is
unaffected — but keep the documented order: edit text → this script →
build_fonts.py.

Usage: .venv/bin/python scripts/build_budoux.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import budoux

REPO = Path(__file__).resolve().parent.parent
PAGES = [REPO / "docs" / "index.html", REPO / "docs" / "privacy" / "index.html"]

# Tags whose text content must never gain break points.
SKIP_TAGS = {"style", "script", "code", "pre", "title"}

JP_RE = re.compile(r"[぀-ヿ㐀-鿿]")

parser = budoux.load_default_japanese_parser()


def apply(html: str) -> str:
    html = html.replace("<wbr>", "")
    parts = re.split(r"(<[^>]+>)", html)
    skip_depth = 0
    out = []
    for part in parts:
        if part.startswith("<"):
            tag = re.match(r"</?\s*([a-zA-Z0-9-]+)", part)
            name = tag.group(1).lower() if tag else ""
            if name in SKIP_TAGS:
                if part.startswith("</"):
                    skip_depth = max(0, skip_depth - 1)
                elif not part.endswith("/>"):
                    skip_depth += 1
            out.append(part)
            continue
        if skip_depth or not JP_RE.search(part):
            out.append(part)
            continue
        # Phrase-split each whitespace-run-separated chunk so existing
        # spacing and entities pass through untouched.
        chunks = re.split(r"(\s+|&[a-z]+;)", part)
        out.append("".join(
            "<wbr>".join(parser.parse(c)) if c and JP_RE.search(c) else c
            for c in chunks
        ))
    return "".join(out)


def main() -> int:
    for page in PAGES:
        html = page.read_text(encoding="utf-8")
        result = apply(html)
        page.write_text(result, encoding="utf-8")
        print(f"{page.relative_to(REPO)}: {result.count('<wbr>')} break points")
    return 0


if __name__ == "__main__":
    sys.exit(main())
