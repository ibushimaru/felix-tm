# Felix TM — Chrome Web Store Listing Copy

This document holds the copy and asset specifications for the Chrome
Web Store listing. Paste the strings below into the Web Store Developer
Dashboard at submission time. All strings are aligned with the
identity baseline in `brand-verification-checklist.md`.

---

## Required text fields

### Extension name (45 char max)

```
Felix TM
```

### Summary / short description (132 char max)

```
Real-time translation memory and glossary for Google Sheets. Local-first, no backend, free for translators.
```
(108 chars)

### Single-purpose description (Web Store form, ~150 chars)

```
Felix TM provides translation memory and glossary lookup for translators working in Google Sheets.
```

### Detailed description (16,384 char max — keep tight)

```
Felix TM is a Chrome extension that brings translation memory (TM) directly into Google Sheets. As you move between cells, Felix TM matches the source-language text against your private TM and shows fuzzy matches in real time. Approve a match with one click and the translation is written into the target column.

Built for translators who work in spreadsheets — software localization, game UI strings, terminology lists, anywhere translation happens row by row.

KEY FEATURES

• Real-time fuzzy matching — Levenshtein-based scoring with bag-distance pre-filtering. Surfaces 65% and above matches as the cursor moves.
• Auto Translate — apply 100% matches across a selected range in one action. Numbers and registered glossary terms are placed automatically.
• Glossary and placement rules — term-level translations with case preservation. Regex placement rules for product names, version strings, and recurring patterns.
• Quality control — flags mismatched numbers, missing ALL CAPS terms, and untranslated glossary entries. Click a flag to register the fix.
• TMX, TSV, and XLSX import / export — bring your existing TM in or share it across tools.
• Local-first and private — your TM lives in your browser's IndexedDB. No backend, no analytics, no third-party trackers. Sheets API calls go straight from your browser to Google.

PRIVACY

Felix TM has no server. Your translation memory and glossary stay in your browser. The spreadsheets OAuth scope is only used when you take an explicit action — Felix TM never reads your sheets in the background. Full privacy policy: https://ibushimaru.github.io/felix-tm/privacy/

OPEN SOURCE

Felix TM is open source under the MIT License. Source, issues, and contributions: https://github.com/ibushimaru/felix-tm

ABOUT FELIX CAT

Felix TM's matching algorithm is inspired by Felix CAT, the Windows-only translation memory tool originally created by Ryan Ginstrom and released under the MIT License. Felix TM is a separate, ground-up re-implementation targeting Google Sheets and the modern web; it is not affiliated with Mr. Ginstrom or the original Felix CAT product.

SUPPORT

Email: ibushimaru@veriscio.com
Issue tracker: https://github.com/ibushimaru/felix-tm/issues
```

### Category

```
Productivity
```

### Language

```
English (primary), Japanese (additional)
```

### Justification for permissions

| Permission | Justification (paste in form) |
|---|---|
| `activeTab` | To detect when the user is on a Google Sheets tab so the side panel can read the active spreadsheet ID. |
| `tabs` | To find the Sheets tab from the side panel context. |
| `scripting` | To inject the content script into Sheets pages (declared statically in the manifest, but the API surface is also requested for future per-tab tweaks). |
| `storage` | Used by the legacy `chrome.storage.local` migration path; the runtime uses IndexedDB. |
| `identity` | To request and revoke OAuth tokens via `chrome.identity.getAuthToken`. |
| `contextMenus` | To add Felix TM's right-click actions on Sheets cells (currently minimal but reserved). |
| `sidePanel` | The Felix TM UI lives in a Chrome side panel. |
| `host_permissions` `https://docs.google.com/spreadsheets/*` | Content script attaches here to observe selection changes and render the in-page overlay. |
| `host_permissions` `https://sheets.googleapis.com/*` | Direct API calls from the service worker. |
| `host_permissions` `https://www.googleapis.com/*` | OAuth user-info endpoint. |

---

### Japanese localization (for `ja` listing variant)

#### Name (Japanese)

```
Felix TM
```

#### Summary (132 char max — Japanese has wider chars; aim for ~70 JP chars)

```
Google Sheets でリアルタイムに動く翻訳メモリと用語集。ローカル完結、サーバーなし、翻訳者向け無料ツール。
```
(57 chars)

#### Detailed description (Japanese)

```
Felix TM は、翻訳メモリ (TM) を Google Sheets に直接持ち込む Chrome 拡張機能です。セル間を移動するたびに、原文を非公開の TM と照合し、あいまい一致候補をサイドパネルにリアルタイムで表示します。マッチをワンクリックで承認すれば、訳文が訳文列に書き戻されます。

スプレッドシート上で作業する翻訳者向け — ソフトウェアローカリゼーション、ゲームの UI 文字列、用語リストなど、行単位での翻訳作業全般に対応します。

主な機能

• リアルタイムあいまい一致 — レーベンシュタイン距離 + バッグ距離の事前フィルタによる高速検索。65% 以上のマッチをカーソル移動と同時に表示。
• Auto Translate — 選択範囲に 100% 一致を一括適用。数字と登録済み用語は自動配置。
• 用語集と配置ルール — 大文字小文字を保ったまま用語単位で訳語を適用。製品名・バージョン文字列・定型パターン用に正規表現ルールも対応。
• 品質チェック — 数字の不一致、訳出漏れの ALL CAPS 用語、未翻訳の用語集項目を検出。フラグをクリックすればその場で用語登録。
• TMX / TSV / XLSX 入出力 — 標準フォーマットでのインポート・エクスポート。既存の TM を取り込んで他ツールと共有可能。
• ローカル完結・プライバシー — TM はブラウザの IndexedDB 内に保存。サーバーなし、アナリティクスなし、サードパーティトラッカーなし。Sheets API はブラウザから Google へ直接通信。

プライバシー

Felix TM にサーバーは存在しません。TM・用語集はすべてご自身のブラウザに留まります。spreadsheets OAuth スコープは、ユーザーが明示的に操作した場合にのみ使用され、バックグラウンドでスプレッドシートを読み取ることは一切ありません。プライバシーポリシー: https://ibushimaru.github.io/felix-tm/privacy/#ja

オープンソース

Felix TM は MIT ライセンスのオープンソースです。ソース・課題・コントリビューション: https://github.com/ibushimaru/felix-tm

Felix CAT について

Felix TM のマッチングアルゴリズムは、Ryan Ginstrom 氏が制作し MIT ライセンスでオープンソース公開した Windows 専用翻訳メモリツール Felix CAT から着想を得ています。Felix TM は独立したプロジェクトであり、Google Sheets と現代の Web 環境を対象に一から再実装したものです。Ginstrom 氏および元 Felix CAT 製品とは関係を持ちません。

サポート

メール: ibushimaru@veriscio.com
課題管理: https://github.com/ibushimaru/felix-tm/issues
```

---

## Visual asset specifications

The actual capture/design work is for the user (ibushimaru-san) to do.
This section documents what each asset must contain so the captures
land on first try.

### Store icon — 128×128 PNG

- File: `plugins/chrome-extension/icons/icon128.png` (already exists).
- Verify it is sharp at 128×128 in the Web Store preview.
- Background should be transparent or pure white. No drop shadows that look ugly when the Web Store renders the tile on a colored background.

### Small promotional tile — 440×280 PNG

- Recommended composition:
  - Felix TM wordmark on the left (occupying ~40% of width).
  - Single screenshot fragment on the right showing the side panel with one fuzzy match visible.
  - Tagline below the wordmark: "Translation Memory for Google Sheets."
- Plain background (white or light gray). No gradient.

### Marquee promotional tile — 1400×560 PNG (optional)

- Skip unless aiming for featured placement. Web Store does not require it for verification.

### Screenshots — 1280×800 PNG (or 640×400), 3–5 required

Capture order. Use the deck-builder sample data (already in
`samples/`) so the screenshots show meaningful content without
exposing real client work.

#### Screenshot 1 — Side panel with fuzzy matches

- Open Sheets with the deck-builder sample, source column populated, a row containing "Draw two cards." active.
- Side panel open, showing 2–3 fuzzy matches with scores.
- Browser chrome cropped or kept consistently across all shots.
- Caption suggestion: "Real-time fuzzy matching against your private TM."

#### Screenshot 2 — Auto Translate in action

- A range of cells selected in column A, side panel showing Auto
  Translate button about to be clicked. Take this just before the
  click so the highlighted button is visible.
- Caption: "Apply 100% matches across a selection in one click."

#### Screenshot 3 — Glossary registration via QC flag

- Cell with a quality-control flag visible (e.g., a number mismatch
  highlighted in red). The QC tooltip / register button visible.
- Caption: "Catch and fix terminology issues as you translate."

#### Screenshot 4 — Settings tab with sign-in state

- Settings tab open in the side panel showing "Signed in as <email>"
  + Sign out button + the column letter / minimum score settings.
- Caption: "Local-first. Your TM stays in your browser."

#### Screenshot 5 (optional) — Import from Sheet

- The Import from Sheet flow showing the range selector and import
  preview.
- Caption: "Import existing translations from any Google Sheet."

### Capture conventions

- Browser zoom 100%.
- macOS: hide the dock during capture (System Settings → Desktop & Dock → Automatically hide and show).
- Use a clean Chrome profile with no other extensions visible in the toolbar.
- Capture at native resolution then downscale; do not upscale.
- Save as PNG, no JPEG artifacts.
- Filenames: `screenshot-1-fuzzy-match.png`, `screenshot-2-auto-translate.png`, etc., placed in `docs/screenshots/` for source control.

---

## Pricing

```
Free
```

(No in-app purchases. No upsell. Single tier.)

---

## Privacy practices form (Web Store)

The Web Store now requires a structured privacy disclosure. Answers:

| Question | Answer |
|---|---|
| Single purpose | "Translation memory and glossary lookup for translators working in Google Sheets." |
| Personally identifiable information | No. |
| Health information | No. |
| Financial / payment information | No. |
| Authentication information | Yes — OAuth token (stored in `chrome.identity` cache, not persisted by us). |
| Personal communications | No. |
| Location | No. |
| Web history | No. |
| User activity | No. |
| Website content | Yes — the user's own spreadsheet content (transient, in-memory). |
| Are user data sold to third parties? | No. |
| Are user data used or transferred for purposes unrelated to the item's single purpose? | No. |
| Are user data used or transferred to determine creditworthiness or for lending? | No. |
| Privacy policy URL | `https://ibushimaru.github.io/felix-tm/privacy/` |

Tick the certification: **"I certify that the use of data complies with the Limited Use requirements of the Chrome Web Store User Data Policy."**
