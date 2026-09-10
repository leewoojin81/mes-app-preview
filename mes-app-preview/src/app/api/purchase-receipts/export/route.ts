import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PURCHASE_RECEIPT_COLS } from "@/lib/purchase-receipt-columns";
import * as XLSX from "xlsx";
import { buildPurchaseReceiptWhere } from "@/lib/purchase-receipt-filters";

export const runtime = "nodejs";

// 현재 화면 검색/필터 조건에 해당하는 구매입고현황을 원본 엑셀 컬럼 그대로(페이지네이션
// 없이 전체) xlsx로 내려준다. api/purchase-receipts/route.ts 와 같은 조건을 쓴다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const { where, args } = buildPurchaseReceiptWhere(req.nextUrl.searchParams);

  const rows = db
    .prepare(
      `SELECT detail FROM purchase_receipt_status ${where} ORDER BY receipt_date DESC, id DESC`
    )
    .all(...args) as { detail: string | null }[];

  const header = PURCHASE_RECEIPT_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail ? (JSON.parse(r.detail) as Record<string, string | number | null>) : {};
    aoa.push(PURCHASE_RECEIPT_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "구매입고현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `purchase-receipts_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
