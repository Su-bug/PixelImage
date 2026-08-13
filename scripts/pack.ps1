# Pack web zip + Windows exe, and sync Android assets.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$webFiles = @(
  "index.html",
  "styles.css",
  "app.js",
  "pixelate.js",
  "manifest.webmanifest",
  "sw.js"
)

function Sync-WebDir($dest) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $dest "icons") | Out-Null
  foreach ($name in $webFiles) {
    Copy-Item (Join-Path $root $name) (Join-Path $dest $name) -Force
  }
  Copy-Item (Join-Path $root "icons\*") (Join-Path $dest "icons") -Force
}

Write-Host "==> 1/3 web zip"
$webDir = Join-Path $dist "web"
Sync-WebDir $webDir
$zip = Join-Path $dist "pixel-mosaic-web.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $webDir "*") -DestinationPath $zip -Force
Write-Host "    $zip"

Write-Host "==> 2/3 sync Android assets"
$androidWww = Join-Path $root "native\android\app\src\main\assets\www"
Sync-WebDir $androidWww
Write-Host "    $androidWww"

Write-Host "==> 3/3 Windows exe"
$ui = Join-Path $root "native\windows\ui"
Sync-WebDir $ui
Push-Location (Join-Path $root "native\windows")
try {
  if (-not (Test-Path "go.mod")) {
    go mod init pixel-mosaic
  }
  go get github.com/jchv/go-webview2@latest
  go mod tidy
  $exe = Join-Path $dist "PixelMosaic.exe"
  go build -trimpath -ldflags="-s -w -H windowsgui" -o $exe .
  Write-Host "    $exe"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Output in dist:"
Get-ChildItem $dist -File | ForEach-Object { "{0,10:N0}  {1}" -f $_.Length, $_.Name }
Write-Host ""
Write-Host "Android APK: open native\android in Android Studio with JDK 17, then Build > Generate Signed Bundle / APK."
