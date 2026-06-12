# Felix TM — Excel アドイン（タスクペイン）

Chrome 拡張（`../chrome-extension/`）の Excel 移植版。マッチングエンジン
`felix-engine.js` と IndexedDB 層 `db.js` は拡張と**同一ファイルを共有**
しており（開発サーバが chrome-extension ディレクトリからエイリアス配信）、
このディレクトリには Excel 固有のグルーコード（Office.js）と UI だけがある。

## アーキテクチャ対応表

| Chrome 拡張 | Excel アドイン |
|---|---|
| content.js の DOM スクレイピング（数式バー/名前ボックス） | `getSelectedRange()` |
| Sheets REST API + OAuth | `Range.values`（認証不要） |
| 200ms ポーリング | `DocumentSelectionChanged` イベント |
| background service worker | なし（直接関数呼び出し） |
| フローティングパネル + サイドパネル | 1つのタスクペイン（タブ切替） |

## セットアップ（初回のみ）

```bash
# 1. HTTPS 開発証明書を生成し、キーチェーンに CA を登録
#    （パスワードダイアログが出る）
npx office-addin-dev-certs install
```

**注意:** このコマンドはパスワード承認ダイアログを完了できないと
「成功」と表示しつつ信頼設定が空のままになることがある
（CA がキーチェーンに入るだけで trustRoot が付かない）。
Chrome で `https://localhost:3000/taskpane.html` を開いて
`NET::ERR_CERT_AUTHORITY_INVALID` が出る場合は、手動で信頼登録する:

```bash
security add-trusted-cert -r trustRoot \
  -k ~/Library/Keychains/login.keychain-db \
  ~/.office-addin-dev-certs/ca.crt
```

実行後 Chrome を完全再起動（Cmd+Q）。確認は
`security dump-trust-settings`（エントリが出れば OK）。

## 開発サーバ起動

```bash
npm start    # https://localhost:3000/taskpane.html
```

起動したらブラウザで https://localhost:3000/taskpane.html を開いて
証明書警告が出ないことを確認（出る場合は証明書インストールをやり直す）。

## Excel on the web へのサイドロード

1. https://office.com → Excel → 新規ブック（テスト用ブックでよい）
2. リボン **ホーム → アドイン → 詳細設定を表示 →
   マイアドイン → マイアドインをアップロード**
   （英語 UI: Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in）
3. この `manifest.xml` を選択してアップロード
4. リボンのホームタブ右端に **Felix TM** ボタンが出る → クリックでペインが開く

コード変更後はタスクペインを閉じて開き直すだけで反映される
（サーバは `Cache-Control: no-store` で配信している）。
**manifest.xml を変えた場合のみ**再アップロードが必要。

## Mac 版デスクトップ Excel へのサイドロード（参考）

```bash
cp manifest.xml ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
```

Excel を再起動 → 挿入 → アドイン → 自分のアドイン。

## Windows 版デスクトップ Excel へのサイドロード（参考）

推奨はレジストリ方式（`install-windows.ps1`）。PowerShell で1行:

```powershell
irm https://raw.githubusercontent.com/ibushimaru/felix-tm/main/docs/addin/install-windows.ps1 | iex
```

manifest を `%LOCALAPPDATA%\FelixTM\` にダウンロードし、
`HKCU\Software\Microsoft\Office\16.0\WEF\Developer` に登録する
（公式 dev ツールと同じ仕組み・管理者権限不要）。アンインストールの
コマンドは実行時に表示される。

スクリプトを使いたくない場合の代替は「共有フォルダーカタログ」方式:
フォルダを自分に共有 → トラストセンター → 信頼できるアドインカタログに
`\\PC名\共有名` を追加（メニューに表示にチェック）→ 再起動 →
挿入 → 個人用アドイン → 共有フォルダー タブ。

要件: Microsoft 365 / Office 2021 以降（WebView2）。旧 EdgeHTML/IE
ベースの Office 2016/2019 は taskpane.js のモダン構文が動かないため
対象外。

## データについて

TM・用語集・設定は IndexedDB（ブラウザ／webview ローカル）に保存される。
Chrome 拡張とはオリジンが違うため**データは共有されない** — 移行は
TMX/TSV エクスポート → インポートで行う。

## 未移植（次のマイルストーン）

- Auto Translate（↓ Fuzzy / ↓ Range）— エンジン側のプランナー
  （`planAutoTranslate*` / `buildPlanActions`）は共有済みなので、
  Excel 側は範囲読み取り＋バッチ書き込みのグルーだけ書けばよい
- QC チェック / 検索＆置換 / ルール管理タブ
- セル内文字単位の書式（textFormatRuns 相当）は Office.js に API が
  ないため、ペイン内プレビューのみ（仕様）
