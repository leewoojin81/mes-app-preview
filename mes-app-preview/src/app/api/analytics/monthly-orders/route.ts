import { NextRequest, NextResponse } from "next/server";
import { getDb, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

// 수주등록(sales-orders) 화면과 동일한 규칙 — 원본 엑셀 "수주일자", 없으면 등록일.
const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(detail, '$.수주일자'), '.', '-'), ''), substr(created_at, 1, 10))`;
const QTY_EXPR = `COALESCE(json_extract(detail, '$.수량'), order_qty)`;

interface MonthlyRow {
  month: string;
  actual_qty: number;
  plan_qty: number | null;
  unplanned_qty: number | null;
}

// 경영정보 "월별수주현황(MGMT-02)" — 수주량은 항상 sales_orders에서 실시간 집계하고,
// 계획(목표)수량은 sales_monthly_plan(영업 계획표, 화면에서 직접 입력)과 대비해 달성율을 낸다.
export async function GET() {
  const db = getDb();

  const actualRows = db
    .prepare(
      `SELECT substr(${ORDER_DATE_EXPR}, 1, 7) as month, SUM(${QTY_EXPR}) as actual_qty
       FROM sales_orders
       GROUP BY month
       ORDER BY month`
    )
    .all() as { month: string; actual_qty: number }[];

  const planRows = db
    .prepare("SELECT month, plan_qty, unplanned_qty FROM sales_monthly_plan")
    .all() as { month: string; plan_qty: number; unplanned_qty: number }[];
  const planByMonth = new Map(planRows.map((r) => [r.month, r]));

  const months = new Set<string>([
    ...actualRows.map((r) => r.month),
    ...planRows.map((r) => r.month),
  ]);

  const rows: MonthlyRow[] = [...months].sort().map((month) => {
    const actual = actualRows.find((r) => r.month === month)?.actual_qty ?? 0;
    const plan = planByMonth.get(month);
    return {
      month,
      actual_qty: actual,
      plan_qty: plan?.plan_qty ?? null,
      unplanned_qty: plan?.unplanned_qty ?? null,
    };
  });

  return NextResponse.json(rows);
}

// 계획(목표)수량 수정 — 영업 계획표 값이 바뀌면 화면에서 직접 갱신한다.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { month, plan_qty, unplanned_qty } = (body ?? {}) as {
    month?: string;
    plan_qty?: number | string | null;
    unplanned_qty?: number | string | null;
  };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  const plan = plan_qty != null && plan_qty !== "" ? Number(plan_qty) : 0;
  const unplanned = unplanned_qty != null && unplanned_qty !== "" ? Number(unplanned_qty) : 0;
  if (!Number.isFinite(plan) || !Number.isFinite(unplanned)) {
    return NextResponse.json({ error: "계획수량이 올바르지 않습니다." }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO sales_monthly_plan (month, plan_qty, unplanned_qty, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET
       plan_qty = excluded.plan_qty,
       unplanned_qty = excluded.unplanned_qty,
       updated_at = excluded.updated_at`
  ).run(month, plan, unplanned, nowLocal(db));

  return NextResponse.json({ ok: true, month, plan_qty: plan, unplanned_qty: unplanned });
}
