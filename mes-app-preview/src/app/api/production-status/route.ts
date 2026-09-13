import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeProductionStatus } from "@/lib/production-status";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 경영정보 "공정별생산현황(MGMT-05)" — date(기준일자, "YYYY-MM-DD", 생략 시 오늘)를
// 기준으로 라인별 인원·전일/누적생산량·재공품·목표대비 현황을 계산해 내려준다. 계산
// 로직은 src/lib/production-status.ts 한 곳에 모아둔다.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  return NextResponse.json(computeProductionStatus(db, date ?? undefined));
}
