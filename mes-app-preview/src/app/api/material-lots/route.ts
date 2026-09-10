import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.lot_no as lot_no, l.item_code as item_code, it.item_name as item_name,
              it.unit as unit, COALESCE(inv.qty, 0) as available_qty
       FROM lots l
       JOIN items it ON it.item_code = l.item_code
       LEFT JOIN inventory inv ON inv.lot_no = l.lot_no AND inv.location = '원자재창고'
       WHERE l.lot_type = '원자재'
       ORDER BY it.item_code, l.lot_no`
    )
    .all();
  return NextResponse.json(rows);
}
