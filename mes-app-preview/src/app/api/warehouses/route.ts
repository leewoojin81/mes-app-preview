import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM warehouses ORDER BY warehouse_code")
    .all();
  return NextResponse.json(rows);
}

// 창고 등록
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const warehouseCode = strVal(body.warehouse_code);
  const warehouseName = strVal(body.warehouse_name);
  if (!warehouseCode) {
    return NextResponse.json({ error: "창고코드는 필수입니다." }, { status: 400 });
  }
  if (!warehouseName) {
    return NextResponse.json({ error: "창고명은 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM warehouses WHERE warehouse_code = ?").get(warehouseCode)) {
    return NextResponse.json(
      { error: `이미 존재하는 창고코드입니다: ${warehouseCode}` },
      { status: 409 }
    );
  }

  const seqInput = numOrNull(body.seq);
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  }
  let seq: number;
  if (seqInput === null) {
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM warehouses").get() as {
      m: number | null;
    };
    seq = (maxSeq.m ?? 0) + 1;
  } else {
    seq = seqInput;
  }

  db.prepare(
    `INSERT INTO warehouses
       (warehouse_code, warehouse_name, workplace, procure_type, warehouse_type, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    warehouseCode,
    warehouseName,
    strOrNull(body.workplace),
    strOrNull(body.procure_type),
    strOrNull(body.warehouse_type),
    seq,
    body.use_yn === "N" ? "N" : "Y"
  );

  return NextResponse.json({ ok: true, warehouse_code: warehouseCode }, { status: 201 });
}
