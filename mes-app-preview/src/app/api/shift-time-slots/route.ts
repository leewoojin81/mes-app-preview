import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strVal } from "@/lib/item-fields";
import { computeShiftMinutes } from "@/lib/shift-time";
import type { ShiftTimeSlot } from "@/lib/types";

export const runtime = "nodejs";

const SHIFT_CODES = ["1조", "2조", "3조"] as const;

interface RawRow {
  id: number;
  shift_code: string;
  segment_name: string;
  start_time: string;
  end_time: string;
  work_minutes: number;
  effective_date: string;
  seq: number;
  created_at: string;
  updated_at: string;
}

function toShiftTimeSlot(r: RawRow): ShiftTimeSlot {
  return { ...r, crosses_midnight: computeShiftMinutes(r.start_time, r.end_time)?.crossesMidnight ?? false };
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM shift_time_slots ORDER BY shift_code, effective_date, seq, id")
    .all() as unknown as RawRow[];
  return NextResponse.json(rows.map(toShiftTimeSlot));
}

// 근무시간정보(PSN-07) 구간 등록.
export async function POST(req: NextRequest) {
  const db = getDb();
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
  let seq: number;
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  } else if (seqInput === null) {
    const maxSeq = db
      .prepare(
        "SELECT MAX(seq) AS m FROM shift_time_slots WHERE shift_code = ? AND effective_date = ?"
      )
      .get(shiftCode, effectiveDate) as { m: number | null };
    seq = (maxSeq.m ?? 0) + 10;
  } else {
    seq = seqInput;
  }

  const result = db
    .prepare(
      `INSERT INTO shift_time_slots (shift_code, segment_name, start_time, end_time, work_minutes, effective_date, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(shiftCode, segmentName, startTime, endTime, shiftMinutes.minutes, effectiveDate, seq);

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) }, { status: 201 });
}
