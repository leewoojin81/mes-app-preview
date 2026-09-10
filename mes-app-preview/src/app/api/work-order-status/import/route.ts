import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeOrderDate } from "@/lib/work-order-status-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "작업지시현황"(ERP 작업지시 실적 리포트, d_pmmr540) 양식
// (첫 시트, 1행 헤더)을 그대로 읽어 저장한다. 원본이 연간 누적 리포트라 기간을 나눠
// 여러 번 업로드하는 경우가 많다. wo_no upsert만으로는 ERP에서 취소/삭제된 작업지시가
// DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다: 업로드 파일의 지시일자
// 최소~최대 구간을 구해 그 구간에 해당하는 기존 데이터를 통째로 지운 뒤, 파일 내용
// 전체를 새로 입력한다(구간 밖 데이터는 그대로 유지).
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

  const iOrderDate = idx("지시일자");
  const iWoNo = idx("작업지시번호");
  const iLotNo = idx("LOT-NO");
  const iItemCode = idx("품목코드");
  const iSoNo = idx("수주번호");

  const missing = [
    iOrderDate === -1 ? "지시일자" : null,
    iWoNo === -1 ? "작업지시번호" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    woNo: string;
    orderDate: string;
    itemCode: string | null;
    lotNo: string | null;
    soNo: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const woNo = str(r[iWoNo]);
    const orderDate = normalizeOrderDate(r[iOrderDate]);
    if (!woNo || !orderDate) {
      skipped++;
      continue;
    }

    // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존("No." 제외 — 화면 자체
    // No. 컬럼을 쓴다).
    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name || name === "No.") return;
      detail[name] = r[i] == null ? null : r[i];
    });

    entries.push({
      woNo,
      orderDate,
      itemCode: iItemCode === -1 ? null : str(r[iItemCode]),
      lotNo: iLotNo === -1 ? null : str(r[iLotNo]),
      soNo: iSoNo === -1 ? null : str(r[iSoNo]),
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "유효한 데이터(지시일자·작업지시번호)가 없습니다." },
      { status: 400 }
    );
  }

  // 업로드 파일의 지시일자 최소~최대 구간을 계산한다. order_date는 "YYYY-MM-DD"로
  // 정규화되어 있어 문자열 비교로 날짜 비교가 그대로 성립한다(다른 화면 필터와 동일).
  let dateFrom = entries[0].orderDate;
  let dateTo = entries[0].orderDate;
  for (const e of entries) {
    if (e.orderDate < dateFrom) dateFrom = e.orderDate;
    if (e.orderDate > dateTo) dateTo = e.orderDate;
  }

  const db = getDb();
  // 같은 작업지시번호가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO work_order_status (wo_no, order_date, item_code, lot_no, so_no, detail)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(wo_no) DO UPDATE SET
       order_date = excluded.order_date,
       item_code = excluded.item_code,
       lot_no = excluded.lot_no,
       so_no = excluded.so_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM work_order_status WHERE order_date >= ? AND order_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM work_order_status WHERE order_date >= ? AND order_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM work_order_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(e.woNo, e.orderDate, e.itemCode, e.lotNo, e.soNo, JSON.stringify(e.detail));
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
