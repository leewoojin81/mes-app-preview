import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(so.detail, '$.수주일자'), '.', '-'), ''), substr(so.created_at, 1, 10))`;
const QTY_EXPR = `COALESCE(json_extract(so.detail, '$.수량'), so.order_qty)`;

// 경영정보 "거래처별 수주 추이분석(MGMT-03)" 드롭다운/랭킹 — 거래처별 누적 수주량 기준
// 내림차순(원본 보고서와 동일 정렬), 최근 수주일도 함께 내려 기본 선택값을 정할 수 있게 한다.
// 조회일자(dateFrom/dateTo) 필터를 주면 그 기간의 수주만 집계한다(미지정 시 전체 기간).
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");

  const conditions: string[] = [];
  const args: string[] = [];
  if (dateFrom) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateTo);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT so.customer_code, c.customer_name,
              SUM(${QTY_EXPR}) as total_qty,
              COUNT(DISTINCT ${ORDER_DATE_EXPR}) as order_days,
              MAX(${ORDER_DATE_EXPR}) as last_order
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       ${where}
       GROUP BY so.customer_code
       ORDER BY total_qty DESC`
    )
    .all(...args);
  return NextResponse.json(rows);
}
