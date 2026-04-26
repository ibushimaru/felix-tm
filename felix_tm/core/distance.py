"""Levenshtein edit distance with single-row optimization and early termination.

Ported from Felix CAT distance.cpp.
"""

from __future__ import annotations


def edit_distance(source: str, target: str, max_distance: int | None = None) -> int:
    """Calculate Levenshtein edit distance between two strings.

    Uses single-row optimization (O(min(m,n)) space) and early termination
    when max_distance threshold is exceeded.

    Args:
        source: Source string.
        target: Target string.
        max_distance: Stop early and return max_distance+1 if distance exceeds this.

    Returns:
        Edit distance (number of insertions, deletions, substitutions).
    """
    n = len(source)
    m = len(target)

    # Trivial cases
    if n == 0:
        return m
    if m == 0:
        return n

    # Skip matching prefix
    prefix = 0
    while prefix < n and prefix < m and source[prefix] == target[prefix]:
        prefix += 1

    # Skip matching suffix
    suffix = 0
    while (suffix < n - prefix and suffix < m - prefix
           and source[n - 1 - suffix] == target[m - 1 - suffix]):
        suffix += 1

    # Work on the trimmed portion
    s = source[prefix:n - suffix]
    t = target[prefix:m - suffix]
    n2 = len(s)
    m2 = len(t)

    if n2 == 0:
        return m2
    if m2 == 0:
        return n2

    # Special case: one string is a single character
    # If the char exists in the other string: delete all others = len - 1
    # If not: delete all others + substitute = len
    if n2 == 1:
        return m2 - 1 if s[0] in t else m2
    if m2 == 1:
        return n2 - 1 if t[0] in s else n2

    # Ensure we iterate over the shorter string in the inner loop
    if n2 > m2:
        s, t = t, s
        n2, m2 = m2, n2

    # Single-row DP (Felix's optimization)
    if max_distance is None:
        max_distance = m2  # effectively no limit

    row = list(range(n2 + 1))

    for j in range(1, m2 + 1):
        prev = row[0]
        row[0] = j
        row_min = j  # track minimum in this row for early termination

        for i in range(1, n2 + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            temp = row[i]
            row[i] = min(
                row[i] + 1,      # deletion
                row[i - 1] + 1,  # insertion
                prev + cost,     # substitution
            )
            prev = temp
            if row[i] < row_min:
                row_min = row[i]

        # Early termination
        if row_min > max_distance:
            return max_distance + 1

    return row[n2]


def edit_distance_score(source: str, target: str, min_score: float = 0.0) -> float:
    """Calculate similarity score based on edit distance.

    Score formula (same as Felix): (max_len - distance) / max_len

    Args:
        source: Source string.
        target: Target string.
        min_score: Minimum acceptable score (0.0-1.0). Enables early termination.

    Returns:
        Similarity score between 0.0 and 1.0.
    """
    if not source and not target:
        return 1.0
    high_len = max(len(source), len(target))
    if high_len == 0:
        return 1.0

    # Match Felix's calculation pattern: max_distance = b_len -
    # (size_t)(b_len * minscore). The naive ``high_len * (1 - min_score)``
    # form suffers FP cancellation — at min_score=0.8 the expression
    # 5 * (1 - 0.8) evaluates to 0.9999999999999998 instead of 1.0,
    # which then int-truncates to 0 and rejects every match.
    max_dist = high_len - int(high_len * min_score)

    dist = edit_distance(source, target, max_distance=max_dist)

    if dist > max_dist:
        return 0.0

    return (high_len - dist) / high_len


def bag_distance(source: str, target: str) -> int:
    """Calculate bag-of-characters distance (fast pre-filter).

    Counts unmatched characters between two multisets.
    This gives a LOWER BOUND on the actual edit distance,
    so if bag_distance > threshold, edit_distance will also exceed it.

    Args:
        source: Source string.
        target: Target string.

    Returns:
        Number of unmatched characters.
    """
    # Build character frequency maps
    freq_s: dict[str, int] = {}
    for ch in source:
        freq_s[ch] = freq_s.get(ch, 0) + 1

    freq_t: dict[str, int] = {}
    for ch in target:
        freq_t[ch] = freq_t.get(ch, 0) + 1

    # Count excess characters in each direction
    diff = 0
    all_chars = set(freq_s) | set(freq_t)
    for ch in all_chars:
        diff += abs(freq_s.get(ch, 0) - freq_t.get(ch, 0))

    return diff


def substring_distance(needle: str, haystack: str) -> int:
    """Calculate minimum edit distance of needle as a substring of haystack.

    Uses a modified DP where the first row is all zeros (free start position),
    allowing the needle to match at any position in the haystack.
    The result is the minimum value in the last row of the DP matrix.

    Ported from Felix CAT distance.cpp (substring distance).

    Args:
        needle: The pattern to search for.
        haystack: The text to search in.

    Returns:
        Minimum edit distance of needle against any substring of haystack.
    """
    n = len(needle)
    m = len(haystack)

    if n == 0:
        return 0
    if m == 0:
        return n

    # dp[i][j] = min edits to match needle[0:i] against a substring ending at haystack[j]
    # First row is all zeros: matching can start at any position (free start)
    prev_row = [0] * (m + 1)

    for i in range(1, n + 1):
        curr_row = [i] + [0] * m  # deleting all of needle[0:i] if no haystack consumed
        for j in range(1, m + 1):
            cost = 0 if needle[i - 1] == haystack[j - 1] else 1
            curr_row[j] = min(
                curr_row[j - 1] + 1,    # insert into needle (skip haystack char)
                prev_row[j] + 1,        # delete from needle
                prev_row[j - 1] + cost, # match/substitute
            )
        prev_row = curr_row

    # Minimum over all ending positions in haystack
    return min(prev_row[1:])
