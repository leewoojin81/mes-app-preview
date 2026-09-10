import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(detail, '$.수주일자'), '.', '-'), ''), substr(created_at, 1, 10))`;
const QTY_EXPR = `COALESCE(json_extract(detail, '$.수량'), order_qty)`;

type Params = { params: Promise<{ code: string }> };

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86400000
  );
}

// 경영정보 "거래처별 수주 추이분석(MGMT-03)" 상세 — 선택한 거래처의 수주일자별 수주량
// 이력과, 그 이력에서 계산한 발주 주기 통계(평균/표준편차/마지막 수주일 이후 경과일)를 낸다.
// 조회일자(dateFrom/dateTo) 필터를 주면 그 기간의 이력만 집계한다(미지정 시 전체 기간).
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const db = getDb();
  const searchParams = req.nextUrl.searchParams;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const customer = db
    .prepare("SELECT customer_code, customer_name FROM customers WHERE customer_code = ?")
    .get(code);
  if (!customer) {
    return NextResponse.json({ error: "존재하지 않는 거래처입니다." }, { status: 404 });
  }

  const conditions: string[] = ["customer_code = ?"];
  const args: string[] = [code];
  if (dateFrom) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateTo);
  }

  const history = db
    .prepare(
      `SELECT ${ORDER_DATE_EXPR} as date, SUM(${QTY_EXPR}) as qty, COUNT(*) as line_count
       FROM sales_orders
       WHERE ${conditions.join(" AND ")}
       GROUP BY date
       ORDER BY date`
    )
    .all(...args) as { date: string; qty: number; line_count: number }[];

  const dates = history.map((h) => h.date);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i - 1], dates[i]));
  const avgInterval =
    intervals.length > 0 ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null;
  const stdInterval =
    intervals.length > 1 && avgInterval != null
      ? Math.sqrt(
          intervals.reduce((s, v) => s + (v - avgInterval) ** 2, 0) / intervals.length
        )
      : null;
  const lastOrder = dates.length > 0 ? dates[dates.length - 1] : null;
  const today = new Date().toISOString().slice(0, 10);
  const gapFromLast = lastOrder ? daysBetween(lastOrder, today) : null;
  const totalQty = history.reduce((s, h) => s + h.qty, 0);

  return NextResponse.json({
    customer,
    history,
    stats: {
      total_qty: totalQty,
      order_days: history.length,
      avg_interval_days: avgInterval != null ? +avgInterval.toFixed(1) : null,
      std_interval_days: stdInterval != null ? +stdInterval.toFixed(1) : null,
      last_order: lastOrder,
      gap_from_last_days: gapFromLast,
    },
  });
}
