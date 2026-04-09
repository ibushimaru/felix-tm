"""Tests for the Levenshtein distance module."""

from felix_tm.core.distance import (
    bag_distance,
    edit_distance,
    edit_distance_score,
    substring_distance,
)


class TestEditDistance:
    def test_identical(self):
        assert edit_distance("hello", "hello") == 0

    def test_empty_strings(self):
        assert edit_distance("", "") == 0

    def test_one_empty(self):
        assert edit_distance("hello", "") == 5
        assert edit_distance("", "hello") == 5

    def test_single_substitution(self):
        assert edit_distance("hello", "hallo") == 1

    def test_single_insertion(self):
        assert edit_distance("hell", "hello") == 1

    def test_single_deletion(self):
        assert edit_distance("hello", "hell") == 1

    def test_completely_different(self):
        assert edit_distance("abc", "xyz") == 3

    def test_japanese(self):
        assert edit_distance("翻訳メモリ", "翻訳メモリ") == 0
        assert edit_distance("翻訳メモリ", "翻訳辞書") == 3

    def test_early_termination(self):
        dist = edit_distance("abcdefghij", "xyz", max_distance=3)
        assert dist > 3

    def test_prefix_suffix_skip(self):
        # Matching prefix "hel" and suffix "o" should be skipped
        assert edit_distance("hello", "helpo") == 1

    def test_single_char_found(self):
        # "a" in "abc" -> delete b,c = distance 2
        assert edit_distance("a", "abc") == 2
        assert edit_distance("abc", "a") == 2

    def test_single_char_not_found(self):
        # "x" not in "abc" -> delete 2 + substitute 1 = 3
        assert edit_distance("x", "abc") == 3
        assert edit_distance("abc", "x") == 3

    def test_single_char_same(self):
        assert edit_distance("a", "a") == 0


class TestEditDistanceScore:
    def test_perfect_match(self):
        assert edit_distance_score("hello", "hello") == 1.0

    def test_zero_match(self):
        score = edit_distance_score("a", "bcdefg", min_score=0.5)
        assert score == 0.0

    def test_partial_match(self):
        score = edit_distance_score("hello", "hallo")
        assert 0.7 < score < 0.9  # should be 0.8

    def test_both_empty(self):
        assert edit_distance_score("", "") == 1.0


class TestBagDistance:
    def test_identical(self):
        assert bag_distance("hello", "hello") == 0

    def test_anagram(self):
        assert bag_distance("listen", "silent") == 0

    def test_different(self):
        assert bag_distance("abc", "xyz") == 6  # 3 excess each way

    def test_subset(self):
        assert bag_distance("abc", "abcd") == 1


class TestSubstringDistance:
    def test_exact_substring(self):
        assert substring_distance("fox", "the quick brown fox jumps") == 0

    def test_not_found(self):
        assert substring_distance("xyz", "abc") == 3

    def test_fuzzy_substring(self):
        # "fax" vs "fox" in haystack -> 1 substitution
        assert substring_distance("fax", "the quick brown fox") == 1

    def test_empty_needle(self):
        assert substring_distance("", "hello") == 0

    def test_empty_haystack(self):
        assert substring_distance("hello", "") == 5

    def test_japanese_substring(self):
        assert substring_distance("翻訳", "翻訳メモリシステム") == 0

    def test_japanese_fuzzy_substring(self):
        # "翻案" vs "翻訳" -> 1 substitution
        assert substring_distance("翻案", "翻訳メモリ") == 1

    def test_needle_longer_than_haystack(self):
        dist = substring_distance("abcdef", "abc")
        assert dist == 3  # need to delete 3 chars from needle
