import { NextRequest, NextResponse } from "next/server";
import { getDb, nextId, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { wo_no, qty, equipment_id } = body as {
    wo_no?: string;
    qty?: number;
    equipment_id?: string | null;
  };

  if (!wo_no || !qty || qty <= 0) {
    return NextResponse.json(
      { error: "작업지시와 생산수량을 확인해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
  const wo = db
    .prepare("SELECT * FROM work_orders WHERE wo_no = ?")
    .get(wo_no) as
    | {
        wo_no: string;
        item_code: string;
        order_qty: number;
        produced_qty: number;
        status: string;
      }
    | undefined;

  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }
  if (wo.status !== "발행" && wo.status !== "진행") {
    return NextResponse.json(
      { error: "발행 또는 진행 중인 작업지시만 실적을 등록할 수 있습니다." },
      { status: 400 }
    );
  }

  const now = nowLocal(db);

  if (wo.status === "발행") {
    db.prepare(
      "UPDATE work_orders SET status = '진행', started_at = ? WHERE wo_no = ?"
    ).run(now, wo_no);
  }

  const lotNo = `${wo_no}-L1`;
  const existingLot = db
    .prepare("SELECT lot_no FROM lots WHERE lot_no = ?")
    .get(lotNo);
  if (!existingLot) {
    db.prepare(
      `INSERT INTO lots (lot_no, wo_no, item_code, qty, status, lot_type)
       VALUES (?, ?, ?, 0, '정상', '생산')`
    ).run(lotNo, wo_no, wo.item_code);
  }
  db.prepare("UPDATE lots SET qty = qty + ? WHERE lot_no = ?").run(qty, lotNo);

  const resultId = nextId("PR");
  db.prepare(
    `INSERT INTO production_results (result_id, wo_no, lot_no, equipment_id, qty, reg_time)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(resultId, wo_no, lotNo, equipment_id ?? null, qty, now);

  const existingInv = db
    .prepare(
      "SELECT inventory_id FROM inventory WHERE item_code = ? AND lot_no = ? AND location = ?"
    )
    .get(wo.item_code, lotNo, "완제품창고");
  if (existingInv) {
    db.prepare(
      "UPDATE inventory SET qty = qty + ?, updated_at = ? WHERE item_code = ? AND lot_no = ? AND location = ?"
    ).run(qty, now, wo.item_code, lotNo, "완제품창고");
  } else {
    db.prepare(
      `INSERT INTO inventory (inventory_id, item_code, lot_no, location, qty, status, updated_at)
       VALUES (?, ?, ?, ?, ?, '정상', ?)`
    ).run(nextId("INV"), wo.item_code, lotNo, "완제품창고", qty, now);
  }

  const newProduced = wo.produced_qty + qty;
  const completed = newProduced >= wo.order_qty;
  db.prepare(
    `UPDATE work_orders SET produced_qty = ?, status = ?, completed_at = ? WHERE wo_no = ?`
  ).run(
    newProduced,
    completed ? "완료" : "진행",
    completed ? now : null,
    wo_no
  );

  const updatedWo = db
    .prepare(
      `SELECT wo.*, it.item_name as item_name
       FROM work_orders wo JOIN items it ON it.item_code = wo.item_code
       WHERE wo.wo_no = ?`
    )
    .get(wo_no);

  return NextResponse.json({ workOrder: updatedWo }, { status: 201 });
}
