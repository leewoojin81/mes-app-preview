import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeWorkDate } from "@/lib/daily-work-status-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "일일작업현황"(ERP 실적 로그, d_pmmr810) 양식(첫 시트, 1행
// 헤더)을 그대로 읽어 저장한다. 원본 파일이 수십만 행이라 기간을 나눠 여러 번
// 업로드하는 경우가 많은데, record_key upsert만으로는 ERP에서 취소/삭제된 실적이
// DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다(PROD-05와 동일): 업로드 파일의
// 작업일자 최소~최대 구간을 구해 그 구간에 해당하는 기존 데이터를 통째로 지운 뒤,
// 파일 내용 전체를 새로 입력한다(구간 밖 데이터는 유지).
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

  const iWorkDate = idx("작업일자");
  const iItemCode = idx("품목코드");
  const iProcessCode = idx("공정코드");
  const iWoNo = idx("작지번호");
  const iLotNo = idx("LOT No");
  const iSeq = idx("공정순서");
  const iRegAt = idx("등록시각");

  const missing = iWorkDate === -1 ? ["작업일자"] : [];
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    recordKey: string;
    workDate: string;
    itemCode: string | null;
    processCode: string | null;
    woNo: string | null;
    lotNo: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const workDate = normalizeWorkDate(r[iWorkDate]);
    if (!workDate) {
      skipped++;
      continue;
    }

    const woNo = iWoNo === -1 ? null : str(r[iWoNo]);
    const processCode = iProcessCode === -1 ? null : str(r[iProcessCode]);
    const lotNo = iLotNo === -1 ? null : str(r[iLotNo]);
    const seq = iSeq === -1 ? null : str(r[iSeq]);
    const regAt = iRegAt === -1 ? null : str(r[iRegAt]);
    // 행 하나를 유일하게 식별하는 자연키(작지번호|공정코드|LOT No|공정순서|등록시각).
    // 다섯 값이 전부 비어 있는 행(원본 이상치)은 겹칠 근거가 없으니 임의 키를 준다.
    const naturalKey = [woNo, processCode, lotNo, seq, regAt].join("|");
    const recordKey = naturalKey.replace(/\|/g, "") === "" ? randomUUID() : naturalKey;

    // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존.
    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name) return;
      detail[name] = r[i] == null ? null : r[i];
    });

    entries.push({
      recordKey,
      workDate,
      itemCode: iItemCode === -1 ? null : str(r[iItemCode]),
      processCode,
      woNo,
      lotNo,
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: "유효한 데이터(작업일자)가 없습니다." }, { status: 400 });
  }

  // 업로드 파일의 작업일자 최소~최대 구간을 계산한다. work_date는 "YYYY-MM-DD"로
  // 정규화되어 있어 문자열 비교로 날짜 비교가 그대로 성립한다.
  let dateFrom = entries[0].workDate;
  let dateTo = entries[0].workDate;
  for (const e of entries) {
    if (e.workDate < dateFrom) dateFrom = e.workDate;
    if (e.workDate > dateTo) dateTo = e.workDate;
  }

  const db = getDb();
  // 같은 record_key가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO daily_work_status (record_key, work_date, item_code, process_code, wo_no, lot_no, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       work_date = excluded.work_date,
       item_code = excluded.item_code,
       process_code = excluded.process_code,
       wo_no = excluded.wo_no,
       lot_no = excluded.lot_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM daily_work_status WHERE work_date >= ? AND work_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM daily_work_status WHERE work_date >= ? AND work_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM daily_work_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(
        e.recordKey,
        e.workDate,
        e.itemCode,
        e.processCode,
        e.woNo,
        e.lotNo,
        JSON.stringify(e.detail)
      );
    }
    finalTotal = (countAll.get() as { c: number }).c;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({
    dateFrom,
    dateTo,
    deleted,
    inserted: entries.length,
    skipped,
    finalTotal,
  });
}
