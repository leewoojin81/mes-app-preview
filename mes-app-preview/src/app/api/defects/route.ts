import { NextRequest, NextResponse } from "next/server";
import { getDb, nextId, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { wo_no, defect_type, qty } = body as {
    wo_no?: string;
    defect_type?: string;
    qty?: number;
  };

  if (!wo_no || !defect_type || !qty || qty <= 0) {
    return NextResponse.json(
      { error: "작업지시, 불량유형, 수량을 확인해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
  const wo = db
    .prepare("SELECT * FROM work_orders WHERE wo_no = ?")
    .get(wo_no) as { status: string } | undefined;
  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }

  const lotNo = `${wo_no}-L1`;
  const lot = db.prepare("SELECT lot_no FROM lots WHERE lot_no = ?").get(lotNo);
  if (!lot) {
    return NextResponse.json(
      { error: "먼저 생산실적을 등록한 후 불량을 등록할 수 있습니다." },
      { status: 400 }
    );
  }

  const now = nowLocal(db);
  const defectId = nextId("DF");
  db.prepare(
    `INSERT INTO defects (defect_id, wo_no, lot_no, defect_type, qty, reg_time)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(defectId, wo_no, lotNo, defect_type, qty, now);

  return NextResponse.json({ defect_id: defectId }, { status: 201 });
}
