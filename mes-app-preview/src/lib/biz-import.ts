// 작업자등록(BASE-09) "비즈 연동 신규등록"(2026-09-08 사용자 요청) — 외부 "비즈"
// 근태 시스템에서 쓰는 13자리 사번/부서/이름 원본 값을 우리 workers 스키마 값으로
// 변환하는 순수 함수 모음. 화면(workers/page.tsx)의 미리보기와 실제 등록 양쪽에서
// 그대로 재사용한다.

// 비즈사번(13자리) -> workers.employee_no(10자리). 실 사례로 검증된 공식:
// "20" + 비즈사번[0:2] + 비즈사번[2:4] + 비즈사번[4:6] + 비즈사번 끝 2자리(순번).
// 예: "2312180000002" -> "20"+"23"+"12"+"18"+"02" = "2023121802"(실제 재직 중인
// 작업자 사번과 일치, 2026-09-08 확인). 13자리 숫자가 아니면 null.
export function convertBizEmployeeNo(bizEmployeeNo: string): string | null {
  const trimmed = bizEmployeeNo.trim();
  if (!/^\d{13}$/.test(trimmed)) return null;
  return "20" + trimmed.slice(0, 2) + trimmed.slice(2, 4) + trimmed.slice(4, 6) + trimmed.slice(-2);
}

// 변환된 사번(10자리)의 앞 8자리가 그대로 입사일자(YYYYMMDD)다(2026-09-08 사용자 요청
// — 비즈사번이 입력되면 입사일자도 자동으로 채워달라는 요청, 사번 변환 공식 자체가
// "20"+연+월+일+순번이라 이미 그 값을 담고 있음). employeeNo가 정확히 10자리 숫자가
// 아니면 null.
export function hireDateFromEmployeeNo(employeeNo: string): string | null {
  if (!/^\d{10}$/.test(employeeNo)) return null;
  return `${employeeNo.slice(0, 4)}-${employeeNo.slice(4, 6)}-${employeeNo.slice(6, 8)}`;
}

// 비즈이름의 도급사 접두사 — 접두사가 있으면 그 도급사 소속이고, 이름에서 접두사는
// 뺀다. 접두사가 없으면 원청(메디오스) 소속으로 본다. 근태대사(PSN-06)가 세콤 이름의
// 접두사와 대조할 때도 이 표를 그대로 재사용한다(export, src/lib/attendance-audit.ts).
export const BIZ_NAME_PREFIXES: { prefix: string; contractor: string }[] = [
  { prefix: "SJ-", contractor: "제이시스템" },
  { prefix: "IP-", contractor: "태경" },
  { prefix: "HT-", contractor: "휴먼" },
  { prefix: "DO-", contractor: "다온" },
  { prefix: "HM-", contractor: "더휴먼" },
];

export function parseBizName(bizName: string): { name: string; contractor: string } {
  const trimmed = bizName.trim();
  for (const { prefix, contractor } of BIZ_NAME_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { name: trimmed.slice(prefix.length).trim(), contractor };
    }
  }
  return { name: trimmed, contractor: "메디오스" };
}

// parseBizName의 역변환 — 저장된 성명+도급사로 비즈이름 표기를 되살린다(2026-09-08
// 사용자 요청, PSN-05 "초과신청" 다운로드용). 우리 도급사 값 자체는 저장돼 있으니
// (비즈부서와 달리) 완전히 정확하게 복원된다 — 메디오스거나 모르는 도급사면 접두사
// 없이 이름 그대로.
export function formatBizName(workerName: string, contractor: string | null | undefined): string {
  const prefix = BIZ_NAME_PREFIXES.find((p) => p.contractor === contractor)?.prefix;
  return prefix ? `${prefix}${workerName}` : workerName;
}
