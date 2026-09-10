import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: string | number | null): number | null {
  return typeof v === "number" ? v : null;
}

// 엑셀 업로드 임포트: 원본 "현재고현황" 양식(첫 시트, 1행 헤더)을 그대로 읽어 저장한다.
// 이 화면은 특정 시점의 스냅샷 리포트이므로, upsert가 아니라 업로드할 때마다 기존
// 데이터를 전부 지우고 새 파일 내용으로 통째로 교체한다.
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

  const iItemCode = idx("품목코드");
  const iLotNo = idx("LOT No");
  const iWarehouse = idx("창고");
  const iStockQty = idx("재고수량");

  const required: [string, number][] = [
    ["품목코드", iItemCode],
    ["재고수량", iStockQty],
  ];
  const missing = required.filter(([, i]) => i === -1).map(([name]) => name);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO inventory_status (item_code, lot_no, warehouse, stock_qty, detail)
     VALUES (?, ?, ?, ?, ?)`
  );

  let inserted = 0;
  let skipped = 0;

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM inventory_status");
    for (const r of rows.slice(1)) {
      const itemCode = str(r[iItemCode]);
      if (!itemCode) {
        skipped++;
        continue;
      }

      // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존(제목 없는 컬럼은 제외).
      const detail: Record<string, string | number | null> = {};
      header.forEach((name, i) => {
        if (!name) return;
        detail[name] = r[i] == null ? null : r[i];
      });

      insert.run(
        itemCode,
        str(r[iLotNo]),
        str(r[iWarehouse]),
        num(r[iStockQty]),
        JSON.stringify(detail)
      );
      inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, skipped });
}
