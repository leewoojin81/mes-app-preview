import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strVal } from "@/lib/item-fields";
import { computeShiftMinutes } from "@/lib/shift-time";

export const runtime = "nodejs";

const SHIFT_CODES = ["1조", "2조", "3조"] as const;

// 근무시간정보(PSN-07) 구간 수정.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT id FROM shift_time_slots WHERE id = ?").get(id);
  if (!existing) {
    return NextResponse.json({ error: "구간을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const shiftCode = strVal(body.shift_code);
  if (!SHIFT_CODES.includes(shiftCode as (typeof SHIFT_CODES)[number])) {
    return NextResponse.json({ error: "조구분은 1조/2조/3조 중 하나여야 합니다." }, { status: 400 });
  }
  const segmentName = strVal(body.segment_name);
  if (!segmentName) {
    return NextResponse.json({ error: "구간명은 필수입니다." }, { status: 400 });
  }
  const startTime = strVal(body.start_time);
  const endTime = strVal(body.end_time);
  const shiftMinutes = computeShiftMinutes(startTime, endTime);
  if (!shiftMinutes) {
    return NextResponse.json(
      { error: "시작/종료 시각을 HH:MM 형식으로 입력하고, 서로 같지 않게 해주세요." },
      { status: 400 }
    );
  }
  const effectiveDate = strVal(body.effective_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return NextResponse.json({ error: "적용시작일은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const seqInput = numOrNull(body.seq);
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  }

  db.prepare(
    `UPDATE shift_time_slots SET
       shift_code=?, segment_name=?, start_time=?, end_time=?, work_minutes=?, effective_date=?, seq=?,
       updated_at=datetime('now','localtime')
     WHERE id=?`
  ).run(shiftCode, segmentName, startTime, endTime, shiftMinutes.minutes, effectiveDate, seqInput ?? 0, id);

  return NextResponse.json({ ok: true });
}

// 근무시간정보(PSN-07) 구간 삭제.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM shift_time_slots WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "구간을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
