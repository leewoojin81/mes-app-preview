import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeDefaultAsOfDate } from "@/lib/production-status";

export const runtime = "nodejs";

// 경영정보 "공정별생산현황(MGMT-05)" 기준일 기본값 — 모든 공정에 실적이 있는 마지막 날의 다음날.
export async function GET() {
  return NextResponse.json({ date: computeDefaultAsOfDate(getDb()) });
}
