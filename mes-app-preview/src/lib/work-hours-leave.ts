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

export interface AttendanceHoursInputs {
  /** 잔업 입력칸에 실제로 타이핑된(또는 마지막 저장분) 신청값 — 출근인 날은 이 값 자체가
   *  최종 저장값이 아니라 아래 계산의 출발점일 뿐이다. */
  overtimeInput: number;
  lateHours: number;
  earlyLeaveHours: number;
  outingHours: number;
  supportHours: number;
}

export interface AttendanceHoursResult {
  normalHours: number;
  overtimeHours: number;
}

// "정상"/"잔업" — 둘 다 사람이 직접 고칠 수 없는 계산값이다(개별 입력·일괄수정 모두에서
// 제외, 2026-09-11 사용자 요청으로 잔업도 정상과 같은 계산값으로 바뀜). 휴가구분이
// "출근"(leaveType이 없음)인 날만 아래 새 계산 순서를 쓴다:
//   1) 지각+조퇴+외출 합계를 구한다(지원시간은 이 합계에서 뺌 — 지원시간은 다른 공정을
//      지원하며 실제로 일한 시간이라 총 근무시간 합계에서 그대로 더해지는 별개 항목).
//   2) 그 합계를 잔업(신청값)에서 먼저 차감한다 — 잔업이 그 합계를 흡수하는 완충 역할.
//   3) 잔업에서 다 못 빼고 남은 초과분이 있으면(잔업이 0이 됐는데도 아직 차감할 게
//      남으면) 그 초과분만큼만 정상근무 8시간에서 마저 뺀다.
//   예) 잔업 2.34, 지각+조퇴+외출 합계 2 → 잔업 0.34, 정상 8(그대로)
//       잔업 2.34, 합계 3 → 잔업 0, 초과분 0.66 → 정상 8-0.66=7.34
//       잔업 2.34, 합계 5 → 잔업 0, 초과분 2.66 → 정상 8-2.66=5.34
// 연차/전반/후반/공가/휴무는 기존 방식을 그대로 유지한다 — 휴가구분별 기준시간(연차 0,
// 전반/후반 4, 공가 0, 휴무 0)에서 지각·조퇴·외출·지원시간을 그대로 빼서 정상을 구하고,
// 잔업은 신청값을 건드리지 않는다(반차 등으로 절반만 근무해도 잔업은 그날 실제로 더
// 일한 시간이라 지각 등과 상계하지 않음). route.ts(GET/PUT)·import/export·화면 미리보기가
// 전부 이 함수 하나를 그대로 써야 값이 어긋나지 않는다.
export function computeAttendanceHours(
  leaveType: string | null | undefined,
  inputs: AttendanceHoursInputs
): AttendanceHoursResult {
  if (!leaveType) {
    const deduction = inputs.lateHours + inputs.earlyLeaveHours + inputs.outingHours;
    const overtimeHours = Math.max(0, inputs.overtimeInput - deduction);
    const excess = Math.max(0, deduction - inputs.overtimeInput);
    return { normalHours: Math.max(0, 8 - excess), overtimeHours };
  }
  const base = BASE_HOURS_BY_LEAVE[leaveType] ?? 8;
  const extraDeduction =
    inputs.lateHours + inputs.earlyLeaveHours + inputs.outingHours + inputs.supportHours;
  return { normalHours: Math.max(0, base - extraDeduction), overtimeHours: inputs.overtimeInput };
}

// 새로 조회하는(아직 저장 안 된) 근태 행의 "휴가" 드롭다운 기본값(2026-09-08 사용자
// 요청) — 생산캘린더(BASE-08)의 그날 구분이 "휴일"이면 휴무, 그 외(평일/특근/캘린더
// 미등록)는 출근(선택 안 함, null)으로 시작한다. 이미 저장된 행은 그 값을 그대로 쓰고
// 이 기본값을 적용하지 않는다(호출부에서 저장 유무를 먼저 확인).
export function defaultLeaveTypeForCalendar(dayType: string | undefined): string | null {
  return dayType === "휴일" ? "휴무" : null;
}
