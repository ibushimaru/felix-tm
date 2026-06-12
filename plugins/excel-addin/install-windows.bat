@echo off
rem Felix TM - Windows installer (install-windows.ps1 のラッパー)
rem 実体は PowerShell スクリプト側。失敗時はエラーが上に表示される。

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ibushimaru/felix-tm/main/docs/addin/install-windows.ps1 | iex"
if errorlevel 1 (
  echo.
  echo インストールに失敗しました。上に表示されたエラーを添えてご連絡ください:
  echo https://github.com/ibushimaru/felix-tm/issues
)
pause
