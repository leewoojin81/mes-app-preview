import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { DOSU_CHANGE_COLS, normalizeOrderDate } from "@/lib/dosu-change-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "도수변경등록"(ERP 조립 실적 리포트, d_pmmr543) 양식(첫 시트,
// 1행 헤더)을 그대로 읽어 저장한다. 원본 헤더에 "주야간"이 두 번(작업 주야간·검사
// 주야간) 나오므로 header.indexOf만으로는 두 번째 컬럼을 못 찾는다 — DOSU_CHANGE_COLS
// 순서대로 헤더를 하나씩 소비해가며 위치를 맞춘다(같은 제목이 반복돼도 등장 순서로 구분).
// 원본을 기간을 나눠 여러 번 업로드하는 경우가 많은데, record_key upsert만으로는
// ERP에서 취소/삭제된 실적이 DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다
// (PROD-05와 동일): 업로드 파일의 검사일자 최소~최대 구간을 구해 그 구간에 해당하는
// 기존 데이터를 통째로 지운 뒤, 파일 내용 전체를 새로 입력한다(구간 밖 데이터는 유지).
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

  // DOSU_CHANGE_COLS의 title(원본 헤더 제목) 순서대로 header에서 등장 위치를 하나씩
  // 소비한다 — "주야간"처럼 제목이 중복돼도 등장 순서대로 서로 다른 컬럼에 매칭된다.
  const used = new Array(header.length).fill(false);
  const colIndex = DOSU_CHANGE_COLS.map((col) => {
    const i = header.findIndex((h, idx) => !used[idx] && h === col.title);
    if (i !== -1) used[i] = true;
    return i;
  });

  const iOrderDate = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "지시일자")];
  const iInspectDate = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "검사일자")];
  const iWoNo = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "작업지시번호")];
  const iLotNo = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "LOT No")];
  const iItemCode = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "품목코드")];
  const iAssyInputLot = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "조립투입LOT No")];
  const iAssyInputItem = colIndex[DOSU_CHANGE_COLS.findIndex((c) => c.key === "조립투입품목")];

  const missing = [
    iOrderDate === -1 ? "지시일자" : null,
    iInspectDate === -1 ? "검사일자" : null,
    iWoNo === -1 ? "작업지시번호" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    recordKey: string;
    orderDate: string;
    inspectDate: string;
    itemCode: string | null;
    woNo: string;
    lotNo: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const woNo = str(r[iWoNo]);
    const orderDate = normalizeOrderDate(r[iOrderDate]);
    const inspectDate = normalizeOrderDate(r[iInspectDate]);
    if (!woNo || !orderDate || !inspectDate) {
      skipped++;
      continue;
    }

    const lotNo = iLotNo === -1 ? null : str(r[iLotNo]);
    const assyInputLot = iAssyInputLot === -1 ? null : str(r[iAssyInputLot]);
    const assyInputItem = iAssyInputItem === -1 ? null : str(r[iAssyInputItem]);
    // 행 하나를 유일하게 식별하는 자연키. 조립 LOT 하나가 여러 투입자재(BASE·착색 등)
    // 행으로 나뉘어 나오므로 투입LOT·투입품목까지 포함해야 겹치지 않는다.
    const naturalKey = [woNo, lotNo, assyInputLot, assyInputItem].join("|");
    const recordKey = naturalKey.replace(/\|/g, "") === "" ? randomUUID() : naturalKey;

    const detail: Record<string, string | number | null> = {};
    DOSU_CHANGE_COLS.forEach((col, i) => {
      const srcIdx = colIndex[i];
      detail[col.key] = srcIdx === -1 || r[srcIdx] == null ? null : r[srcIdx];
    });

    entries.push({
      recordKey,
      orderDate,
      inspectDate,
      itemCode: iItemCode === -1 ? null : str(r[iItemCode]),
      woNo,
      lotNo,
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "유효한 데이터(지시일자·검사일자·작업지시번호)가 없습니다." },
      { status: 400 }
    );
  }

  // 업로드 파일의 검사일자 최소~최대 구간을 계산한다. inspect_date는 "YYYY-MM-DD"로
  // 정규화되어 있어 문자열 비교로 날짜 비교가 그대로 성립한다.
  let dateFrom = entries[0].inspectDate;
  let dateTo = entries[0].inspectDate;
  for (const e of entries) {
    if (e.inspectDate < dateFrom) dateFrom = e.inspectDate;
    if (e.inspectDate > dateTo) dateTo = e.inspectDate;
  }

  const db = getDb();
  // 같은 record_key가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO dosu_change_status (record_key, order_date, inspect_date, item_code, wo_no, lot_no, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       order_date = excluded.order_date,
       inspect_date = excluded.inspect_date,
       item_code = excluded.item_code,
       wo_no = excluded.wo_no,
       lot_no = excluded.lot_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM dosu_change_status WHERE inspect_date >= ? AND inspect_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM dosu_change_status WHERE inspect_date >= ? AND inspect_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM dosu_change_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(
        e.recordKey,
        e.orderDate,
        e.inspectDate,
        e.itemCode,
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
