import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchBizAll } from "@/lib/biz-attendance";

export const runtime = "nodejs";

// 비즈 탭 엑셀 다운로드 — 비즈 원본("기간별 근무관리")과 같은 모양(제목·조건 줄·2단 머리글, 사람별
// 일별 행 + "( 소 계 )" 행)으로 화면과 같은 조건의 전체를 내려준다. 시간 칸은 엑셀 [hh]:mm 서식.
const HEADERS = [
  "사번", "부서", "성명", "직위", "타임", "", "출근일자", "출근시간", "퇴근일자", "퇴근시간", "지각", "조퇴", "",
  "조출", "중교", "잔업", "정근", "연장", "야간", "특근", "특연", "", "비 고",
];

type Cell = XLSX.CellObject | undefined;
function dur(min: number | null): Cell {
  return min == null || min === 0 ? undefined : { t: "n", v: min / 1440, z: "[hh]:mm" };
}
function hm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function str(v: string | null): Cell {
  return v == null || v === "" ? undefined : { t: "s", v };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;
  const dept = params.get("dept") ?? "";
  const persons = fetchBizAll(getDb(), { dateFrom, dateTo, q: params.get("q") ?? "", dept, leaderWorkGroups });
  if (persons.length === 0) {
    return NextResponse.json({ error: "다운로드할 데이터가 없습니다." }, { status: 404 });
  }

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const put = (r: number, c: number, cell: Cell) => {
    if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };
  const text = (r: number, c: number, v: string) => put(r, c, { t: "s", v });

  text(0, 0, "기간별 근무관리");
  text(1, 0, ` - 부서 : ${dept}`);
  text(2, 0, " - 고용 : ");
  text(3, 0, " - 집계 : 00:00");
  text(4, 0, ` - 근무기간 : ${dateFrom.replace(/-/g, "/")}-${dateTo.replace(/-/g, "/")}`);
  for (let r = 0; r <= 4; r++) merges.push({ s: { r, c: 0 }, e: { r, c: 4 } });
  HEADERS.forEach((h, c) => {
    if (h) text(6, c, h);
  });
  text(7, 20, "휴일");
  text(7, 21, "토요");
  for (let c = 0; c < HEADERS.length; c++) {
    if (c === 20 || c === 21) continue;
    merges.push({ s: { r: 6, c }, e: { r: 7, c } });
  }
  merges.push({ s: { r: 6, c: 20 }, e: { r: 6, c: 21 } });

  let r = 8;
  for (const p of persons) {
    p.rows.forEach((d, i) => {
      if (i === 0) {
        put(r, 0, str(p.employee_no));
        put(r, 1, str(p.dept));
        put(r, 2, str(p.worker_name));
        put(r, 3, str(p.position));
      }
      put(r, 4, str(d.shift));
      put(r, 6, str(d.work_date));
      put(r, 7, str(d.in_time));
      put(r, 8, str(d.out_date));
      put(r, 9, str(d.out_time));
      put(r, 10, d.late ? { t: "s", v: hm(d.late) } : undefined);
      put(r, 11, dur(d.early_leave));
      put(r, 13, dur(d.early_start));
      put(r, 14, dur(d.lunch_shift));
      put(r, 15, dur(d.overtime));
      put(r, 16, dur(d.normal));
      put(r, 17, dur(d.extension));
      put(r, 18, dur(d.night));
      put(r, 19, dur(d.special));
      put(r, 20, dur(d.special_holiday));
      put(r, 21, dur(d.special_sat));
      put(r, 22, str(d.note));
      r++;
    });
    const t = p.totals;
    text(r, 0, "( 소 계 )");
    put(r, 4, { t: "s", v: String(t.days) });
    put(r, 7, { t: "s", v: String(t.in_count) });
    put(r, 9, { t: "s", v: String(t.out_count) });
    text(r, 10, hm(t.late));
    const sums: [number, number][] = [
      [11, t.early_leave], [13, t.early_start], [14, t.lunch_shift], [15, t.overtime], [16, t.normal],
      [17, t.extension], [18, t.night], [19, t.special], [20, t.special_holiday], [21, t.special_sat],
    ];
    for (const [c, m] of sums) put(r, c, { t: "n", v: m / 1440, z: "[hh]:mm" });
    r++;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: HEADERS.length } });
  ws["!merges"] = merges;
  ws["!cols"] = HEADERS.map((_, c) => ({ wch: c === 2 ? 14 : c === 22 ? 24 : c === 6 || c === 8 ? 11 : 9 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `비즈_기간별근무관리_${dateFrom.replace(/-/g, "")}-${dateTo.replace(/-/g, "")}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
    },
  });
}
