"""Integration tests for the full TM workflow."""

import tempfile
from pathlib import Path

from felix_tm.io.tmx import export_tmx, import_tmx
from felix_tm.io.tsv import export_tsv, import_tsv
from felix_tm.io.xliff import export_xliff, import_xliff
from felix_tm.io.xlsx import export_xlsx, import_xlsx
from felix_tm.memory.record import Record
from felix_tm.memory.search import SearchEngine
from felix_tm.memory.store import MemoryStore


class TestMemoryStore:
    def test_add_and_get(self):
        with MemoryStore() as store:
            rec = Record(source="Hello", target="こんにちは")
            rid = store.add(rec)
            assert rid > 0

            got = store.get(rid)
            assert got is not None
            assert got.source == "Hello"
            assert got.target == "こんにちは"

    def test_bulk_add(self):
        with MemoryStore() as store:
            records = [
                Record(source=f"Source {i}", target=f"Target {i}")
                for i in range(100)
            ]
            count = store.add_bulk(records)
            assert count == 100
            assert store.count() == 100

    def test_delete(self):
        with MemoryStore() as store:
            rid = store.add(Record(source="test", target="テスト"))
            store.delete(rid)
            assert store.get(rid) is None

    def test_concordance(self):
        with MemoryStore() as store:
            store.add(Record(source="The quick brown fox", target="素早い茶色の狐"))
            store.add(Record(source="A quick test", target="素早いテスト"))
            store.add(Record(source="Something else", target="別のもの"))

            results = store.concordance("quick")
            assert len(results) == 2


class TestFuzzySearch:
    def _build_store(self) -> MemoryStore:
        store = MemoryStore()
        records = [
            Record(source="The file has been saved.", target="ファイルが保存されました。"),
            Record(source="The file has been deleted.", target="ファイルが削除されました。"),
            Record(source="Save the file.", target="ファイルを保存してください。"),
            Record(source="Open the file.", target="ファイルを開いてください。"),
            Record(source="翻訳メモリシステム", target="Translation memory system"),
            Record(source="翻訳メモリの検索", target="Translation memory search"),
        ]
        store.add_bulk(records)
        return store

    def test_exact_match(self):
        store = self._build_store()
        engine = SearchEngine(store)
        result = engine.fuzzy_search("The file has been saved.", min_score=1.0)
        assert len(result.matches) == 1
        assert result.matches[0].score == 1.0
        store.close()

    def test_fuzzy_match(self):
        store = self._build_store()
        engine = SearchEngine(store)
        result = engine.fuzzy_search("The file has been updated.", min_score=0.5)
        assert len(result.matches) > 0
        # "saved" and "deleted" should both match
        sources = [m.source for m in result.matches]
        assert "The file has been saved." in sources
        store.close()

    def test_japanese_fuzzy(self):
        store = self._build_store()
        engine = SearchEngine(store)
        result = engine.fuzzy_search("翻訳メモリの管理", min_score=0.5)
        assert len(result.matches) > 0
        store.close()

    def test_reverse_search(self):
        store = self._build_store()
        engine = SearchEngine(store)
        result = engine.reverse_search("Translation memory", min_score=0.5)
        assert len(result.matches) > 0
        store.close()


class TestTmxRoundtrip:
    def test_export_import(self):
        records = [
            Record(source="Hello", target="こんにちは", created_by="test"),
            Record(source="Goodbye", target="さようなら"),
        ]

        with tempfile.NamedTemporaryFile(suffix=".tmx", delete=False) as f:
            tmx_path = Path(f.name)

        export_tmx(records, tmx_path, source_lang="en", target_lang="ja")
        imported = import_tmx(tmx_path, source_lang="en", target_lang="ja")

        assert len(imported) == 2
        assert imported[0].source == "Hello"
        assert imported[0].target == "こんにちは"

        tmx_path.unlink()


class TestTsvRoundtrip:
    def test_export_import(self):
        records = [
            Record(source="Hello", target="こんにちは"),
            Record(source="Goodbye", target="さようなら"),
        ]

        with tempfile.NamedTemporaryFile(suffix=".tsv", delete=False) as f:
            tsv_path = Path(f.name)

        export_tsv(records, tsv_path)
        imported = import_tsv(tsv_path)

        assert len(imported) == 2
        assert imported[0].source == "Hello"
        assert imported[0].target == "こんにちは"

        tsv_path.unlink()


class TestXlsxRoundtrip:
    def test_export_import(self):
        records = [
            Record(source="Hello", target="こんにちは"),
            Record(source="Goodbye", target="さようなら"),
            Record(source="Thank you", target="ありがとう", reliability=5, validated=True),
        ]

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            xlsx_path = Path(f.name)

        export_xlsx(records, xlsx_path, source_lang="English", target_lang="Japanese")
        imported = import_xlsx(xlsx_path, source_col=1, target_col=2)

        assert len(imported) == 3
        assert imported[0].source == "Hello"
        assert imported[0].target == "こんにちは"
        assert imported[2].source == "Thank you"
        assert imported[2].target == "ありがとう"

        xlsx_path.unlink()


class TestXliffRoundtrip:
    def test_xliff_12(self):
        records = [
            Record(source="Hello", target="こんにちは", context="greeting"),
            Record(source="Goodbye", target="さようなら"),
        ]

        with tempfile.NamedTemporaryFile(suffix=".xlf", delete=False) as f:
            xlf_path = Path(f.name)

        export_xliff(records, xlf_path, source_lang="en", target_lang="ja", version="1.2")
        imported = import_xliff(xlf_path)

        assert len(imported) == 2
        assert imported[0].source == "Hello"
        assert imported[0].target == "こんにちは"

        xlf_path.unlink()

    def test_xliff_20(self):
        records = [
            Record(source="Save", target="保存"),
            Record(source="Cancel", target="キャンセル"),
        ]

        with tempfile.NamedTemporaryFile(suffix=".xlf", delete=False) as f:
            xlf_path = Path(f.name)

        export_xliff(records, xlf_path, source_lang="en", target_lang="ja", version="2.0")
        imported = import_xliff(xlf_path)

        assert len(imported) == 2
        assert imported[0].source == "Save"
        assert imported[0].target == "保存"

        xlf_path.unlink()


class TestPerformance:
    def test_large_tm_search(self):
        """Test that fuzzy search with DB pre-filtering works on larger datasets."""
        with MemoryStore() as store:
            # Create records with varying lengths to test length filtering
            records = []
            for i in range(500):
                records.append(Record(
                    source=f"Short {i}.", target=f"短い {i}。",
                ))
            for i in range(500):
                records.append(Record(
                    source=f"This is a much longer test sentence number {i} with extra words.",
                    target=f"これは長いテスト文 {i} です。",
                ))
            store.add_bulk(records)
            assert store.count() == 1000

            engine = SearchEngine(store)

            # Search for a short sentence - should filter out long records
            result = engine.fuzzy_search("Short 250.", min_score=0.8, max_results=5)
            assert len(result.matches) > 0
            assert result.matches[0].score == 1.0
            # Length filter should eliminate the 500 long records
            assert result.total_searched < 1000

    def test_search_correctness(self):
        """Test that optimized search returns same results as expected."""
        with MemoryStore() as store:
            store.add(Record(source="The file has been saved.", target="ファイルが保存されました。"))
            store.add(Record(source="The file has been deleted.", target="ファイルが削除されました。"))
            store.add(Record(source="Hello world", target="こんにちは世界"))

            engine = SearchEngine(store)
            result = engine.fuzzy_search("The file has been updated.", min_score=0.5)
            assert len(result.matches) >= 2
            sources = [m.source for m in result.matches]
            assert "The file has been saved." in sources
            assert "The file has been deleted." in sources
