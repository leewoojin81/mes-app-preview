import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchAssemblyRecords, fetchColorStock, fetchDueOrderLines, fetchDueOrders, fetchItemChange } from "@/lib/due-orders";
import { fetchMaterialSupply, summarizeByOrder } from "@/lib/material-supply";

export const runtime = "nodejs";

// 생산계획 납기별수주현황(PLAN-04)
//  GET /api/due-orders            → 진행 중인 수주 목록(순위·주문량·공정재공·조립투입·출하부족)
//  GET /api/due-orders?so=SO...   → 그 수주의 품목·도수별 상세
//  GET /api/due-orders?fresh=1    → 30초 캐시를 무시하고 다시 계산
//  GET /api/due-orders?dosu=품목코드 → 그 품목으로 최근 1개월(조립일자) 조립된 작업지시 기록(도수변경 건 표시)
//  GET /api/due-orders?color=모델   → 그 모델의 착색 현재고(조립창고, LOT별 무도수용/유도수용)
//  GET /api/due-orders?swap=품목코드 → 그 도수로 품목변경할 수 있는 다른 도수 재공(외관검사 측정값 ±0.225)
//  GET /api/due-orders?materials=1 → 수주별 자재일정(실링지·단상자·라벨·설명서) — 자재수급(PUR-03) 계산을 그대로 쓴다.
//                                     PUR-03 권한이 없는 PLAN-04 사용자도 보도록 /api/material-supply 대신 여기서 준다
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const so = sp.get("so");
  const db = getDb();
  const dosu = sp.get("dosu");
  if (dosu) return NextResponse.json(fetchAssemblyRecords(db, dosu.trim()));
  const color = sp.get("color");
  if (color) return NextResponse.json(fetchColorStock(db, color.trim()));
  if (sp.get("materials") === "1") {
    const ms = fetchMaterialSupply(db);
    return NextResponse.json({ as_of: ms.as_of, orders: summarizeByOrder(ms.rows) });
  }
  const swap = sp.get("swap");
  if (swap) return NextResponse.json(fetchItemChange(db, swap.trim()));
  if (so) return NextResponse.json(fetchDueOrderLines(db, so.trim()));
  return NextResponse.json(fetchDueOrders(db, sp.get("fresh") === "1"));
}
