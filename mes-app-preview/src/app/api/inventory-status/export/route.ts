import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { INVENTORY_STATUS_COLS } from "@/lib/inventory-status-columns";
import { buildInventoryStatusWhere } from "@/lib/inventory-status-filters";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 현재 화면 필터(창고/품목계정/대분류/중분류/소분류/품목군/품목코드/LOT No) 조건에
// 해당하는 재고를 원본 엑셀 컬럼 그대로(페이지네이션 없이 전체) xlsx로 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const { where, args } = buildInventoryStatusWhere(req.nextUrl.searchParams);

  const rows = db
    .prepare(`SELECT detail FROM inventory_status ${where} ORDER BY id`)
    .all(...args) as { detail: string | null }[];

  const header = INVENTORY_STATUS_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail
      ? (JSON.parse(r.detail) as Record<string, string | number | null>)
      : {};
    aoa.push(INVENTORY_STATUS_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "현재고현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `inventory-status_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
