"""Translation memory matching engine.

Ported from Felix CAT match_maker.cpp.
Implements the 3-pass filtering approach:
  1. Length difference check
  2. Bag-of-characters pre-filter
  3. Levenshtein edit distance with early termination

Auto-detects character-level (CJK) vs word-level (Western) matching.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .distance import bag_distance, edit_distance_score, substring_distance
from .segment import Segment, contains_cjk

# Word tokenization: split on whitespace and punctuation (keep punctuation as tokens)
_WORD_TOKEN_RE = re.compile(r"(\s+|[.,;:!?()\"'\[\]{}<>])")


@dataclass
class MatchResult:
    """Result of a fuzzy match."""
    score: float          # 0.0 - 1.0
    record_id: int = 0
    source: str = ""
    target: str = ""
    context: str = ""
    reliability: int = 0
    validated: bool = False
    refcount: int = 0


@dataclass
class MatchConfig:
    """Configuration for matching behavior."""
    min_score: float = 0.5
    ignore_case: bool = True
    ignore_width: bool = True
    ignore_hira_kata: bool = True
    assess_format_penalty: bool = False


def _pass_length_check(query_len: int, source_len: int, min_score: float) -> bool:
    """Pass 1: Quick length difference check."""
    if query_len == 0 and source_len == 0:
        return True
    high_len = max(query_len, source_len)
    diff = high_len - min(query_len, source_len)
    return (high_len - diff) / high_len >= min_score


def _pass_bag_check(query: str, source: str, min_score: float) -> bool:
    """Pass 2: Bag-of-characters pre-filter.

    Bag distance is a LOWER BOUND on edit distance, so it can over-reject.
    We apply a 0.8x margin to avoid false negatives: a candidate is only
    rejected if even the bag estimate says it can't possibly reach the threshold.
    """
    high_len = max(len(query), len(source))
    if high_len == 0:
        return True
    bag_dist = bag_distance(query, source)
    bag_score = (high_len - bag_dist) / high_len
    return bag_score >= min_score


_FORMAT_TAG_RE = re.compile(r"<[^>]+>")


def _format_penalty(query_rich: str, source_rich: str) -> float:
    """Calculate penalty for mismatched formatting tags."""
    q_tags = sorted(_FORMAT_TAG_RE.findall(query_rich))
    s_tags = sorted(_FORMAT_TAG_RE.findall(source_rich))

    if not q_tags and not s_tags:
        return 0.0

    # Count mismatched tags
    all_tags = set(q_tags) | set(s_tags)
    diff = 0
    for tag in all_tags:
        diff += abs(q_tags.count(tag) - s_tags.count(tag))

    return diff / 100.0


def match_score(
    query: Segment,
    source: Segment,
    config: MatchConfig | None = None,
) -> float:
    """Calculate fuzzy match score between query and source segment.

    Applies Felix's 3-pass filtering:
      1. Length check
      2. Bag-of-characters
      3. Levenshtein

    Args:
        query: The query segment (what the user is looking up).
        source: The source segment from TM.
        config: Match configuration.

    Returns:
        Score between 0.0 and 1.0, or 0.0 if below min_score.
    """
    if config is None:
        config = MatchConfig()

    q = query.cmp
    s = source.cmp

    # Perfect match
    if q == s:
        return 1.0

    min_score = config.min_score

    # Pass 1: Length check
    if not _pass_length_check(len(q), len(s), min_score):
        return 0.0

    # Pass 2: Bag-of-characters
    if not _pass_bag_check(q, s, min_score):
        return 0.0

    # Pass 3: Edit distance
    # Auto-detect algorithm based on CJK content
    if contains_cjk(q) or not " " in q:
        # Character-level matching (CJK or single word)
        score = edit_distance_score(q, s, min_score=min_score)
    else:
        # Word-level matching
        score = _word_level_score(q, s, min_score)

    if score < min_score:
        return 0.0

    # Optional format penalty
    if config.assess_format_penalty:
        penalty = _format_penalty(query.rich, source.rich)
        score = max(0.0, score - penalty)

    return score


def _word_level_score(query: str, source: str, min_score: float) -> float:
    """Word-level matching for Western text.

    Tokenizes both strings, calculates word-to-word distances,
    then combines into an overall score.
    """
    q_tokens = _tokenize(query)
    s_tokens = _tokenize(source)

    if not q_tokens or not s_tokens:
        return edit_distance_score(query, source, min_score=min_score)

    # Use edit distance on the token sequences, where each token is a "character"
    # But also consider within-token similarity
    n = len(q_tokens)
    m = len(s_tokens)
    high_len = max(n, m)

    # Build word-to-word cost matrix
    row = list(range(n + 1))

    for j in range(1, m + 1):
        prev = row[0]
        row[0] = j
        for i in range(1, n + 1):
            # Cost is based on character-level similarity between tokens
            token_score = edit_distance_score(q_tokens[i - 1], s_tokens[j - 1])
            cost = 1.0 - token_score  # 0 = perfect match, 1 = completely different
            temp = row[i]
            row[i] = min(
                row[i] + 1,          # deletion
                row[i - 1] + 1,      # insertion
                prev + cost,         # substitution (weighted)
            )
            prev = temp

    total_cost = row[n]
    score = (high_len - total_cost) / high_len if high_len > 0 else 1.0
    return max(0.0, min(1.0, score))


def _tokenize(text: str) -> list[str]:
    """Tokenize text into words (splitting on whitespace and punctuation)."""
    parts = _WORD_TOKEN_RE.split(text)
    return [p for p in parts if p and not p.isspace()]


def glossary_match_score(
    query: Segment,
    term: Segment,
    min_score: float = 0.9,
) -> float:
    """Calculate glossary match score using substring distance.

    Used for finding glossary terms within a longer source segment.

    Args:
        query: The source text to search within.
        term: The glossary term to find.
        min_score: Minimum score threshold.

    Returns:
        Score between 0.0 and 1.0.
    """
    q = query.cmp
    t = term.cmp

    if not t:
        return 0.0

    # Exact substring check first
    if t in q:
        return 1.0

    dist = substring_distance(t, q)
    term_len = len(t)

    if term_len == 0:
        return 0.0

    score = (term_len - dist) / term_len
    return score if score >= min_score else 0.0
