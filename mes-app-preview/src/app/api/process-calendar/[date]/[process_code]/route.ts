import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, timeOrNull } from "@/lib/item-fields";

export const runtime = "nodejs";

function activeOverrideOrNull(v: unknown): "Y" | "N" | null | undefined {
  if (v == null || v === "") return null; // 기본값 사용
  if (v === "Y" || v === "N") return v;
  return undefined; // 에러 신호
}

// 날짜×공정 예외 등록/수정 (upsert). "기본값 사용"으로 되돌리고 싶은 필드는 null로 보낸다.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string; process_code: string }> }
) {
  const { date, process_code: processCode } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "잘못된 날짜입니다." }, { status: 400 });
  }

  const db = getDb();
  if (!db.prepare("SELECT 1 FROM processes WHERE process_code = ?").get(processCode)) {
    return NextResponse.json({ error: "공정을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const shift1Active = activeOverrideOrNull(body.shift1_active_override);
  const shift1OtStart = timeOrNull(body.shift1_ot_start);
  const shift1OtEnd = timeOrNull(body.shift1_ot_end);
  const shift1OtMeal = numOrNull(body.shift1_ot_meal_minutes);
  const shift2Active = activeOverrideOrNull(body.shift2_active_override);
  const shift2OtStart = timeOrNull(body.shift2_ot_start);
  const shift2OtEnd = timeOrNull(body.shift2_ot_end);
  const shift2OtMeal = numOrNull(body.shift2_ot_meal_minutes);
  if (
    shift1Active === undefined ||
    shift1OtStart === undefined ||
    shift1OtEnd === undefined ||
    shift1OtMeal === undefined ||
    shift2Active === undefined ||
    shift2OtStart === undefined ||
    shift2OtEnd === undefined ||
    shift2OtMeal === undefined
  ) {
    return NextResponse.json(
      { error: "가동여부는 Y/N, 잔업 시작/종료시각은 HH:MM, 식사시간은 숫자여야 합니다." },
      { status: 400 }
    );
  }
  const note = strOrNull(body.note);

  db.prepare(
    `INSERT INTO process_calendar
       (cal_date, process_code,
        shift1_active_override, shift1_ot_start, shift1_ot_end, shift1_ot_meal_minutes,
        shift2_active_override, shift2_ot_start, shift2_ot_end, shift2_ot_meal_minutes,
        note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(cal_date, process_code) DO UPDATE SET
       shift1_active_override=excluded.shift1_active_override,
       shift1_ot_start=excluded.shift1_ot_start,
       shift1_ot_end=excluded.shift1_ot_end,
       shift1_ot_meal_minutes=excluded.shift1_ot_meal_minutes,
       shift2_active_override=excluded.shift2_active_override,
       shift2_ot_start=excluded.shift2_ot_start,
       shift2_ot_end=excluded.shift2_ot_end,
       shift2_ot_meal_minutes=excluded.shift2_ot_meal_minutes,
       note=excluded.note,
       updated_at=datetime('now','localtime')`
  ).run(
    date,
    processCode,
    shift1Active,
    shift1OtStart,
    shift1OtEnd,
    shift1OtMeal,
    shift2Active,
    shift2OtStart,
    shift2OtEnd,
    shift2OtMeal,
    note
  );

  return NextResponse.json({ ok: true });
}

// 예외 삭제 = 기본값(공정 표준 패턴 + 회사 근무구분)으로 되돌리기
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string; process_code: string }> }
) {
  const { date, process_code: processCode } = await params;
  const db = getDb();
  db.prepare("DELETE FROM process_calendar WHERE cal_date = ? AND process_code = ?").run(
    date,
    processCode
  );
  return NextResponse.json({ ok: true });
}
