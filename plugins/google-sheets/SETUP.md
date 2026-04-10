# Felix TM - Google Sheets Plugin Setup

## セットアップ手順

### 1. Google Sheets を開く

翻訳作業に使うスプレッドシートを開く。

### 2. Apps Script エディタを開く

メニュー → **拡張機能** → **Apps Script**

### 3. ファイルを作成

Apps Script エディタで以下の3ファイルを作成する:

#### FelixTM.gs
1. デフォルトの `コード.gs` を `FelixTM.gs` にリネーム
2. `FelixTM.js` の内容を全てコピー&ペースト

#### Sidebar.html
1. **+** → **HTML** → ファイル名: `Sidebar`
2. `Sidebar.html` の内容を全てコピー&ペースト

#### Settings.html
1. **+** → **HTML** → ファイル名: `Settings`
2. `Settings.html` の内容を全てコピー&ペースト

### 4. 保存 & リロード

1. Apps Script エディタで **Ctrl+S** で保存
2. スプレッドシートのタブをリロード（F5）
3. メニューバーに **Felix TM** メニューが表示される

### 5. 初回認証

**Felix TM** → **Open Sidebar** をクリックすると、Google の認証ダイアログが表示される。
「このアプリは確認されていません」→ 「詳細」→ 「（安全でないページに移動）」で許可する。

## 使い方

### Settings (初回設定)
- **Felix TM** → **Settings** で原文列・訳文列を設定
- デフォルト: Source = A列、Target = B列

### TM 作成
1. 翻訳済みデータがあるシートを開く
2. **Felix TM** → **Open Sidebar** → **Register** タブ
3. **Build TM from Sheet** をクリック → 全行がTMに登録される

### TM 検索 + 訳文挿入
1. サイドバーの **Search** タブ
2. **Get Source** → 選択中のセルの原文を取得して自動検索
3. マッチ結果をクリック → 訳文セルに挿入 + TMに登録 + 次の行に移動

### 用語集
- **Glossary** タブ → 用語と訳語を登録
- **Highlight in Sheet** → 原文列でグロッサリー用語を含むセルを黄色にハイライト
- **Export to Sheet** → 用語集を新しいシートにエクスポート

## データ保存先

- TM データ: `_FelixTM` シート（非表示）
- 用語集データ: `_FelixGlossary` シート（非表示）
- 設定: ドキュメントプロパティ

全てスプレッドシート内に保存されるため、外部サーバー不要。
