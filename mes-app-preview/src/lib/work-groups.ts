// 작업자등록(BASE-09) "공정"(workers.work_group, 자유텍스트)에 실제로 쓰이는 9개 값 —
// 원본 작업자등록.xlsx 대장 기준(2026-09-04). BASE-04 세부 공정코드(P100 등)와 달리
// 이 값들은 workers.work_group·조장 소속공정(user_processes) 셀이 전부 공유하는 단일
// 소스다 — 새로 이 값을 선택지로 쓰는 화면을 추가할 때도 이 상수를 그대로 재사용할 것
// (따로 하드코딩하지 말 것).

// 드롭다운 정렬 기준 공정코드(2026-09-08 사용자 요청 — BASE-04 processes.process_code
// 순으로 정렬) — 이름이 BASE-04 세부공정과 정확히 일치하면 그 코드를 그대로 쓴다
// (사출=P100/외관검사=P360/실링=P370/마킹=P400/출하포장=P410/OEM창고=P500). "인쇄"·
// "조립분리"는 여러 세부공정에 걸쳐 있어 하나로 특정할 수 없어(Base 인쇄 P210·착색
// 인쇄 P220 / 조립 P300·분리1~3 등) 그 묶음의 첫 공정코드를 정렬 기준점으로 쓴다.
// "생산지원"은 BASE-04에 대응하는 공정 자체가 없어(processes 테이블 확인 결과) 정렬
// 기준이 없으므로 맨 뒤로 보낸다.
const WORK_GROUP_SORT_CODE: Record<string, string> = {
  사출: "P100",
  인쇄: "P210",
  조립분리: "P300",
  외관검사: "P360",
  실링: "P370",
  마킹: "P400",
  출하포장: "P410",
  OEM창고: "P500",
};

export const WORK_GROUP_OPTIONS: readonly string[] = [
  "사출",
  "인쇄",
  "조립분리",
  "외관검사",
  "실링",
  "마킹",
  "출하포장",
  "생산지원",
  "OEM창고",
].sort((a, b) => (WORK_GROUP_SORT_CODE[a] ?? "ZZZZ").localeCompare(WORK_GROUP_SORT_CODE[b] ?? "ZZZZ"));
