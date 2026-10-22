import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 제품정보(BASE-01)에는 있는데 BOM정보(BASE-03)에 구성품이 없는 완제품 모델.
// BOM은 모델 대표코드(품목코드 앞 9자리)로 등록되는 경우가 많아, 품목코드 자체 또는 앞 9자리가
// BOM 상위품목에 하나도 없을 때만 누락으로 본다. 도수별 품목은 모델 단위로 묶는다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const all = req.nextUrl.searchParams.get("include_unused") === "1";
  const rows = db
    .prepare(
      `SELECT substr(i.item_code, 1, 9) model, COUNT(*) item_count, MIN(i.item_code) item_code,
              MIN(i.item_name) item_name, SUM(CASE WHEN i.use_yn = 'Y' THEN 1 ELSE 0 END) active_count
         FROM items i
        WHERE i.category = '완제품'
          ${all ? "" : "AND i.use_yn = 'Y'"}
          AND NOT EXISTS (SELECT 1 FROM bom b WHERE b.parent_item_code = i.item_code OR b.parent_item_code = substr(i.item_code, 1, 9))
        GROUP BY 1
        ORDER BY 1`
    )
    .all();
  return NextResponse.json(rows);
}
