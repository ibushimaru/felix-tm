@echo off
rem Felix TM - Windows desktop installer
rem Thin wrapper around install-windows.ps1 so double-click works; the
rem actual install logic lives in the PowerShell script (single code
rem path, loud errors, stops on the first failure).

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ibushimaru/felix-tm/main/docs/addin/install-windows.ps1 | iex"
if errorlevel 1 (
  echo.
  echo Install FAILED. Please report the error shown above:
  echo https://github.com/ibushimaru/felix-tm/issues
)
pause
