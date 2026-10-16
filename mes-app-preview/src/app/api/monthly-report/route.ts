import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeMonthlyReport, computeYieldTrend, defaultReportMonth } from "@/lib/monthly-report";

export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 생산관리 "월간업무보고(PROD-12)" — month(YYYY-MM, 생략 시 이미 끝난 가장 최근 달)의 공정별 생산실적·생산성, 인쇄공정,
// 월별 수율, 주요공정 불량률을 집계해 내려준다. 계산은 src/lib/monthly-report.ts 한 곳에 모은다.
// part=trend면 수율 추이 차트(5개 분기+월별, 21개월치를 훑어 오래 걸림)만 따로 내려준다 — 화면은 본문을 먼저 보여준 뒤 이어서 받는다.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (month && !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  const ym = month ?? defaultReportMonth(todayStr());
  const db = getDb();
  if (req.nextUrl.searchParams.get("part") === "trend") {
    return NextResponse.json({ yearMonth: ym, trend: computeYieldTrend(db, ym) });
  }
  return NextResponse.json(computeMonthlyReport(db, ym, false));
}
