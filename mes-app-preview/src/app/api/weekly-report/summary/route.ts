import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeWeeklyReport, computeWeeklySummary, defaultWeekStart } from "@/lib/weekly-report";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 주간업무보고(PROD-11) "요약" 탭 — 생산실적 표와 수율 추이 차트 데이터(Word 요약 다운로드와 같은 값).
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  const r = computeWeeklyReport(db, date ?? defaultWeekStart(todayStr()));
  return NextResponse.json({
    weekNo: r.weekNo,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    reportDate: r.reportDate,
    summary: computeWeeklySummary(db, r),
  });
}
