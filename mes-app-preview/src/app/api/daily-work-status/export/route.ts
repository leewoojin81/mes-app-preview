import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DAILY_WORK_STATUS_COLS } from "@/lib/daily-work-status-columns";
import { DAILY_WORK_STATUS_JOIN, buildDailyWorkStatusWhere } from "@/lib/daily-work-status-filters";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 현재 화면 필터(작업일자 범위/드롭다운/텍스트 검색) 조건에 해당하는 실적을 원본
// 엑셀 컬럼 그대로(페이지네이션 없이 전체) xlsx로 내려준다.
// api/daily-work-status/route.ts 와 같은 검색 규칙을 쓴다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const { where, args } = buildDailyWorkStatusWhere(params);

  const rows = db
    .prepare(
      `SELECT d.detail as detail ${DAILY_WORK_STATUS_JOIN} ${where} ORDER BY d.work_date DESC, d.id DESC`
    )
    .all(...args) as { detail: string | null }[];

  const header = DAILY_WORK_STATUS_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail
      ? (JSON.parse(r.detail) as Record<string, string | number | null>)
      : {};
    aoa.push(DAILY_WORK_STATUS_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "일일작업현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `daily-work-status_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
