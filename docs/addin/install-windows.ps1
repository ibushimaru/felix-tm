# Felix TM - Windows desktop installer
#
# Downloads the add-in manifest and registers it for sideloading via the
# registry (HKCU\Software\Microsoft\Office\16.0\WEF\Developer). This is
# the same mechanism the official Office dev tooling uses. Current-user
# only - no admin rights needed.
#
# Messages are Japanese: this script is delivered via `irm`, which
# decodes the HTTP response as UTF-8 (charset header), so the console
# codepage doesn't matter. Only running the *file* directly under
# Windows PowerShell 5.1 would garble them (undocumented path, logic
# still ASCII-safe).

$ErrorActionPreference = 'Stop'

$manifestUrl = 'https://ibushimaru.github.io/felix-tm/addin/manifest.xml'
$dir = Join-Path $env:LOCALAPPDATA 'FelixTM'
$manifest = Join-Path $dir 'felix-tm-manifest.xml'
$key = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'

New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -Uri $manifestUrl -OutFile $manifest -UseBasicParsing
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name 'FelixTM' -Value $manifest -PropertyType String -Force | Out-Null

Write-Host ''
Write-Host 'Felix TM を登録しました。'
Write-Host 'Excel を再起動すると、ホームタブの右端に Felix TM ボタンが表示されます。'
Write-Host ''
Write-Host 'アンインストールするには次の2行を実行:'
Write-Host "  Remove-ItemProperty -Path '$key' -Name 'FelixTM'"
Write-Host "  Remove-Item -Recurse -Force '$dir'"
