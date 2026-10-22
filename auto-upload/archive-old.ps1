<#
  업로드자료 정리 — "이름_YYYYMMDD.xlsx" 파일을 종류(이름)별로 날짜가 최신인 2개만 남기고
  나머지는 과거DATA 폴더로 옮긴다.

  - 날짜 형식(_YYYYMMDD.xlsx)이 아닌 파일, 엑셀 임시파일(~$...), 하위 폴더는 건드리지 않는다.
  - 과거DATA에 같은 이름 파일이 이미 있으면 덮어쓰지 않고 건너뛴다(로그에 남김).
  - 엑셀로 열려 있는 파일은 옮기지 않는다(다음 날 다시 시도).

  사용:  .\archive-old.ps1 [-Keep 2] [-DryRun]
  로그:  .local\archive-YYYYMMDD.log
#>
param(
  [string]$Dir = "C:\Users\Administrator\Desktop\mes-system\업로드자료",
  [string]$ArchiveName = "과거DATA",
  [int]$Keep = 2,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = Join-Path $root ".local"
New-Item -ItemType Directory -Force $local | Out-Null
$logFile = Join-Path $local ("archive-{0}.log" -f (Get-Date -Format yyyyMMdd))

function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

$archive = Join-Path $Dir $ArchiveName
if (-not $DryRun) { New-Item -ItemType Directory -Force $archive | Out-Null }

$rx = '^(.+)_(\d{8})\.xlsx$'
$groups = Get-ChildItem -LiteralPath $Dir -File |
  Where-Object { $_.Name -match $rx -and -not $_.Name.StartsWith('~$') } |
  Group-Object { $_.Name -replace $rx, '$1' }

$moved = 0; $skipped = 0
foreach ($g in $groups) {
  $old = $g.Group | Sort-Object { $_.Name -replace $rx, '$2' } -Descending | Select-Object -Skip $Keep
  foreach ($f in $old) {
    $dest = Join-Path $archive $f.Name
    if (Test-Path -LiteralPath $dest) { Log "SKIP  $($f.Name): 과거DATA에 같은 이름이 이미 있음"; $skipped++; continue }
    try { $fs = [IO.File]::Open($f.FullName, 'Open', 'Read', 'None'); $fs.Close() }
    catch { Log "SKIP  $($f.Name): 다른 프로그램(엑셀 등)이 열고 있음"; $skipped++; continue }
    if ($DryRun) { Log "DRY   $($f.Name) -> $ArchiveName"; $moved++; continue }
    try {
      Move-Item -LiteralPath $f.FullName -Destination $dest
      Log "MOVE  $($f.Name) -> $ArchiveName"
      $moved++
    } catch { Log "FAIL  $($f.Name): $($_.Exception.Message)"; $skipped++ }
  }
}

Log ("완료: 이동 {0} / 건너뜀 {1} (종류 {2}개, 종류별 최근 {3}개 유지)" -f $moved, $skipped, $groups.Count, $Keep)
exit 0
