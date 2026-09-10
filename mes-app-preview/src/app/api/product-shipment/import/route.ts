import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeShipDate } from "@/lib/product-shipment-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 원본 "제품출고현황"(ERP 출고 실적 리포트, d_smmr430) 양식(첫 시트,
// 1행 헤더)을 그대로 읽어 저장한다. 원본이 연초부터의 누적 로그라 기간을 나눠 여러 번
// 업로드하는 경우가 많으므로, 재고 스냅샷 화면(INV-02/03)과 달리 업로드할 때마다 기존
// 데이터를 지우지 않고 누적한다. 같은 출고번호가 다시 업로드되면 새로 추가하지 않고
// 덮어쓴다(upsert) — 원본에서 출고번호는 PO 라인별 일련번호가 붙어 있어 항상 유일하다.
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

  const iShipDate = idx("출고일자");
  const iShipNo = idx("출고번호");
  const iItemCode = idx("품목코드");
  const iCustCode = idx("코드");
  const iSoNo = idx("PO번호");

  const missing = [
    iShipDate === -1 ? "출고일자" : null,
    iShipNo === -1 ? "출고번호" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO product_shipment_status (shipment_no, ship_date, item_code, customer_code, so_no, detail)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(shipment_no) DO UPDATE SET
       ship_date = excluded.ship_date,
       item_code = excluded.item_code,
       customer_code = excluded.customer_code,
       so_no = excluded.so_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const existsCheck = db.prepare("SELECT 1 FROM product_shipment_status WHERE shipment_no = ?");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const shipNo = str(r[iShipNo]);
      const shipDate = normalizeShipDate(r[iShipDate]);
      if (!shipNo || !shipDate) {
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

      if (existsCheck.get(shipNo)) updated++;
      else inserted++;
      upsert.run(
        shipNo,
        shipDate,
        iItemCode === -1 ? null : str(r[iItemCode]),
        iCustCode === -1 ? null : str(r[iCustCode]),
        iSoNo === -1 ? null : str(r[iSoNo]),
        JSON.stringify(detail)
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, updated, skipped });
}
