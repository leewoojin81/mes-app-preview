import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeMoldReceiptDate } from "@/lib/mold-receipt-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "MOLD입고현황"(ERP 몰드 입고 리포트) 양식(첫 시트, 1행 헤더)을
// 그대로 읽어 저장한다. 입고 1건이 LOT별로 여러 행(순번)으로 나뉘어 입고전표번호만으론
// 유일하지 않으므로 record_key(입고전표번호|순번)로 자연키를 잡는다. 원본을 기간을 나눠
// 여러 번 업로드하는 경우가 많은데, record_key upsert만으로는 ERP에서 취소/삭제된 입고가
// DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다(PUR-02/PROD-05와 동일): 업로드
// 파일의 입고일 최소~최대 구간을 구해 그 구간에 해당하는 기존 데이터를 통째로 지운 뒤,
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

  const iReceiptDate = idx("입고일");
  const iReceiptNo = idx("입고전표번호");
  const iSeq = idx("순번");
  const iItemCode = idx("품목코드");
  const iWarehouse = idx("입고창고");
  const iLotNo = idx("LOT No");

  const missing = [
    iReceiptDate === -1 ? "입고일" : null,
    iReceiptNo === -1 ? "입고전표번호" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    recordKey: string;
    receiptDate: string;
    itemCode: string | null;
    warehouse: string | null;
    receiptNo: string;
    lotNo: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const receiptNo = str(r[iReceiptNo]);
    const receiptDate = normalizeMoldReceiptDate(r[iReceiptDate]);
    if (!receiptNo || !receiptDate) {
      skipped++;
      continue;
    }

    const seq = iSeq === -1 ? null : str(r[iSeq]);
    const recordKey = `${receiptNo}|${seq ?? ""}`;

    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name || name === "No.") return;
      detail[name] = r[i] == null ? null : r[i];
    });

    entries.push({
      recordKey,
      receiptDate,
      itemCode: iItemCode === -1 ? null : str(r[iItemCode]),
      warehouse: iWarehouse === -1 ? null : str(r[iWarehouse]),
      receiptNo,
      lotNo: iLotNo === -1 ? null : str(r[iLotNo]),
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "유효한 데이터(입고일·입고전표번호)가 없습니다." },
      { status: 400 }
    );
  }

  // 업로드 파일의 입고일 최소~최대 구간을 계산한다. receipt_date는 "YYYY-MM-DD"로
  // 정규화되어 있어 문자열 비교로 날짜 비교가 그대로 성립한다.
  let dateFrom = entries[0].receiptDate;
  let dateTo = entries[0].receiptDate;
  for (const e of entries) {
    if (e.receiptDate < dateFrom) dateFrom = e.receiptDate;
    if (e.receiptDate > dateTo) dateTo = e.receiptDate;
  }

  const db = getDb();
  // 같은 record_key가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO mold_receipt_status (record_key, receipt_date, item_code, warehouse, receipt_no, lot_no, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       receipt_date = excluded.receipt_date,
       item_code = excluded.item_code,
       warehouse = excluded.warehouse,
       receipt_no = excluded.receipt_no,
       lot_no = excluded.lot_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM mold_receipt_status WHERE receipt_date >= ? AND receipt_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM mold_receipt_status WHERE receipt_date >= ? AND receipt_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM mold_receipt_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(
        e.recordKey,
        e.receiptDate,
        e.itemCode,
        e.warehouse,
        e.receiptNo,
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
