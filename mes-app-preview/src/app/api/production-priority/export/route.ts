import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import { PRIORITY_SELECT, PRIORITY_ORDER, buildPriorityWhere } from "@/lib/production-priority-query";
import { PRIORITY_DETAIL_COLS, priorityCell, type PriorityRow } from "@/lib/production-priority-columns";

export const runtime = "nodejs";

// 원본 "생산순위지정.xlsx" 헤더 그대로 — No./작업순서/계획제외 다음은 PRIORITY_DETAIL_COLS.
const HEADER = ["No.", "작업순서", "계획제외", ...PRIORITY_DETAIL_COLS.map((c) => c.title)];

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const { where, args } = buildPriorityWhere(params);

  const rows = db.prepare(`${PRIORITY_SELECT} ${where} ${PRIORITY_ORDER}`).all(...args) as (Omit<
    PriorityRow,
    "detail"
  > & { detail: string | null })[];

  const aoa: (string | number | null)[][] = [HEADER];
  rows.forEach((raw, idx) => {
    const detail = raw.detail
      ? (JSON.parse(raw.detail) as Record<string, string | number | null>)
      : null;
    const r: PriorityRow = { ...raw, detail };
    const rowValues: (string | number | null)[] = [
      idx + 1,
      detail?.["작업순서"] ?? null,
      detail?.["계획제외"] === "Y" ? "Y" : "N",
    ];
    for (const col of PRIORITY_DETAIL_COLS) {
      rowValues.push(priorityCell(r, col.key));
    }
    aoa.push(rowValues);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "생산순위지정");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `production-priority_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
