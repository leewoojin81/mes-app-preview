import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  INVENTORY_STATUS_DETAIL_FILTERS,
  buildInventoryStatusWhere,
  detailExpr,
} from "@/lib/inventory-status-filters";

export const runtime = "nodejs";

// 창고/품목계정/대분류/중분류/소분류 드롭다운 옵션.
// 각 필드의 옵션은 자기 자신을 제외한 나머지 필터를 적용한 상태에서 실제
// 존재하는 값만 반환한다(faceted) — 품목등록(BASE-01) 화면과 같은 방식.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const out: Record<string, string[]> = {};

  {
    const { where, args } = buildInventoryStatusWhere(params, { skipParam: "warehouse" });
    const cond = where
      ? `${where} AND warehouse IS NOT NULL AND warehouse != ''`
      : "WHERE warehouse IS NOT NULL AND warehouse != ''";
    out.warehouse = (
      db
        .prepare(`SELECT DISTINCT warehouse AS v FROM inventory_status ${cond} ORDER BY v`)
        .all(...args) as { v: string }[]
    ).map((r) => r.v);
  }

  for (const f of INVENTORY_STATUS_DETAIL_FILTERS) {
    const { where, args } = buildInventoryStatusWhere(params, { skipParam: f.param });
    const expr = detailExpr(f.key);
    const cond = where ? `${where} AND ${expr} IS NOT NULL` : `WHERE ${expr} IS NOT NULL`;
    out[f.param] = (
      db
        .prepare(`SELECT DISTINCT ${expr} AS v FROM inventory_status ${cond} ORDER BY v`)
        .all(...args) as { v: string }[]
    )
      .map((r) => r.v)
      .filter((v) => v != null && String(v).trim() !== "");
  }

  return NextResponse.json(out);
}
