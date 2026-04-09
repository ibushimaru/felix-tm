"""Text segment with normalization for comparison.

Ported from Felix CAT segment.h / CmpMaker.
Each segment stores three forms:
  - rich: original text (may contain HTML/XML tags)
  - plain: tags stripped
  - cmp: normalized for fuzzy matching
"""

from __future__ import annotations

import re
import unicodedata

# Unicode ranges for CJK detection
_CJK_RANGES = (
    (0x3000, 0x303F),   # CJK Symbols and Punctuation
    (0x3040, 0x309F),   # Hiragana
    (0x30A0, 0x30FF),   # Katakana
    (0x3400, 0x4DBF),   # CJK Unified Ideographs Extension A
    (0x4E00, 0x9FFF),   # CJK Unified Ideographs
    (0xF900, 0xFAFF),   # CJK Compatibility Ideographs
    (0xFF00, 0xFFEF),   # Halfwidth and Fullwidth Forms
    (0x20000, 0x2A6DF), # CJK Unified Ideographs Extension B
)

_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")

# Hiragana to Katakana offset
_HIRA_TO_KATA_OFFSET = 0x60  # カタカナ = ひらがな + 0x60


def contains_cjk(text: str) -> bool:
    """Check if text contains CJK characters."""
    for ch in text:
        cp = ord(ch)
        for start, end in _CJK_RANGES:
            if start <= cp <= end:
                return True
    return False


def strip_tags(text: str) -> str:
    """Remove HTML/XML tags from text."""
    return _TAG_RE.sub("", text)


def normalize_width(text: str) -> str:
    """Convert full-width characters to half-width (NFKC normalization)."""
    return unicodedata.normalize("NFKC", text)


def normalize_hira_to_kata(text: str) -> str:
    """Convert Hiragana characters to Katakana."""
    result = []
    for ch in text:
        cp = ord(ch)
        # Hiragana range: U+3041 - U+3096
        if 0x3041 <= cp <= 0x3096:
            result.append(chr(cp + _HIRA_TO_KATA_OFFSET))
        else:
            result.append(ch)
    return "".join(result)


def normalize_whitespace(text: str) -> str:
    """Collapse whitespace sequences to single space and strip."""
    return _WHITESPACE_RE.sub(" ", text).strip()


class Segment:
    """A text segment with cached normalized forms for matching."""

    __slots__ = ("_rich", "_plain", "_cmp", "_ignore_case", "_ignore_width",
                 "_ignore_hira_kata")

    def __init__(
        self,
        text: str,
        *,
        ignore_case: bool = True,
        ignore_width: bool = True,
        ignore_hira_kata: bool = True,
    ) -> None:
        self._rich = text
        self._ignore_case = ignore_case
        self._ignore_width = ignore_width
        self._ignore_hira_kata = ignore_hira_kata
        self._plain = strip_tags(text)
        self._cmp = self._make_cmp(self._plain)

    def _make_cmp(self, plain: str) -> str:
        """Build normalized comparison string."""
        s = plain
        if self._ignore_width:
            s = normalize_width(s)
        if self._ignore_case:
            s = s.lower()
        if self._ignore_hira_kata:
            s = normalize_hira_to_kata(s)
        s = normalize_whitespace(s)
        return s

    @property
    def rich(self) -> str:
        return self._rich

    @property
    def plain(self) -> str:
        return self._plain

    @property
    def cmp(self) -> str:
        return self._cmp

    def __repr__(self) -> str:
        return f"Segment({self._plain!r})"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Segment):
            return self._cmp == other._cmp
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._cmp)
