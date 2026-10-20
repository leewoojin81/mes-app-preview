# 3000(mes-app) / 3001(mes-app-preview) DB 매일 백업 스크립트.
# 2026-10-21 신설 — 사용자 요청: 매일 새벽 3시, 보관 14일, 3000·3001 둘 다.
#
# - 각 DB를 gzip으로 압축해 mes-system\backups\daily\ 에 <이름>_YYYYMMDD.db.gz 로 저장한다.
#   (DB가 합쳐 약 8GB라 압축 없이 14일치를 두면 디스크 여유 61GB를 넘는다. 압축률 약 10배.)
# - 쓰는 중간에 잘린 파일이 백업으로 남지 않게 .tmp 로 쓰고 끝나면 이름을 바꾼다.
# - 보관기간(기본 14일)이 지난 일일 백업은 지운다. backups\ 의 다른 수동 백업은 건드리지 않는다.
# - 결과는 logs\backup-db.log 에 남긴다.
#
# 수동 실행: powershell -File backup-db.ps1
# 복원: gzip 해제 후 해당 DB 위치에 놓는다(서버를 멈춘 상태에서).
#       예) 3001: mes-app-preview\data\mes-preview.db / 3000: mes-app\data\mes.db

param(
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backupDir = Join-Path $root "backups\daily"
$logFile = Join-Path $root "logs\backup-db.log"
New-Item -ItemType Directory -Force -Path $backupDir, (Split-Path $logFile) | Out-Null

function Log([string]$msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

$targets = @(
    @{ Name = "mes-3000"; Path = Join-Path $root "mes-app\data\mes.db" },
    @{ Name = "mes-3001"; Path = Join-Path $root "mes-app-preview\data\mes-preview.db" }
)
$stamp = Get-Date -Format "yyyyMMdd"
$failed = 0
Log "=== backup start ==="

foreach ($t in $targets) {
    $dst = Join-Path $backupDir ("{0}_{1}.db.gz" -f $t.Name, $stamp)
    $tmp = "$dst.tmp"
    try {
        if (-not (Test-Path $t.Path)) { throw "원본 DB 없음: $($t.Path)" }
        $srcLen = (Get-Item $t.Path).Length
        $free = (Get-PSDrive (Split-Path $backupDir -Qualifier).TrimEnd(":")).Free
        if ($free -lt ($srcLen * 0.5)) { throw "디스크 여유 부족 ($([math]::Round($free/1GB,1)) GB)" }

        # 서버가 쓰고 있어도 읽을 수 있게 공유 모드로 연다
        $in = [IO.File]::Open($t.Path, "Open", "Read", "ReadWrite")
        $out = [IO.File]::Create($tmp)
        $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Fastest)
        try { $in.CopyTo($gz) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose() }

        Move-Item -Path $tmp -Destination $dst -Force
        Log ("{0} OK  원본 {1:N2} GB -> {2:N2} GB  ({3})" -f $t.Name, ($srcLen / 1GB), ((Get-Item $dst).Length / 1GB), (Split-Path $dst -Leaf))
    } catch {
        $failed++
        if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        Log ("{0} FAIL  {1}" -f $t.Name, $_.Exception.Message)
    }
}

# 보관기간 지난 일일 백업 삭제(파일 수정시각 기준)
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $backupDir -Filter "mes-300?_*.db.gz" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Remove-Item $_.FullName -Force
    Log "삭제(보관 ${RetentionDays}일 초과): $($_.Name)"
}

$left = Get-ChildItem -Path $backupDir -Filter "mes-300?_*.db.gz"
Log ("=== backup done: 보관 {0}개, {1:N2} GB, 실패 {2} ===" -f $left.Count, (($left | Measure-Object Length -Sum).Sum / 1GB), $failed)
if ($failed -gt 0) { exit 1 }
