import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTransferDate } from "@/lib/warehouse-transfer-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "창고이동현황"(ERP 창고간 이동 리포트, d_mmmr010) 양식(첫 시트,
// 1행 헤더)을 그대로 읽어 저장한다. 이동 1건이 품목별로 여러 행(순번)으로 나뉘어
// 이동번호만으론 유일하지 않으므로 record_key(이동번호|순번)로 자연키를 잡는다. 원본을
// 기간을 나눠 여러 번 업로드하는 경우가 많은데, record_key upsert만으로는 ERP에서
// 취소/삭제된 이동이 DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다(PUR-02/INV-04와
// 동일): 업로드 파일의 이동일자 최소~최대 구간을 구해 그 구간에 해당하는 기존 데이터를
// 통째로 지운 뒤, 파일 내용 전체를 새로 입력한다(구간 밖 데이터는 유지). 출고품목과
// 입고품목은 원본에서 항상 같아(2026-09-13 확인) item_code 하나만 둔다.
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

  const iTransferDate = idx("이동일자");
  const iTransferNo = idx("이동번호");
  const iSeq = idx("순번");
  const iItemCode = idx("출고품목");
  const iFromWarehouse = idx("출고창고");
  const iToWarehouse = idx("입고창고");
  const iLotNo = idx("Lot번호");

  const missing = [
    iTransferDate === -1 ? "이동일자" : null,
    iTransferNo === -1 ? "이동번호" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    recordKey: string;
    transferDate: string;
    itemCode: string | null;
    fromWarehouse: string | null;
    toWarehouse: string | null;
    transferNo: string;
    lotNo: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const transferNo = str(r[iTransferNo]);
    const transferDate = normalizeTransferDate(r[iTransferDate]);
    if (!transferNo || !transferDate) {
      skipped++;
      continue;
    }

    const seq = iSeq === -1 ? null : str(r[iSeq]);
    const recordKey = `${transferNo}|${seq ?? ""}`;

    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name || name === "No.") return;
      detail[name] = r[i] == null ? null : r[i];
    });

    entries.push({
      recordKey,
      transferDate,
      itemCode: iItemCode === -1 ? null : str(r[iItemCode]),
      fromWarehouse: iFromWarehouse === -1 ? null : str(r[iFromWarehouse]),
      toWarehouse: iToWarehouse === -1 ? null : str(r[iToWarehouse]),
      transferNo,
      lotNo: iLotNo === -1 ? null : str(r[iLotNo]),
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "유효한 데이터(이동일자·이동번호)가 없습니다." },
      { status: 400 }
    );
  }

  // 업로드 파일의 이동일자 최소~최대 구간을 계산한다. transfer_date는 "YYYY-MM-DD"로
  // 정규화되어 있어 문자열 비교로 날짜 비교가 그대로 성립한다.
  let dateFrom = entries[0].transferDate;
  let dateTo = entries[0].transferDate;
  for (const e of entries) {
    if (e.transferDate < dateFrom) dateFrom = e.transferDate;
    if (e.transferDate > dateTo) dateTo = e.transferDate;
  }

  const db = getDb();
  // 같은 record_key가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO warehouse_transfer_status (record_key, transfer_date, item_code, from_warehouse, to_warehouse, transfer_no, lot_no, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       transfer_date = excluded.transfer_date,
       item_code = excluded.item_code,
       from_warehouse = excluded.from_warehouse,
       to_warehouse = excluded.to_warehouse,
       transfer_no = excluded.transfer_no,
       lot_no = excluded.lot_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM warehouse_transfer_status WHERE transfer_date >= ? AND transfer_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM warehouse_transfer_status WHERE transfer_date >= ? AND transfer_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM warehouse_transfer_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(
        e.recordKey,
        e.transferDate,
        e.itemCode,
        e.fromWarehouse,
        e.toWarehouse,
        e.transferNo,
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
