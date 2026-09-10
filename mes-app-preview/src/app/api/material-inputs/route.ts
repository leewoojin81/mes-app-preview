import { NextRequest, NextResponse } from "next/server";
import { getDb, nextId, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { wo_no, material_lot_no, qty } = body as {
    wo_no?: string;
    material_lot_no?: string;
    qty?: number;
  };

  if (!wo_no || !material_lot_no || !qty || qty <= 0) {
    return NextResponse.json(
      { error: "작업지시, 원자재 LOT, 수량을 확인해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
  const wo = db
    .prepare("SELECT wo_no FROM work_orders WHERE wo_no = ?")
    .get(wo_no);
  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }

  const lot = db
    .prepare("SELECT * FROM lots WHERE lot_no = ? AND lot_type = '원자재'")
    .get(material_lot_no) as { item_code: string } | undefined;
  if (!lot) {
    return NextResponse.json(
      { error: "존재하지 않는 원자재 LOT 입니다." },
      { status: 400 }
    );
  }

  const inv = db
    .prepare(
      "SELECT * FROM inventory WHERE lot_no = ? AND item_code = ? AND location = '원자재창고'"
    )
    .get(material_lot_no, lot.item_code) as { qty: number } | undefined;

  if (!inv || inv.qty < qty) {
    return NextResponse.json(
      {
        error: `재고가 부족합니다. (현재고: ${inv ? inv.qty : 0})`,
      },
      { status: 400 }
    );
  }

  const now = nowLocal(db);
  db.prepare(
    "UPDATE inventory SET qty = qty - ?, updated_at = ? WHERE lot_no = ? AND item_code = ? AND location = '원자재창고'"
  ).run(qty, now, material_lot_no, lot.item_code);
  db.prepare("UPDATE lots SET qty = qty - ? WHERE lot_no = ?").run(
    qty,
    material_lot_no
  );

  const inputId = nextId("MI");
  db.prepare(
    `INSERT INTO material_inputs (input_id, wo_no, material_lot_no, qty, reg_time)
     VALUES (?, ?, ?, ?, ?)`
  ).run(inputId, wo_no, material_lot_no, qty, now);

  return NextResponse.json({ input_id: inputId }, { status: 201 });
}
