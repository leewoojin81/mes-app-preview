import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { allValidNums, numOrNull, strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM equipments ORDER BY equipment_id")
    .all();
  return NextResponse.json(rows);
}

// 설비 등록
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const equipmentId = strVal(body.equipment_id);
  const equipmentName = strVal(body.equipment_name);
  if (!equipmentId) {
    return NextResponse.json({ error: "설비코드는 필수입니다." }, { status: 400 });
  }
  if (!equipmentName) {
    return NextResponse.json({ error: "설비명은 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM equipments WHERE equipment_id = ?").get(equipmentId)) {
    return NextResponse.json(
      { error: `이미 존재하는 설비코드입니다: ${equipmentId}` },
      { status: 409 }
    );
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

  const seqInput = numOrNull(body.seq);
  let seq: number;
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  } else if (seqInput === null) {
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM equipments").get() as {
      m: number | null;
    };
    seq = (maxSeq.m ?? 0) + 1;
  } else {
    seq = seqInput;
  }

  db.prepare(
    `INSERT INTO equipments
       (equipment_id, equipment_name, workplace, equipment_group, personnel, wage_rate, ton, line_id,
        bf_warehouse, defect_warehouse, defect_pattern, daily_work_minutes, work_time_type, uph, work_efficiency, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    equipmentId,
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
    seq,
    useYn
  );

  return NextResponse.json({ ok: true, equipment_id: equipmentId }, { status: 201 });
}
