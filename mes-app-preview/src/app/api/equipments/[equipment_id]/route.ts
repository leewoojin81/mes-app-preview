import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { allValidNums, numOrNull, strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

// 설비 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ equipment_id: string }> }
) {
  const { equipment_id: equipmentId } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM equipments WHERE equipment_id = ?")
    .get(equipmentId);
  if (!existing) {
    return NextResponse.json({ error: "설비를 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const equipmentName = strVal(body.equipment_name);
  if (!equipmentName) {
    return NextResponse.json({ error: "설비명은 필수입니다." }, { status: 400 });
  }
  const workplace = strOrNull(body.workplace);
  const equipmentGroup = strOrNull(body.equipment_group);
  const lineId = strOrNull(body.line_id);
  const bfWarehouse = strOrNull(body.bf_warehouse);
  const defectWarehouse = strOrNull(body.defect_warehouse);
  const defectPattern = strOrNull(body.defect_pattern);
  const workTimeType = strOrNull(body.work_time_type);
  const useYn = body.use_yn === "N" ? "N" : "Y";

  const numFields = allValidNums([
    numOrNull(body.personnel),
    numOrNull(body.wage_rate),
    numOrNull(body.ton),
    numOrNull(body.daily_work_minutes),
    numOrNull(body.uph),
    numOrNull(body.work_efficiency),
  ]);
  if (!numFields) {
    return NextResponse.json({ error: "숫자 항목에 잘못된 값이 있습니다." }, { status: 400 });
  }
  const [personnel, wageRate, ton, dailyWorkMinutes, uph, workEfficiency] = numFields;

  db.prepare(
    `UPDATE equipments SET
       equipment_name=?, workplace=?, equipment_group=?, personnel=?, wage_rate=?, ton=?, line_id=?,
       bf_warehouse=?, defect_warehouse=?, defect_pattern=?, daily_work_minutes=?, work_time_type=?,
       uph=?, work_efficiency=?, use_yn=?
     WHERE equipment_id=?`
  ).run(
    equipmentName,
    workplace,
    equipmentGroup,
    personnel,
    wageRate,
    ton,
    lineId,
    bfWarehouse,
    defectWarehouse,
    defectPattern,
    dailyWorkMinutes,
    workTimeType,
    uph,
    workEfficiency,
    useYn,
    equipmentId
  );

  return NextResponse.json({ ok: true });
}

// 설비 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ equipment_id: string }> }
) {
  const { equipment_id: equipmentId } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM equipments WHERE equipment_id = ?").run(equipmentId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "설비를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
