import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeWeeklyReport, defaultWeekStart } from "@/lib/weekly-report";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 생산관리 "주간업무보고(PROD-11)" — date(그 날짜가 속한 금~목 주차, 생략 시 이미 끝난 가장
// 최근 주차)의 생산계획/실적·공정수율·주요공정 불량률을 집계해 내려준다. 계산은
// src/lib/weekly-report.ts 한 곳에 모은다.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  return NextResponse.json(computeWeeklyReport(getDb(), date ?? defaultWeekStart(todayStr())));
}
