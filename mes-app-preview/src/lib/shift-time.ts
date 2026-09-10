// 근무시간정보(PSN-07) 시작~종료 시각으로 근로시간(분)을 계산하는 순수 함수 —
// 등록/수정 API와 DB 최초 시드(db.ts) 양쪽에서 같은 계산을 공유한다.

export function parseHHMM(v: string): number | null {
  const m = v.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface ShiftMinutesResult {
  minutes: number;
  /** 종료시각이 시작시각보다 이른 경우(다음날로 넘어가는 구간, 예: 2조 3Q 22:15~다음날
   *  01:00) — 화면에서 종료시각 옆에 "(다음날)" 표시용. */
  crossesMidnight: boolean;
}

// start===end(0분)는 입력 실수로 보고 거부한다(null 반환) — 24시간 근무 구간은 이
// 화면의 용도(조출/Q/휴식/식사/잔업 같은 짧은 구간 나열)상 있을 수 없다.
export function computeShiftMinutes(startTime: string, endTime: string): ShiftMinutesResult | null {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start == null || end == null || start === end) return null;
  const crossesMidnight = end < start;
  const minutes = crossesMidnight ? end + 1440 - start : end - start;
  return { minutes, crossesMidnight };
}
