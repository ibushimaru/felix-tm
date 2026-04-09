"""Integration tests for the full TM workflow."""

import tempfile
from pathlib import Path

from felix_tm.io.tmx import export_tmx, import_tmx
from felix_tm.io.tsv import export_tsv, import_tsv
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
