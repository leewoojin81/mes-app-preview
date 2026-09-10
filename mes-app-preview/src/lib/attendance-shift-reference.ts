import type { DatabaseSync } from "node:sqlite";

// 근태대사(PSN-06)가 세콤(PSN-02) 원본 출근/퇴근 시각으로 지각·조출·잔업을 직접 재계산할
// 때 쓰는 기준시각 — 근무시간정보(PSN-07, shift_time_slots)를 그대로 참조한다(2026-09-09
// 사용자 요청). 세콤 원본을 전수 확인한 결과 근무스케줄이 100% "유동"으로 잡혀 있어
// 지각시간/외출시간/조기출근시간/연장근무시간이 745건 전량 "00:00"이었다 — 세콤이 지각
// 판정 자체를 안 하는 것이라 그 필드를 그대로 못 쓰고, 원본 출근시간/퇴근시간(실제 찍힌
// 시각)만 믿을 수 있다. 그래서 이 값들을 PSN-07 스케줄 기준으로 우리가 직접 계산한다.

// workers.team("근무조", 1조/2조/주간고정)과 shift_time_slots.shift_code(PSN-07, 2026-09-10
// 사용자 요청으로 A조/B조에서 1조/2조로 개명 — 지금은 이름이 같지만 여전히 서로 다른
// 테이블/개념이라 매핑 자체는 남겨둔다)의 대응 — 1조 1Q 시작 07:00, 2조 1Q 시작 16:00이
// 각각 근무조 1조/2조의 정식 출근시각과 정확히 일치해 확인됨(2026-09-09). 주간고정은
// 처음엔 대응되는 교대 스케줄이 없다고 보고 대상에서 뺐었으나(2026-09-09), 실제 카드
// 데이터로 재확인한 결과(2026-09-10, 실링 외 외관검사·OEM창고·사출·인쇄·조립분리·출하포장
// 등 7개 공정 35명 전수) 출근이 04~06시대, 퇴근이 16시 또는 16시10분~18시30분대로 1조
// 스케줄(정규 07:00~16:00, 조출 05:00~07:00, 잔업 16:10~18:30)과 정확히 일치해 —
// "주간고정"은 1조/2조 로테이션 없이 항상 1조 시간대로 고정 근무하는 것으로 확인돼
// 1조로 매핑한다(사용자 확인). "3조"는 2026-09-10 사용자 요청으로 신설 — 1조/2조와 달리
// 별도 시간표로 움직이는 사람이 있어 만든 세 번째 조로, PSN-07에 3조 전용 시간표 구간을
// 등록하면 이 매핑을 통해 그대로 근태대사(PSN-06) 기준으로 쓰인다.
export const TEAM_TO_SHIFT_CODE: Record<string, string> = {
  "1조": "1조",
  "2조": "2조",
  "3조": "3조",
  "주간고정": "1조",
};

// 지각 판정 기준: 정식 출근시각 10분 전까지 카드를 찍어야 정상출근, 그 이후는 지각
// (2026-09-09 사용자 명시 — 예: 1조 07:00 시작 -> 06:50까지 정상, 이후 지각).
const LATE_GRACE_MINUTES = 10;

export interface BreakWindow {
  startMinutes: number;
  endMinutes: number;
}

export interface ShiftReference {
  /** 정식 출근시각(분) — PSN-07 "1Q" 구간 시작시각. */
  normalStartMinutes: number;
  /** 지각 기준시각(분) = normalStartMinutes - 10분. 이 시각을 넘겨 찍으면 지각. */
  lateCutoffMinutes: number;
  /** 조출 구간 길이(분) — PSN-07 "조출" 구간이 없는 조(2조 등)는 0(조출 계산 자체를 안 함). */
  earlyStartCapMinutes: number;
  /** 정식 잔업 시작시각(분) — PSN-07 "잔업" 구간이 없는 조(2조 등)는 null(잔업 계산 안 함). */
  overtimeStartMinutes: number | null;
  /** 정식 퇴근시각(분) = PSN-07 "3Q" 구간 종료시각(조퇴 판정 기준). "3Q"가 없으면 null. */
  normalEndMinutes: number | null;
  /** "휴식"/"식사"로 시작하는 구간들의 [시작,종료]분 — 정상근무시간 계산 시 실제
   *  출퇴근시각과 겹치는 부분만큼만 뺀다(PSN-07 "실 근로시간" 집계와 같은 판단 기준). */
  breakWindows: BreakWindow[];
}

function parseHHMMToMinutes(v: string): number | null {
  const m = v.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

interface SlotRow {
  shift_code: string;
  segment_name: string;
  start_time: string;
  end_time: string;
  work_minutes: number;
  effective_date: string;
}

// PSN-07 화면(shift-time-slots/page.tsx)의 isBreakOrMeal과 같은 판단 기준 — "휴식"/"식사"로
// 시작하는 구간(휴식·휴식2·식사1·식사2 등 변형 포함)은 실 근로시간에서 뺀다.
function isBreakOrMeal(segmentName: string): boolean {
  return segmentName.startsWith("휴식") || segmentName.startsWith("식사");
}

// shift_code별로 가장 최근 effective_date 구간 세트에서 "1Q"/"조출"/"잔업" 구간을 찾아
// 기준시각을 만든다. "1Q"(정식 출근시각)가 없는 조는 기준 자체를 만들 수 없어 맵에서
// 빠진다(그 조 작업자는 지각/조출/잔업 대사를 건너뛴다).
export function fetchShiftReferences(db: DatabaseSync): Map<string, ShiftReference> {
  const rows = db
    .prepare(
      `SELECT shift_code, segment_name, start_time, end_time, work_minutes, effective_date
       FROM shift_time_slots ORDER BY shift_code, effective_date DESC, seq`
    )
    .all() as unknown as SlotRow[];

  const byShift = new Map<string, SlotRow[]>();
  for (const r of rows) {
    if (!byShift.has(r.shift_code)) byShift.set(r.shift_code, []);
    byShift.get(r.shift_code)!.push(r);
  }

  const result = new Map<string, ShiftReference>();
  for (const [shiftCode, slots] of byShift) {
    // 가장 최근 effective_date만 쓴다(같은 shift_code라도 과거 개정본이 섞여 있을 수 있음).
    const latestDate = slots[0]?.effective_date;
    const current = slots.filter((s) => s.effective_date === latestDate);

    const normalStart = current.find((s) => s.segment_name === "1Q");
    if (!normalStart) continue; // 정식 출근시각을 못 찾으면 이 조는 기준 자체가 없음
    const normalStartMinutes = parseHHMMToMinutes(normalStart.start_time);
    if (normalStartMinutes == null) continue;

    const earlyStart = current.find((s) => s.segment_name === "조출");
    const overtime = current.find((s) => s.segment_name === "잔업");
    const overtimeStartMinutes = overtime ? parseHHMMToMinutes(overtime.start_time) : null;
    const normalEnd = current.find((s) => s.segment_name === "3Q");
    const normalEndMinutes = normalEnd ? parseHHMMToMinutes(normalEnd.end_time) : null;

    const breakWindows: BreakWindow[] = [];
    for (const s of current) {
      if (!isBreakOrMeal(s.segment_name)) continue;
      const start = parseHHMMToMinutes(s.start_time);
      const end = parseHHMMToMinutes(s.end_time);
      if (start == null || end == null) continue;
      // 자정을 넘겨 다음날 새벽까지 이어지는 조(3조 19:15~다음날 06:30대, 2026-09-10 신설)는
      // 휴식/식사 구간도 다음날 새벽에 있을 수 있다(3조 식사 01:00~01:45, 휴식 04:30~04:40) —
      // 이전엔 "휴식/식사는 자정을 안 넘긴다"고 가정해 그대로 뒀는데, 이러면 deriveNormalHours가
      // 겹침을 계산할 때 쓰는 축(정식 출근시각 이후로 연속되도록 1440분을 더해 늘린 축)과
      // 안 맞아 겹침이 전혀 안 잡히고 휴게시간이 하나도 안 빠지는 버그가 있었다(2026-09-10
      // 실사례 발견 — 3조 박진석 PSN-02 근로시간이 PSN-01보다 1시간 더 많게 나옴). 정식
      // 출근시각(normalStartMinutes)보다 이른 시각이면 "다음날"로 보고 1440분을 더해 같은
      // 축으로 맞춘다.
      const wrap = start < normalStartMinutes;
      breakWindows.push({
        startMinutes: wrap ? start + 1440 : start,
        endMinutes: wrap ? end + 1440 : end,
      });
    }

    result.set(shiftCode, {
      normalStartMinutes,
      lateCutoffMinutes: normalStartMinutes - LATE_GRACE_MINUTES,
      earlyStartCapMinutes: earlyStart ? earlyStart.work_minutes : 0,
      overtimeStartMinutes,
      normalEndMinutes,
      breakWindows,
    });
  }
  return result;
}

// 세콤 원본 출근시간/퇴근시간은 "HH:MM:SS" 시각 문자열(기간이 아니라 실제 시각)이다 —
// parseCardDuration("HH:MM" 기간 파싱)과는 다른 포맷이라 별도 함수로 둔다.
export function parseCardClockTime(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  return parseHHMMToMinutes(v);
}

// 지각(시간) = max(0, 출근시각 - 지각기준시각). 출근시간이 없으면(결근/미기록) null.
export function deriveLateHours(punchInMinutes: number | null, ref: ShiftReference): number | null {
  if (punchInMinutes == null) return null;
  return Math.max(0, punchInMinutes - ref.lateCutoffMinutes) / 60;
}

// 조출(시간) = max(0, 지각기준시각 - 출근시각), 조출 구간 길이만큼 상한(2026-09-09
// 사용자 확인 — 05:00 이전에 찍어도 조출 구간 자체가 2시간이라 그 이상은 인정 안 함).
// earlyStartCapMinutes=0인 조(조출 구간 자체가 없음, 예: 2조)는 애초에 이 함수를 안 부른다.
export function deriveEarlyStartHours(punchInMinutes: number | null, ref: ShiftReference): number | null {
  if (punchInMinutes == null || ref.earlyStartCapMinutes <= 0) return null;
  const raw = Math.max(0, ref.lateCutoffMinutes - punchInMinutes);
  return Math.min(raw, ref.earlyStartCapMinutes) / 60;
}

// 잔업(시간) = max(0, 퇴근시각 - 정식 잔업시작시각). 잔업 구간이 없는 조(2조 등)나
// 퇴근시간이 없으면 null(대사 대상에서 제외).
export function deriveOvertimeHours(punchOutMinutes: number | null, ref: ShiftReference): number | null {
  if (punchOutMinutes == null || ref.overtimeStartMinutes == null) return null;
  return Math.max(0, punchOutMinutes - ref.overtimeStartMinutes) / 60;
}

// 조퇴(시간) = max(0, 정식 퇴근시각 - 퇴근시각). 지각과 동일하게 그레이스 없이 정확한
// 시간차로 계산한다(2026-09-10 사용자 확인). 2조처럼 정식 퇴근시각이 자정을 넘기는 조는
// deriveNormalHours와 같은 방식으로 punchIn 기준 하루 연속선상으로 보정한다. 정식
// 퇴근시각(3Q 종료)이 없는 조나 출퇴근시각이 없으면 null(대사 대상에서 제외).
export function deriveEarlyLeaveHours(
  punchInMinutes: number | null,
  punchOutMinutes: number | null,
  ref: ShiftReference
): number | null {
  if (punchInMinutes == null || punchOutMinutes == null || ref.normalEndMinutes == null) return null;
  const rawPunchOut = punchOutMinutes < punchInMinutes ? punchOutMinutes + 1440 : punchOutMinutes;
  const rawNormalEnd = ref.normalEndMinutes < ref.normalStartMinutes ? ref.normalEndMinutes + 1440 : ref.normalEndMinutes;
  return Math.max(0, rawNormalEnd - rawPunchOut) / 60;
}

// 정상근무시간(시간) = 정규 근무구간(1조 07:00~16:00, 2조 16:00~01:00 — PSN-07 "1Q"
// 시작~"3Q" 종료)과 실제 출퇴근시각이 겹치는 구간에서, 그 구간과 겹치는 휴게/식사시간만
// 뺀 값이다(2026-09-10 사용자 요청 — 조출/잔업으로 정규 구간 밖에서 더 일한 시간은
// "정상"에 안 들어가야 하는데, 출퇴근시각을 그대로 쓰면 조출·잔업 시간까지 "정상"에
// 섞여 들어갔었다). 출근이 정규 시작보다 이르면(조출) 정규 시작시각으로, 퇴근이 정규
// 종료보다 늦으면(잔업) 정규 종료시각으로 각각 잘라서(clip) 계산한다 — 반대로 지각·조퇴로
// 정규 구간 안쪽에서 실제 출퇴근시각이 더 늦게/일찍 찍히면 그만큼 그대로 줄어든다(PSN-01의
// "정상"이 지각/조퇴 시간을 빼는 것과 같은 결과). 2조처럼 정규 구간이 자정을 넘기는 조는
// deriveEarlyLeaveHours와 같은 방식으로 punchIn 기준 하루 연속선상으로 보정한다. 정규
// 종료시각(3Q 종료)이 없거나 출퇴근시각 중 하나라도 없으면 null.
export function deriveNormalHours(
  punchInMinutes: number | null,
  punchOutMinutes: number | null,
  ref: ShiftReference
): number | null {
  if (punchInMinutes == null || punchOutMinutes == null || ref.normalEndMinutes == null) return null;
  const rawPunchOut = punchOutMinutes < punchInMinutes ? punchOutMinutes + 1440 : punchOutMinutes;
  const rawNormalEnd = ref.normalEndMinutes < ref.normalStartMinutes ? ref.normalEndMinutes + 1440 : ref.normalEndMinutes;

  const effectiveStart = Math.max(punchInMinutes, ref.normalStartMinutes);
  const effectiveEnd = Math.min(rawPunchOut, rawNormalEnd);
  if (effectiveEnd <= effectiveStart) return 0;

  let breakOverlapMinutes = 0;
  for (const w of ref.breakWindows) {
    const overlap = Math.min(effectiveEnd, w.endMinutes) - Math.max(effectiveStart, w.startMinutes);
    if (overlap > 0) breakOverlapMinutes += overlap;
  }

  return Math.max(0, effectiveEnd - effectiveStart - breakOverlapMinutes) / 60;
}
