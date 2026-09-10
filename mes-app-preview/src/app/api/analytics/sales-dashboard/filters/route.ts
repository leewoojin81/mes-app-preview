import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// "전체 고객사"/"전체 제품" 드롭다운 옵션 — 실제 수주 실적이 있는 거래처/주기만 내려준다.
// "전체 제품"은 품목코드 마스터(제품등록 BASE-01)의 "주기"(1Day/Monthly/...) 기준.
export async function GET() {
  const db = getDb();
  const customers = db
    .prepare(
      `SELECT DISTINCT so.customer_code, c.customer_name
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       ORDER BY c.customer_name`
    )
    .all();
  const cycles = (
    db
      .prepare(
        `SELECT DISTINCT COALESCE(NULLIF(json_extract(it.detail, '$.주기'), ''), '기타') as name
         FROM sales_orders so
         JOIN items it ON it.item_code = so.item_code
         ORDER BY name`
      )
      .all() as { name: string }[]
  ).map((r) => r.name);

  return NextResponse.json({ customers, cycles });
}
