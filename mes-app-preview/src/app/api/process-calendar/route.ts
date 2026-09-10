import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildProcessCalendarDay } from "@/lib/process-calendar";
import type { CalendarDayType, Process } from "@/lib/types";

export const runtime = "nodejs";

// 선택한 공정의 월별 캘린더 — 등록 여부와 무관하게 그 달의 매일에 대해 계산 결과를
// 내려준다(공정 표준 패턴 + 회사 근무구분 + 날짜별 예외를 합성). 화면이 "미등록"으로
// 표시할지는 각 행의 registered/overridden 플래그로 판단한다.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const processCode = searchParams.get("process_code")?.trim();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year, month는 필수입니다." }, { status: 400 });
  }
  if (!processCode) {
    return NextResponse.json({ error: "process_code는 필수입니다." }, { status: 400 });
  }

  const db = getDb();
  const process = db
    .prepare("SELECT * FROM processes WHERE process_code = ?")
    .get(processCode) as Process | undefined;
  if (!process) {
    return NextResponse.json({ error: "공정을 찾을 수 없습니다." }, { status: 404 });
  }
  if (process.apply_work_pattern_yn === "N") {
    return NextResponse.json(
      { error: "근무패턴 적용여부가 N인 공정은 생산캘린더 계산 대상이 아닙니다." },
      { status: 400 }
    );
  }

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const companyRows = db
    .prepare("SELECT cal_date, day_type, note FROM production_calendar WHERE cal_date LIKE ?")
    .all(`${prefix}-%`) as { cal_date: string; day_type: string; note: string | null }[];
  const companyByDate = new Map(companyRows.map((r) => [r.cal_date, r]));

  const overrideRows = db
    .prepare("SELECT * FROM process_calendar WHERE cal_date LIKE ? AND process_code = ?")
    .all(`${prefix}-%`, processCode) as {
    cal_date: string;
    shift1_active_override: "Y" | "N" | null;
    shift1_ot_start: string | null;
    shift1_ot_end: string | null;
    shift1_ot_meal_minutes: number | null;
    shift2_active_override: "Y" | "N" | null;
    shift2_ot_start: string | null;
    shift2_ot_end: string | null;
    shift2_ot_meal_minutes: number | null;
    note: string | null;
  }[];
  const overrideByDate = new Map(overrideRows.map((r) => [r.cal_date, r]));

  const daysInMonth = new Date(year, month, 0).getDate();
  const pattern = {
    shift1_active_yn: process.shift1_active_yn,
    shift1_start: process.shift1_start,
    shift1_end: process.shift1_end,
    shift1_base_minutes: process.shift1_base_minutes,
    shift2_active_yn: process.shift2_active_yn,
    shift2_start: process.shift2_start,
    shift2_end: process.shift2_end,
    shift2_base_minutes: process.shift2_base_minutes,
  };

  const result = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const calDate = `${prefix}-${String(d).padStart(2, "0")}`;
    const company = companyByDate.get(calDate);
    const override = overrideByDate.get(calDate) ?? null;
    result.push(
      buildProcessCalendarDay(
        calDate,
        processCode,
        (company?.day_type as CalendarDayType | undefined) ?? null,
        company?.note ?? null,
        pattern,
        override
      )
    );
  }

  return NextResponse.json(result);
}
