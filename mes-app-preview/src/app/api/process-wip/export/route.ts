import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROCESS_WIP_COLS } from "@/lib/process-wip-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 현재 화면 검색어 조건에 해당하는 재공현황을 원본 엑셀 컬럼 그대로(페이지네이션
// 없이 전체) xlsx로 내려준다. api/process-wip/route.ts 와 같은 검색 규칙을 쓴다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const searchParam = req.nextUrl.searchParams.get("search");

  const conditions: string[] = [];
  const args: string[] = [];
  if (searchParam) {
    conditions.push(
      "(item_code LIKE ? OR wo_no LIKE ? OR lot_no LIKE ? OR so_no LIKE ? OR json_extract(detail, '$.품목정보') LIKE ?)"
    );
    args.push(
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`
    );
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(`SELECT detail FROM process_wip_status ${where} ORDER BY id`)
    .all(...args) as { detail: string | null }[];

  const header = PROCESS_WIP_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail
      ? (JSON.parse(r.detail) as Record<string, string | number | null>)
      : {};
    aoa.push(PROCESS_WIP_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "공정재공현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `process-wip_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
