import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchPackagingCandidates, PACKAGING_LINES } from "@/lib/packaging-schedule";

export const runtime = "nodejs";

// 계획정보(PLAN-03) 일정 — 수주번호 칸을 오른쪽 클릭했을 때 그 라인에서 포장할 수 있는 수주 후보(납기일 빠른 순)
export async function GET(req: NextRequest) {
  const line = req.nextUrl.searchParams.get("line") ?? "";
  if (!PACKAGING_LINES.some((l) => l.key === line)) {
    return NextResponse.json({ error: "올바른 line이 필요합니다." }, { status: 400 });
  }
  // 납기가 한 달 넘게 지난 수주는 오래된 것으로 보고 뺀다
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  // date는 지금 고치는 칸의 날짜 — 그 칸 자신의 계획은 "이미 계획됨"에서 뺀다
  const date = req.nextUrl.searchParams.get("date");
  // 과거 칸이면 그 날짜 기준 한 달 전까지 납기인 수주를 후보로 본다
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const c = new Date(`${date}T00:00:00`);
    c.setDate(c.getDate() - 30);
    if (c < d) d.setTime(c.getTime());
  }
  const since = fmt(d);
  const except = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, line } : undefined;
  return NextResponse.json({ rows: fetchPackagingCandidates(getDb(), line, since, except) });
}
