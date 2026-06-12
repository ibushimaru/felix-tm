#!/usr/bin/env python3
"""Subset Noto Sans JP for the GitHub Pages site (docs/fonts/).

The landing/privacy pages self-host their font so every OS renders the
same face (the system stack falls apart on Windows, where Yu Gothic
renders thin) without adding a third-party request — the site's privacy
story is "no third-party anything", and a Google Fonts CDN hit would
dilute it.

A full Japanese font is ~9 MB, so we subset to exactly the characters
the pages use (plus full ASCII and common punctuation as a buffer).
**Rerun this script whenever page text changes** — a character missing
from the subset silently falls back to the system stack for that glyph.

Input:  NotoSansJP[wght].ttf (variable font), auto-downloaded if absent
Output: docs/fonts/NotoSansJP-subset.woff2 (variable, wght 100-900)

Usage: .venv/bin/python scripts/build_fonts.py
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parent.parent
PAGES = [REPO / "docs" / "index.html", REPO / "docs" / "privacy" / "index.html"]
OUT_DIR = REPO / "docs" / "fonts"
OUT = OUT_DIR / "NotoSansJP-subset.woff2"
SRC = REPO / "vendor" / "NotoSansJP[wght].ttf"
SRC_URL = "https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"

# Always-included buffer: full ASCII, common JP punctuation/symbols the
# pages are likely to gain in routine edits.
BUFFER = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "、。・「」『』（）〜ー―…※→←↑↓①②③↩✕✎⚙■□▼▲†‡§"
    + "　！？：；＋－×÷＝％＆＃＠０１２３４５６７８９"
)


def page_text(path: Path) -> str:
    html = path.read_text(encoding="utf-8")
    html = re.sub(r"<style.*?</style>", "", html, flags=re.S)
    html = re.sub(r"<script.*?</script>", "", html, flags=re.S)
    return re.sub(r"<[^>]+>", "", html)


def main() -> int:
    if not SRC.exists():
        print(f"Downloading Noto Sans JP → {SRC}")
        SRC.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(SRC_URL, SRC)

    chars = set(BUFFER)
    for page in PAGES:
        chars |= set(page_text(page))
    chars = {c for c in chars if not c.isspace() or c == "　"}

    font = TTFont(str(SRC))
    options = Options()
    options.flavor = "woff2"
    # Keep the wght variation axis so one file covers 400/600/700.
    options.notdef_outline = True
    options.layout_features = ["*"]
    subsetter = Subsetter(options=options)
    subsetter.populate(text="".join(sorted(chars)))
    subsetter.subset(font)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT))
    size = OUT.stat().st_size
    print(f"{OUT.relative_to(REPO)}: {size/1024:.0f} KB, {len(chars)} chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
