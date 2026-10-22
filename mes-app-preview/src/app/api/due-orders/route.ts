import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchDueOrderLines, fetchDueOrders } from "@/lib/due-orders";

export const runtime = "nodejs";

// 생산계획 납기별수주현황(PLAN-04)
//  GET /api/due-orders            → 진행 중인 수주 목록(순위·주문량·공정재공·조립투입·출하부족)
//  GET /api/due-orders?so=SO...   → 그 수주의 품목·도수별 상세
//  GET /api/due-orders?fresh=1    → 30초 캐시를 무시하고 다시 계산
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const so = sp.get("so");
  const db = getDb();
  if (so) return NextResponse.json(fetchDueOrderLines(db, so.trim()));
  return NextResponse.json(fetchDueOrders(db, sp.get("fresh") === "1"));
}
