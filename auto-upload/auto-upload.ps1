<#
  MES 자동 업로드 — 업로드자료 폴더의 "이름_YYYYMMDD.xlsx" 파일을 해당 화면 import API로 올린다.

  - 종류별로 날짜가 가장 최신인 파일 1개만 대상으로 한다.
  - 이미 올린 파일(이름+크기+수정시각이 같음)은 건너뛴다(.local\state.json).
  - 엑셀로 열려 있거나 방금 저장 중인 파일은 건너뛴다(다음 실행 때 다시 시도).
  - 품목(제품정보/자재정보)을 가장 먼저 올린다(수주·순위지정이 품목을 참조하므로).
  - 계정은 setup-credential.ps1 로 저장한 암호화 파일(.local\cred.xml)에서 읽는다.
    (환경변수 MES_USER / MES_PASS 가 있으면 그쪽이 우선)

  사용:  .\auto-upload.ps1 [-DryRun] [-Only 구매발주] [-Force] [-BaseUrl http://localhost:3001]
  종료코드: 0 = 전부 성공(또는 올릴 것 없음), 1 = 하나라도 실패
#>
param(
  [string]$BaseUrl = "http://localhost:3001",
  [string]$Dir = "C:\Users\Administrator\Desktop\mes-system\업로드자료",
  [string]$Only = "",
  [int]$MinAgeSec = 120,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = Join-Path $root ".local"
New-Item -ItemType Directory -Force $local | Out-Null
$logFile = Join-Path $local ("upload-{0}.log" -f (Get-Date -Format yyyyMMdd))
$stateFile = Join-Path $local "state.json"

function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# 올리는 순서 그대로. prefix = 파일명 앞부분, api = import 엔드포인트, cats = 품목 분류 범위
$targets = @(
  @{ prefix = "품목코드현황_제품정보"; api = "items";                     cats = "완제품,반제품" },
  @{ prefix = "품목코드현황_자재정보"; api = "items";                     cats = "원자재" },
  @{ prefix = "수주현황";              api = "sales-orders" },
  @{ prefix = "수주생산순위지정";      api = "production-priority" },
  @{ prefix = "제품출고현황";          api = "product-shipment" },
  @{ prefix = "작업지시현황";          api = "work-order-status" },
  @{ prefix = "도수변경현황";          api = "dosu-change" },
  @{ prefix = "불량종합현황";          api = "defect-type-status" },
  @{ prefix = "일일작업현황";          api = "daily-work-status" },
  @{ prefix = "현재고현황(LOT별)";     api = "inventory-status" },
  @{ prefix = "공정재공현황";          api = "process-wip" },
  @{ prefix = "MOLD입고현황";          api = "mold-receipt-status" },
  @{ prefix = "창고이동현황";          api = "warehouse-transfer-status" },
  @{ prefix = "구매발주현황";          api = "purchase-orders" },
  @{ prefix = "구매입고현황";          api = "purchase-receipts" }
)

# ---- 상태 파일 ----
$state = @{}
if (Test-Path $stateFile) {
  try {
    (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value }
  } catch { Log "state.json 읽기 실패 — 비어 있는 것으로 처리: $($_.Exception.Message)" }
}
function Save-State { ($state | ConvertTo-Json) | Set-Content -Path $stateFile -Encoding UTF8 }

# ---- 올릴 파일 고르기 ----
$plan = @()
foreach ($t in $targets) {
  if ($Only -and $t.prefix -notlike "*$Only*") { continue }
  $rx = '^' + [regex]::Escape($t.prefix) + '_(\d{8})\.xlsx$'
  $cand = Get-ChildItem -LiteralPath $Dir -File -ErrorAction Stop |
    Where-Object { $_.Name -match $rx } |
    Sort-Object { ($_.Name -replace $rx, '$1') } -Descending | Select-Object -First 1
  if (-not $cand) { Log "SKIP  $($t.prefix): 파일 없음"; continue }
  $sig = "{0}|{1}|{2}" -f $cand.Name, $cand.Length, $cand.LastWriteTimeUtc.Ticks
  $skey = "$BaseUrl|$($cand.Name)"
  if (-not $Force -and $state[$skey] -eq $sig) { Log "SKIP  $($cand.Name): 이미 업로드함"; continue }
  if (((Get-Date) - $cand.LastWriteTime).TotalSeconds -lt $MinAgeSec) { Log "WAIT  $($cand.Name): 저장한 지 $MinAgeSec초 미만 — 다음 실행 때 처리"; continue }
  try { $fs = [IO.File]::Open($cand.FullName, 'Open', 'Read', 'None'); $fs.Close() }
  catch { Log "WAIT  $($cand.Name): 다른 프로그램(엑셀 등)이 열고 있음 — 다음 실행 때 처리"; continue }
  $plan += @{ t = $t; file = $cand; sig = $sig; skey = $skey }
}

if ($plan.Count -eq 0) { Log "올릴 파일 없음"; exit 0 }
if ($DryRun) {
  foreach ($p in $plan) { Log ("DRY   {0} -> /api/{1}/import{2}" -f $p.file.Name, $p.t.api, $(if ($p.t.cats) { " (cats=$($p.t.cats))" } else { "" })) }
  exit 0
}

# ---- 계정 ----
$user = $env:MES_USER; $pass = $env:MES_PASS
if (-not $user) {
  $credFile = Join-Path $local "cred.xml"
  if (-not (Test-Path $credFile)) { Log "FAIL  계정 파일 없음 — 먼저 setup-credential.ps1 을 실행하세요"; exit 1 }
  $c = Import-Clixml $credFile
  $user = $c.UserName
  $pass = $c.GetNetworkCredential().Password
}

# ---- 로그인 ----
$jar = Join-Path $env:TEMP ("mes_auto_cookie_{0}.txt" -f $PID)
$body = Join-Path $env:TEMP ("mes_auto_login_{0}.json" -f $PID)
try {
  [IO.File]::WriteAllText($body, (@{ username = $user; password = $pass } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  $login = (& curl.exe -s -m 60 -c $jar -H "Content-Type: application/json" --data-binary "@$body" -w "`nHTTP:%{http_code}" "$BaseUrl/api/auth/login") -join "`n"
} finally { Remove-Item $body -ErrorAction SilentlyContinue }
if ($login -notmatch "HTTP:200") {
  Remove-Item $jar -ErrorAction SilentlyContinue
  Log "FAIL  로그인 실패 ($BaseUrl): $($login -replace '\s+',' ')"
  exit 1
}
Log "로그인 OK ($user, $BaseUrl)"

# ---- 업로드 ----
$failed = 0
try {
  foreach ($p in $plan) {
    $args2 = @("-s", "-m", "900", "-b", $jar, "-w", "`nHTTP:%{http_code}", "-F", "file=@$($p.file.FullName)")
    if ($p.t.cats) { $args2 += @("-F", "cats=$($p.t.cats)") }
    $args2 += "$BaseUrl/api/$($p.t.api)/import"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $out = (& curl.exe @args2) -join "`n"
    $sw.Stop()
    $code = if ($out -match 'HTTP:(\d+)\s*$') { $Matches[1] } else { "?" }
    $json = ($out -replace '\s*HTTP:\d+\s*$', '') -replace '\s+', ' '
    if ($json.Length -gt 400) { $json = $json.Substring(0, 400) + "..." }
    if ($code -eq "200" -and $json -notmatch '"error"') {
      Log ("OK    {0} ({1:N1}s) {2}" -f $p.file.Name, $sw.Elapsed.TotalSeconds, $json)
      $state[$p.skey] = $p.sig
      Save-State
    } else {
      $failed++
      Log ("FAIL  {0} HTTP {1} {2}" -f $p.file.Name, $code, $json)
    }
  }
} finally { Remove-Item $jar -ErrorAction SilentlyContinue }

Log ("완료: 성공 {0} / 실패 {1}" -f ($plan.Count - $failed), $failed)
if ($failed -gt 0) { exit 1 }
exit 0
