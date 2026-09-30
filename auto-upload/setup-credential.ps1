# 자동 업로드용 MES 로그인 계정을 이 Windows 사용자 계정으로만 풀 수 있게 암호화해서 저장한다.
# 직접 실행해서 아이디/비밀번호를 입력하세요(비밀번호는 화면에 표시되지 않음).
$local = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".local"
New-Item -ItemType Directory -Force $local | Out-Null
$c = Get-Credential -Message "MES 업로드 권한이 있는 계정"
if (-not $c) { "취소됨"; exit 1 }
$c | Export-Clixml (Join-Path $local "cred.xml")
"저장 완료: $local\cred.xml (이 PC의 현재 Windows 사용자만 복호화 가능)"
