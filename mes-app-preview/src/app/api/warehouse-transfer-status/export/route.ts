import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { WAREHOUSE_TRANSFER_COLS } from "@/lib/warehouse-transfer-columns";
import * as XLSX from "xlsx";
import { buildWarehouseTransferWhere } from "@/lib/warehouse-transfer-filters";

export const runtime = "nodejs";

// 현재 화면 검색/필터 조건에 해당하는 창고이동현황을 원본 엑셀 컬럼 그대로(페이지네이션
// 없이 전체) xlsx로 내려준다. api/warehouse-transfer-status/route.ts 와 같은 조건을 쓴다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const { where, args } = buildWarehouseTransferWhere(req.nextUrl.searchParams);

  const rows = db
    .prepare(
      `SELECT detail FROM warehouse_transfer_status ${where} ORDER BY transfer_date DESC, id DESC`
    )
    .all(...args) as { detail: string | null }[];

  const header = WAREHOUSE_TRANSFER_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail ? (JSON.parse(r.detail) as Record<string, string | number | null>) : {};
    aoa.push(WAREHOUSE_TRANSFER_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "창고이동현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `warehouse-transfer-status_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
