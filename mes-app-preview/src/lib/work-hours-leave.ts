// 일일근태입력(PSN-01) "휴가" 드롭다운 — 출근(선택 안 함)/연차/전반/후반/공가/휴무 순서.
// "결근"을 "휴무"로 이름을 바꿨다(db.ts 마이그레이션이 기존 저장값도 함께 바꿔준다).
// 반차는 2026-09-11 사용자 요청으로 전반/후반으로 나뉘었다(둘 다 기준시간은 동일하게
// 4시간 — db.ts 마이그레이션이 기존 "반차" 저장값을 "전반"으로 바꿔준다).
export const LEAVE_TYPE_OPTIONS = ["연차", "전반", "후반", "공가", "휴무"] as const;

// 휴가구분별 "정상" 기준시간(A안, 2026-09-08 사용자 요청) — 더 이상 그날이 평일/휴일인지는
// 보지 않고 휴가구분만으로 정해진다: 출근 8, 연차 0, 전반/후반(반차) 4, 공가 0, 휴무 0.
// 평일/휴일 판단은 생산캘린더(BASE-08)를 기준으로 defaultLeaveTypeForCalendar가 "휴가구분
// 기본값"을 정할 때만 쓰인다.
const BASE_HOURS_BY_LEAVE: Record<string, number> = {
  연차: 0,
  전반: 4,
  후반: 4,
  공가: 0,
  휴무: 0,
};

export interface NormalHoursDeductions {
  lateHours: number;
  earlyLeaveHours: number;
  outingHours: number;
  supportHours: number;
}

// "정상"(정상출근) 시간 — 사람이 직접 고칠 수 없는 계산값이다(개별 입력·일괄수정 모두에서
// 제외). 휴가구분별 기준시간(출근 8, 연차 0, 전반/후반 4, 공가 0, 휴무 0)에서 지각·조퇴·외출·
// 지원시간을 뺀다(A안, 2026-09-08 사용자 요청). 연차/공가/휴무는 기준시간이 이미 0이라
// 지각 등을 더 빼도 결과가 바뀌지 않는다. 지원시간은 다른 공정을 지원하며 실제로 일한
// 시간이라 총 근무시간 합계(computeTotal)에서 다시 더해지므로 총합에서는 상쇄되고,
// 지각/조퇴/외출만 실제로 총합을 줄인다. route.ts(GET/PUT)·import/export·화면 미리보기가
// 전부 이 함수 하나를 그대로 써야 값이 어긋나지 않는다.
export function normalHoursFor(
  leaveType: string | null | undefined,
  deductions: NormalHoursDeductions
): number {
  const base = leaveType ? BASE_HOURS_BY_LEAVE[leaveType] ?? 8 : 8;
  const extraDeduction = deductions.lateHours + deductions.earlyLeaveHours + deductions.outingHours + deductions.supportHours;
  return Math.max(0, base - extraDeduction);
}

// 새로 조회하는(아직 저장 안 된) 근태 행의 "휴가" 드롭다운 기본값(2026-09-08 사용자
// 요청) — 생산캘린더(BASE-08)의 그날 구분이 "휴일"이면 휴무, 그 외(평일/특근/캘린더
// 미등록)는 출근(선택 안 함, null)으로 시작한다. 이미 저장된 행은 그 값을 그대로 쓰고
// 이 기본값을 적용하지 않는다(호출부에서 저장 유무를 먼저 확인).
export function defaultLeaveTypeForCalendar(dayType: string | undefined): string | null {
  return dayType === "휴일" ? "휴무" : null;
}
