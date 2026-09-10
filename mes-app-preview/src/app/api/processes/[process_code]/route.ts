import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal, timeOrNull } from "@/lib/item-fields";

export const runtime = "nodejs";

// 공정 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ process_code: string }> }
) {
  const { process_code: processCode } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM processes WHERE process_code = ?")
    .get(processCode);
  if (!existing) {
    return NextResponse.json({ error: "공정을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const processName = strVal(body.process_name);
  if (!processName) {
    return NextResponse.json({ error: "공정명은 필수입니다." }, { status: 400 });
  }
  const procureType = strOrNull(body.procure_type);
  const productivityType = strOrNull(body.productivity_type);
  const processGroup = strOrNull(body.process_group);
  const processGroup2 = strOrNull(body.process_group2);
  const singleProcess = strOrNull(body.single_process);
  const regDate = strOrNull(body.reg_date);
  const regBy = strOrNull(body.reg_by);
  const useYn = body.use_yn === "N" ? "N" : "Y";

  const seqInput = numOrNull(body.seq);
  let seq: number;
  if (seqInput === undefined) {
    return NextResponse.json({ error: "순서는 숫자여야 합니다." }, { status: 400 });
  } else if (seqInput === null) {
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM processes").get() as {
      m: number | null;
    };
    seq = (maxSeq.m ?? 0) + 10;
  } else {
    seq = seqInput;
  }

  const defaultDailyCapa = numOrNull(body.default_daily_capa);
  const defaultYieldRate = numOrNull(body.default_yield_rate);
  const defaultLotSize = numOrNull(body.default_lot_size);
  if (defaultDailyCapa === undefined || defaultYieldRate === undefined || defaultLotSize === undefined) {
    return NextResponse.json(
      { error: "기본 일CAPA/생산수율/Lot Size는 숫자여야 합니다." },
      { status: 400 }
    );
  }

  const shift1ActiveYn = body.shift1_active_yn === "N" ? "N" : "Y";
  const shift1Start = timeOrNull(body.shift1_start);
  const shift1End = timeOrNull(body.shift1_end);
  const shift1BaseMinutes = numOrNull(body.shift1_base_minutes);
  const shift2ActiveYn = body.shift2_active_yn === "N" ? "N" : "Y";
  const shift2Start = timeOrNull(body.shift2_start);
  const shift2End = timeOrNull(body.shift2_end);
  const shift2BaseMinutes = numOrNull(body.shift2_base_minutes);
  if (
    shift1Start === undefined ||
    shift1End === undefined ||
    shift1BaseMinutes === undefined ||
    shift2Start === undefined ||
    shift2End === undefined ||
    shift2BaseMinutes === undefined
  ) {
    return NextResponse.json(
      { error: "근무패턴 시작/종료시각은 HH:MM, 기본작업시간은 숫자여야 합니다." },
      { status: 400 }
    );
  }
  const applyWorkPatternYn = body.apply_work_pattern_yn === "N" ? "N" : "Y";

  db.prepare(
    `UPDATE processes SET
       process_name=?, seq=?, procure_type=?, productivity_type=?,
       process_group=?, process_group2=?, single_process=?, use_yn=?, reg_date=?, reg_by=?,
       default_daily_capa=?, default_yield_rate=?, default_lot_size=?,
       shift1_active_yn=?, shift1_start=?, shift1_end=?, shift1_base_minutes=?,
       shift2_active_yn=?, shift2_start=?, shift2_end=?, shift2_base_minutes=?,
       apply_work_pattern_yn=?
     WHERE process_code=?`
  ).run(
    processName,
    seq,
    procureType,
    productivityType,
    processGroup,
    processGroup2,
    singleProcess,
    useYn,
    regDate,
    regBy,
    defaultDailyCapa,
    defaultYieldRate,
    defaultLotSize,
    shift1ActiveYn,
    shift1Start,
    shift1End,
    shift1BaseMinutes,
    shift2ActiveYn,
    shift2Start,
    shift2End,
    shift2BaseMinutes,
    applyWorkPatternYn,
    processCode
  );

  return NextResponse.json({ ok: true });
}

// 공정 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ process_code: string }> }
) {
  const { process_code: processCode } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM processes WHERE process_code = ?").run(processCode);
  if (result.changes === 0) {
    return NextResponse.json({ error: "공정을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
