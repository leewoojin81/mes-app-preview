import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal, timeOrNull, todayDot } from "@/lib/item-fields";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function yn(v: unknown): "Y" | "N" {
  return strVal(v) === "N" ? "N" : "Y";
}

// 엑셀 업로드: /api/processes/export가 내려주는 것과 같은 컬럼 구성(공정코드/공정명 필수)을
// 읽어 공정코드 기준으로 upsert 한다. 이미 있는 공정코드는 통째로 덮어쓴다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (
    | string
    | number
    | null
  )[][];
  const header = (rows[0] ?? []).map((h) => (h == null ? "" : String(h).trim()));
  const idx = (name: string) => header.indexOf(name);

  const iCode = idx("공정코드");
  const iName = idx("공정명");
  if (iCode === -1 || iName === -1) {
    return NextResponse.json(
      { error: "1행에서 다음 컬럼을 찾을 수 없습니다: 공정코드, 공정명" },
      { status: 400 }
    );
  }
  const iSeq = idx("순서");
  const iProcure = idx("조달구분");
  const iProd = idx("생산성구분");
  const iGroup = idx("공정그룹");
  const iGroup2 = idx("공정그룹2");
  const iSingle = idx("단공정");
  const iUse = idx("사용여부");
  const iRegDate = idx("등록일자");
  const iRegBy = idx("등록자");
  const iDailyCapa = idx("기본 일CAPA");
  const iYieldRate = idx("기본 생산수율");
  const iLotSize = idx("기본 Lot Size");
  const iShift1Active = idx("1조 사용여부");
  const iShift1Start = idx("1조 시작시각");
  const iShift1End = idx("1조 종료시각");
  const iShift1Minutes = idx("1조 기본작업시간(분)");
  const iShift2Active = idx("2조 사용여부");
  const iShift2Start = idx("2조 시작시각");
  const iShift2End = idx("2조 종료시각");
  const iShift2Minutes = idx("2조 기본작업시간(분)");
  const iApplyPattern = idx("근무패턴 적용여부");

  const db = getDb();
  const existingCodes = new Set(
    (db.prepare("SELECT process_code FROM processes").all() as { process_code: string }[]).map(
      (r) => r.process_code
    )
  );
  const maxSeqRow = db.prepare("SELECT MAX(seq) AS m FROM processes").get() as { m: number | null };
  let nextSeq = (maxSeqRow.m ?? 0) + 10;

  const upsert = db.prepare(
    `INSERT INTO processes
       (process_code, process_name, seq, procure_type, productivity_type, process_group, process_group2, single_process, use_yn, reg_date, reg_by,
        default_daily_capa, default_yield_rate, default_lot_size,
        shift1_active_yn, shift1_start, shift1_end, shift1_base_minutes,
        shift2_active_yn, shift2_start, shift2_end, shift2_base_minutes, apply_work_pattern_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(process_code) DO UPDATE SET
       process_name = excluded.process_name,
       seq = excluded.seq,
       procure_type = excluded.procure_type,
       productivity_type = excluded.productivity_type,
       process_group = excluded.process_group,
       process_group2 = excluded.process_group2,
       single_process = excluded.single_process,
       use_yn = excluded.use_yn,
       reg_date = excluded.reg_date,
       reg_by = excluded.reg_by,
       default_daily_capa = excluded.default_daily_capa,
       default_yield_rate = excluded.default_yield_rate,
       default_lot_size = excluded.default_lot_size,
       shift1_active_yn = excluded.shift1_active_yn,
       shift1_start = excluded.shift1_start,
       shift1_end = excluded.shift1_end,
       shift1_base_minutes = excluded.shift1_base_minutes,
       shift2_active_yn = excluded.shift2_active_yn,
       shift2_start = excluded.shift2_start,
       shift2_end = excluded.shift2_end,
       shift2_base_minutes = excluded.shift2_base_minutes,
       apply_work_pattern_yn = excluded.apply_work_pattern_yn`
  );

  let inserted = 0;
  let updated = 0;
  let skippedNoCode = 0;
  let skippedInvalid = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const code = strOrNull(r[iCode]);
      const name = strOrNull(r[iName]);
      if (!code || !name) {
        skippedNoCode++;
        continue;
      }

      const seqNum = iSeq === -1 ? undefined : numOrNull(r[iSeq]);
      const dailyCapa = iDailyCapa === -1 ? null : numOrNull(r[iDailyCapa]);
      const yieldRate = iYieldRate === -1 ? null : numOrNull(r[iYieldRate]);
      const lotSize = iLotSize === -1 ? null : numOrNull(r[iLotSize]);
      const shift1Start = iShift1Start === -1 ? null : timeOrNull(r[iShift1Start]);
      const shift1End = iShift1End === -1 ? null : timeOrNull(r[iShift1End]);
      const shift1Minutes = iShift1Minutes === -1 ? null : numOrNull(r[iShift1Minutes]);
      const shift2Start = iShift2Start === -1 ? null : timeOrNull(r[iShift2Start]);
      const shift2End = iShift2End === -1 ? null : timeOrNull(r[iShift2End]);
      const shift2Minutes = iShift2Minutes === -1 ? null : numOrNull(r[iShift2Minutes]);

      if (
        seqNum === undefined ||
        dailyCapa === undefined ||
        yieldRate === undefined ||
        lotSize === undefined ||
        shift1Start === undefined ||
        shift1End === undefined ||
        shift1Minutes === undefined ||
        shift2Start === undefined ||
        shift2End === undefined ||
        shift2Minutes === undefined
      ) {
        skippedInvalid++;
        continue;
      }

      const seq = seqNum ?? nextSeq;
      if (seqNum == null) nextSeq += 10;

      upsert.run(
        code,
        name,
        seq,
        iProcure === -1 ? null : strOrNull(r[iProcure]),
        iProd === -1 ? null : strOrNull(r[iProd]),
        iGroup === -1 ? null : strOrNull(r[iGroup]),
        iGroup2 === -1 ? null : strOrNull(r[iGroup2]),
        iSingle === -1 ? null : strOrNull(r[iSingle]),
        iUse === -1 ? "Y" : yn(r[iUse]),
        iRegDate === -1 ? null : (strOrNull(r[iRegDate]) ?? todayDot()),
        iRegBy === -1 ? null : strOrNull(r[iRegBy]),
        dailyCapa,
        yieldRate,
        lotSize,
        iShift1Active === -1 ? "Y" : yn(r[iShift1Active]),
        shift1Start,
        shift1End,
        shift1Minutes,
        iShift2Active === -1 ? "Y" : yn(r[iShift2Active]),
        shift2Start,
        shift2End,
        shift2Minutes,
        iApplyPattern === -1 ? "Y" : yn(r[iApplyPattern])
      );
      if (existingCodes.has(code)) updated++;
      else {
        inserted++;
        existingCodes.add(code);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, updated, skippedNoCode, skippedInvalid });
}
