---
name: felix-tm-resume
description: Felix TM プロジェクトの作業を再開するときの起動手順。ユーザーが「再開」「続きをやろう」「felix-tm に戻る」「プロジェクトを開いて」など、このプロジェクトでの作業セッションを始める意図を示したら必ずこのスキルを使う。現状把握（git/デプロイ/テスト）→ 開発環境の起動 → 作業規約の再読み込みまでを一気に行い、ユーザーに「どこから再開するか」を聞ける状態を作る。
---

# Felix TM — 作業再開ブートシーケンス

このプロジェクトは **Excel アドイン**（plugins/excel-addin/、公開中）と
**Chrome 拡張**（plugins/chrome-extension/、当面サポート外）の2形態。
共有エンジンは `plugins/chrome-extension/felix-engine.js`（単一の正）。
アーキテクチャの詳細は CLAUDE.md、フェーズ・方針はメモリ
（phase-and-appsource ほか）を参照。

## 1. 現状把握（毎回必ず）

```bash
git status --short && git log --oneline -5
cd plugins/chrome-extension && npm test 2>&1 | grep -E '^# (tests|pass|fail)'
gh api repos/ibushimaru/felix-tm/pages/builds/latest --jq '{status, commit: .commit[0:7]}'
```

- 未コミットの変更があれば**まず内容を確認**（前セッションの完成済み作業
  なら commit+push してから始める — 過去に49件取り逃した教訓）
- Pages の build commit が HEAD と一致していなければ要調査

## 2. 開発環境

- **タスクペインの動作確認**: preview の launch.json に `excel-addin`
  （https:3000 = Excel 用 / http:3001 = ブラウザ確認用）と `docs`
  （http:3002 = サイト確認用）が定義済み。preview_start で起動
- ブラウザ確認は Office ホスト無しフォールバックで動く（選択追跡のみ無効）。
  選択イベントは `window.getSelectionInfo` を eval で stub すれば再現可能
- 実機は Excel on the web（このアカウント）と ユーザーの Windows 機

## 3. 変更の流れ（種類別）

| 変更対象 | 手順 |
|---|---|
| エンジン (felix-engine.js) | テスト追加 → `npm test` 全パス → 拡張/アドイン両方に効く |
| ペイン UI (taskpane.*) | 編集 → preview で検証 → `python3 scripts/build_addin.py` → push |
| サイト文言 (docs/*.html) | **文面はユーザーに案を提示して承認後** → 編集 → `.venv/bin/python scripts/build_budoux.py` → `.venv/bin/python scripts/build_fonts.py` → push |
| インストーラー (install-*.{bat,ps1,sh}) | 編集 → build_addin.py → push（bat は CRLF/CP932） |

- **commit ごとに push まで**（felix-tm の鉄則）
- デプロイ検証: push → Pages build 完了待ち → `curl "...?cb=$(date +%s)"`
  でキャッシュ回避確認（CDN は既存 URL を最大10分キャッシュ）

## 4. 作業規約（要点のみ — 詳細はメモリ）

- **文言・コピーは実装前に候補提示**。UI テキストは断片で書く（説明口調禁止）
- 色の意味体系: 青=操作できる / 緑=安全 / アンバー=機械がやった（要一瞥）/
  赤=未解決（あなたの仕事）。下線は点線に統一
- 新機能提案より**フィードバック対応・バグ修正を優先**（反応観察フェーズ）
- Sheets 版のテスター対応は提案しない（サポート外）

## 5. 再開時の最初の一言

状態サマリ（HEAD・テスト・デプロイ一致）を1〜2行で報告し、
「今日はどこからやりますか」と聞く。前セッションの未完タスクが
メモリや git log から読み取れる場合はそれを候補として添える。
