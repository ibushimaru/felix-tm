"""Tests for text segment normalization."""

from felix_tm.core.segment import Segment, contains_cjk, normalize_hira_to_kata, strip_tags


class TestContainsCjk:
    def test_english(self):
        assert not contains_cjk("hello world")

    def test_japanese(self):
        assert contains_cjk("翻訳メモリ")

    def test_mixed(self):
        assert contains_cjk("Hello 世界")

    def test_hiragana(self):
        assert contains_cjk("おはよう")

    def test_katakana(self):
        assert contains_cjk("カタカナ")


class TestStripTags:
    def test_html(self):
        assert strip_tags("<b>bold</b>") == "bold"

    def test_nested(self):
        assert strip_tags("<p><b>text</b></p>") == "text"

    def test_no_tags(self):
        assert strip_tags("plain text") == "plain text"


class TestNormalization:
    def test_hira_to_kata(self):
        assert normalize_hira_to_kata("おはよう") == "オハヨウ"

    def test_mixed_hira_kata(self):
        assert normalize_hira_to_kata("おカタカナ") == "オカタカナ"


class TestSegment:
    def test_basic(self):
        seg = Segment("Hello World")
        assert seg.rich == "Hello World"
        assert seg.plain == "Hello World"
        assert seg.cmp == "hello world"  # lowercased

    def test_with_tags(self):
        seg = Segment("<b>Hello</b> World")
        assert seg.plain == "Hello World"
        assert seg.cmp == "hello world"

    def test_japanese_normalization(self):
        seg = Segment("おはよう")
        assert seg.cmp == "オハヨウ"  # hiragana -> katakana + NFKC

    def test_fullwidth(self):
        seg = Segment("ＡＢＣＤ")
        assert seg.cmp == "abcd"  # fullwidth -> halfwidth + lowercase

    def test_equality(self):
        seg1 = Segment("Hello")
        seg2 = Segment("hello")
        assert seg1 == seg2  # case-insensitive comparison
