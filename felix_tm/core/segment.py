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


# Length-preserving 1-to-1 char folds: full→half width, ideographic→
# ASCII space, hiragana→katakana, lowercase. Char indices on the result
# map back to the original text, so this is the form to use anywhere a
# position (find/slice/diff) must remain valid on the original string.
# Mirrors the Chrome extension's cmpLen — single source of truth for
# normalization there, kept in sync here so the placement port behaves
# identically on the same inputs.
def cmp_len(text: str) -> str:
    out = []
    for ch in str(text):
        cp = ord(ch)
        # Full-width ASCII (U+FF01..U+FF5E) → half-width
        if 0xFF01 <= cp <= 0xFF5E:
            out.append(chr(cp - 0xFEE0))
        # Ideographic space → ASCII space
        elif cp == 0x3000:
            out.append(" ")
        # Hiragana → Katakana
        elif 0x3041 <= cp <= 0x3096:
            out.append(chr(cp + _HIRA_TO_KATA_OFFSET))
        else:
            out.append(ch)
    return "".join(out).lower()


def make_cmp(text: str) -> str:
    """Whole-string equality form: cmp_len + tag strip + whitespace collapse."""
    return normalize_whitespace(cmp_len(strip_tags(str(text))))


# Transfer the casing pattern of `src_slice` onto `new_text`. No-op when
# src_slice has no Latin letters (CJK / digits / symbols only), so JA/ZH
# targets pass through unchanged. Mirrors the Chrome extension fix that
# stops glossary substitution from silently lowercasing Title Case
# context. Recognized patterns: ALL UPPER, all lower, Title Case
# (multi-word, every word cap'd), sentence case (first letter only).
_LATIN_RE = re.compile(r"[A-Za-z]")
_FIRST_ALPHA_RE = re.compile(r"[A-Za-z]")
_TITLE_REPLACE_RE = re.compile(r"(^|\s)([a-z])")


def apply_casing(src_slice: str, new_text: str) -> str:
    if not _LATIN_RE.search(src_slice):
        return new_text
    is_upper = src_slice.upper() == src_slice and re.search(r"[A-Z]", src_slice)
    is_lower = src_slice.lower() == src_slice and re.search(r"[a-z]", src_slice)
    if is_upper:
        return new_text.upper()
    if is_lower:
        return new_text.lower()
    words = [w for w in src_slice.split() if w]
    every_word_title = len(words) > 1 and all(
        (m := _FIRST_ALPHA_RE.search(w)) is None or m.group(0).isupper()
        for w in words
    )
    if every_word_title:
        return _TITLE_REPLACE_RE.sub(lambda m: m.group(1) + m.group(2).upper(), new_text)
    first = _FIRST_ALPHA_RE.search(src_slice)
    if first and first.group(0).isupper():
        m = _FIRST_ALPHA_RE.search(new_text)
        if not m:
            return new_text
        i = m.start()
        return new_text[:i] + new_text[i].upper() + new_text[i + 1:]
    return new_text


# Find `from_text` (already cmp_len-folded) in `target` such that the
# match doesn't sit inside a larger Latin word. Length-preserving
# cmp_len means the index returned is also a valid index in `target`.
# Boundary enforcement only kicks in when the match starts/ends with a
# Latin letter — CJK-only or symbol-bordered spans pass through like a
# plain str.find, since those scripts have no word concept.
_ALPHA_RE = re.compile(r"[A-Za-z]")


def find_word_boundary_index(target: str, from_text: str, start_pos: int = 0) -> int:
    tgt_lower = cmp_len(target)
    starts_alpha = bool(re.match(r"[a-z]", from_text))
    ends_alpha = bool(from_text and re.match(r"[a-z]", from_text[-1]))
    if not starts_alpha and not ends_alpha:
        return tgt_lower.find(from_text, start_pos)
    pos = start_pos
    n = len(from_text)
    while True:
        idx = tgt_lower.find(from_text, pos)
        if idx == -1:
            return -1
        before_ok = (
            not starts_alpha
            or idx == 0
            or not _ALPHA_RE.match(target[idx - 1])
        )
        after_idx = idx + n
        after_ok = (
            not ends_alpha
            or after_idx == len(target)
            or not _ALPHA_RE.match(target[after_idx])
        )
        if before_ok and after_ok:
            return idx
        pos = idx + 1


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
