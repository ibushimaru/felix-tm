"""Felix CAT placement algorithms (Felix Manual Ch.6).

Three placement strategies that take a TM hit (source/target pair) and a
new query, and produce a target-side substitution that reflects the
diff between the query and the TM source:

  glossary_placement: single-hole port of Felix gloss_placement.cpp.
    Compute the differing token span between query and TM source. If
    both holes resolve to a glossary entry, find the source hole's
    translation in the TM target and swap in the query hole's
    translation.

  rule_placement: Felix Rule Manager port. Each rule is a regex with a
    target-side template; if both query and TM source match the rule,
    apply the template to both and substitute the result on the target.

  number_placement: positional digit substitution. Extract digit tokens
    from query, source, and target; when query and source disagree on
    one or more digit tokens, swap the corresponding target tokens.
    The Chrome extension layers a diff-region masking pass on top to
    handle digits embedded in lexical diffs (`ランダム4体 ↔ 全体`); that
    pass depends on a glossary-aware tokenizer not yet ported here, so
    this Python version handles only the symmetric / unmasked case.

All three return a dict-like result {'placed': bool, 'target': str?}.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from .segment import (
    apply_casing,
    cmp_len,
    contains_cjk,
    find_word_boundary_index,
    make_cmp,
)


@dataclass
class GlossaryEntry:
    term: str
    translation: str
    cmp: str = field(default="")

    def __post_init__(self) -> None:
        if not self.cmp:
            self.cmp = make_cmp(self.term)


@dataclass
class Rule:
    source_pattern: str
    target_template: str
    enabled: bool = True


def _entry_cmp(g) -> str:
    """Allow callers to pass GlossaryEntry, dataclass, dict, or namespace."""
    cmp = getattr(g, "cmp", None) if not isinstance(g, dict) else g.get("cmp")
    if cmp:
        return cmp
    term = getattr(g, "term", None) if not isinstance(g, dict) else g.get("term")
    return make_cmp(term or "")


def _entry_field(g, name: str) -> str:
    if isinstance(g, dict):
        return g.get(name, "") or ""
    return getattr(g, name, "") or ""


# --------------------------- glossary placement ---------------------------


def _split_tokens(text: str, use_char: bool) -> list[str]:
    if use_char:
        return list(text)
    # Match the JS tokenize: split on whitespace + simple punctuation,
    # then drop pure-whitespace tokens.
    parts = re.split(r"(\s+|[.,;:!?()\"'\[\]{}<>])", text)
    return [p for p in parts if p and not p.isspace()]


def glossary_placement(
    query: str,
    tm_source: str,
    tm_target: str,
    glossary: Sequence,
) -> dict:
    """Single-hole glossary placement (port of Felix gloss_placement.cpp).

    Returns ``{'placed': True, 'target': new_target, 'from': s_hole,
    'to': q_hole}`` on success; ``{'placed': False}`` otherwise.
    """
    if not query or not tm_source or not tm_target or not glossary:
        return {"placed": False}
    if query == tm_source:
        return {"placed": False}

    q_cmp = make_cmp(query)
    s_cmp = make_cmp(tm_source)
    if q_cmp == s_cmp:
        return {"placed": False}

    use_char = contains_cjk(query)
    q_tokens = _split_tokens(q_cmp, use_char)
    s_tokens = _split_tokens(s_cmp, use_char)

    prefix_len = 0
    while (
        prefix_len < len(q_tokens)
        and prefix_len < len(s_tokens)
        and q_tokens[prefix_len] == s_tokens[prefix_len]
    ):
        prefix_len += 1
    suffix_len = 0
    while (
        suffix_len < len(q_tokens) - prefix_len
        and suffix_len < len(s_tokens) - prefix_len
        and q_tokens[len(q_tokens) - 1 - suffix_len]
        == s_tokens[len(s_tokens) - 1 - suffix_len]
    ):
        suffix_len += 1

    q_hole_tokens = q_tokens[prefix_len: len(q_tokens) - suffix_len]
    s_hole_tokens = s_tokens[prefix_len: len(s_tokens) - suffix_len]
    if not q_hole_tokens or not s_hole_tokens:
        return {"placed": False}

    sep = "" if use_char else " "
    q_hole = sep.join(q_hole_tokens).strip()
    s_hole = sep.join(s_hole_tokens).strip()
    if not q_hole or not s_hole:
        return {"placed": False}

    q_hole_cmp = make_cmp(q_hole)
    s_hole_cmp = make_cmp(s_hole)
    q_gloss_trans: Optional[str] = None
    s_gloss_trans: Optional[str] = None
    for g in glossary:
        gc = _entry_cmp(g)
        if q_gloss_trans is None and gc == q_hole_cmp:
            q_gloss_trans = _entry_field(g, "translation")
        if s_gloss_trans is None and gc == s_hole_cmp:
            s_gloss_trans = _entry_field(g, "translation")
    if not q_gloss_trans or not s_gloss_trans:
        return {"placed": False}

    s_trans_lower = cmp_len(s_gloss_trans)
    idx = find_word_boundary_index(tm_target, s_trans_lower)
    if idx == -1:
        return {"placed": False}
    if find_word_boundary_index(tm_target, s_trans_lower, idx + 1) != -1:
        return {"placed": False}

    sl = idx + len(s_gloss_trans)
    target = (
        tm_target[:idx]
        + apply_casing(tm_target[idx:sl], q_gloss_trans)
        + tm_target[sl:]
    )
    return {"placed": True, "target": target, "from": s_hole, "to": q_hole}


# --------------------------- rule placement ---------------------------


def _apply_template(template: str, groups: Sequence[str]) -> str:
    # Felix syntax: \1, \2, ... refer to capture groups. Group 0 is the
    # whole match.
    def repl(m: re.Match) -> str:
        n = int(m.group(1))
        return groups[n] if n < len(groups) else ""

    return re.sub(r"\\(\d+)", repl, template)


def rule_placement(
    query: str,
    tm_source: str,
    tm_target: str,
    rules: Sequence,
) -> dict:
    """Apply rule-based placements (Felix Rule Manager port).

    Each rule is a (source_pattern, target_template) regex / template
    pair. When both ``query`` and ``tm_source`` match the rule, the
    template is applied to both; if the source-side template result
    appears uniquely in ``tm_target`` it is swapped for the query-side
    result.

    Returns ``{'placed': True, 'target': new_target}`` if any rule
    fired, ``{'placed': False}`` otherwise.
    """
    if not query or not tm_source or not tm_target or not rules:
        return {"placed": False}
    if query == tm_source:
        return {"placed": False}

    result = tm_target
    placed = False
    for rule in rules:
        if isinstance(rule, dict):
            enabled = rule.get("enabled", True)
            pattern = rule.get("source_pattern") or rule.get("sourcePattern")
            template = rule.get("target_template") or rule.get("targetTemplate")
        else:
            enabled = getattr(rule, "enabled", True)
            pattern = getattr(rule, "source_pattern", None) or getattr(
                rule, "sourcePattern", None
            )
            template = getattr(rule, "target_template", None) or getattr(
                rule, "targetTemplate", None
            )
        if enabled is False or not pattern or not template:
            continue
        try:
            re_obj = re.compile(pattern)
        except re.error:
            continue
        s_match = re_obj.search(tm_source)
        q_match = re_obj.search(query)
        if not s_match or not q_match:
            continue
        s_groups = (s_match.group(0),) + s_match.groups()
        q_groups = (q_match.group(0),) + q_match.groups()
        s_replacement = _apply_template(template, s_groups)
        q_replacement = _apply_template(template, q_groups)
        if s_replacement == q_replacement:
            continue
        idx = result.find(s_replacement)
        if idx == -1:
            continue
        if result.find(s_replacement, idx + len(s_replacement)) != -1:
            continue
        result = result[:idx] + q_replacement + result[idx + len(s_replacement):]
        placed = True
    return {"placed": True, "target": result} if placed else {"placed": False}


# --------------------------- number placement ---------------------------


_NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _extract_numbers(text: str) -> list[tuple[str, int, int]]:
    folded = cmp_len(text)
    return [(m.group(0), m.start(), m.end()) for m in _NUM_RE.finditer(folded)]


def number_placement(query: str, tm_source: str, tm_target: str) -> dict:
    """Positional digit substitution.

    Extract digit tokens from query, TM source, and TM target. When the
    three lists agree in length and only some query/source positions
    differ, swap the corresponding target tokens.

    Note: the Chrome extension layers a diff-region masking pass to
    handle digits inside lexical diffs (e.g. the 4 in ``ランダム4体``
    aligned against ``全体``). That pass depends on a glossary-aware
    diff tokenizer not yet ported here; this version skips placement
    in those asymmetric cases rather than getting it wrong.
    """
    if not query or not tm_source or not tm_target:
        return {"placed": False}
    if query == tm_source:
        return {"placed": False}

    q_nums = _extract_numbers(query)
    s_nums = _extract_numbers(tm_source)
    t_nums = _extract_numbers(tm_target)

    # Need symmetric counts for an unambiguous positional swap.
    if not q_nums or len(q_nums) != len(s_nums) or len(t_nums) != len(s_nums):
        return {"placed": False}

    # Apply substitutions in reverse so earlier positions stay valid.
    new_target = tm_target
    placed = False
    folded_target = cmp_len(tm_target)
    for q, s, t in reversed(list(zip(q_nums, s_nums, t_nums))):
        q_val, _, _ = q
        s_val, _, _ = s
        t_val, t_start, t_end = t
        if q_val == s_val:
            continue
        # Source value should equal target value at this slot — that's
        # what makes the slot the matching position. If they differ the
        # alignment is wrong and we bail rather than guess.
        if s_val != t_val:
            return {"placed": False}
        # Replace the target slice with the query value, preserving any
        # leading width-form of the original by writing q_val verbatim
        # (a strict port of the Felix behavior — the placed digit is
        # the query's digit, in its narrow / canonical form).
        new_target = new_target[:t_start] + q_val + new_target[t_end:]
        placed = True

    if not placed:
        return {"placed": False}
    return {"placed": True, "target": new_target}
