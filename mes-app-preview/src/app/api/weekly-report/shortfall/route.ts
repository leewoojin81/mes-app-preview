import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { defaultWeekStart, weekStartOf } from "@/lib/weekly-report";
import { analyzeShortfall, type ShortfallPeriod, type ShortfallProcess } from "@/lib/weekly-shortfall";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 주간업무보고(PROD-11) 주간요약 "원인분석"(2026-10-23 사용자 요청) — 인쇄공정·출하공정 계획대비 달성율 미달 원인.
// process=printing|shipping, period=week(당주)|month(월 누계). 요약 다운로드에는 쓰지 않는다.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  const process = sp.get("process");
  const period = sp.get("period") ?? "week";
  if (date && !DATE_RE.test(date)) return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  if (process !== "printing" && process !== "shipping") return NextResponse.json({ error: "process는 printing 또는 shipping입니다." }, { status: 400 });
  if (period !== "week" && period !== "month") return NextResponse.json({ error: "period는 week 또는 month입니다." }, { status: 400 });
  const weekStart = weekStartOf(date ?? defaultWeekStart(todayStr()));
  const analysis = analyzeShortfall(getDb(), weekStart, process as ShortfallProcess, period as ShortfallPeriod);
  return NextResponse.json({ analysis });
}
