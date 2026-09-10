import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

// 창고 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ warehouse_code: string }> }
) {
  const { warehouse_code: warehouseCode } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM warehouses WHERE warehouse_code = ?")
    .get(warehouseCode);
  if (!existing) {
    return NextResponse.json({ error: "창고를 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const warehouseName = strVal(body.warehouse_name);
  if (!warehouseName) {
    return NextResponse.json({ error: "창고명은 필수입니다." }, { status: 400 });
  }

  db.prepare(
    `UPDATE warehouses SET
       warehouse_name=?, workplace=?, procure_type=?, warehouse_type=?, use_yn=?
     WHERE warehouse_code=?`
  ).run(
    warehouseName,
    strOrNull(body.workplace),
    strOrNull(body.procure_type),
    strOrNull(body.warehouse_type),
    body.use_yn === "N" ? "N" : "Y",
    warehouseCode
  );

  return NextResponse.json({ ok: true });
}

// 창고 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ warehouse_code: string }> }
) {
  const { warehouse_code: warehouseCode } = await params;
  const db = getDb();
  const result = db
    .prepare("DELETE FROM warehouses WHERE warehouse_code = ?")
    .run(warehouseCode);
  if (result.changes === 0) {
    return NextResponse.json({ error: "창고를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
