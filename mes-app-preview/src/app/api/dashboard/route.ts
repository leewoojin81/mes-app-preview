import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();

  const todayProduced = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) as qty, COUNT(*) as cnt
       FROM production_results
       WHERE date(reg_time) = date('now','localtime')`
    )
    .get() as { qty: number; cnt: number };

  const todayDefects = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) as qty, COUNT(*) as cnt
       FROM defects
       WHERE date(reg_time) = date('now','localtime')`
    )
    .get() as { qty: number; cnt: number };

  const woSummary = db
    .prepare(
      `SELECT status, COUNT(*) as cnt,
              COALESCE(SUM(order_qty), 0) as order_qty,
              COALESCE(SUM(produced_qty), 0) as produced_qty
       FROM work_orders
       GROUP BY status`
    )
    .all() as {
    status: string;
    cnt: number;
    order_qty: number;
    produced_qty: number;
  }[];

  const activeWos = db
    .prepare(
      `SELECT wo.wo_no, wo.item_code, it.item_name, wo.line_id,
              wo.order_qty, wo.produced_qty, wo.status, wo.due_date
       FROM work_orders wo
       JOIN items it ON it.item_code = wo.item_code
       WHERE wo.status IN ('진행', '발행')
       ORDER BY wo.wo_no
       LIMIT 8`
    )
    .all();

  const overdueWos = db
    .prepare(
      `SELECT wo.wo_no, it.item_name, wo.due_date, wo.status,
              wo.order_qty, wo.produced_qty
       FROM work_orders wo
       JOIN items it ON it.item_code = wo.item_code
       WHERE wo.status != '완료'
         AND wo.due_date IS NOT NULL
         AND date(wo.due_date) <= date('now','localtime')
       ORDER BY wo.due_date
       LIMIT 5`
    )
    .all();

  const lowStock = db
    .prepare(
      `SELECT it.item_code, it.item_name, it.category, it.unit, it.safety_stock,
              COALESCE(SUM(inv.qty), 0) as stock_qty
       FROM items it
       LEFT JOIN inventory inv
         ON inv.item_code = it.item_code AND inv.status = '정상'
       WHERE it.safety_stock IS NOT NULL AND it.safety_stock > 0
       GROUP BY it.item_code
       HAVING stock_qty < it.safety_stock
       ORDER BY stock_qty / it.safety_stock
       LIMIT 5`
    )
    .all();

  const defectsByType = db
    .prepare(
      `SELECT defect_type, COALESCE(SUM(qty), 0) as qty
       FROM defects
       WHERE date(reg_time) >= date('now','localtime','-6 days')
       GROUP BY defect_type
       ORDER BY qty DESC`
    )
    .all();

  const dailyProduction = db
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date('now','localtime','-6 days')
         UNION ALL
         SELECT date(d, '+1 day') FROM days WHERE d < date('now','localtime')
       )
       SELECT days.d as prod_date,
              COALESCE((SELECT SUM(qty) FROM production_results pr
                        WHERE date(pr.reg_time) = days.d), 0) as good_qty,
              COALESCE((SELECT SUM(qty) FROM defects df
                        WHERE date(df.reg_time) = days.d), 0) as defect_qty
       FROM days`
    )
    .all();

  const recentResults = db
    .prepare(
      `SELECT pr.result_id, pr.wo_no, pr.lot_no, pr.qty, pr.reg_time,
              it.item_name, eq.equipment_name
       FROM production_results pr
       JOIN work_orders wo ON wo.wo_no = pr.wo_no
       JOIN items it ON it.item_code = wo.item_code
       LEFT JOIN equipments eq ON eq.equipment_id = pr.equipment_id
       ORDER BY pr.reg_time DESC
       LIMIT 6`
    )
    .all();

  return NextResponse.json({
    todayProduced,
    todayDefects,
    woSummary,
    activeWos,
    overdueWos,
    lowStock,
    defectsByType,
    dailyProduction,
    recentResults,
  });
}
