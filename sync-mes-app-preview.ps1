# [DEPRECATED 2026-09-04] 이 스크립트는 더 이상 쓰지 않는다. 대신
# mes-app\scripts\sync-to-preview.ps1 를 쓸 것 — 실행 전 확인 프롬프트와
# mes-preview.db 크기/수정시각 비교(복사 전/후 데이터가 그대로인지 확인)가 추가된
# 버전이다. 이 파일은 기록용으로만 남겨둔다.
#
# mes-app 소스를 mes-app-preview(사내 미리보기 서버, 3001번)로 재동기화한다.
# 코드/설정 파일만 복사하고, 아래 4개는 항상 제외한다:
#   node_modules - mes-app 것을 정션(mklink /J)으로 공유하므로 복사 대상 아님
#   .next        - 인스턴스별 빌드 캐시(공유하면 두 dev 서버가 충돌함)
#   data         - 미리보기 전용 DB(data/mes-preview.db)가 들어있어 절대 덮어쓰면 안 됨
#   .git         - mes-app-preview는 별도 저장소가 아니므로 불필요
#
# 사용법: mes-app 소스를 바꾼 뒤 미리보기에도 반영하고 싶을 때 이 스크립트를 실행.
# (실행 후에는 3001번 서버를 재시작해야 반영됨 — 특히 next.config.ts/DB 스키마가
#  바뀐 경우 .next 캐시가 낡은 상태일 수 있으니 재시작을 권장)

$src = "C:\Users\Administrator\Desktop\mes-system\mes-app"
$dst = "C:\Users\Administrator\Desktop\mes-system\mes-app-preview"

robocopy $src $dst /E /XD node_modules .next data .git /XF tsconfig.tsbuildinfo /NFL /NDL /NJH /NJS
# robocopy는 파일을 하나라도 복사하면 exit code 1을 반환한다(정상). 8 이상만 실제 오류.
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit 1
}

$nodeModulesLink = Join-Path $dst "node_modules"
if (-not (Test-Path $nodeModulesLink)) {
    cmd /c mklink /J "$nodeModulesLink" "$src\node_modules" | Out-Null
    Write-Host "node_modules 정션을 새로 만들었습니다."
}

Write-Host "동기화 완료. next.config.ts/DB 스키마를 바꿨다면 3001번 서버를 재시작하세요."
