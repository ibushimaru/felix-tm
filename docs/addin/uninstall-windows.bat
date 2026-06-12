@echo off
rem Felix TM - Windows desktop uninstaller
rem Removes the sideload registration and downloaded files.

reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v FelixTM /f >/dev/null 2>&1
rmdir /s /q "%LOCALAPPDATA%\FelixTM" 2>/dev/null

echo Felix TM removed. Restart Excel.
pause
