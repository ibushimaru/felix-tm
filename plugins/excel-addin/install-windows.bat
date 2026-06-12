@echo off
rem Felix TM - Windows desktop installer
rem Downloads the add-in manifest and registers it for the current user
rem (HKCU - no admin rights needed). Run uninstall-windows.bat to remove.

setlocal
set "DIR=%LOCALAPPDATA%\FelixTM"
set "MANIFEST=%DIR%\felix-tm-manifest.xml"

if not exist "%DIR%" mkdir "%DIR%"

curl -fsSL -o "%MANIFEST%" https://ibushimaru.github.io/felix-tm/addin/manifest.xml
if errorlevel 1 (
  echo Download failed. Check your network connection and try again.
  pause
  exit /b 1
)

reg add "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v FelixTM /t REG_SZ /d "%MANIFEST%" /f >/dev/null

echo.
echo Felix TM registered.
echo Restart Excel, then look for the Felix TM button at the right end
echo of the Home ribbon.
echo.
pause
