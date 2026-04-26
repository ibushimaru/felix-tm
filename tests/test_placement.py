"""Tests for the Felix placement port (Felix Manual Ch.6).

Mirrors the spec-driven JS suite in plugins/chrome-extension/tests/.
The Python implementation drops the asymmetric diff-region masking
that the Chrome extension layers on top of number_placement; tests
exercise the symmetric / unmasked case only.
"""

from __future__ import annotations

import pytest

from felix_tm.core.placement import (
    GlossaryEntry,
    Rule,
    glossary_placement,
    number_placement,
    rule_placement,
)
from felix_tm.core.segment import (
    apply_casing,
    cmp_len,
    find_word_boundary_index,
    make_cmp,
)


# --------------------------- segment helpers ---------------------------


class TestCmpLen:
    def test_full_width_to_half(self):
        assert cmp_len("ＡＢＣ１２３％") == "abc123%"

    def test_ideographic_space(self):
        assert cmp_len("a　b") == "a b"

    def test_hira_to_kata(self):
        assert cmp_len("あいうえお") == "アイウエオ"

    def test_lowercase(self):
        assert cmp_len("Hello WORLD") == "hello world"

    def test_length_preserved(self):
        for s in ["ＡＢＣ１２３", "日本語", "あいうえお", "mixed 全角"]:
            assert len(cmp_len(s)) == len(s), f"length changed for {s!r}"

    def test_empty(self):
        assert cmp_len("") == ""


class TestMakeCmp:
    def test_strips_tags(self):
        assert make_cmp("<b>hello</b>") == "hello"

    def test_collapses_whitespace(self):
        assert make_cmp("a    b") == "a b"

    def test_idempotent(self):
        for s in ["Hello", "日本語", "<i>tag</i> and  spaces"]:
            once = make_cmp(s)
            assert make_cmp(once) == once


class TestApplyCasing:
    def test_no_alpha_passthrough(self):
        assert apply_casing("123", "abc") == "abc"
        assert apply_casing("日本語", "Light") == "Light"

    def test_all_upper(self):
        assert apply_casing("DARK ELEMENT", "light element") == "LIGHT ELEMENT"

    def test_all_lower(self):
        assert apply_casing("dark element", "Light Element") == "light element"

    def test_title_case(self):
        assert apply_casing("Dark Element", "light element") == "Light Element"

    def test_sentence_case(self):
        assert apply_casing("Dark element damage", "light element damage") == "Light element damage"


class TestFindWordBoundaryIndex:
    def test_inside_larger_word_rejected(self):
        assert find_word_boundary_index("Darkens the area", cmp_len("Dark")) == -1

    def test_standalone_word_found(self):
        assert find_word_boundary_index("Dark area", cmp_len("Dark")) == 0

    def test_at_end_of_string(self):
        assert find_word_boundary_index("type: Dark", cmp_len("Dark")) == 6

    def test_followed_by_punctuation(self):
        assert find_word_boundary_index("Dark, friends", cmp_len("Dark")) == 0

    def test_cjk_skips_boundary_check(self):
        # No alpha → behaves like plain str.find; CJK substring inside
        # a longer CJK string is allowed to match.
        assert find_word_boundary_index("闇属性傷害", cmp_len("闇")) == 0


# --------------------------- glossary_placement ---------------------------


def gloss(*pairs: tuple[str, str]) -> list[GlossaryEntry]:
    return [GlossaryEntry(term=t, translation=tr) for t, tr in pairs]


class TestGlossaryPlacement:
    def test_basic_substitution(self):
        # Single-hole placement: only the part that differs becomes the
        # hole. 光 vs 闇 is one CJK char diff with の…ジ as common
        # suffix, so the glossary has to register the single chars.
        r = glossary_placement(
            "光のダメージ",
            "闇のダメージ",
            "Dark damage",
            gloss(("光", "Light"), ("闇", "Dark")),
        )
        assert r["placed"]
        assert r["target"] == "Light damage"
        assert r["from"] == "闇"
        assert r["to"] == "光"

    def test_no_glossary_match(self):
        r = glossary_placement(
            "光のダメージ",
            "闇のダメージ",
            "Dark damage",
            gloss(("水", "Water")),
        )
        assert not r["placed"]

    def test_query_equals_source_returns_false(self):
        r = glossary_placement(
            "abc", "abc", "xyz",
            gloss(("a", "x")),
        )
        assert not r["placed"]

    def test_empty_inputs_pass_through(self):
        assert not glossary_placement("", "x", "y", gloss(("a", "b")))["placed"]
        assert not glossary_placement("x", "", "y", gloss(("a", "b")))["placed"]
        assert not glossary_placement("x", "y", "", gloss(("a", "b")))["placed"]
        assert not glossary_placement("x", "y", "z", [])["placed"]

    def test_translation_appears_twice_skips(self):
        # Felix is conservative: ambiguous target = skip placement.
        r = glossary_placement(
            "光属性のダメージ",
            "闇属性のダメージ",
            "Dark Dark damage",  # "Dark" twice → ambiguous
            gloss(("光属性", "Light"), ("闇属性", "Dark")),
        )
        assert not r["placed"]

    def test_word_boundary_rejects_inside_larger_word(self):
        # "Dark" inside "Darkens" must NOT trigger.
        r = glossary_placement(
            "光のダメージ",
            "闇のダメージ",
            "Darkens the area by 50",
            gloss(("光", "Light"), ("闇", "Dark")),
        )
        assert not r["placed"]

    def test_casing_preserved_title(self):
        r = glossary_placement(
            "光のダメージ",
            "闇のダメージ",
            "Dark Element damage",
            gloss(
                ("光", "light element"),
                ("闇", "dark element"),
            ),
        )
        assert r["placed"]
        # Title Case in target preserved on substitution.
        assert "Light Element" in r["target"]


# --------------------------- rule_placement ---------------------------


class TestRulePlacement:
    def test_basic_billion_yen_rule(self):
        # Felix manual example: (\d+)(\d)億円 → \1.\2 billion yen
        rules = [Rule(source_pattern=r"(\d+)(\d)億円", target_template=r"\1.\2 billion yen")]
        r = rule_placement(
            "22億円を投資しました。",
            "85億円を投資しました。",
            "Invested 8.5 billion yen.",
            rules,
        )
        assert r["placed"]
        assert r["target"] == "Invested 2.2 billion yen."

    def test_no_match_returns_false(self):
        rules = [Rule(source_pattern=r"\d+ yen", target_template=r"\0")]
        r = rule_placement("hello", "world", "world", rules)
        assert not r["placed"]

    def test_disabled_rule_skipped(self):
        rules = [Rule(source_pattern=r"\d+", target_template=r"X", enabled=False)]
        r = rule_placement("100", "200", "200", rules)
        assert not r["placed"]

    def test_invalid_regex_skipped(self):
        rules = [Rule(source_pattern="[unclosed", target_template="X")]
        r = rule_placement("a", "b", "c", rules)
        assert not r["placed"]

    def test_dict_form_rules_accepted(self):
        rules = [{"source_pattern": r"(\d+)円", "target_template": r"$\1"}]
        r = rule_placement("200円", "100円", "Cost: $100", rules)
        assert r["placed"]
        assert r["target"] == "Cost: $200"


# --------------------------- number_placement ---------------------------


class TestNumberPlacement:
    def test_basic_swap(self):
        r = number_placement("Vamos a ir el 10 de Mayo", "Vamos a ir el 5 de Mayo",
                             "Let's go on May 5")
        assert r["placed"]
        assert r["target"] == "Let's go on May 10"

    def test_multiple_numbers(self):
        r = number_placement(
            "Deals 30% damage for 20 turns",
            "Deals 15% damage for 10 turns",
            "Deals 15% damage for 10 turns",
        )
        assert r["placed"]
        assert r["target"] == "Deals 30% damage for 20 turns"

    def test_decimal_kept_intact(self):
        r = number_placement(
            "Version 2.0 ships",
            "Version 1.5 ships",
            "Version 1.5 ships",
        )
        assert r["placed"]
        assert r["target"] == "Version 2.0 ships"

    def test_full_width_query_matches_half_width_source(self):
        # Full-width digit folds to half-width via cmp_len before
        # extraction, so ３１４ matches 314.
        r = number_placement(
            "Number ３１４ here",
            "Number 1 here",
            "Number 1 here",
        )
        assert r["placed"]
        assert r["target"] == "Number 314 here"

    def test_no_diff_in_numbers_returns_false(self):
        r = number_placement("hello 5", "world 5", "world 5")
        assert not r["placed"]

    def test_count_mismatch_skips(self):
        # Source has two numbers, query has one — ambiguous, skip.
        r = number_placement("a 5", "b 5 and 10", "b 5 and 10")
        assert not r["placed"]

    def test_empty_inputs_skip(self):
        assert not number_placement("", "x", "y")["placed"]
        assert not number_placement("x", "", "y")["placed"]
        assert not number_placement("x", "y", "")["placed"]
