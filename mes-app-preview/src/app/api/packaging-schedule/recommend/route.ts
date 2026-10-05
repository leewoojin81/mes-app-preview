import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recommendSchedule } from "@/lib/packaging-recommend";

export const runtime = "nodejs";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 계획정보(PLAN-03) "신규 수주 추천" — 아직 계획이 다 잡히지 않은 수주에 납기 순으로 라인·시작일을 추천한다.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("today");
  const today = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : localToday();
  return NextResponse.json({ today, rows: recommendSchedule(getDb(), today) });
}
