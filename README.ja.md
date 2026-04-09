# felix-tm

[English](README.md)

クロスプラットフォーム対応の翻訳メモリエンジン。Python 3 で再実装。

ファジーマッチングアルゴリズムと TM アーキテクチャは、Ryan Ginstrom 氏の
[**Felix CAT System**](http://felix-cat.com/) に着想を得ています
（[Bitbucket 上のオリジナルソース（アーカイブ）](https://web.archive.org/web/20190729035158/https://bitbucket.org/ginstrom/felix)）。

## 特徴

- **ファジーマッチング** — レーベンシュタイン距離による3段階フィルタリング（DB長さフィルタ、文字頻度、編集距離＋早期終了）
- **CJK対応** — 日本語・中国語はは文字レベル、欧文は単語レベルのマッチング（自動判定）
- **テキスト正規化** — 全角/半角変換、ひらがな/カタカナ変換、大小文字統一、HTMLタグ除去
- **SQLiteストレージ** — FTS5全文検索インデックス付き永続ストレージ、正規化済みテキストをプリキャッシュ
- **多フォーマット対応** — TMX 1.4、XLIFF 1.2/2.0、XLSX、TSV（インポート/エクスポート）
- **CLI + ライブラリ** — コマンドラインツールとしても、Pythonパッケージとしても利用可能
- **クロスプラットフォーム** — Windows、macOS、Linux（CI で全環境テスト済み）

## 動作要件

- Python 3.10 以上
- ネイティブ/コンパイル依存なし — 純粋 Python

## インストール

```bash
git clone https://github.com/ibushimaru/felix-tm.git
cd felix-tm
pip install -e .
```

仮想環境を使う場合:

```bash
git clone https://github.com/ibushimaru/felix-tm.git
cd felix-tm
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -e .
```

## 使い方（CLI）

```bash
# 各種フォーマットからインポート
felix-tm import memory.tmx -d my_tm.db                          # TMX
felix-tm import data.xlsx -d my_tm.db --source-col 1 --target-col 2  # Excel
felix-tm import project.xlf -d my_tm.db                         # XLIFF
felix-tm import pairs.tsv -d my_tm.db                            # TSV

# ファジー検索
felix-tm search "The file has been saved" -d my_tm.db
felix-tm search "ファイルが保存された" -d my_tm.db -m 0.7       # 最低スコア70%

# コンコーダンス検索（FTS5による部分文字列検索）
felix-tm concordance "file" -d my_tm.db
felix-tm concordance "保存" -d my_tm.db --field target           # 訳文から検索

# 各種フォーマットへエクスポート
felix-tm export output.tmx -d my_tm.db --source-lang en --target-lang ja
felix-tm export output.xlsx -d my_tm.db
felix-tm export output.xlf -d my_tm.db

# TM情報の表示
felix-tm info -d my_tm.db
```

## 使い方（Python API）

```python
from felix_tm.memory.store import MemoryStore
from felix_tm.memory.record import Record
from felix_tm.memory.search import SearchEngine

# TMデータベースの作成/オープン
with MemoryStore("my_tm.db") as store:
    # レコードの追加
    store.add(Record(source="Hello", target="こんにちは"))
    store.add(Record(source="Goodbye", target="さようなら"))

    # ファジー検索
    engine = SearchEngine(store)
    result = engine.fuzzy_search("Hello world", min_score=0.5)
    for match in result.matches:
        print(f"{match.score:.0%} {match.source} -> {match.target}")

    # コンコーダンス検索
    result = engine.concordance_search("Hello")

    # 逆引き検索（訳文から検索）
    result = engine.reverse_search("こんにちは", min_score=0.5)

    # 用語集検索（文中の用語を検出）
    result = engine.glossary_search("Say Hello to the world", min_score=0.9)
```

### プログラムからのインポート/エクスポート

```python
from felix_tm.io.tmx import import_tmx, export_tmx
from felix_tm.io.xliff import import_xliff, export_xliff
from felix_tm.io.xlsx import import_xlsx, export_xlsx

# ファイルからインポート
records = import_tmx("memory.tmx", source_lang="en", target_lang="ja")
records = import_xliff("project.xlf")
records = import_xlsx("data.xlsx", source_col=1, target_col=3, header_row=1)

# ファイルへエクスポート
export_tmx(records, "output.tmx", source_lang="en", target_lang="ja")
export_xliff(records, "output.xlf", source_lang="en", target_lang="ja", version="2.0")
export_xlsx(records, "output.xlsx")
```

## 謝辞

本プロジェクトは [Felix CAT System](http://felix-cat.com/)（Copyright 1999-2015 Ryan Ginstrom、MIT ライセンス）のコアアルゴリズムを基にしたクリーンルーム再実装です。

Felix CAT は Word/Excel/PowerPoint 連携機能を備えた Windows 用翻訳支援ツールでした。本プロジェクトはその翻訳メモリエンジン（ファジーマッチング、テキスト正規化、TM ストレージ）を、モダンなクロスプラットフォーム Python 3 コードベースに移植したものです。

- **原作者**: [Ryan Ginstrom](https://bitbucket.org/ginstrom/)（Ginstrom IT Solutions）
- **原リポジトリ**: [bitbucket.org/ginstrom/felix](https://web.archive.org/web/20190729035158/https://bitbucket.org/ginstrom/felix)（アーカイブ）
- **原ウェブサイト**: [felix-cat.com](http://felix-cat.com/)
- **原ドキュメント**: [felix-cat.com/media/docs/](http://felix-cat.com/media/docs/)
- **ユーザーマニュアル（日本語）**: [jp.felix-cat.com/media/manuals/jp/felix/](http://jp.felix-cat.com/media/manuals/jp/felix/)

## ライセンス

MIT — 詳細は [LICENSE](LICENSE) を参照。

オリジナル Felix CAT のライセンスは LICENSE ファイルの Third-Party Notices セクションに収録されています。
