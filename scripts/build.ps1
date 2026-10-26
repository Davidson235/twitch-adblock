# Builds dist/twitch-adblock-<version>.zip with only the files Chrome needs.
# Usage: powershell -File scripts/build.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist "twitch-adblock-$version.zip"
$stage = Join-Path ([IO.Path]::GetTempPath()) "twitch-adblock-$version"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'icons') | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

$files = @(
  'manifest.json'
  'content.js'
  'bridge.js'
  'popup.html'
  'popup.css'
  'popup.js'
  'LICENSE'
  'README.md'
  'README.ru.md'
  'CHANGELOG.md'
)

foreach ($f in $files) { Copy-Item (Join-Path $root $f) (Join-Path $stage $f) }
foreach ($f in @('icon16.png', 'icon32.png', 'icon48.png', 'icon128.png')) {
  Copy-Item (Join-Path $root "icons/$f") (Join-Path $stage "icons/$f")
}
Copy-Item (Join-Path $root '_locales') (Join-Path $stage '_locales') -Recurse

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "built $zip"
