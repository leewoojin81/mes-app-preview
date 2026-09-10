import { calcOtMinutes } from "./production-calendar";
import type { CalendarDayType, ProcessCalendarDay, ShiftInfo } from "./types";

// 생산캘린더(BASE-08) "날짜 × 공정" 3단 계층 계산.
//   1) 공정 표준 패턴(processes.shiftN_*) — BASE-04에서 등록하는 그 공정의 기본값
//   2) 회사 공통 근무구분(production_calendar.day_type) — 평일/휴일/특근
//   3) 날짜×공정 예외(process_calendar) — "이 날짜, 이 공정만" 다를 때만 존재
// 대부분의 (날짜,공정) 조합은 3)이 없고 1)+2)만으로 자동 계산된다.

const FALLBACK_BASE_MINUTES = 480; // 공정이 아직 패턴을 등록 안 했을 때(NULL)의 레거시 기본값

export interface ProcessBasePattern {
  shift1_active_yn: "Y" | "N";
  shift1_start: string | null;
  shift1_end: string | null;
  shift1_base_minutes: number | null;
  shift2_active_yn: "Y" | "N";
  shift2_start: string | null;
  shift2_end: string | null;
  shift2_base_minutes: number | null;
}

export interface ProcessCalendarOverride {
  shift1_active_override: "Y" | "N" | null;
  shift1_ot_start: string | null;
  shift1_ot_end: string | null;
  shift1_ot_meal_minutes: number | null;
  shift2_active_override: "Y" | "N" | null;
  shift2_ot_start: string | null;
  shift2_ot_end: string | null;
  shift2_ot_meal_minutes: number | null;
  note: string | null;
}

function effectiveActive(
  companyDayType: CalendarDayType | null,
  processBaseActiveYn: "Y" | "N",
  override: "Y" | "N" | null
): "Y" | "N" | null {
  if (override === "Y" || override === "N") return override;
  if (companyDayType == null) return null; // 회사 캘린더 자체가 미등록
  if (companyDayType === "휴일") return "N";
  return processBaseActiveYn; // 평일/특근 → 공정 표준 패턴을 따름
}

function buildShiftInfo(
  companyDayType: CalendarDayType | null,
  baseActiveYn: "Y" | "N",
  baseStart: string | null,
  baseEnd: string | null,
  baseMinutes: number | null,
  override: "Y" | "N" | null,
  otStart: string | null,
  otEnd: string | null,
  otMealMinutes: number | null
): ShiftInfo {
  const activeYn = effectiveActive(companyDayType, baseActiveYn, override);
  const resolvedBaseMinutes = baseMinutes ?? FALLBACK_BASE_MINUTES;
  const otMinutes = calcOtMinutes(otStart, otEnd, otMealMinutes);
  return {
    active_yn: activeYn,
    base_minutes: resolvedBaseMinutes,
    start: baseStart,
    end: baseEnd,
    ot_start: otStart,
    ot_end: otEnd,
    ot_meal_minutes: otMealMinutes,
    ot_minutes: otMinutes,
    total_minutes: activeYn === "Y" ? resolvedBaseMinutes + otMinutes : activeYn === "N" ? 0 : null,
  };
}

// 회사 캘린더(day_type)·공정 표준 패턴·예외(override, 없으면 null)를 조합해
// 화면에 내려줄 (날짜,공정) 하루치 결과를 만든다.
export function buildProcessCalendarDay(
  calDate: string,
  processCode: string,
  companyDayType: CalendarDayType | null,
  companyNote: string | null,
  pattern: ProcessBasePattern,
  override: ProcessCalendarOverride | null
): ProcessCalendarDay {
  const shift1 = buildShiftInfo(
    companyDayType,
    pattern.shift1_active_yn,
    pattern.shift1_start,
    pattern.shift1_end,
    pattern.shift1_base_minutes,
    override?.shift1_active_override ?? null,
    override?.shift1_ot_start ?? null,
    override?.shift1_ot_end ?? null,
    override?.shift1_ot_meal_minutes ?? null
  );
  const shift2 = buildShiftInfo(
    companyDayType,
    pattern.shift2_active_yn,
    pattern.shift2_start,
    pattern.shift2_end,
    pattern.shift2_base_minutes,
    override?.shift2_active_override ?? null,
    override?.shift2_ot_start ?? null,
    override?.shift2_ot_end ?? null,
    override?.shift2_ot_meal_minutes ?? null
  );
  return {
    cal_date: calDate,
    process_code: processCode,
    company_day_type: companyDayType,
    company_note: companyNote,
    registered: companyDayType != null,
    overridden: override != null,
    note: override?.note ?? null,
    shift1_active_override: override?.shift1_active_override ?? null,
    shift2_active_override: override?.shift2_active_override ?? null,
    shift1,
    shift2,
    total_minutes:
      (shift1.total_minutes ?? 0) + (shift2.total_minutes ?? 0),
  };
}
