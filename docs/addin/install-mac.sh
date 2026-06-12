#!/bin/sh
# Felix TM - Mac 版 Excel インストーラー
# manifest を Excel のサイドロードフォルダ (wef) に配置するだけ。
set -e

WEF="$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef"
mkdir -p "$WEF"
curl -fsSL -o "$WEF/felix-tm-manifest.xml" https://ibushimaru.github.io/felix-tm/addin/manifest.xml

echo ""
echo "Felix TM を登録しました。"
echo "Excel を再起動し、挿入 → アドイン → 個人用アドイン から Felix TM を開いてください。"
