import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ATTENDANCE_CARD_COLS } from "@/lib/attendance-card-columns";
import * as XLSX from "xlsx";
import { buildAttendanceCardWhere } from "@/lib/attendance-card-filters";

export const runtime = "nodejs";

// 현재 화면 검색/필터 조건에 해당하는 출퇴근카드등록 데이터를 원본 엑셀 컬럼 그대로
// (페이지네이션 없이 전체) xlsx로 내려준다. api/attendance-card-status/route.ts 와 같은
// 조건을 쓴다. 화면에서 고친 값도 detail에 반영되어 있으니 그대로 내려간다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const { where, args } = buildAttendanceCardWhere(req.nextUrl.searchParams);

  const rows = db
    .prepare(`SELECT detail FROM attendance_card_status ${where} ORDER BY work_date DESC, id DESC`)
    .all(...args) as { detail: string | null }[];

  const header = ATTENDANCE_CARD_COLS.map((c) => c.title);
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail ? (JSON.parse(r.detail) as Record<string, string | number | null>) : {};
    aoa.push(ATTENDANCE_CARD_COLS.map((col) => detail[col.key] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "출퇴근카드등록");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `출퇴근카드등록_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
