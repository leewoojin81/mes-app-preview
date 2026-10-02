import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchEquipmentPreference } from "@/lib/packaging-schedule";

export const runtime = "nodejs";

// 계획정보(PLAN-03) 설비 추천 — 일일작업현황(PROD-10) 출하포장 실적에서 대표코드별 설비 사용 선호도(사용횟수·사용수량·비율)를
// 그때그때 계산해 내려준다. ?rep=25A31-002 로 한 대표코드만 볼 수 있다.
export async function GET(req: NextRequest) {
  const rep = req.nextUrl.searchParams.get("rep")?.trim() || undefined;
  return NextResponse.json({ rows: fetchEquipmentPreference(getDb(), rep) });
}
