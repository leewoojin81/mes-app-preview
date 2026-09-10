import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 월별 캘린더 조회 — 등록된 날짜만 내려주고, 나머지는 화면에서 "미등록"으로 표시한다.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year, month는 필수입니다." }, { status: 400 });
  }

  const db = getDb();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = db
    .prepare("SELECT * FROM production_calendar WHERE cal_date LIKE ? ORDER BY cal_date")
    .all(`${prefix}-%`);
  return NextResponse.json(rows);
}
