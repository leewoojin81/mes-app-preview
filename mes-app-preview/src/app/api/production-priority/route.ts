import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PRIORITY_SELECT, PRIORITY_ORDER, buildPriorityWhere } from "@/lib/production-priority-query";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

// 목록 화면이 필터 없이 열리면 수만 건이 한 번에 잡힐 수 있어(전체 수주 라인 기준) 페이지네이션은
// 필수로 둔다 — 수주등록(SALES-02)과 달리 page 파라미터를 생략해도 기본 페이지(1페이지)만 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const { where, args } = buildPriorityWhere(params);

  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "200", 10) || 200));
  const offset = (page - 1) * pageSize;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM sales_orders so
         JOIN customers c ON c.customer_code = so.customer_code
         JOIN items it ON it.item_code = so.item_code
         ${where}`
      )
      .get(...args) as { c: number }
  ).c;

  const rows = (
    db
      .prepare(`${PRIORITY_SELECT} ${where} ${PRIORITY_ORDER} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset) as { detail: string | null }[]
  ).map(parseDetail);

  // 하단 합계 행 — 현재 페이지가 아니라 검색/필터 조건이 적용된 전체 건 기준으로 계산한다.
  const sumsRow = db
    .prepare(
      `SELECT
         SUM(COALESCE(json_extract(so.detail, '$.수량'), so.order_qty)) as order_qty_sum,
         SUM(COALESCE((SELECT SUM(wo.order_qty) FROM work_orders wo WHERE wo.so_no = so.so_no), 0)) as issued_qty_sum
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code
       ${where}`
    )
    .get(...args) as { order_qty_sum: number | null; issued_qty_sum: number | null };
  const orderQtySum = sumsRow.order_qty_sum ?? 0;
  const issuedQtySum = sumsRow.issued_qty_sum ?? 0;
  const totals = { 수주수량: orderQtySum, 작지수량: issuedQtySum, 지시잔량: orderQtySum - issuedQtySum };

  return NextResponse.json({ rows, total, page, pageSize, totals });
}
