#!/usr/bin/env python3
"""Subset the site font for GitHub Pages (docs/fonts/).

The landing/privacy pages self-host their font so every OS renders the
same face (the system stack falls apart on Windows, where Yu Gothic
renders thin) without adding a third-party request — the site's privacy
story is "no third-party anything", and a Google Fonts CDN hit would
dilute it.

Current face: Zen Kaku Gothic New (OFL) — chosen for its Hiragino-like
calm. It ships as static weights, so we build one woff2 per used weight.

A full Japanese font is megabytes, so we subset to exactly the
characters the pages use (plus full ASCII and common punctuation as a
buffer). **Rerun this script whenever page text changes** — a character
missing from the subset silently falls back to the system stack for
that glyph.

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
VENDOR = REPO / "vendor"

GF = "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew"
FONTS = [
    # (source ttf, weight, output woff2)
    (f"{GF}/ZenKakuGothicNew-Regular.ttf", 400, "ZenKakuGothicNew-400-subset.woff2"),
    (f"{GF}/ZenKakuGothicNew-Bold.ttf", 700, "ZenKakuGothicNew-700-subset.woff2"),
]

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
    chars = set(BUFFER)
    for page in PAGES:
        chars |= set(page_text(page))
    chars = {c for c in chars if not c.isspace() or c == "　"}
    text = "".join(sorted(chars))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    VENDOR.mkdir(parents=True, exist_ok=True)

    for url, weight, out_name in FONTS:
        src = VENDOR / url.rsplit("/", 1)[-1]
        if not src.exists():
            print(f"Downloading {src.name}")
            urllib.request.urlretrieve(url, src)

        font = TTFont(str(src))
        options = Options()
        options.flavor = "woff2"
        options.notdef_outline = True
        options.layout_features = ["*"]
        subsetter = Subsetter(options=options)
        subsetter.populate(text=text)
        subsetter.subset(font)

        out = OUT_DIR / out_name
        font.save(str(out))
        print(f"{out.relative_to(REPO)}: {out.stat().st_size/1024:.0f} KB ({weight}, {len(chars)} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
