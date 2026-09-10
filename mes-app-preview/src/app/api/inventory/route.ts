import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const db = getDb();
  const category = req.nextUrl.searchParams.get("category");

  let rows;
  if (category && category !== "전체") {
    rows = db
      .prepare(
        `SELECT inv.inventory_id, inv.item_code, it.item_name, it.category, it.unit,
                inv.lot_no, inv.location, inv.qty, inv.status, inv.updated_at
         FROM inventory inv
         JOIN items it ON it.item_code = inv.item_code
         WHERE it.category = ?
         ORDER BY it.category, it.item_code, inv.lot_no`
      )
      .all(category);
  } else {
    rows = db
      .prepare(
        `SELECT inv.inventory_id, inv.item_code, it.item_name, it.category, it.unit,
                inv.lot_no, inv.location, inv.qty, inv.status, inv.updated_at
         FROM inventory inv
         JOIN items it ON it.item_code = inv.item_code
         ORDER BY it.category, it.item_code, inv.lot_no`
      )
      .all();
  }

  return NextResponse.json(rows);
}
