# apply-m-defect-3000.ps1 - copy the mobile defect input screen (/m/defect) into mes-app (3000 dev server) ONLY.
# mes-app-preview (3001) folder is not touched. Existing files are not overwritten except the new ones listed below.
# ASCII only on purpose (Windows PowerShell 5.1 + no BOM).
#
# Usage (in C:\Users\Administrator\Desktop\mes-system):
#   powershell -ExecutionPolicy Bypass -File apply-m-defect-3000.ps1
# Then open on a phone (same Wi-Fi):  http://<this PC IP>:3000/m/defect

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$branch = "claude/process-qr-defect-input-design-ntpb2k"
$dst = Join-Path $root "mes-app"
$tmp = Join-Path $env:TEMP ("m-defect-" + (Get-Date -Format "yyyyMMddHHmmss"))

if (-not (Test-Path (Join-Path $dst "package.json"))) { throw "mes-app folder not found: $dst" }

Set-Location $root
git fetch origin $branch
if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

$paths = @(
  "mes-app-preview/src/lib/mobile-defect.ts",
  "mes-app-preview/src/app/m",
  "mes-app-preview/src/app/api/m-defect",
  "mes-app-preview/public/vendor/jsqr-1.4.0.js"
)

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp "m-defect.zip"
git archive --format=zip -o $zip FETCH_HEAD @paths
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$src = Join-Path $tmp "mes-app-preview"
Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length + 1)
  $target = Join-Path $dst $rel
  if (Test-Path $target) { Write-Host "update  $rel" } else { Write-Host "new     $rel" }
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}
Remove-Item -Recurse -Force $tmp

Write-Host ""
Write-Host "Done. 3000 runs in dev mode, so the new screen is picked up without restart."
Write-Host "Phone: http://<this PC IP>:3000/m/defect   (photos are saved in mes-app\data\defect-photos)"
