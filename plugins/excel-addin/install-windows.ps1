# Felix TM - Windows desktop installer
#
# Downloads the add-in manifest and registers it for sideloading via the
# registry (HKCU\Software\Microsoft\Office\16.0\WEF\Developer). This is
# the same mechanism the official Office dev tooling uses. Current-user
# only - no admin rights needed.
#
# Output messages are ASCII-only on purpose: Windows PowerShell 5.1
# consoles on a legacy codepage garble UTF-8 Japanese.

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
Write-Host 'Felix TM registered.'
Write-Host 'Restart Excel, then look for the Felix TM button at the right end'
Write-Host 'of the Home ribbon.'
Write-Host ''
Write-Host 'To uninstall, run:'
Write-Host "  Remove-ItemProperty -Path '$key' -Name 'FelixTM'"
Write-Host "  Remove-Item -Recurse -Force '$dir'"
