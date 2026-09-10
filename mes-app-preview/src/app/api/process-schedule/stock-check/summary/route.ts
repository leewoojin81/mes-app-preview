import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { STOCK_CHECK_WAREHOUSES } from "@/lib/stock-check";

export const runtime = "nodejs";

// 공정표발행(PROD-04) 그리드에서 여러 행을 한 번에 뿌리기 위한 재고 보유 여부 일괄 조회 —
// 대표코드별로 품목군 "착색" 반제품이 조립창고/원.부자재창고에 1개라도 있으면 true.
// 상세 필요수량/LOT 목록은 팝업 클릭 시 /api/process-schedule/stock-check에서 따로 가져온다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const repCodes = [
    ...new Set(
      (req.nextUrl.searchParams.get("itemCodes") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];

  const hasStock: Record<string, boolean> = Object.fromEntries(repCodes.map((c) => [c, false]));
  if (repCodes.length === 0) {
    return NextResponse.json({ hasStock });
  }

  const bomRows = db
    .prepare(
      `SELECT b.parent_item_code, b.child_item_code
       FROM bom b
       JOIN items it ON it.item_code = b.child_item_code
       WHERE b.parent_item_code IN (${repCodes.map(() => "?").join(",")})
         AND it.category = '반제품'
         AND json_extract(it.detail, '$."품목군"') = '착색'`
    )
    .all(...repCodes) as { parent_item_code: string; child_item_code: string }[];

  if (bomRows.length > 0) {
    const childCodes = [...new Set(bomRows.map((r) => r.child_item_code))];
    const stockRows = db
      .prepare(
        `SELECT item_code
         FROM inventory_status
         WHERE item_code IN (${childCodes.map(() => "?").join(",")})
           AND warehouse IN (${STOCK_CHECK_WAREHOUSES.map(() => "?").join(",")})
         GROUP BY item_code
         HAVING SUM(stock_qty) > 0`
      )
      .all(...childCodes, ...STOCK_CHECK_WAREHOUSES) as { item_code: string }[];
    const inStockCodes = new Set(stockRows.map((r) => r.item_code));
    for (const row of bomRows) {
      if (inStockCodes.has(row.child_item_code)) hasStock[row.parent_item_code] = true;
    }
  }

  return NextResponse.json({ hasStock });
}
