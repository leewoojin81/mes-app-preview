import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeProductionTrend } from "@/lib/production-status";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 경영정보 "공정별생산현황(MGMT-05)" 표 하단 그래프용 — line(공정 key)의 올해 추이를
// 월별(1월~전월)+일별(이번달 1일~전일)로 이어 붙여 내려준다.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const line = req.nextUrl.searchParams.get("line");
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (!line) {
    return NextResponse.json({ error: "line 파라미터가 필요합니다." }, { status: 400 });
  }
  const db = getDb();
  try {
    return NextResponse.json(computeProductionTrend(db, line, date ?? undefined));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
