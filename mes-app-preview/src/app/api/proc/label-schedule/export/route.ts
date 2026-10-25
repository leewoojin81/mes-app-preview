import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { listLabelSchedule } from "@/lib/label-schedule";
import {
  filterLabelRows,
  LABEL_COLS,
  labelCellValue,
  type LabelColKey,
  type ProgressFilter,
} from "@/lib/label-schedule-shared";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 라벨일정 엑셀 다운로드 — 화면과 같은 조회 기간·진행 필터·검색어, 화면에 표시 중인 열을 그 순서대로(cols) 내려준다.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "수주일자 기간을 입력해 주세요." }, { status: 400 });
  }
  const pfRaw = sp.get("pf");
  const pf: ProgressFilter = pfRaw === "open" || pfRaw === "done" ? pfRaw : "all";
  const valid = new Set<string>(LABEL_COLS.map((c) => c.key));
  const requested = (sp.get("cols") ?? "").split(",").filter((k): k is LabelColKey => valid.has(k));
  const keys = requested.length > 0 ? requested : LABEL_COLS.map((c) => c.key);
  const label = Object.fromEntries(LABEL_COLS.map((c) => [c.key, c.label])) as Record<LabelColKey, string>;

  const rows = filterLabelRows(listLabelSchedule(getDb(), from, to), pf, sp.get("q") ?? "");
  const aoa: (string | number | null)[][] = [keys.map((k) => label[k])];
  for (const r of rows) aoa.push(keys.map((k) => labelCellValue(r, k)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = keys.map((k) => ({ wch: k === "brand" || k === "note" ? 22 : k === "so_no" ? 17 : k === "customer" ? 14 : 11 }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: keys.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "라벨진행현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `라벨일정_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="label-schedule_${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
